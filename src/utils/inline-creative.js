function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function draftDigest(value) {
  const text = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `draft-v1-${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length}`
}

export function projectExecutionMode(project = {}) {
  return project.default_execution_mode === 'codex' ? 'codex' : 'app_model'
}

export function executionModeLabel(mode) {
  return mode === 'codex' ? 'Codex' : '任务模型'
}

export function creativeRoutePresentation({ project = {}, taskModelName = '', taskModelDetail = '' } = {}) {
  if (projectExecutionMode(project) === 'codex') {
    return {
      mode: 'codex',
      name: 'Codex',
      detail: 'Agent · ACP 优先 · exec 回退',
      fallbackName: String(taskModelName || '任务模型'),
    }
  }
  return {
    mode: 'app_model',
    name: String(taskModelName || 'MockProvider'),
    detail: String(taskModelDetail || '当前使用内置 MockProvider'),
    fallbackName: '',
  }
}

export function composeInlineManuscriptCandidate({ source = '', artifactType = '', payload = {}, action = {} } = {}) {
  const manuscript = String(source || '')
  const target = action.target || {}
  if (artifactType === 'manuscript_selection') {
    const from = Math.max(0, Math.min(Number(target.selectionFrom || 0), manuscript.length))
    const to = Math.max(from, Math.min(Number(target.selectionTo || 0), manuscript.length))
    return manuscript.slice(0, from) + String(payload.text || '') + manuscript.slice(to)
  }
  const generated = String(payload.manuscript || '')
  if (action.intent !== 'continue') return generated
  const offset = Math.max(0, Math.min(Number(target.cursorOffset ?? manuscript.length), manuscript.length))
  return manuscript.slice(0, offset) + generated + manuscript.slice(offset)
}

const CHAPTER_CARD_FIELD_PRESENTATION = Object.freeze([
  { key: 'goal', label: '本章合同', hint: '这一章必须完成的变化', emphasis: 'primary' },
  { key: 'protagonistGoal', label: '主角目标', hint: '主角主动想完成什么' },
  { key: 'resistance', label: '主要阻力', hint: '什么迫使主角调整策略' },
  { key: 'turningPoint', label: '本章转折', hint: '哪一刻让局面不可逆地改变' },
  { key: 'payoff', label: '本章回报', hint: '这一章兑现给读者什么' },
  { key: 'cost', label: '本章代价', hint: '主角为结果失去或承担什么' },
  { key: 'ending', label: '章末落点', hint: '正文最后允许发生的事件', emphasis: 'ending' },
])

function parseChapterCardPayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (payload.card && typeof payload.card === 'object' && !Array.isArray(payload.card)) return payload.card
    return payload
  }
  if (typeof payload !== 'string' || !payload.trim()) return null
  const fenced = payload.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  try {
    const parsed = JSON.parse(fenced ? fenced[1] : payload)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed.card && typeof parsed.card === 'object' && !Array.isArray(parsed.card) ? parsed.card : parsed
  } catch {
    return null
  }
}

function chapterCardText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  return ''
}

export function chapterCardPresentation(payload = {}) {
  const card = parseChapterCardPayload(payload)
  if (!card) return null
  const fields = CHAPTER_CARD_FIELD_PRESENTATION.map((field) => ({
    ...field,
    value: chapterCardText(card[field.key]),
    missing: !chapterCardText(card[field.key]),
  }))
  const scenes = Array.isArray(card.requiredScenes)
    ? card.requiredScenes.map((scene, index) => ({
      id: chapterCardText(scene?.id) || `S${index + 1}`,
      title: chapterCardText(scene?.title) || `必要场景 ${index + 1}`,
      goal: chapterCardText(scene?.goal),
      result: chapterCardText(scene?.result),
      missing: !chapterCardText(scene?.goal) || !chapterCardText(scene?.result),
    }))
    : []
  return {
    card,
    fields,
    scenes,
    missingCount: fields.filter((field) => field.missing).length
      + scenes.filter((scene) => scene.missing).length
      + (scenes.length ? 0 : 1),
  }
}

export function chapterCardEditIssues(payload = {}) {
  const presented = chapterCardPresentation(payload)
  if (!presented) return ['章节卡内容格式不正确']
  const issues = []
  for (const key of ['goal', 'protagonistGoal', 'resistance', 'ending']) {
    const field = presented.fields.find((item) => item.key === key)
    if (!field?.value) issues.push(`${field?.label || key}尚未填写`)
  }
  if (presented.scenes.length < 1 || presented.scenes.length > 6) issues.push('必要场景需要保持在 1–6 个')
  const ids = presented.scenes.map((scene) => scene.id).filter(Boolean)
  if (ids.length !== new Set(ids).size) issues.push('必要场景编号不能重复')
  presented.scenes.forEach((scene, index) => {
    if (!scene.goal || !scene.result) issues.push(`必要场景 ${index + 1} 需要填写任务和离场结果`)
  })
  return issues
}
