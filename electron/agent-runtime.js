import { validateChapterCard, validateScenePlan } from './creative-quality.js'
import { CodexCancelledError } from './codex-agent-gateway.js'
import { cleanPlanningFieldText } from './generated-text.js'
import { normalizePlanningChapterBundleCandidate, normalizePlanningDocumentBundleCandidate, normalizePlanningEntityBundleCandidate } from './planning-bundle.js'

function firstFailed(checks = []) {
  return checks.find((check) => check.critical && !check.passed) || checks.find((check) => !check.passed)
}

function normalizedTargetLength(value) {
  const target = Number(value)
  return Number.isFinite(target) && target > 0 ? Math.round(target) : 0
}

export function manuscriptCharacterCount(value = '') {
  return [...String(value)].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length
}

export function manuscriptLengthRange(targetLength) {
  const target = normalizedTargetLength(targetLength)
  return target ? {
    target,
    minimum: Math.floor(target * 0.9),
    maximum: Math.ceil(target * 1.2),
  } : null
}

function candidatePayload(task, result, { fieldLabel = '', candidateType = '', target = null } = {}) {
  if (candidateType === 'planning_document_bundle') return normalizePlanningDocumentBundleCandidate(result, target || {})
  if (candidateType === 'planning_entity_bundle') return normalizePlanningEntityBundleCandidate(result, target || {})
  if (candidateType === 'planning_chapter_bundle') return normalizePlanningChapterBundleCandidate(result, target || {})
  const structured = result?.structuredOutput
  if (task === 'chapter_card') return result?.card || structured?.card || structured
  if (task === 'scene_plan') return result?.scenePlan || structured?.scenePlan || structured
  if (task === 'chapter') return { manuscript: result?.manuscript || structured?.manuscript || result?.content || result?.text || '' }
  if (task === 'chapter_state_extract') return result?.stateSnapshot || structured?.stateSnapshot || structured
  if (task === 'quality_review') return result?.review || structured?.review || structured
  if (task === 'planning_field') {
    const payload = structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { ...structured }
      : { text: result?.text || result?.content || '' }
    return { ...payload, text: cleanPlanningFieldText(payload.text, { fieldLabel }) }
  }
  if (task === 'rewrite') return structured || { text: result?.text || result?.content || '' }
  if (task === 'continuity_audit') return result?.audit || structured?.audit || structured
  if (task === 'story_change') return result?.changeSet || structured?.changeSet || structured
  return structured || result
}

