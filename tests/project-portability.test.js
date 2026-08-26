import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import {
  createProjectBackup,
  importManuscriptProject,
  restoreProjectBackup,
  validateProjectBackup,
} from '../electron/project-portability.js'

const NOW = '2026-08-24T12:00:00.000Z'

function createDatabase() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database, { now: () => NOW })
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('project-1', '雾港来信', '都市悬疑', '一封晚到十年的信', '冷峻', NOW, NOW, '')
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('chapter-1', 'project-1', 1, '雨夜', 'draft', JSON.stringify({ volumeId: 'volume-1' }), '', '雨落在站牌上。', NOW)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('chapter-2', 'project-1', 2, '旧邮局', 'draft', '{}', '', '门锁已经锈死。', NOW)
  database.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)').run('revision-1', 'chapter-1', '旧稿', 'manual', NOW)
  database.prepare('INSERT INTO planning_entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('volume-1', 'project-1', 'volume', '第一卷', 1, '{}', NOW, NOW)
  database.prepare('INSERT INTO planning_entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('character-1', 'project-1', 'character', '林默', 1, '{}', NOW, NOW)
  database.prepare('INSERT INTO planning_entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('character-2', 'project-1', 'character', '周岚', 2, '{}', NOW, NOW)
  database.prepare(`INSERT INTO character_relationships
    (id, project_id, from_character_id, to_character_id, label, surface, tension, direction, trend, status, source_type, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', '', 'mutual', 'stable', 'active', 'manual', ?, ?, ?)`)
    .run('relationship-1', 'project-1', 'character-1', 'character-2', '旧搭档', 'character-1', NOW, NOW)
  database.prepare(`INSERT INTO story_arcs
    (id, project_id, title, category, premise, destination, status, color_key, position, created_at, updated_at)
    VALUES (?, ?, ?, 'main', '', '', 'active', 'copper', 1, ?, ?)`)
    .run('arc-1', 'project-1', '失踪来信', NOW, NOW)
  database.prepare(`INSERT INTO story_arc_beats
    (id, arc_id, volume_id, chapter_id, label, change_text, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)`)
    .run('beat-1', 'arc-1', 'volume-1', 'chapter-1', '收到信', NOW, NOW)
  database.prepare("INSERT INTO prompt_templates VALUES (?, 'chapter', ?, 'user', 1, 1, ?, ?)")
    .run('template-user-1', '自定义正文', NOW, NOW)
  database.prepare('INSERT INTO prompt_template_versions VALUES (?, ?, 1, ?, ?)')
    .run('template-version-1', 'template-user-1', '{"system":"保持悬念"}', NOW)
  database.prepare("INSERT INTO prompt_bindings VALUES (?, ?, 'project', ?, 'chapter', ?, 1, 9, ?, ?)")
    .run('binding-1', 'project-1', 'project-1', 'template-user-1', NOW, NOW)
  database.prepare("INSERT INTO prompt_addons VALUES (?, ?, '节奏', 'user', 1, 1, ?, ?)")
    .run('addon-user-1', '结尾推进', NOW, NOW)
  database.prepare('INSERT INTO prompt_addon_versions VALUES (?, ?, 1, ?, ?)')
    .run('addon-version-1', 'addon-user-1', '以动作结束章节', NOW)
  database.prepare("INSERT INTO prompt_addon_bindings VALUES (?, ?, 'project', ?, '*', ?, 1, 2, ?, ?)")
    .run('addon-binding-1', 'project-1', 'project-1', 'addon-user-1', NOW, NOW)
  const insertGeneration = database.prepare(`INSERT INTO generation_records (
    id, task_id, project_id, chapter_id, task, status, model_profile_id, model_json,
    prompt_template_id, prompt_template_version, prompt_snapshot_json, parameters_json,
    output_text, error, created_at, completed_at, request_json, retry_of_id, attempt_count, events_json
  ) VALUES (?, ?, ?, ?, 'chapter', 'completed', NULL, '{}', '', 1, '{}', '{}', ?, '', ?, ?, ?, ?, ?, '[]')`)
  insertGeneration.run('generation-source', 'task-source', 'project-1', 'chapter-1', '初稿', NOW, NOW, JSON.stringify({ task: 'chapter', projectId: 'project-1', chapterId: 'chapter-1' }), null, 1)
  insertGeneration.run('generation-retry', 'task-retry', 'project-1', 'chapter-1', '重试稿', NOW, NOW, JSON.stringify({ task: 'chapter', projectId: 'project-1', chapterId: 'chapter-1' }), 'generation-source', 2)
  database.prepare(`INSERT INTO quality_reports
    (id, project_id, chapter_id, generation_record_id, reviewer_profile_id, rubric_version, deterministic_json, model_review_json, aggregate_json, execution, repaired, created_at, updated_at)
    VALUES ('quality-1', 'project-1', 'chapter-1', 'generation-source', NULL, 1, '[]', '{}', '{}', 'remote', 0, ?, ?)`)
    .run(NOW, NOW)
  database.prepare(`INSERT INTO quality_human_reviews
    (id, report_id, reviewer_label, scores_json, notes, created_at, updated_at)
    VALUES ('human-1', 'quality-1', '盲评员', '{}', '保留评语', ?, ?)`)
    .run(NOW, NOW)
  const officialPack = database.prepare("SELECT id, current_version FROM creative_packs WHERE source = 'official' LIMIT 1").get()
  database.prepare(`INSERT INTO project_pack_bindings
    (id, project_id, pack_id, pack_version, bound_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('pack-binding-project-1', 'project-1', officialPack.id, officialPack.current_version, NOW, NOW)
  const agentRepository = createCodexRepository(database, {
    now: () => NOW,
    createId: (() => { let id = 0; return (prefix) => `${prefix}-portable-${++id}` })(),
  })
  const run = agentRepository.createRun({
    projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'codex',
  })
  const generationStep = run.steps.find((step) => step.action === 'generate')
  agentRepository.createCandidate({
    runId: run.id, stepId: generationStep.id, projectId: 'project-1', chapterId: 'chapter-1',
    artifactType: generationStep.candidateType, sourceDigest: 'source-v1', payload: { goal: '调查医院' },
  })
  database.prepare(`INSERT INTO story_change_sets (
    id, project_id, root_target_key, root_label, root_before_json, root_after_json,
    source_digest, summary, status, created_at, updated_at, applied_at
  ) VALUES ('change-1', 'project-1', 'planning_entity:character-1:title', '人物名称', '"旧名"', '"林默"',
    'change-digest', '人物更名联动', 'applied', ?, ?, ?)`)
    .run(NOW, NOW, NOW)
  database.prepare(`INSERT INTO story_change_items (
    id, change_set_id, target_key, target_kind, target_id, field_key, field_label,
    before_json, after_json, impact_level, reason, selected, status, created_at, updated_at
  ) VALUES ('change-item-1', 'change-1', 'planning_entity:character-1:title', 'planning_entity',
    'character-1', 'title', '人物名称', '"旧名"', '"林默"', 'required', '根设定', 1, 'applied', ?, ?)`)
    .run(NOW, NOW)
  database.prepare(`INSERT INTO story_change_snapshots (
    id, change_set_id, item_id, target_key, value_json, revision_id, created_at
  ) VALUES ('change-snapshot-1', 'change-1', 'change-item-1',
    'planning_entity:character-1:title', '"旧名"', 'revision-1', ?)`)
    .run(NOW)
  return database
}

function deterministicIds() {
  let sequence = 0
  return (prefix) => `${prefix}-restored-${++sequence}`
}

test('project backup restores a new internally consistent project without credentials', () => {
  const database = createDatabase()
  try {
    const backup = createProjectBackup(database, 'project-1', { now: () => NOW })
    assert.equal(backup.format, 'novel-studio-project')
    assert.equal(backup.version, 5)
    assert.equal(backup.data.project.default_execution_mode, 'app_model')
    assert.equal(backup.data.tables.chapters.length, 2)
    assert.equal(backup.data.tables.quality_reports.length, 1)
    assert.equal(backup.data.tables.quality_human_reviews.length, 1)
    assert.equal(backup.data.tables.project_pack_bindings.length, 1)
    assert.equal(backup.data.tables.agent_runs.length, 1)
    assert.ok(backup.data.tables.agent_steps.length > 1)
    assert.equal(backup.data.tables.agent_candidates.length, 1)
    assert.equal(backup.data.tables.story_change_sets.length, 1)
    assert.equal(backup.data.tables.story_change_items.length, 1)
    assert.equal(backup.data.tables.story_change_snapshots.length, 1)
    assert.equal('agent_sessions' in backup.data.tables, false)
    assert.equal('agent_events' in backup.data.tables, false)
    assert.equal('bridge_action_requests' in backup.data.tables, false)
    assert.equal('model_profiles' in backup.data.tables, false)
    assert.equal(JSON.stringify(backup).includes('api_key_cipher'), false)
    backup.data.tables.generation_records.reverse()
    backup.integrity.digest = createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')

    const restored = restoreProjectBackup(database, backup, { now: () => NOW, createId: deterministicIds() })
    assert.notEqual(restored.projectId, 'project-1')
    assert.equal(database.prepare('SELECT title FROM projects WHERE id = ?').get(restored.projectId).title, '雾港来信 · 恢复副本')
    assert.equal(database.prepare('SELECT default_execution_mode FROM projects WHERE id = ?').get(restored.projectId).default_execution_mode, 'app_model')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?').get(restored.projectId).count, 2)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM revisions JOIN chapters ON revisions.chapter_id = chapters.id WHERE chapters.project_id = ?').get(restored.projectId).count, 1)

    const entities = database.prepare('SELECT id, title FROM planning_entities WHERE project_id = ? ORDER BY position').all(restored.projectId)
    const entityByTitle = Object.fromEntries(entities.map((row) => [row.title, row.id]))
    const relationship = database.prepare('SELECT * FROM character_relationships WHERE project_id = ?').get(restored.projectId)
    assert.equal(relationship.from_character_id, entityByTitle['林默'])
    assert.equal(relationship.to_character_id, entityByTitle['周岚'])
    const beat = database.prepare('SELECT beat.* FROM story_arc_beats beat JOIN story_arcs arc ON beat.arc_id = arc.id WHERE arc.project_id = ?').get(restored.projectId)
    assert.equal(beat.volume_id, entityByTitle['第一卷'])
    assert.ok(database.prepare('SELECT id FROM chapters WHERE id = ? AND project_id = ?').get(beat.chapter_id, restored.projectId))

    const customBinding = database.prepare("SELECT * FROM prompt_bindings WHERE project_id = ? AND task = 'chapter'").get(restored.projectId)
    assert.notEqual(customBinding.template_id, 'template-user-1')
    assert.equal(database.prepare('SELECT kind FROM prompt_templates WHERE id = ?').get(customBinding.template_id).kind, 'user')
    const addonBinding = database.prepare('SELECT * FROM prompt_addon_bindings WHERE project_id = ?').get(restored.projectId)
    assert.notEqual(addonBinding.addon_id, 'addon-user-1')
    const generations = database.prepare('SELECT id, retry_of_id FROM generation_records WHERE project_id = ? ORDER BY attempt_count').all(restored.projectId)
    assert.equal(generations.length, 2)
    assert.equal(generations[1].retry_of_id, generations[0].id)
    const restoredQuality = database.prepare('SELECT * FROM quality_reports WHERE project_id = ?').get(restored.projectId)
    assert.equal(restoredQuality.generation_record_id, generations[0].id)
    assert.equal(database.prepare('SELECT notes FROM quality_human_reviews WHERE report_id = ?').get(restoredQuality.id).notes, '保留评语')
    const restoredRequest = JSON.parse(database.prepare('SELECT request_json FROM generation_records WHERE id = ?').get(generations[1].id).request_json)
    assert.equal(restoredRequest.projectId, restored.projectId)
    assert.notEqual(restoredRequest.chapterId, 'chapter-1')
    assert.equal(database.prepare('SELECT value FROM app_settings WHERE key = ?').get('active_project_id').value, restored.projectId)
    const restoredAgentRun = database.prepare('SELECT * FROM agent_runs WHERE project_id = ?').get(restored.projectId)
    assert.equal(restoredAgentRun.status, 'paused')
    assert.equal(restoredAgentRun.session_recreated, 1)
    assert.equal(database.prepare('SELECT status FROM agent_candidates WHERE run_id = ?').get(restoredAgentRun.id).status, 'stale')
    const restoredChangeSet = database.prepare('SELECT * FROM story_change_sets WHERE project_id = ?').get(restored.projectId)
    const restoredChangeItem = database.prepare('SELECT * FROM story_change_items WHERE change_set_id = ?').get(restoredChangeSet.id)
    const restoredSnapshot = database.prepare('SELECT * FROM story_change_snapshots WHERE change_set_id = ?').get(restoredChangeSet.id)
    assert.equal(restoredChangeSet.status, 'applied')
    assert.equal(restoredChangeSet.root_target_key, `planning_entity:${entityByTitle['林默']}:title`)
    assert.equal(restoredChangeItem.target_id, entityByTitle['林默'])
    assert.equal(restoredChangeItem.target_key, `planning_entity:${entityByTitle['林默']}:title`)
    assert.ok(database.prepare('SELECT id FROM revisions WHERE id = ?').get(restoredSnapshot.revision_id))
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 2)
  } finally {
    database.close()
  }
})

test('backup validation rejects tampering and unsupported versions', () => {
  const database = createDatabase()
  try {
    const backup = createProjectBackup(database, 'project-1')
    backup.data.project.title = '被修改'
    assert.throws(() => validateProjectBackup(backup), /完整性校验失败/)
    const unsupported = createProjectBackup(database, 'project-1')
    unsupported.version = 99
    assert.throws(() => validateProjectBackup(unsupported), /备份版本/)
  } finally {
    database.close()
  }
})

test('v3 project backup restores with app model as its execution default', () => {
  const database = createDatabase()
  try {
    const backup = createProjectBackup(database, 'project-1')
    backup.version = 3
    delete backup.data.project.default_execution_mode
    backup.integrity.digest = createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')
    const restored = restoreProjectBackup(database, backup, { now: () => NOW, createId: deterministicIds() })
    assert.equal(database.prepare('SELECT default_execution_mode FROM projects WHERE id = ?').get(restored.projectId).default_execution_mode, 'app_model')
  } finally {
    database.close()
  }
})

test('restore rejects unknown backup columns before constructing SQL', () => {
  const database = createDatabase()
  try {
    const backup = createProjectBackup(database, 'project-1')
    backup.data.project['title) VALUES (1); DROP TABLE projects; --'] = 'unexpected'
    backup.integrity.digest = createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')
    assert.throws(() => restoreProjectBackup(database, backup), /未知字段/)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1)
  } finally {
    database.close()
  }
})

test('manuscript import creates a new active project and ordered chapters', () => {
  const database = createDatabase()
  try {
    const imported = importManuscriptProject(database, {
      title: '远岸', genre: '科幻', chapters: [{ title: '醒来', manuscript: '舷窗外没有星星。' }, { title: '信标', manuscript: '信号来自船内。' }],
    }, { now: () => NOW, createId: deterministicIds() })
    assert.equal(database.prepare('SELECT title FROM projects WHERE id = ?').get(imported.projectId).title, '远岸')
    assert.deepEqual(database.prepare('SELECT chapter_no, title FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(imported.projectId).map((row) => ({ ...row })), [
      { chapter_no: 1, title: '醒来' }, { chapter_no: 2, title: '信标' },
    ])
    assert.equal(database.prepare('SELECT value FROM app_settings WHERE key = ?').get('active_project_id').value, imported.projectId)
  } finally {
    database.close()
  }
})
