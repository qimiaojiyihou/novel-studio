import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codexTaskDisplayTitle } from '../electron/codex-task-label.js'

test('inline Codex tasks use the generated field as the conversation title', () => {
  const title = codexTaskDisplayTitle({
    project: { title: '我一个明星，会亿点手艺很正常吧' },
    planningCenter: {},
    run: { workflowId: 'inline-action' },
    step: {
      task: 'planning_field',
      input: { target: { kind: 'planning_document', targetId: 'foundation', fieldLabel: '目标读者' } },
    },
  })
  assert.equal(title, '目标读者')
  assert.doesNotMatch(title, /^system:/)
})

test('entity field titles retain the entity name when it disambiguates the content', () => {
  const title = codexTaskDisplayTitle({
    project: { title: '我一个明星，会亿点手艺很正常吧' },
    planningCenter: { characters: [{ id: 'character-1', kind: 'character', title: '周砚' }] },
    run: { workflowId: 'inline-action' },
    step: {
      task: 'planning_field',
      input: { target: { kind: 'planning_entity', targetId: 'character-1', fieldLabel: '外在欲望' } },
    },
  })
  assert.equal(title, '周砚 · 外在欲望')
})

test('chapter workflow titles identify the chapter content without repeating the book', () => {
  const title = codexTaskDisplayTitle({
    project: { title: '来信' },
    chapter: { chapter_no: 3, title: '地下室' },
    run: { workflowId: 'chapter-production' },
    step: { task: 'scene_plan', key: 'scenes' },
  })
  assert.equal(title, '第 3 章 · 地下室 · 场景计划')
})

test('default chapter names remain natural conversation titles', () => {
  const title = codexTaskDisplayTitle({
    project: { title: '来信' },
    chapter: { chapter_no: 1, title: '第一章' },
    run: { workflowId: 'inline-action' },
    step: {
      task: 'chapter_card',
      input: { target: { kind: 'chapter_card', fieldLabel: '章节卡' } },
    },
  })
  assert.equal(title, '第一章 · 章节卡')
})
