import { compressStoredReceipt, RECEIPT_PREFIX } from './creative-receipt.js'

const MAX_EVENT_BATCH = 1000
const MAX_RECEIPT_BATCH = 10
const MAX_CHUNK_CHARS = 16000

export function compactRequestReceipts(database, { limit = MAX_RECEIPT_BATCH } = {}) {
  // New/late-completing receipts are queued by triggers. Legacy rows are visited
  // once, in bounded rowid pages; compressed multi-megabyte rows are not rescanned.
  database.exec(`
    CREATE TABLE IF NOT EXISTS receipt_compaction_queue (request_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS receipt_compaction_cursor (id INTEGER PRIMARY KEY CHECK(id=1), last_rowid INTEGER NOT NULL);
    INSERT OR IGNORE INTO receipt_compaction_cursor VALUES (1,0);
    CREATE TRIGGER IF NOT EXISTS receipt_compaction_insert AFTER INSERT ON creative_requests
      WHEN NEW.status='completed' AND length(NEW.result_json)>=4096 AND substr(NEW.result_json,1,${RECEIPT_PREFIX.length})<>'${RECEIPT_PREFIX}'
      BEGIN INSERT OR IGNORE INTO receipt_compaction_queue VALUES (NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS receipt_compaction_update AFTER UPDATE OF status,result_json ON creative_requests
      WHEN NEW.status='completed' AND length(NEW.result_json)>=4096 AND substr(NEW.result_json,1,${RECEIPT_PREFIX.length})<>'${RECEIPT_PREFIX}'
      BEGIN INSERT OR IGNORE INTO receipt_compaction_queue VALUES (NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS receipt_compaction_delete AFTER DELETE ON creative_requests
      BEGIN DELETE FROM receipt_compaction_queue WHERE request_id=OLD.id; END;
  `)
  const cursor = database.prepare('SELECT last_rowid FROM receipt_compaction_cursor WHERE id=1').get().last_rowid
  const legacy = database.prepare(`SELECT rowid,id FROM creative_requests WHERE rowid>? ORDER BY rowid LIMIT 100`).all(cursor)
  database.exec('BEGIN IMMEDIATE')
  try {
    if (legacy.length) {
      database.prepare(`INSERT OR IGNORE INTO receipt_compaction_queue SELECT id FROM creative_requests
        WHERE rowid>? AND rowid<=? AND status='completed' AND length(result_json)>=4096
        AND substr(result_json,1,?)<>?`).run(cursor, legacy.at(-1).rowid, RECEIPT_PREFIX.length, RECEIPT_PREFIX)
      database.prepare('UPDATE receipt_compaction_cursor SET last_rowid=? WHERE id=1').run(legacy.at(-1).rowid)
    }
    database.exec('COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  const rows = database.prepare(`
    SELECT queue.request_id AS id, request.status, request.result_json FROM receipt_compaction_queue queue
    LEFT JOIN creative_requests request ON request.id=queue.request_id LIMIT ?
  `).all(Math.max(1, Math.min(MAX_RECEIPT_BATCH, limit)))
  if (!rows.length) return { scanned: legacy.length, compressed: 0, bytesBefore: 0, bytesAfter: 0 }
  const updates = rows.map(row => ({ id: row.id, before: row.result_json,
    after: row.status === 'completed' && row.result_json ? compressStoredReceipt(row.result_json) : null }))
  database.exec('BEGIN IMMEDIATE')
  try {
    const update = database.prepare("UPDATE creative_requests SET result_json=? WHERE id=? AND status='completed' AND result_json=?")
    let compressed = 0, bytesBefore = 0, bytesAfter = 0
    for (const row of updates) {
      if (!row.after || row.after === row.before) {
        database.prepare(`DELETE FROM receipt_compaction_queue WHERE request_id=? AND NOT EXISTS (
          SELECT 1 FROM creative_requests WHERE id=? AND status='completed' AND length(result_json)>=4096
            AND substr(result_json,1,?)<>?)`).run(row.id, row.id, RECEIPT_PREFIX.length, RECEIPT_PREFIX)
        continue
      }
      const result = update.run(row.after, row.id, row.before)
      if (!result.changes) continue
      database.prepare('DELETE FROM receipt_compaction_queue WHERE request_id=?').run(row.id)
      compressed += 1
      bytesBefore += Buffer.byteLength(row.before)
      bytesAfter += Buffer.byteLength(row.after)
    }
    database.exec('COMMIT')
    return { scanned: rows.length + legacy.length, compressed, bytesBefore, bytesAfter }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const MERGEABLE_PAYLOAD_KEYS = new Set(['content', 'messageId', '_meta', 'sessionUpdate'])

function eventText(row) {
  try {
    const payload = JSON.parse(row.payload_json)
    if (!payload || Object.keys(payload).some(key => !MERGEABLE_PAYLOAD_KEYS.has(key))
      || !payload.content || Object.keys(payload.content).length !== 2
      || payload.content.type !== 'text' || typeof payload.content.text !== 'string') return null
    const metadata = { ...payload, content: { ...payload.content, text: '' } }
    return { text: payload.content.text, metadataKey: JSON.stringify(metadata), payload }
  } catch { return null }
}

export function compactCompletedEventBatch(database, { limit = MAX_EVENT_BATCH, maxChunkChars = MAX_CHUNK_CHARS, now = () => new Date().toISOString() } = {}) {
  // Finding the next stream may examine many completed runs. Do this without
  // taking the writer lock; recheck its cursor/status inside the short batch.
  const run = database.prepare(`
      SELECT r.id, COALESCE(state.last_sequence, 0) AS cursor
      FROM agent_runs r LEFT JOIN agent_event_compaction_state state ON state.agent_run_id = r.id
      WHERE r.status = 'completed' AND EXISTS (
        SELECT 1 FROM agent_events event
        WHERE event.agent_run_id = r.id AND event.sequence > COALESCE(state.last_sequence, 0)
      )
      ORDER BY r.updated_at, r.id LIMIT 1
    `).get()
  const idle = { runId: '', scanned: 0, removed: 0, lastSequence: 0 }
  if (!run) return idle
  database.exec('BEGIN IMMEDIATE')
  try {
    const current = database.prepare(`SELECT r.status,COALESCE(state.last_sequence,0) AS cursor FROM agent_runs r
      LEFT JOIN agent_event_compaction_state state ON state.agent_run_id=r.id WHERE r.id=?`).get(run.id)
    if (current?.status !== 'completed' || current.cursor !== run.cursor) {
      database.exec('COMMIT')
      return idle
    }
    const rows = database.prepare(`
      SELECT id, sequence, agent_step_id, event_type, payload_json
      FROM agent_events WHERE agent_run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(run.id, run.cursor, Math.max(1, Math.min(MAX_EVENT_BATCH, limit)))
    if (!rows.length) { database.exec('COMMIT'); return idle }
    const update = database.prepare(`UPDATE agent_events SET summary=?, payload_json=?, byte_size=? WHERE id=? AND agent_run_id=?`)
    const remove = database.prepare(`DELETE FROM agent_events WHERE agent_run_id=? AND agent_step_id IS ?
      AND event_type='text_delta' AND sequence>=? AND sequence<?`)
    let group = [], text = '', removed = 0, metadataKey = ''
    const flush = () => {
      if (group.length > 1) {
        const last = group.at(-1)
        const payload = JSON.stringify({ ...last.parsed.payload,
          content: { ...last.parsed.payload.content, text } })
        update.run(text.slice(0, 200), payload, Buffer.byteLength(payload), last.id, run.id)
        removed += Number(remove.run(run.id, last.agent_step_id, group[0].sequence, last.sequence).changes)
      }
      group = []
      text = ''
      metadataKey = ''
    }
    for (const row of rows) {
      const parsed = row.event_type === 'text_delta' ? eventText(row) : null
      if (parsed === null || (group.length && (group[0].agent_step_id !== row.agent_step_id
        || metadataKey !== parsed.metadataKey || text.length + parsed.text.length > maxChunkChars))) flush()
      if (parsed !== null) {
        group.push({ ...row, parsed })
        text += parsed.text
        metadataKey = parsed.metadataKey
      }
    }
    flush()
    const lastSequence = rows.at(-1).sequence
    database.prepare(`INSERT INTO agent_event_compaction_state (agent_run_id, last_sequence, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(agent_run_id) DO UPDATE SET
        last_sequence=excluded.last_sequence, updated_at=excluded.updated_at`).run(run.id, lastSequence, now())
    database.exec('COMMIT')
    return { runId: run.id, scanned: rows.length, removed, lastSequence }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
