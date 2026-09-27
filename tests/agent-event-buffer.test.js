import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentEventBuffer } from '../electron/agent-event-buffer.js'

test('small live deltas persist as ordered chunks without rewriting a seen sequence', () => {
  const stored = []
  const buffer = new AgentEventBuffer(event => stored.push(event), { maxChars: 4, flushMs: 60_000 })
  for (const text of ['甲', '乙', '丙', '丁', '戊']) buffer.push({ agentRunId: 'run-1', agentStepId: 'step-1', type: 'text_delta', text })
  assert.equal(stored.length, 1)
  assert.equal(stored[0].summary, '甲乙丙丁')
  buffer.push({ agentRunId: 'run-1', agentStepId: 'step-1', type: 'tool_call', summary: '工具', payload: {} })
  assert.deepEqual(stored.map(event => [event.type, event.summary]), [
    ['text_delta', '甲乙丙丁'], ['text_delta', '戊'], ['tool_call', '工具'],
  ])
  assert.equal(buffer.pending.size, 0)
})

test('one run flush does not consume another run pending text', () => {
  const stored = []
  const buffer = new AgentEventBuffer(event => stored.push(event), { maxChars: 100, flushMs: 60_000 })
  buffer.push({ agentRunId: 'book-a', type: 'text_delta', text: '甲' })
  buffer.push({ agentRunId: 'book-b', type: 'text_delta', text: '乙' })
  buffer.flush('book-a')
  assert.deepEqual(stored.map(event => event.agentRunId), ['book-a'])
  buffer.flush()
  assert.deepEqual(stored.map(event => event.agentRunId), ['book-a', 'book-b'])
})

test('a short unfinished text chunk is persisted after the bounded delay', async () => {
  const stored = []
  const buffer = new AgentEventBuffer(event => stored.push(event), { maxChars: 100, flushMs: 10 })
  buffer.push({ agentRunId: 'run-1', type: 'text_delta', text: '尚未结束' })
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.deepEqual(stored.map(event => event.summary), ['尚未结束'])
  assert.equal(buffer.pending.size, 0)
})
