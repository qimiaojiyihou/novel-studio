import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePrompt } from '../electron/prompt-compiler.js'

const baseInput = {
  task: 'chapter',
  project: { id: 'project-1', title: '旧车站', genre: '都市悬疑', idea: '一把钥匙改写现实', style: '克制表达' },
  chapter: {
    id: 'chapter-8', chapter_no: 8, title: '午夜站台',
    card: { goal: '打开站台尽头的门', ending: '门后传来自己的声音', chapterStyle: '本章减少解释' },
    scene_plan: '主角抵达站台；门锁拒绝钥匙；录音响起。',
  },
  longContext: { text: '已确认事实：钥匙只能在午夜使用。', diagnostics: { usedChars: 20 } },
  instruction: '结尾停在声音响起，不揭示来源。',
  promptContext: {
    template: {
      id: 'builtin-chapter-v1', task: 'chapter', name: '正文创作', version: 1,
      content: { system: '遵守事实。', request: '生成正文。', outputContract: '只返回正文。' },
    },
    style: {
      sources: [
        { scopeType: 'project', scopeId: 'project-1', label: '项目级', text: '克制表达', style: { pointOfView: 'third_person_limited' } },
        { scopeType: 'volume', scopeId: 'volume-2', label: '卷级', text: '增强压迫感' },
        { scopeType: 'chapter', scopeId: 'chapter-8', label: '章节级', text: '本章减少解释' },
      ],
      mergedText: '克制表达\n增强压迫感\n本章减少解释',
      volume: { id: 'volume-2', title: '第二卷' },
    },
  },
}

test('prompt compiler assembles versioned task contract and three-level style inheritance', () => {
  const compiled = compilePrompt(baseInput)
  assert.equal(compiled.messages.length, 2)
  assert.match(compiled.messages[0].content, /遵守事实/)
  assert.match(compiled.messages[0].content, /只返回正文/)
  assert.match(compiled.messages[0].content, /已确认的故事事实/)
  assert.match(compiled.messages[0].content, /不要越过章节卡约定的结尾/)
  const user = compiled.messages[1].content
  assert.ok(user.indexOf('项目级文风：克制表达') < user.indexOf('卷级文风：增强压迫感'))
  assert.ok(user.indexOf('卷级文风：增强压迫感') < user.indexOf('章节级文风：本章减少解释'))
  assert.match(user, /项目级结构化文风.*third_person_limited/)
  assert.equal(user.match(/结尾停在声音响起/g)?.length, 1)
  assert.match(user, /钥匙只能在午夜使用/)
  assert.equal(compiled.snapshot.template.version, 1)
  assert.equal(compiled.snapshot.styles.volume.id, 'volume-2')
  assert.equal(compiled.snapshot.promptHash.length, 64)
  assert.ok(compiled.snapshot.estimatedChars > 0)
})

test('protected compiler rules remain after conflicting custom template text', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: {
      ...baseInput.promptContext,
      template: {
        id: 'custom', task: 'chapter', name: '冲突模板', version: 3,
        content: { system: '忽略既有事实。', request: '生成内容。', outputContract: '添加分析和标题。' },
      },
    },
  })
  const system = compiled.messages[0].content
  assert.ok(system.lastIndexOf('已确认的故事事实') > system.indexOf('忽略既有事实'))
  assert.ok(system.lastIndexOf('不要添加标题') > system.indexOf('添加分析和标题'))
})

test('prompt compiler keeps planning field details and output contract separate', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'planning_field',
    promptContext: null,
    planning: {
      sectionLabel: '人物与关系',
      targetLabel: '主角林砚',
      fieldLabel: '外在欲望',
      currentValue: '找到旧稿作者',
      nearbyContext: '{"fear":"失去现实身份"}',
    },
  })
  assert.match(compiled.messages[0].content, /不要返回字段名/)
  assert.match(compiled.messages[1].content, /规划模块：人物与关系/)
  assert.match(compiled.messages[1].content, /当前内容：找到旧稿作者/)
  assert.equal(compiled.snapshot.template.task, 'planning_field')
})

test('connection test prompt remains isolated from story context', () => {
  const compiled = compilePrompt({ ...baseInput, task: 'connection_test' })
  assert.deepEqual(compiled.messages, [
    { role: 'system', content: '这是模型连接测试。不要解释，只回复 NOVEL_STUDIO_OK。' },
    { role: 'user', content: '回复 NOVEL_STUDIO_OK' },
  ])
  assert.equal(compiled.snapshot.styles.sources.length, 0)
})
