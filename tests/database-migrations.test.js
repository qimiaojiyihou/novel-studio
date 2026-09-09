import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getSchemaVersion, LATEST_SCHEMA_VERSION, runMigrations } from '../electron/database-migrations.js'

function createDatabase() {
  return new DatabaseSync(':memory:')
}

function createLegacySchema(database) {
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL, idea TEXT NOT NULL, style TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chapter_no INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, card_json TEXT NOT NULL DEFAULT '{}', scene_plan TEXT NOT NULL DEFAULT '', manuscript TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, FOREIGN KEY(project_id) REFERENCES projects(id));
    CREATE TABLE revisions (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(chapter_id) REFERENCES chapters(id));
    CREATE TABLE model_profiles (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', api_key_cipher TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE task_routes (task TEXT PRIMARY KEY, model_profile_id TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(model_profile_id) REFERENCES model_profiles(id));
  `)
}

function seedWorkspace(database) {
  const now = '2026-08-20T00:00:00.000Z'
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('project-1', '测试项目', '都市', '想法', '', now, now)
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '正文', now)
  database.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)').run('revision-1', 'chapter-1', '旧正文', 'manual', now)
  database.prepare(`
    INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('model-1', 'custom', '测试模型', 'http://127.0.0.1/v1', 'test', '', 1, now, now)
  database.prepare('INSERT INTO task_routes VALUES (?, ?, ?)').run('chapter', 'model-1', now)
}

test('fresh database migrates to the latest schema with foreign keys enabled', () => {
  const database = createDatabase()
  try {
    const version = runMigrations(database, { now: () => '2026-08-20T00:00:00.000Z' })
    assert.equal(version, LATEST_SCHEMA_VERSION)
    assert.equal(getSchemaVersion(database), LATEST_SCHEMA_VERSION)
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, LATEST_SCHEMA_VERSION)
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'projects_archived_at_idx'").get())
    assert.ok(database.prepare("PRAGMA table_info(projects)").all().some((column) => column.name === 'archived_at'))
    assert.ok(database.prepare("PRAGMA table_info(projects)").all().some((column) => column.name === 'default_execution_mode'))
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planning_documents'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planning_entities'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planning_candidates'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_items'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'continuity_checks'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_candidates'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_item_candidates'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'character_relationships'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_arcs'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_arc_beats'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_change_sets'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_change_items'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'story_change_snapshots'").get())
    assert.match(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_items'").get().sql, /'ai'/)
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_profiles'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chapter_memories'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_templates'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_template_versions'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_bindings'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'style_profiles'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_records'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_addons'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_addon_versions'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_addon_bindings'").get())
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_templates WHERE kind = 'built_in'").get().count, 9)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_bindings WHERE scope_type = 'global'").get().count, 9)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_addons WHERE kind = 'built_in'").get().count, 32)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-chapter-card-v1'").get().current_version, 9)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-scene-plan-v1'").get().current_version, 11)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-chapter-v1'").get().current_version, 20)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-chapter-state-extract-v1'").get().current_version, 6)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-continuity-audit-v1'").get().current_version, 2)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-quality-review-v1'").get().current_version, 8)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_template_versions WHERE template_id = 'builtin-chapter-v1'").get().count, 2)
    assert.ok(database.prepare('PRAGMA table_info(model_profiles)').all().some((column) => column.name === 'settings_json'))
    assert.ok(database.prepare('PRAGMA table_info(model_profiles)').all().some((column) => column.name === 'capabilities_json'))
    assert.ok(database.prepare('PRAGMA table_info(generation_records)').all().some((column) => column.name === 'request_json'))
  } finally {
    database.close()
  }
})

test('migrations are idempotent', () => {
  const database = createDatabase()
  try {
    runMigrations(database)
    runMigrations(database)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, LATEST_SCHEMA_VERSION)
  } finally {
    database.close()
  }
})

