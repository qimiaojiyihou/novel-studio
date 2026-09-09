import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInlineConversation,
  defaultInlineConversationCollapsed,
  inlineConversationReuseNote,
  inlineConversationScope,
} from '../src/utils/inline-conversation.js'

test('inline conversation pairs each author instruction with the candidate created by that step', () => {
  const steps = [
    { id: 'step-1', position: 1, status: 'completed', input: {} },
    { id: 'step-2', position: 2, status: 'completed', input: { revision: { round: 2, instruction: '缩短开头，保留房租压力。', parentCandidateId: 'candidate-1' } } },
  ]
  const candidates = [
    { id: 'candidate-1', stepId: 'step-1', status: 'stale' },
    { id: 'candidate-2', stepId: 'step-2', status: 'pending' },
  ]

  assert.deepEqual(buildInlineConversation({ steps, candidates, runStatus: 'waiting_confirmation' }), [
    {
      id: 'candidate-1:codex', role: 'codex', kind: 'candidate', version: 1,
      candidateId: 'candidate-1', status: 'stale', title: '首版候选',
      text: '已被后续修改替代，可继续查看和比较。',
    },
    {
      id: 'step-2:author', role: 'author', kind: 'instruction', round: 2,
      text: '缩短开头，保留房租压力。', parentCandidateId: 'candidate-1', parentVersion: 1,
    },
    {
      id: 'candidate-2:codex', role: 'codex', kind: 'candidate', version: 2,
      candidateId: 'candidate-2', status: 'pending', title: '第 2 版修改稿',
      text: '已生成，等待你确认。',
    },
  ])
})

test('inline conversation exposes an in-progress reply before the next candidate exists', () => {
  const messages = buildInlineConversation({
    runStatus: 'running',
    steps: [
      { id: 'step-1', position: 1, status: 'completed', input: {} },
      { id: 'step-2', position: 2, status: 'running', input: { revision: { round: 2, instruction: '人物反应再克制一些。', parentCandidateId: 'candidate-1' } } },
    ],
    candidates: [{ id: 'candidate-1', stepId: 'step-1', status: 'stale' }],
  })

  assert.equal(messages.at(-1).kind, 'working')
  assert.equal(messages.at(-1).title, '正在生成第 2 版')
})

test('inline conversation names the real creative scope instead of exposing implementation terms', () => {
  assert.equal(inlineConversationScope({ conversationScope: { kind: 'planning' } }), '本书规划对话')
  assert.equal(inlineConversationScope({ conversationScope: { kind: 'chapter' } }), '本章创作对话')
  assert.equal(inlineConversationScope({ conversationScope: { kind: 'review' } }), '独立审稿')
  assert.equal(inlineConversationScope({ conversationScope: { kind: 'audit' } }), '独立检查')
  assert.equal(inlineConversationScope({ artifactType: 'manuscript_selection' }), '当前选区')
  assert.equal(inlineConversationScope({ artifactType: 'manuscript' }), '当前正文候选')
  assert.equal(inlineConversationScope({ artifactType: 'planning_entity_bundle', fieldLabel: '周砚人物卡' }), '周砚人物卡')
  assert.equal(inlineConversationScope({ artifactType: 'planning_field', fieldLabel: '目标读者' }), '目标读者')
})

test('manuscript conversations start collapsed so the long candidate keeps the viewport', () => {
  assert.equal(defaultInlineConversationCollapsed({ artifactType: 'manuscript' }), true)
  assert.equal(defaultInlineConversationCollapsed({ artifactType: 'manuscript_selection' }), true)
  assert.equal(defaultInlineConversationCollapsed({ artifactType: 'planning_field' }), false)
})

test('conversation reuse notes explain the scoped context boundary', () => {
  assert.match(inlineConversationReuseNote({ conversationScope: { kind: 'planning' } }), /设定与规划.*变化内容/)
  assert.match(inlineConversationReuseNote({ conversationScope: { kind: 'chapter' } }), /切换章节.*隔离/)
  assert.match(inlineConversationReuseNote({ conversationScope: { kind: 'review' } }), /独立上下文/)
})
