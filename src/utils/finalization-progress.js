function timestamp(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatProgressDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (!minutes) return `${seconds}秒`
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`
}

export function finalizationProgressActivity(events = [], { now = Date.now(), startedAt = '' } = {}) {
  const meaningful = events.filter(item => timestamp(item?.createdAt))
  const latest = meaningful.at(-1)
  const hasActivity = Boolean(latest)
  const firstAt = timestamp(meaningful[0]?.createdAt) || timestamp(startedAt) || now
  const latestAt = timestamp(latest?.createdAt) || timestamp(startedAt) || now
  const idleSeconds = Math.max(0, Math.floor((now - latestAt) / 1000))
  const type = String(latest?.type || '')
  const attempt = Math.max(1, Number(latest?.payload?.attempt) || 1)
  let activity = '正在准备章后交接'
  if (type === 'structured_retry') activity = `正在重新校准交接结构（第 ${attempt} 次）`
  else if (['tool_call', 'tool_result'].includes(type)) activity = '正在核对项目资料'
  else if (type === 'reasoning') activity = '正在整理人物状态和原文证据'
  else if (['text_delta', 'codex_event'].includes(type)) activity = '正在生成结构化交接'
  else if (type === 'run_started') activity = '正在准备独立上下文'

  const freshness = !hasActivity
    ? idleSeconds < 5 ? '任务刚刚开始' : idleSeconds < 60 ? `已等待 ${idleSeconds} 秒` : `已等待 ${Math.floor(idleSeconds / 60)} 分钟`
    : idleSeconds < 5 ? '刚刚收到响应' : idleSeconds < 60 ? `${idleSeconds}秒前收到响应` : `${Math.floor(idleSeconds / 60)}分钟前收到响应`
  const health = idleSeconds > 45 ? 'stalled' : idleSeconds > 15 ? 'thinking' : 'active'
  const guidance = health === 'stalled' ? '较长时间没有新响应，可继续等待或取消后重试'
    : health === 'thinking' ? '模型正在处理较长上下文' : activity
  return { activity, freshness, guidance, health, elapsed: formatProgressDuration(now - firstAt), latestAt }
}
