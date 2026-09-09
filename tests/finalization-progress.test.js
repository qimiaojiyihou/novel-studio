import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finalizationProgressActivity, formatProgressDuration } from '../src/utils/finalization-progress.js'

test('finalization progress reports real activity, elapsed time and freshness', () => {
  const events = [
    { type: 'run_started', createdAt: '2026-09-06T10:00:00.000Z' },
    { type: 'reasoning', createdAt: '2026-09-06T10:01:02.000Z' },
  ]
  assert.deepEqual(finalizationProgressActivity(events, { now: Date.parse('2026-09-06T10:01:10.000Z') }), {
    activity: '正在整理人物状态和原文证据', freshness: '8秒前收到响应', guidance: '正在整理人物状态和原文证据',
    health: 'active', elapsed: '1分10秒', latestAt: Date.parse('2026-09-06T10:01:02.000Z'),
  })
})

test('finalization progress distinguishes long thinking from a stalled stream', () => {
  const event = [{ type: 'text_delta', createdAt: '2026-09-06T10:00:00.000Z' }]
  assert.equal(finalizationProgressActivity(event, { now: Date.parse('2026-09-06T10:00:20.000Z') }).health, 'thinking')
  const stalled = finalizationProgressActivity(event, { now: Date.parse('2026-09-06T10:01:00.000Z') })
  assert.equal(stalled.health, 'stalled')
  assert.match(stalled.guidance, /取消后重试/)
  assert.equal(formatProgressDuration(189000), '3分09秒')
})

test('structured retries are presented without exposing model reasoning text', () => {
  const progress = finalizationProgressActivity([{ type: 'structured_retry', payload: { attempt: 2 }, summary: 'raw detail', createdAt: '2026-09-06T10:00:00.000Z' }], {
    now: Date.parse('2026-09-06T10:00:01.000Z'),
  })
  assert.equal(progress.activity, '正在重新校准交接结构（第 2 次）')
  assert.doesNotMatch(progress.activity, /raw detail/)
})

test('a new handoff says it is waiting for the first response', () => {
  const progress = finalizationProgressActivity([], {
    startedAt: '2026-09-06T10:00:00.000Z', now: Date.parse('2026-09-06T10:00:08.000Z'),
  })
  assert.equal(progress.freshness, '已等待 8 秒')
  assert.equal(progress.activity, '正在准备章后交接')
})
