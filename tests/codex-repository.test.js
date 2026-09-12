import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createCodexRepository, EVENT_TOOL_OUTPUT_LIMIT } from '../electron/codex-repository.js'
import { runMigrations } from '../electron/database-migrations.js'

const NOW = '2026-08-25T13:00:00.000Z'

function setup() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database, { now: () => NOW })
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('project-1', 'Codex 项目', '悬疑', '病历被修改', '', NOW, NOW)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '', ?)`)
    .run(NOW)
  const version = database.prepare('SELECT pack_id, version FROM creative_pack_versions ORDER BY installed_at LIMIT 1').get()
  database.prepare(`INSERT INTO project_pack_bindings
    (id, project_id, pack_id, pack_version, bound_at, updated_at)
    VALUES ('binding-1', 'project-1', ?, ?, ?, ?)`)
    .run(version.pack_id, version.version, NOW, NOW)
  let id = 0
  const repository = createCodexRepository(database, {
    now: () => NOW,
    createId: (prefix) => `${prefix}-${++id}`,
  })
  return { database, repository }
}

test('Codex repository persists one session and workflow steps per AgentRun', () => {
  const { database, repository } = setup()
  const run = repository.createRun({
    projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation',
    executionMode: 'codex', modelRoutes: { model: 'gpt-5.2-codex' },
  })
  assert.equal(run.executionMode, 'codex')
  assert.equal(run.steps.length, 10)
  assert.equal(run.steps[0].key, 'preflight')
  const session = repository.upsertSession({
    agentRunId: run.id, backend: 'codex_acp', sessionId: 'session-1', status: 'active',
    protocolVersion: '1', adapterVersion: '1.6.2', capabilities: { loadSession: true },
  })
  assert.equal(session.sessionId, 'session-1')
  const resumed = repository.upsertSession({ agentRunId: run.id, status: 'active', recoveryStrategy: 'resume' })
  assert.equal(resumed.id, session.id)
  assert.equal(resumed.recoveryStrategy, 'resume')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_run_id = ?').get(run.id).count, 1)
  database.close()
})

test('Agent provider settings persist Qoder selection and its external CLI path', () => {
  const { database, repository } = setup()
  const defaults = repository.getProviderSettings()
  assert.equal(defaults.agentProvider, 'codex')
  assert.equal(defaults.qoderCliPath, '')
  assert.equal(defaults.qoderModel, 'auto')
  const saved = repository.updateProviderSettings({ agentProvider: 'qoder', qoderCliPath: ' /Users/test/.local/bin/qoder ', qoderModel: ' qmodel_38max ' })
  assert.equal(saved.agentProvider, 'qoder')
  assert.equal(saved.qoderCliPath, '/Users/test/.local/bin/qoder')
  assert.equal(saved.qoderModel, 'qmodel_38max')
  assert.throws(() => database.prepare("UPDATE agent_provider_settings SET agent_provider = 'other' WHERE id = 'codex'").run(), /CHECK constraint failed/)
  database.close()
})

test('Codex events are ordered, redacted and bounded', () => {
  const { database, repository } = setup()
  const run = repository.createRun({ projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'codex' })
  const first = repository.appendEvent({
    agentRunId: run.id, type: 'status', payload: { authorization: 'Bearer secret', state: 'running' },
  })
  const second = repository.appendEvent({
    agentRunId: run.id, type: 'tool_result', payload: { output: 'a'.repeat(EVENT_TOOL_OUTPUT_LIMIT + 50) },
  })
  assert.equal(first.sequence, 1)
  assert.equal(first.payload.authorization, '[redacted]')
  assert.equal(second.payload.truncated, true)
  assert.equal(second.sequence, 2)
  assert.deepEqual(repository.listEvents(run.id).map((event) => event.sequence), [1, 2])
  database.close()
})

test('Codex approvals are per action, expire, and never persist secret fields', () => {
  const { database, repository } = setup()
  const run = repository.createRun({ projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'codex' })
  const step = run.steps[1]
  const approval = repository.createApproval({
    projectId: run.projectId, agentRunId: run.id, agentStepId: step.id,
    actionType: 'model_call', permission: '生成章节卡', payload: { apiKey: 'never-store', task: 'chapter_card' },
    expiresAt: '2099-01-01T00:00:00.000Z',
  })
  assert.equal(approval.payload.apiKey, '[redacted]')
  assert.equal(repository.resolveApproval({ id: approval.id, approved: true, note: '本次运行' }).status, 'approved')
  assert.throws(() => repository.resolveApproval({ id: approval.id, approved: true }), /已经是 approved/)
  const rejected = repository.createApproval({
    projectId: run.projectId, agentRunId: run.id, agentStepId: step.id,
    actionType: 'web', permission: '查询资料', expiresAt: '2099-01-01T00:00:00.000Z',
  })
  assert.equal(repository.resolveApproval({ id: rejected.id, approved: false, reason: '本次不需要联网' }).status, 'rejected')
  database.close()
})

test('rejecting an upstream candidate stales downstream outputs and project deletion cascades', () => {
  const { database, repository } = setup()
  const run = repository.createRun({ projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'codex' })
  const cardStep = run.steps.find((step) => step.key === 'chapter-card')
  const sceneStep = run.steps.find((step) => step.key === 'scene-plan')
  repository.updateStep(cardStep.id, { status: 'waiting_confirmation' })
  repository.updateStep(sceneStep.id, { status: 'waiting_confirmation' })
  const card = repository.createCandidate({
    runId: run.id, stepId: cardStep.id, projectId: run.projectId, chapterId: run.chapterId,
    artifactType: 'chapter_card', sourceDigest: 'source-a', payload: { goal: '调查病历' },
  })
  repository.createCandidate({
    runId: run.id, stepId: sceneStep.id, projectId: run.projectId, chapterId: run.chapterId,
    artifactType: 'scene_plan', sourceDigest: 'source-a', payload: { scenes: [] },
  })
  repository.resolveCandidate({ id: card.id, accept: false, reason: '目标需要重做' })
  assert.equal(repository.getRun(run.id).candidates.find((candidate) => candidate.stepId === sceneStep.id).status, 'stale')
  database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bridge_action_requests').get().count, 0)
  database.close()
})

test('stored planning candidates are cleaned when runs are read again', () => {
  const { database, repository } = setup()
  const run = repository.createRun({ projectId: 'project-1', chapterId: 'chapter-1', workflowId: 'chapter-creation', executionMode: 'codex' })
  const step = run.steps[1]
  repository.updateStep(step.id, { input: { target: { fieldLabel: '核心冲突' } } })
  repository.createCandidate({
    runId: run.id,
    stepId: step.id,
    projectId: run.projectId,
    chapterId: run.chapterId,
    artifactType: 'planning_field',
    sourceDigest: 'source-a',
    payload: {
      text: [
        'Warning: Falling back from WebSockets to HTTPS transport, stream disconnected before completion: tls handshake eof',
        '我将校准核心冲突候选，并严格只在受控镜像内处理。核心冲突：周砚必须在翻红机会与现实承诺之间作出选择。',
      ].join('\n'),
    },
  })

  assert.equal(
    repository.getRun(run.id).candidates[0].payload.text,
    '周砚必须在翻红机会与现实承诺之间作出选择。',
  )
  database.close()
})
