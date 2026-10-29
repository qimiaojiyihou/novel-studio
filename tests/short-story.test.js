import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations, getSchemaVersion, LATEST_SCHEMA_VERSION } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createProjectBackup, restoreProjectBackup } from '../electron/project-portability.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { buildCreativeContext, dependencyDigest } from '../electron/creative-context.js'
import { createTextManuscript, createMarkdownManuscript, createDocxManuscript, parseManuscript } from '../electron/manuscript-formats.js'

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  t.after(() => db.close())
  return { db, store: createWorkspaceRepository(db) }
}

test('v36 migration keeps legacy novels, manuscripts and chapter workflows intact', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  runMigrations(db, { targetVersion: 35 })
  const store = createWorkspaceRepository(db)
  // Existing libraries predate work_format, so seed with their original columns.
  db.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES('legacy','原小说','','','','now','now')").run()
  db.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,manuscript,updated_at) VALUES('legacy-body','legacy',1,'第一章','draft','原稿','now')").run()
  runMigrations(db)
  runMigrations(db)
  assert.equal(getSchemaVersion(db), LATEST_SCHEMA_VERSION)
  const loaded = store.loadWorkspace('legacy')
  assert.equal(loaded.project.work_format, 'novel')
  assert.equal(loaded.chapters[0].manuscript, '原稿')
  assert.equal(store.createChapter({ projectId: 'legacy' }).chapter_no, 2)
})

test('short stories create one persistent manuscript, retain revisions and coexist with novels', t => {
  const { db, store } = fixture(t)
  const novel = store.createProject({ title: '长篇' })
  const story = store.createProject({ title: '最后一班车', work_format: 'short_story', target_word_count: 4500 })
  assert.equal(story.project.work_format, 'short_story')
  assert.equal(story.project.target_word_count, 4500)
  assert.equal(story.chapters.length, 1)
  assert.equal(story.chapters[0].title, '正文')
  const id = story.chapters[0].id
  store.updateChapter({ id, manuscript: '司机把车停在河边。' })
  const revision = store.createRevision({ chapterId: id, content: '司机把车停在河边。' })
  store.updateChapter({ id, manuscript: '修订稿。' })
  store.restoreRevision({ chapterId: id, revisionId: revision.id })
  const reopened = createWorkspaceRepository(db).loadWorkspaceCatalog(story.project.id)
  assert.equal(reopened.project.work_format, 'short_story')
  assert.equal(reopened.chapters[0].manuscript, '司机把车停在河边。')
  assert.equal(store.updateProject({ id: story.project.id, target_word_count: 8000 }).target_word_count, 8000)
  assert.equal(store.listProjects().length, 2)
  assert.equal(store.loadWorkspace(novel.project.id).project.work_format, 'novel')
})

test('single-manuscript boundary is enforced for API and direct insert paths', t => {
  const { db, store } = fixture(t)
  const story = store.createProject({ work_format: 'short_story' })
  assert.equal(story.project.target_word_count, 8000)
  assert.equal(story.chapters[0].card.targetLength, 8000)
  assert.throws(() => store.createChapter({ projectId: story.project.id }), /单篇正文/)
  assert.throws(() => store.duplicateChapter(story.chapters[0].id), /单篇正文/)
  assert.throws(() => db.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,updated_at) VALUES('extra',?,2,'第二章','draft','now')").run(story.project.id), /单篇正文/)
  assert.throws(() => store.deleteChapter(story.chapters[0].id), /至少保留/)
  assert.throws(() => store.createProject({ work_format: 'other' }), /作品形式/)
  for (const value of [0, 799, 12001, 'abc', 1800.5]) assert.throws(() => store.createProject({ work_format: 'short_story', target_word_count: value }), /目标字数/)
  assert.equal(store.listProjects().length, 1)
})

test('portable backups restore short-story identity, length and manuscript', t => {
  const { db, store } = fixture(t)
  const story = store.createProject({ title: '雪停之前', work_format: 'short_story', target_word_count: 3000 })
  store.updateChapter({ id: story.chapters[0].id, manuscript: '门口的雪融了。' })
  const backup = createProjectBackup(db, story.project.id)
  const restored = restoreProjectBackup(db, backup)
  const copy = store.loadWorkspace(restored.projectId)
  assert.equal(copy.project.work_format, 'short_story')
  assert.equal(copy.project.target_word_count, 3000)
  assert.equal(copy.chapters.length, 1)
  assert.equal(copy.chapters[0].manuscript, '门口的雪融了。')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('all shared creative tasks receive short-story structure and length without changing novel prompts', t => {
  const { store } = fixture(t)
  const story = store.createProject({ work_format: 'short_story', target_word_count: 4300 })
  for (const task of ['chapter', 'chapter_card', 'scene_plan', 'rewrite', 'planning_field', 'quality_review', 'continuity_audit']) {
    const compiled = compilePrompt({ task, project: story.project, chapter: story.chapters[0] })
    assert.match(compiled.messages[0].content, /作品形式：短故事/)
    assert.match(compiled.messages[0].content, /4300/)
    if (['chapter', 'chapter_card', 'scene_plan'].includes(task)) assert.match(compiled.messages[1].content, /短故事结局边界/)
  }
  const novel = store.createProject({ title: '长篇' })
  assert.doesNotMatch(compilePrompt({ task: 'chapter', project: novel.project, chapter: novel.chapters[0] }).messages.map(m => m.content).join(''), /作品形式：短故事/)
})

test('context reuse invalidates when short-story length changes', t => {
  const { db, store } = fixture(t)
  const story = store.createProject({ work_format: 'short_story', target_word_count: 3000 })
  const context = buildCreativeContext(db, { projectId: story.project.id, chapterId: story.chapters[0].id })
  const key = `project:${story.project.id}:work-format`
  const dependency = context.sources.find(item => item.targetKey === key)
  assert.equal(dependency.digest, dependencyDigest(db, key))
  assert.match(context.text, /3000 中文字/)
  store.updateProject({ id: story.project.id, target_word_count: 5000 })
  assert.notEqual(dependency.digest, dependencyDigest(db, key))
})

test('short-story exports contain a single title and unnumbered body in TXT, Markdown and Word', () => {
  const workspace = { project: { title: '雪停之前', work_format: 'short_story' }, chapters: [{ chapter_no: 1, title: '正文', manuscript: '第一段。\n\n第二段。' }] }
  assert.equal(createTextManuscript(workspace), '雪停之前\n\n第一段。\n\n第二段。\n')
  assert.doesNotMatch(createMarkdownManuscript(workspace), /##|第.?1.?章/)
  const docx = createDocxManuscript(workspace)
  const xml = docx.toString('utf8')
  assert.doesNotMatch(xml, /第1章|<w:pStyle w:val="Heading1"/)
  assert.match(xml, /w:firstLineChars="200"/)
  const imported = parseManuscript(docx, { format: 'docx' })
  assert.equal(imported.title, '雪停之前')
  assert.equal(imported.chapters[0].manuscript, '第一段。\n\n第二段。')
})
