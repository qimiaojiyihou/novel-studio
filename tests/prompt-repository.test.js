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
  assert.equal(context.template.version, 20)
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
    request: { task: 'chapter', projectId: 'project-1', chapterId: 'chapter-1', instruction: '保持克制' },
    promptSnapshot: { template: { id: promptContext.template.id, version: 1 }, promptHash: 'hash' },
    intent: 'continue',
  })
  assert.equal(record.status, 'pending')
  const completed = repository.finishGenerationRecord({
    id: record.id, status: 'completed', parameters: { temperature: 0.7 }, output: '正文候选', attemptCount: 2,
    events: [{ type: 'retrying', attempt: 1 }],
  })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.parameters.temperature, 0.7)
  assert.equal(completed.output, '正文候选')
  assert.equal(completed.promptSnapshot.promptHash, 'hash')
  assert.equal(completed.request.instruction, '保持克制')
  assert.equal(completed.attemptCount, 2)
  assert.equal(completed.events[0].type, 'retrying')
  assert.equal(completed.intent, 'continue')
  const repair = repository.startGenerationRecord({
    taskId: 'task-repair', projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter',
    promptSnapshot: { template: { id: promptContext.template.id, version: 3 } }, intent: 'repair', parentGenerationId: record.id,
  })
  assert.equal(repair.parentGenerationId, record.id)
  assert.equal(repair.intent, 'repair')
  assert.deepEqual(new Set(repository.listGenerationRecords({ projectId: 'project-1' }).map((item) => item.id)), new Set([record.id, repair.id]))

  database.prepare("DELETE FROM projects WHERE id = 'project-1'").run()
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM generation_records').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM style_profiles').get().count, 0)
  database.close()
})

test('custom templates create immutable versions and bind to a selected scope', () => {
  const { database, repository } = setup()
  const first = repository.savePromptTemplate({
    task: 'chapter', name: '紧凑正文',
    content: { system: '遵守既有事实。', request: '生成紧凑正文。', outputContract: '正文必须完整。' },
  })
  assert.equal(first.kind, 'user')
  assert.equal(first.version, 1)
  const second = repository.savePromptTemplate({
    id: first.id, task: 'chapter', name: '紧凑正文',
    content: { system: '遵守既有事实。', request: '生成更紧凑的正文。', outputContract: '正文必须完整。' },
  })
  assert.equal(second.version, 2)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM prompt_template_versions WHERE template_id = ?').get(first.id).count, 2)
  repository.bindPromptTemplate({ projectId: 'project-1', scopeType: 'chapter', scopeId: 'chapter-1', task: 'chapter', templateId: first.id })
  const context = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.equal(context.template.id, first.id)
  assert.equal(context.template.version, 2)
  assert.equal(context.template.content.request, '生成更紧凑的正文。')
  database.close()
})

test('structured styles persist while canonical free text stays in project volume and chapter records', () => {
  const { database, repository } = setup()
  repository.saveStyleProfile({ projectId: 'project-1', scopeType: 'project', scopeId: 'project-1', text: '项目新文风', style: { pointOfView: '第三人称限知' } })
  repository.saveStyleProfile({ projectId: 'project-1', scopeType: 'volume', scopeId: 'volume-1', text: '卷级慢燃', style: { pacing: '慢燃' } })
  repository.saveStyleProfile({ projectId: 'project-1', scopeType: 'chapter', scopeId: 'chapter-1', text: '本章短句', style: { sentenceRhythm: '短促' } })
  const context = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.equal(database.prepare("SELECT style FROM projects WHERE id = 'project-1'").get().style, '项目新文风')
  assert.equal(JSON.parse(database.prepare("SELECT data_json FROM planning_entities WHERE id = 'volume-1'").get().data_json).volumeStyle, '卷级慢燃')
  assert.equal(JSON.parse(database.prepare("SELECT card_json FROM chapters WHERE id = 'chapter-1'").get().card_json).chapterStyle, '本章短句')
  assert.deepEqual(context.style.mergedStyle, { pointOfView: '第三人称限知', pacing: '慢燃', sentenceRhythm: '短促' })
  database.close()
})

test('prompt add-ons resolve by task and project-volume-chapter order', () => {
  const { database, repository } = setup()
  repository.setPromptAddonBinding({ projectId: 'project-1', scopeType: 'chapter', scopeId: 'chapter-1', task: 'chapter', addonId: 'addon-ending-action', enabled: true, priority: 2 })
  repository.setPromptAddonBinding({ projectId: 'project-1', scopeType: 'project', scopeId: 'project-1', task: 'chapter', addonId: 'addon-dialogue-subtext', enabled: true, priority: 1 })
  repository.setPromptAddonBinding({ projectId: 'project-1', scopeType: 'volume', scopeId: 'volume-1', task: '*', addonId: 'addon-goal-obstacle-change', enabled: true, priority: 1 })
  const context = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' })
  assert.deepEqual(context.addons.map((item) => item.id), ['addon-dialogue-subtext', 'addon-goal-obstacle-change', 'addon-ending-action'])
  const planning = repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'planning_field' })
  assert.deepEqual(planning.addons.map((item) => item.id), ['addon-goal-obstacle-change'])
  repository.setPromptAddonBinding({ projectId: 'project-1', scopeType: 'chapter', scopeId: 'chapter-1', task: 'chapter', addonId: 'addon-ending-action', enabled: false })
  assert.deepEqual(repository.resolvePromptContext({ projectId: 'project-1', chapterId: 'chapter-1', task: 'chapter' }).addons.map((item) => item.id), ['addon-dialogue-subtext', 'addon-goal-obstacle-change'])
  database.close()
})
