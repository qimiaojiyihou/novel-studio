export const MODEL_TASKS = Object.freeze([
  'connection_test',
  'planning_field',
  'chapter_card',
  'scene_plan',
  'chapter',
  'rewrite',
  'chapter_state_extract',
  'continuity_audit',
  'quality_review',
])

export const REQUEST_CONFIG_TEMPLATE = Object.freeze({
  endpointPath: '',
  stream: true,
  headers: {},
  body: {},
  taskBody: {},
})

const PROTECTED_BODY_KEYS = new Set(['model', 'messages', 'stream'])
const BLOCKED_HEADER_KEYS = new Set(['host', 'content-length'])
const SECRET_HEADER_PATTERN = /^(authorization|proxy-authorization|x-api-key|api-key|apikey)$/i
const API_KEY_PLACEHOLDER = '{{apiKey}}'

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function configurationError(message) {
  const error = new Error(message)
  error.name = 'ModelRequestConfigError'
  return error
}

function emptyRequestConfig() {
  return {
    endpointPath: '',
    stream: true,
    headers: {},
    body: {},
    taskBody: {},
  }
}

function normalizeBody(value, label, strict) {
  if (value == null) return {}
  if (!isPlainObject(value)) {
    if (strict) throw configurationError(`${label} 必须是 JSON 对象`)
    return {}
  }
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    if (PROTECTED_BODY_KEYS.has(key)) {
      if (strict) throw configurationError(`${label}.${key} 由 Novel Studio 管理，不能在 JSON 中覆盖`)
      continue
    }
    result[key] = jsonClone(entry)
  }
  return result
}

function normalizeHeaders(value, strict) {
  if (value == null) return {}
  if (!isPlainObject(value)) {
    if (strict) throw configurationError('headers 必须是 JSON 对象')
    return {}
  }
  const headers = {}
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = String(rawName || '').trim()
    if (!name || BLOCKED_HEADER_KEYS.has(name.toLowerCase())) {
      if (strict) throw configurationError(`请求头 ${name || '(空名称)'} 不允许配置`)
      continue
    }
    if (typeof rawValue !== 'string') {
      if (strict) throw configurationError(`请求头 ${name} 的值必须是字符串`)
      continue
    }
    if (SECRET_HEADER_PATTERN.test(name) && !rawValue.includes(API_KEY_PLACEHOLDER)) {
      if (strict) throw configurationError(`请求头 ${name} 必须使用 ${API_KEY_PLACEHOLDER}，不要在 JSON 中写入明文密钥`)
      continue
    }
    headers[name] = rawValue
  }
  return headers
}

export function normalizeRequestConfig(value, { strict = false } = {}) {
  if (value == null) return emptyRequestConfig()
  if (!isPlainObject(value)) {
    if (strict) throw configurationError('JSON 请求配置必须是一个对象')
    return emptyRequestConfig()
  }
  if (strict) {
    const allowed = new Set(Object.keys(REQUEST_CONFIG_TEMPLATE))
    const unknown = Object.keys(value).find((key) => !allowed.has(key))
    if (unknown) throw configurationError(`不支持的顶层配置字段：${unknown}`)
  }

  if (strict && value.endpointPath != null && typeof value.endpointPath !== 'string') {
    throw configurationError('endpointPath 必须是字符串')
  }
  const endpointPath = typeof value.endpointPath === 'string' ? value.endpointPath.trim() : ''
  if (strict && endpointPath && (!endpointPath.startsWith('/') || endpointPath.length > 1200)) {
    throw configurationError('endpointPath 必须以 / 开头，且不能超过 1200 个字符')
  }
  if (strict && value.stream != null && typeof value.stream !== 'boolean') {
    throw configurationError('stream 必须是 true 或 false')
  }
  const stream = typeof value.stream === 'boolean' ? value.stream : true
  const taskBody = {}
  if (value.taskBody != null && !isPlainObject(value.taskBody)) {
    if (strict) throw configurationError('taskBody 必须是 JSON 对象')
  } else {
    for (const [task, body] of Object.entries(value.taskBody || {})) {
      if (!MODEL_TASKS.includes(task)) {
        if (strict) throw configurationError(`taskBody 包含未知任务：${task}`)
        continue
      }
      taskBody[task] = normalizeBody(body, `taskBody.${task}`, strict)
    }
  }
  return {
    endpointPath,
    stream,
    headers: normalizeHeaders(value.headers, strict),
    body: normalizeBody(value.body, 'body', strict),
    taskBody,
  }
}

export function parseRequestConfigJson(text) {
  const source = String(text || '').trim()
  if (!source) return normalizeRequestConfig({}, { strict: true })
  if (source.length > 64 * 1024) throw configurationError('JSON 请求配置不能超过 64 KB')
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw configurationError(`JSON 格式错误：${error.message}`)
  }
  return normalizeRequestConfig(parsed, { strict: true })
}

export function requestParametersFor(task, defaults, requestConfig) {
  const config = normalizeRequestConfig(requestConfig)
  return {
    ...normalizeBody(defaults, '默认参数', false),
    ...config.body,
    ...(config.taskBody[task] || {}),
  }
}

export function requestHeadersFor(requestConfig, apiKey = '') {
  const config = normalizeRequestConfig(requestConfig)
  const headers = Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [
    name,
    value.split(API_KEY_PLACEHOLDER).join(String(apiKey || '')),
  ]))
  const hasCustomAuth = Object.keys(headers).some((name) => SECRET_HEADER_PATTERN.test(name))
  if (apiKey && !hasCustomAuth) headers.Authorization = `Bearer ${apiKey}`
  headers['Content-Type'] = 'application/json'
  return headers
}

export function requestEndpointFor(baseUrl, requestConfig) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '')
  const config = normalizeRequestConfig(requestConfig)
  if (config.endpointPath) return normalizedBase + '/' + config.endpointPath.replace(/^\/+/, '')
  return normalizedBase.endsWith('/chat/completions') ? normalizedBase : normalizedBase + '/chat/completions'
}
