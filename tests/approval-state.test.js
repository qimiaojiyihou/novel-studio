import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approvalExpired, approvalExpiryLabel, approvalRemainingSeconds } from '../src/utils/approval-state.js'

test('approval countdown reflects the real expiry time', () => {
  const request = { expiresAt: '2026-09-07T01:05:00.000Z' }
  const now = Date.parse('2026-09-07T01:00:00.000Z')
  assert.equal(approvalRemainingSeconds(request, now), 300)
  assert.equal(approvalExpiryLabel(request, now), '剩余 5:00')
  assert.equal(approvalExpired(request, now), false)
})

test('approval countdown marks expired and unknown requests explicitly', () => {
  const request = { expiresAt: '2026-09-07T01:00:00.000Z' }
  const now = Date.parse('2026-09-07T01:00:01.000Z')
  assert.equal(approvalRemainingSeconds(request, now), 0)
  assert.equal(approvalExpiryLabel(request, now), '请求已过期')
  assert.equal(approvalExpired(request, now), true)
  assert.equal(approvalExpiryLabel({}, now), '有效期未知')
})
