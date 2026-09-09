import { randomUUID } from 'node:crypto'
import { contentDigest, createFinalizationRepository } from './chapter-finalization.js'
import { correctStateEvidence, evidenceQuote, handoffItems, handoffItemText, stateEvidenceIssues } from './chapter-handoff.js'
import { dependencyDigest, recordCreativeDependencies } from './creative-context.js'
import { manuscriptDiff } from './manuscript-diff.js'
import { checkManuscript } from './manuscript-checks.js'

const terminal = ['completed', 'cancelled', 'stale', 'blocked']
const ownProse = (key, chapterId) => key === `chapter:${chapterId}:manuscript` || key.startsWith(`chapter:${chapterId}:paragraph-`)

// Explicit author confirmation only. Never writes manuscript, classifies meaning,
// invokes a model, or mutates a prior review/candidate. Uses schema v24 JSON audit.
export function createChapterAmendmentRepository(db, { now = () => new Date().toISOString() } = {}) {
  const repo = createFinalizationRepository(db, { now })
  const dependencies = id => db.prepare("SELECT * FROM creative_dependencies WHERE artifact_kind='finalization' AND artifact_id=?").all(id)
  function preview({ projectId, chapterId }) {
    const chapter = db.prepare('SELECT * FROM chapters WHERE project_id=? AND id=?').get(projectId, chapterId)
    if (!chapter) throw new Error('章节不属于当前项目')
    const row = db.prepare("SELECT id FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND completed_at<>'' ORDER BY completed_at DESC,rowid DESC LIMIT 1").get(projectId, chapterId)
    if (!row) return null
    const base = repo.get(row.id)
    if (base.checks.manualFinalization) return null // There is no model review/handoff to inherit.
    const reviewed = repo.get(base.checks.authorAmendment?.reviewedFinalizationId || base.id)
    if (!reviewed || reviewed.project_id !== projectId || reviewed.chapter_id !== chapterId || !reviewed.completed_at) throw new Error('原审稿来源记录缺失，请走完整定稿流程')
    const sourceDigest = contentDigest(chapter.manuscript)
    const dependencyIssues = dependencies(base.id).filter(item => !ownProse(item.target_key, chapterId) && dependencyDigest(db, item.target_key) !== item.source_digest).map(item => item.target_key)
    const pending = db.prepare("SELECT id,status FROM chapter_finalizations WHERE project_id=? AND chapter_id=? ORDER BY rowid DESC").all(projectId, chapterId).find(item => !terminal.includes(item.status))
    const issues = stateEvidenceIssues(base.state, chapter.manuscript)
    const checks = checkManuscript(chapter.manuscript)
    return {
      projectId, chapterId, baseFinalizationId: base.id, reviewedFinalizationId: reviewed.id,
      baselineDigest: base.source_digest, sourceDigest, stateDigest: base.stateDigest,
      completedAt: base.completed_at, reviewedAt: reviewed.completed_at,
      manuscript: chapter.manuscript, baseline: base.manuscript, reviewedManuscript: reviewed.manuscript,
      changes: manuscriptDiff(base.manuscript, chapter.manuscript),
      cumulativeChanges: manuscriptDiff(reviewed.manuscript, chapter.manuscript),
      reviewer: reviewed.reviewer, priorCorrection: base.checks.authorAmendment || null,
      alreadyCurrent: chapter.status === 'completed' && base.status === 'completed' && sourceDigest === base.source_digest,
      dependencyIssues, pending, checks,
      issues: issues.map(issue => ({ ...issue, quote: issue.key ? evidenceQuote(handoffItems(base.state, issue.key)[issue.index]) : '',
        text: issue.key ? handoffItemText(handoffItems(base.state, issue.key)[issue.index]) : '' })),
      // Fingerprint is optimistic concurrency evidence, not an authorization token.
      previewDigest: contentDigest(JSON.stringify([base.id, base.source_digest, base.stateDigest, sourceDigest, reviewed.id,
        dependencies(base.id).map(item => [item.target_key, item.source_digest, dependencyDigest(db, item.target_key)])])),
    }
  }
  function confirm(input = {}) {
    if (input.confirm !== true || input.meaningUnchanged !== true || !String(input.reason || '').trim()) throw new Error('请核对累计差异，确认未改变剧情与事实，并填写校正说明')
    db.exec('BEGIN IMMEDIATE')
    try {
      const view = preview(input)
      if (!view) throw new Error('本章没有已确认定稿，请使用完整定稿流程')
      const replay = db.prepare("SELECT id FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND json_extract(checks_json,'$.authorAmendment.requestId')=?").get(input.projectId, input.chapterId, input.requestId || '')
      if (replay) {
        const saved = repo.get(replay.id)
        if (saved.checks.authorAmendment.requestDigest !== contentDigest(JSON.stringify(input))) throw new Error('重复请求参数不一致，请刷新后重试')
        db.exec('COMMIT'); return saved
      }
      if (!/^[a-zA-Z0-9_-]{8,160}$/.test(input.requestId || '')) throw new Error('校正确认需要稳定的请求标识')
      if (view.previewDigest !== input.previewDigest || view.baseFinalizationId !== input.baseFinalizationId
        || view.sourceDigest !== input.sourceDigest || view.stateDigest !== input.stateDigest) throw new Error('正文、定稿或交接来源已变化，请刷新差异后重新核对')
      if (view.pending) throw new Error('本章有未结束的定稿任务，请先取消该任务或继续完整定稿')
      if (view.dependencyIssues.length) throw new Error('原审稿依赖的设定或其他章节已变化，请重新审稿：' + view.dependencyIssues.join('、'))
      if (view.checks.blocked || view.checks.findings.some(item => item.severity === 'high')) throw new Error('正文存在本地检查异常，请先修订或走完整定稿流程')
      if (view.alreadyCurrent) throw new Error('当前正文已经定稿，无需再次校正')
      const base = repo.get(view.baseFinalizationId)
      const corrections = input.corrections || []
      if (!Array.isArray(corrections) || corrections.some(item => item?.remove || !view.issues.some(issue => issue.key === item?.key && issue.index === item?.index))) throw new Error('校正仅支持修复受影响的交接引句；事实变更或移除条目请重新审稿')
      const corrected = correctStateEvidence(base.state, corrections)
      const evidenceIssues = stateEvidenceIssues(corrected.state, view.manuscript)
      if (evidenceIssues.length) throw new Error('请先修复受影响的证据原句：' + evidenceIssues.map(item => item.message).join('；'))
      const id = `finalize-${randomUUID()}`, revisionId = `revision-${randomUUID()}`, at = now()
      const audit = { schemaVersion: 1, type: 'author-proofreading', label: '沿用原审稿，经作者校正', at,
        previousFinalizationId: base.id, reviewedFinalizationId: view.reviewedFinalizationId,
        beforeDigest: base.source_digest, afterDigest: view.sourceDigest, meaningUnchanged: true,
        reason: String(input.reason).trim(), changes: view.changes, cumulativeChanges: view.cumulativeChanges,
        evidenceChanges: corrected.changes, requestId: input.requestId, requestDigest: contentDigest(JSON.stringify(input)) }
      const checks = { ...view.checks, chapterStateMode: base.checks.chapterStateMode, authorAmendment: audit }
      const handoff = { ...base.handoff, ...corrected.state, sourceDigest: view.sourceDigest, revisionId,
        authorAmendment: { label: audit.label, reviewedFinalizationId: audit.reviewedFinalizationId, previousFinalizationId: base.id } }
      db.prepare('INSERT INTO revisions(id,chapter_id,content,source,created_at) VALUES(?,?,?,?,?)').run(revisionId, input.chapterId, view.manuscript, 'author-proofreading', at)
      db.prepare(`INSERT INTO chapter_finalizations(id,project_id,chapter_id,revision_id,source_digest,manuscript,reviewer_json,reviewer_digest,status,
        checks_json,review_json,state_json,handoff_json,override_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'waiting_confirmation',?,?,?,?,?,?,?)`)
        .run(id, input.projectId, input.chapterId, revisionId, view.sourceDigest, view.manuscript, base.reviewer_json, base.reviewer_digest,
          JSON.stringify(checks), base.review_json, JSON.stringify(corrected.state), JSON.stringify(handoff), base.override_reason, at, at)
      // The new confirmed version follows its own current prose but retains every
      // other frozen dependency. Old records remain inspectable as historical.
      recordCreativeDependencies(db, { projectId: input.projectId, artifactKind: 'finalization', artifactId: id,
        sources: dependencies(base.id).map(item => ({ targetKey: item.target_key,
          digest: ownProse(item.target_key, input.chapterId) ? dependencyDigest(db, item.target_key) : item.source_digest })) })
      repo.confirm(id)
      db.exec('COMMIT')
      return repo.get(id)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return { preview, confirm }
}
