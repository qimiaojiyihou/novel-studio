import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createFinalizationRepository } from '../electron/chapter-finalization.js'
import { createManualFinalizationRepository } from '../electron/chapter-manual-finalization.js'
import { createChapterAmendmentRepository } from '../electron/chapter-amendment.js'
import { recordCreativeDependencies, dependencyDigest, invalidateCreativeDependencies, buildCreativeContext } from '../electron/creative-context.js'
import { CreativeInterface } from '../electron/creative-interface.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { createProjectBackup, restoreProjectBackup } from '../electron/project-portability.js'
import { assertIsolatedRuntime } from '../scripts/smoke-isolation.mjs'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-manual-finalization-'))
  const file = path.join(dir, 'novel-studio.sqlite'), db = new DatabaseSync(file)
  assertIsolatedRuntime({ database: { path: db.prepare('PRAGMA database_list').all()[0].file } }, dir)
  runMigrations(db)
  t.after(() => db.close())
  const workspace = createWorkspaceRepository(db), repo = createFinalizationRepository(db), manual = createManualFinalizationRepository(db)
  const a = workspace.createProject({ title: '手动定稿 A' }), b = workspace.createProject({ title: '手动定稿 B' })
  const projectId = a.project.id, chapterId = a.chapters[0].id
  workspace.updateChapter({ id: chapterId, manuscript: '她没有回家。\n\n这是作者自行决定的新版。' })
  const request = (extra = {}) => ({ ...manual.preview({ projectId, chapterId }), confirm: true, skipReview: true, skipHandoff: true, requestId: 'manual-request-0001', ...extra })
  return { db, file, workspace, repo, manual, a, b, projectId, chapterId, request }
}

test('manual completion permits substantive edits and no reviewer, creates no model or handoff artifacts, survives reload', t => {
  const f = fixture(t), input = f.request()
  const result = f.manual.confirm(input)
  assert.equal(result.status, 'completed')
  assert.equal(result.reviewer.executionMode, 'manual')
  assert.equal(result.checks.manualFinalization.reviewSkipped, true)
  assert.equal(result.checks.manualFinalization.handoffSkipped, true)
  assert.deepEqual(result.review, {}); assert.deepEqual(result.state, {})
  for (const table of ['agent_runs', 'agent_candidates', 'chapter_memories', 'knowledge_candidates']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].finalization_manual, 'author-direct')
  assert.equal(f.manual.confirm(input).id, result.id)
  const reopened = new DatabaseSync(f.file)
  assert.equal(createManualFinalizationRepository(reopened).confirm(input).id, result.id); reopened.close()
  assert.throws(() => f.manual.confirm({ ...input, reason: '不同参数' }), /参数不一致/)
  assert.equal(createChapterAmendmentRepository(f.db).preview({ projectId: f.projectId, chapterId: f.chapterId }), null)
  assert.equal(f.workspace.updateChapter({ id: f.chapterId, manuscript: result.manuscript }).status, 'completed')
  f.workspace.updateChapter({ id: f.chapterId, manuscript: result.manuscript + '她又回来了。' })
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
  assert.equal(f.manual.confirm(f.request({ requestId: 'manual-request-0002' })).status, 'completed')
})

test('explicit decision, nonempty saved source, optimistic concurrency and pending tasks remain guarded', t => {
  const f = fixture(t), input = f.request()
  for (const field of ['confirm', 'skipReview', 'skipHandoff']) assert.throws(() => f.manual.confirm({ ...input, [field]: false }), /明确选择/)
  assert.throws(() => f.manual.preview({ projectId: f.b.project.id, chapterId: f.chapterId }), /不属于/)
  assert.throws(() => f.manual.confirm({ ...input, projectId: f.b.project.id }), /不属于/)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: '新内容，已实质改写。' })
  assert.throws(() => f.manual.confirm(input), /已变化/)
  const pending = f.repo.start({ projectId: f.projectId, chapterId: f.chapterId, reviewer: { executionMode: 'codex' }, deferReview: true })
  assert.throws(() => f.manual.confirm(f.request()), /未结束/)
  f.repo.patch(pending.id, { status: 'cancelled' })
  f.workspace.updateChapter({ id: f.chapterId, manuscript: '  \n' })
  assert.throws(() => f.manual.confirm(f.request()), /正文为空/)
})

