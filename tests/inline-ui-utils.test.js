import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  composeInlineManuscriptCandidate,
  creativeRoutePresentation,
  draftDigest,
  projectExecutionMode,
} from '../src/utils/inline-creative.js'

test('renderer draft digests are stable and project execution defaults safely', () => {
  assert.equal(draftDigest({ b: 2, a: 1 }), draftDigest({ a: 1, b: 2 }))
  assert.notEqual(draftDigest({ a: 1 }), draftDigest({ a: 2 }))
  assert.equal(projectExecutionMode({ default_execution_mode: 'codex' }), 'codex')
  assert.equal(projectExecutionMode({ default_execution_mode: 'other' }), 'app_model')
})

test('current route presentation follows the project default before task-model routing', () => {
  assert.deepEqual(creativeRoutePresentation({
    project: { default_execution_mode: 'codex' },
    taskModelName: '小米 MiMo',
    taskModelDetail: 'mimo · API Key 已配置',
  }), {
    mode: 'codex',
    name: 'Codex',
    detail: 'Agent · ACP 优先 · exec 回退',
    fallbackName: '小米 MiMo',
  })
  assert.deepEqual(creativeRoutePresentation({
    project: { default_execution_mode: 'app_model' },
    taskModelName: '小米 MiMo',
    taskModelDetail: 'mimo · API Key 已配置',
  }), {
    mode: 'app_model',
    name: '小米 MiMo',
    detail: 'mimo · API Key 已配置',
    fallbackName: '',
  })
})

test('inline manuscript preview composes continue and selection candidates exactly like acceptance', () => {
  assert.equal(composeInlineManuscriptCandidate({
    source: '甲乙丙丁', artifactType: 'manuscript', payload: { manuscript: '新增' },
    action: { intent: 'continue', target: { cursorOffset: 2 } },
  }), '甲乙新增丙丁')
  assert.equal(composeInlineManuscriptCandidate({
    source: '甲乙丙丁', artifactType: 'manuscript_selection', payload: { text: '替换' },
    action: { intent: 'rewrite', target: { selectionFrom: 1, selectionTo: 3 } },
  }), '甲替换丁')
  assert.equal(composeInlineManuscriptCandidate({
    source: '旧稿', artifactType: 'manuscript', payload: { manuscript: '完整新稿' },
    action: { intent: 'repair', target: {} },
  }), '完整新稿')
})
