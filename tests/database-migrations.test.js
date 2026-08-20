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
  database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run('project-1', '测试项目', '都市', '想法', '', now, now)
  database.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '正文', now)
  database.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)').run('revision-1', 'chapter-1', '旧正文', 'manual', now)
  database.prepare('INSERT INTO model_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('model-1', 'custom', '测试模型', 'http://127.0.0.1/v1', 'test', '', 1, now, now)
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
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2)
  } finally {
    database.close()
  }
})

test('migrations are idempotent', () => {
  const database = createDatabase()
  try {
    runMigrations(database)
    runMigrations(database)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2)
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
    database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chapters').get().count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM revisions').get().count, 0)
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
      database.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'orphan', 'missing-project', 2, '孤章', 'draft', '{}', '', '', '2026-08-20T00:00:00.000Z',
      )
    }, /FOREIGN KEY constraint failed/)
    assert.throws(() => database.prepare('DELETE FROM model_profiles WHERE id = ?').run('model-1'), /FOREIGN KEY constraint failed/)
  } finally {
    database.close()
  }
})
