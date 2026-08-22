import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createPromptRepository } from '../electron/prompt-repository.js'

function setup() {
  const database = new DatabaseSync(':memory:')
  let tick = 0
  const now = () => `2026-08-23T12:${String(tick++).padStart(2, '0')}:00.000Z`
  let id = 0
  runMigrations(database, { now })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES ('project-1', '旧车站', '都市悬疑', '钥匙改写现实', '项目克制文风', ?, ?)
  `).run(now(), now())
  database.prepare(`
    INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
    VALUES ('volume-1', 'project-1', 'volume', '第一卷', 1, ?, ?, ?)
  `).run(JSON.stringify({ volumeStyle: '卷级压迫感' }), now(), now())
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '午夜站台', 'draft', ?, '', '', ?)
  `).run(JSON.stringify({ volumeId: 'volume-1', chapterStyle: '章节增加对白' }), now())
  database.prepare(`
    INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at, settings_json)
    VALUES ('model-1', 'custom', '测试模型', 'http://model.test/v1', 'novel', '', 1, ?, ?, '{}')
  `).run(now(), now())
  const repository = createPromptRepository(database, { now, createId: (prefix) => `${prefix}-${++id}` })
  return { database, repository, now }
}

test('prompt repository resolves built-in template and project-volume-chapter style chain', () => {
  const { database, repository } = setup()
  const context = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.equal(context.template.id, 'builtin-chapter-v1')
  assert.equal(context.template.version, 1)
  assert.equal(context.style.volume.id, 'volume-1')
  assert.deepEqual(context.style.sources.map((source) => source.scopeType), ['project', 'volume', 'chapter'])
  assert.equal(context.style.mergedText, '项目克制文风\n卷级压迫感\n章节增加对白')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM style_profiles').get().count, 3)

  const volumeContext = repository.resolvePromptContext({ projectId: 'project-1', volumeId: 'volume-1', task: 'planning_field' })
  assert.deepEqual(volumeContext.style.sources.map((source) => source.scopeType), ['project', 'volume'])
  const projectContext = repository.resolvePromptContext({ projectId: 'project-1', task: 'planning_field' })
  assert.deepEqual(projectContext.style.sources.map((source) => source.scopeType), ['project'])

  database.prepare("UPDATE projects SET style = '项目新文风' WHERE id = 'project-1'").run()
  const refreshed = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.equal(refreshed.style.sources[0].text, '项目新文风')
  database.close()
})

test('chapter prompt binding overrides global task template by scope', () => {
  const { database, repository, now } = setup()
  database.prepare(`
    INSERT INTO prompt_templates VALUES ('custom-chapter', 'chapter', '项目正文模板', 'user', 1, 2, ?, ?)
  `).run(now(), now())
  database.prepare(`
    INSERT INTO prompt_template_versions VALUES ('custom-chapter-v2', 'custom-chapter', 2, ?, ?)
  `).run(JSON.stringify({ system: '项目系统提示', request: '写当前章节', outputContract: '只返回正文' }), now())
  database.prepare(`
    INSERT INTO prompt_bindings VALUES ('chapter-binding', 'project-1', 'chapter', 'chapter-1', 'chapter', 'custom-chapter', 1, 10, ?, ?)
  `).run(now(), now())
  const context = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.equal(context.template.id, 'custom-chapter')
  assert.equal(context.template.version, 2)
  assert.equal(context.template.content.system, '项目系统提示')
  database.close()
})

test('generation records preserve prompt snapshot, request parameters and terminal state', () => {
  const { database, repository } = setup()
  const promptContext = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  const record = repository.startGenerationRecord({
    taskId: 'task-1', projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter',
    modelProfileId: 'model-1', model: { name: '测试模型' },
    promptSnapshot: { template: { id: promptContext.template.id, version: 1 }, promptHash: 'hash' },
  })
  assert.equal(record.status, 'pending')
  const completed = repository.finishGenerationRecord({
    id: record.id, status: 'completed', parameters: { temperature: 0.7 }, output: '正文候选',
  })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.parameters.temperature, 0.7)
  assert.equal(completed.output, '正文候选')
  assert.equal(completed.promptSnapshot.promptHash, 'hash')

  database.prepare("DELETE FROM projects WHERE id = 'project-1'").run()
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM generation_records').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM style_profiles').get().count, 0)
  database.close()
})
