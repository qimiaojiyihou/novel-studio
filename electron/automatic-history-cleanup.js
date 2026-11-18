import fs from 'node:fs'
import path from 'node:path'
import { createZstdDecompress } from 'node:zlib'

const SETTING = 'automatic_task_history_cleanup'
const DAY = 86_400_000
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const HISTORY_NAME = new RegExp(`^rollout-.+-(${UUID})\\.jsonl(?:\\.zst)?$`, 'i')

export function readHistoryCleanupSettings(database) {
  let saved = {}
  try { saved = JSON.parse(database.prepare('SELECT value FROM app_settings WHERE key=?').get(SETTING)?.value || '{}') } catch { /* use defaults */ }
  return { ...saved, enabled: saved.enabled !== false,
    retentionDays: Number.isInteger(saved.retentionDays) && saved.retentionDays >= 1 && saved.retentionDays <= 365 ? saved.retentionDays : 10 }
}

export function saveHistoryCleanupSettings(database, patch) {
  const current = readHistoryCleanupSettings(database)
  const next = { ...current, ...patch }
  if (typeof next.enabled !== 'boolean' || !Number.isInteger(next.retentionDays) || next.retentionDays < 1 || next.retentionDays > 365) throw new Error('历史保留天数应为 1 至 365 天')
  database.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(SETTING, JSON.stringify(next), new Date().toISOString())
  return next
}

export function historyCleanupDue(settings, now = Date.now()) {
  const interval = settings.lastResult?.batchLimited ? 5 * 60_000 : DAY
  return settings.enabled && (!Number.isFinite(Date.parse(settings.lastRunAt)) || now - Date.parse(settings.lastRunAt) >= interval)
}

// Both current sessions and earlier archived turns belong to a run. Read only
// identifiers from candidate evidence; manuscripts and generation data stay in SQLite.
function sessionOwners(database) {
  const rows = database.prepare(`
    SELECT agent_run_id AS run_id, session_id, backend, closed_at AS recorded_at FROM agent_sessions
    UNION
    SELECT agent_run_id, json_extract(payload_json,'$.sessionId'), 'codex_acp', created_at
      FROM agent_events WHERE event_type='session_archived' AND json_valid(payload_json)
    UNION
    SELECT run_id, json_extract(evidence_json,'$.sessionId'), json_extract(evidence_json,'$.executionBackend'), created_at
      FROM agent_candidates WHERE json_valid(evidence_json)
  `).all()
  const owners = new Map()
  for (const row of rows) {
    if (!new RegExp(`^${UUID}$`, 'i').test(row.session_id || '')) continue
    const id = row.session_id.toLowerCase()
    if (!owners.has(id)) owners.set(id, [])
    owners.get(id).push(row)
  }
  return owners
}

async function readSessionMeta(file) {
  const source = fs.createReadStream(file, { highWaterMark: 16 * 1024 })
  const stream = file.endsWith('.zst') ? source.pipe(createZstdDecompress()) : source
  // pipe does not forward source errors to the decompressor.
  const forwardError = error => stream.destroy(error)
  if (stream !== source) source.on('error', forwardError)
  let header = Buffer.alloc(0)
  try {
    for await (const chunk of stream) {
      header = Buffer.concat([header, chunk])
      const newline = header.indexOf(10)
      if (newline >= 0) {
        if (newline > 1024 * 1024) throw new Error('会话头过大')
        const meta = JSON.parse(header.subarray(0, newline).toString('utf8'))
        return meta.type === 'session_meta' ? meta.payload : null
      }
      if (header.length > 1024 * 1024) throw new Error('会话头过大')
    }
    return null
  } finally {
    stream.destroy()
    source.destroy()
    source.removeListener('error', forwardError)
  }
}

export async function cleanAutomaticTaskHistory(database, { codexHome, retentionDays = 10, now = Date.now(), limit = 100, dryRun = false } = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('历史保留天数应为 1 至 365 天')
  if (!codexHome || !path.isAbsolute(codexHome)) throw new Error('Codex 历史目录应为绝对路径')
  const result = { scanned: 0, removed: 0, bytesFreed: 0, eligible: 0, skipped: 0, errors: 0, dryRun, batchLimited: false }
  const archive = path.resolve(codexHome, 'archived_sessions')
  if (!fs.existsSync(archive)) return result
  // Skip redirected archive directories and individual symbolic links. Never
  // recurse, glob-delete, or modify Codex indexes/databases.
  if (fs.lstatSync(archive).isSymbolicLink() || path.resolve(fs.realpathSync(archive)) !== archive) throw new Error('归档目录存在路径重定向，已跳过清理')
  const owners = sessionOwners(database)
  const runState = database.prepare(`SELECT status, completed_at, updated_at,
    EXISTS(SELECT 1 FROM agent_candidates WHERE run_id=agent_runs.id AND status='pending') AS pending_candidates,
    EXISTS(SELECT 1 FROM agent_sessions WHERE agent_run_id=agent_runs.id AND status<>'closed') AS open_sessions,
    EXISTS(SELECT 1 FROM agent_steps WHERE run_id=agent_runs.id AND status IN ('pending','running','waiting_approval','interrupted')) AS active_steps
    FROM agent_runs WHERE id=?`)
  const cutoff = now - retentionDays * DAY
  const eligibleOwners = references => references.every(ref => {
    const run = runState.get(ref.run_id)
    return ref.backend === 'codex_acp' && Date.parse(ref.recorded_at) < cutoff && run && ['completed', 'cancelled'].includes(run.status)
      && !run.pending_candidates && !run.open_sessions && !run.active_steps
      && Date.parse(run.completed_at || run.updated_at) < cutoff && Date.parse(run.updated_at) < cutoff
  })
  for (const name of fs.readdirSync(archive)) {
    const match = HISTORY_NAME.exec(name)
    if (!match) continue
    result.scanned++
    const id = match[1].toLowerCase(), references = owners.get(id)
    if (!references?.length || !eligibleOwners(references)) { result.skipped++; continue }
    const file = path.resolve(archive, name)
    if (path.dirname(file) !== archive) { result.skipped++; continue }
    try {
      const before = fs.lstatSync(file)
      if (!before.isFile() || before.isSymbolicLink() || before.mtimeMs >= cutoff) { result.skipped++; continue }
      const meta = await readSessionMeta(file)
      if (String(meta?.id || meta?.session_id || '').toLowerCase() !== id) { result.skipped++; continue }
      // Recheck the file and run after async I/O, before the single-file unlink.
      const after = fs.lstatSync(file)
      if (!after.isFile() || after.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !eligibleOwners(references)) { result.skipped++; continue }
      result.eligible++
      if (!dryRun) { fs.unlinkSync(file); result.removed++; result.bytesFreed += before.size }
      if (result.eligible >= limit) { result.batchLimited = true; break }
    } catch (error) {
      if (error.code !== 'ENOENT') result.errors++
    }
  }
  return result
}
