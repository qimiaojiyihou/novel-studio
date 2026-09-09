import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendCodexStream, nextCodexStreamLength, recoverCodexStream, recoverCodexStreamAttempt, visibleCodexStream } from '../src/utils/codex-stream.js'

test('Codex stream appends text deltas in event order', () => {
  assert.equal(appendCodexStream('周砚必须', '作出选择。'), '周砚必须作出选择。')
  assert.equal(recoverCodexStream([
    { type: 'status', summary: 'running', agentStepId: 'step-1' },
    { type: 'text_delta', summary: '周砚必须', agentStepId: 'step-1' },
    { type: 'text_delta', summary: '作出选择。', agentStepId: 'step-1' },
    { type: 'text_delta', summary: '其他步骤', agentStepId: 'step-2' },
  ], 'step-1'), '周砚必须作出选择。')
})

test('Codex stream recovery only restores the current structured retry attempt', () => {
  assert.equal(recoverCodexStream([
    { type: 'text_delta', summary: '{"manuscript":"上一轮不合格正文"}', agentStepId: 'step-1' },
    { type: 'structured_retry', summary: '结构校准：开始第 2/3 次生成', agentStepId: 'step-1', payload: { attempt: 2 } },
    { type: 'text_delta', summary: '{"manuscript":"当前轮', agentStepId: 'step-1' },
    { type: 'text_delta', summary: '正文"}', agentStepId: 'step-1' },
  ], 'step-1'), '{"manuscript":"当前轮正文"}')
  assert.equal(recoverCodexStreamAttempt([
    { type: 'structured_retry', agentStepId: 'step-1', payload: { attempt: 2 } },
  ], 'step-1'), 2)
})

test('Codex stream hides transport warnings without dropping creative text', () => {
  assert.equal(visibleCodexStream([
    'Warning: Falling back from WebSockets to HTTPS transport, stream disconnected before completion: tls handshake eof',
    '周砚必须在翻红机会与现实承诺之间作出选择。',
  ].join('\n')), '周砚必须在翻红机会与现实承诺之间作出选择。')
})

test('Codex typewriter advances steadily and catches up faster when backlogged', () => {
  assert.equal(nextCodexStreamLength(0, 10), 1)
  assert.equal(nextCodexStreamLength(20, 740), 30)
  assert.equal(nextCodexStreamLength(10, 10), 10)
})