test('v12 preserves existing knowledge items and enables reviewable item candidates', () => {
  const database = createDatabase()
  try {
    runMigrations(database, { now: () => '2026-08-24T00:00:00.000Z', targetVersion: 12 })
    const now = '2026-08-24T00:00:00.000Z'
    database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('project-v12', '迁移测试', '悬疑', '旧知识需要保留', '', now, now, '')
    database.prepare(`
      INSERT INTO knowledge_items (id, project_id, kind, title, content_json, source_type, source_id, status, position, created_at, updated_at)
      VALUES (?, ?, 'fact', ?, '{}', 'manual', ?, 'open', 1, ?, ?)
    `).run('knowledge-before-v12', 'project-v12', '迁移前事实', 'manual:before-v12', now, now)

    database.exec(`
      DROP TABLE knowledge_item_candidates;
      CREATE TABLE knowledge_items_v11 (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'timeline', 'foreshadow')),
        title TEXT NOT NULL, content_json TEXT NOT NULL DEFAULT '{}',
        source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'planning', 'chapter')),
        source_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'archived')),
        position INTEGER NOT NULL CHECK(position > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO knowledge_items_v11 SELECT * FROM knowledge_items;
      DROP TABLE knowledge_items;
      ALTER TABLE knowledge_items_v11 RENAME TO knowledge_items;
      DELETE FROM schema_migrations WHERE version = 12;
    `)

    runMigrations(database, { now: () => '2026-08-24T01:00:00.000Z' })
    assert.equal(database.prepare('SELECT title FROM knowledge_items WHERE id = ?').get('knowledge-before-v12').title, '迁移前事实')
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_item_candidates'").get())
    assert.match(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_items'").get().sql, /'ai'/)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})

test('v10 upgrades existing prompt records while preserving v1 template versions', () => {
  const database = createDatabase()
  try {
    runMigrations(database, { now: () => '2026-08-23T00:00:00.000Z' })
    database.prepare('DELETE FROM schema_migrations WHERE version = 10').run()
    for (const templateId of ['builtin-chapter-card-v1', 'builtin-scene-plan-v1', 'builtin-chapter-v1']) {
      database.prepare('UPDATE prompt_templates SET current_version = 1 WHERE id = ?').run(templateId)
      database.prepare('DELETE FROM prompt_template_versions WHERE template_id = ? AND version = 2').run(templateId)
    }
    for (const addonId of [
      'addon-causal-chain', 'addon-knowledge-boundary', 'addon-pov-discipline',
      'addon-spatial-continuity', 'addon-time-continuity', 'addon-ending-action', 'addon-preserve-canon',
    ]) {
      database.prepare('DELETE FROM prompt_addons WHERE id = ?').run(addonId)
    }

    runMigrations(database, { now: () => '2026-08-23T01:00:00.000Z' })
    assert.equal(getSchemaVersion(database), LATEST_SCHEMA_VERSION)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_template_versions WHERE template_id = 'builtin-chapter-v1'").get().count, 2)
    assert.equal(database.prepare("SELECT current_version FROM prompt_templates WHERE id = 'builtin-chapter-v1'").get().current_version, 20)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_addons WHERE kind = 'built_in'").get().count, 32)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})

test('legacy data is preserved and project deletion cascades to chapters and revisions', () => {
  const database = createDatabase()
  try {
    createLegacySchema(database)
    seedWorkspace(database)
    runMigrations(database)
    assert.equal(database.prepare('SELECT manuscript FROM chapters WHERE id = ?').get('chapter-1').manuscript, '正文')
    assert.equal(database.prepare('SELECT content FROM revisions WHERE id = ?').get('revision-1').content, '旧正文')
    assert.equal(database.prepare('SELECT archived_at FROM projects WHERE id = ?').get('project-1').archived_at, '')
    assert.equal(database.prepare("SELECT value FROM app_settings WHERE key = 'active_project_id'").get().value, 'project-1')
    database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chapters').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM revisions').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_documents').get().count, 0)
  } finally {
    database.close()
  }
})

test('foreign keys reject orphan chapters and routed model profiles remain protected', () => {
  const database = createDatabase()
  try {
    runMigrations(database)
    seedWorkspace(database)
    assert.throws(() => {
      database.prepare(`
        INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'orphan', 'missing-project', 2, '孤章', 'draft', '{}', '', '', '2026-08-20T00:00:00.000Z',
      )
    }, /FOREIGN KEY constraint failed/)
    assert.throws(() => database.prepare('DELETE FROM model_profiles WHERE id = ?').run('model-1'), /FOREIGN KEY constraint failed/)
  } finally {
    database.close()
  }
})

test('v15 to v16 preserves legacy scene notes and remaps old prompt add-on bindings', () => {
  const database = createDatabase()
  try {
    const now = '2026-08-24T12:00:00.000Z'
    runMigrations(database, { now: () => now, targetVersion: 15 })
    database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('project-v16', '旧项目', '悬疑', '旧场景计划', '', now, now, '')
    database.prepare(`INSERT INTO chapters
      (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
      VALUES (?, ?, 1, '第一章', 'draft', '{}', ?, '', ?)`)
      .run('chapter-v16', 'project-v16', '场景一：雨夜进入医院。', now)
    database.prepare("INSERT INTO prompt_addons (id, name, category, kind, enabled, current_version, created_at, updated_at) VALUES ('addon-dialogue', '旧对白', '旧版', 'built_in', 1, 1, ?, ?)")
      .run(now, now)
    database.prepare("INSERT INTO prompt_addon_versions (id, addon_id, version, content, created_at) VALUES ('addon-dialogue-version-1', 'addon-dialogue', 1, '旧要求', ?)").run(now)
    database.prepare(`INSERT INTO prompt_addon_bindings
      (id, project_id, scope_type, scope_id, task, addon_id, enabled, priority, created_at, updated_at)
      VALUES ('legacy-binding', 'project-v16', 'project', 'project-v16', 'chapter', 'addon-dialogue', 1, 1, ?, ?)`)
      .run(now, now)

    runMigrations(database, { now: () => '2026-08-24T13:00:00.000Z' })
    const scenePlan = JSON.parse(database.prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get('chapter-v16').scene_plan_json)
    assert.equal(scenePlan.legacyNotes, '场景一：雨夜进入医院。')
    assert.equal(database.prepare('SELECT project_type FROM projects WHERE id = ?').get('project-v16').project_type, 'user')
    assert.equal(database.prepare('SELECT addon_id FROM prompt_addon_bindings WHERE id = ?').get('legacy-binding').addon_id, 'addon-dialogue-subtext')
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_addons WHERE id = 'addon-dialogue'").get().count, 0)
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quality_reports'").get())
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})

test('v17 to v18 preserves agent data and adds Codex session lineage', () => {
  const database = createDatabase()
  try {
    const now = '2026-08-25T12:00:00.000Z'
    runMigrations(database, { now: () => now, targetVersion: 16 })
    database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('project-v18', 'ACP 迁移', '悬疑', '验证会话恢复', '', now, now)
    database.prepare(`INSERT INTO chapters
      (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
      VALUES ('chapter-v18', 'project-v18', 1, '第一章', 'draft', '{}', '', '旧正文', ?)`)
      .run(now)
    runMigrations(database, { now: () => now, targetVersion: 17 })
    const pack = database.prepare(`
      SELECT binding.pack_id, binding.pack_version, version.digest
      FROM project_pack_bindings binding
      JOIN creative_pack_versions version
        ON version.pack_id = binding.pack_id AND version.version = binding.pack_version
      WHERE binding.project_id = ?
    `)
      .get('project-v18')
    database.prepare(`INSERT INTO agent_runs (
      id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version,
      creative_pack_digest, model_routes_json, status, created_at, updated_at
    ) VALUES ('run-v18', 'project-v18', 'chapter-v18', 'chapter-creation', ?, ?, ?, '{}', 'running', ?, ?)`)
      .run(pack.pack_id, pack.pack_version, pack.digest, now, now)
    database.prepare(`INSERT INTO agent_steps (
      id, run_id, step_key, position, action, task, candidate_type, status,
      depends_on_json, input_json, output_json, created_at, updated_at
    ) VALUES ('step-v18', 'run-v18', 'chapter-card', 1, 'generate', 'chapter_card',
      'chapter_card', 'running', '[]', '{}', '{}', ?, ?)`)
      .run(now, now)
    database.prepare(`INSERT INTO agent_candidates (
      id, run_id, step_id, project_id, chapter_id, artifact_type, status,
      source_digest, payload_json, evidence_json, created_at
    ) VALUES ('candidate-v18', 'run-v18', 'step-v18', 'project-v18', 'chapter-v18',
      'chapter_card', 'pending', 'digest', '{}', '{}', ?)`)
      .run(now)

    runMigrations(database, { now: () => '2026-08-25T12:05:00.000Z', targetVersion: 18 })

    assert.equal(getSchemaVersion(database), 18)
    assert.equal(database.prepare('SELECT execution_mode FROM agent_runs WHERE id = ?').get('run-v18').execution_mode, 'app_model')
    assert.equal(database.prepare('SELECT status FROM agent_steps WHERE id = ?').get('step-v18').status, 'running')
    assert.equal(database.prepare('SELECT status FROM agent_candidates WHERE id = ?').get('candidate-v18').status, 'pending')
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get())
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_events'").get())
    assert.ok(database.prepare('PRAGMA table_info(generation_records)').all().some((column) => column.name === 'agent_run_id'))
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])

    database.prepare('DELETE FROM projects WHERE id = ?').run('project-v18')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_steps').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_candidates').get().count, 0)
  } finally {
    database.close()
  }
})

test('v18 to v19 preserves projects and defaults creative execution to app models', () => {
  const database = createDatabase()
  try {
    const now = '2026-08-25T15:00:00.000Z'
    runMigrations(database, { now: () => now, targetVersion: 18 })
    database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('project-v19', '就地创作', '悬疑', '任何位置调用 Codex', '', now, now)

    runMigrations(database, { now: () => now })

    assert.equal(database.prepare('SELECT default_execution_mode FROM projects WHERE id = ?').get('project-v19').default_execution_mode, 'app_model')
    database.prepare("UPDATE projects SET default_execution_mode = 'codex' WHERE id = 'project-v19'").run()
    assert.equal(database.prepare('SELECT default_execution_mode FROM projects WHERE id = ?').get('project-v19').default_execution_mode, 'codex')
    assert.throws(() => database.prepare("UPDATE projects SET default_execution_mode = 'other' WHERE id = 'project-v19'").run(), /CHECK constraint failed/)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})

test('v19 to v20 adds atomic story change sets and cascades their complete history', () => {
  const database = createDatabase()
  try {
    const now = '2026-08-26T08:00:00.000Z'
    runMigrations(database, { now: () => now, targetVersion: 19 })
    database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('project-v20', '联动修改', '悬疑', '旧设定影响全书', '', now, now)

    runMigrations(database, { now: () => now })

    database.prepare(`
      INSERT INTO story_change_sets (
        id, project_id, root_target_key, root_label, source_digest, created_at, updated_at
      ) VALUES ('change-v20', 'project-v20', 'project:project-v20:idea', '一句话想法', 'digest', ?, ?)
    `).run(now, now)
    database.prepare(`
      INSERT INTO story_change_items (
        id, change_set_id, target_key, target_kind, target_id, field_key, field_label,
        impact_level, created_at, updated_at
      ) VALUES ('item-v20', 'change-v20', 'project:project-v20:idea', 'project', 'project-v20', 'idea', '一句话想法', 'required', ?, ?)
    `).run(now, now)
    database.prepare(`
      INSERT INTO story_change_snapshots (id, change_set_id, item_id, target_key, created_at)
      VALUES ('snapshot-v20', 'change-v20', 'item-v20', 'project:project-v20:idea', ?)
    `).run(now)
    database.prepare("DELETE FROM projects WHERE id = 'project-v20'").run()
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_sets').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_items').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_snapshots').get().count, 0)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})

test('v20 to v21 installs fixed Pack 1.2 without changing existing bindings', () => {
  const database = createDatabase()
  try {
    const oldTime = '2026-08-26T09:00:00.000Z'
    const newTime = '2026-08-28T09:00:00.000Z'
    runMigrations(database, { now: () => oldTime, targetVersion: 20 })
    const current = database.prepare(`
      SELECT manifest_json, content_json, digest, min_app_version
      FROM creative_pack_versions
      WHERE pack_id = 'official.general-longform.zh-CN'
      ORDER BY installed_at DESC LIMIT 1
    `).get()
    database.prepare(`
      INSERT OR IGNORE INTO creative_pack_versions (
        id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'official.general-longform.zh-CN@1.1.0', 'official.general-longform.zh-CN', '1.1.0',
      current.min_app_version, 'legacy-digest', current.manifest_json, current.content_json, oldTime,
    )
    database.prepare(`
      INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
      VALUES ('project-v21', '自然正文', '文娱', '改善句群', '', ?, ?)
    `).run(oldTime, oldTime)
    database.prepare(`
      INSERT INTO project_pack_bindings (id, project_id, pack_id, pack_version, bound_at, updated_at)
      VALUES ('binding-v21', 'project-v21', 'official.general-longform.zh-CN', '1.1.0', ?, ?)
    `).run(oldTime, oldTime)
    database.prepare(`
      UPDATE creative_packs SET current_version = '1.1.0' WHERE id = 'official.general-longform.zh-CN'
    `).run()

    runMigrations(database, { now: () => newTime, targetVersion: 21 })

    assert.equal(getSchemaVersion(database), 21)
    assert.equal(database.prepare(`
      SELECT current_version FROM creative_packs WHERE id = 'official.general-longform.zh-CN'
    `).get().current_version, '1.2.0')
    assert.equal(database.prepare(`
      SELECT pack_version FROM project_pack_bindings WHERE project_id = 'project-v21'
    `).get().pack_version, '1.1.0')
    assert.ok(database.prepare(`
      SELECT digest FROM creative_pack_versions
      WHERE pack_id = 'official.general-longform.zh-CN' AND version = '1.2.0'
    `).get().digest)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
  }
})