function foundationBundlePayload(result = {}) {
  if (result?.structuredOutput && typeof result.structuredOutput === 'object') return result.structuredOutput
  if (result?.foundation && result?.mainCharacter && result?.world && result?.outline) return result
  const text = String(result?.text || result?.content || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  try { return JSON.parse(fenced ? fenced[1].trim() : text) } catch {
    throw Object.assign(new Error('故事基础候选不是有效 JSON'), { name: 'StructuredOutputError' })
  }
}

function validateFoundationBundle(payload) {
  const required = [
    ['foundation', ['premise', 'storyPromise', 'coreConflict']],
    ['mainCharacter', ['title', 'role', 'identity', 'desire', 'need', 'fear']],
    ['world', ['hardRules', 'costs']],
    ['outline', ['logline', 'opening', 'incitingIncident', 'climax', 'ending']],
  ]
  for (const [section, fields] of required) {
    if (!payload?.[section] || typeof payload[section] !== 'object' || Array.isArray(payload[section])) {
      throw Object.assign(new Error(`故事基础候选缺少 ${section}`), { name: 'StructuredOutputError' })
    }
    const missing = fields.filter((field) => !String(payload[section][field] || '').trim())
    if (missing.length) throw Object.assign(new Error(`${section} 缺少字段：${missing.join('、')}`), { name: 'StructuredOutputError' })
  }
  return payload
}

function validateCandidate(task, payload, { targetLength = 0, candidateType = '' } = {}) {
  if (task === 'chapter_card') {
    const failure = firstFailed(validateChapterCard(payload || {}))
    if (failure) throw Object.assign(new Error(failure.detail || failure.label), { name: 'StructuredOutputError' })
  }
  if (task === 'scene_plan') {
    const failure = firstFailed(validateScenePlan(payload || {}))
    if (failure) throw Object.assign(new Error(failure.detail || failure.label), { name: 'StructuredOutputError' })
  }
  if (task === 'chapter' && !String(payload?.manuscript || '').trim()) {
    throw Object.assign(new Error('正文候选为空'), { name: 'StructuredOutputError' })
  }
  if (task === 'chapter') {
    const range = manuscriptLengthRange(targetLength)
    const count = manuscriptCharacterCount(payload?.manuscript)
    if (range && (count < range.minimum || count > range.maximum)) {
      throw Object.assign(new Error(`正文纯中文字符数为 ${count}，目标 ${range.target}，必须落在 ${range.minimum}–${range.maximum} 之间`), { name: 'StructuredOutputError' })
    }
  }
  if (['chapter_state_extract', 'quality_review'].includes(task) && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
    throw Object.assign(new Error('结构化候选不是 JSON 对象'), { name: 'StructuredOutputError' })
  }
  if (task === 'continuity_audit' && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
    throw Object.assign(new Error('连续性审计候选不是 JSON 对象'), { name: 'StructuredOutputError' })
  }
  if (task === 'story_change') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !String(payload.summary || '').trim() || !Array.isArray(payload.items) || !payload.items.length) {
      throw Object.assign(new Error('设定联动候选缺少 summary 或 items'), { name: 'StructuredOutputError' })
    }
    for (const item of payload.items) {
      if (!String(item?.targetKey || '').trim() || !Object.hasOwn(item || {}, 'after') || !['required', 'suggested', 'review'].includes(item?.impactLevel)) {
        throw Object.assign(new Error('设定联动候选项目缺少目标、修改后内容或影响级别'), { name: 'StructuredOutputError' })
      }
    }
  }
  if (['planning_field', 'rewrite'].includes(task) && !['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(candidateType) && !String(payload?.text || '').trim()) {
    throw Object.assign(new Error('文本候选为空'), { name: 'StructuredOutputError' })
  }
  return payload
}

export class AgentRuntime {
  constructor({
    repository,
    codexGateway,
    createMirror,
    refreshMirror,
    prepareCodexPrompt,
    completeCodexGeneration = async () => {},
    persistQualityReview = async () => '',
    runAppModel,
    runPreflight,
    applyCandidate,
    currentSourceDigest,
    onEvent = () => {},
    onCandidateCreated = async () => {},
  }) {
    this.repository = repository
    this.codexGateway = codexGateway
    this.createMirror = createMirror
    this.refreshMirror = refreshMirror || createMirror
    this.prepareCodexPrompt = prepareCodexPrompt
    this.completeCodexGeneration = completeCodexGeneration
    this.persistQualityReview = persistQualityReview
    this.runAppModel = runAppModel
    this.runPreflight = runPreflight
    this.applyCandidate = applyCandidate
    this.currentSourceDigest = currentSourceDigest
    this.onEvent = onEvent
    this.onCandidateCreated = onCandidateCreated
    this.active = new Map()
    this.controllers = new Map()
  }

  async start(input, eventContext = null) {
    const run = this.repository.createRun(input)
    return this._startRun(run, eventContext)
  }

  async startInline(input, eventContext = null) {
    const run = this.repository.createInlineRun(input)
    if (run.focusedExisting) return run
    return this._startRun(run, eventContext)
  }

  async continueInline(input, eventContext = null) {
    const run = this.repository.appendInlineRevision(input)
    const mirror = await this.refreshMirror(run)
    this._emit(run.id, 'inline_revision_started', {
      stepId: run.currentStepId,
      parentCandidateId: input.parentCandidateId || '',
      instruction: String(input.instruction || '').slice(0, 2000),
    })
    void this.advance(run.id, eventContext, mirror).catch((error) => this._failRun(run.id, error))
    return this.repository.getRun(run.id)
  }

