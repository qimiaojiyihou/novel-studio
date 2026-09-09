import { createHash, randomUUID } from 'node:crypto'
import { INLINE_CONVERSATION_STEP_LIMIT, inlineTargetKey, normalizeInlineCreativeAction } from './inline-creative.js'
import { cleanPlanningFieldText } from './generated-text.js'
import { createPromptRepository } from './prompt-repository.js'
import { contentDigest } from './chapter-finalization.js'
import { buildPlanningChapterBundleTarget, buildPlanningDocumentBundleTarget, buildPlanningEntityBundleTarget } from './planning-bundle.js'

const EVENT_TOOL_OUTPUT_LIMIT = 64 * 1024
const RUN_EVENT_LIMIT = 5 * 1024 * 1024
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|cookie|credential|request[-_]?headers?)/i
const ACTIVE_INLINE_STEP_STATUSES = new Set(['pending', 'running', 'waiting_approval', 'interrupted'])

function requestedRoutesMatch(lockedRoutes = {}, requestedRoutes = {}) {
  return Object.entries(requestedRoutes || {}).every(([key, value]) => {
    if (value === undefined) return true
    return JSON.stringify(lockedRoutes?.[key]) === JSON.stringify(value)
  })
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function redact(value, depth = 0) {
  if (depth > 12) return '[depth-limit]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(child, depth + 1),
  ]))
}

function stringifyRedacted(value) {
  return JSON.stringify(redact(value ?? {}))
}

function mapRun(row) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id || '',
    workflowId: row.workflow_id,
    creativePack: {
      id: row.creative_pack_id,
      version: row.creative_pack_version,
      digest: row.creative_pack_digest,
    },
    modelRoutes: parseJson(row.model_routes_json),
    frozenContext: parseJson(row.frozen_context_json),
    legacySnapshot: !row.frozen_context_json || row.frozen_context_json === '{}',
    connectionReleasedAt: row.connection_released_at || '',
    parentRunId: row.parent_run_id || '',
    executionMode: row.execution_mode,
    actualBackend: row.actual_backend,
    fallbackReason: row.fallback_reason,
    sessionRecreated: Boolean(row.session_recreated),
    status: row.status,
    currentStepId: row.current_step_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  } : null
}

