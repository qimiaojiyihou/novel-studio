import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { AgentRuntime } from '../electron/agent-runtime.js'
import { prepareModelTask, runEmbeddedModelTask } from '../electron/model-adapter.js'
import { COLLABORATIVE_WORKFLOW_ID, collaborativeExecution, collaborativeProfile, lockCollaborativeModels } from '../electron/collaborative-writing.js'

const card = { goal: '取得车票', protagonistGoal: '回家', resistance: '车站封闭', turningPoint: '有人递来旧票', payoff: '找到出口', cost: '留下信件', ending: '他走出车站。', requiredScenes: [{ id: 'S1', title: '站台', goal: '回家', result: '离开' }] }
const scenePlan = { schemaVersion: 1, summary: '离开车站', scenes: [{ id: 'S1', title: '站台', pov: '他', time: '夜', location: '车站', presentCharacters: ['他'], entryState: '尚在站内', goal: '离开', obstacle: '封闭', actionBeats: ['找到出口', '他走出车站。'], turn: '递出票', exitState: '站外', knowledgeChanges: [], continuityRisks: [] }] }
const review = { summary: '一处物件连续性问题', scores: {}, issues: [
  { id: 'ticket', severity: 'high', category: '连续性', criterion: '票已交出后又被拿起', evidence: '他又拿起票。', repairInstruction: '改为收起回执，保留其他句子。' },
  { id: 'style', severity: 'info', category: '表达偏好', criterion: '可尝试更短的句子', evidence: '站台灯很暗。', repairInstruction: '仅供作者选择。' },
] }
async function until(read) {
  for (let n = 0; n < 100; n++) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 5)) }
  throw new Error('运行未到达预期检查点')
}
function fixture(t) {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  t.after(() => db.close())
  const store = createWorkspaceRepository(db)
  const book = store.createProject({ title: '末班车', work_format: 'short_story' })
  store.updateChapter({ id: book.chapters[0].id, manuscript: '正式旧稿。' })
  for (const [id, provider, model] of [['planner', 'openai', 'gpt-planning'], ['writer', 'grok', 'grok-writing'], ['reviewer', 'openai', 'gpt-reviewing'], ['repairer', 'grok', 'grok-repairing']]) {
    db.prepare("INSERT INTO model_profiles(id,provider,name,base_url,model,api_key_cipher,enabled,created_at,updated_at) VALUES(?,?,?,?,?,'plain:synthetic-key',1,'now','now')").run(id, provider, id, 'https://provider.test/v1', model)
  }
  const repository = createCodexRepository(db), calls = []
  let digest = 'locked-source', failRepair = false
  const runtime = new AgentRuntime({ repository, codexGateway: {}, createMirror: async () => ({ root: '/synthetic/mirror' }),
    runPreflight: async () => ({ blocked: false }), currentSourceDigest: async () => digest,
    runIndependentReview: async ({ run, sourceCandidate }) => {
      calls.push({ stage: 'review', profile: run.modelRoutes.reviewerProfileId, source: sourceCandidate.payload.manuscript })
      return { result: { execution: 'remote' }, payload: review }
    },
    runAppModel: async ({ run, step, extra }) => {
      calls.push({ stage: run.modelRoutes.activeStage, profile: run.modelRoutes.modelProfileId, extra })
      if (step.task === 'chapter_card') return { card, execution: 'remote' }
      if (step.task === 'scene_plan') return { scenePlan, execution: 'remote' }
      if (step.key === 'repair-draft' && failRepair) throw new Error('synthetic provider outage')
      return { manuscript: step.key === 'repair-draft' ? '他收起回执。他走出车站。' : '他交出票。他又拿起票。他走出车站。', execution: 'remote' }
    },
    applyCandidate: async ({ candidate }) => {
      if (candidate.artifactType === 'chapter_card') store.updateChapter({ id: candidate.chapterId, card: candidate.payload })
      if (candidate.artifactType === 'scene_plan') store.updateChapter({ id: candidate.chapterId, scenePlan: candidate.payload })
      if (candidate.artifactType === 'manuscript') store.updateChapter({ id: candidate.chapterId, manuscript: candidate.payload.manuscript })
    },
  })
  const stageModels = { planning: 'planner', writing: 'writer', review: 'reviewer', repair: 'repairer' }
  const start = (routes = {}) => runtime.start({ projectId: book.project.id, chapterId: book.chapters[0].id, workflowId: COLLABORATIVE_WORKFLOW_ID, modelRoutes: { stageModels, ...routes } })
  const waiting = (id, key) => until(() => { const run = repository.getRun(id); assert.notEqual(run.status, 'failed', run.error); return run.status === 'waiting_confirmation' && run.steps.find(s => s.id === run.currentStepId)?.key === key && run })
  const toReview = async (routes = {}) => {
    const run = await start(routes)
    for (const key of ['confirm-card', 'confirm-scenes']) {
      const next = await waiting(run.id, key)
      const candidate = next.candidates.find(c => c.status === 'pending')
      await runtime.confirmCandidate({ runId: run.id, candidateId: candidate.id, accept: true })
    }
    return waiting(run.id, 'choose-repairs')
  }
  return { db, store, book, repository, runtime, stageModels, calls, start, waiting, toReview,
    changeDigest: () => { digest = 'changed-source' }, failRepair: value => { failRepair = value } }
}