  async _startRun(run, eventContext = null) {
    let mirror = null
    if (run.executionMode === 'codex') mirror = await this.createMirror(run)
    this._emit(run.id, 'run_started', { run, mirror: mirror ? { root: mirror.root, sourceDigest: mirror.sourceDigest } : null })
    void this.advance(run.id, eventContext, mirror).catch((error) => this._failRun(run.id, error))
    return this.repository.getRun(run.id)
  }

  async advance(runId, eventContext = null, knownMirror = null) {
    if (this.active.has(runId)) return this.active.get(runId)
    const operation = this._advance(runId, eventContext, knownMirror).finally(() => this.active.delete(runId))
    this.active.set(runId, operation)
    return operation
  }

  async _advance(runId, eventContext, knownMirror) {
    let run = this.repository.getRun(runId)
    if (!run) throw new Error('AgentRun 不存在')
    if (['cancelled', 'completed'].includes(run.status)) return run
    let mirror = knownMirror
    if (run.executionMode === 'codex' && !mirror) mirror = await this.refreshMirror(run)
    this.repository.updateRun(runId, { status: 'running', error: '' })
    while (true) {
      run = this.repository.getRun(runId)
      if (run.status === 'paused' || run.status === 'cancelled') return run
      const step = run.steps.find((item) => item.status === 'pending' && this._dependenciesReady(item, run.steps))
      if (!step) {
        const unresolved = run.steps.filter((item) => !['completed', 'confirmed', 'cancelled'].includes(item.status))
        if (!unresolved.length) {
          if (run.workflowId === 'inline-action') {
            return this.repository.updateRun(runId, { status: 'waiting_confirmation', currentStepId: run.steps.at(-1)?.id || '' })
          }
          await this.codexGateway?.closeSession?.(runId)
          const completed = this.repository.updateRun(runId, { status: 'completed', completedAt: new Date().toISOString(), currentStepId: '' })
          this._emit(runId, 'run_completed', { run: completed })
          return completed
        }
        return run
      }
      this.repository.updateRun(runId, { currentStepId: step.id })
      if (step.action === 'checkpoint') {
        this.repository.updateStep(step.id, { status: 'waiting_confirmation' })
        return this.repository.updateRun(runId, { status: 'waiting_confirmation', currentStepId: step.id })
      }
      if (step.action === 'preflight') {
        const report = await this.runPreflight({ run, step })
        if (report?.blocked) throw new Error(report.summary || '生成前准备度检查未通过')
        this.repository.updateStep(step.id, { status: 'completed', output: report || {}, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() })
        this._emit(runId, 'step_completed', { stepId: step.id, action: step.action, report })
        continue
      }
      if (['generate', 'state_extract'].includes(step.action)) {
        await this._executeCandidateStep({ run, step, mirror, eventContext })
        const latest = this.repository.getRun(runId)
        if (latest.status === 'paused' || latest.status === 'cancelled') return latest
        if (latest.workflowId === 'inline-action') {
          return this.repository.updateRun(runId, { status: 'waiting_confirmation', currentStepId: step.id })
        }
        const next = latest.steps.find((item) => item.position === step.position + 1)
        if (next?.action === 'checkpoint') {
          this.repository.updateStep(next.id, { status: 'waiting_confirmation' })
          return this.repository.updateRun(runId, { status: 'waiting_confirmation', currentStepId: next.id })
        }
        continue
      }
      if (step.action === 'quality_review') {
        await this._executeQualityStep({ run, step, mirror, eventContext })
        continue
      }
      throw new Error(`Agent 工作流动作尚未实现：${step.action}`)
    }
  }

  _dependenciesReady(step, steps) {
    return step.dependsOn.every((key) => {
      const dependency = steps.find((item) => item.key === key)
      return dependency && ['completed', 'confirmed'].includes(dependency.status)
    })
  }