test('old review and handoff stay historical; repeated dependency checks never demote newer manual completion', t => {
  const f = fixture(t)
  const old = f.repo.start({ projectId: f.projectId, chapterId: f.chapterId, reviewer: { executionMode: 'codex' }, deferReview: true })
  f.repo.patch(old.id, { review_json: JSON.stringify({ summary: '旧版模型审稿', scores: {}, issues: [] }) })
  f.repo.storeState(old.id, { summary: '旧版交接摘要', facts: [{ text: '她没回家', evidence: '她没有回家。' }], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } })
  f.repo.confirm(old.id)
  const targetKey = `chapter:${f.chapterId}:manuscript`
  recordCreativeDependencies(f.db, { projectId: f.projectId, artifactKind: 'finalization', artifactId: old.id, sources: [{ targetKey, digest: dependencyDigest(f.db, targetKey) }] })
  f.workspace.updateChapter({ id: f.chapterId, manuscript: '她已经回家。这里发生了完全不同的剧情。' })
  const result = f.manual.confirm(f.request())
  for (let i = 0; i < 3; i++) invalidateCreativeDependencies(f.db, f.projectId)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'completed')
  const memory = f.db.prepare('SELECT * FROM chapter_memories WHERE chapter_id=?').get(f.chapterId)
  assert.equal(memory.needs_review, 1); assert.equal(memory.source_revision_id, old.revision_id)
  assert.equal(f.repo.get(old.id).review.summary, '旧版模型审稿')
  const next = f.workspace.createChapter({ projectId: f.projectId, title: '下一章' })
  const context = buildCreativeContext(f.db, { projectId: f.projectId, chapterId: next.id, task: 'chapter_draft' })
  assert.doesNotMatch(context.text, /旧版交接摘要/)
  assert.match(context.text, /未生成交接/)
  const restored = restoreProjectBackup(f.db, createProjectBackup(f.db, f.projectId))
  const copy = f.workspace.loadWorkspace(restored.projectId).chapters[0]
  assert.equal(copy.finalization_manual, 'author-direct')
  assert.equal(f.repo.latest(copy.id).checks.manualFinalization.previousFinalizationId === old.id, false)
  assert.equal(result.review_run_id, null)
})

