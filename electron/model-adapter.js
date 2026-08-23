import { generateMock } from './mock-provider.js'
import {
  normalizeRequestConfig,
  requestEndpointFor,
  requestHeadersFor,
  requestParametersFor,
} from './model-request-config.js'
import { compilePrompt } from './prompt-compiler.js'

function now() {
  return new Date().toISOString()
}

const STRUCTURED_TASKS = new Set(['chapter_card', 'chapter_state_extract', 'continuity_audit'])

function parseJsonObject(value, label = '结构化任务') {
  const fence = String.fromCharCode(96).repeat(3)
  let source = String(value || '').trim()
  source = source.replace(fence + 'json', '').replace(fence, '').trim()
  try {
    return JSON.parse(source)
  } catch {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
    throw new Error(`${label}返回内容不是有效 JSON`)
  }
}

function mockContentFor(task, result) {
  if (task === 'chapter_card') return JSON.stringify(result.card)
  if (task === 'chapter_state_extract') return JSON.stringify(result.stateSnapshot)
  if (task === 'continuity_audit') return JSON.stringify(result.audit)
  if (task === 'scene_plan') return result.scenePlan || ''
  if (task === 'chapter') return result.manuscript || ''
  return result.text || ''
}

function normalizedModel(modelProfile) {
  return {
    profileId: modelProfile?.id || 'mock-provider',
    provider: modelProfile?.provider || 'mock',
    name: modelProfile?.name || 'MockProvider',
    model: modelProfile?.model || 'mock-v0.1',
  }
}

function finiteNumber(value, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null
}

function parametersFor(task, modelProfile) {
  const provider = modelProfile?.provider || 'mock'
  const settings = modelProfile?.settings || {}
  const taskTemperature = task === 'rewrite' ? 0.55
    : task === 'planning_field' ? 0.68
      : task === 'connection_test' ? 0
        : STRUCTURED_TASKS.has(task) ? 0.25
          : 0.78
  if (provider !== 'deepseek') return { temperature: taskTemperature }

  const parameters = {
    thinking: { type: settings.thinkingEnabled === false ? 'disabled' : 'enabled' },
    reasoning_effort: ['low', 'high', 'max'].includes(settings.reasoningEffort) ? settings.reasoningEffort : 'high',
    max_tokens: Math.round(finiteNumber(settings.maxTokens, 1, 131072) || (task === 'connection_test' ? 32 : 4096)),
    response_format: {
      type: settings.responseFormat === 'json_object' || (settings.responseFormat !== 'text' && STRUCTURED_TASKS.has(task))
        ? 'json_object'
        : 'text',
    },
  }
  if (task === 'connection_test') {
    parameters.thinking = { type: 'disabled' }
    parameters.max_tokens = 32
    parameters.response_format = { type: 'text' }
    parameters.temperature = 0
    return parameters
  }
  if (settings.samplingMode === 'top_p') {
    parameters.top_p = finiteNumber(settings.topP, 0, 1) ?? 1
  } else if (settings.samplingMode === 'temperature') {
    parameters.temperature = finiteNumber(settings.temperature, 0, 2) ?? taskTemperature
  } else {
    parameters.temperature = taskTemperature
  }
  return parameters
}

export class GenerationCancelledError extends Error {
  constructor() {
    super('生成任务已取消')
    this.name = 'GenerationCancelledError'
  }
}

export function prepareModelTask(input) {
  const { task, modelProfile, apiKey } = input
  const provider = modelProfile?.provider || 'mock'
  const needsKey = provider !== 'local' && provider !== 'mock'
  const missingConfiguration = !modelProfile?.baseUrl || !modelProfile?.model || (needsKey && !apiKey)
  if (task === 'connection_test' && missingConfiguration) {
    if (!modelProfile?.baseUrl) throw new Error('请先填写模型 Base URL')
    if (!modelProfile?.model) throw new Error('请先填写模型名称')
    if (needsKey && !apiKey) throw new Error('请先填写 API Key')
  }
  const parameters = parametersFor(task, modelProfile)
  const requestConfig = normalizeRequestConfig(modelProfile?.settings?.requestConfig)
  const mergedParameters = requestParametersFor(task, parameters, requestConfig)
  const compiledPrompt = input.compiledPrompt || compilePrompt(input)
  const prepared = {
    task,
    endpoint: modelProfile?.baseUrl || '',
    apiKey: apiKey || '',
    model: modelProfile?.model || '',
    messages: compiledPrompt.messages,
    temperature: Number(mergedParameters.temperature ?? 0),
    parameters: mergedParameters,
    requestConfig,
    requestHeaders: requestHeadersFor(requestConfig, apiKey),
    stream: requestConfig.stream,
    modelProfile: normalizedModel(modelProfile),
    execution: missingConfiguration ? 'mock' : 'remote',
    fallbackReason: '',
    mockContent: '',
    mockDelayMs: Number.isFinite(input.mockDelayMs) ? input.mockDelayMs : 8,
    contextDiagnostics: input.longContext?.diagnostics || null,
    promptSnapshot: compiledPrompt.snapshot,
  }
  if (!missingConfiguration) return prepared

  const mockResult = generateMock(input)
  prepared.mockContent = mockContentFor(task, mockResult)
  prepared.fallbackReason = !modelProfile
    ? '任务路由没有可用模型'
    : needsKey
      ? '外部模型尚未填写完整配置'
      : '本地模型尚未填写 Base URL 或模型名称'
  return prepared
}