  async _executeCandidateStep({ run, step, mirror, eventContext }) {
    const startedAt = new Date().toISOString()
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    try {
      const { result, payload } = await this._runStructuredTask({
        run, step, mirror, eventContext, signal: controller.signal, startedAt,
        validate: (execution) => step.candidateType === 'foundation_bundle'
          ? validateFoundationBundle(foundationBundlePayload(execution))
          : validateCandidate(step.task, candidatePayload(step.task, execution, {
              fieldLabel: step.input?.target?.fieldLabel || '',
              candidateType: step.candidateType,
              target: step.input?.target,
            }), {
              targetLength: run.modelRoutes?.targetLength,
              candidateType: step.candidateType,
            }),
      })
      const sourceDigest = mirror?.sourceDigest || await this.currentSourceDigest(run)
      const candidate = this.repository.createCandidate({
        runId: run.id,
        stepId: step.id,
        projectId: run.projectId,
        chapterId: run.chapterId,
        artifactType: step.candidateType || step.task,
        sourceDigest,
        payload,
        evidence: {
          executionBackend: result.backend || result.execution || 'app_model',
          sessionId: result.sessionId || '',
          fallbackReason: result.fallbackReason || '',
          generationRecordId: result.generationRecordId || '',
        },
      })
      await this.onCandidateCreated({ run, step, candidate, result })
      this.repository.updateStep(step.id, {
        status: 'completed',
        output: { candidateId: candidate.id },
        generationRecordId: result.generationRecordId || '',
        outputStarted: Boolean(result.outputStarted || result.content || result.manuscript || result.text),
        executionBackend: result.backend || result.execution || 'app_model',
        completedAt: new Date().toISOString(),
      })
      this.repository.updateRun(run.id, {
        actualBackend: result.backend || result.execution || 'app_model',
        fallbackReason: result.fallbackReason || '',
      })
      this._emit(run.id, 'candidate_created', { stepId: step.id, candidate })
    } catch (error) {
      if (error instanceof CodexCancelledError || controller.signal.aborted) {
        this.repository.updateStep(step.id, { status: 'interrupted', interruptedAt: new Date().toISOString(), error: error.message })
        this.repository.updateRun(run.id, { status: 'paused', error: error.message })
        return
      }
      this.repository.updateStep(step.id, {
        status: 'failed', error: error.message, outputStarted: Boolean(error.codexPartialResult?.outputStarted),
        output: error.codexPartialResult ? { partialEvidence: true, content: String(error.codexPartialResult.content || '').slice(0, 64 * 1024) } : {},
        completedAt: new Date().toISOString(),
      })
      throw error
    } finally {
      this.controllers.delete(run.id)
    }
  }

  async _executeQualityStep({ run, step, mirror, eventContext }) {
    const sourceCandidate = [...run.candidates].reverse().find((candidate) => candidate.artifactType === 'manuscript' && candidate.status === 'pending')
    if (!sourceCandidate) throw new Error('正文质量评审缺少待确认正文候选')
    const startedAt = new Date().toISOString()
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    try {
      const { result, payload: review } = await this._runStructuredTask({
        run, step, mirror, eventContext, signal: controller.signal, startedAt,
        extra: { sourceCandidate },
        validate: (execution) => validateCandidate('quality_review', candidatePayload('quality_review', execution)),
      })
      const qualityReportId = result.qualityReportId || await this.persistQualityReview({
        run,
        step,
        sourceCandidate,
        result,
        review,
      }) || ''
      this.repository.updateStep(step.id, {
        status: 'completed', output: { review, sourceCandidateId: sourceCandidate.id },
        generationRecordId: result.generationRecordId || '',
        qualityReportId,
        executionBackend: result.backend || result.execution || 'app_model',
        outputStarted: Boolean(result.outputStarted || result.content || result.review),
        completedAt: new Date().toISOString(),
      })
      this.repository.updateRun(run.id, {
        actualBackend: result.backend || result.execution || 'app_model',
        fallbackReason: result.fallbackReason || '',
      })
      this._emit(run.id, 'quality_review_completed', { stepId: step.id, review })
    } catch (error) {
      if (error instanceof CodexCancelledError || controller.signal.aborted) {
        this.repository.updateStep(step.id, { status: 'interrupted', interruptedAt: new Date().toISOString(), error: error.message })
        this.repository.updateRun(run.id, { status: 'paused', error: error.message })
        return
      }
      this.repository.updateStep(step.id, {
        status: 'failed', error: error.message, outputStarted: Boolean(error.codexPartialResult?.outputStarted),
        output: error.codexPartialResult ? { partialEvidence: true, content: String(error.codexPartialResult.content || '').slice(0, 64 * 1024) } : {},
        completedAt: new Date().toISOString(),
      })
      throw error
    } finally {
      this.controllers.delete(run.id)
    }
  }

