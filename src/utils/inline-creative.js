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