export function shapeModelResult(prepared, content, gateway = 'embedded') {
  const base = {
    task: prepared.task,
    generatedAt: now(),
    execution: prepared.execution,
    gateway,
    model: prepared.modelProfile,
    prompt: {
      template: prepared.promptSnapshot?.template || null,
      styles: prepared.promptSnapshot?.styles || null,
      promptHash: prepared.promptSnapshot?.promptHash || '',
      estimatedChars: prepared.promptSnapshot?.estimatedChars || 0,
    },
  }
  if (prepared.fallbackReason) base.fallbackReason = prepared.fallbackReason
  if (prepared.contextDiagnostics) base.contextDiagnostics = prepared.contextDiagnostics
  if (prepared.task === 'chapter_card') return { ...base, card: parseJsonObject(content, '章节卡') }
  if (prepared.task === 'chapter_state_extract') return { ...base, stateSnapshot: parseJsonObject(content, '章后状态') }
  if (prepared.task === 'continuity_audit') return { ...base, audit: parseJsonObject(content, '连续性审计') }
  if (prepared.task === 'scene_plan') return { ...base, scenePlan: String(content).trim() }
  if (prepared.task === 'rewrite' || prepared.task === 'planning_field' || prepared.task === 'connection_test') return { ...base, text: String(content).trim() }
  return { ...base, manuscript: String(content).trim() }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new GenerationCancelledError()
}

async function streamMock(prepared, signal, onDelta) {
  const runes = Array.from(prepared.mockContent)
  for (let index = 0; index < runes.length; index += 4) {
    throwIfCancelled(signal)
    if (prepared.mockDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, prepared.mockDelayMs))
      throwIfCancelled(signal)
    }
    onDelta(runes.slice(index, index + 4).join(''))
  }
  return prepared.mockContent
}

function requestSignal(externalSignal, timeoutMilliseconds) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('模型请求超时')), timeoutMilliseconds)
  const cancel = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) cancel()
  else externalSignal?.addEventListener('abort', cancel, { once: true })
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', cancel)
    },
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function retryableError(message, { status = 0, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.status = status
  error.retryable = status ? RETRYABLE_HTTP_STATUS.has(status) : true
  return error
}

async function readSSEContent(response, signal, onDelta) {
  if (!response.body) throw new Error('模型接口没有返回响应流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finished = false

  const consumeBlock = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) return
    if (data === '[DONE]') {
      finished = true
      return
    }
    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      throw new Error('模型流返回了无法解析的数据')
    }
    for (const choice of payload.choices || []) {
      const delta = choice.delta?.content || ''
      if (!delta) continue
      content += delta
      onDelta(delta)
    }
  }

  while (!finished) {
    throwIfCancelled(signal)
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      if (finished) break
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  if (!finished && buffer.trim()) consumeBlock(buffer)
  return content
}

async function requestRemote(prepared, signal, onDelta) {
  const linkedSignal = requestSignal(signal, Number(prepared.timeoutMilliseconds || 120000))
  let receivedContent = false
  try {
    const response = await fetch(requestEndpointFor(prepared.endpoint, prepared.requestConfig), {
      method: 'POST',
      headers: prepared.requestHeaders,
      body: JSON.stringify({
        model: prepared.model,
        messages: prepared.messages,
        stream: prepared.stream,
        ...prepared.parameters,
      }),
      signal: linkedSignal.signal,
    })
    if (!response.ok) {
      const detail = await response.text()
      throw retryableError(prepared.modelProfile.name + ' 请求失败（' + response.status + '）：' + detail.slice(0, 180), { status: response.status })
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      const content = await readSSEContent(response, linkedSignal.signal, (delta) => { receivedContent = true; onDelta(delta) })
      if (!content) throw new Error(prepared.modelProfile.name + ' 没有返回可用内容')
      return content
    }
    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error(prepared.modelProfile.name + ' 没有返回可用内容')
    receivedContent = true
    onDelta(content)
    return content
  } catch (error) {
    if (signal?.aborted) throw new GenerationCancelledError()
    if (linkedSignal.signal.aborted) throw retryableError('模型请求超时', { cause: error })
    if (!receivedContent && (error instanceof TypeError || /network|fetch|socket|ECONN|连接/i.test(error?.message || ''))) {
      throw retryableError(error.message || '模型网络请求失败', { cause: error })
    }
    throw error
  } finally {
    linkedSignal.dispose()
  }
}

