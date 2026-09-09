import { createHash, randomUUID } from 'node:crypto'
import { checkManuscript } from './manuscript-checks.js'
import { COMPACT_HANDOFF_MODE, correctStateEvidence, stateEvidenceIssues } from './chapter-handoff.js'

export const contentDigest = (value) => createHash('sha256').update(String(value)).digest('hex')
const parse = (value) => JSON.parse(value || '{}')
const jsonFields = ['reviewer', 'checks', 'review', 'state', 'handoff']
function mapped(row) {
  if (!row) return null
  const record = { ...row, ...Object.fromEntries(jsonFields.map(key => [key, parse(row[`${key}_json`])])) }
  return { ...record, stateDigest: contentDigest(record.state_json),
    stateIssues: Object.keys(record.state).length ? stateEvidenceIssues(record.state, record.manuscript) : [] }
}

export function validateStateEvidence(state, manuscript) {
  return stateEvidenceIssues(state, manuscript).map(issue => issue.message)
}

export function createFinalizationRepository(db, { now = () => new Date().toISOString() } = {}) {
  const raw = (id) => db.prepare('SELECT * FROM chapter_finalizations WHERE id = ?').get(id)
  function get(id) { return mapped(raw(id)) }
  function current(record) {
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ? AND project_id = ?').get(record.chapter_id, record.project_id)
    if (!chapter || contentDigest(chapter.manuscript) !== record.source_digest) {
      if (chapter) patch(record.id, { status: 'stale' })
      throw new Error('正文已改变，本次定稿已过期。请保存新稿后重新检查。')
    }
    return chapter
  }
  function patch(id, values) {
    const permitted = new Set(['status', 'checks_json', 'review_json', 'state_json', 'handoff_json', 'review_run_id', 'state_run_id', 'override_reason', 'error', 'completed_at'])
    const entries = Object.entries(values).filter(([key]) => permitted.has(key))
    if (entries.length) db.prepare(`UPDATE chapter_finalizations SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value), now(), id)
    return get(id)
  }
  function start({ projectId, chapterId, reviewer, targetLength = 2000, freshStart = false, deferReview = false }) {
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ? AND project_id = ?').get(chapterId, projectId)
    if (!chapter) throw new Error('章节不属于当前项目')
    if (!reviewer || !['app_model', 'codex'].includes(reviewer.executionMode)
      || (reviewer.executionMode === 'app_model' && !reviewer.profileId)) throw new Error('请为本章选择独立审稿模型')
    const sourceDigest = contentDigest(chapter.manuscript)
    const reviewerJson = JSON.stringify(reviewer)
    const reviewerDigest = contentDigest(reviewerJson)
    const existing = !freshStart && db.prepare(`SELECT * FROM chapter_finalizations WHERE chapter_id = ? AND source_digest = ? AND reviewer_digest = ?
      AND status NOT IN ('cancelled', 'stale')
      AND rowid >= COALESCE((SELECT MAX(rowid) FROM chapter_finalizations WHERE chapter_id=? AND json_extract(checks_json,'$.manualFinalization.type') IS NOT NULL),0)
      ORDER BY created_at DESC LIMIT 1`).get(chapterId, sourceDigest, reviewerDigest, chapterId)
    if (existing) return { ...mapped(existing), reused: true }
    const id = `finalize-${randomUUID()}`
    const revisionId = `revision-${randomUUID()}`
    // Freeze host orchestration separately from the project's immutable Creative Pack.
    const checks = { ...checkManuscript(chapter.manuscript, { targetLength }), chapterStateMode: COMPACT_HANDOFF_MODE }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('INSERT INTO revisions (id, chapter_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(revisionId, chapterId, chapter.manuscript, 'finalization-source', now())
      db.prepare(`INSERT INTO chapter_finalizations (id, project_id, chapter_id, revision_id, source_digest,
        manuscript, reviewer_json, reviewer_digest, status, checks_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, chapterId, revisionId, sourceDigest,
          chapter.manuscript, reviewerJson, reviewerDigest, checks.blocked ? 'blocked' : deferReview ? 'ready_for_review' : 'checking', JSON.stringify(checks), now(), now())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return get(id)
  }
  function storeState(id, state, audit = null) {
    const record = get(id)
    if (!record || ['completed', 'cancelled', 'stale', 'blocked'].includes(record.status)) throw new Error('定稿已结束或过期，请检查当前稿件')
    current(record)
    const issues = validateStateEvidence(state, record.manuscript)
    const corrections = [...(record.handoff.authorCorrections || []), ...(audit ? [audit] : [])]
    return patch(id, { status: issues.length ? 'waiting_state_correction' : 'waiting_confirmation',
      error: issues.length ? `交接已保留；${issues.length} 处来源待核对。修正后可本地重验，无需再次生成。` : '',
      state_json: JSON.stringify(state), handoff_json: JSON.stringify({
        mode: record.checks.chapterStateMode || 'legacy-snapshot', summary: state?.summary || '',
        facts: state?.facts || [], characterStates: state?.characterStates || [], relationshipChanges: state?.relationshipChanges || [],
        timelineEvents: state?.timelineEvents || [], openThreads: state?.openThreads || [], foreshadow: state?.foreshadow || {},
        sourceDigest: record.source_digest, revisionId: record.revision_id, authorCorrections: corrections,
      }) })
  }
  function correctState(id, { sourceDigest, stateDigest, corrections, reason = '' } = {}) {
    const record = get(id)
    if (!record || !['waiting_state_correction', 'waiting_confirmation'].includes(record.status)) throw new Error('当前交接状态不适合修正，请刷新任务')
    current(record)
    if (sourceDigest !== record.source_digest || stateDigest !== record.stateDigest) throw new Error('交接来源或候选已变化，请刷新后重新核对')
    const result = correctStateEvidence(record.state, corrections)
    if (result.changes.length && !String(reason).trim()) throw new Error('请填写修正原因，保留作者核对记录')
    return storeState(id, result.state, result.changes.length ? {
      at: now(), reason: String(reason).trim(), sourceDigest, beforeDigest: stateDigest,
      afterDigest: contentDigest(JSON.stringify(result.state)), changes: result.changes,
    } : null)
  }
  function confirm(id) {
    const record = get(id)
    if (!record) throw new Error('定稿记录不存在')
    if (record.status === 'completed') return record
    if (record.status !== 'waiting_confirmation') throw new Error('请先完成独立审稿与章后状态检查')
    const chapter = current(record)
    const evidenceIssues = validateStateEvidence(record.state, chapter.manuscript)
    if (evidenceIssues.length) throw new Error(evidenceIssues.join('；'))
    db.exec('SAVEPOINT chapter_finalization_confirm')
    try {
      // Composable with the author's correction transaction; all formal writes
      // still use this single authoritative handoff commit.
      db.prepare(`INSERT INTO chapter_memories (chapter_id, project_id, chapter_no, title, summary, keywords_json,
        source_updated_at, created_at, updated_at, source_digest, source_revision_id, evidence_json, handoff_json, confirmed, needs_review)
        VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, 1, 0)
        ON CONFLICT(chapter_id) DO UPDATE SET summary = excluded.summary, source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at, source_digest = excluded.source_digest, source_revision_id = excluded.source_revision_id,
        evidence_json = excluded.evidence_json, handoff_json = excluded.handoff_json, confirmed = 1, needs_review = 0`)
        .run(chapter.id, record.project_id, chapter.chapter_no, chapter.title, record.state.summary, chapter.updated_at,
          now(), now(), record.source_digest, record.revision_id, JSON.stringify(record.state), JSON.stringify(record.handoff))
      db.prepare(`INSERT INTO knowledge_candidates (id, project_id, chapter_id, task, status, payload_json, model_json, created_at, resolved_at)
        VALUES (?, ?, ?, 'chapter_state_extract', 'accepted', ?, ?, ?, ?)`)
        .run(`knowledge-${record.id}`, record.project_id, chapter.id, JSON.stringify({ ...record.state,
          _handoff: { mode: record.handoff.mode, sourceDigest: record.source_digest, revisionId: record.revision_id,
            ...(record.handoff.authorAmendment ? { authorAmendment: record.handoff.authorAmendment } : {}) } }), JSON.stringify(record.reviewer), now(), now())
      db.prepare("UPDATE chapters SET status = 'completed' WHERE id = ?").run(chapter.id)
      if (record.handoff.authorCorrections?.length && record.state_run_id) {
        const original = db.prepare("SELECT * FROM agent_candidates WHERE run_id=? AND status='pending' ORDER BY rowid DESC LIMIT 1").get(record.state_run_id)
        if (original) {
          // Preserve model output; the author-corrected version gets its own lineage.
          db.prepare(`INSERT INTO agent_candidates (id,run_id,step_id,project_id,chapter_id,artifact_type,status,
            source_digest,payload_json,evidence_json,created_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)`)
            .run(`candidate-${randomUUID()}`, original.run_id, original.step_id, original.project_id, original.chapter_id,
              original.artifact_type, original.source_digest, JSON.stringify(record.state), JSON.stringify({
                ...parse(original.evidence_json), parentCandidateId: original.id, authorEdited: true,
                finalizationId: record.id, corrections: record.handoff.authorCorrections,
              }), now())
          db.prepare("UPDATE agent_candidates SET status='rejected',override_reason='作者核对交接后生成修订版本；保留模型原始结果',resolved_at=? WHERE id=?").run(now(), original.id)
        }
      }
      // Candidate decisions and the authoritative handoff commit together.
      for (const runId of [record.review_run_id, record.state_run_id].filter(Boolean)) {
        db.prepare("UPDATE agent_steps SET status = 'confirmed', completed_at = ?, updated_at = ? WHERE run_id = ? AND id IN (SELECT step_id FROM agent_candidates WHERE run_id = ? AND status = 'pending')")
          .run(now(), now(), runId, runId)
        db.prepare("UPDATE agent_candidates SET status = 'accepted', override_reason = '作者集中确认定稿交接', resolved_at = ? WHERE run_id = ? AND status = 'pending'").run(now(), runId)
        db.prepare("UPDATE agent_runs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), runId)
      }
      patch(id, { status: 'completed', completed_at: now() })
      db.exec('RELEASE chapter_finalization_confirm')
    } catch (error) { db.exec('ROLLBACK TO chapter_finalization_confirm; RELEASE chapter_finalization_confirm'); throw error }
    return get(id)
  }
  return { get, start, patch, current, confirm, storeState, correctState,
    latest: (chapterId) => mapped(db.prepare('SELECT * FROM chapter_finalizations WHERE chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(chapterId)),
  }
}

export class ChapterFinalizer {
  constructor({ repository, execute, onEvent = () => {} }) { Object.assign(this, { repository, execute, onEvent }); this.active = new Map() }
  start(input) {
    const record = this.repository.start(input)
    if (!record.reused && record.status === 'checking') void this.advance(record.id)
    return record
  }
  async advance(id, { acceptReview = false, reason = '' } = {}) {
    if (this.active.has(id)) return this.active.get(id)
    const operation = this._advance(id, { acceptReview, reason }).catch(error => {
      const record = this.repository.get(id)
      if (record && !['stale', 'cancelled'].includes(record.status)) this.repository.patch(id, { status: 'failed', error: error.message })
      this.onEvent(this.repository.get(id))
      return this.repository.get(id)
    }).finally(() => this.active.delete(id))
    this.active.set(id, operation)
    return operation
  }
  async _advance(id, { acceptReview, reason }) {
    let record = this.repository.get(id)
    if (!record || ['stale', 'completed', 'cancelled', 'blocked'].includes(record.status)) return record
    this.repository.current(record)
    const ensureActive = () => {
      const latest = this.repository.get(id)
      if (latest.status === 'cancelled') throw new Error('本次定稿已取消')
      this.repository.current(latest)
    }
    if (!Object.keys(record.review).length) {
      this.repository.patch(id, { status: 'reviewing', error: '' })
      this.onEvent(this.repository.get(id))
      const review = await this.execute('quality_review', record)
      ensureActive()
      record = this.repository.patch(id, { status: 'waiting_review_confirmation', review_json: JSON.stringify(review) })
      this.onEvent(record)
      return record
    }
    if (!acceptReview && !['extracting', 'failed'].includes(record.status)) return record
    const high = (record.review.issues || []).some(issue => issue.severity === 'high') || record.checks.findings?.some(issue => issue.severity === 'high')
    if (high && !String(reason || record.override_reason).trim()) throw new Error('存在高严重度编辑问题，请修订正文，或填写继续定稿的原因')
    this.repository.patch(id, { status: 'extracting', override_reason: reason || record.override_reason, error: '' })
    this.onEvent(this.repository.get(id))
    // A retained result is locally revalidated, never silently regenerated.
    const state = Object.keys(record.state).length ? record.state : await this.execute('chapter_state_extract', this.repository.get(id))
    ensureActive()
    record = this.repository.storeState(id, state)
    this.onEvent(record)
    return record
  }
}