  async _runStructuredTask({ run, step, mirror, eventContext, signal, startedAt, extra = {}, validate }) {
    let attempt = Number(step.attemptCount || 0)
    let retry = null
    while (attempt < 3) {
      attempt += 1
      this.repository.updateStep(step.id, { status: 'running', attemptCount: attempt, startedAt })
      try {
        const result = await this._executeTask({
          run, step, mirror, eventContext, signal,
          extra: retry ? { ...extra, structuredRepair: retry } : extra,
        })
        try {
          return { result, payload: validate(result) }
        } catch (error) {
          error.generationRecordId ||= result.generationRecordId || ''
          throw error
        }
      } catch (error) {
        if (error.name !== 'StructuredOutputError' || attempt >= 3) throw error
        retry = {
          attempt: attempt + 1,
          reason: error.message,
          retryOfGenerationId: error.generationRecordId || error.codexPartialResult?.generationRecordId || '',
        }
        this._emit(run.id, 'structured_retry', { stepId: step.id, attempt: attempt + 1, error: error.message })
      }
    }
    throw new Error('结构修复重试已达到三次上限')
  }

  async _executeTask({ run, step, mirror, eventContext, signal, extra = {} }) {
    if (run.executionMode !== 'codex') {
      return this.runAppModel({ run, step, eventContext, signal, extra })
    }
    const prepared = await this.prepareCodexPrompt({ run, step, mirror, extra })
    try {
      const result = await this.codexGateway.prompt({
        agentRunId: run.id,
        agentStepId: step.id,
        messages: prepared.messages,
        outputSchema: prepared.outputSchema,
        signal,
        onEvent: (event) => this._emit(run.id, 'codex_event', event),
        settings: {
          mirrorRoot: mirror.root,
          workspaceRoot: mirror.workspaceRoot || mirror.root,
          projectId: run.projectId,
          stepLabel: step.key,
          displayTitle: prepared.displayTitle || '',
          model: prepared.model || '',
          reasoningEffort: prepared.reasoningEffort || '',
          fastMode: Boolean(prepared.fastMode),
          authMethod: prepared.authMethod || '',
        },
      })
      await this.completeCodexGeneration({ prepared, result, status: 'completed', attempt: extra.structuredRepair?.attempt || 1 })
      if (prepared.generationRecordId) result.generationRecordId = prepared.generationRecordId
      return result
    } catch (error) {
      await this.completeCodexGeneration({
        prepared,
        result: error.codexPartialResult || null,
        error,
        status: error.name === 'CodexCancelledError' ? 'cancelled' : 'failed',
        attempt: extra.structuredRepair?.attempt || 1,
      })
      if (prepared.generationRecordId) error.generationRecordId = prepared.generationRecordId
      throw error
    }
  }

