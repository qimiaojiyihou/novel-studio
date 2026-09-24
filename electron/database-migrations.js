import {
  BUILTIN_PROMPT_ADDONS,
  BUILTIN_PROMPT_TEMPLATES,
  LEGACY_PROMPT_TEMPLATE_VERSIONS,
} from './prompt-templates.js'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateCreativePack } from './creative-pack.js'
import { creativeUpgradeMigrations } from './creative-upgrade-migrations.js'

export const LATEST_SCHEMA_VERSION = 29

function bundledOfficialPack(version = '1.2.0') {
  const directory = version === '1.3.0' ? 'dist' : 'historical'
  const historicalPath = fileURLToPath(new URL(`../creative-packs/${directory}/general-longform-${version}.nspack.json`, import.meta.url))
  const filePath = fs.existsSync(historicalPath) ? historicalPath : fileURLToPath(new URL(`../creative-packs/dist/general-longform-${version}.nspack.json`, import.meta.url))
  const pack = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  validateCreativePack(pack, { appVersion: '0.1.0' })
  return pack
}

const migrations = [
  {
    version: 1,
    name: 'initial-workspace-schema',
    up(database, now) {
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
        database.prepare(`
          UPDATE prompt_templates SET name = ?, current_version = ?, updated_at = ?
          WHERE id = ? AND kind = 'built_in'
        `).run(template.name, template.version, createdAt, template.id)
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
  {
    version: 10,
    name: 'creative-prompt-library-v2',
    up(database, now) {
      const createdAt = now()
      const insertTemplateVersion = database.prepare(`
        INSERT OR IGNORE INTO prompt_template_versions (id, template_id, version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      const updateTemplate = database.prepare(`
        UPDATE prompt_templates SET name = ?, current_version = ?, updated_at = ? WHERE id = ? AND kind = 'built_in'
      `)
      for (const template of BUILTIN_PROMPT_TEMPLATES.filter((item) => item.version > 1)) {
        const legacy = LEGACY_PROMPT_TEMPLATE_VERSIONS[template.id]
        if (legacy) {
          insertTemplateVersion.run(
            `${template.id}-version-${legacy.version}`,
            template.id,
            legacy.version,
            JSON.stringify(legacy.content),
            createdAt,
          )
        }
        insertTemplateVersion.run(
          `${template.id}-version-${template.version}`,
          template.id,
          template.version,
          JSON.stringify(template.content),
          createdAt,
        )
        updateTemplate.run(template.name, template.version, createdAt, template.id)
      }

      const insertAddon = database.prepare(`
        INSERT OR IGNORE INTO prompt_addons (id, name, category, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, 1, ?, ?)
      `)
      const insertAddonVersion = database.prepare(`
        INSERT OR IGNORE INTO prompt_addon_versions (id, addon_id, version, content, created_at)
        VALUES (?, ?, 1, ?, ?)
      `)
      for (const addon of BUILTIN_PROMPT_ADDONS) {
        insertAddon.run(addon.id, addon.name, addon.category, createdAt, createdAt)
        insertAddonVersion.run(`${addon.id}-version-1`, addon.id, addon.content, createdAt)
      }

    },
  },
  {
    version: 11,
    name: 'knowledge-ai-candidates',
    up(database, now) {
      database.exec(`
        CREATE TABLE continuity_checks_v11 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          kind TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          source_json TEXT NOT NULL DEFAULT '{}',
          origin TEXT NOT NULL DEFAULT 'system' CHECK(origin IN ('system', 'manual', 'ai')),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
        INSERT INTO continuity_checks_v11
        SELECT * FROM continuity_checks;
        DROP TABLE continuity_checks;
        ALTER TABLE continuity_checks_v11 RENAME TO continuity_checks;
        CREATE INDEX continuity_checks_project_status_idx ON continuity_checks(project_id, status, severity, updated_at);
        CREATE INDEX continuity_checks_chapter_idx ON continuity_checks(chapter_id);

        CREATE TABLE knowledge_candidates (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          task TEXT NOT NULL CHECK(task IN ('chapter_state_extract', 'continuity_audit')),
          payload_json TEXT NOT NULL DEFAULT '{}',
          model_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'discarded')),
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
        CREATE INDEX knowledge_candidates_project_status_idx ON knowledge_candidates(project_id, status, created_at);
        CREATE INDEX knowledge_candidates_chapter_task_idx ON knowledge_candidates(chapter_id, task, status, created_at);
      `)

      const createdAt = now()
      const tasks = new Set(['chapter_state_extract', 'continuity_audit'])
      const insertTemplate = database.prepare(`
        INSERT OR IGNORE INTO prompt_templates (id, task, name, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, ?, ?, ?)
      `)
      const insertVersion = database.prepare(`
        INSERT OR IGNORE INTO prompt_template_versions (id, template_id, version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertBinding = database.prepare(`
        INSERT OR IGNORE INTO prompt_bindings (id, project_id, scope_type, scope_id, task, template_id, enabled, priority, created_at, updated_at)
        VALUES (?, NULL, 'global', '', ?, ?, 1, 0, ?, ?)
      `)
      for (const template of BUILTIN_PROMPT_TEMPLATES.filter((item) => tasks.has(item.task))) {
        insertTemplate.run(template.id, template.task, template.name, template.version, createdAt, createdAt)
        insertVersion.run(`${template.id}-version-${template.version}`, template.id, template.version, JSON.stringify(template.content), createdAt)
        insertBinding.run(`binding-global-${template.task}`, template.task, template.id, createdAt, createdAt)
      }
    },
  },
  {
    version: 12,
    name: 'state-to-knowledge-item-candidates',
    up(database) {
      database.exec(`
        CREATE TABLE knowledge_items_v12 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('fact', 'timeline', 'foreshadow')),
          title TEXT NOT NULL,
          content_json TEXT NOT NULL DEFAULT '{}',
          source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'planning', 'chapter', 'ai')),
          source_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'archived')),
          position INTEGER NOT NULL CHECK(position > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        INSERT INTO knowledge_items_v12
        SELECT * FROM knowledge_items;
        DROP TABLE knowledge_items;
        ALTER TABLE knowledge_items_v12 RENAME TO knowledge_items;
        CREATE INDEX knowledge_items_project_kind_idx ON knowledge_items(project_id, kind, status, position);
        CREATE INDEX knowledge_items_source_idx ON knowledge_items(project_id, source_type, source_id);
        CREATE UNIQUE INDEX knowledge_items_derived_source_idx
          ON knowledge_items(project_id, kind, source_type, source_id)
          WHERE source_type != 'manual' AND source_id != '';

        CREATE TABLE knowledge_item_candidates (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          source_candidate_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('fact', 'timeline', 'foreshadow')),
          title TEXT NOT NULL,
          content_json TEXT NOT NULL DEFAULT '{}',
          item_status TEXT NOT NULL DEFAULT 'open' CHECK(item_status IN ('open', 'resolved')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'discarded')),
          position INTEGER NOT NULL CHECK(position > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
          FOREIGN KEY(source_candidate_id) REFERENCES knowledge_candidates(id) ON DELETE CASCADE
        );
        CREATE INDEX knowledge_item_candidates_project_status_idx
          ON knowledge_item_candidates(project_id, status, kind, created_at);
        CREATE INDEX knowledge_item_candidates_source_idx
          ON knowledge_item_candidates(source_candidate_id, position);
      `)
    },
  },
  {
    version: 13,
    name: 'character-relationship-graph',
    up(database) {
      database.exec(`
        CREATE TABLE character_relationships (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          from_character_id TEXT NOT NULL,
          to_character_id TEXT NOT NULL,
          label TEXT NOT NULL,
          surface TEXT NOT NULL DEFAULT '',
          tension TEXT NOT NULL DEFAULT '',
          direction TEXT NOT NULL DEFAULT 'mutual' CHECK(direction IN ('mutual', 'from_to', 'to_from')),
          trend TEXT NOT NULL DEFAULT 'stable' CHECK(trend IN ('warming', 'stable', 'cooling', 'hostile')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'changed', 'ended')),
          source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'ai')),
          source_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK(from_character_id != to_character_id),
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(from_character_id) REFERENCES planning_entities(id) ON DELETE CASCADE,
          FOREIGN KEY(to_character_id) REFERENCES planning_entities(id) ON DELETE CASCADE
        );
        CREATE INDEX character_relationships_project_idx
          ON character_relationships(project_id, status, updated_at);
        CREATE INDEX character_relationships_from_idx ON character_relationships(from_character_id);
        CREATE INDEX character_relationships_to_idx ON character_relationships(to_character_id);
      `)
    },
  },
  {
    version: 14,
    name: 'cross-volume-story-arcs',
    up(database) {
      database.exec(`
        CREATE TABLE story_arcs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'main' CHECK(category IN ('main', 'character', 'relationship', 'mystery', 'world', 'other')),
          premise TEXT NOT NULL DEFAULT '',
          destination TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'active', 'resolved', 'paused')),
          color_key TEXT NOT NULL DEFAULT 'copper' CHECK(color_key IN ('copper', 'pine', 'slate', 'ochre', 'plum')),
          position INTEGER NOT NULL CHECK(position > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX story_arcs_project_position_idx ON story_arcs(project_id, position);

        CREATE TABLE story_arc_beats (
          id TEXT PRIMARY KEY,
          arc_id TEXT NOT NULL,
          volume_id TEXT,
          chapter_id TEXT,
          label TEXT NOT NULL,
          change_text TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL CHECK(position > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(arc_id) REFERENCES story_arcs(id) ON DELETE CASCADE,
          FOREIGN KEY(volume_id) REFERENCES planning_entities(id) ON DELETE SET NULL,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX story_arc_beats_arc_position_idx ON story_arc_beats(arc_id, position);
        CREATE INDEX story_arc_beats_volume_idx ON story_arc_beats(volume_id);
        CREATE INDEX story_arc_beats_chapter_idx ON story_arc_beats(chapter_id);
      `)
    },
  },
  {
    version: 15,
    name: 'model-capabilities-and-generation-retries',
    up(database) {
      database.exec(`
        ALTER TABLE model_profiles ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE model_profiles ADD COLUMN tested_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE generation_records ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE generation_records ADD COLUMN retry_of_id TEXT REFERENCES generation_records(id) ON DELETE SET NULL;
        ALTER TABLE generation_records ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count > 0);
        ALTER TABLE generation_records ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]';
        CREATE INDEX generation_records_retry_of_idx ON generation_records(retry_of_id);
        CREATE INDEX generation_records_project_status_idx ON generation_records(project_id, status, created_at DESC);
      `)
    },
  },
  {
    version: 16,
    name: 'creative-quality-and-structured-scenes',
    up(database, now) {
      database.exec(`
        ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'user'
          CHECK(project_type IN ('user', 'benchmark'));
        ALTER TABLE chapters ADD COLUMN scene_plan_json TEXT NOT NULL
          DEFAULT '{"schemaVersion":1,"summary":"","scenes":[],"legacyNotes":""}';
        UPDATE chapters
        SET scene_plan_json = json_object(
          'schemaVersion', 1,
          'summary', '',
          'scenes', json('[]'),
          'legacyNotes', scene_plan
        )
        WHERE TRIM(scene_plan) != '';

        ALTER TABLE generation_records ADD COLUMN generation_intent TEXT NOT NULL DEFAULT 'draft'
          CHECK(generation_intent IN ('draft', 'continue', 'rewrite', 'repair', 'analysis'));
        ALTER TABLE generation_records ADD COLUMN parent_generation_id TEXT
          REFERENCES generation_records(id) ON DELETE SET NULL;
        CREATE INDEX generation_records_parent_idx ON generation_records(parent_generation_id);

        CREATE TABLE quality_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          generation_record_id TEXT NOT NULL UNIQUE,
          reviewer_profile_id TEXT,
          rubric_version INTEGER NOT NULL DEFAULT 1 CHECK(rubric_version > 0),
          deterministic_json TEXT NOT NULL DEFAULT '[]',
          model_review_json TEXT NOT NULL DEFAULT '{}',
          aggregate_json TEXT NOT NULL DEFAULT '{}',
          execution TEXT NOT NULL DEFAULT 'mock' CHECK(execution IN ('remote', 'mock')),
          repaired INTEGER NOT NULL DEFAULT 0 CHECK(repaired IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
          FOREIGN KEY(generation_record_id) REFERENCES generation_records(id) ON DELETE CASCADE,
          FOREIGN KEY(reviewer_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL
        );
        CREATE INDEX quality_reports_project_created_idx ON quality_reports(project_id, created_at DESC);
        CREATE INDEX quality_reports_chapter_created_idx ON quality_reports(chapter_id, created_at DESC);

        CREATE TABLE quality_human_reviews (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          reviewer_label TEXT NOT NULL DEFAULT '人工评审',
          scores_json TEXT NOT NULL DEFAULT '{}',
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(report_id) REFERENCES quality_reports(id) ON DELETE CASCADE
        );
        CREATE INDEX quality_human_reviews_report_idx ON quality_human_reviews(report_id, created_at);

        CREATE TABLE benchmark_runs (
          id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          generator_profile_id TEXT,
          reviewer_profile_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
          summary_json TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(generator_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL,
          FOREIGN KEY(reviewer_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL
        );
        CREATE INDEX benchmark_runs_created_idx ON benchmark_runs(created_at DESC);

        CREATE TABLE benchmark_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position > 0),
          step_key TEXT NOT NULL,
          task TEXT NOT NULL,
          generation_record_id TEXT,
          quality_report_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
          input_json TEXT NOT NULL DEFAULT '{}',
          output_json TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          UNIQUE(run_id, position),
          FOREIGN KEY(run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(generation_record_id) REFERENCES generation_records(id) ON DELETE SET NULL,
          FOREIGN KEY(quality_report_id) REFERENCES quality_reports(id) ON DELETE SET NULL
        );
        CREATE INDEX benchmark_steps_run_position_idx ON benchmark_steps(run_id, position);
      `)

      const createdAt = now()
      const insertTemplate = database.prepare(`
        INSERT OR IGNORE INTO prompt_templates (id, task, name, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, ?, ?, ?)
      `)
      const insertVersion = database.prepare(`
        INSERT OR IGNORE INTO prompt_template_versions (id, template_id, version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertBinding = database.prepare(`
        INSERT OR IGNORE INTO prompt_bindings (id, project_id, scope_type, scope_id, task, template_id, enabled, priority, created_at, updated_at)
        VALUES (?, NULL, 'global', '', ?, ?, 1, 0, ?, ?)
      `)
      for (const template of BUILTIN_PROMPT_TEMPLATES) {
        insertTemplate.run(template.id, template.task, template.name, template.version, createdAt, createdAt)
        insertVersion.run(`${template.id}-version-${template.version}`, template.id, template.version, JSON.stringify(template.content), createdAt)
        insertBinding.run(`binding-global-${template.task}`, template.task, template.id, createdAt, createdAt)
        database.prepare('UPDATE prompt_templates SET name = ?, current_version = ?, updated_at = ? WHERE id = ? AND kind = \'built_in\'')
          .run(template.name, template.version, createdAt, template.id)
      }

      const insertAddon = database.prepare(`
        INSERT OR IGNORE INTO prompt_addons (id, name, category, kind, enabled, current_version, created_at, updated_at)
        VALUES (?, ?, ?, 'built_in', 1, 1, ?, ?)
      `)
      const insertAddonVersion = database.prepare(`
        INSERT OR IGNORE INTO prompt_addon_versions (id, addon_id, version, content, created_at)
        VALUES (?, ?, 1, ?, ?)
      `)
      for (const addon of BUILTIN_PROMPT_ADDONS) {
        insertAddon.run(addon.id, addon.name, addon.category, createdAt, createdAt)
        insertAddonVersion.run(`${addon.id}-version-1`, addon.id, addon.content, createdAt)
      }

      // Earlier schemas shipped ten broad add-ons that now have more precise
      // equivalents. Move existing selections to the canonical 32-item library.
      const addonAliases = {
        'addon-dialogue': 'addon-dialogue-subtext',
        'addon-less-exposition': 'addon-no-author-explanation',
        'addon-conflict': 'addon-goal-obstacle-change',
        'addon-fast-pace': 'addon-faster-pacing',
        'addon-suspense': 'addon-fair-suspense',
        'addon-sensory': 'addon-sensory-selective',
        'addon-ending-hook': 'addon-ending-action',
        'addon-continuity': 'addon-preserve-canon',
        'addon-no-summary-ending': 'addon-ending-action',
        'addon-natural-language': 'addon-rhythm-variety',
      }
      const aliasBindings = database.prepare('SELECT * FROM prompt_addon_bindings WHERE addon_id = ? ORDER BY created_at, rowid')
      const matchingBinding = database.prepare(`
        SELECT id FROM prompt_addon_bindings
        WHERE project_id = ? AND scope_type = ? AND scope_id = ? AND task = ? AND addon_id = ?
      `)
      const updateBindingAddon = database.prepare('UPDATE prompt_addon_bindings SET addon_id = ?, updated_at = ? WHERE id = ?')
      const deleteBinding = database.prepare('DELETE FROM prompt_addon_bindings WHERE id = ?')
      const deleteAddonVersions = database.prepare('DELETE FROM prompt_addon_versions WHERE addon_id = ?')
      const deleteAddon = database.prepare("DELETE FROM prompt_addons WHERE id = ? AND kind = 'built_in'")
      for (const [aliasId, canonicalId] of Object.entries(addonAliases)) {
        for (const binding of aliasBindings.all(aliasId)) {
          const duplicate = matchingBinding.get(
            binding.project_id,
            binding.scope_type,
            binding.scope_id,
            binding.task,
            canonicalId,
          )
          if (duplicate) deleteBinding.run(binding.id)
          else updateBindingAddon.run(canonicalId, createdAt, binding.id)
        }
        deleteAddonVersions.run(aliasId)
        deleteAddon.run(aliasId)
      }
    },
  },
  {
    version: 17,
    name: 'creative-packs-agents-and-local-bridge',
    up(database, now) {
      database.exec(`
        CREATE TABLE creative_packs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          language TEXT NOT NULL,
          license TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('official', 'user')),
          current_version TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE creative_pack_versions (
          id TEXT PRIMARY KEY,
          pack_id TEXT NOT NULL,
          version TEXT NOT NULL,
          min_app_version TEXT NOT NULL,
          digest TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          content_json TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          UNIQUE(pack_id, version),
          FOREIGN KEY(pack_id) REFERENCES creative_packs(id) ON DELETE CASCADE
        );
        CREATE INDEX creative_pack_versions_pack_idx ON creative_pack_versions(pack_id, installed_at DESC);

        CREATE TABLE project_pack_bindings (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE,
          pack_id TEXT NOT NULL,
          pack_version TEXT NOT NULL,
          bound_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(pack_id, pack_version) REFERENCES creative_pack_versions(pack_id, version) ON DELETE RESTRICT
        );

        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          workflow_id TEXT NOT NULL,
          creative_pack_id TEXT NOT NULL,
          creative_pack_version TEXT NOT NULL,
          creative_pack_digest TEXT NOT NULL,
          model_routes_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'running', 'waiting_confirmation', 'paused', 'completed', 'cancelled', 'failed')),
          current_step_id TEXT NOT NULL DEFAULT '',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
          FOREIGN KEY(creative_pack_id, creative_pack_version) REFERENCES creative_pack_versions(pack_id, version) ON DELETE RESTRICT
        );
        CREATE INDEX agent_runs_project_updated_idx ON agent_runs(project_id, updated_at DESC);

        CREATE TABLE agent_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_key TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position > 0),
          action TEXT NOT NULL,
          task TEXT NOT NULL DEFAULT '',
          candidate_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'running', 'waiting_confirmation', 'completed', 'confirmed', 'rejected', 'failed', 'cancelled', 'stale')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
          depends_on_json TEXT NOT NULL DEFAULT '[]',
          input_json TEXT NOT NULL DEFAULT '{}',
          output_json TEXT NOT NULL DEFAULT '{}',
          generation_record_id TEXT,
          quality_report_id TEXT,
          error TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL DEFAULT '',
          completed_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(run_id, step_key),
          UNIQUE(run_id, position),
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(generation_record_id) REFERENCES generation_records(id) ON DELETE SET NULL,
          FOREIGN KEY(quality_report_id) REFERENCES quality_reports(id) ON DELETE SET NULL
        );
        CREATE INDEX agent_steps_run_position_idx ON agent_steps(run_id, position);

        CREATE TABLE agent_candidates (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          artifact_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'stale')),
          source_digest TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          evidence_json TEXT NOT NULL DEFAULT '{}',
          override_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(step_id) REFERENCES agent_steps(id) ON DELETE CASCADE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
        );
        CREATE INDEX agent_candidates_run_status_idx ON agent_candidates(run_id, status, created_at);

        CREATE TABLE bridge_action_requests (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          action_type TEXT NOT NULL CHECK(action_type IN ('model_call', 'project_write', 'agent_start')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'completed', 'failed')),
          permission TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          expires_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX bridge_action_requests_project_status_idx ON bridge_action_requests(project_id, status, created_at DESC);
      `)

      const installedAt = now()
      const pack = bundledOfficialPack('1.0.0')
      const manifest = pack.manifest
      database.prepare(`
        INSERT INTO creative_packs (id, name, language, license, source, current_version, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'official', ?, 1, ?, ?)
      `).run(manifest.id, manifest.name, manifest.language, manifest.license, manifest.version, installedAt, installedAt)
      database.prepare(`
        INSERT INTO creative_pack_versions (id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`${manifest.id}@${manifest.version}`, manifest.id, manifest.version, manifest.minAppVersion,
        manifest.integrity.sha256, JSON.stringify(manifest), JSON.stringify(pack), installedAt)
      database.prepare(`
        INSERT INTO project_pack_bindings (id, project_id, pack_id, pack_version, bound_at, updated_at)
        SELECT 'pack-binding-' || id, id, ?, ?, ?, ? FROM projects WHERE project_type = 'user'
      `).run(manifest.id, manifest.version, installedAt, installedAt)
    },
  },
  {
    version: 18,
    name: 'codex-acp-sessions-events-and-approvals',
    up(database, now) {
      database.exec(`
        CREATE TABLE agent_runs_v18 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          workflow_id TEXT NOT NULL,
          creative_pack_id TEXT NOT NULL,
          creative_pack_version TEXT NOT NULL,
          creative_pack_digest TEXT NOT NULL,
          model_routes_json TEXT NOT NULL DEFAULT '{}',
          execution_mode TEXT NOT NULL DEFAULT 'app_model'
            CHECK(execution_mode IN ('app_model', 'codex')),
          actual_backend TEXT NOT NULL DEFAULT '',
          fallback_reason TEXT NOT NULL DEFAULT '',
          session_recreated INTEGER NOT NULL DEFAULT 0 CHECK(session_recreated IN (0, 1)),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'waiting_approval', 'running', 'waiting_confirmation', 'paused', 'completed', 'cancelled', 'failed')),
          current_step_id TEXT NOT NULL DEFAULT '',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
          FOREIGN KEY(creative_pack_id, creative_pack_version) REFERENCES creative_pack_versions(pack_id, version) ON DELETE RESTRICT
        );
        INSERT INTO agent_runs_v18 (
          id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version,
          creative_pack_digest, model_routes_json, execution_mode, actual_backend,
          fallback_reason, session_recreated, status, current_step_id, error,
          created_at, updated_at, completed_at
        )
        SELECT id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version,
          creative_pack_digest, model_routes_json, 'app_model', '', '', 0, status,
          current_step_id, error, created_at, updated_at, completed_at
        FROM agent_runs;

        CREATE TABLE agent_steps_v18 (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_key TEXT NOT NULL,
          position INTEGER NOT NULL CHECK(position > 0),
          action TEXT NOT NULL,
          task TEXT NOT NULL DEFAULT '',
          candidate_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'waiting_approval', 'running', 'interrupted', 'waiting_confirmation', 'confirmed', 'rejected', 'completed', 'cancelled', 'stale', 'failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
          depends_on_json TEXT NOT NULL DEFAULT '[]',
          input_json TEXT NOT NULL DEFAULT '{}',
          output_json TEXT NOT NULL DEFAULT '{}',
          generation_record_id TEXT,
          quality_report_id TEXT,
          approval_id TEXT NOT NULL DEFAULT '',
          output_started INTEGER NOT NULL DEFAULT 0 CHECK(output_started IN (0, 1)),
          interrupted_at TEXT NOT NULL DEFAULT '',
          execution_backend TEXT NOT NULL DEFAULT '',
          error TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL DEFAULT '',
          completed_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(run_id, step_key),
          UNIQUE(run_id, position),
          FOREIGN KEY(run_id) REFERENCES agent_runs_v18(id) ON DELETE CASCADE,
          FOREIGN KEY(generation_record_id) REFERENCES generation_records(id) ON DELETE SET NULL,
          FOREIGN KEY(quality_report_id) REFERENCES quality_reports(id) ON DELETE SET NULL
        );
        INSERT INTO agent_steps_v18 (
          id, run_id, step_key, position, action, task, candidate_type, status,
          attempt_count, depends_on_json, input_json, output_json, generation_record_id,
          quality_report_id, approval_id, output_started, interrupted_at,
          execution_backend, error, started_at, completed_at, created_at, updated_at
        )
        SELECT id, run_id, step_key, position, action, task, candidate_type, status,
          attempt_count, depends_on_json, input_json, output_json, generation_record_id,
          quality_report_id, '', 0, '', '', error, started_at, completed_at,
          created_at, updated_at
        FROM agent_steps;

        CREATE TABLE agent_candidates_v18 (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          chapter_id TEXT,
          artifact_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'stale', 'cancelled')),
          source_digest TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          evidence_json TEXT NOT NULL DEFAULT '{}',
          override_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(run_id) REFERENCES agent_runs_v18(id) ON DELETE CASCADE,
          FOREIGN KEY(step_id) REFERENCES agent_steps_v18(id) ON DELETE CASCADE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
        );
        INSERT INTO agent_candidates_v18 SELECT * FROM agent_candidates;

        CREATE TABLE bridge_action_requests_v18 (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL DEFAULT '',
          project_id TEXT NOT NULL,
          origin TEXT NOT NULL DEFAULT 'bridge' CHECK(origin IN ('bridge', 'codex_acp', 'agent')),
          agent_run_id TEXT,
          agent_step_id TEXT,
          external_request_id TEXT NOT NULL DEFAULT '',
          action_type TEXT NOT NULL
            CHECK(action_type IN ('model_call', 'project_write', 'agent_start', 'command', 'file', 'web', 'mcp', 'subagent')),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'approved', 'rejected', 'expired', 'completed', 'failed', 'cancelled')),
          permission TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          expires_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(agent_run_id) REFERENCES agent_runs_v18(id) ON DELETE CASCADE,
          FOREIGN KEY(agent_step_id) REFERENCES agent_steps_v18(id) ON DELETE CASCADE
        );
        INSERT INTO bridge_action_requests_v18 (
          id, session_id, project_id, origin, action_type, status, permission,
          payload_json, result_json, error, created_at, resolved_at, expires_at
        )
        SELECT id, session_id, project_id, 'bridge', action_type, status, permission,
          payload_json, result_json, error, created_at, resolved_at, expires_at
        FROM bridge_action_requests;

        DROP TABLE bridge_action_requests;
        DROP TABLE agent_candidates;
        DROP TABLE agent_steps;
        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_v18 RENAME TO agent_runs;
        ALTER TABLE agent_steps_v18 RENAME TO agent_steps;
        ALTER TABLE agent_candidates_v18 RENAME TO agent_candidates;
        ALTER TABLE bridge_action_requests_v18 RENAME TO bridge_action_requests;

        CREATE INDEX agent_runs_project_updated_idx ON agent_runs(project_id, updated_at DESC);
        CREATE INDEX agent_steps_run_position_idx ON agent_steps(run_id, position);
        CREATE INDEX agent_candidates_run_status_idx ON agent_candidates(run_id, status, created_at);
        CREATE INDEX bridge_action_requests_project_status_idx ON bridge_action_requests(project_id, status, created_at DESC);
        CREATE INDEX bridge_action_requests_run_status_idx ON bridge_action_requests(agent_run_id, status, created_at DESC);

        CREATE TABLE agent_provider_settings (
          id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          preferred_backend TEXT NOT NULL DEFAULT 'codex_acp' CHECK(preferred_backend IN ('codex_acp', 'codex_exec')),
          model TEXT NOT NULL DEFAULT '',
          reasoning_effort TEXT NOT NULL DEFAULT 'high',
          fast_mode INTEGER NOT NULL DEFAULT 0 CHECK(fast_mode IN (0, 1)),
          adapter_version TEXT NOT NULL DEFAULT '1.6.2',
          auth_method TEXT NOT NULL DEFAULT 'chatgpt' CHECK(auth_method IN ('chatgpt', 'environment')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_sessions (
          id TEXT PRIMARY KEY,
          agent_run_id TEXT NOT NULL UNIQUE,
          backend TEXT NOT NULL CHECK(backend IN ('codex_acp', 'codex_exec')),
          session_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'initializing'
            CHECK(status IN ('initializing', 'active', 'interrupted', 'closed', 'failed', 'recreated')),
          protocol_version TEXT NOT NULL DEFAULT '',
          adapter_version TEXT NOT NULL DEFAULT '',
          capabilities_json TEXT NOT NULL DEFAULT '{}',
          auth_method TEXT NOT NULL DEFAULT '',
          recovery_strategy TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX agent_sessions_status_idx ON agent_sessions(status, updated_at DESC);

        CREATE TABLE agent_events (
          id TEXT PRIMARY KEY,
          agent_run_id TEXT NOT NULL,
          agent_step_id TEXT,
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          byte_size INTEGER NOT NULL DEFAULT 0 CHECK(byte_size >= 0),
          created_at TEXT NOT NULL,
          UNIQUE(agent_run_id, sequence),
          FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(agent_step_id) REFERENCES agent_steps(id) ON DELETE CASCADE
        );
        CREATE INDEX agent_events_run_sequence_idx ON agent_events(agent_run_id, sequence);

        ALTER TABLE generation_records ADD COLUMN execution_backend TEXT NOT NULL DEFAULT '';
        ALTER TABLE generation_records ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
        ALTER TABLE generation_records ADD COLUMN agent_step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL;
        CREATE INDEX generation_records_agent_run_idx ON generation_records(agent_run_id, created_at DESC);
      `)

      const createdAt = now()
      database.prepare(`
        INSERT INTO agent_provider_settings (
          id, enabled, preferred_backend, model, reasoning_effort, fast_mode,
          adapter_version, auth_method, created_at, updated_at
        ) VALUES ('codex', 1, 'codex_acp', '', 'high', 0, '1.6.2', 'chatgpt', ?, ?)
      `).run(createdAt, createdAt)
    },
  },
  {
    version: 19,
    name: 'project-default-creative-execution-mode',
    up(database) {
      database.exec(`
        ALTER TABLE projects ADD COLUMN default_execution_mode TEXT NOT NULL DEFAULT 'app_model'
          CHECK(default_execution_mode IN ('app_model', 'codex'));
        CREATE INDEX projects_execution_mode_idx ON projects(project_type, default_execution_mode, updated_at DESC);
      `)
    },
  },
  {
    version: 20,
    name: 'story-change-sets-and-atomic-rollback',
    up(database, now) {
      database.exec(`
        CREATE TABLE story_change_sets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          agent_run_id TEXT,
          root_target_key TEXT NOT NULL,
          root_label TEXT NOT NULL DEFAULT '',
          root_before_json TEXT NOT NULL DEFAULT 'null',
          root_after_json TEXT NOT NULL DEFAULT 'null',
          instruction TEXT NOT NULL DEFAULT '',
          scope_json TEXT NOT NULL DEFAULT '{}',
          source_digest TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK(status IN ('draft', 'analyzing', 'waiting_confirmation', 'applied', 'reverted', 'cancelled', 'failed', 'stale')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT '',
          reverted_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
        );
        CREATE INDEX story_change_sets_project_status_idx
          ON story_change_sets(project_id, status, updated_at DESC);
        CREATE INDEX story_change_sets_agent_run_idx ON story_change_sets(agent_run_id);

        CREATE TABLE story_change_items (
          id TEXT PRIMARY KEY,
          change_set_id TEXT NOT NULL,
          target_key TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          target_id TEXT NOT NULL DEFAULT '',
          field_key TEXT NOT NULL DEFAULT '',
          field_label TEXT NOT NULL DEFAULT '',
          before_json TEXT NOT NULL DEFAULT 'null',
          after_json TEXT NOT NULL DEFAULT 'null',
          impact_level TEXT NOT NULL DEFAULT 'suggested'
            CHECK(impact_level IN ('required', 'suggested', 'review')),
          reason TEXT NOT NULL DEFAULT '',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          selected INTEGER NOT NULL DEFAULT 1 CHECK(selected IN (0, 1)),
          apply_order INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'proposed'
            CHECK(status IN ('proposed', 'applied', 'skipped', 'stale', 'reverted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(change_set_id, target_key),
          FOREIGN KEY(change_set_id) REFERENCES story_change_sets(id) ON DELETE CASCADE
        );
        CREATE INDEX story_change_items_set_order_idx
          ON story_change_items(change_set_id, selected DESC, apply_order, created_at);

        CREATE TABLE story_change_snapshots (
          id TEXT PRIMARY KEY,
          change_set_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          target_key TEXT NOT NULL,
          value_json TEXT NOT NULL DEFAULT 'null',
          revision_id TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(change_set_id, target_key),
          FOREIGN KEY(change_set_id) REFERENCES story_change_sets(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES story_change_items(id) ON DELETE CASCADE,
          FOREIGN KEY(revision_id) REFERENCES revisions(id) ON DELETE SET NULL
        );
        CREATE INDEX story_change_snapshots_set_idx ON story_change_snapshots(change_set_id, created_at);
      `)
      const installedAt = now()
      const pack = bundledOfficialPack('1.1.0')
      const manifest = pack.manifest
      database.prepare(`
        INSERT INTO creative_packs (id, name, language, license, source, current_version, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'official', ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, language = excluded.language,
          license = excluded.license, current_version = excluded.current_version, enabled = 1,
          updated_at = excluded.updated_at
      `).run(manifest.id, manifest.name, manifest.language, manifest.license, manifest.version, installedAt, installedAt)
      database.prepare(`
        INSERT INTO creative_pack_versions (
          id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pack_id, version) DO NOTHING
      `).run(
        `${manifest.id}@${manifest.version}`, manifest.id, manifest.version, manifest.minAppVersion,
        manifest.integrity.sha256, JSON.stringify(manifest), JSON.stringify(pack), installedAt,
      )
    },
  },
  {
    version: 21,
    name: 'official-creative-pack-1-2-natural-prose',
    up(database, now) {
      const installedAt = now()
      const pack = bundledOfficialPack('1.2.0')
      const manifest = pack.manifest
      database.prepare(`
        INSERT INTO creative_packs (id, name, language, license, source, current_version, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'official', ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, language = excluded.language,
          license = excluded.license, current_version = excluded.current_version, enabled = 1,
          updated_at = excluded.updated_at
      `).run(manifest.id, manifest.name, manifest.language, manifest.license, manifest.version, installedAt, installedAt)
      database.prepare(`
        INSERT INTO creative_pack_versions (
          id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pack_id, version) DO NOTHING
      `).run(
        `${manifest.id}@${manifest.version}`, manifest.id, manifest.version, manifest.minAppVersion,
        manifest.integrity.sha256, JSON.stringify(manifest), JSON.stringify(pack), installedAt,
      )
    },
  },
  ...creativeUpgradeMigrations.map((migration) => migration.version !== 22 ? migration : {
    ...migration,
    up(database, now) {
      migration.up(database, now)
      const pack = bundledOfficialPack('1.3.0')
      const manifest = pack.manifest
      database.prepare(`UPDATE creative_packs SET current_version = ?, updated_at = ? WHERE id = ?`)
        .run(manifest.version, now(), manifest.id)
      database.prepare(`INSERT OR IGNORE INTO creative_pack_versions
        (id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(`${manifest.id}@${manifest.version}`, manifest.id,
          manifest.version, manifest.minAppVersion, manifest.integrity.sha256, JSON.stringify(manifest), JSON.stringify(pack), now())
      // Existing project bindings deliberately remain pinned until the user confirms an upgrade.
    },
  }),
  {
    version: 27,
    name: 'chatgpt-work-design-sync',
    up(database) {
      database.exec(`
        CREATE TABLE work_design_bindings (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          thread_title TEXT NOT NULL,
          last_applied_version TEXT NOT NULL DEFAULT '',
          last_applied_digest TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE work_design_packages (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          package_version TEXT NOT NULL,
          base_version TEXT NOT NULL DEFAULT '',
          package_digest TEXT NOT NULL,
          source_digest TEXT NOT NULL,
          preview_digest TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL,
          preview_json TEXT NOT NULL,
          results_json TEXT NOT NULL DEFAULT '{}',
          error_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK(status IN ('previewed', 'applying', 'applied', 'failed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT '',
          UNIQUE(project_id, package_version)
        );
        CREATE TABLE work_design_objects (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          object_type TEXT NOT NULL,
          external_ref TEXT NOT NULL,
          target_id TEXT NOT NULL,
          package_version TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id, object_type, external_ref)
        );
        CREATE INDEX work_design_packages_project ON work_design_packages(project_id, created_at DESC);
      `)
    },
  },
  {
    version: 28,
    name: 'zhuque-chapter-detections',
    up(database) {
      database.exec(`
        CREATE TABLE zhuque_chapter_detections (
          chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          manuscript_digest TEXT NOT NULL,
          result_json TEXT NOT NULL,
          checked_at TEXT NOT NULL
        );
        CREATE INDEX zhuque_chapter_detections_project ON zhuque_chapter_detections(project_id);
      `)
    },
  },
  {
    version: 29,
    name: 'zhuque-global-api-keys',
    up(database) {
      database.exec(`
        CREATE TABLE zhuque_api_keys (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          key_cipher TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO zhuque_api_keys (id, label, key_cipher, created_at, updated_at)
          SELECT 'legacy', '原有密钥', value, updated_at, updated_at
          FROM app_settings WHERE key = 'zhuque_api_key_cipher' AND value <> '';
        INSERT INTO app_settings (key, value, updated_at)
          SELECT 'zhuque_selected_key_id', 'legacy', updated_at
          FROM app_settings WHERE key = 'zhuque_api_key_cipher' AND value <> '';
        DELETE FROM app_settings WHERE key = 'zhuque_api_key_cipher';
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

export function runMigrations(database, { now = () => new Date().toISOString(), targetVersion = LATEST_SCHEMA_VERSION } = {}) {
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
      if (migration.version > targetVersion) continue
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

  if (getSchemaVersion(database) >= LATEST_SCHEMA_VERSION) {
    syncBuiltInPromptTemplates(database, now)
  }

  const violations = readForeignKeyCheck(database)
  if (violations.length) {
    const sample = violations.slice(0, 5).map((row) => `${row.table}:${row.rowid}`).join(', ')
    throw new Error(`数据库外键检查失败，共 ${violations.length} 项：${sample}`)
  }
  return getSchemaVersion(database)
}

export function syncBuiltInPromptTemplates(database, now = () => new Date().toISOString()) {
  const createdAt = now()
  const insertTemplate = database.prepare(`
    INSERT OR IGNORE INTO prompt_templates (id, task, name, kind, enabled, current_version, created_at, updated_at)
    VALUES (?, ?, ?, 'built_in', 1, ?, ?, ?)
  `)
  const insertVersion = database.prepare(`
    INSERT OR IGNORE INTO prompt_template_versions (id, template_id, version, content_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const updateTemplate = database.prepare(`
    UPDATE prompt_templates
    SET name = ?, current_version = ?, updated_at = ?
    WHERE id = ? AND kind = 'built_in' AND current_version <= ?
  `)
  for (const template of BUILTIN_PROMPT_TEMPLATES) {
    insertTemplate.run(template.id, template.task, template.name, template.version, createdAt, createdAt)
    insertVersion.run(`${template.id}-version-${template.version}`, template.id, template.version, JSON.stringify(template.content), createdAt)
    updateTemplate.run(template.name, template.version, createdAt, template.id, template.version)
  }
}
