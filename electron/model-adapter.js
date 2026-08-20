import { generateMock } from './mock-provider.js'

function now() {
  return new Date().toISOString()
}

function endpointFor(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : normalized + '/chat/completions'
}

function contextFor({ project, chapter, instruction }) {
  return [
    '项目：' + (project?.title || '未命名小说'),
    '题材：' + (project?.genre || '未设置'),
    '故事想法：' + (project?.idea || '暂无'),
    '项目文风：' + (project?.style || '克制、具体、以动作和对白推进。'),
    '章节：' + (chapter?.chapter_no || 1) + ' · ' + (chapter?.title || '新章节'),
    '章节卡：' + JSON.stringify(chapter?.card || {}),
    '场景计划：' + (chapter?.scene_plan || '暂无'),
    instruction ? '本次补充要求：' + instruction : '',
  ].filter(Boolean).join('\n')
}

function messagesFor(task, input) {
  const context = contextFor(input)
  const system = '你是 Novel Studio 的小说创作协作者。遵守用户给出的题材、人物和文风，只输出当前任务需要的内容，不解释过程。'
  if (task === 'chapter_card') {
    return [
      { role: 'system', content: system + '章节卡必须返回 JSON，不要使用 Markdown 代码围栏。字段为 goal、protagonistGoal、resistance、turningPoint、payoff、cost、ending、requiredScenes；requiredScenes 是包含 id、title、goal、result 的数组。' },
      { role: 'user', content: context + '\n请生成一张可执行的章节卡。' },
    ]
  }
  if (task === 'scene_plan') {
    return [
      { role: 'system', content: system + '场景计划要按场景拆分，每个场景写出目标、阻力、行动和变化。' },
      { role: 'user', content: context + '\n请生成本章场景计划。' },
    ]
  }
  if (task === 'rewrite') {
    return [
      { role: 'system', content: system + '只返回重写后的正文，不要加标题、引号或解释。' },
      { role: 'user', content: context + '\n重写方式：' + (input.rewriteMode || '局部重写') + '\n待处理文字：' + (input.selectedText || '') },
    ]
  }
  return [
    { role: 'system', content: system + '只返回正文，不要加标题、分析或解释。' },
    { role: 'user', content: context + '\n请根据章节卡和场景计划继续生成本章正文。' },
  ]
}

function parseJsonObject(value) {
  const fence = String.fromCharCode(96).repeat(3)
  let source = String(value || '').trim()
  source = source.replace(fence + 'json', '').replace(fence, '').trim()
  try {
    return JSON.parse(source)
  } catch {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
    throw new Error('章节卡返回内容不是有效 JSON')
  }
}

function mockContentFor(task, result) {
  if (task === 'chapter_card') return JSON.stringify(result.card)
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
  const prepared = {
    task,
    endpoint: modelProfile?.baseUrl || '',
    apiKey: apiKey || '',
    model: modelProfile?.model || '',
    messages: messagesFor(task, input),
    temperature: task === 'rewrite' ? 0.55 : 0.78,
    modelProfile: normalizedModel(modelProfile),
    execution: missingConfiguration ? 'mock' : 'remote',
    fallbackReason: '',
    mockContent: '',
    mockDelayMs: Number.isFinite(input.mockDelayMs) ? input.mockDelayMs : 8,
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
  }
  if (prepared.fallbackReason) base.fallbackReason = prepared.fallbackReason
  if (prepared.task === 'chapter_card') return { ...base, card: parseJsonObject(content) }
  if (prepared.task === 'scene_plan') return { ...base, scenePlan: String(content).trim() }
  if (prepared.task === 'rewrite') return { ...base, text: String(content).trim() }
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
  const linkedSignal = requestSignal(signal, 120000)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (prepared.apiKey) headers.Authorization = 'Bearer ' + prepared.apiKey
    const response = await fetch(endpointFor(prepared.endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: prepared.model,
        messages: prepared.messages,
        temperature: prepared.temperature,
        stream: true,
      }),
      signal: linkedSignal.signal,
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(prepared.modelProfile.name + ' 请求失败（' + response.status + '）：' + detail.slice(0, 180))
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      const content = await readSSEContent(response, linkedSignal.signal, onDelta)
      if (!content) throw new Error(prepared.modelProfile.name + ' 没有返回可用内容')
      return content
    }
    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error(prepared.modelProfile.name + ' 没有返回可用内容')
    onDelta(content)
    return content
  } catch (error) {
    if (signal?.aborted) throw new GenerationCancelledError()
    throw error
  } finally {
    linkedSignal.dispose()
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
