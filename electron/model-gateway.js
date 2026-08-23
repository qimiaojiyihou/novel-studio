import {
  GenerationCancelledError,
  prepareModelTask,
  runEmbeddedModelTask,
  shapeModelResult,
} from './model-adapter.js'

class GoServiceUnavailableError extends Error {}

function now() {
  return new Date().toISOString()
}

async function readGoEvents(response, taskId, onEvent) {
  if (!response.body) throw new Error('Go 服务没有返回事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = null

  const consumeBlock = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) return
    const event = JSON.parse(data)
    const normalized = { ...event, taskId, gateway: 'go-service' }
    onEvent(normalized)
    if (['completed', 'failed', 'cancelled'].includes(event.type)) terminal = normalized
  }

  while (!terminal) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      if (terminal) break
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  if (!terminal && buffer.trim()) consumeBlock(buffer)
  if (!terminal) throw new Error('Go 服务的事件流提前结束')
  return terminal
}

async function cancelGoTask(runtime, taskId) {
  try {
    await fetch(runtime.baseUrl + '/api/v1/tasks/' + encodeURIComponent(taskId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + runtime.authToken },
    })
  } catch {
    // The service exit path is handled by the generation stream or embedded fallback.
  }
}

async function startGoTask(prepared, providerTaskId, outwardTaskId, runtime, control, onEvent) {
  const headers = {
    Authorization: 'Bearer ' + runtime.authToken,
    'Content-Type': 'application/json',
  }
  let accepted
  try {
    accepted = await fetch(runtime.baseUrl + '/api/v1/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        taskId: providerTaskId,
        task: prepared.task,
        endpoint: prepared.endpoint,
        apiKey: prepared.apiKey,
        model: prepared.model,
        messages: prepared.messages,
        temperature: prepared.temperature,
        parameters: prepared.parameters,
        endpointPath: prepared.requestConfig.endpointPath,
        requestHeaders: prepared.requestHeaders,
        stream: prepared.stream,
        mockContent: prepared.mockContent,
        mockDelayMs: prepared.mockDelayMs,
      }),
    })
  } catch (error) {
    throw new GoServiceUnavailableError(error.message)
  }
  if (!accepted.ok) {
    const detail = await accepted.text()
    if (accepted.status === 401 || accepted.status === 503) throw new GoServiceUnavailableError(detail)
    throw new Error('Go 服务拒绝了生成任务（' + accepted.status + '）：' + detail.slice(0, 180))
  }
  if (control.cancelRequested) await cancelGoTask(runtime, providerTaskId)

  const stream = await fetch(runtime.baseUrl + '/api/v1/tasks/' + encodeURIComponent(providerTaskId) + '/events', {
    headers: { Authorization: 'Bearer ' + runtime.authToken },
  })
  if (!stream.ok) throw new Error('读取 Go 生成事件失败（' + stream.status + '）')
  const terminal = await readGoEvents(stream, outwardTaskId, onEvent)
  if (terminal.type === 'cancelled') throw new GenerationCancelledError()
  if (terminal.type === 'failed') throw new Error(terminal.error || 'Go 模型任务执行失败')
  return shapeModelResult(prepared, terminal.content || '', 'go-service')
}

export function createModelGateway({ getGoRuntime, onGoUnavailable = () => {} }) {
  const activeTasks = new Map()

  function shouldRetry(error, receivedDelta) {
    if (receivedDelta || error instanceof GenerationCancelledError) return false
    if (error?.retryable) return true
    return /\b(408|409|425|429|500|502|503|504)\b|timeout|timed out|network|fetch|socket|ECONN|连接重置|请求超时/i.test(error?.message || '')
  }

  function retryDelay(attempt) {
    return Math.min(3000, 400 * (2 ** Math.max(0, attempt - 1)))
  }

  function waitForRetry(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new GenerationCancelledError())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  return {
    async generate(input, { taskId, onEvent = () => {}, onPrepared = () => {} }) {
      const prepared = prepareModelTask(input)
      onPrepared(prepared)
      const runtime = getGoRuntime()
      const maxAttempts = prepared.execution === 'remote' ? 3 : 1
      const controller = new AbortController()
      const control = { cancelRequested: false, providerTaskId: '', useGo: Boolean(runtime.status === 'ready' && runtime.baseUrl && runtime.authToken) }
      activeTasks.set(taskId, {
        mode: control.useGo ? 'go-service' : 'embedded',
        cancel: async () => {
          control.cancelRequested = true
          controller.abort()
          if (control.providerTaskId) await cancelGoTask(runtime, control.providerTaskId)
        },
      })
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (control.cancelRequested) throw new GenerationCancelledError()
          let receivedDelta = false
          const forwardEvent = (event) => {
            if (event.type === 'delta' && event.delta) receivedDelta = true
            onEvent({ ...event, attempt, maxAttempts })
          }
          try {
            let result
            if (control.useGo) {
              control.providerTaskId = `${taskId}-attempt-${attempt}`
              try {
                result = await startGoTask(prepared, control.providerTaskId, taskId, runtime, control, forwardEvent)
              } catch (error) {
                if (!(error instanceof GoServiceUnavailableError)) throw error
                onGoUnavailable(error)
                control.useGo = false
                activeTasks.get(taskId).mode = 'embedded'
                forwardEvent({ type: 'gateway-fallback', error: error.message, gateway: 'embedded', createdAt: now(), taskId })
                if (control.cancelRequested) throw new GenerationCancelledError()
              }
            }
            if (!control.useGo && !result) {
              result = await runEmbeddedModelTask(prepared, { taskId, signal: controller.signal, onEvent: forwardEvent })
            }
            return { ...result, attemptCount: attempt }
          } catch (error) {
            if (control.cancelRequested || error instanceof GenerationCancelledError) throw new GenerationCancelledError()
            if (attempt >= maxAttempts || !shouldRetry(error, receivedDelta)) throw error
            const delayMs = retryDelay(attempt)
            onEvent({
              taskId,
              type: 'retrying',
              error: error.message,
              attempt,
              nextAttempt: attempt + 1,
              maxAttempts,
              delayMs,
              gateway: control.useGo ? 'go-service' : 'embedded',
              createdAt: now(),
            })
            await waitForRetry(delayMs, controller.signal)
          }
        }
      } finally {
        activeTasks.delete(taskId)
      }
    },

    async cancel(taskId) {
      const active = activeTasks.get(taskId)
      if (!active) return { taskId, status: 'not-running' }
      await active.cancel()
      return { taskId, status: 'cancelling', mode: active.mode }
    },

    async cancelAll() {
      await Promise.allSettled([...activeTasks.values()].map((task) => task.cancel()))
    },
  }
}
