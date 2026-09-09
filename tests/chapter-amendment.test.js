import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createFinalizationRepository, ChapterFinalizer } from '../electron/chapter-finalization.js'
import { createChapterAmendmentRepository } from '../electron/chapter-amendment.js'
import { manuscriptDiff } from '../electron/manuscript-diff.js'
import { recordCreativeDependencies, dependencyDigest, invalidateCreativeDependencies } from '../electron/creative-context.js'
import { createProjectBackup, restoreProjectBackup } from '../electron/project-portability.js'
import { CreativeInterface } from '../electron/creative-interface.js'
import { assertIsolatedRuntime } from '../scripts/smoke-isolation.mjs'

const prose = '林溪以经收好雨伞。\n\n她看见纸条背面有字。'
const reviewer = { executionMode: 'codex', model: 'gpt-6-astra', reasoningEffort: 'xhigh', label: '仅工程夹具' }
const state = { summary: '林溪看到纸条上的字。', facts: [{ text: '纸条背面有字', evidence: '她看见纸条背面有字。' }], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } }
async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-amendment-test-')), file = path.join(directory, 'novel-studio.sqlite'), db = new DatabaseSync(file)
  assertIsolatedRuntime({ database: { path: db.prepare('PRAGMA database_list').all().find(row => row.name === 'main').file } }, directory)
  runMigrations(db)
  const workspace = createWorkspaceRepository(db), repo = createFinalizationRepository(db), amendments = createChapterAmendmentRepository(db), calls = []
  const a = workspace.createProject({ title: '校正测试 A', genre: '悬疑' }), b = workspace.createProject({ title: '校正测试 B', genre: '文娱' })
  const projectId = a.project.id, chapterId = a.chapters[0].id
  workspace.updateChapter({ id: chapterId, manuscript: prose })
  const finalizer = new ChapterFinalizer({ repository: repo, execute: async task => { calls.push(task); return task === 'quality_review' ? { summary: '模拟审稿', issues: [], scores: {} } : state } })
  const record = finalizer.start({ projectId, chapterId, reviewer })
  await finalizer.advance(record.id); await finalizer.advance(record.id, { acceptReview: true }); repo.confirm(record.id)
  const targetKeys = [`chapter:${chapterId}:manuscript`, `project:${projectId}:identity`]
  recordCreativeDependencies(db, { projectId, artifactKind: 'finalization', artifactId: record.id,
    sources: targetKeys.map(targetKey => ({ targetKey, digest: dependencyDigest(db, targetKey) })) })
  const preview = () => amendments.preview({ projectId, chapterId })
  const input = (changes = {}) => { const view = preview(); return { projectId, chapterId, baseFinalizationId: view.baseFinalizationId,
    sourceDigest: view.sourceDigest, stateDigest: view.stateDigest, previewDigest: view.previewDigest,
    meaningUnchanged: true, confirm: true, reason: '作者核对，仅文字校正', requestId: 'amendment-request-1', ...changes } }
  t.after(() => db.close())
  return { db, file, workspace, repo, amendments, calls, a, b, projectId, chapterId, record: repo.get(record.id), preview, input }
}

test('bounded diffs reconstruct all edits exactly, including separate edits and large rewrites', () => {
  const cases = [['a b c', 'A b C'], ['', 'abc'], ['abc', ''], ['你好，世界。', '您好！世界。'], ['a'.repeat(1000), 'b'.repeat(1000)], ['林溪以经到家。', '林溪已经到家。'], ['😀', '😄']]
  let seed = 12
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < 500; i++) cases.push(Array.from({ length: 2 }, () => Array.from({ length: Math.floor(random() * 80) }, () => 'abc \n林溪'[Math.floor(random() * 7)]).join('')))
  for (const [before, after] of cases) {
    let result = before
    for (const change of manuscriptDiff(before, after).reverse()) {
      assert.equal(before.slice(change.from, change.to), change.before)
      result = result.slice(0, change.from) + change.after + result.slice(change.to)
    }
    assert.equal(result, after)
  }
  assert.equal(manuscriptDiff('a b c', 'A b C').length, 2)
})