  async confirmCandidate(input, eventContext = null) {
    const run = this.repository.getRun(input.runId)
    if (!run) throw new Error('AgentRun 不存在')
    const candidate = run.candidates.find((item) => item.id === input.candidateId)
    const candidateCanResolve = input.accept
      ? candidate?.status === 'pending'
      : ['pending', 'stale'].includes(candidate?.status)
    if (!candidate || !candidateCanResolve) throw new Error('候选不存在或已经处理')
    const sourceStep = run.steps.find((item) => item.id === candidate.stepId)
    if (input.accept && candidate.artifactType === 'renderer_draft'
      && String(input.currentDraftDigest || '') !== String(sourceStep?.input?.target?.draftDigest || '')) {
      this.repository.markCandidateStale?.(candidate.id, '编辑器草稿已变化，候选已过期')
      this.repository.updateRun(run.id, { status: 'paused', error: '编辑器草稿已变化，候选已过期' })
      throw new Error('当前表单已经修改，候选已标记为过期；可以比较或复制后重新生成')
    }
    if (input.accept) {
      const currentDigest = await this.currentSourceDigest(run)
      if (currentDigest !== candidate.sourceDigest) {
        this.repository.markCandidateStale?.(candidate.id, '项目源内容已变化，候选已过期')
        throw new Error('项目内容已变化，候选已标记为过期，请重新生成')
      }
    }
    let projectWriteApproval = null
    if (input.accept && candidate.artifactType !== 'renderer_draft' && run.executionMode === 'codex' && this.repository.createApproval) {
      projectWriteApproval = this.repository.createApproval({
        projectId: run.projectId,
        agentRunId: run.id,
        agentStepId: candidate.stepId,
        origin: 'agent',
        actionType: 'project_write',
        permission: `接受 ${candidate.artifactType} 候选并写入项目`,
        payload: {
          candidateId: candidate.id,
          artifactType: candidate.artifactType,
          sourceDigest: candidate.sourceDigest,
          applyOptions: input.applyOptions && typeof input.applyOptions === 'object' ? input.applyOptions : {},
        },
      })
      this.repository.resolveApproval?.({ id: projectWriteApproval.id, approved: true, note: input.reason || '作者在候选区确认' })
    }
    try {
      if (input.accept) await this.applyCandidate({
        run,
        candidate,
        reason: input.reason || '',
        applyOptions: input.applyOptions && typeof input.applyOptions === 'object' ? input.applyOptions : {},
      })
      if (projectWriteApproval) this.repository.completeApproval?.(projectWriteApproval.id, { result: { candidateId: candidate.id } })
    } catch (error) {
      if (projectWriteApproval) this.repository.completeApproval?.(projectWriteApproval.id, { error: error.message })
      throw error
    }
    this.repository.resolveCandidate({ id: candidate.id, accept: Boolean(input.accept), reason: input.reason || '' })
    const refreshed = this.repository.getRun(run.id)
    const refreshedSourceStep = refreshed.steps.find((item) => item.id === candidate.stepId)
    const checkpoint = refreshed.steps.find((item) => item.position > refreshedSourceStep.position && item.action === 'checkpoint' && item.status === 'waiting_confirmation')
    if (checkpoint) this.repository.updateStep(checkpoint.id, { status: input.accept ? 'completed' : 'rejected', completedAt: new Date().toISOString() })
    if (!input.accept && run.workflowId === 'inline-action') {
      await this.codexGateway?.closeSession?.(run.id)
      return this.repository.updateRun(run.id, { status: 'completed', completedAt: new Date().toISOString(), currentStepId: '' })
    }
    if (!input.accept) return this.repository.updateRun(run.id, { status: 'paused', currentStepId: refreshedSourceStep.id })
    if (run.workflowId === 'inline-action') {
      return this.repository.updateRun(run.id, {
        status: 'waiting_confirmation',
        currentStepId: refreshedSourceStep.id,
        error: '',
      })
    }
    const mirror = run.executionMode === 'codex' ? await this.refreshMirror(this.repository.getRun(run.id)) : null
    this.repository.updateRun(run.id, { status: 'running', currentStepId: '' })
    void this.advance(run.id, eventContext, mirror).catch((error) => this._failRun(run.id, error))
    return this.repository.getRun(run.id)
  }

