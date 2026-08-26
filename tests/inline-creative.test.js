import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AgentRuntime } from '../electron/agent-runtime.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { runMigrations } from '../electron/database-migrations.js'
import {
  inlineTargetKey,
  normalizeInlineCreativeAction,
  projectForInlineTarget,
  sanitizeProjectDraftContext,
} from '../electron/inline-creative.js'

const NOW = '2026-08-25T16:00:00.000Z'

function setup() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database, { now: () => NOW })
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('project-1', '就地创作', '都市悬疑', '调查被修改的病历', '', NOW, NOW)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '原始正文', ?)`)
    .run(NOW)
  for (const kind of ['foundation', 'world', 'outline']) {
    database.prepare('INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('project-1', kind, '{}', NOW, NOW)
  }
  const pack = database.prepare('SELECT pack_id, version FROM creative_pack_versions LIMIT 1').get()
  database.prepare(`INSERT INTO project_pack_bindings
    (id, project_id, pack_id, pack_version, bound_at, updated_at)
    VALUES ('binding-1', 'project-1', ?, ?, ?, ?)`).run(pack.pack_id, pack.version, NOW, NOW)
  let id = 0
  const repository = createCodexRepository(database, { now: () => NOW, createId: (prefix) => `${prefix}-${++id}` })
  return { database, repository }
}

function planningAction(fieldKey = 'premise') {
  return {
    projectId: 'project-1',
    task: 'planning_field',
    target: {
      kind: 'planning_document', targetId: 'foundation', fieldKey,
      fieldLabel: fieldKey === 'premise' ? '故事前提' : '核心冲突', promptProfile: fieldKey,
    },
    instruction: '给出一版更具体的候选。',
  }
}

test('inline actions enforce target/task boundaries and stable target keys', () => {
  const normalized = normalizeInlineCreativeAction(planningAction())
  assert.equal(normalized.schemaVersion, 1)
  assert.equal(normalized.candidateType, 'planning_field')
  assert.equal(normalized.targetKey, inlineTargetKey(normalized.target))
  assert.throws(() => normalizeInlineCreativeAction({ ...planningAction(), task: 'chapter' }), /不能用于/)
  assert.throws(() => normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'rewrite',
    target: { kind: 'manuscript_selection', targetId: 'chapter-1', selectionFrom: 4, selectionTo: 2 },
  }), /选区无效/)
  assert.throws(() => normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'planning_field',
    target: { kind: 'relationship_draft', fieldKey: 'tension' },
  }), /草稿摘要/)
  assert.throws(() => normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'quality_review', target: { kind: 'quality_review', targetId: 'chapter-1' },
  }), /生成记录/)
  const repair = normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'chapter', intent: 'repair',
    target: {
      kind: 'manuscript', targetId: 'chapter-1', sourceGenerationId: 'generation-1',
      reportId: 'quality-1', issueIds: ['causality', 'continuity'],
    },
  })
  assert.equal(repair.intent, 'repair')
  assert.deepEqual(repair.target.issueIds, ['causality', 'continuity'])
  assert.equal(repair.candidateType, 'manuscript')
  const storyChange = normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'story_change', intent: 'analysis',
    target: { kind: 'story_change_set', targetId: 'change-set-1', fieldKey: 'items', fieldLabel: '设定联动修改' },
  })
  assert.equal(storyChange.candidateType, 'story_change_set')
  assert.equal(storyChange.intent, 'analysis')
})

test('project brief drafts use a bounded pending genre without mutating formal project facts', () => {
  const formalProject = { id: 'project-1', title: '旧标题', genre: '都市悬疑', idea: '旧想法', style: '旧文风' }
  const rawDraft = {
    title: '来信', genre: '文娱', idea: '一个过气歌手重新登台', style: '轻松自然',
    apiKey: 'must-not-pass', unknown: 'ignored',
  }
  assert.deepEqual(sanitizeProjectDraftContext(rawDraft), {
    title: '来信', genre: '文娱', idea: '一个过气歌手重新登台', style: '轻松自然',
  })
  const normalized = normalizeInlineCreativeAction({
    projectId: 'project-1', task: 'planning_field',
    target: {
      kind: 'project_brief_draft', targetId: 'project-1', fieldKey: 'idea', fieldLabel: '一句话想法',
      draftDigest: 'draft-a', draftContext: rawDraft,
    },
  })
  assert.equal(normalized.target.draftContext.genre, '文娱')
  assert.equal(normalized.target.draftContext.apiKey, undefined)
  const promptProject = projectForInlineTarget(formalProject, normalized.target)
  assert.equal(promptProject.genre, '文娱')
  assert.equal(promptProject.idea, '一个过气歌手重新登台')
  assert.equal(formalProject.genre, '都市悬疑')
})

test('inline repository reuses an active target while allowing different targets', () => {
  const { database, repository } = setup()
  const first = repository.createInlineRun(planningAction('premise'))
  const focused = repository.createInlineRun(planningAction('premise'))
  const parallel = repository.createInlineRun(planningAction('coreConflict'))
  assert.equal(first.workflowId, 'inline-action')
  assert.equal(first.executionMode, 'codex')
  assert.equal(first.steps.length, 1)
  assert.equal(first.steps[0].input.target.fieldKey, 'premise')
  assert.equal(focused.id, first.id)
  assert.equal(focused.focusedExisting, true)
  assert.notEqual(parallel.id, first.id)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_id = 'inline-action'").get().count, 2)
  database.close()
})

test('one planning card creates one reusable AgentRun and one structured bundle step', () => {
  const { database, repository } = setup()
  database.prepare(`
    INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
    VALUES ('character-1', 'project-1', 'character', '人物 2', 1, ?, ?, ?)
  `).run(JSON.stringify({ role: '主角', identity: '', desire: '' }), NOW, NOW)
  const request = {
    projectId: 'project-1',
    task: 'planning_field',
    executionMode: 'app_model',
    modelRoutes: { planning_field: 'mimo-default' },
    target: {
      kind: 'planning_entity_bundle', targetId: 'character-1',
      fieldKeys: ['title', 'role', 'identity', 'desire'],
    },
  }
  const first = repository.createInlineRun(request)
  const focused = repository.createInlineRun({ ...request, executionMode: 'codex' })
  assert.equal(first.executionMode, 'app_model')
  assert.equal(first.steps.length, 1)
  assert.equal(first.steps[0].candidateType, 'planning_entity_bundle')
  assert.deepEqual(first.steps[0].input.target.fieldKeys, ['title', 'identity', 'desire'])
  assert.equal(focused.id, first.id)
  assert.equal(focused.focusedExisting, true)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_id = 'inline-action'").get().count, 1)
  database.close()
})

test('one planning document page creates one reusable AgentRun and preserves confirmed fields', () => {
  const { database, repository } = setup()
  database.prepare("UPDATE planning_documents SET content_json = ? WHERE project_id = 'project-1' AND kind = 'world'")
    .run(JSON.stringify({ era: '近现代平行世界', geography: '', hardRules: '技能不能替代现实资源', costs: '' }))
  const request = {
    projectId: 'project-1', task: 'planning_field', executionMode: 'codex',
    target: {
      kind: 'planning_document_bundle', targetId: 'world',
      fieldKeys: ['era', 'geography', 'hardRules', 'costs'],
    },
  }
  const first = repository.createInlineRun(request)
  const focused = repository.createInlineRun(request)
  assert.equal(first.steps.length, 1)
  assert.equal(first.steps[0].candidateType, 'planning_document_bundle')
  assert.deepEqual(first.steps[0].input.target.fieldKeys, ['geography', 'costs'])
  assert.deepEqual(first.steps[0].input.target.fields.map((field) => field.label), ['空间结构', '代价与限制'])
  assert.equal(focused.id, first.id)
  assert.equal(focused.focusedExisting, true)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_id = 'inline-action'").get().count, 1)
  database.close()
})

test('one chapter planning page creates one reusable AgentRun and protects completed fields', () => {
  const { database, repository } = setup()
  database.prepare("UPDATE chapters SET card_json = ?, scene_plan = '' WHERE id = 'chapter-1'")
    .run(JSON.stringify({ goal: '完成首场公开交付', protagonistGoal: '', ending: '收到节目邀请' }))
  const request = {
    projectId: 'project-1', chapterId: 'chapter-1', task: 'planning_field', executionMode: 'codex',
    target: {
      kind: 'planning_chapter_bundle', targetId: 'chapter-1',
      fieldKeys: ['goal', 'protagonistGoal', 'ending', 'scenePlan'],
    },
  }
  const first = repository.createInlineRun(request)
  const focused = repository.createInlineRun(request)
  assert.equal(first.chapterId, 'chapter-1')
  assert.equal(first.steps.length, 1)
  assert.equal(first.steps[0].candidateType, 'planning_chapter_bundle')
  assert.deepEqual(first.steps[0].input.target.fieldKeys, ['protagonistGoal', 'scenePlan'])
  assert.equal(focused.id, first.id)
  assert.equal(focused.focusedExisting, true)
  database.close()
})

test('one Codex card session returns all requested fields in one candidate and reuses the run for revisions', async () => {
  const { database, repository } = setup()
  database.prepare(`
    INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
    VALUES ('character-1', 'project-1', 'character', '林砚', 1, ?, ?, ?)
  `).run(JSON.stringify({
    role: '主角', identity: '', desire: '', need: '接受合作', fear: '失去证人', flaw: '独断',
    secret: '隐瞒旧案', arc: '学会协作', voice: '短句', relationships: '与医生互相试探',
  }), NOW, NOW)
  const calls = []
  const applied = []
  const runtime = new AgentRuntime({
    repository,
    codexGateway: {
      prompt: async ({ agentRunId }) => {
        calls.push(agentRunId)
        return {
          backend: 'codex_acp', sessionId: 'one-card-session', outputStarted: true,
          structuredOutput: {
            fields: {
              identity: calls.length === 1 ? '带伤返城的调查者' : '带伤返城、暂住旧城区的调查者',
              desire: '查清病历被谁修改',
            },
          },
        }
      },
      closeSession: async () => {},
    },
    createMirror: async () => ({ root: '/tmp/card-run', sourceDigest: 'source-a' }),
    refreshMirror: async () => ({ root: '/tmp/card-run', sourceDigest: 'source-a' }),
    prepareCodexPrompt: async () => ({ messages: [], outputSchema: null }),
    currentSourceDigest: async () => 'source-a',
    applyCandidate: async (input) => applied.push(input),
    runPreflight: async () => ({}),
  })
  const started = await runtime.startInline({
    projectId: 'project-1', task: 'planning_field', executionMode: 'codex',
    target: { kind: 'planning_entity_bundle', targetId: 'character-1', fieldKeys: ['identity', 'desire'] },
  })
  await runtime.advance(started.id)
  let run = repository.getRun(started.id)
  assert.equal(calls.length, 1)
  assert.equal(run.candidates.length, 1)
  assert.equal(run.candidates[0].artifactType, 'planning_entity_bundle')
  assert.deepEqual(run.candidates[0].payload.fields.map((field) => field.key), ['identity', 'desire'])

  await runtime.confirmCandidate({
    runId: run.id,
    candidateId: run.candidates[0].id,
    accept: true,
    applyOptions: { fieldKeys: ['identity'] },
  })
  assert.deepEqual(applied[0].applyOptions.fieldKeys, ['identity'])
  run = await runtime.continueInline({
    runId: run.id,
    parentCandidateId: run.candidates[0].id,
    instruction: '身份再具体一点，保留其他字段。',
  })
  await runtime.advance(run.id)
  run = repository.getRun(run.id)
  assert.equal(run.id, started.id)
  assert.deepEqual(calls, [started.id, started.id])
  assert.equal(run.candidates.length, 2)
  assert.equal(run.candidates.at(-1).payload.fields[0].candidateValue, '带伤返城、暂住旧城区的调查者')
  database.close()
})

test('inline repository rejects targets owned by another project', () => {
  const { database, repository } = setup()
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('project-2', '其他项目', '悬疑', '', '', NOW, NOW)
  assert.throws(() => repository.createInlineRun({
    projectId: 'project-2', chapterId: 'chapter-1', task: 'chapter',
    target: { kind: 'manuscript', targetId: 'chapter-1' },
  }), /章节不属于当前项目/)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-2', 'project-2', 1, '第一章', 'draft', '{}', '', '', ?)`).run(NOW)
  database.prepare(`INSERT INTO generation_records
    (id, task_id, project_id, chapter_id, task, status, output_text, created_at, completed_at)
    VALUES ('generation-2', 'task-2', 'project-2', 'chapter-2', 'chapter', 'completed', '他书正文', ?, ?)`).run(NOW, NOW)
  assert.throws(() => repository.createInlineRun({
    projectId: 'project-1', chapterId: 'chapter-1', task: 'quality_review',
    target: { kind: 'quality_review', targetId: 'chapter-1', sourceGenerationId: 'generation-2' },
  }), /生成记录不属于当前项目/)
  database.close()
})

