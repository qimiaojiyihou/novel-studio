import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { chapterChineseCount, chapterSummary } from '../src/utils/chapter-catalog.js'
import { countChinese } from '../src/services/format.js'

test('existing books gain Chinese counts without loading other manuscripts into the catalog', () => {
  const db = new DatabaseSync(':memory:')
  try {
    runMigrations(db, { targetVersion: 37 })
    const repo = createWorkspaceRepository(db)
    const book = repo.createProject({ title: '字数验证' })
    const text = '正文，上山。\nABC 123，㐀𠀀😀'
    repo.updateChapter({ id: book.chapters[0].id, manuscript: text })
    const second = repo.createChapter({ projectId: book.project.id, title: '空章' })
    runMigrations(db)
    runMigrations(db)
    const catalog = repo.loadWorkspaceCatalog(book.project.id).chapters
    assert.equal(catalog[0].chineseCount, countChinese(text))
    assert.equal(catalog.find(chapter => chapter.id === second.id).chineseCount, 0)
    assert.equal(catalog.filter(chapter => 'manuscript' in chapter).length, 1)
    assert.equal(db.prepare('SELECT chinese_count FROM chapter_statistics WHERE chapter_id=?').get(catalog[0].id).chinese_count, countChinese(text))

    // A different writer (for example a dedicated agent) also invalidates counts.
    db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('新的正文。', second.id)
    assert.equal(db.prepare('SELECT chinese_count FROM chapter_statistics WHERE chapter_id=?').get(second.id).chinese_count, null)
    const refreshed = repo.loadWorkspaceCatalog(book.project.id).chapters.find(chapter => chapter.id === second.id)
    assert.equal(refreshed.chineseCount, 4)
    assert.equal('manuscript' in refreshed, false)
    db.exec('BEGIN')
    db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('回滚', second.id)
    db.exec('ROLLBACK')
    assert.equal(repo.loadWorkspaceCatalog(book.project.id).chapters.find(chapter => chapter.id === second.id).chineseCount, 4)
  } finally { db.close() }
})

test('evicting chapter details preserves the same count as the editor, including empty text', () => {
  const chapter = { id: 'one', manuscript: '中文 ABC，123\n㐀😀', chineseCount: 999 }
  assert.equal(chapterChineseCount(chapter), countChinese(chapter.manuscript))
  const summary = chapterSummary(chapter)
  assert.equal('manuscript' in summary, false)
  assert.equal(chapterChineseCount(summary), countChinese(chapter.manuscript))
  assert.equal(chapterChineseCount({ manuscript: '', chineseCount: 999 }), 0)
})