test('typo correction restores finalization without a model, preserves history, is idempotent and survives restart', async t => {
  const f = await setup(t)
  assert.equal(f.preview().alreadyCurrent, true)
  // Saving identical text (e.g. Save version) must not demote a completed chapter.
  assert.equal(f.workspace.updateChapter({ id: f.chapterId, manuscript: prose }).status, 'completed')
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].finalized_version_id, f.record.id)
  const request = f.input(), view = f.preview()
  assert.equal(view.changes[0].before, '以'); assert.equal(view.issues.length, 0)
  const corrected = f.amendments.confirm(request)
  assert.equal(corrected.status, 'completed'); assert.equal(corrected.review_run_id, null)
  assert.deepEqual(corrected.review, f.record.review); assert.deepEqual(corrected.reviewer, reviewer)
  assert.deepEqual(f.calls, ['quality_review', 'chapter_state_extract'])
  assert.equal(f.repo.get(f.record.id).manuscript, prose)
  assert.equal(f.amendments.confirm(request).id, corrected.id)
  assert.throws(() => f.amendments.confirm({ ...request, reason: '换了参数' }), /参数不一致/)
  const reopened = new DatabaseSync(f.file)
  assert.equal(createChapterAmendmentRepository(reopened).confirm(request).id, corrected.id); reopened.close()
  // The stale old dependency must never downgrade the new confirmed version.
  invalidateCreativeDependencies(f.db, f.projectId); invalidateCreativeDependencies(f.db, f.projectId)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'completed')
  assert.equal(f.db.prepare('SELECT needs_review FROM chapter_memories WHERE chapter_id=?').get(f.chapterId).needs_review, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chapter_finalizations WHERE chapter_id=?').get(f.chapterId).n, 2)
  const memory = f.db.prepare('SELECT * FROM chapter_memories WHERE chapter_id=?').get(f.chapterId)
  assert.equal(memory.source_revision_id, corrected.revision_id)
  assert.equal(JSON.parse(memory.handoff_json).authorAmendment.reviewedFinalizationId, f.record.id)
})

test('affected evidence is repaired locally; empty, fabricated, removed or unrelated changes are rejected', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('有字。', '有字！') })
  assert.equal(f.preview().issues.length, 1)
  for (const corrections of [[], [{ key: 'facts', index: 0, quote: '捏造的引句' }], [{ key: 'facts', index: 0, remove: true }]]) assert.throws(() => f.amendments.confirm(f.input({ corrections })), /引句|原句/)
  const amended = f.amendments.confirm(f.input({ corrections: [{ key: 'facts', index: 0, quote: '她看见纸条背面有字！' }] }))
  assert.equal(amended.state.facts[0].text, state.facts[0].text)
  assert.equal(amended.checks.authorAmendment.evidenceChanges.length, 1)
  assert.deepEqual(f.calls, ['quality_review', 'chapter_state_extract'])
  assert.deepEqual(f.repo.get(f.record.id).state, state)
})

test('explicit semantic attestation is mandatory even for one negation; cumulative diff is anchored to original review', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  assert.throws(() => f.amendments.confirm(f.input({ confirm: false })), /确认/)
  assert.throws(() => f.amendments.confirm(f.input({ reason: '' })), /说明/)
  const first = f.amendments.confirm(f.input())
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经').replace('收好', '没收好') })
  const view = f.preview()
  assert.equal(view.baseFinalizationId, first.id); assert.equal(view.reviewedFinalizationId, f.record.id)
  assert.equal(view.changes.length, 1); assert.equal(view.cumulativeChanges.length, 2)
  assert.throws(() => f.amendments.confirm(f.input({ requestId: 'amendment-request-2', meaningUnchanged: false })), /确认/)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
})

test('cross-project, concurrent source/state, pending finalization and changed non-prose dependencies stay guarded', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  assert.throws(() => f.amendments.preview({ projectId: f.b.project.id, chapterId: f.chapterId }), /不属于/)
  assert.throws(() => f.amendments.confirm(f.input({ projectId: f.b.project.id })), /不属于/)
  const old = f.input()
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') + '\n' })
  assert.throws(() => f.amendments.confirm(old), /已变化/)
  const pending = f.repo.start({ projectId: f.projectId, chapterId: f.chapterId, reviewer, deferReview: true })
  assert.throws(() => f.amendments.confirm(f.input()), /未结束/)
  f.repo.patch(pending.id, { status: 'cancelled' })
  const current = f.input()
  f.repo.patch(f.record.id, { state_json: JSON.stringify({ ...state, summary: '来源状态被其他任务改动' }) })
  assert.throws(() => f.amendments.confirm(current), /已变化/)
  f.workspace.updateProject({ id: f.projectId, idea: '新的故事身份要求' })
  assert.throws(() => f.amendments.confirm(f.input()), /设定或其他章节/)
})

