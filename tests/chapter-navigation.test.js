import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER_PAGE_SIZE, chapterPageIndexFor, chapterPages } from '../src/utils/chapter-navigation.js'

const chapters = Array.from({ length: 327 }, (_, index) => ({
  id: `chapter-${index + 1}`,
  chapter_no: index + 1,
  title: index === 199 ? '旧档案里的回执' : `章节 ${index + 1}`,
}))

test('large chapter catalogs render bounded groups and locate the active chapter', () => {
  const pages = chapterPages(chapters)
  assert.equal(CHAPTER_PAGE_SIZE, 25)
  assert.equal(pages.length, 14)
  assert.equal(pages[7].label, '176–200 章')
  assert.equal(pages[7].chapters.length, 25)
  assert.equal(pages.at(-1).chapters.length, 2)
  assert.deepEqual(pages.flatMap((page) => page.chapters.map((chapter) => chapter.id)), chapters.map((chapter) => chapter.id))
  assert.equal(chapterPageIndexFor(chapters, 'chapter-25'), 0)
  assert.equal(chapterPageIndexFor(chapters, 'chapter-26'), 1)
  assert.equal(chapterPageIndexFor(chapters, 'chapter-200'), 7)
  assert.equal(chapterPageIndexFor(chapters, 'missing'), 0)
})
