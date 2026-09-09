function expiryTimestamp(request) {
  const parsed = Date.parse(String(request?.expiresAt || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function approvalRemainingSeconds(request, now = Date.now()) {
  const expiresAt = expiryTimestamp(request)
  if (!expiresAt) return null
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

export function approvalExpired(request, now = Date.now()) {
  const remaining = approvalRemainingSeconds(request, now)
  return remaining !== null && remaining <= 0
}

export function approvalExpiryLabel(request, now = Date.now()) {
  const remaining = approvalRemainingSeconds(request, now)
  if (remaining === null) return '有效期未知'
  if (remaining <= 0) return '请求已过期'
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `剩余 ${minutes}:${String(seconds).padStart(2, '0')}`
}
