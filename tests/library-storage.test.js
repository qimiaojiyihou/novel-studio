import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { migrateStorage, libraryManifest } from '../electron/storage-migration.js'
import { runStorageMigration } from '../electron/storage-migration-runner.js'
import { queueStorageMigration, readStorageConfig, writeStorageConfig, resolveStorageDirectory,
  cancelStorageMigration, commitStorageMigration, validateStorageTarget } from '../electron/storage-location.js'
import { boundChapterDetails } from '../src/utils/chapter-catalog.js'

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'novel-library-test-')))
  const source = path.join(root, '原书库'), target = path.join(root, '新书库')
  fs.mkdirSync(source); fs.mkdirSync(target)
  const file = path.join(source, 'novel-studio.sqlite')
  // Assert the concrete path, not just the environment, before any test write.
  assert.ok(path.resolve(file).startsWith(`${fs.realpathSync(root)}${path.sep}`))
  const database = new DatabaseSync(file)
  runMigrations(database)
  const repository = createWorkspaceRepository(database)
  const a = repository.createProject({ title: '模拟 A' }), b = repository.createProject({ title: '模拟 B' })
  repository.updateChapter({ id: a.chapters[0].id, manuscript: '甲书的正文。\n第二段。' })
  repository.updateChapter({ id: b.chapters[0].id, manuscript: '乙书不同的正文。' })
  repository.createRevision({ chapterId: a.chapters[0].id, content: '历史版本。', source: 'manual' })
  const pack = JSON.parse(database.prepare(`SELECT version.content_json FROM project_pack_bindings binding
    JOIN creative_pack_versions version ON version.pack_id=binding.pack_id AND version.version=binding.pack_version
    WHERE binding.project_id=?`).get(a.project.id).content_json)
  const agents = createCodexRepository(database)
  const run = agents.createRun({ projectId: a.project.id, chapterId: a.chapters[0].id, workflowId: pack.workflows[0].id,
    executionMode: 'codex', modelRoutes: { codexModel: 'fixture-only', codexReasoningEffort: 'xhigh' } })
  agents.createCandidate({ runId: run.id, stepId: run.steps[0].id, projectId: a.project.id, chapterId: a.chapters[0].id,
    artifactType: 'manuscript', sourceDigest: 'fixture-source', payload: { manuscript: '只保留在候选区的模拟正文。' } })
  agents.upsertSession({ agentRunId: run.id, sessionId: 'fixture-session', status: 'interrupted' })
  agents.createApproval({ projectId: a.project.id, agentRunId: run.id, agentStepId: run.steps[0].id,
    actionType: 'project_write', payload: { fixture: true } })
  agents.updateRun(run.id, { status: 'waiting_approval' })
  database.exec('CREATE TABLE migration_fixture (id INTEGER PRIMARY KEY, data BLOB); INSERT INTO migration_fixture VALUES (1,zeroblob(2097152)); DELETE FROM migration_fixture;')
  // A legacy external binding/receipt and unfinished run must survive unchanged.
  database.exec(`CREATE TABLE creative_clients (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), token_hash TEXT);
    CREATE TABLE creative_requests (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), status TEXT, result_json TEXT);
    INSERT INTO creative_clients VALUES ('client-a','${a.project.id}','opaque-credential-hash');
    INSERT INTO creative_requests VALUES ('request-a','${a.project.id}','running','{}');`)
  fs.mkdirSync(path.join(source, 'codex-projects', '模拟 A'), { recursive: true })
  fs.writeFileSync(path.join(source, 'codex-projects', '模拟 A', '.novel-studio-project.json'), JSON.stringify({ projectId: a.project.id }))
  fs.mkdirSync(path.join(source, 'backups'))
  fs.writeFileSync(path.join(source, 'backups', 'fixture.txt'), '保留模拟备份')
  database.close()
  return { root, source, target, file, a, b, cleanup() { fs.rmSync(root, { recursive: true, force: true }) } }
}

