const DEFAULT_STREAM_LIMIT = 2 * 1024 * 1024
const STREAM_WARNING = /^warning\s*:/i

function eventText(event = {}) {
  if (typeof event.text === 'string') return event.text
  if (typeof event.summary === 'string') return event.summary
  if (event.payload?.content?.type === 'text') return String(event.payload.content.text || '')
  if (typeof event.payload?.content === 'string') return event.payload.content
  return ''
}

export function appendCodexStream(current = '', delta = '', limit = DEFAULT_STREAM_LIMIT) {
  const combined = `${String(current || '')}${String(delta || '')}`
  return combined.length > limit ? combined.slice(-limit) : combined
}

export function recoverCodexStream(events = [], agentStepId = '') {
  const relevant = events.filter((event) => !agentStepId || !event?.agentStepId || event.agentStepId === agentStepId)
  const retryBoundary = relevant.findLastIndex((event) => event?.type === 'structured_retry')
  return relevant
    .slice(retryBoundary + 1)
    .filter((event) => event?.type === 'text_delta')
    .map(eventText)
    .join('')
}

export function recoverCodexStreamAttempt(events = [], agentStepId = '') {
  const retry = [...events].reverse().find((event) => event?.type === 'structured_retry'
    && (!agentStepId || !event.agentStepId || event.agentStepId === agentStepId))
  return Math.max(1, Math.min(3, Number(retry?.payload?.attempt) || 1))
}

export function nextCodexStreamLength(displayedLength = 0, sourceLength = 0) {
  const displayed = Math.max(0, Number(displayedLength) || 0)
  const source = Math.max(displayed, Number(sourceLength) || 0)
  const remaining = source - displayed
  if (!remaining) return source
  return Math.min(source, displayed + Math.max(1, Math.ceil(remaining / 72)))
}

export function visibleCodexStream(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !STREAM_WARNING.test(line.trim()))
    .join('\n')
    .trimStart()
}
