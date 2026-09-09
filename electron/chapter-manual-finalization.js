import { randomUUID } from 'node:crypto'
import { contentDigest, createFinalizationRepository } from './chapter-finalization.js'
import { dependencyDigest, recordCreativeDependencies } from './creative-context.js'

// An author decision about the saved manuscript, not a model review or a handoff.
// Existing schema-v24 JSON columns retain provenance without migrating real books.
export function createManualFinalizationRepository(db, { now = () => new Date().toISOString() } = {}) {
  const repo = createFinalizationRepository(db, { now })
  function preview({ projectId, chapterId } = {}) {
    const chapter = db.prepare('SELECT * FROM chapters WHERE project_id=? AND id=?').get(projectId, chapterId)
    if (!chapter) throw new Error('章节不属于当前项目')
    const latest = repo.latest(chapterId)
    const pending = db.prepare("SELECT id,status FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND status NOT IN ('completed','cancelled','stale','blocked') ORDER BY rowid DESC LIMIT 1").get(projectId, chapterId)
    const memory = db.prepare('SELECT source_digest,source_revision_id,confirmed,needs_review FROM chapter_memories WHERE project_id=? AND chapter_id=?').get(projectId, chapterId)
    const sourceDigest = contentDigest(chapter.manuscript)
    return { projectId, chapterId, title: chapter.title, sourceDigest,
      hanCount: (chapter.manuscript.match(/[\u3400-\u9fff]/g) || []).length,
      empty: !chapter.manuscript.trim(), pending: pending || null,
      alreadyCurrent: chapter.status === 'completed' && latest?.status === 'completed' && latest.source_digest === sourceDigest && Boolean(latest.checks.manualFinalization),
      previewDigest: contentDigest(JSON.stringify([projectId, chapterId, chapter.title, sourceDigest, chapter.status, latest?.id, latest?.status, memory || null])) }
  }
  function confirm(input = {}) {
    if (input.confirm !== true || input.skipReview !== true || input.skipHandoff !== true) throw new Error('请明确选择人工直接定稿，并跳过本次审稿和交接')
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(input.requestId || '')) throw new Error('直接定稿需要稳定的请求标识')
    const requestDigest = contentDigest(JSON.stringify(input))
    db.exec('BEGIN IMMEDIATE')
    try {
      const view = preview(input)
      const replay = db.prepare("SELECT id FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND json_extract(checks_json,'$.manualFinalization.requestId')=?").get(input.projectId, input.chapterId, input.requestId)
      if (replay) {
        const saved = repo.get(replay.id)
        if (saved.checks.manualFinalization.requestDigest !== requestDigest) throw new Error('重复请求参数不一致，请刷新后重试')
        db.exec('COMMIT'); return saved
      }
      if (view.sourceDigest !== input.sourceDigest || view.previewDigest !== input.previewDigest) throw new Error('正文或定稿状态已变化，请刷新当前保存稿后再确认')
      if (view.pending) throw new Error('本章有未结束的定稿任务，请先完成或取消该任务')
      if (view.empty) throw new Error('正文为空，请先保存正文再定稿')
      if (view.alreadyCurrent) throw new Error('当前保存稿已人工定稿，无需重复提交')
      const previous = repo.latest(input.chapterId)
      const chapter = db.prepare('SELECT manuscript FROM chapters WHERE project_id=? AND id=?').get(input.projectId, input.chapterId)
      const id = `finalize-${randomUUID()}`, revisionId = `revision-${randomUUID()}`, at = now()
      const reviewer = JSON.stringify({ executionMode: 'manual', label: '作者直接定稿 · 未审稿' })
      const audit = { type: 'author-direct', at, reviewSkipped: true, handoffSkipped: true,
        previousFinalizationId: previous?.id || null, reason: String(input.reason || '').trim(), requestId: input.requestId, requestDigest }
      db.prepare('INSERT INTO revisions(id,chapter_id,content,source,created_at) VALUES(?,?,?,?,?)').run(revisionId, input.chapterId, chapter.manuscript, 'author-direct-finalization', at)
      db.prepare(`INSERT INTO chapter_finalizations(id,project_id,chapter_id,revision_id,source_digest,manuscript,reviewer_json,reviewer_digest,status,
        checks_json,handoff_json,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,'completed',?,?,?,?,?)`)
        .run(id, input.projectId, input.chapterId, revisionId, view.sourceDigest, chapter.manuscript, reviewer, contentDigest(reviewer),
          JSON.stringify({ hanCount: view.hanCount, manualFinalization: audit }), JSON.stringify({ mode: 'skipped', reason: '作者选择跳过本次交接' }), at, at, at)
      // Preserve old evidence, but exclude it from current confirmed handoff recall.
      db.prepare('UPDATE chapter_memories SET needs_review=1 WHERE project_id=? AND chapter_id=?').run(input.projectId, input.chapterId)
      db.prepare("UPDATE chapters SET status='completed' WHERE project_id=? AND id=?").run(input.projectId, input.chapterId)
      const targetKey = `chapter:${input.chapterId}:manuscript`
      recordCreativeDependencies(db, { projectId: input.projectId, artifactKind: 'finalization', artifactId: id,
        sources: [{ targetKey, digest: dependencyDigest(db, targetKey) }] })
      db.exec('COMMIT')
      return repo.get(id)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return { preview, confirm }
}