test('inline runtime creates only a candidate and marks changed renderer drafts stale', async () => {
  const { database, repository } = setup()
  const applied = []
  const runtime = new AgentRuntime({
    repository,
    codexGateway: { closeSession: async () => {} },
    createMirror: async () => ({ root: '/tmp/inline-run', sourceDigest: 'source-a' }),
    refreshMirror: async () => ({ root: '/tmp/inline-run', sourceDigest: 'source-a' }),
    prepareCodexPrompt: async () => ({ messages: [], outputSchema: null }),
    currentSourceDigest: async () => 'source-a',
    applyCandidate: async (input) => applied.push(input),
    runPreflight: async () => ({}),
  })
  runtime.codexGateway.prompt = async () => ({ backend: 'codex_acp', text: '关系从合作转为互相试探。', outputStarted: true })
  const started = await runtime.startInline({
    projectId: 'project-1', task: 'planning_field',
    target: { kind: 'relationship_draft', fieldKey: 'tension', fieldLabel: '真实张力', draftDigest: 'draft-a' },
  })
  await runtime.advance(started.id)
  let run = repository.getRun(started.id)
  assert.equal(run.status, 'waiting_confirmation')
  assert.equal(run.candidates.length, 1)
  assert.equal(run.candidates[0].artifactType, 'renderer_draft')
  assert.equal(applied.length, 0)
  await assert.rejects(() => runtime.confirmCandidate({
    runId: run.id, candidateId: run.candidates[0].id, accept: true, currentDraftDigest: 'draft-b',
  }), /已经修改/)
  run = repository.getRun(run.id)
  assert.equal(run.candidates[0].status, 'stale')
  assert.equal(applied.length, 0)
  const discarded = await runtime.confirmCandidate({
    runId: run.id, candidateId: run.candidates[0].id, accept: false,
  })
  assert.equal(discarded.status, 'completed')
  assert.equal(repository.getRun(run.id).candidates[0].status, 'rejected')
  database.close()
})

