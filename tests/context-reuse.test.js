import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContextDelta } from '../electron/context-reuse.js'

const current = {
  text: 'full context',
  sources: [
    { targetKey: 'project:p:identity', digest: 'same', required: true },
    { targetKey: 'planning_document:p:foundation', digest: 'changed', required: true },
    { targetKey: 'knowledge_item:k:content', digest: 'new', required: false },
  ],
  items: [
    { targetKey: 'project:p:identity', digest: 'same', required: true, text: 'identity text' },
    { targetKey: 'planning_document:p:foundation', digest: 'changed', required: true, text: 'changed foundation' },
    { targetKey: 'knowledge_item:k:content', digest: 'new', required: false, text: 'new knowledge' },
  ],
  diagnostics: { retrieval: 'local' },
}

test('context delta sends only new and changed entries while preserving the full source snapshot', () => {
  const delta = buildContextDelta({
    currentContext: current,
    previousSnapshot: {
      conversationScopeKey: 'planning:p',
      contextSources: [
        { targetKey: 'project:p:identity', digest: 'same' },
        { targetKey: 'planning_document:p:foundation', digest: 'old' },
      ],
    },
    conversationScopeKey: 'planning:p',
    previousStepId: 'step-1',
  })

  assert.doesNotMatch(delta.text, /identity text/)
  assert.match(delta.text, /changed foundation/)
  assert.match(delta.text, /new knowledge/)
  assert.deepEqual(delta.sources, current.sources)
  assert.equal(delta.diagnostics.reuseMode, 'delta')
  assert.equal(delta.diagnostics.changedSourceCount, 2)
  assert.equal(delta.diagnostics.omittedUnchangedSourceCount, 1)
})

test('context delta is disabled when scope or source evidence is unavailable', () => {
  assert.equal(buildContextDelta({ currentContext: current, previousSnapshot: {}, conversationScopeKey: 'planning:p' }), null)
  assert.equal(buildContextDelta({
    currentContext: current,
    previousSnapshot: { conversationScopeKey: 'chapter:p:c', contextSources: current.sources },
    conversationScopeKey: 'planning:p',
  }), null)
})

test('context delta explicitly states when all formal context is unchanged', () => {
  const delta = buildContextDelta({
    currentContext: current,
    previousSnapshot: { conversationScopeKey: 'planning:p', contextSources: current.sources },
    conversationScopeKey: 'planning:p',
  })
  assert.match(delta.text, /没有变化/)
  assert.equal(delta.diagnostics.changedSourceCount, 0)
})
