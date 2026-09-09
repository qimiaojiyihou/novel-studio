import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateStateEvidence } from '../electron/chapter-finalization.js'

const manuscript = '顾客付清了钱。\n\n店主收起账本，送她出门。\n\n“明天再来。”\n\n她点头，带走了雨伞。'
const makeState = () => ({ summary: '顾客结账离开。', facts: [], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } })

test('chapter handoff accepts separated exact quotations in every evidence category', () => {
  const state = makeState()
  const evidence = '顾客付清了钱。\n“明天再来。”\n她点头，带走了雨伞。'
  for (const key of ['facts', 'characterStates', 'relationshipChanges', 'timelineEvents', 'openThreads']) state[key] = [{ evidence }]
  state.foreshadow.setups = [{ evidence }]
  state.foreshadow.payoffs = [{ evidence: { quote: evidence } }]
  assert.deepEqual(validateStateEvidence(state, manuscript), [])
})

test('chapter evidence supports CRLF and empty separators without changing quoted words', () => {
  const state = makeState()
  state.facts = [{ evidence: '顾客付清了钱。\r\n\r\n她点头，带走了雨伞。' }]
  assert.deepEqual(validateStateEvidence(state, manuscript), [])
})

test('every separated quotation must exist, not just the first valid fragment', () => {
  const state = makeState()
  state.facts = [{ evidence: '顾客付清了钱。\n店主偷偷收起了凶器。' }]
  state.foreshadow.setups = [{ evidence: { quote: '“明天再来。”\n她从未回来。' } }]
  assert.equal(validateStateEvidence(state, manuscript).length, 2)
})

test('single and contiguous evidence remain supported while missing and altered evidence fail', () => {
  const state = makeState()
  state.facts = [{ evidence: '顾客付清了钱。' }, { evidence: { quote: manuscript } }]
  assert.deepEqual(validateStateEvidence(state, manuscript), [])
  for (const evidence of ['', '\n\r\n  ', null, {}, '顾客付清了所有的钱。', '顾客付清了钱。\n伞归店主所有。']) {
    state.facts = [{ evidence }]
    assert.equal(validateStateEvidence(state, manuscript).length, 1)
  }
})
