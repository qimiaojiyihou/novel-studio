import test from 'node:test'
import assert from 'node:assert/strict'
import { formatManuscript } from '../src/utils/manuscript-formatting.js'

test('去除段间空行但保留段落换行', () => {
  const result = formatManuscript('第一段。\n\n第二段。\n \n第三段。', 'remove-blank-lines')
  assert.equal(result.text, '第一段。\n第二段。\n第三段。')
  assert.equal(result.changed, true)
})

test('段间留一空行会统一混合空行', () => {
  const result = formatManuscript('第一段。\n第二段。\n\n\n第三段。', 'single-blank-line')
  assert.equal(result.text, '第一段。\n\n第二段。\n\n第三段。')
})

test('段首缩进使用两个全角空格且不累加旧缩进', () => {
  const result = formatManuscript('第一段。\n  第二段。\n\n　　第三段。', 'indent-two')
  assert.equal(result.text, '　　第一段。\n　　第二段。\n\n　　第三段。')
})

test('清除段首缩进和行尾空格', () => {
  assert.equal(formatManuscript('　　第一段。\n\t第二段。', 'remove-indent').text, '第一段。\n第二段。')
  assert.equal(formatManuscript('第一段。  \n第二段。　', 'trim-line-ends').text, '第一段。\n第二段。')
})

test('未知排版方式会明确报错', () => {
  assert.throws(() => formatManuscript('正文', 'unknown'), /不支持/)
})
