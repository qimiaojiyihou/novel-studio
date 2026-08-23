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

test('moving a chapter keeps linked story arc beats in the same volume', () => {
  const { database, repository } = testRepository()
  const workspace = repository.createProject({ title: '情节节点归卷测试' })
  const projectId = workspace.project.id
  const chapterId = workspace.chapters[0].id
  const timestamp = '2026-08-20T11:00:00.000Z'
  database.prepare(`
    INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
    VALUES ('volume-sync', ?, 'volume', '第一卷', 1, '{}', ?, ?)
  `).run(projectId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO story_arcs (id, project_id, title, category, premise, destination, status, color_key, position, created_at, updated_at)
    VALUES ('arc-sync', ?, '主线', 'main', '', '', 'planned', 'copper', 1, ?, ?)
  `).run(projectId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO story_arc_beats (id, arc_id, volume_id, chapter_id, label, change_text, position, created_at, updated_at)
    VALUES ('beat-sync', 'arc-sync', NULL, ?, '开端', '', 1, ?, ?)
  `).run(chapterId, timestamp, timestamp)

  repository.updateChapter({ id: chapterId, card: { volumeId: 'volume-sync', goal: '进入主线' } })
  assert.equal(database.prepare("SELECT volume_id FROM story_arc_beats WHERE id = 'beat-sync'").get().volume_id, 'volume-sync')
  repository.updateChapter({ id: chapterId, card: { goal: '仍在推进' } })
  assert.equal(database.prepare("SELECT volume_id FROM story_arc_beats WHERE id = 'beat-sync'").get().volume_id, null)
  assert.throws(() => repository.updateChapter({ id: chapterId, card: { volumeId: 'missing-volume' } }), /当前项目/)
  database.close()
})

test('projects can be edited, archived, restored and deleted without losing the active workspace', () => {
  const { database, repository } = testRepository()
  const first = repository.createProject({ title: '第一本书', genre: '悬疑' })
  const second = repository.createProject({ title: '第二本书' })

  const renamed = repository.updateProject({ id: first.project.id, title: '改名后的第一本书', idea: '新的核心想法' })
  assert.equal(renamed.title, '改名后的第一本书')

  const afterArchive = repository.archiveProject(second.project.id)
  assert.equal(afterArchive.project.id, first.project.id)
  assert.equal(repository.listProjects().find((project) => project.id === second.project.id).archived, true)
  assert.throws(() => repository.setActiveProject(second.project.id), /先恢复/)
  assert.throws(() => repository.archiveProject(first.project.id), /至少保留一个未归档项目/)

  repository.restoreProject(second.project.id)
  assert.equal(repository.listProjects().find((project) => project.id === second.project.id).archived, false)
  repository.deleteProject(second.project.id)
  assert.equal(repository.listProjects().length, 1)
  assert.equal(repository.loadWorkspace().project.id, first.project.id)
  assert.throws(() => repository.deleteProject(first.project.id), /至少保留一个未归档项目/)
  database.close()
})

test('deleting the active project selects another available workspace', () => {
  const { database, repository } = testRepository()
  const first = repository.createProject({ title: '保留项目' })
  const active = repository.createProject({ title: '待删除项目' })
  assert.equal(repository.activeProjectId(), active.project.id)

  const loaded = repository.deleteProject(active.project.id)
  assert.equal(loaded.project.id, first.project.id)
  assert.equal(repository.activeProjectId(), first.project.id)
  assert.equal(repository.listProjects().length, 1)
  database.close()
})

test('chapters can be planned from a template, reordered, duplicated and deleted', () => {
  const { database, repository } = testRepository()
  const workspace = repository.createProject({ title: '章节管理测试' })
  const first = workspace.chapters[0]
  repository.updateChapter({
    id: first.id,
    manuscript: '第一章正文',
    scenePlan: '场景计划',
    card: { goal: '取得邀请函' },
  })
  const second = repository.createChapter({
    projectId: workspace.project.id,
    title: '承接规划',
    mode: 'copy-plan',
    sourceChapterId: first.id,
  })
  assert.equal(second.card.goal, '取得邀请函')
  assert.equal(second.scene_plan, '场景计划')
  assert.equal(second.manuscript, '')
  assert.equal(repository.updateChapter({ id: second.id, title: '   ' }).title, '第 2 章')

  const third = repository.createChapter({ projectId: workspace.project.id, title: '第三章' })
  const reordered = repository.reorderChapters({
    projectId: workspace.project.id,
    chapterIds: [third.id, first.id, second.id],
  })
  assert.deepEqual(reordered.map((chapter) => [chapter.chapter_no, chapter.id]), [[1, third.id], [2, first.id], [3, second.id]])
  assert.throws(() => repository.reorderChapters({ projectId: workspace.project.id, chapterIds: [first.id] }), /排序列表/)

  const duplicated = repository.duplicateChapter(first.id)
  assert.equal(duplicated.chapter.manuscript, '第一章正文')
  assert.equal(duplicated.chapter.card.goal, '取得邀请函')
  assert.deepEqual(duplicated.chapters.map((chapter) => chapter.chapter_no), [1, 2, 3, 4])
  assert.equal(duplicated.chapters[2].id, duplicated.chapter.id)

  repository.createRevision({ chapterId: duplicated.chapter.id, content: '副本版本' })
  database.prepare(`
    INSERT INTO style_profiles VALUES ('style-chapter', ?, 'chapter', ?, '章节文风', '{}', '短句', ?, ?)
  `).run(workspace.project.id, duplicated.chapter.id, '2026-08-20', '2026-08-20')
  database.prepare(`
    INSERT INTO prompt_bindings VALUES ('binding-chapter', ?, 'chapter', ?, 'chapter', 'builtin-chapter-v1', 1, 1, ?, ?)
  `).run(workspace.project.id, duplicated.chapter.id, '2026-08-20', '2026-08-20')
  const afterDelete = repository.deleteChapter(duplicated.chapter.id)
  assert.deepEqual(afterDelete.chapters.map((chapter) => chapter.chapter_no), [1, 2, 3])
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM revisions WHERE chapter_id = ?').get(duplicated.chapter.id).count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM style_profiles WHERE scope_id = ?').get(duplicated.chapter.id).count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM prompt_bindings WHERE scope_id = ?').get(duplicated.chapter.id).count, 0)

  repository.deleteChapter(third.id)
  repository.deleteChapter(second.id)
  assert.throws(() => repository.deleteChapter(first.id), /至少保留一个章节/)
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
