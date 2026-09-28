import { compressStoredReceipt, RECEIPT_PREFIX } from './creative-receipt.js'

const MAX_EVENT_BATCH = 1000
const MAX_RECEIPT_BATCH = 10
const MAX_CHUNK_CHARS = 16000

export function compactRequestReceipts(database, { limit = MAX_RECEIPT_BATCH } = {}) {
  const rows = database.prepare(`
    SELECT id, result_json FROM creative_requests
    WHERE status = 'completed' AND length(result_json) >= 4096
      AND substr(result_json, 1, ?) <> ?
    ORDER BY created_at, rowid LIMIT ?
  `).all(RECEIPT_PREFIX.length, RECEIPT_PREFIX, Math.max(1, Math.min(MAX_RECEIPT_BATCH, limit)))
  if (!rows.length) return { scanned: 0, compressed: 0, bytesBefore: 0, bytesAfter: 0 }
  const updates = rows.map(row => ({ id: row.id, before: row.result_json,
    after: compressStoredReceipt(row.result_json) }))
  database.exec('BEGIN IMMEDIATE')
  try {
    const update = database.prepare("UPDATE creative_requests SET result_json=? WHERE id=? AND status='completed' AND result_json=?")
    let compressed = 0, bytesBefore = 0, bytesAfter = 0
    for (const row of updates) {
      const result = update.run(row.after, row.id, row.before)
      if (!result.changes) continue
      compressed += 1
      bytesBefore += Buffer.byteLength(row.before)
      bytesAfter += Buffer.byteLength(row.after)
    }
    database.exec('COMMIT')
    return { scanned: rows.length, compressed, bytesBefore, bytesAfter }
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
  database.exec('BEGIN IMMEDIATE')
  try {
    const run = database.prepare(`
      SELECT r.id, COALESCE(state.last_sequence, 0) AS cursor
      FROM agent_runs r LEFT JOIN agent_event_compaction_state state ON state.agent_run_id = r.id
      WHERE r.status = 'completed' AND EXISTS (
        SELECT 1 FROM agent_events event
        WHERE event.agent_run_id = r.id AND event.sequence > COALESCE(state.last_sequence, 0)
      )
      ORDER BY r.updated_at, r.id LIMIT 1
    `).get()
    if (!run) {
      database.exec('COMMIT')
      return { runId: '', scanned: 0, removed: 0, lastSequence: 0 }
    }
    const rows = database.prepare(`
      SELECT id, sequence, agent_step_id, event_type, payload_json
      FROM agent_events WHERE agent_run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(run.id, run.cursor, Math.max(1, Math.min(MAX_EVENT_BATCH, limit)))
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
