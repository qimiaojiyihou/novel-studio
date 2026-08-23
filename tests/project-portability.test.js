import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
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
  database.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('chapter-1', 'project-1', 1, '雨夜', 'draft', JSON.stringify({ volumeId: 'volume-1' }), '', '雨落在站牌上。', NOW)
  database.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
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
    assert.equal(backup.data.tables.chapters.length, 2)
    assert.equal('model_profiles' in backup.data.tables, false)
    assert.equal(JSON.stringify(backup).includes('api_key_cipher'), false)
    backup.data.tables.generation_records.reverse()
    backup.integrity.digest = createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')

    const restored = restoreProjectBackup(database, backup, { now: () => NOW, createId: deterministicIds() })
    assert.notEqual(restored.projectId, 'project-1')
    assert.equal(database.prepare('SELECT title FROM projects WHERE id = ?').get(restored.projectId).title, '雾港来信 · 恢复副本')
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
    const restoredRequest = JSON.parse(database.prepare('SELECT request_json FROM generation_records WHERE id = ?').get(generations[1].id).request_json)
    assert.equal(restoredRequest.projectId, restored.projectId)
    assert.notEqual(restoredRequest.chapterId, 'chapter-1')
    assert.equal(database.prepare('SELECT value FROM app_settings WHERE key = ?').get('active_project_id').value, restored.projectId)
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
