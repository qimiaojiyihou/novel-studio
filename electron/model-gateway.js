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

async function startGoTask(prepared, taskId, runtime, control, onEvent) {
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
        taskId,
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
  if (control.cancelRequested) await cancelGoTask(runtime, taskId)

  const stream = await fetch(runtime.baseUrl + '/api/v1/tasks/' + encodeURIComponent(taskId) + '/events', {
    headers: { Authorization: 'Bearer ' + runtime.authToken },
  })
  if (!stream.ok) throw new Error('读取 Go 生成事件失败（' + stream.status + '）')
  const terminal = await readGoEvents(stream, taskId, onEvent)
  if (terminal.type === 'cancelled') throw new GenerationCancelledError()
  if (terminal.type === 'failed') throw new Error(terminal.error || 'Go 模型任务执行失败')
  return shapeModelResult(prepared, terminal.content || '', 'go-service')
}

export function createModelGateway({ getGoRuntime, onGoUnavailable = () => {} }) {
  const activeTasks = new Map()

  async function runEmbedded(prepared, taskId, onEvent) {
    const controller = new AbortController()
    activeTasks.set(taskId, {
      mode: 'embedded',
      cancel: () => controller.abort(),
    })
    return runEmbeddedModelTask(prepared, { taskId, signal: controller.signal, onEvent })
  }

  return {
    async generate(input, { taskId, onEvent = () => {} }) {
      const prepared = prepareModelTask(input)
      const runtime = getGoRuntime()
      try {
        if (runtime.status === 'ready' && runtime.baseUrl && runtime.authToken) {
          const control = { cancelRequested: false }
          activeTasks.set(taskId, {
            mode: 'go-service',
            cancel: async () => {
              control.cancelRequested = true
              await cancelGoTask(runtime, taskId)
            },
          })
          try {
            return await startGoTask(prepared, taskId, runtime, control, onEvent)
          } catch (error) {
            if (!(error instanceof GoServiceUnavailableError)) throw error
            onGoUnavailable(error)
            onEvent({
              taskId,
              type: 'gateway-fallback',
              error: error.message,
              gateway: 'embedded',
              createdAt: now(),
            })
            if (control.cancelRequested) throw new GenerationCancelledError()
          }
        }
        return await runEmbedded(prepared, taskId, onEvent)
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
