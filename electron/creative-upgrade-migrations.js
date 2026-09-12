export const creativeUpgradeMigrations = [
  { version: 22, name: 'chapter-finalization-and-frozen-creative-preferences', up(db) {
    db.exec(`
      ALTER TABLE projects ADD COLUMN creative_preferences_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE agent_runs ADD COLUMN frozen_context_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
      ALTER TABLE agent_runs ADD COLUMN connection_released_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE agent_steps ADD COLUMN prompt_snapshot_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE chapter_finalizations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
        source_digest TEXT NOT NULL, manuscript TEXT NOT NULL, reviewer_json TEXT NOT NULL,
        reviewer_digest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'checking',
        checks_json TEXT NOT NULL DEFAULT '{}', review_json TEXT NOT NULL DEFAULT '{}',
        state_json TEXT NOT NULL DEFAULT '{}', handoff_json TEXT NOT NULL DEFAULT '{}',
        review_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        state_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        override_reason TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX chapter_finalizations_source ON chapter_finalizations(chapter_id, source_digest, reviewer_digest);
      CREATE TRIGGER chapter_finalization_stale AFTER UPDATE OF manuscript ON chapters
      WHEN NEW.manuscript != OLD.manuscript BEGIN
        UPDATE chapters SET status = 'draft' WHERE id = NEW.id AND status = 'completed';
        UPDATE chapter_finalizations SET status = 'stale', updated_at = NEW.updated_at
        WHERE chapter_id = NEW.id AND status NOT IN ('cancelled','stale');
      END;
    `)
  } },
  { version: 23, name: 'author-style-discussions-and-protected-patches', up(db) {
    db.exec(`
      CREATE TABLE author_style_samples (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
        revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
        source_digest TEXT NOT NULL, text TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE creative_messages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
        role TEXT NOT NULL, mode TEXT NOT NULL, content TEXT NOT NULL,
        source_digest TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE manuscript_protections (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        source_digest TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
        text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE creative_patches (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        candidate_id TEXT REFERENCES agent_candidates(id) ON DELETE CASCADE,
        source_digest TEXT NOT NULL, scope_json TEXT NOT NULL, patches_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
      );
    `)
  } },
  { version: 24, name: 'evidence-aware-memory-and-artifact-dependencies', up(db) {
    db.exec(`
      ALTER TABLE chapter_memories ADD COLUMN source_digest TEXT NOT NULL DEFAULT '';
      ALTER TABLE chapter_memories ADD COLUMN source_revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL;
      ALTER TABLE chapter_memories ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE chapter_memories ADD COLUMN handoff_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE chapter_memories ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE chapter_memories ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE knowledge_items ADD COLUMN source_revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL;
      ALTER TABLE knowledge_items ADD COLUMN source_digest TEXT NOT NULL DEFAULT '';
      ALTER TABLE knowledge_items ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE knowledge_items ADD COLUMN effective_from_chapter INTEGER;
      ALTER TABLE knowledge_items ADD COLUMN effective_to_chapter INTEGER;
      ALTER TABLE knowledge_items ADD COLUMN knowledge_scope_json TEXT NOT NULL DEFAULT '{"author":true}';
      CREATE TABLE creative_dependencies (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_kind TEXT NOT NULL, artifact_id TEXT NOT NULL,
        target_key TEXT NOT NULL, source_digest TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, UNIQUE(artifact_kind, artifact_id, target_key)
      );
      CREATE INDEX creative_dependencies_target ON creative_dependencies(project_id, target_key);
      CREATE TRIGGER chapter_confirmed_memory_dirty AFTER UPDATE OF manuscript ON chapters
      WHEN NEW.manuscript != OLD.manuscript BEGIN
        UPDATE chapter_memories SET needs_review = 1 WHERE chapter_id = NEW.id AND confirmed = 1;
      END;
    `)
  } },
  { version: 25, name: 'qoder-acp-agent-provider', up(db) {
    db.exec(`
      ALTER TABLE agent_provider_settings ADD COLUMN agent_provider TEXT NOT NULL DEFAULT 'codex'
        CHECK(agent_provider IN ('codex', 'qoder'));
      ALTER TABLE agent_provider_settings ADD COLUMN qoder_cli_path TEXT NOT NULL DEFAULT '';

      CREATE TABLE agent_sessions_v25 (
        id TEXT PRIMARY KEY,
        agent_run_id TEXT NOT NULL UNIQUE,
        backend TEXT NOT NULL CHECK(backend IN ('codex_acp', 'codex_exec', 'qoder_acp')),
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
      INSERT INTO agent_sessions_v25 SELECT * FROM agent_sessions;
      DROP TABLE agent_sessions;
      ALTER TABLE agent_sessions_v25 RENAME TO agent_sessions;
      CREATE INDEX agent_sessions_status_idx ON agent_sessions(status, updated_at DESC);
    `)
  } },
  { version: 26, name: 'qoder-acp-model-selection', up(db) {
    db.exec(`
      ALTER TABLE agent_provider_settings ADD COLUMN qoder_model TEXT NOT NULL DEFAULT 'auto';
    `)
  } },
]