test('formal failure rolls back the revision, decision and old memory invalidation together', t => {
  const f = fixture(t)
  f.db.prepare(`INSERT INTO chapter_memories(chapter_id,project_id,chapter_no,title,summary,keywords_json,source_updated_at,created_at,updated_at,confirmed,needs_review)
    VALUES(?,?,1,'旧章','应完整保留的历史交接','[]','','','',1,0)`).run(f.chapterId, f.projectId)
  f.db.exec("CREATE TRIGGER fail_manual BEFORE UPDATE OF status ON chapters WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'mock status failure'); END")
  assert.throws(() => f.manual.confirm(f.request()), /mock status failure/)
  for (const table of ['chapter_finalizations', 'revisions']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
  assert.equal(f.db.prepare('SELECT needs_review FROM chapter_memories WHERE chapter_id=?').get(f.chapterId).needs_review, 0)
})

test('a later full review starts a fresh record instead of resurrecting a pre-manual review of identical prose', t => {
  const f = fixture(t), reviewer = { executionMode: 'codex' }
  const prior = f.repo.start({ projectId: f.projectId, chapterId: f.chapterId, reviewer, deferReview: true })
  f.repo.patch(prior.id, { status: 'completed', completed_at: new Date().toISOString() })
  f.manual.confirm(f.request())
  const next = f.repo.start({ projectId: f.projectId, chapterId: f.chapterId, reviewer, deferReview: true })
  assert.notEqual(next.id, prior.id)
  assert.equal(next.status, 'ready_for_review')
  assert.deepEqual(next.review, {})
})

test('one book pending approval or paused generation blocks its target without cancelling the other book', async t => {
  const f = fixture(t), runs = createCodexRepository(f.db)
  const run = runs.createInlineRun({ projectId: f.projectId, chapterId: f.chapterId, task: 'chapter', target: { kind: 'manuscript', targetId: f.chapterId }, executionMode: 'codex' })
  const api = new CreativeInterface({ database: f.db, invoke: (_channel, input) => f.manual.confirm(input), snapshot: () => ({}) })
  const token = 'c'.repeat(40)
  api.bind({ clientId: 'manual-occupied', projectId: f.projectId, expectedTitle: f.a.project.title, token })
  for (const status of ['running', 'waiting_approval', 'paused']) {
    runs.updateRun(run.id, { status })
    await assert.rejects(api.call(token, { operation: 'finalization.manual', input: f.request(), requestId: `blocked-${status}` }), /已有运行/)
    assert.equal(runs.getRun(run.id).status, status)
    assert.equal(f.workspace.loadWorkspace(f.b.project.id).chapters[0].status, 'draft')
  }
  runs.updateRun(run.id, { status: 'cancelled' })
  assert.equal((await api.call(token, { operation: 'finalization.manual', input: f.request(), requestId: 'after-author-cancel' })).status, 'completed')
})

test('bound clients interleave books, reject cross-book writes, serialize competitors and replay lost responses', async t => {
  const f = fixture(t)
  const api = new CreativeInterface({ database: f.db, invoke: (channel, input) => channel === 'chapter:manual-preview' ? f.manual.preview(input) : f.manual.confirm(input), snapshot: () => ({}), stageCandidate: () => { throw new Error('unexpected generation') } })
  const tokens = ['a'.repeat(40), 'b'.repeat(40)]
  for (const [i, book] of [f.a, f.b].entries()) api.bind({ clientId: `manual-author-${i}`, projectId: book.project.id, expectedTitle: book.project.title, token: tokens[i] })
  await assert.rejects(api.call(tokens[1], { operation: 'finalization.manual-preview', input: { chapterId: f.chapterId } }), /不属于/)
  await assert.rejects(api.call(tokens[1], { operation: 'finalization.manual', input: f.request(), requestId: 'cross-request' }), /不一致/)
  f.workspace.setActiveProject(f.b.project.id)
  const input = await api.call(tokens[0], { operation: 'finalization.manual-preview', input: { chapterId: f.chapterId } })
  const payload = { operation: 'finalization.manual', input: { ...input, confirm: true, skipReview: true, skipHandoff: true }, requestId: 'manual-api-request' }
  const [one, two] = await Promise.all([api.call(tokens[0], payload), api.call(tokens[0], payload)])
  assert.equal(one.id, two.id)
  assert.equal((await api.call(tokens[0], payload)).id, one.id)
  await assert.rejects(api.call(tokens[0], { ...payload, requestId: 'competing-api-request' }), /已变化/)
  assert.equal(f.workspace.loadWorkspace(f.b.project.id).chapters[0].status, 'draft')
  f.workspace.updateChapter({ id: f.b.chapters[0].id, manuscript: '另一本书独立定稿。' })
  const bView = await api.call(tokens[1], { operation: 'finalization.manual-preview', input: { chapterId: f.b.chapters[0].id } })
  assert.equal((await api.call(tokens[1], { operation: 'finalization.manual', input: { ...bView, confirm: true, skipReview: true, skipHandoff: true }, requestId: 'manual-book-b-request' })).status, 'completed')
})
