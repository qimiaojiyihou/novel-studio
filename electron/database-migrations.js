import { BUILTIN_PROMPT_ADDONS, BUILTIN_PROMPT_TEMPLATES } from './prompt-templates.js'

export const LATEST_SCHEMA_VERSION = 9

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
  {
    version: 6,
    name: 'knowledge-and-continuity-ledger',
    up(database) {
      database.exec(`
        CREATE TABLE knowledge_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('fact', 'timeline', 'foreshadow')),
          title TEXT NOT NULL,
          content_json TEXT NOT NULL DEFAULT '{}',
          source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'planning', 'chapter')),
          source_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'archived')),
          position INTEGER NOT NULL CHECK(position > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE continuity_checks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          kind TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          source_json TEXT NOT NULL DEFAULT '{}',
          origin TEXT NOT NULL DEFAULT 'system' CHECK(origin IN ('system', 'manual')),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
        CREATE INDEX knowledge_items_project_kind_idx ON knowledge_items(project_id, kind, status, position);
        CREATE INDEX knowledge_items_source_idx ON knowledge_items(project_id, source_type, source_id);
        CREATE UNIQUE INDEX knowledge_items_derived_source_idx
          ON knowledge_items(project_id, kind, source_type, source_id)
          WHERE source_type != 'manual' AND source_id != '';
        CREATE INDEX continuity_checks_project_status_idx ON continuity_checks(project_id, status, severity, updated_at);
        CREATE INDEX continuity_checks_chapter_idx ON continuity_checks(chapter_id);
      `)
    },
  },
  {
    version: 7,
    name: 'model-parameters-and-long-context',
    up(database) {
      database.exec(`
        ALTER TABLE model_profiles ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';

        CREATE TABLE context_profiles (
          project_id TEXT PRIMARY KEY,
          max_context_chars INTEGER NOT NULL DEFAULT 32000 CHECK(max_context_chars BETWEEN 8000 AND 200000),
          recent_chapter_count INTEGER NOT NULL DEFAULT 3 CHECK(recent_chapter_count BETWEEN 0 AND 20),
          relevant_chapter_count INTEGER NOT NULL DEFAULT 4 CHECK(relevant_chapter_count BETWEEN 0 AND 20),
          knowledge_limit INTEGER NOT NULL DEFAULT 16 CHECK(knowledge_limit BETWEEN 0 AND 100),
          chapter_summary_chars INTEGER NOT NULL DEFAULT 1200 CHECK(chapter_summary_chars BETWEEN 200 AND 4000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE chapter_memories (
          chapter_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_no INTEGER NOT NULL CHECK(chapter_no > 0),
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          keywords_json TEXT NOT NULL DEFAULT '[]',
          source_updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX chapter_memories_project_chapter_idx ON chapter_memories(project_id, chapter_no);

        UPDATE model_profiles
        SET model = CASE WHEN model = '' THEN 'deepseek-v4-flash' ELSE model END,
            settings_json = '{"thinkingEnabled":true,"reasoningEffort":"high","samplingMode":"task-default","maxTokens":4096,"responseFormat":"auto"}'
        WHERE provider = 'deepseek' AND settings_json = '{}';
      `)
    },
  },
  {
    version: 8,
    name: 'versioned-prompts-and-style-inheritance',
    up(database, now) {
      database.exec(`
        CREATE TABLE prompt_templates (
          id TEXT PRIMARY KEY,
          task TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'built_in' CHECK(kind IN ('built_in', 'user')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE prompt_template_versions (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version > 0),
          content_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          UNIQUE(template_id, version),
          FOREIGN KEY(template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE
        );

        CREATE TABLE prompt_bindings (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'volume', 'chapter')),
          scope_id TEXT NOT NULL DEFAULT '',
          task TEXT NOT NULL,
          template_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(template_id) REFERENCES prompt_templates(id) ON DELETE RESTRICT
        );

        CREATE TABLE style_profiles (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'volume', 'chapter')),
          scope_id TEXT NOT NULL,
          name TEXT NOT NULL,
          style_json TEXT NOT NULL DEFAULT '{}',
          custom_text TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, scope_type, scope_id),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE generation_records (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          task TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled', 'failed')),
          model_profile_id TEXT,
          model_json TEXT NOT NULL DEFAULT '{}',
          prompt_template_id TEXT NOT NULL DEFAULT '',
          prompt_template_version INTEGER NOT NULL DEFAULT 1,
          prompt_snapshot_json TEXT NOT NULL DEFAULT '{}',
          parameters_json TEXT NOT NULL DEFAULT '{}',
          output_text TEXT NOT NULL DEFAULT '',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
          FOREIGN KEY(model_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL
        );

        CREATE INDEX prompt_templates_task_idx ON prompt_templates(task, enabled);
        CREATE INDEX prompt_bindings_lookup_idx ON prompt_bindings(task, project_id, scope_type, scope_id, enabled, priority);
        CREATE INDEX style_profiles_project_scope_idx ON style_profiles(project_id, scope_type, scope_id);
        CREATE INDEX generation_records_project_created_idx ON generation_records(project_id, created_at);
        CREATE INDEX generation_records_chapter_created_idx ON generation_records(chapter_id, created_at);
      `)

      const createdAt = now()
      const insertTemplate = database.prepare(`
        INSERT INTO prompt_templates (id, task, name, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, ?, ?, ?)
      `)
      const insertVersion = database.prepare(`
        INSERT INTO prompt_template_versions (id, template_id, version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertBinding = database.prepare(`
        INSERT INTO prompt_bindings (id, project_id, scope_type, scope_id, task, template_id, enabled, priority, created_at, updated_at)
        VALUES (?, NULL, 'global', '', ?, ?, 1, 0, ?, ?)
      `)
      for (const template of BUILTIN_PROMPT_TEMPLATES) {
        insertTemplate.run(template.id, template.task, template.name, template.version, createdAt, createdAt)
        insertVersion.run(`${template.id}-version-${template.version}`, template.id, template.version, JSON.stringify(template.content), createdAt)
        insertBinding.run(`binding-global-${template.task}`, template.task, template.id, createdAt, createdAt)
      }
    },
  },
  {
    version: 9,
    name: 'prompt-center-and-addons',
    up(database, now) {
      database.exec(`
        CREATE TABLE prompt_addons (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '自定义',
          kind TEXT NOT NULL DEFAULT 'built_in' CHECK(kind IN ('built_in', 'user')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE prompt_addon_versions (
          id TEXT PRIMARY KEY,
          addon_id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK(version > 0),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(addon_id, version),
          FOREIGN KEY(addon_id) REFERENCES prompt_addons(id) ON DELETE CASCADE
        );

        CREATE TABLE prompt_addon_bindings (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'volume', 'chapter')),
          scope_id TEXT NOT NULL,
          task TEXT NOT NULL DEFAULT '*',
          addon_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, scope_type, scope_id, task, addon_id),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(addon_id) REFERENCES prompt_addons(id) ON DELETE CASCADE
        );

        CREATE INDEX prompt_addons_category_idx ON prompt_addons(category, enabled);
        CREATE INDEX prompt_addon_bindings_lookup_idx ON prompt_addon_bindings(project_id, scope_type, scope_id, task, enabled, priority);
      `)

      const createdAt = now()
      const insertAddon = database.prepare(`
        INSERT INTO prompt_addons (id, name, category, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, 1, ?, ?)
      `)
      const insertVersion = database.prepare(`
        INSERT INTO prompt_addon_versions (id, addon_id, version, content, created_at)
        VALUES (?, ?, 1, ?, ?)
      `)
      for (const addon of BUILTIN_PROMPT_ADDONS) {
        insertAddon.run(addon.id, addon.name, addon.category, createdAt, createdAt)
        insertVersion.run(`${addon.id}-version-1`, addon.id, addon.content, createdAt)
      }
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
        migration.up(database, now)
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
