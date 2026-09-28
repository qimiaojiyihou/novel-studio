// Keep the live renderer stream granular, but persist text in bounded chunks.
// A flush always inserts a new sequence, so cursor readers never miss an update
// to an event they have already seen.
export class AgentEventBuffer {
  constructor(appendEvent, { maxChars = 2048, flushMs = 1000, onError = error => console.warn('创作事件暂存失败：', error) } = {}) {
    this.appendEvent = appendEvent
    this.maxChars = maxChars
    this.flushMs = flushMs
    this.onError = onError
    this.pending = new Map()
  }

  schedule(entry) {
    entry.timer = setTimeout(() => {
      try { this.flush(entry.agentRunId) } catch (error) {
        this.onError(error)
        for (const pending of this.pending.values()) {
          if (pending.agentRunId === entry.agentRunId && !pending.timer) this.schedule(pending)
        }
      }
    }, this.flushMs)
    entry.timer.unref?.()
  }

  push(event) {
    if (event.type !== 'text_delta') {
      this.flush(event.agentRunId)
      return this.appendEvent(event)
    }
    const text = String(event.text ?? event.payload?.text ?? '')
    if (!text) return null
    const key = `${event.agentRunId}\u0000${event.agentStepId || ''}`
    let entry = this.pending.get(key)
    if (!entry) {
      entry = { agentRunId: event.agentRunId, agentStepId: event.agentStepId || '', text: '', timer: null }
      this.pending.set(key, entry)
      this.schedule(entry)
    }
    entry.text += text
    if (entry.text.length >= this.maxChars) this.flush(event.agentRunId)
    return null
  }

  flush(agentRunId) {
    for (const [key, entry] of this.pending) {
      if (agentRunId && entry.agentRunId !== agentRunId) continue
      clearTimeout(entry.timer)
      entry.timer = null
      this.appendEvent({
        agentRunId: entry.agentRunId,
        agentStepId: entry.agentStepId,
        type: 'text_delta',
        summary: entry.text.slice(0, 200),
        payload: { content: { type: 'text', text: entry.text } },
      })
      this.pending.delete(key)
    }
  }
}
