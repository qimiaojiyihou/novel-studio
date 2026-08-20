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

function shapeResult(task, content, modelProfile) {
  const base = {
    task,
    generatedAt: now(),
    execution: 'remote',
    model: {
      profileId: modelProfile.id,
      provider: modelProfile.provider,
      name: modelProfile.name,
      model: modelProfile.model,
    },
  }
  if (task === 'chapter_card') return { ...base, card: parseJsonObject(content) }
  if (task === 'scene_plan') return { ...base, scenePlan: String(content).trim() }
  if (task === 'rewrite') return { ...base, text: String(content).trim() }
  return { ...base, manuscript: String(content).trim() }
}

export async function generateModelTask(input) {
  const { task, modelProfile, apiKey } = input
  const needsKey = modelProfile?.provider !== 'local'
  const missingConfiguration = !modelProfile?.baseUrl || !modelProfile?.model || (needsKey && !apiKey)
  if (missingConfiguration) {
    return {
      ...generateMock(input),
      execution: 'mock',
      fallbackReason: needsKey ? '外部模型尚未填写完整配置' : '本地模型尚未填写 Base URL 或模型名称',
    }
  }

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey
  const response = await fetch(endpointFor(modelProfile.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelProfile.model,
      messages: messagesFor(task, input),
      temperature: task === 'rewrite' ? 0.55 : 0.78,
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(modelProfile.name + ' 请求失败（' + response.status + '）：' + detail.slice(0, 180))
  }
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error(modelProfile.name + ' 没有返回可用内容')
  return shapeResult(task, content, modelProfile)
}
