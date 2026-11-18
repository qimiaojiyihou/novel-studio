import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { cleanAutomaticTaskHistory, historyCleanupDue, readHistoryCleanupSettings, saveHistoryCleanupSettings } from '../electron/automatic-history-cleanup.js'
import { runAutomaticHistoryCleanup } from '../electron/storage-maintenance-runner.js'

const OLD = '2026-01-01T00:00:00.000Z'
const NOW = Date.parse('2026-03-01T00:00:00.000Z')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-history-cleanup-'))
  const databasePath = path.join(root, 'library.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE agent_runs(id TEXT PRIMARY KEY,status TEXT,completed_at TEXT,updated_at TEXT);
    CREATE TABLE agent_sessions(agent_run_id TEXT,session_id TEXT,backend TEXT,status TEXT,closed_at TEXT);
    CREATE TABLE agent_events(agent_run_id TEXT,event_type TEXT,payload_json TEXT,created_at TEXT);
    CREATE TABLE agent_candidates(run_id TEXT,status TEXT,evidence_json TEXT,payload_json TEXT,created_at TEXT);
    CREATE TABLE agent_steps(run_id TEXT,status TEXT);
    CREATE TABLE chapters(id TEXT,content TEXT);
    CREATE TABLE generation_records(id TEXT,content TEXT);
    INSERT INTO chapters VALUES('chapter','正文全文');
    INSERT INTO generation_records VALUES('generation','生成记录全文');
  `)
  const archive = path.join(root, 'archived_sessions')
  fs.mkdirSync(archive)
  t.after(() => { database.close(); fs.rmSync(root, { recursive: true, force: true }) })
  function own({ id = randomUUID(), run = randomUUID(), status = 'completed', sessionStatus = 'closed', date = OLD, backend = 'codex_acp' } = {}) {
    database.prepare('INSERT INTO agent_runs VALUES(?,?,?,?)').run(run, status, date, date)
    database.prepare('INSERT INTO agent_sessions VALUES(?,?,?,?,?)').run(run, id, backend, sessionStatus, date)
    return { id, run }
  }
  function file(id, { compressed = false, date = OLD, metaId = id, directory = archive, content } = {}) {
    fs.mkdirSync(directory, { recursive: true })
    const filename = path.join(directory, `rollout-2026-01-01T00-00-00-${id}.jsonl${compressed ? '.zst' : ''}`)
    const text = content ?? `${JSON.stringify({ type: 'session_meta', payload: { id: metaId, cwd: 'novel-workspace' } })}\n${JSON.stringify({ type: 'response_item', payload: '自动任务全文' })}\n`
    fs.writeFileSync(filename, compressed ? zstdCompressSync(Buffer.from(text)) : text)
    fs.utimesSync(filename, new Date(date), new Date(date))
    return filename
  }
  return { root, archive, database, databasePath, own, file, options: { codexHome: root, now: NOW } }
}

test('periodic policy defaults to 10 days, persists disable/retention and validates bounds', t => {
  const f = fixture(t)
  assert.deepEqual(readHistoryCleanupSettings(f.database), { enabled: true, retentionDays: 10 })
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW), true)
  saveHistoryCleanupSettings(f.database, { enabled: false, retentionDays: 14 })
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW), false)
  saveHistoryCleanupSettings(f.database, { enabled: true, lastRunAt: new Date(NOW).toISOString() })
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW + 86_399_999), false)
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW + 86_400_000), true)
  saveHistoryCleanupSettings(f.database, { lastResult: { batchLimited: true } })
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW + 299_999), false)
  assert.equal(historyCleanupDue(readHistoryCleanupSettings(f.database), NOW + 300_000), true)
  for (const retentionDays of [0, 366, '30', 1.5]) assert.throws(() => saveHistoryCleanupSettings(f.database, { retentionDays }))
})

test('worker deletes only expired owned archived JSONL and Zstandard logs, keeping all application data byte-for-byte', async t => {
  const f = fixture(t)
  const first = f.own(), second = f.own()
  const removed = [f.file(first.id), f.file(second.id, { compressed: true })]
  // The overwritten session row must not lose ownership of previous archived turns.
  const previous = randomUUID()
  f.database.prepare('INSERT INTO agent_events VALUES(?,?,?,?)').run(first.run, 'session_archived', JSON.stringify({ sessionId: previous }), OLD)
  removed.push(f.file(previous))
  const previousCandidate = randomUUID()
  f.database.prepare('INSERT INTO agent_candidates VALUES(?,?,?,?,?)').run(first.run, 'accepted', JSON.stringify({ sessionId: previousCandidate, executionBackend: 'codex_acp' }), '候选全文', OLD)
  removed.push(f.file(previousCandidate, { compressed: true }))
  const manual = f.file(randomUUID())
  const activeDirectory = f.file(first.id, { directory: path.join(f.root, 'sessions') })
  const hash = () => createHash('sha256').update(fs.readFileSync(f.databasePath)).digest('hex')
  const before = hash()
  const preview = await cleanAutomaticTaskHistory(f.database, { ...f.options, dryRun: true })
  assert.equal(preview.eligible, 4)
  assert.ok(removed.every(filename => fs.existsSync(filename)))
  const result = await runAutomaticHistoryCleanup(f.databasePath, f.options)
  assert.equal(result.removed, 4)
  assert.ok(result.bytesFreed > 0)
  assert.ok(removed.every(filename => !fs.existsSync(filename)))
  assert.ok(fs.existsSync(manual) && fs.existsSync(activeDirectory))
  assert.equal(hash(), before)
  assert.equal(f.database.prepare('SELECT payload_json FROM agent_candidates').get().payload_json, '候选全文')
})

test('default ten-day retention cleans an eleven-day log and protects logs within the retention window', async t => {
  const f = fixture(t)
  const elevenDays = new Date(NOW - 11 * 86_400_000).toISOString()
  const nineDays = new Date(NOW - 9 * 86_400_000).toISOString()
  const expired = f.file(f.own({ date: elevenDays }).id, { date: elevenDays })
  const recent = f.file(f.own({ date: nineDays }).id, { date: nineDays })
  const boundary = new Date(NOW - 10 * 86_400_000).toISOString()
  const boundaryFile = f.file(f.own({ date: boundary }).id, { date: boundary })
  assert.equal((await cleanAutomaticTaskHistory(f.database, f.options)).removed, 1)
  assert.equal(fs.existsSync(expired), false)
  assert.ok(fs.existsSync(recent) && fs.existsSync(boundaryFile))
})

test('pending candidates, active/shared/failed runs, recent archives and incomplete steps are protected', async t => {
  const f = fixture(t)
  const pending = f.own(), active = f.own({ status: 'running' }), waiting = f.own({ status: 'waiting_confirmation' })
  const open = f.own({ sessionStatus: 'active' }), failed = f.own({ status: 'failed' }), step = f.own()
  const recentArchive = f.own({ date: '2026-02-28T00:00:00.000Z' }), recentFile = f.own()
  f.database.prepare('INSERT INTO agent_candidates VALUES(?,?,?,?,?)').run(pending.run, 'pending', '{}', '待采纳全文', OLD)
  f.database.prepare('INSERT INTO agent_steps VALUES(?,?)').run(step.run, 'interrupted')
  const shared = f.own()
  f.own({ id: shared.id, status: 'running' })
  const otherBackend = f.own({ backend: 'grok_acp' })
  const files = [pending, active, waiting, open, failed, step, recentArchive, shared, otherBackend].map(owner => f.file(owner.id))
  files.push(f.file(recentFile.id, { date: '2026-02-28T00:00:00.000Z' }))
  assert.equal((await cleanAutomaticTaskHistory(f.database, f.options)).removed, 0)
  assert.ok(files.every(filename => fs.existsSync(filename)))
})

test('mismatching metadata, malformed streams and links are skipped; bounded batches resume', async t => {
  const f = fixture(t)
  const mismatch = f.file(f.own().id, { metaId: randomUUID() })
  const broken = f.file(f.own().id, { compressed: true })
  fs.writeFileSync(broken, 'broken zstd')
  fs.utimesSync(broken, new Date(OLD), new Date(OLD))
  const nested = path.join(f.archive, 'nested')
  const nestedFile = f.file(f.own().id, { directory: nested })
  const linkPath = path.join(f.archive, `rollout-date-${f.own().id}.jsonl`)
  try { fs.symlinkSync(mismatch, linkPath) } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error }
  const good = [f.file(f.own().id), f.file(f.own().id)]
  const first = await cleanAutomaticTaskHistory(f.database, { ...f.options, limit: 1 })
  assert.equal(first.removed, 1)
  assert.equal(first.batchLimited, true)
  assert.equal((await cleanAutomaticTaskHistory(f.database, f.options)).removed, 1)
  assert.ok(good.every(filename => !fs.existsSync(filename)))
  assert.ok(fs.existsSync(mismatch) && fs.existsSync(broken) && fs.existsSync(nestedFile))
  if (fs.existsSync(linkPath)) assert.ok(fs.lstatSync(linkPath).isSymbolicLink())
})