function modelListEndpoint(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '') + '/models'
  url.search = ''
  return url.toString()
}

function shortProbeError(error) {
  return String(error?.message || error || '探测失败').replace(/\s+/g, ' ').slice(0, 180)
}

async function timedProbe(run) {
  const startedAt = Date.now()
  try {
    const detail = await run()
    return { supported: true, latencyMs: Date.now() - startedAt, ...detail }
  } catch (error) {
    return { supported: false, latencyMs: Date.now() - startedAt, error: shortProbeError(error) }
  }
}

async function probeCompletion(modelProfile, apiKey, { stream, structured = false }) {
  const requestConfig = normalizeRequestConfig({ ...(modelProfile?.settings?.requestConfig || {}), stream })
  const profile = { ...modelProfile, settings: { ...(modelProfile?.settings || {}), requestConfig } }
  const compiledPrompt = {
    messages: [
      { role: 'system', content: structured ? 'Return one valid JSON object only.' : 'Reply with NOVEL_STUDIO_OK only.' },
      { role: 'user', content: structured ? 'Return {"status":"ok"}.' : 'Connection test.' },
    ],
    snapshot: { template: { id: 'capability-probe', version: 1 }, promptHash: '', estimatedChars: 32 },
  }
  const prepared = prepareModelTask({ task: 'connection_test', modelProfile: profile, apiKey, compiledPrompt })
  if (prepared.execution !== 'remote') throw new Error(prepared.fallbackReason || '模型配置不完整')
  prepared.timeoutMilliseconds = 20000
  prepared.stream = stream
  prepared.requestConfig = requestConfig
  if (structured) prepared.parameters = { ...prepared.parameters, response_format: { type: 'json_object' } }
  const content = await requestRemote(prepared, undefined, () => {})
  if (structured) parseJsonObject(content, '结构化输出探测')
  return { response: String(content).trim().slice(0, 80) }
}

export async function probeModelCapabilities(modelProfile, apiKey = '') {
  const checkedAt = now()
  const requestConfig = normalizeRequestConfig(modelProfile?.settings?.requestConfig)
  const modelList = await timedProbe(async () => {
    const linked = requestSignal(undefined, 15000)
    try {
      const response = await fetch(modelListEndpoint(modelProfile.baseUrl), {
        headers: requestHeadersFor(requestConfig, apiKey),
        signal: linked.signal,
      })
      if (!response.ok) throw new Error(`模型列表请求失败（${response.status}）`)
      const payload = await response.json()
      const models = Array.isArray(payload?.data) ? payload.data : []
      return {
        modelCount: models.length,
        models: models.map((item) => item?.id).filter(Boolean).slice(0, 20),
        selectedModelFound: models.some((item) => item?.id === modelProfile.model),
      }
    } finally {
      linked.dispose()
    }
  })
  const text = await timedProbe(() => probeCompletion(modelProfile, apiKey, { stream: false }))
  const streaming = await timedProbe(() => probeCompletion(modelProfile, apiKey, { stream: true }))
  const structuredOutput = await timedProbe(() => probeCompletion(modelProfile, apiKey, { stream: false, structured: true }))
  return {
    checkedAt,
    overall: text.supported ? (streaming.supported && structuredOutput.supported ? 'ready' : 'limited') : 'unavailable',
    modelList,
    text,
    streaming,
    structuredOutput,
  }
}

export async function runEmbeddedModelTask(prepared, { taskId = '', signal, onEvent = () => {} } = {}) {
  const emit = (event) => onEvent({ taskId, createdAt: now(), gateway: 'embedded', ...event })
  emit({ type: 'started' })
  try {
    const onDelta = (delta) => emit({ type: 'delta', delta })
    const content = prepared.execution === 'mock'
      ? await streamMock(prepared, signal, onDelta)
      : await requestRemote(prepared, signal, onDelta)
    emit({ type: 'completed', content })
    return shapeModelResult(prepared, content, 'embedded')
  } catch (error) {
    if (error instanceof GenerationCancelledError || signal?.aborted) {
      emit({ type: 'cancelled' })
      throw new GenerationCancelledError()
    }
    emit({ type: 'failed', error: error.message })
    throw error
  }
}

export async function generateModelTask(input, options = {}) {
  return runEmbeddedModelTask(prepareModelTask(input), options)
}
