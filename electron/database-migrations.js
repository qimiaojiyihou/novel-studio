export const LATEST_SCHEMA_VERSION = 5

const migrations = [
  {
    version: 1,
    name: 'initial-workspace-schema',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          genre TEXT NOT NULL,
          idea TEXT NOT NULL,
          style TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_no INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          card_json TEXT NOT NULL DEFAULT '{}',
          scene_plan TEXT NOT NULL DEFAULT '',
          manuscript TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS revisions (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id)
        );
        CREATE TABLE IF NOT EXISTS model_profiles (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          api_key_cipher TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_routes (
          task TEXT PRIMARY KEY,
          model_profile_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(model_profile_id) REFERENCES model_profiles(id)
        );
      `)
    },
  },
  {
    version: 2,
    name: 'foreign-key-policies-and-indexes',
    up(database) {
      database.exec(`
        CREATE TABLE chapters_v2 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_no INTEGER NOT NULL CHECK(chapter_no > 0),
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          card_json TEXT NOT NULL DEFAULT '{}',
          scene_plan TEXT NOT NULL DEFAULT '',
          manuscript TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, chapter_no),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        INSERT INTO chapters_v2 (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
          SELECT id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at FROM chapters;

        CREATE TABLE revisions_v2 (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(chapter_id) REFERENCES chapters_v2(id) ON DELETE CASCADE
        );
        INSERT INTO revisions_v2 (id, chapter_id, content, source, created_at)
          SELECT id, chapter_id, content, source, created_at FROM revisions;

        CREATE TABLE task_routes_v2 (
          task TEXT PRIMARY KEY,
          model_profile_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(model_profile_id) REFERENCES model_profiles(id) ON DELETE RESTRICT
        );
        INSERT INTO task_routes_v2 (task, model_profile_id, updated_at)
          SELECT task, model_profile_id, updated_at FROM task_routes;

        DROP TABLE revisions;
        DROP TABLE chapters;
        DROP TABLE task_routes;
        ALTER TABLE chapters_v2 RENAME TO chapters;
        ALTER TABLE revisions_v2 RENAME TO revisions;
        ALTER TABLE task_routes_v2 RENAME TO task_routes;

        CREATE INDEX chapters_project_id_idx ON chapters(project_id);
        CREATE INDEX revisions_chapter_id_idx ON revisions(chapter_id);
        CREATE INDEX model_profiles_provider_idx ON model_profiles(provider);
      `)
    },
  },
  {
    version: 3,
    name: 'active-project-setting',
    up(database) {
      database.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO app_settings (key, value, updated_at)
          SELECT 'active_project_id', id, updated_at
          FROM projects
          ORDER BY updated_at DESC
          LIMIT 1;
      `)
    },
  },
  {
    version: 4,
    name: 'project-archive-state',
    up(database) {
      database.exec(`
        ALTER TABLE projects ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';
        CREATE INDEX projects_archived_at_idx ON projects(archived_at);
      `)
    },
  },
  {
    version: 5,
    name: 'story-planning-center',
    up(database) {
      database.exec(`
        CREATE TABLE planning_documents (
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          content_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id, kind),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE planning_entities (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position > 0),
          data_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, kind, position),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE planning_candidates (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK(target_type IN ('document', 'entity', 'chapter')),
          target_id TEXT NOT NULL,
          field_key TEXT NOT NULL,
          field_label TEXT NOT NULL DEFAULT '',
          original_value TEXT NOT NULL DEFAULT '',
          candidate_value TEXT NOT NULL,
          instruction TEXT NOT NULL DEFAULT '',
          model_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'discarded')),
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX planning_documents_project_idx ON planning_documents(project_id);
        CREATE INDEX planning_entities_project_kind_idx ON planning_entities(project_id, kind);
        CREATE INDEX planning_candidates_project_status_idx ON planning_candidates(project_id, status, created_at);
      `)
    },
  },
]

function readForeignKeyCheck(database) {
  return database.prepare('PRAGMA foreign_key_check').all()
}

export function getSchemaVersion(database) {
  const row = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()
  return Number(row?.version || 0)
}

export function runMigrations(database, { now = () => new Date().toISOString() } = {}) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `)

  try {
    const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)))
    const recordMigration = database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      database.exec('BEGIN IMMEDIATE')
      try {
        migration.up(database)
        recordMigration.run(migration.version, migration.name, now())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw new Error(`数据库迁移 v${migration.version}（${migration.name}）失败：${error.message}`, { cause: error })
      }
    }
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }

  const violations = readForeignKeyCheck(database)
  if (violations.length) {
    const sample = violations.slice(0, 5).map((row) => `${row.table}:${row.rowid}`).join(', ')
    throw new Error(`数据库外键检查失败，共 ${violations.length} 项：${sample}`)
  }
  return getSchemaVersion(database)
}