test('discarding a pending renderer draft skips source and draft digest validation', async () => {
  const { database, repository } = setup()
  const runtime = new AgentRuntime({
    repository,
    codexGateway: {
      prompt: async () => ({ backend: 'codex_acp', text: '一名过气歌手用匿名账号发布旧作，意外掀起一场行业翻身战。', outputStarted: true }),
      closeSession: async () => {},
    },
    createMirror: async () => ({ root: '/tmp/inline-run', sourceDigest: 'source-a' }),
    refreshMirror: async () => ({ root: '/tmp/inline-run', sourceDigest: 'source-a' }),
    prepareCodexPrompt: async () => ({ messages: [], outputSchema: null }),
    currentSourceDigest: async () => { throw new Error('reject must not read source digest') },
    applyCandidate: async () => { throw new Error('reject must not apply candidate') },
    runPreflight: async () => ({}),
  })
  const started = await runtime.startInline({
    projectId: 'project-1', task: 'planning_field',
    target: {
      kind: 'project_brief_draft', targetId: 'project-1', fieldKey: 'idea', fieldLabel: '一句话想法',
      draftDigest: 'draft-a', draftContext: { title: '来信', genre: '文娱', idea: '', style: '轻松自然' },
    },
  })
  await runtime.advance(started.id)
  const waiting = repository.getRun(started.id)
  const discarded = await runtime.confirmCandidate({
    runId: waiting.id, candidateId: waiting.candidates[0].id, accept: false,
  })
  assert.equal(discarded.status, 'completed')
  assert.equal(repository.getRun(waiting.id).candidates[0].status, 'rejected')
  database.close()
})