test('migration compacts a consistent SQLite snapshot including WAL, verifies every table and preserves source and project bindings', async () => {
  const f = fixture()
  try {
    const live = new DatabaseSync(f.file)
    live.exec("PRAGMA journal_mode=WAL; INSERT INTO migration_fixture VALUES(2,'来自 WAL 的内容')")
    const before = libraryManifest(live)
    const pending = queueStorageMigration(f.source, f.target)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    const progress = []
    const result = await runStorageMigration(pending, text => progress.push(text))
    assert.ok(progress.length > 0)
    assert.ok(result.verification.destinationBytes < result.verification.sourceBytes)
    assert.deepEqual(libraryManifest(live), before)
    const targetDatabase = new DatabaseSync(path.join(f.target, 'novel-studio.sqlite'), { readOnly: true })
    assert.deepEqual(libraryManifest(targetDatabase), before)
    targetDatabase.close(); live.close()
    assert.equal(fs.readFileSync(path.join(f.target, 'backups', 'fixture.txt'), 'utf8'), '保留模拟备份')
    commitStorageMigration(f.source, pending, result)
    assert.equal(resolveStorageDirectory(f.source), f.target)
    assert.equal(readStorageConfig(f.source).previousDirectory, f.source)
    assert.ok(fs.existsSync(f.file))
    // Repeated recovery after a lost completion response re-verifies, never duplicates.
    const repeated = await migrateStorage(pending)
    assert.equal(repeated.verification.manifestDigest, result.verification.manifestDigest)
  } finally { f.cleanup() }
})

test('target validation rejects existing data, nested directories, relative paths and symlink aliases', () => {
  const f = fixture()
  try {
    assert.throws(() => validateStorageTarget(f.source, 'relative'), /绝对路径/)
    const nested = path.join(f.source, 'child'); fs.mkdirSync(nested)
    assert.throws(() => validateStorageTarget(f.source, nested), /相互独立/)
    assert.throws(() => validateStorageTarget(f.source, f.root), /相互独立/)
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.source, alias, 'dir')
    assert.throws(() => validateStorageTarget(f.source, alias), /相互独立/)
    fs.writeFileSync(path.join(f.target, 'user.txt'), '用户文件')
    assert.throws(() => queueStorageMigration(f.source, f.target), /空文件夹/)
    assert.equal(fs.readFileSync(path.join(f.target, 'user.txt'), 'utf8'), '用户文件')
    writeStorageConfig(f.source, { schemaVersion: 1, directory: f.source, pending: { jobId: '../escape', sourceDirectory: f.source, targetDirectory: f.target } })
    assert.throws(() => readStorageConfig(f.source), /迁移计划无效/)
  } finally { f.cleanup() }
})

test('insufficient space and copy failure leave active location and original manuscripts intact', async () => {
  const f = fixture()
  try {
    const pending = queueStorageMigration(f.source, f.target)
    await assert.rejects(migrateStorage(pending, { availableBytes: 0 }), /空间不足/)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    assert.deepEqual(fs.readdirSync(f.target), [])
    await assert.rejects(migrateStorage(pending, { beforePublish() { throw new Error('fixture publication failure') } }), /fixture publication failure/)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    assert.ok(fs.existsSync(path.join(f.target, `.migration-${pending.jobId}`, 'novel-studio.sqlite')))
    await assert.rejects(migrateStorage(pending), /未完成的迁移文件/)
    cancelStorageMigration(f.source)
    assert.equal(readStorageConfig(f.source).pending, undefined)
  } finally { f.cleanup() }
})

test('missing custom drive stops rather than creating an empty library; corrupted destination never activates', async () => {
  const f = fixture()
  try {
    const pending = queueStorageMigration(f.source, f.target)
    const result = await migrateStorage(pending)
    const bad = new DatabaseSync(path.join(f.target, 'novel-studio.sqlite'))
    bad.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('被改变的模拟内容', f.a.chapters[0].id)
    bad.close()
    await assert.rejects(migrateStorage(pending), /内容校验不一致/)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    cancelStorageMigration(f.source)
    writeStorageConfig(f.source, { schemaVersion: 1, directory: path.join(f.root, 'missing'), previousDirectory: f.source })
    assert.throws(() => resolveStorageDirectory(f.source), /未就绪/)
    assert.equal(fs.existsSync(path.join(f.root, 'missing')), false)
    assert.throws(() => commitStorageMigration(f.source, pending, result), /迁移计划发生变化/)
  } finally { f.cleanup() }
})

