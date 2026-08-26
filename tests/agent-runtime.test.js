import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AgentRuntime, manuscriptCharacterCount, manuscriptLengthRange, validateCandidate } from '../electron/agent-runtime.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { runMigrations } from '../electron/database-migrations.js'

const NOW = '2026-08-25T14:00:00.000Z'

function setup() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database, { now: () => NOW })
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('project-1', 'Agent 故事', '悬疑', '病历被修改', '', NOW, NOW)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '', ?)`)
    .run(NOW)
  const version = database.prepare('SELECT pack_id, version FROM creative_pack_versions LIMIT 1').get()
  database.prepare(`INSERT INTO project_pack_bindings
    (id, project_id, pack_id, pack_version, bound_at, updated_at)
    VALUES ('binding', 'project-1', ?, ?, ?, ?)`)
    .run(version.pack_id, version.version, NOW, NOW)
  let id = 0
  const repository = createCodexRepository(database, { now: () => NOW, createId: (prefix) => `${prefix}-${++id}` })
  const runtime = new AgentRuntime({
    repository,
    codexGateway: {},
    createMirror: async () => null,
    prepareCodexPrompt: async () => ({}),
    runPreflight: async () => ({ blocked: false, checks: [] }),
    currentSourceDigest: async () => 'source-digest',
    runAppModel: async ({ step }) => {
      if (step.task === 'planning_field') return {
        text: JSON.stringify({
          foundation: { premise: '调查被修改的病历', storyPromise: '每章推进一层证据', coreConflict: '追查真相会暴露身份' },
          mainCharacter: { title: '林砚', role: '主角', identity: '调查者', desire: '查清病历', need: '接受求助', fear: '再次失去证人' },
          world: { hardRules: '特殊钥匙每天午夜只能使用一次', costs: '违规会永久锁死一扇门' },
          outline: { logline: '调查者追查被修改病历', opening: '带伤返城', incitingIncident: '收到病历副本', climax: '进入地下室', ending: '听见自己的声音' },
        }),
        execution: 'mock',
      }
      if (step.task === 'chapter_card') return {
        card: {
          goal: '查清病历修改时间', protagonistGoal: '进入档案室', resistance: '门禁关闭',
          turningPoint: '发现登录日志', payoff: '锁定修改时间', ending: '锁定地下室', cost: '身份暴露',
          requiredScenes: [{ id: 'S1', title: '档案室', goal: '取得日志', result: '身份暴露' }],
        },
        execution: 'mock',
      }
      if (step.task === 'scene_plan') return {
        scenePlan: {
          schemaVersion: 1, summary: '进入档案室', legacyNotes: '',
          scenes: [{
            id: 'S1', title: '档案室', pov: '林砚', time: '夜', location: '医院',
            presentCharacters: ['林砚'], entryState: '门外', goal: '取得日志', obstacle: '门禁',
            actionBeats: ['尝试旧工牌', '复制日志'], turn: '保安出现', exitState: '身份暴露',
            knowledgeChanges: ['知道日志被改'], continuityRisks: [],
          }],
        },
        execution: 'mock',
      }
      throw new Error(`unexpected ${step.task}`)
    },
    applyCandidate: async ({ candidate }) => {
      if (candidate.artifactType === 'chapter_card') {
        database.prepare('UPDATE chapters SET card_json = ? WHERE id = ?').run(JSON.stringify(candidate.payload), candidate.chapterId)
      }
    },
  })
  return { database, repository, runtime }
}

async function waitFor(predicate, timeout = 1000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const result = predicate()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待 Agent 状态超时')
}

test('Agent runtime generates candidates without changing accepted project content', async () => {
  const { database, repository, runtime } = setup()
  const started = await runtime.start({
    projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'app_model', modelRoutes: {},
  })
  await runtime.advance(started.id)
  let run = await waitFor(() => {
    const current = repository.getRun(started.id)
    return current.status === 'waiting_confirmation' ? current : null
  })
  const cardCandidate = run.candidates.find((candidate) => candidate.artifactType === 'chapter_card')
  assert.ok(cardCandidate)
  assert.deepEqual(JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json), {})

  await runtime.confirmCandidate({ runId: run.id, candidateId: cardCandidate.id, accept: true })
  await runtime.advance(run.id)
  run = await waitFor(() => {
    const current = repository.getRun(started.id)
    return current.candidates.some((candidate) => candidate.artifactType === 'scene_plan') && current.status === 'waiting_confirmation' ? current : null
  })
  assert.equal(JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json).goal, '查清病历修改时间')
  const sceneCandidate = run.candidates.find((candidate) => candidate.artifactType === 'scene_plan')
  assert.equal(sceneCandidate.status, 'pending')
  assert.equal(database.prepare('SELECT scene_plan FROM chapters WHERE id = ?').get('chapter-1').scene_plan, '')
  database.close()
})

test('project initialization produces one structured foundation candidate before any write', async () => {
  const { database, repository, runtime } = setup()
  const started = await runtime.start({
    projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'project-initialization', executionMode: 'app_model', modelRoutes: {},
  })
  const run = await waitFor(() => {
    const current = repository.getRun(started.id)
    return ['waiting_confirmation', 'failed'].includes(current.status) ? current : null
  })
  assert.equal(run.status, 'waiting_confirmation', run.error)
  const candidate = run.candidates.find((item) => item.artifactType === 'foundation_bundle')
  assert.equal(candidate.payload.mainCharacter.title, '林砚')
  assert.equal(candidate.payload.world.hardRules, '特殊钥匙每天午夜只能使用一次')
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM planning_entities WHERE project_id = 'project-1'").get().count, 0)
  database.close()
})

test('structured candidates retry with a repair request and keep one Agent step lineage', async () => {
  const { database, repository, runtime } = setup()
  const calls = []
  runtime.runAppModel = async ({ step, extra }) => {
    calls.push({ task: step.task, repair: extra.structuredRepair || null })
    if (calls.length === 1) return { card: { goal: '字段不完整' }, execution: 'mock', generationRecordId: 'generation-1' }
    return {
      card: {
        goal: '查清病历修改时间', protagonistGoal: '进入档案室', resistance: '门禁关闭',
        turningPoint: '发现登录日志', payoff: '锁定修改时间', ending: '锁定地下室', cost: '身份暴露',
        requiredScenes: [{ id: 'S1', title: '档案室', goal: '取得日志', result: '身份暴露' }],
      },
      execution: 'mock',
    }
  }

  const started = await runtime.start({
    projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'app_model', modelRoutes: {},
  })
  const run = await waitFor(() => {
    const current = repository.getRun(started.id)
    return ['waiting_confirmation', 'failed'].includes(current.status) ? current : null
  })
  assert.equal(run.status, 'waiting_confirmation', run.error)
  const generationStep = run.steps.find((step) => step.task === 'chapter_card')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].repair.attempt, 2)
  assert.equal(calls[1].repair.retryOfGenerationId, 'generation-1')
  assert.equal(generationStep.attemptCount, 2)
  assert.equal(generationStep.generationRecordId, '')
  assert.equal(run.candidates.filter((candidate) => candidate.artifactType === 'chapter_card').length, 1)
  database.close()
})

test('chapter candidates must satisfy the AgentRun manuscript length contract', () => {
  assert.deepEqual(manuscriptLengthRange(3000), { target: 3000, minimum: 2700, maximum: 3600 })
  assert.equal(manuscriptCharacterCount('一段正文。\n\n第二段。'), 7)
  assert.throws(
    () => validateCandidate('chapter', { manuscript: '太短。' }, { targetLength: 3000 }),
    /目标 3000，必须落在 2700–3600 之间/,
  )
  assert.equal(validateCandidate('chapter', { manuscript: '字'.repeat(3000) }, { targetLength: 3000 }).manuscript.length, 3000)
})

test('quality review links its persisted report to the Agent step', async () => {
  const updates = []
  const run = {
    id: 'run-quality', projectId: 'project-1', chapterId: 'chapter-1', executionMode: 'app_model',
    candidates: [{ id: 'candidate-1', artifactType: 'manuscript', status: 'pending', payload: { manuscript: '正文' }, evidence: {} }],
  }
  const step = { id: 'step-quality', task: 'quality_review', attemptCount: 0 }
  const runtime = new AgentRuntime({
    repository: {
      updateStep: (id, input) => { updates.push({ id, input }); return input },
      updateRun: () => run,
    },
    codexGateway: {},
    createMirror: async () => null,
    prepareCodexPrompt: async () => ({}),
    runAppModel: async () => ({ review: { scores: {}, issues: [], summary: '完成' }, qualityReportId: 'quality-1', execution: 'app_model' }),
    runPreflight: async () => ({}),
    applyCandidate: async () => {},
    currentSourceDigest: async () => '',
  })
  await runtime._executeQualityStep({ run, step, mirror: null, eventContext: null })
  assert.equal(updates.at(-1).input.qualityReportId, 'quality-1')
  assert.equal(updates.at(-1).input.status, 'completed')
})

test('completed AgentRun emits a terminal event for immediate UI refresh', async () => {
  let current = { id: 'run-complete', status: 'running', executionMode: 'app_model', steps: [] }
  const events = []
  const runtime = new AgentRuntime({
    repository: {
      getRun: () => current,
      updateRun: (_id, input) => { current = { ...current, ...input }; return current },
    },
    codexGateway: {},
    createMirror: async () => null,
    prepareCodexPrompt: async () => ({}),
    runAppModel: async () => ({}),
    runPreflight: async () => ({}),
    applyCandidate: async () => {},
    currentSourceDigest: async () => '',
    onEvent: (event) => events.push(event),
  })
  await runtime.advance(current.id)
  assert.equal(current.status, 'completed')
  assert.equal(events.at(-1).type, 'run_completed')
})
