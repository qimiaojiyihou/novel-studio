import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createContextRepository } from '../electron/context-repository.js'

function setup() {
  const database = new DatabaseSync(':memory:')
  let tick = 0
  const now = () => `2026-08-22T10:${String(tick++).padStart(2, '0')}:00.000Z`
  runMigrations(database, { now })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('project-1', '钥匙与旧车站', '都市悬疑', '主角寻找蓝色钥匙背后的原作者', '克制、具体', now(), now())
  const insertChapter = database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, 'project-1', ?, ?, 'draft', ?, ?, ?, ?)
  `)
  insertChapter.run('chapter-1', 1, '蓝色钥匙', JSON.stringify({ goal: '主角在储物柜拿到蓝色钥匙', ending: '钥匙刻着旧车站编号' }), '储物柜开启', '他把蓝色钥匙藏进外套内袋。', now())
  insertChapter.run('chapter-2', 2, '雨夜采访', JSON.stringify({ goal: '完成一场采访' }), '雨棚下谈判', '雨一直下，采访对象提前离开。', now())
  insertChapter.run('chapter-3', 3, '合同陷阱', JSON.stringify({ goal: '识破合同条款' }), '办公室审阅', '他没有签字。', now())
  insertChapter.run('chapter-4', 4, '车站来信', JSON.stringify({ goal: '收到匿名来信' }), '信件改变路线', '来信要求他午夜去旧车站。', now())
  insertChapter.run('chapter-5', 5, '午夜门锁', JSON.stringify({ goal: '用蓝色钥匙打开旧车站的门' }), '门外有人阻拦', '他站在门前，摸到外套里的钥匙。', now())
  database.prepare(`
    INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
    VALUES ('project-1', 'foundation', ?, ?, ?)
  `).run(JSON.stringify({ premise: '一把蓝色钥匙连接作者失踪案' }), now(), now())
  database.prepare(`
    INSERT INTO knowledge_items (id, project_id, kind, title, content_json, source_type, source_id, status, position, created_at, updated_at)
    VALUES (?, 'project-1', 'fact', ?, ?, 'manual', '', 'open', 1, ?, ?)
  `).run('knowledge-key', '钥匙规则', JSON.stringify({ statement: '蓝色钥匙只能在午夜使用' }), now(), now())
  database.prepare(`
    INSERT INTO continuity_checks (id, project_id, chapter_id, kind, severity, title, detail, source_json, origin, status, created_at, updated_at, resolved_at)
    VALUES (?, 'project-1', 'chapter-5', 'key-conflict', 'warning', ?, ?, '{}', 'system', 'open', ?, ?, '')
  `).run('check-key', '钥匙去向待核对', '确认蓝色钥匙是否仍在主角外套内袋。', now(), now())
  const repository = createContextRepository(database, { now })
  return { database, repository, now }
}

test('context manager builds and incrementally refreshes deterministic chapter memories', () => {
  const { database, repository, now } = setup()
  const initial = repository.loadContextManager('project-1')
  assert.equal(initial.profile.maxContextChars, 32000)
  assert.equal(initial.stats.memoryCount, 5)
  assert.match(initial.memories[0].summary, /蓝色钥匙/)
  const firstUpdatedAt = initial.memories[0].updatedAt

  const unchanged = repository.loadContextManager('project-1')
  assert.equal(unchanged.memories[0].updatedAt, firstUpdatedAt)
  database.prepare('UPDATE chapters SET manuscript = ?, updated_at = ? WHERE id = ?').run('钥匙被交给了周岚。', now(), 'chapter-1')
  const refreshed = repository.loadContextManager('project-1')
  assert.notEqual(refreshed.memories[0].updatedAt, firstUpdatedAt)
  assert.match(refreshed.memories[0].summary, /交给了周岚/)
  database.close()
})

test('generation context keeps recent chapters and recalls relevant older chapters and knowledge', () => {
  const { database, repository } = setup()
  repository.updateContextProfile({
    projectId: 'project-1',
    maxContextChars: 12000,
    recentChapterCount: 1,
    relevantChapterCount: 2,
    knowledgeLimit: 4,
    chapterSummaryChars: 700,
  })
  const context = repository.buildGenerationContext({
    projectId: 'project-1',
    chapterId: 'chapter-5',
    instruction: '延续蓝色钥匙在午夜才能使用的规则',
  })
  assert.ok(context.text.length <= 12000)
  assert.deepEqual(context.diagnostics.recentChapterIds, ['chapter-4'])
  assert.ok(context.diagnostics.relevantChapterIds.includes('chapter-1'))
  assert.ok(context.diagnostics.knowledgeItemIds.includes('knowledge-key'))
  assert.ok(context.diagnostics.knowledgeItemIds.includes('check-key'))
  assert.match(context.text, /最近章节记忆/)
  assert.match(context.text, /相关旧章召回/)
  assert.match(context.text, /蓝色钥匙只能在午夜使用/)
  assert.match(context.text, /钥匙去向待核对/)
  database.close()
})

test('context budget is enforced and project deletion cascades profiles and memories', () => {
  const { database, repository } = setup()
  database.prepare(`
    INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
    VALUES ('project-1', 'world', ?, '2026-08-22', '2026-08-22')
  `).run(JSON.stringify({ hardRules: '规则'.repeat(9000) }))
  repository.updateContextProfile({ projectId: 'project-1', maxContextChars: 8000 })
  const context = repository.buildGenerationContext({ projectId: 'project-1', chapterId: 'chapter-5' })
  assert.ok(context.text.length <= 8000)
  assert.equal(context.diagnostics.truncated, true)
  assert.equal(context.diagnostics.budgetChars, 8000)
  assert.match(context.text, /最近章节记忆/)

  database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM context_profiles').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chapter_memories').get().count, 0)
  database.close()
})
