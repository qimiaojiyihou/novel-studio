import test from 'node:test'
import assert from 'node:assert/strict'
import { useInlineRunSelection } from '../src/composables/useInlineRunSelection.js'

test('workspace refresh keeps completed/cancelled candidates and the open panel', () => {
  const selection = useInlineRunSelection()
  for (const status of ['completed', 'cancelled', 'failed', 'waiting_confirmation']) {
    const candidate = { id: 'saved-candidate', status: 'accepted', payload: { manuscript: '保存的候选稿' } }
    selection.update({ id: 'run', projectId: 'book', status, candidates: [candidate] }, 'book')
    selection.panelOpen.value = true
    selection.syncProject('book')
    assert.equal(selection.runId.value, 'run')
    assert.equal(selection.status.value, status)
    assert.equal(selection.panelOpen.value, true)
    assert.deepEqual(selection.run.value.candidates[0], candidate)
  }
})

test('changing books clears the old entry and ignores late events from that book', () => {
  const selection = useInlineRunSelection()
  const oldRun = { id: 'old-run', projectId: 'old-book', status: 'completed' }
  selection.update(oldRun, 'old-book')
  selection.panelOpen.value = true
  selection.syncProject('new-book')
  assert.equal(selection.runId.value, '')
  assert.equal(selection.run.value, null)
  assert.equal(selection.panelOpen.value, false)
  assert.equal(selection.update(oldRun, 'new-book'), false)
  assert.equal(selection.runId.value, '')
})

test('opening saved historical candidates does not change their payload or source manuscript', () => {
  const selection = useInlineRunSelection()
  const manuscript = { id: 'chapter', manuscript: '原正文' }
  const saved = { id: 'archived-run', projectId: 'book', status: 'completed',
    candidates: [{ id: 'candidate', status: 'pending', payload: { manuscript: '未采纳的候选' } }] }
  const before = JSON.stringify({ manuscript, saved })
  assert.equal(selection.update(saved, 'book'), true)
  selection.syncProject('book')
  assert.equal(JSON.stringify({ manuscript, saved }), before)
  assert.equal(selection.runId.value, 'archived-run')
})