test('all four models are validated, locked without credentials, and remembered per work', async t => {
  const f = fixture(t)
  const run = f.repository.createRun({ projectId: f.book.project.id, chapterId: f.book.chapters[0].id, workflowId: COLLABORATIVE_WORKFLOW_ID, executionMode: 'codex', modelRoutes: { stageModels: f.stageModels } })
  assert.equal(run.executionMode, 'app_model')
  assert.equal(run.modelRoutes.stageProfiles.repair.model, 'grok-repairing')
  assert.equal(run.frozenContext.applicationWorkflow.id, COLLABORATIVE_WORKFLOW_ID)
  assert.doesNotMatch(JSON.stringify(run.modelRoutes), /synthetic-key/)
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT creative_preferences_json FROM projects WHERE id=?').get(f.book.project.id).creative_preferences_json).collaborativeModels, f.stageModels)
  assert.throws(() => lockCollaborativeModels(f.db, { stageModels: { ...f.stageModels, writing: 'missing' } }), /正文模型/)
  f.db.prepare("UPDATE model_profiles SET api_key_cipher='' WHERE id='writer'").run()
  assert.throws(() => lockCollaborativeModels(f.db, { stageModels: f.stageModels }), /API Key/)
  assert.equal(f.repository.listRuns({ projectId: f.book.project.id }).length, 1)
})

test('planning → draft → review → selected repair never writes a manuscript before final confirmation', async t => {
  const f = fixture(t)
  let run = await f.toReview()
  const original = run.candidates.find(c => c.artifactType === 'manuscript')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '正式旧稿。')
  assert.deepEqual(f.calls.map(c => [c.stage, c.profile]), [['planning', 'planner'], ['planning', 'planner'], ['writing', 'writer'], ['review', 'reviewer']])
  await assert.rejects(f.runtime.confirmCandidate({ runId: run.id, candidateId: original.id, accept: true }), /先确认审稿问题/)
  await assert.rejects(f.runtime.continueCollaborativeReview({ runId: run.id, issueIds: ['999'] }), /不属于本次报告/)
  await f.runtime.continueCollaborativeReview({ runId: run.id, issueIds: ['0'] })
  run = await f.waiting(run.id, 'confirm-draft')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '正式旧稿。')
  const repairCall = f.calls.at(-1)
  assert.equal(repairCall.profile, 'repairer')
  assert.equal(repairCall.extra.collaborativeRepair.issues.length, 1)
  assert.equal(repairCall.extra.collaborativeRepair.issues[0].id, 'ticket')
  assert.equal(repairCall.extra.collaborativeRepair.original.payload.manuscript, original.payload.manuscript)
  const repaired = run.candidates.find(c => c.evidence.parentCandidateId === original.id)
  await f.runtime.confirmCandidate({ runId: run.id, candidateId: repaired.id, accept: true })
  await until(() => f.repository.getRun(run.id).status === 'completed')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '他收起回执。他走出车站。')
  assert.equal(f.repository.getRun(run.id).candidates.find(c => c.id === original.id).status, 'rejected')
})

test('author can skip repair and approve the original; duplicate review actions are rejected', async t => {
  const f = fixture(t)
  let run = await f.toReview()
  await f.runtime.continueCollaborativeReview({ runId: run.id, skipRepair: true })
  run = await f.waiting(run.id, 'confirm-draft')
  await assert.rejects(f.runtime.continueCollaborativeReview({ runId: run.id, skipRepair: true }), /未处于审稿确认阶段/)
  assert.equal(f.calls.some(c => c.stage === 'repair'), false)
  const original = run.candidates.find(c => c.artifactType === 'manuscript')
  await f.runtime.confirmCandidate({ runId: run.id, candidateId: original.id, accept: true })
  await until(() => f.repository.getRun(run.id).status === 'completed')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, original.payload.manuscript)
})

test('changed sources pause repair; failures retain the original and allow repair-only retry', async t => {
  const f = fixture(t)
  const run = await f.toReview()
  f.failRepair(true)
  await f.runtime.continueCollaborativeReview({ runId: run.id, issueIds: ['0'] })
  const failed = await until(() => { const r = f.repository.getRun(run.id); return r.status === 'failed' && r })
  assert.equal(failed.candidates.find(c => c.artifactType === 'manuscript').status, 'pending')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '正式旧稿。')
  f.failRepair(false)
  await f.runtime.retryStep({ runId: run.id, stepId: failed.steps.find(s => s.key === 'repair-draft').id })
  const final = await f.waiting(run.id, 'confirm-draft')
  assert.equal(f.calls.filter(c => c.stage === 'writing').length, 1)
  f.changeDigest()
  await assert.rejects(f.runtime.confirmCandidate({ runId: run.id, candidateId: final.candidates.find(c => c.evidence.parentCandidateId).id, accept: true }), /已变化/)
})