  async pause(runId) {
    const run = this.repository.getRun(runId)
    if (!run) throw new Error('AgentRun 不存在')
    this.controllers.get(runId)?.abort()
    if (run.executionMode === 'codex') await this.codexGateway.cancelTurn(runId)
    const current = run.steps.find((step) => step.id === run.currentStepId)
    if (current?.status === 'running') this.repository.updateStep(current.id, { status: 'interrupted', interruptedAt: new Date().toISOString() })
    return this.repository.updateRun(runId, { status: 'paused' })
  }

  async resume(runId, eventContext = null) {
    const run = this.repository.getRun(runId)
    if (!run) throw new Error('AgentRun 不存在')
    if (run.steps.some((step) => step.status === 'interrupted')) throw new Error('当前步骤已中断，请先重试该步骤')
    this.repository.updateRun(runId, { status: 'running' })
    void this.advance(runId, eventContext).catch((error) => this._failRun(runId, error))
    return this.repository.getRun(runId)
  }

  async cancel(runId) {
    const run = this.repository.getRun(runId)
    if (!run) throw new Error('AgentRun 不存在')
    this.controllers.get(runId)?.abort()
    if (run.executionMode === 'codex') await this.codexGateway.closeSession(runId)
    for (const step of run.steps.filter((item) => ['pending', 'waiting_approval', 'running', 'interrupted', 'waiting_confirmation'].includes(item.status))) {
      this.repository.updateStep(step.id, { status: 'cancelled', completedAt: new Date().toISOString() })
    }
    this.repository.cancelPendingCandidates?.(runId)
    return this.repository.updateRun(runId, { status: 'cancelled', completedAt: new Date().toISOString() })
  }

  async finishInline(runId) {
    const run = this.repository.getRun(runId)
    if (!run || run.workflowId !== 'inline-action') throw new Error('就地 Codex 对话不存在')
    if (run.candidates.some((candidate) => candidate.status === 'pending')) throw new Error('请先接受、修改或放弃当前候选')
    if (run.steps.some((step) => ['pending', 'waiting_approval', 'running', 'interrupted'].includes(step.status))) {
      throw new Error('Codex 正在处理当前修改')
    }
    await this.codexGateway?.closeSession?.(runId)
    this.repository.appendEvent?.({
      agentRunId: runId,
      type: 'inline_conversation_finished',
      summary: '作者结束了本次就地 Codex 对话',
      payload: { reason: 'author_finished_inline_conversation' },
    })
    const completed = this.repository.updateRun(runId, {
      status: 'completed',
      currentStepId: '',
      completedAt: new Date().toISOString(),
      error: '',
    })
    this._emit(runId, 'run_completed', { run: completed, reason: 'author_finished_inline_conversation' })
    return completed
  }

  retryStep({ runId, stepId }, eventContext = null) {
    const run = this.repository.getRun(runId)
    const step = run?.steps.find((item) => item.id === stepId)
    if (!step) throw new Error('AgentStep 不存在')
    if (step.attemptCount >= 3) throw new Error('结构修复或步骤重试已达到三次上限')
    if (!['failed', 'interrupted', 'rejected', 'stale'].includes(step.status)) throw new Error('当前步骤状态不需要重试')
    this.repository.updateStep(step.id, { status: 'pending', error: '', interruptedAt: '' })
    this.repository.updateRun(runId, { status: 'running', error: '', currentStepId: '' })
    void this.advance(runId, eventContext).catch((error) => this._failRun(runId, error))
    return this.repository.getRun(runId)
  }

  _failRun(runId, error) {
    if (error instanceof CodexCancelledError) return this.repository.updateRun(runId, { status: 'paused', error: error.message })
    this._emit(runId, 'run_failed', { error: error.message })
    return this.repository.updateRun(runId, { status: 'failed', error: error.message })
  }

  _emit(agentRunId, type, payload = {}) {
    const event = { agentRunId, type, payload, createdAt: new Date().toISOString() }
    this.onEvent(event)
    return event
  }
}

export { candidatePayload, foundationBundlePayload, validateCandidate, validateFoundationBundle }