test('formal transaction rolls back completely on memory write failure', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  const count = () => ['revisions', 'chapter_finalizations', 'knowledge_candidates'].map(table => f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
  const before = count()
  f.db.exec("CREATE TRIGGER fixture_failure BEFORE UPDATE ON chapter_memories BEGIN SELECT RAISE(ABORT,'fixture memory failure'); END")
  assert.throws(() => f.amendments.confirm(f.input()), /fixture memory failure/)
  assert.deepEqual(count(), before)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
})

test('ordinary drafts have no correction route; returning to the exact final prose still needs explicit confirmation', async t => {
  const f = await setup(t)
  assert.equal(f.amendments.preview({ projectId: f.b.project.id, chapterId: f.b.chapters[0].id }), null)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose + '临时输入' })
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose })
  assert.equal(f.preview().changes.length, 0)
  assert.equal(f.preview().alreadyCurrent, false)
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
  assert.equal(f.amendments.confirm(f.input()).status, 'completed')
  assert.equal(f.calls.length, 2)
})

test('competing confirmations commit once; the new version still expires on later real dependency changes', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  const request = f.input(), corrected = f.amendments.confirm(request)
  assert.throws(() => f.amendments.confirm({ ...request, requestId: 'competing-request-2' }), /已变化/)
  f.workspace.updateProject({ id: f.projectId, idea: '人物身份发生变更' })
  invalidateCreativeDependencies(f.db, f.projectId)
  assert.equal(f.repo.get(corrected.id).status, 'stale')
  assert.equal(f.workspace.loadWorkspace(f.projectId).chapters[0].status, 'draft')
  assert.equal(f.db.prepare('SELECT needs_review FROM chapter_memories WHERE chapter_id=?').get(f.chapterId).needs_review, 1)
})

test('backup retains correction provenance and remaps its history links', async t => {
  const f = await setup(t)
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  f.amendments.confirm(f.input())
  const restored = restoreProjectBackup(f.db, createProjectBackup(f.db, f.projectId))
  const chapter = f.workspace.loadWorkspace(restored.projectId).chapters[0]
  const view = f.amendments.preview({ projectId: restored.projectId, chapterId: chapter.id })
  assert.equal(view.alreadyCurrent, true)
  assert.notEqual(view.reviewedFinalizationId, f.record.id)
  assert.equal(f.repo.get(view.reviewedFinalizationId).project_id, restored.projectId)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('bound clients isolate correction previews and confirmations; duplicate and lost responses replay once', async t => {
  const f = await setup(t)
  const invoke = (channel, input) => channel === 'chapter:amendment-preview' ? f.amendments.preview(input) : f.amendments.confirm(input)
  const api = new CreativeInterface({ database: f.db, invoke, snapshot: () => ({}), stageCandidate: () => { throw new Error('unexpected model') } })
  const tokens = ['a'.repeat(40), 'b'.repeat(40)]
  for (const [i, book] of [f.a, f.b].entries()) api.bind({ clientId: `author-${i}`, projectId: book.project.id, expectedTitle: book.project.title, token: tokens[i] })
  f.workspace.updateChapter({ id: f.chapterId, manuscript: prose.replace('以经', '已经') })
  const input = f.input()
  await assert.rejects(api.call(tokens[1], { operation: 'finalization.correction-preview', input: { chapterId: f.chapterId } }), /不属于/)
  await assert.rejects(api.call(tokens[1], { operation: 'finalization.correct', input, requestId: 'cross-project-request' }), /不一致/)
  f.workspace.setActiveProject(f.b.project.id)
  const payload = { operation: 'finalization.correct', input, requestId: 'correct-request-1' }
  const [one, two] = await Promise.all([api.call(tokens[0], payload), api.call(tokens[0], payload)])
  assert.equal(one.id, two.id)
  assert.equal((await api.call(tokens[0], payload)).id, one.id)
  assert.equal(f.workspace.loadWorkspace(f.b.project.id).chapters[0].status, 'draft')
  assert.equal(f.calls.length, 2)
})