test('inline Codex conversation keeps one run and session across revision candidates', async () => {
  const { database, repository } = setup()
  const prompts = []
  const applied = []
  let closedSessions = 0
  const runtime = new AgentRuntime({
    repository,
    codexGateway: {
      prompt: async ({ agentRunId, agentStepId }) => {
        prompts.push({ agentRunId, agentStepId })
        return {
          backend: 'codex_acp',
          sessionId: 'session-one',
          text: prompts.length === 1 ? '第一版故事前提。' : prompts.length === 2 ? '按作者要求缩短后的第二版。' : '第三版故事前提。',
          outputStarted: true,
        }
      },
      closeSession: async () => { closedSessions += 1 },
    },
    createMirror: async () => ({ root: '/tmp/inline-run', workspaceRoot: '/tmp/book', sourceDigest: 'source-a' }),
    refreshMirror: async () => ({ root: '/tmp/inline-run', workspaceRoot: '/tmp/book', sourceDigest: 'source-a' }),
    prepareCodexPrompt: async ({ step }) => {
      if (step.input.revision) assert.match(step.input.revision.instruction, /缩短|职业阻力/)
      return { messages: [], outputSchema: null }
    },
    currentSourceDigest: async () => 'source-a',
    applyCandidate: async (input) => applied.push(input),
    runPreflight: async () => ({}),
  })

  const started = await runtime.startInline(planningAction('premise'))
  await runtime.advance(started.id)
  let run = repository.getRun(started.id)
  const first = run.candidates[0]
  assert.equal(first.status, 'pending')

  await runtime.continueInline({
    runId: run.id,
    parentCandidateId: first.id,
    instruction: '缩短到一百字，并保留核心冲突。',
  })
  await runtime.advance(run.id)
  run = repository.getRun(run.id)
  assert.equal(run.id, started.id)
  assert.equal(run.steps.length, 2)
  assert.equal(run.steps[1].input.revision.parentCandidateId, first.id)
  assert.equal(run.candidates[0].status, 'stale')
  assert.equal(run.candidates[1].status, 'pending')
  assert.deepEqual(prompts.map((item) => item.agentRunId), [started.id, started.id])
  assert.equal(closedSessions, 0)

  const second = run.candidates[1]
  run = await runtime.confirmCandidate({ runId: run.id, candidateId: second.id, accept: true })
  assert.equal(run.status, 'waiting_confirmation')
  assert.equal(repository.getRun(run.id).candidates[1].status, 'accepted')
  assert.equal(applied.length, 1)
  assert.equal(closedSessions, 0)

  await runtime.continueInline({
    runId: run.id,
    parentCandidateId: second.id,
    instruction: '加入一项明确的职业阻力。',
  })
  await runtime.advance(run.id)
  run = repository.getRun(run.id)
  assert.equal(run.steps.length, 3)
  assert.equal(run.candidates[2].status, 'pending')
  assert.equal(run.candidates[1].status, 'accepted')
  assert.equal(prompts.length, 3)

  await runtime.confirmCandidate({ runId: run.id, candidateId: run.candidates[2].id, accept: true })
  const finished = await runtime.finishInline(run.id)
  assert.equal(finished.status, 'completed')
  assert.equal(closedSessions, 1)
  await assert.rejects(() => runtime.continueInline({
    runId: run.id,
    parentCandidateId: run.candidates[2].id,
    instruction: '结束后再次修改。',
  }), /已经结束/)
  database.close()
})