test('model IDs remain pinned, but deleted/disabled/redirected profiles fail instead of switching models', t => {
  const f = fixture(t)
  const modelRoutes = lockCollaborativeModels(f.db, { stageModels: f.stageModels })
  const run = { workflowId: COLLABORATIVE_WORKFLOW_ID, modelRoutes }
  const effective = collaborativeExecution(run, { key: 'chapter-draft' })
  const current = { id: 'writer', provider: 'grok', enabled: true, baseUrl: 'https://provider.test/v1', model: 'new-model' }
  assert.equal(collaborativeProfile(effective, [current]).model, 'grok-writing')
  assert.throws(() => collaborativeProfile(effective, []), /已删除/)
  assert.throws(() => collaborativeProfile(effective, [{ ...current, baseUrl: 'https://different.test/v1' }]), /接口已改变/)
  assert.equal(collaborativeExecution({ ...run, modelRoutes: { stageModels: { planning: 'codex' } } }, { key: 'chapter-card' }).modelRoutes.agentProvider, 'codex')
})

test('Grok uses authenticated compatible streaming and structured JSON with no mock fallback', async t => {
  const modelProfile = { id: 'grok', provider: 'grok', name: 'Grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7', settings: { maxTokens: 24000 } }
  assert.throws(() => prepareModelTask({ task: 'chapter', modelProfile }), /Grok 配置/)
  const prepared = prepareModelTask({ task: 'chapter', modelProfile, apiKey: 'fixture-token', project: {}, chapter: {} })
  assert.equal(prepared.parameters.max_tokens, 24000)
  assert.equal(prepared.parameters.temperature, undefined)
  const oldFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = oldFetch })
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.x.ai/v1/chat/completions')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    assert.equal(JSON.parse(options.body).model, 'grok-4.7')
    return new Response('data: {"choices":[{"delta":{"content":"候选正文。"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  const result = await runEmbeddedModelTask(prepared, { taskId: 'grok-fixture' })
  assert.equal(result.manuscript, '候选正文。')
  const structured = prepareModelTask({ task: 'chapter_card', modelProfile, apiKey: 'fixture-token', project: {}, chapter: {} })
  assert.equal(structured.parameters.response_format.type, 'json_object')
})

test('mixed API/Grok ACP workflow pins independent stage models/effort and still requires final author confirmation', async t => {
  const f = fixture(t), acpCalls = []
  f.stageModels.writing = 'grok-build'; f.stageModels.repair = 'grok-build'
  f.runtime.prepareCodexPrompt = async ({ run, extra }) => {
    acpCalls.push({ provider: run.modelRoutes.agentProvider, model: run.modelRoutes.codexModel, effort: run.modelRoutes.codexReasoningEffort, extra })
    return { messages: [], agentProvider: run.modelRoutes.agentProvider, model: run.modelRoutes.codexModel, reasoningEffort: run.modelRoutes.codexReasoningEffort }
  }
  f.runtime.codexGateway = { prompt: async ({ settings }) => ({ backend: 'grok_acp', structuredOutput: { manuscript: settings.collaborativeStage === 'repair' ? '他收起回执。他走出车站。' : '他交出票。他又拿起票。他走出车站。' } }) }
  const stageAgentSettings = { writing: { model: 'grok-write', reasoningEffort: 'high' }, repair: { model: 'grok-repair', reasoningEffort: 'low' } }
  let run = await f.toReview({ stageAgentSettings })
  assert.equal(run.candidates.find(c => c.artifactType === 'manuscript').evidence.executionBackend, 'grok_acp')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '正式旧稿。')
  await f.runtime.continueCollaborativeReview({ runId: run.id, issueIds: ['0'] })
  run = await f.waiting(run.id, 'confirm-draft')
  assert.deepEqual(acpCalls.map(c => [c.provider,c.model,c.effort]), [['grok','grok-write','high'], ['grok','grok-repair','low']])
  assert.deepEqual(acpCalls[1].extra.collaborativeRepair.issues.map(i => i.id), ['ticket'])
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '正式旧稿。')
  assert.deepEqual(run.modelRoutes.stageAgentSettings, stageAgentSettings)
  const repaired = run.candidates.find(c => c.evidence.parentCandidateId)
  await f.runtime.confirmCandidate({ runId: run.id, candidateId: repaired.id, accept: true })
  await until(() => f.repository.getRun(run.id).status === 'completed')
  assert.equal(f.store.loadWorkspace(f.book.project.id).chapters[0].manuscript, '他收起回执。他走出车站。')
})