test('asset symlinks and source changes are refused without publishing a library', async () => {
  const f = fixture()
  try {
    fs.symlinkSync(f.file, path.join(f.source, 'backups', 'alias.sqlite'))
    const pending = queueStorageMigration(f.source, f.target)
    await assert.rejects(migrateStorage(pending), /符号链接/)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    assert.deepEqual(fs.readdirSync(f.target), [])
  } finally { f.cleanup() }
})

test('source mutation during migration prevents activating a stale snapshot', async () => {
  const f = fixture()
  try {
    const pending = queueStorageMigration(f.source, f.target)
    await assert.rejects(migrateStorage(pending, { beforePublish() {
      const changed = new DatabaseSync(f.file)
      changed.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('迁移期间新的模拟稿', f.a.chapters[0].id)
      changed.close()
    } }), /源书库发生变化/)
    assert.equal(resolveStorageDirectory(f.source), f.source)
    assert.equal(fs.existsSync(path.join(f.target, 'novel-studio.sqlite')), false)
  } finally { f.cleanup() }
})

test('500-chapter navigation transfers one body, statistics remain transactional and cross-project detail access is rejected', () => {
  const db = new DatabaseSync(':memory:')
  try {
    runMigrations(db)
    const repo = createWorkspaceRepository(db)
    const a = repo.createProject({ title: '模拟五百章' }), b = repo.createProject({ title: '另一书' })
    const manuscript = '甲'.repeat(3000)
    const insert = db.prepare(`INSERT INTO chapters (id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at)
      VALUES(?,?,?,?,'draft','{}','',?,'now')`)
    db.exec('BEGIN')
    for (let i=2;i<=500;i++) insert.run(`chapter-large-${i}`, a.project.id, i, `章${i}`, manuscript)
    db.exec('COMMIT')
    const loaded = repo.loadWorkspaceCatalog(a.project.id)
    assert.equal(loaded.chapters.length, 500)
    assert.equal(loaded.chapters.filter(chapter => Object.hasOwn(chapter, 'manuscript')).length, 1)
    assert.ok(JSON.stringify(loaded).length < 300_000)
    assert.equal(repo.listProjects().find(project => project.id === a.project.id).characterCount, 499*3000)
    assert.equal(repo.getChapter({ projectId: a.project.id, chapterId: 'chapter-large-500' }).manuscript, manuscript)
    assert.throws(() => repo.getChapter({ projectId: b.project.id, chapterId: 'chapter-large-500' }), /不属于/)
    const selected = repo.activeProjectId()
    repo.loadWorkspaceCatalog(b.project.id, { select: false })
    assert.equal(repo.activeProjectId(), selected)
    db.exec('BEGIN')
    db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('乙', 'chapter-large-500')
    db.exec('ROLLBACK')
    assert.equal(repo.listProjects().find(project => project.id === a.project.id).characterCount, 499*3000)
    repo.updateChapter({ id: 'chapter-large-500', manuscript: '乙' })
    assert.equal(repo.listProjects().find(project => project.id === a.project.id).characterCount, 498*3000+1)
    const all = repo.loadWorkspaceSnapshot(a.project.id).chapters
    const trimmed = boundChapterDetails(all, all.slice(-8).map(chapter => chapter.id), all.at(-1).id)
    assert.equal(trimmed.filter(chapter => Object.hasOwn(chapter, 'manuscript')).length, 8)
    assert.equal(trimmed.at(-1).manuscript, '乙')
    assert.equal(boundChapterDetails(all, [], all.at(-1).id, 1).filter(chapter => Object.hasOwn(chapter, 'manuscript')).length, 1)
  } finally { db.close() }
})