test('renderer draft revisions lock the latest editor digest and value', () => {
  const { database, repository } = setup()
  const run = repository.createInlineRun({
    projectId: 'project-1', task: 'planning_field',
    target: {
      kind: 'project_brief_draft', targetId: 'project-1', fieldKey: 'idea', fieldLabel: '一句话想法',
      draftDigest: 'draft-a', draftContext: { title: '来信', genre: '文娱', idea: '旧想法', style: '轻松自然' },
    },
  })
  repository.updateStep(run.steps[0].id, { status: 'completed' })
  const candidate = repository.createCandidate({
    runId: run.id, stepId: run.steps[0].id, projectId: 'project-1', artifactType: 'renderer_draft',
    sourceDigest: 'source-a', payload: { text: '第一版想法' }, evidence: {},
  })
  const revised = repository.appendInlineRevision({
    runId: run.id,
    parentCandidateId: candidate.id,
    instruction: '改成轻松文娱方向。',
    currentDraftDigest: 'draft-b',
    currentDraftValue: '作者手动修改后的想法',
  })
  assert.equal(revised.steps[1].input.target.draftDigest, 'draft-b')
  assert.equal(revised.steps[1].input.target.draftValue, '作者手动修改后的想法')
  assert.equal(revised.steps[1].input.target.draftContext.idea, '作者手动修改后的想法')
  assert.equal(revised.candidates[0].status, 'stale')
  database.close()
})
