import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDocxManuscript,
  createMarkdownManuscript,
  createTextManuscript,
  parseManuscript,
} from '../electron/manuscript-formats.js'

const workspace = {
  project: { title: '雾港来信', genre: '都市悬疑', idea: '一封晚到十年的信' },
  chapters: [
    { chapter_no: 2, title: '旧邮局', manuscript: '门锁已经锈死。\n\n林默听见楼上有脚步声。' },
    { chapter_no: 1, title: '雨夜', manuscript: '雨沿着站牌往下淌。\n\n周岚没有赴约。' },
  ],
}

test('TXT manuscript export and import preserve ordered chapter content', () => {
  const text = createTextManuscript(workspace)
  assert.ok(text.startsWith('雾港来信\n\n第 1 章 · 雨夜'))
  const parsed = parseManuscript(text, { format: 'txt', fallbackTitle: '文件名' })
  assert.equal(parsed.title, '雾港来信')
  assert.equal(parsed.chapters.length, 2)
  assert.match(parsed.chapters[0].title, /雨夜/)
  assert.equal(parsed.chapters[1].manuscript, '门锁已经锈死。\n\n林默听见楼上有脚步声。')
})

test('Markdown manuscript export and import preserve title and chapters', () => {
  const markdown = createMarkdownManuscript(workspace)
  assert.match(markdown, /^# 雾港来信/)
  assert.match(markdown, /> 都市悬疑 · 一封晚到十年的信/)
  const parsed = parseManuscript(markdown, { format: 'markdown', fallbackTitle: '文件名' })
  assert.equal(parsed.title, '雾港来信')
  assert.equal(parsed.chapters.length, 2)
  assert.equal(parsed.chapters[0].manuscript, '雨沿着站牌往下淌。\n\n周岚没有赴约。')
})

test('DOCX manuscript is a readable OOXML package and round-trips Chinese prose', () => {
  const docx = createDocxManuscript(workspace, { date: new Date('2026-08-24T00:00:00.000Z') })
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK')
  const parsed = parseManuscript(docx, { format: 'docx', fallbackTitle: '文件名' })
  assert.equal(parsed.title, '雾港来信')
  assert.equal(parsed.chapters.length, 2)
  assert.match(parsed.chapters[0].title, /雨夜/)
  assert.equal(parsed.chapters[1].manuscript, '门锁已经锈死。\n\n林默听见楼上有脚步声。')
})

test('JSON manuscript and project backup are distinguished', () => {
  const manuscript = parseManuscript(JSON.stringify({ project: { title: 'JSON 小说' }, chapters: [{ title: '开场', manuscript: '正文' }] }), { format: 'json' })
  assert.equal(manuscript.title, 'JSON 小说')
  assert.equal(manuscript.chapters[0].manuscript, '正文')
  const backup = { format: 'novel-studio-project', version: 1, data: {} }
  assert.deepEqual(parseManuscript(JSON.stringify(backup), { format: 'json' }).backup, backup)
})

test('invalid Word and unsupported formats fail with useful errors', () => {
  assert.throws(() => parseManuscript(Buffer.from('not-a-docx'), { format: 'docx' }), /Word 文件/)
  assert.throws(() => parseManuscript('content', { format: 'rtf' }), /不支持的导入格式/)
})
