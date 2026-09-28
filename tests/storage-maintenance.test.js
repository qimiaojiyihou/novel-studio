import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { compactCompletedEventBatch, compactRequestReceipts } from '../electron/storage-maintenance.js'
import { runStorageMaintenanceBatch } from '../electron/storage-maintenance-runner.js'
import { decodeCreativeReceipt, encodeCreativeReceipt, RECEIPT_PREFIX } from '../electron/creative-receipt.js'
import { recoverCodexStream } from '../src/utils/codex-stream.js'

test('completed event streams compact without crossing book, step or approval boundaries and resume after restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'novel-storage-test-'))
  const databasePath = path.join(directory, 'synthetic.sqlite')
  assert.ok(databasePath.startsWith(`${tmpdir()}${path.sep}`))
  let database = new DatabaseSync(databasePath)
  try {
    runMigrations(database)
    const repository = createWorkspaceRepository(database)
    const books = ['模拟 A', '模拟 B'].map(title => repository.createProject({ title }))
    const time = '2026-09-28T00:00:00.000Z'
    const insertRun = database.prepare(`INSERT INTO agent_runs
      (id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version, creative_pack_digest, status, created_at, updated_at)
      VALUES (?, ?, ?, 'test', ?, ?, 'digest', ?, ?, ?) `)
    const insertStep = database.prepare(`INSERT INTO agent_steps (id, run_id, step_key, position, action, created_at, updated_at)
      VALUES (?, ?, 'test', 1, 'generate', ?, ?) `)
    const insertEvent = database.prepare(`INSERT INTO agent_events
      (id, agent_run_id, agent_step_id, sequence, event_type, summary, payload_json, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) `)
    for (const [index, book] of books.entries()) {
      const binding = database.prepare('SELECT pack_id, pack_version FROM project_pack_bindings WHERE project_id=?').get(book.project.id)
      insertRun.run(`run-${index}`, book.project.id, book.chapters[0].id, binding.pack_id, binding.pack_version,
        index ? 'waiting_confirmation' : 'completed', time, time)
      insertStep.run(`step-${index}`, `run-${index}`, time, time)
      for (let sequence = 1; sequence <= 220; sequence++) {
        const type = sequence === 111 ? 'approval_request' : 'text_delta'
        const piece = `书${index}片段${sequence}。`
        const payload = JSON.stringify(index ? { content: { type: 'text', text: piece } } : {
          content: { type: 'text', text: piece },
          messageId: sequence <= 100 ? 'message-a' : 'message-b',
          _meta: { codex: { phase: 'commentary' } },
          sessionUpdate: 'agent_message_chunk',
        })
        insertEvent.run(`event-${index}-${sequence}`, `run-${index}`, `step-${index}`, sequence, type, piece,
          payload, Buffer.byteLength(payload), time)
      }
    }
    const original = database.prepare('SELECT * FROM agent_events WHERE agent_run_id=? ORDER BY sequence').all('run-0')
    const expected = recoverCodexStream(original.map(row => ({ type: row.event_type, summary: row.summary, payload: JSON.parse(row.payload_json) })))
    let removed = 0
    for (let i = 0; i < 5; i++) removed += compactCompletedEventBatch(database, { limit: 40 }).removed
    assert.ok(removed > 100)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM agent_events WHERE agent_run_id=?').get('run-1').n, 220)
    database.close()
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA foreign_keys=ON')
    for (let i = 0; i < 10; i++) compactCompletedEventBatch(database, { limit: 40 })
    const compacted = database.prepare('SELECT * FROM agent_events WHERE agent_run_id=? ORDER BY sequence').all('run-0')
    const actual = recoverCodexStream(compacted.map(row => ({ type: row.event_type, summary: row.summary, payload: JSON.parse(row.payload_json) })))
    assert.equal(actual, expected)
    assert.ok(compacted.length < 15)
    assert.equal(compacted.find(row => row.event_type === 'approval_request').sequence, 111)
    for (const row of compacted.filter(row => row.event_type === 'text_delta')) {
      const payload = JSON.parse(row.payload_json)
      assert.equal(payload.messageId, row.sequence <= 100 ? 'message-a' : 'message-b')
      assert.equal(payload.sessionUpdate, 'agent_message_chunk')
      assert.deepEqual(payload._meta, { codex: { phase: 'commentary' } })
    }
    assert.equal(database.prepare('SELECT last_sequence FROM agent_event_compaction_state WHERE agent_run_id=?').get('run-0').last_sequence, 220)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('schema v32 reschedules runs skipped by the first legacy-safe compactor', () => {
  const database = new DatabaseSync(':memory:')
  try {
    runMigrations(database, { targetVersion: 31 })
    const book = createWorkspaceRepository(database).createProject({ title: '模拟书' })
    const binding = database.prepare('SELECT pack_id,pack_version FROM project_pack_bindings WHERE project_id=?').get(book.project.id)
    database.prepare(`INSERT INTO agent_runs (id,project_id,chapter_id,workflow_id,creative_pack_id,creative_pack_version,
      creative_pack_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'completed','now','now')`)
      .run('run', book.project.id, book.chapters[0].id, 'test', binding.pack_id, binding.pack_version, 'digest')
    database.prepare('INSERT INTO agent_event_compaction_state VALUES (?,?,?)').run('run', 500, 'now')
    runMigrations(database)
    assert.equal(database.prepare('SELECT COUNT(*) n FROM agent_event_compaction_state').get().n, 0)
  } finally { database.close() }
})

test('large receipts round-trip exactly and background compression is idempotent', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'novel-receipt-test-'))
  const databasePath = path.join(directory, 'synthetic.sqlite')
  assert.ok(databasePath.startsWith(`${tmpdir()}${path.sep}`))
  const database = new DatabaseSync(databasePath)
  try {
    runMigrations(database)
    const project = createWorkspaceRepository(database).createProject({ title: '模拟书' }).project
    database.exec(`CREATE TABLE creative_clients (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, title TEXT, token_hash TEXT, created_at TEXT, revoked_at TEXT);
      CREATE TABLE creative_requests (id TEXT PRIMARY KEY, client_id TEXT REFERENCES creative_clients(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      request_key TEXT, operation TEXT, fingerprint TEXT, payload_json TEXT, status TEXT, result_json TEXT, error_json TEXT, created_at TEXT, updated_at TEXT);`)
    const result = { text: '长期保留的模拟创作内容。'.repeat(1000), status: 'completed' }
    const raw = JSON.stringify(result)
    const encoded = await encodeCreativeReceipt(result)
    assert.ok(encoded.startsWith(RECEIPT_PREFIX))
    assert.deepEqual(decodeCreativeReceipt(encoded), result)
    database.prepare('INSERT INTO creative_clients VALUES (?,?,?,?,?,?)').run('client', project.id, 'fixture', 'hash', 'now', '')
    database.prepare('INSERT INTO creative_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('request', 'client', project.id, 'key', 'test', 'fingerprint', '{}', 'completed', raw, '{}', 'now', 'now')
    const batch = await runStorageMaintenanceBatch(databasePath)
    assert.equal(batch.receipts.compressed, 1)
    assert.equal(batch.events.scanned, 0)
    assert.equal(compactRequestReceipts(database).compressed, 0)
    assert.deepEqual(decodeCreativeReceipt(database.prepare('SELECT result_json FROM creative_requests').get().result_json), result)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
