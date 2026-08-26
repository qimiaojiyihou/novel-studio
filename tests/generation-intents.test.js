import assert from 'node:assert/strict'
import test from 'node:test'
import { composeGenerationCandidate } from '../src/utils/generation-intents.js'

test('continue inserts at the cursor while preserving both sides of the manuscript', () => {
  assert.equal(composeGenerationCandidate({ intent: 'continue', original: '前文后文', generated: '新增', cursorOffset: 2 }), '前文新增后文')
  assert.equal(composeGenerationCandidate({ intent: 'continue', original: '正文', generated: '续写', cursorOffset: 99 }), '正文续写')
})

test('draft rewrite and repair return a complete replacement candidate', () => {
  for (const intent of ['draft', 'rewrite', 'repair']) {
    assert.equal(composeGenerationCandidate({ intent, original: '旧稿', generated: '新稿', cursorOffset: 1 }), '新稿')
  }
})
