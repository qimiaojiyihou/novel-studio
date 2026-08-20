import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'

function testRepository() {
  const database = new DatabaseSync(':memory:')
  let clock = 0
  let sequence = 0
  const now = () => `2026-08-20T10:00:${String(clock++).padStart(2, '0')}.000Z`
  runMigrations(database, { now })
  const repository = createWorkspaceRepository(database, {
    now,
    createId: (prefix) => `${prefix}-${++sequence}`,
  })
  return { database, repository }
}

test('projects are independently created, listed and persisted as active', () => {
  const { database, repository } = testRepository()
  const first = repository.createProject({ title: '第一本书', genre: '悬疑' })
  assert.equal(first.project.title, '第一本书')
  assert.equal(first.chapters.length, 1)
  assert.equal(first.chapters[0].chapter_no, 1)

  const second = repository.createProject({ title: '第二本书', idea: '新的故事' })
  assert.equal(second.project.title, '第二本书')
  assert.equal(repository.loadWorkspace().project.id, second.project.id)
  assert.equal(repository.listProjects().length, 2)

  const reopened = createWorkspaceRepository(database)
  assert.equal(reopened.loadWorkspace().project.id, second.project.id)
  database.close()
})

test('chapter numbering is sequential inside each project', () => {
  const { database, repository } = testRepository()
  const first = repository.createProject({ title: '长篇 A' })
  const secondChapter = repository.createChapter({ projectId: first.project.id, title: '真正的第二章' })
  const thirdChapter = repository.createChapter({ projectId: first.project.id })
  const second = repository.createProject({ title: '长篇 B' })

  assert.equal(secondChapter.chapter_no, 2)
  assert.equal(secondChapter.title, '真正的第二章')
  assert.equal(thirdChapter.chapter_no, 3)
  assert.equal(second.chapters[0].chapter_no, 1)
  assert.equal(repository.loadWorkspace(first.project.id).chapters.length, 3)
  database.close()
})

test('restoring a revision atomically preserves the current manuscript', () => {
  const { database, repository } = testRepository()
  const workspace = repository.createProject({ title: '版本测试' })
  const chapterId = workspace.chapters[0].id

  repository.updateChapter({ id: chapterId, manuscript: '第一版正文' })
  const first = repository.createRevision({ chapterId, content: '第一版正文', source: 'manual-save' })
  repository.updateChapter({ id: chapterId, manuscript: '第二版正文' })
  repository.createRevision({ chapterId, content: '第二版正文', source: 'manual-save' })
  repository.updateChapter({ id: chapterId, manuscript: '尚未进入历史的当前正文' })

  const restored = repository.restoreRevision({ chapterId, revisionId: first.id })
  assert.equal(restored.chapter.manuscript, '第一版正文')
  assert.ok(restored.preservedRevisionId)

  const revisions = repository.listRevisions(chapterId)
  const preserved = revisions.find((revision) => revision.id === restored.preservedRevisionId)
  assert.equal(preserved.content, '尚未进入历史的当前正文')
  assert.equal(preserved.source, 'before-version-restore')

  repository.restoreRevision({ chapterId, revisionId: restored.preservedRevisionId })
  assert.equal(repository.loadWorkspace(workspace.project.id).chapters[0].manuscript, '尚未进入历史的当前正文')
  database.close()
})

test('a revision from another chapter cannot be restored', () => {
  const { database, repository } = testRepository()
  const workspace = repository.createProject({ title: '归属测试' })
  const chapterOne = workspace.chapters[0]
  const chapterTwo = repository.createChapter({ projectId: workspace.project.id })
  const revision = repository.createRevision({ chapterId: chapterOne.id, content: '第一章版本' })

  assert.throws(
    () => repository.restoreRevision({ chapterId: chapterTwo.id, revisionId: revision.id }),
    /不属于当前章节/,
  )
  database.close()
})
