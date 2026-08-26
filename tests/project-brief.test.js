import assert from 'node:assert/strict'
import test from 'node:test'
import { buildIdeaSentence, GENRE_OPTIONS, STYLE_PRESETS } from '../src/utils/project-brief.js'

test('project brief exposes distinct selectable genres and executable style presets', () => {
  assert.ok(GENRE_OPTIONS.includes('都市悬疑'))
  assert.ok(GENRE_OPTIONS.includes('文娱'))
  assert.equal(new Set(GENRE_OPTIONS).size, GENRE_OPTIONS.length)
  assert.equal(new Set(STYLE_PRESETS.map((preset) => preset.id)).size, STYLE_PRESETS.length)
  assert.ok(STYLE_PRESETS.every((preset) => preset.label && preset.description && preset.text.length > 20))
})

test('idea sentence builder joins plain-language fragments without duplicate prefixes', () => {
  assert.equal(buildIdeaSentence({
    protagonist: '一名失去记忆的记者',
    incitingEvent: '收到一封来自三天后的信',
    goal: '找出下一名死者',
    stakes: '他会成为唯一嫌疑人',
  }), '一名失去记忆的记者，收到一封来自三天后的信，必须找出下一名死者，否则他会成为唯一嫌疑人。')

  assert.equal(buildIdeaSentence({ goal: '必须查明真相', stakes: '否则案件永远沉底。' }), '必须查明真相，否则案件永远沉底。')
  assert.equal(buildIdeaSentence(), '')
})