function mapStep(row) {
  return row ? {
    id: row.id,
    runId: row.run_id,
    key: row.step_key,
    position: Number(row.position),
    action: row.action,
    task: row.task,
    candidateType: row.candidate_type,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    dependsOn: parseJson(row.depends_on_json, []),
    input: parseJson(row.input_json),
    promptSnapshot: parseJson(row.prompt_snapshot_json),
    output: parseJson(row.output_json),
    generationRecordId: row.generation_record_id || '',
    qualityReportId: row.quality_report_id || '',
    approvalId: row.approval_id,
    outputStarted: Boolean(row.output_started),
    interruptedAt: row.interrupted_at,
    executionBackend: row.execution_backend,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapCandidate(row) {
  return row ? {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    projectId: row.project_id,
    chapterId: row.chapter_id || '',
    artifactType: row.artifact_type,
    status: row.status,
    sourceDigest: row.source_digest,
    payload: parseJson(row.payload_json),
    evidence: parseJson(row.evidence_json),
    overrideReason: row.override_reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  } : null
}

function mapSession(row) {
  return row ? {
    id: row.id,
    agentRunId: row.agent_run_id,
    backend: row.backend,
    sessionId: row.session_id,
    status: row.status,
    protocolVersion: row.protocol_version,
    adapterVersion: row.adapter_version,
    capabilities: parseJson(row.capabilities_json),
    authMethod: row.auth_method,
    recoveryStrategy: row.recovery_strategy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  } : null
}

function mapEvent(row) {
  return row ? {
    id: row.id,
    agentRunId: row.agent_run_id,
    agentStepId: row.agent_step_id || '',
    sequence: Number(row.sequence),
    type: row.event_type,
    summary: row.summary,
    payload: parseJson(row.payload_json),
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
  } : null
}

function mapApproval(row) {
  return row ? {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    origin: row.origin,
    agentRunId: row.agent_run_id || '',
    agentStepId: row.agent_step_id || '',
    externalRequestId: row.external_request_id,
    actionType: row.action_type,
    status: row.status,
    permission: row.permission,
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    error: row.error,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at,
  } : null
}

export function createCodexRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const runById = database.prepare('SELECT * FROM agent_runs WHERE id = ?')
  const stepById = database.prepare('SELECT * FROM agent_steps WHERE id = ?')
  const candidateById = database.prepare('SELECT * FROM agent_candidates WHERE id = ?')
  const approvalById = database.prepare('SELECT * FROM bridge_action_requests WHERE id = ?')

  function getProviderSettings() {
    const row = database.prepare('SELECT * FROM agent_provider_settings WHERE id = ?').get('codex')
    return row ? {
      enabled: Boolean(row.enabled),
      preferredBackend: row.preferred_backend,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      fastMode: Boolean(row.fast_mode),
      adapterVersion: row.adapter_version,
      authMethod: row.auth_method,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null
  }

  function updateProviderSettings(input = {}) {
    const current = getProviderSettings()
    if (!current) throw new Error('Codex Agent 设置不存在')
    const updatedAt = now()
    database.prepare(`
      UPDATE agent_provider_settings SET enabled = ?, preferred_backend = ?, model = ?,
        reasoning_effort = ?, fast_mode = ?, auth_method = ?, updated_at = ? WHERE id = 'codex'
    `).run(
      input.enabled === undefined ? Number(current.enabled) : Number(Boolean(input.enabled)),
      input.preferredBackend || current.preferredBackend,
      input.model === undefined ? current.model : String(input.model || '').trim(),
      input.reasoningEffort ?? current.reasoningEffort,
      input.fastMode === undefined ? Number(current.fastMode) : Number(Boolean(input.fastMode)),
      input.authMethod || current.authMethod,
      updatedAt,
    )
    return getProviderSettings()
  }

  function createRun(input = {}) {
    const project = database.prepare('SELECT id, archived_at FROM projects WHERE id = ?').get(input.projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能启动创作助手')
    if (input.chapterId) {
      const chapter = database.prepare('SELECT id FROM chapters WHERE id = ? AND project_id = ?').get(input.chapterId, input.projectId)
      if (!chapter) throw new Error('章节不存在或不属于当前项目')
    }
    const binding = database.prepare(`
      SELECT b.pack_id, b.pack_version, v.digest, v.content_json
      FROM project_pack_bindings b
      JOIN creative_pack_versions v ON v.pack_id = b.pack_id AND v.version = b.pack_version
      WHERE b.project_id = ?
    `).get(input.projectId)
    if (!binding) throw new Error('项目尚未绑定 Creative Pack')
    const pack = parseJson(binding.content_json)
    const workflow = (pack.workflows || []).find((item) => item.id === input.workflowId)
    if (!workflow) throw new Error('Creative Pack 中不存在所选工作流')
    const id = createId('agent-run')
    const createdAt = now()
    const executionMode = input.executionMode === 'codex' ? 'codex' : 'app_model'
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO agent_runs (
          id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version,
          creative_pack_digest, model_routes_json, execution_mode, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, input.projectId, input.chapterId || null, workflow.id, binding.pack_id,
        binding.pack_version, binding.digest, JSON.stringify(input.modelRoutes || {}), executionMode,
        createdAt, createdAt)
      const insertStep = database.prepare(`
        INSERT INTO agent_steps (
          id, run_id, step_key, position, action, task, candidate_type, status,
          depends_on_json, input_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, '{}', ?, ?)
      `)
      workflow.steps.forEach((step, index) => insertStep.run(
        createId('agent-step'), id, step.id, index + 1, step.action, step.task || '',
        step.candidateType || '', JSON.stringify(step.dependsOn || []), createdAt, createdAt,
      ))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    freezeRun(id)
    return getRun(id)
  }

  function assertInlineTargetOwnership(projectId, target) {
    const owned = (table, id, projectColumn = 'project_id') => Boolean(id && database.prepare(`SELECT id FROM ${table} WHERE id = ? AND ${projectColumn} = ?`).get(id, projectId))
    if (['planning_document', 'planning_document_bundle'].includes(target.kind)) {
      const row = database.prepare('SELECT kind FROM planning_documents WHERE project_id = ? AND kind = ?').get(projectId, target.targetId)
      if (!row) throw new Error('规划文档不属于当前项目')
      return
    }
    if (['planning_entity', 'planning_entity_bundle'].includes(target.kind) && !owned('planning_entities', target.targetId)) throw new Error('规划对象不属于当前项目')
    if (['chapter_field', 'planning_chapter_bundle', 'chapter_card', 'scene_plan', 'manuscript', 'manuscript_selection', 'chapter_state', 'continuity_audit', 'quality_review'].includes(target.kind)
      && !owned('chapters', target.targetId)) throw new Error('章节不属于当前项目')
    if (target.kind === 'relationship_draft' && target.targetId && !owned('character_relationships', target.targetId)) throw new Error('人物关系不属于当前项目')
    if (target.kind === 'story_arc_draft' && target.targetId && !owned('story_arcs', target.targetId)) throw new Error('情节线不属于当前项目')
    if (target.kind === 'story_arc_beat_draft' && target.targetId) {
      const row = database.prepare('SELECT beat.id FROM story_arc_beats beat JOIN story_arcs arc ON arc.id = beat.arc_id WHERE beat.id = ? AND arc.project_id = ?').get(target.targetId, projectId)
      if (!row) throw new Error('情节节点不属于当前项目')
    }
    if (target.kind === 'knowledge_item_draft' && target.targetId && !owned('knowledge_items', target.targetId)) throw new Error('知识条目不属于当前项目')
    if (target.kind === 'story_change_set' && target.targetId) {
      const row = database.prepare('SELECT id FROM story_change_sets WHERE id = ? AND project_id = ?').get(target.targetId, projectId)
      if (!row) throw new Error('设定变更集不属于当前项目')
    }
    if (target.kind === 'project_brief_draft' && target.targetId && target.targetId !== projectId) throw new Error('项目草稿目标不属于当前项目')
    if (target.kind === 'style_profile_draft') {
      if (target.scopeType === 'project' && target.scopeId !== projectId) throw new Error('文风范围不属于当前项目')
      if (target.scopeType === 'volume' && !owned('planning_entities', target.scopeId)) throw new Error('分卷文风不属于当前项目')
      if (target.scopeType === 'chapter' && !owned('chapters', target.scopeId)) throw new Error('章节文风不属于当前项目')
    }
    if (target.sourceGenerationId) {
      const source = database.prepare('SELECT project_id, chapter_id FROM generation_records WHERE id = ?').get(target.sourceGenerationId)
      if (!source || source.project_id !== projectId) throw new Error('来源生成记录不属于当前项目')
      if (target.targetId && source.chapter_id && source.chapter_id !== target.targetId) throw new Error('来源生成记录不属于当前章节')
    }
    if (target.reportId && !owned('quality_reports', target.reportId)) throw new Error('质量报告不属于当前项目')
  }

  function createInlineRun(input = {}) {
    let action = normalizeInlineCreativeAction(input)
    const project = database.prepare('SELECT id, archived_at FROM projects WHERE id = ?').get(input.projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能启动 AI 任务')
    assertInlineTargetOwnership(input.projectId, action.target)
    const activeRows = database.prepare(`
      SELECT run.id, run.execution_mode, run.status, step.input_json FROM agent_runs run
      JOIN agent_steps step ON step.run_id = run.id AND step.position = 1
      WHERE run.project_id = ? AND run.workflow_id = 'inline-action'
        AND run.status IN ('pending', 'waiting_approval', 'running', 'waiting_confirmation', 'paused', 'completed')
      ORDER BY run.updated_at DESC, run.rowid DESC
    `).all(input.projectId)
    if (action.target.kind === 'planning_document_bundle') {
      const document = database.prepare('SELECT * FROM planning_documents WHERE project_id = ? AND kind = ?').get(input.projectId, action.target.targetId)
      const target = buildPlanningDocumentBundleTarget(document, action.target)
      action = { ...action, target, targetKey: inlineTargetKey(target) }
    }
    if (action.target.kind === 'planning_entity_bundle') {
      const entity = database.prepare('SELECT * FROM planning_entities WHERE id = ? AND project_id = ?').get(action.target.targetId, input.projectId)
      const target = buildPlanningEntityBundleTarget(entity, action.target)
      action = { ...action, target, targetKey: inlineTargetKey(target) }
    }
    if (action.target.kind === 'planning_chapter_bundle') {
      const chapter = database.prepare('SELECT * FROM chapters WHERE id = ? AND project_id = ?').get(action.target.targetId, input.projectId)
      const target = buildPlanningChapterBundleTarget(chapter, action.target)
      action = { ...action, target, targetKey: inlineTargetKey(target) }
    }
    const binding = database.prepare(`
      SELECT b.pack_id, b.pack_version, v.digest, v.content_json
      FROM project_pack_bindings b
      JOIN creative_pack_versions v ON v.pack_id = b.pack_id AND v.version = b.pack_version
      WHERE b.project_id = ?
    `).get(input.projectId)
    if (!binding) throw new Error('项目尚未绑定 Creative Pack')
    const pack = parseJson(binding.content_json)
    if (!pack.manifest?.tasks?.includes(action.task)) throw new Error(`Creative Pack 未声明任务 ${action.task}`)

    const exactExisting = input.freshStart ? null : activeRows.find((row) => {
      const prior = parseJson(row.input_json)
      return prior.targetKey === action.targetKey
        && (row.execution_mode === action.requestedExecutionMode || row.status !== 'completed')
    })
    if (exactExisting) {
      const previous = getRun(exactExisting.id)
      const withinScopeLimit = previous.steps.length < Number(action.conversationScope.maxSteps || INLINE_CONVERSATION_STEP_LIMIT)
      if (exactExisting.status !== 'completed'
        || (action.conversationScope.reusable && withinScopeLimit && requestedRoutesMatch(previous.modelRoutes, input.modelRoutes))) {
        return { ...previous, focusedExisting: true }
      }
    }

    const existing = input.freshStart || !action.conversationScope.reusable ? null : activeRows.find((row) => {
      if (row.execution_mode !== action.requestedExecutionMode) return false
      const prior = parseJson(row.input_json)
      if (!prior.conversationScope?.reusable || prior.conversationScope.key !== action.conversationScope.key) return false
      const previous = getRun(row.id)
      const maxSteps = Math.min(
        Number(action.conversationScope.maxSteps || INLINE_CONVERSATION_STEP_LIMIT),
        Number(prior.conversationScope.maxSteps || INLINE_CONVERSATION_STEP_LIMIT),
      )
      return previous.steps.length < maxSteps
        && !previous.steps.some((step) => ACTIVE_INLINE_STEP_STATUSES.has(step.status))
        && !previous.candidates.some((candidate) => candidate.status === 'pending')
        && requestedRoutesMatch(previous.modelRoutes, input.modelRoutes)
    })

    if (existing) {
      const previous = getRun(existing.id)
      if (!getRunPack(previous.id)?.manifest?.tasks?.includes(action.task)) throw new Error('此会话锁定的旧能力包未声明本任务，请完全重新开始')
      const stepId = createId('agent-step'), position = Math.max(...previous.steps.map(step => step.position)) + 1, stamp = now()
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare(`INSERT INTO agent_steps (id, run_id, step_key, position, action, task, candidate_type, status, depends_on_json, input_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'generate', ?, ?, 'pending', '[]', ?, ?, ?)`).run(stepId, previous.id, `inline-target-${position}`, position, action.task, action.candidateType, JSON.stringify(action), stamp, stamp)
        database.prepare("UPDATE agent_runs SET status='pending', current_step_id=?, connection_released_at='', completed_at='', error='', updated_at=? WHERE id=?").run(stepId, stamp, previous.id)
        database.exec('COMMIT')
      } catch (error) { database.exec('ROLLBACK'); throw error }
      return getRun(previous.id)
    }

    const id = createId('agent-run')
    const stepId = createId('agent-step')
    const createdAt = now()
    const chapterTargetKinds = new Set(['chapter_field', 'planning_chapter_bundle', 'chapter_card', 'scene_plan', 'manuscript', 'manuscript_selection', 'chapter_state', 'continuity_audit', 'quality_review'])
    const chapterId = input.chapterId || (chapterTargetKinds.has(action.target.kind) ? action.target.targetId : '')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO agent_runs (
          id, project_id, chapter_id, workflow_id, creative_pack_id, creative_pack_version,
          creative_pack_digest, model_routes_json, execution_mode, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'inline-action', ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, input.projectId, chapterId || null, binding.pack_id,
        binding.pack_version, binding.digest, JSON.stringify(input.modelRoutes || {}), action.requestedExecutionMode, createdAt, createdAt)
      database.prepare(`
        INSERT INTO agent_steps (
          id, run_id, step_key, position, action, task, candidate_type, status,
          depends_on_json, input_json, created_at, updated_at
        ) VALUES (?, ?, 'inline-action', 1, 'generate', ?, ?, 'pending', '[]', ?, ?, ?)
      `).run(stepId, id, action.task, action.candidateType, JSON.stringify(action), createdAt, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    freezeRun(id)
    return getRun(id)
  }

  function appendInlineRevision(input = {}) {
    const run = getRun(input.runId)
    if (!run || run.workflowId !== 'inline-action') throw new Error('就地 Codex 对话不存在')
    if (run.executionMode !== 'codex') throw new Error('当前就地任务不是 Codex 会话')
    if (run.status === 'cancelled') throw new Error('已取消的 Codex 对话不能继续修改')
    const instruction = String(input.instruction || '').trim().slice(0, 20000)
    if (!instruction) throw new Error('请先说明希望 Codex 怎样修改')
    const activeStep = run.steps.find((step) => ['pending', 'waiting_approval', 'running', 'interrupted'].includes(step.status))
    if (activeStep) throw new Error('Codex 正在处理当前修改，请等待完成后再继续')

    const selectableCandidates = run.candidates.filter((candidate) => !['cancelled'].includes(candidate.status))
    const parentCandidate = input.parentCandidateId
      ? selectableCandidates.find((candidate) => candidate.id === input.parentCandidateId)
      : selectableCandidates.at(-1)
    if (!parentCandidate) throw new Error('当前对话还没有可修改的候选内容')
    const parentStep = run.steps.find((step) => step.id === parentCandidate.stepId)
    if (!parentStep) throw new Error('候选来源步骤不存在')
    if (input.mode !== 'discuss' && parentCandidate.artifactType === 'manuscript' && parentCandidate.status === 'accepted') {
      const manuscript = database.prepare('SELECT manuscript FROM chapters WHERE id=?').get(run.chapterId)?.manuscript || ''
      if (manuscript !== parentCandidate.payload.manuscript) throw new Error('正式正文已在别处修改。旧版仅供比较；请基于当前编辑稿重新开始修改。')
    }

    const position = Math.max(0, ...run.steps.map((step) => Number(step.position || 0))) + 1
    const stepId = createId('agent-step')
    const createdAt = now()
    const target = { ...(parentStep.input?.target || {}) }
    const currentDraftDigest = String(input.currentDraftDigest || '').trim().slice(0, 160)
    const hasCurrentDraftValue = Object.hasOwn(input, 'currentDraftValue') && input.currentDraftValue !== undefined
    const currentDraftValue = String(input.currentDraftValue || '').slice(0, 100000)
    if (currentDraftDigest) target.draftDigest = currentDraftDigest
    if (hasCurrentDraftValue) {
      target.draftValue = currentDraftValue
      if (target.kind === 'project_brief_draft') {
        target.draftContext = { ...(target.draftContext || {}), [target.fieldKey]: currentDraftValue }
      }
    }
    const stepInput = {
      ...parentStep.input,
      target,
      instruction,
      conversationMode: input.mode === 'discuss' ? 'discuss' : 'modify',
      modificationScope: ['selection', 'scene', 'whole'].includes(input.scope?.kind) ? input.scope : { kind: 'related' },
      patchSource: parentCandidate.artifactType === 'manuscript' ? {
        digest: contentDigest(parentCandidate.payload.manuscript || ''),
        text: String(parentCandidate.payload.manuscript || ''),
        protections: database.prepare('SELECT * FROM manuscript_protections WHERE chapter_id = ? AND source_digest = ? AND active = 1')
          .all(run.chapterId, contentDigest(parentCandidate.payload.manuscript || '')),
      } : null,
      revision: {
        round: position,
        instruction,
        parentCandidateId: parentCandidate.id,
        parentCandidateStatus: parentCandidate.status,
      },
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      if (stepInput.conversationMode !== 'discuss') database.prepare(`
        UPDATE agent_candidates SET status = 'stale', override_reason = ?, resolved_at = ?
        WHERE run_id = ? AND status = 'pending'
      `).run('已有更新的 Codex 修改稿', createdAt, run.id)
      database.prepare(`
        UPDATE agent_steps SET status = 'stale', error = ?, completed_at = ?, updated_at = ?
        WHERE run_id = ? AND status = 'completed' AND id IN (
          SELECT step_id FROM agent_candidates WHERE run_id = ? AND status = 'stale'
        )
      `).run('已有更新的 Codex 修改稿', createdAt, createdAt, run.id, run.id)
      database.prepare(`
        INSERT INTO agent_steps (
          id, run_id, step_key, position, action, task, candidate_type, status,
          depends_on_json, input_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'generate', ?, ?, 'pending', '[]', ?, ?, ?)
      `).run(stepId, run.id, `inline-revision-${position}`, position, parentStep.task,
        parentStep.candidateType, JSON.stringify(stepInput), createdAt, createdAt)
      database.prepare(`INSERT INTO creative_messages (id, project_id, run_id, step_id, role, mode, content, source_digest, created_at)
        VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?)`).run(createId('creative-message'), run.projectId, run.id, stepId,
          stepInput.conversationMode, instruction, stepInput.patchSource?.digest || '', createdAt)
      database.prepare(`
        UPDATE agent_runs SET status = 'pending', current_step_id = ?, error = '',
          completed_at = '', updated_at = ? WHERE id = ?
      `).run(stepId, createdAt, run.id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getRun(run.id)
  }

  function listRuns({ projectId = '', limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(200, Number(limit || 50)))
    const rows = projectId
      ? database.prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(projectId, bounded)
      : database.prepare('SELECT * FROM agent_runs ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(bounded)
    return rows.map(mapRun)
  }

  function getRun(id, { includeEvents = true } = {}) {
    const run = mapRun(runById.get(id))
    if (!run) return null
    const steps = database.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position').all(id).map(mapStep)
    const stepByCandidateStepId = new Map(steps.map((step) => [step.id, step]))
    const candidates = database.prepare('SELECT * FROM agent_candidates WHERE run_id = ? ORDER BY created_at, rowid').all(id).map(mapCandidate)
      .map((candidate) => {
        if (candidate.artifactType !== 'planning_field') return candidate
        const fieldLabel = stepByCandidateStepId.get(candidate.stepId)?.input?.target?.fieldLabel || ''
        return {
          ...candidate,
          payload: {
            ...(candidate.payload || {}),
            text: cleanPlanningFieldText(candidate.payload?.text, { fieldLabel }),
          },
        }
      })
    return {
      ...run,
      steps,
      candidates,
      session: mapSession(database.prepare('SELECT * FROM agent_sessions WHERE agent_run_id = ?').get(id)),
      approvals: database.prepare('SELECT * FROM bridge_action_requests WHERE agent_run_id = ? ORDER BY created_at DESC, rowid DESC').all(id).map(mapApproval),
      events: includeEvents ? listEvents(id) : [],
      messages: database.prepare('SELECT * FROM creative_messages WHERE run_id = ? ORDER BY created_at, rowid').all(id),
    }
  }

  function getRunPack(id) {
    const row = database.prepare(`
      SELECT version.content_json FROM agent_runs run
      JOIN creative_pack_versions version
        ON version.pack_id = run.creative_pack_id AND version.version = run.creative_pack_version
      WHERE run.id = ?
    `).get(id)
    return row ? parseJson(row.content_json) : null
  }

  function freezeRun(id) {
    const run = getRun(id)
    const pack = getRunPack(id)
    const prompts = createPromptRepository(database)
    const contexts = Object.fromEntries((pack?.manifest?.tasks || []).map(task => [task,
      prompts.resolvePromptContext({ projectId: run.projectId, chapterId: run.chapterId, task })]))
    database.prepare('UPDATE agent_runs SET frozen_context_json = ? WHERE id = ?')
      .run(JSON.stringify({ schemaVersion: 7, compilerVersion: 'creative-compiler-7', prompts: contexts }), id)
  }

  function updateRun(id, patch = {}) {
    const current = runById.get(id)
    if (!current) throw new Error('AgentRun 不存在')
    if (patch.modelRoutes) database.prepare('UPDATE agent_runs SET model_routes_json = ? WHERE id = ?').run(JSON.stringify(patch.modelRoutes), id)
    if (patch.connectionReleasedAt !== undefined) database.prepare('UPDATE agent_runs SET connection_released_at = ? WHERE id = ?').run(String(patch.connectionReleasedAt), id)
    const values = {
      executionMode: patch.executionMode ?? current.execution_mode,
      actualBackend: patch.actualBackend ?? current.actual_backend,
      fallbackReason: patch.fallbackReason ?? current.fallback_reason,
      sessionRecreated: patch.sessionRecreated === undefined ? current.session_recreated : Number(Boolean(patch.sessionRecreated)),
      status: patch.status ?? current.status,
      currentStepId: patch.currentStepId ?? current.current_step_id,
      error: patch.error ?? current.error,
      completedAt: patch.completedAt === undefined ? current.completed_at : String(patch.completedAt || ''),
    }
    database.prepare(`
      UPDATE agent_runs SET execution_mode = ?, actual_backend = ?, fallback_reason = ?,
        session_recreated = ?, status = ?, current_step_id = ?, error = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(values.executionMode, values.actualBackend, values.fallbackReason, values.sessionRecreated,
      values.status, values.currentStepId, values.error, values.completedAt, now(), id)
    return getRun(id)
  }

  function updateStep(id, patch = {}) {
    const current = stepById.get(id)
    if (!current) throw new Error('AgentStep 不存在')
    const updatedAt = now()
    database.prepare(`
      UPDATE agent_steps SET status = ?, attempt_count = ?, input_json = ?, output_json = ?,
        generation_record_id = ?, quality_report_id = ?, approval_id = ?, output_started = ?,
        interrupted_at = ?, execution_backend = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status,
      patch.attemptCount ?? current.attempt_count,
      patch.input === undefined ? current.input_json : JSON.stringify(patch.input || {}),
      patch.output === undefined ? current.output_json : JSON.stringify(patch.output || {}),
      patch.generationRecordId === undefined ? current.generation_record_id : patch.generationRecordId || null,
      patch.qualityReportId === undefined ? current.quality_report_id : patch.qualityReportId || null,
      patch.approvalId ?? current.approval_id,
      patch.outputStarted === undefined ? current.output_started : Number(Boolean(patch.outputStarted)),
      patch.interruptedAt ?? current.interrupted_at,
      patch.executionBackend ?? current.execution_backend,
      patch.error ?? current.error,
      patch.startedAt ?? current.started_at,
      patch.completedAt ?? current.completed_at,
      updatedAt,
      id,
    )
    return mapStep(stepById.get(id))
  }

  function createCandidate(input = {}) {
    const step = stepById.get(input.stepId)
    const run = runById.get(input.runId)
    if (!step || !run || step.run_id !== run.id) throw new Error('候选与 Agent 步骤不匹配')
    if (run.project_id !== input.projectId) throw new Error('候选与 AgentRun 不属于同一项目')
    const id = createId('agent-candidate')
    const stepInput = parseJson(step.input_json)
    const manuscript = input.payload?.manuscript
    const protections = stepInput.patchSource?.protections || []
    if (typeof manuscript === 'string' && protections.length) {
      let offset = 0
      for (const protection of protections.slice().sort((a, b) => a.start_offset - b.start_offset)) {
        const start = manuscript.indexOf(protection.text, offset)
        if (start < 0) throw new Error('新稿改变了保留段落，请先取消保护或缩小修改范围')
        offset = start + protection.text.length
        const newDigest = contentDigest(manuscript)
        if (!database.prepare('SELECT id FROM manuscript_protections WHERE chapter_id=? AND source_digest=? AND start_offset=? AND active=1').get(run.chapter_id, newDigest, start)) {
          database.prepare(`INSERT INTO manuscript_protections (id,project_id,chapter_id,source_digest,start_offset,end_offset,text,created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run(createId('protection'), run.project_id, run.chapter_id, newDigest, start, offset, protection.text, now())
        }
      }
    }
    database.prepare(`
      INSERT INTO agent_candidates (
        id, run_id, step_id, project_id, chapter_id, artifact_type, status,
        source_digest, payload_json, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, run.id, step.id, run.project_id, input.chapterId || run.chapter_id || null,
      input.artifactType || step.candidate_type || 'artifact', input.sourceDigest,
      stringifyRedacted(input.payload), stringifyRedacted(input.evidence), now())
    if (Array.isArray(input.payload?.patches)) database.prepare(`INSERT INTO creative_patches
      (id, project_id, run_id, candidate_id, source_digest, scope_json, patches_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(createId('patch'), run.project_id, run.id, id,
        input.payload.sourceDigest, JSON.stringify(parseJson(step.input_json, {}).modificationScope || {}), JSON.stringify(input.payload.patches), now())
    return mapCandidate(candidateById.get(id))
  }

  function saveDiscussion({ runId, stepId, text }) {
    const run = runById.get(runId)
    const step = stepById.get(stepId)
    if (!run || step?.run_id !== runId) throw new Error('讨论来源不匹配')
    database.prepare(`INSERT INTO creative_messages (id, project_id, run_id, step_id, role, mode, content, created_at)
      VALUES (?, ?, ?, ?, 'assistant', 'discuss', ?, ?)`).run(createId('message'), run.project_id, runId, stepId, String(text), now())
  }

  function resolveCandidate(input = {}) {
    const candidate = candidateById.get(input.id)
    if (!candidate) throw new Error('候选不存在')
    const canResolve = input.accept
      ? candidate.status === 'pending'
      : ['pending', 'stale'].includes(candidate.status)
    if (!canResolve) throw new Error('候选已经处理')
    const status = input.accept ? 'accepted' : 'rejected'
    const resolvedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('UPDATE agent_candidates SET status = ?, override_reason = ?, payload_json = ?, evidence_json = ?, resolved_at = ? WHERE id = ?')
        .run(
          status,
          String(input.reason || ''),
          input.payload === undefined ? candidate.payload_json : stringifyRedacted(input.payload),
          input.evidence === undefined ? candidate.evidence_json : stringifyRedacted(input.evidence),
          resolvedAt,
          candidate.id,
        )
      database.prepare('UPDATE agent_steps SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
        .run(input.accept ? 'confirmed' : 'rejected', resolvedAt, resolvedAt, candidate.step_id)
      if (!input.accept) {
        database.prepare(`
          UPDATE agent_candidates SET status = 'stale', resolved_at = ?
          WHERE run_id = ? AND status = 'pending' AND step_id IN (
            SELECT id FROM agent_steps WHERE run_id = ? AND position > (SELECT position FROM agent_steps WHERE id = ?)
          )
        `).run(resolvedAt, candidate.run_id, candidate.run_id, candidate.step_id)
        database.prepare(`
          UPDATE agent_steps SET status = 'stale', updated_at = ?
          WHERE run_id = ? AND position > (SELECT position FROM agent_steps WHERE id = ?)
            AND status IN ('waiting_confirmation', 'completed')
        `).run(resolvedAt, candidate.run_id, candidate.step_id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapCandidate(candidateById.get(candidate.id))
  }

  function updateResolvedCandidate(input = {}) {
    const candidate = candidateById.get(input.id)
    if (!candidate) throw new Error('候选不存在')
    if (candidate.status !== 'accepted') throw new Error('只有已接受候选可以保存作者修改')
    database.prepare(`
      UPDATE agent_candidates
      SET payload_json = ?, evidence_json = ?, override_reason = ?, resolved_at = ?
      WHERE id = ?
    `).run(
      stringifyRedacted(input.payload),
      stringifyRedacted(input.evidence),
      String(input.reason || candidate.override_reason || ''),
      now(),
      candidate.id,
    )
    return mapCandidate(candidateById.get(candidate.id))
  }

  function markCandidateStale(id, reason = '候选来源已经变化') {
    const candidate = candidateById.get(id)
    if (!candidate) throw new Error('候选不存在')
    if (candidate.status !== 'pending') return mapCandidate(candidate)
    const resolvedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("UPDATE agent_candidates SET status = 'stale', override_reason = ?, resolved_at = ? WHERE id = ?")
        .run(String(reason || ''), resolvedAt, id)
      database.prepare("UPDATE agent_steps SET status = 'stale', error = ?, completed_at = ?, updated_at = ? WHERE id = ?")
        .run(String(reason || ''), resolvedAt, resolvedAt, candidate.step_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapCandidate(candidateById.get(id))
  }

  function cancelPendingCandidates(agentRunId) {
    const resolvedAt = now()
    database.prepare(`
      UPDATE agent_candidates SET status = 'cancelled', resolved_at = ?
      WHERE run_id = ? AND status = 'pending'
    `).run(resolvedAt, agentRunId)
    return database.prepare('SELECT * FROM agent_candidates WHERE run_id = ? ORDER BY created_at, rowid').all(agentRunId).map(mapCandidate)
  }

  function upsertSession(input = {}) {
    const run = runById.get(input.agentRunId)
    if (!run) throw new Error('AgentRun 不存在')
    const current = database.prepare('SELECT * FROM agent_sessions WHERE agent_run_id = ?').get(run.id)
    const createdAt = current?.created_at || now()
    const id = current?.id || createId('agent-session')
    database.prepare(`
      INSERT INTO agent_sessions (
        id, agent_run_id, backend, session_id, status, protocol_version, adapter_version,
        capabilities_json, auth_method, recovery_strategy, created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_run_id) DO UPDATE SET backend = excluded.backend,
        session_id = excluded.session_id, status = excluded.status,
        protocol_version = excluded.protocol_version, adapter_version = excluded.adapter_version,
        capabilities_json = excluded.capabilities_json, auth_method = excluded.auth_method,
        recovery_strategy = excluded.recovery_strategy, updated_at = excluded.updated_at,
        closed_at = excluded.closed_at
    `).run(id, run.id, input.backend || current?.backend || 'codex_acp', input.sessionId ?? current?.session_id ?? '',
      input.status || current?.status || 'initializing', input.protocolVersion ?? current?.protocol_version ?? '',
      input.adapterVersion ?? current?.adapter_version ?? '',
      input.capabilities === undefined ? current?.capabilities_json || '{}' : stringifyRedacted(input.capabilities),
      input.authMethod ?? current?.auth_method ?? '', input.recoveryStrategy ?? current?.recovery_strategy ?? '',
      createdAt, now(), input.closedAt ?? current?.closed_at ?? '')
    return mapSession(database.prepare('SELECT * FROM agent_sessions WHERE agent_run_id = ?').get(run.id))
  }

  function appendEvent(input = {}) {
    if (!runById.get(input.agentRunId)) throw new Error('AgentRun 不存在')
    const redacted = redact(input.payload || {})
    let payloadJson = JSON.stringify(redacted)
    const originalSize = Buffer.byteLength(payloadJson)
    const toolLimited = ['tool_result', 'tool_call'].includes(input.type) && originalSize > EVENT_TOOL_OUTPUT_LIMIT
    if (toolLimited) {
      payloadJson = JSON.stringify({
        truncated: true,
        originalBytes: originalSize,
        sha256: createHash('sha256').update(payloadJson).digest('hex'),
        preview: payloadJson.slice(0, EVENT_TOOL_OUTPUT_LIMIT),
      })
    }
    const used = Number(database.prepare('SELECT COALESCE(SUM(byte_size), 0) AS size FROM agent_events WHERE agent_run_id = ?').get(input.agentRunId).size)
    let storedSize = Buffer.byteLength(payloadJson)
    if (used + storedSize > RUN_EVENT_LIMIT) {
      payloadJson = JSON.stringify({
        truncated: true,
        reason: 'agent_run_event_limit',
        originalBytes: originalSize,
        sha256: createHash('sha256').update(JSON.stringify(redacted)).digest('hex'),
      })
      storedSize = 0
    }
    const sequence = Number(database.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_events WHERE agent_run_id = ?').get(input.agentRunId).sequence)
    const id = createId('agent-event')
    database.prepare(`
      INSERT INTO agent_events (
        id, agent_run_id, agent_step_id, sequence, event_type, summary, payload_json, byte_size, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.agentRunId, input.agentStepId || null, sequence, input.type || 'status',
      String(input.summary || '').slice(0, 2000), payloadJson, storedSize, now())
    return mapEvent(database.prepare('SELECT * FROM agent_events WHERE id = ?').get(id))
  }

  function listEvents(agentRunId, { after = 0, limit = 1000 } = {}) {
    return database.prepare(`
      SELECT * FROM agent_events WHERE agent_run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(agentRunId, Number(after || 0), Math.max(1, Math.min(5000, Number(limit || 1000)))).map(mapEvent)
  }

  function createApproval(input = {}) {
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId)
    if (!project) throw new Error('项目不存在')
    const id = createId('approval')
    const createdAt = now()
    const expiresAt = input.expiresAt || new Date(Date.parse(createdAt) + 5 * 60 * 1000).toISOString()
    database.prepare(`
      INSERT INTO bridge_action_requests (
        id, session_id, project_id, origin, agent_run_id, agent_step_id,
        external_request_id, action_type, status, permission, payload_json,
        result_json, error, created_at, resolved_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, '{}', '', ?, '', ?)
    `).run(id, input.sessionId || '', input.projectId, input.origin || 'codex_acp',
      input.agentRunId || null, input.agentStepId || null, input.externalRequestId || '',
      input.actionType, String(input.permission || ''), stringifyRedacted(input.payload), createdAt, expiresAt)
    return mapApproval(approvalById.get(id))
  }

  function expireApprovals({ id = '', projectId = '', agentRunId = '' } = {}) {
    const resolvedAt = now()
    const clauses = [], values = []
    for (const [column,value] of [['id',id],['project_id',projectId],['agent_run_id',agentRunId]]) {
      if (value) { clauses.push(`${column} = ?`); values.push(value) }
    }
    database.prepare(`
      UPDATE bridge_action_requests SET status = 'expired', resolved_at = ?
      WHERE status = 'pending' AND expires_at <= ? ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
    `).run(resolvedAt, resolvedAt, ...values)
  }

  function listApprovals({ projectId = '', agentRunId = '', status = '', limit = 100, readOnly = false } = {}) {
    if (!readOnly) expireApprovals({projectId,agentRunId})
    const clauses = []
    const values = []
    if (projectId) { clauses.push('project_id = ?'); values.push(projectId) }
    if (agentRunId) { clauses.push('agent_run_id = ?'); values.push(agentRunId) }
    if (status) {
      clauses.push(readOnly ? "(CASE WHEN status='pending' AND expires_at <= ? THEN 'expired' ELSE status END) = ?" : 'status = ?')
      if (readOnly) values.push(now())
      values.push(status)
    }
    values.push(Math.max(1, Math.min(500, Number(limit || 100))))
    return database.prepare(`
      SELECT * FROM bridge_action_requests ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(...values).map(row=>mapApproval(readOnly && row.status==='pending' && row.expires_at<=now() ? {...row,status:'expired'} : row))
  }

  function getApproval(id) {
    expireApprovals({id})
    return mapApproval(approvalById.get(id))
  }

  function resolveApproval(input = {}) {
    expireApprovals({id:input.id})
    const current = approvalById.get(input.id)
    if (!current) throw new Error('审批请求不存在')
    if (current.status !== 'pending') throw new Error(`审批请求已经是 ${current.status}`)
    const status = input.approved ? 'approved' : 'rejected'
    database.prepare(`
      UPDATE bridge_action_requests SET status = ?, result_json = ?, error = ?, resolved_at = ? WHERE id = ?
    `).run(status, stringifyRedacted({ note: input.note || '' }), input.approved ? '' : String(input.reason || ''), now(), current.id)
    return mapApproval(approvalById.get(current.id))
  }

  function completeApproval(id, { result = {}, error = '' } = {}) {
    const current = approvalById.get(id)
    if (!current) return null
    database.prepare(`
      UPDATE bridge_action_requests SET status = ?, result_json = ?, error = ?, resolved_at = ? WHERE id = ?
    `).run(error ? 'failed' : 'completed', stringifyRedacted(result), String(error || ''), now(), id)
    return mapApproval(approvalById.get(id))
  }

  function expireAllPendingApprovals() {
    database.prepare(`
      UPDATE bridge_action_requests SET status = 'expired', resolved_at = ? WHERE status = 'pending'
    `).run(now())
  }

  return {
    getProviderSettings,
    updateProviderSettings,
    createRun,
    createInlineRun,
    appendInlineRevision,
    listRuns,
    getRun,
    getRunPack,
    updateRun,
    updateStep,
    createCandidate,
    saveDiscussion,
    resolveCandidate,
    updateResolvedCandidate,
    markCandidateStale,
    cancelPendingCandidates,
    upsertSession,
    appendEvent,
    listEvents,
    createApproval,
    listApprovals,
    getApproval,
    resolveApproval,
    completeApproval,
    expireAllPendingApprovals,
  }
}

export { EVENT_TOOL_OUTPUT_LIMIT, RUN_EVENT_LIMIT, redact as redactCodexEvent }
