import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  archiveProject,
  applyPlanningFoundationBundle,
  addQualityHumanReview,
  appendInlineAgentRevision,
  buildGenerationContext,
  bindPromptTemplate,
  cancelPendingAgentCandidates,
  createChapter,
  createAgentCandidate,
  createAgentRun,
  createInlineAgentRun,
  createApprovalRequest,
  createBenchmarkRun,
  createCharacterRelationship,
  createStoryArc,
  createStoryArcBeat,
  createStoryChangeSet,
  createKnowledgeItem,
  createKnowledgeCandidate,
  createPlanningCandidate,
  createPlanningEntity,
  createProject,
  createRevision,
  createQualityReport,
  deleteChapter,
  deleteCharacterRelationship,
  deleteStoryArc,
  deleteStoryArcBeat,
  deleteKnowledgeItem,
  deleteModelProfile,
  deletePlanningEntity,
  deleteProject,
  duplicateChapter,
  finishGenerationRecord,
  finishBenchmarkStep,
  exportProjectBackup,
  getDatabaseInfo,
  getGenerationRecord,
  getAgentRun,
  getAgentRunPack,
  getApprovalRequest,
  getBenchmarkRun,
  getQualityReport,
  getStoryChangeModelContext,
  getStoryChangeSet,
  getQualityReportByGeneration,
  getBlindQualityReviewPacket,
  getModelApiKey,
  listGenerationRecords,
  listAgentEvents,
  listAgentRuns,
  listApprovalRequests,
  listBenchmarkRuns,
  listQualityReports,
  listProjects,
  listStoryChangeSets,
  listRevisions,
  markAgentCandidateStale,
  loadPromptCenter,
  loadPlanningCenter,
  loadKnowledgeCenter,
  loadContextManager,
  loadModelSettings,
  loadCodexSettings,
  loadWorkspace,
  loadWorkspaceSnapshot,
  importManuscriptData,
  openDatabase,
  reorderChapters,
  reorderKnowledgeItems,
  reorderPlanningEntities,
  rebuildContextMemories,
  resolvePromptContext,
  restoreProject,
  restoreRevision,
  restoreProjectBackupData,
  resolvePlanningCandidate,
  resolveContinuityCheck,
  resolveKnowledgeCandidate,
  resolveKnowledgeItemCandidate,
  savePlanningDocument,
  savePromptAddon,
  savePromptTemplate,
  saveStyleProfile,
  saveModelProfile,
  saveAgentSession,
  saveCodexSettings,
  startGenerationRecord,
  startBenchmarkStep,
  updateChapter,
  updateAgentRun,
  updateAgentStep,
  updateBenchmarkRun,
  updateCharacterRelationship,
  updateStoryArc,
  updateStoryArcBeat,
  updateKnowledgeItem,
  updateKnowledgeItemCandidate,
  updateProject,
  updatePlanningEntity,
  updateTaskRoute,
  updateContextProfile,
  refreshContinuityChecks,
  syncKnowledgeSources,
  setPromptAddonBinding,
  appendAgentEvent,
  completeApprovalRequest,
  expirePendingApprovalRequests,
  resolveAgentCandidate,
  resolveApprovalRequest,
  attachStoryChangeAnalysis,
  applyStoryChangeSet,
  revertStoryChangeSet,
  updateStoryChangeSelection,
  updateStoryChangeStatus,
} from './database.js'
import { manuscriptExport, parseManuscript } from './manuscript-formats.js'
import { probeModelCapabilities } from './model-adapter.js'
import { createModelGateway } from './model-gateway.js'
import { compilePrompt } from './prompt-compiler.js'
import {
  PROMPT_EVAL_BENCHMARK,
  URBAN_SUSPENSE_BENCHMARK,
  buildReadinessReport,
  deterministicQualityChecks,
  planningPromptProfile,
  qualityEvidenceExecution,
  urbanSuspenseDeterministicEvaluation,
} from './creative-quality.js'
import { aggregatePromptEvalResults, scorePromptEvalCase, validatePromptEvalSuite } from './prompt-evaluator.js'
import { runWithStructuredOutputRetry } from './structured-output-retry.js'
import { AgentRuntime, manuscriptLengthRange } from './agent-runtime.js'
import { CodexAgentGateway, inspectCodexRuntime } from './codex-agent-gateway.js'
import { createCodexBookWorkspace, createCodexProjectMirror, removeCodexBookWorkspace } from './codex-project-mirror.js'
import { codexTaskDisplayTitle } from './codex-task-label.js'
import { projectForInlineTarget, sanitizeProjectDraftContext } from './inline-creative.js'
import { planningBundleSchema } from './planning-bundle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let goServiceProcess = null
let goServiceStatus = 'not-started'
let goServiceBaseUrl = ''
let goServiceAuthToken = ''
let mainWindow = null
let closeResponsePending = false
const activeBenchmarkTasks = new Map()
const activeBenchmarkControls = new Map()
let codexGateway = null
let agentRuntime = null
const codexSessionModelApprovalProjects = new Set()

const modelGateway = createModelGateway({
  getGoRuntime: () => ({
    status: goServiceStatus,
    baseUrl: goServiceBaseUrl,
    authToken: goServiceAuthToken,
  }),
  onGoUnavailable: (error) => {
    console.error('[GoService] gateway unavailable, using embedded adapter', error)
    goServiceBaseUrl = ''
    setGoServiceStatus('error')
  },
})

function publishCodexEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function agentRepositoryApi() {
  return {
    createRun: createAgentRun,
    createInlineRun: createInlineAgentRun,
    appendInlineRevision: appendInlineAgentRevision,
    getRun: getAgentRun,
    getRunPack: getAgentRunPack,
    listRuns: listAgentRuns,
    updateRun: updateAgentRun,
    updateStep: updateAgentStep,
    createCandidate: createAgentCandidate,
    resolveCandidate: resolveAgentCandidate,
    markCandidateStale: markAgentCandidateStale,
    cancelPendingCandidates: cancelPendingAgentCandidates,
    upsertSession: saveAgentSession,
    appendEvent: appendAgentEvent,
    listEvents: listAgentEvents,
    createApproval: createApprovalRequest,
    listApprovals: listApprovalRequests,
    resolveApproval: resolveApprovalRequest,
    completeApproval: completeApprovalRequest,
  }
}

function mirrorForRun(run) {
  const workspace = loadWorkspaceSnapshot(run.projectId)
  const inlineTarget = run.workflowId === 'inline-action' ? run.steps?.at(-1)?.input?.target : null
  const mirrorWorkspace = inlineTarget?.kind === 'project_brief_draft'
    ? { ...workspace, project: projectForInlineTarget(workspace.project, inlineTarget) }
    : workspace
  return createCodexProjectMirror({
    baseDirectory: app.getPath('userData'),
    agentRun: run,
    workspace: mirrorWorkspace,
    codexProject: workspace.project,
    planningCenter: loadPlanningCenter(run.projectId),
    knowledgeCenter: loadKnowledgeCenter(run.projectId),
    creativePack: getAgentRunPack(run.id),
    skillSourceDirectory: path.join(__dirname, '..', 'skills', 'novel-studio-creator'),
  })
}

function codexBookWorkspaceForProject(projectId) {
  const project = listProjects().find((item) => item.id === projectId)
  if (!project) throw new Error('项目不存在')
  return createCodexBookWorkspace({ baseDirectory: app.getPath('userData'), project })
}

function outputSchemaForTask(pack, task, candidateType = '', target = null) {
  if (candidateType === 'foundation_bundle') return pack?.schemas?.foundationBundle || null
  if (['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(candidateType)) return planningBundleSchema(target || {})
  const keys = {
    chapter_card: 'chapterCard',
    scene_plan: 'scenePlan',
    chapter_state_extract: 'chapterState',
    quality_review: 'qualityReview',
    story_change: 'storyChange',
  }
  if (task === 'chapter') {
    return {
      type: 'object',
      required: ['manuscript'],
      properties: { manuscript: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    }
  }
  if (task === 'continuity_audit') {
    return {
      type: 'object',
      required: ['issues', 'uncertain'],
      properties: {
        issues: { type: 'array' },
        uncertain: { type: 'array' },
      },
      additionalProperties: false,
    }
  }
  return pack?.schemas?.[keys[task]] || null
}

function codexGenerationOutput(result = {}) {
  if (result.structuredOutput) return JSON.stringify(result.structuredOutput)
  return String(result.content || '')
}

function inlinePlanningInput({ step, workspace, planningCenter, chapter }) {
  const target = step.input?.target || {}
  const sectionNames = { foundation: '故事基础', world: '世界观', outline: '结构规划' }
  if (target.kind === 'planning_document_bundle') {
    const document = planningCenter.documents?.[target.targetId]
    if (!document) throw new Error('整页生成对应的规划文档不存在')
    const content = document.content || {}
    const fields = Array.isArray(target.fields) ? target.fields : []
    return {
      scopeType: target.targetId,
      scopeId: workspace.project.id,
      sectionLabel: sectionNames[target.targetId] || '故事规划',
      targetLabel: workspace.project.title,
      fieldKey: 'documentBundle',
      fieldLabel: target.fieldLabel || 'AI 补全本页',
      currentValue: JSON.stringify(content),
      nearbyContext: JSON.stringify({
        requestedFields: fields.map((field) => ({ key: field.key, label: field.label, currentValue: field.originalValue })),
        confirmedFields: Object.fromEntries(Object.entries(content)
          .filter(([key, value]) => !target.fieldKeys?.includes(key) && String(value || '').trim())),
      }),
      boundaries: [
        '一次完成当前规划页所有请求字段，字段之间必须形成同一套因果与设定体系。',
        '已确认且未列入 requestedFields 的字段是受保护事实，不得改写。',
        '只返回符合输出 Schema 的 JSON；不要返回说明、Markdown 或额外字段。',
      ].join(''),
    }
  }
  if (target.kind === 'planning_document') {
    const document = planningCenter.documents?.[target.targetId]
    if (!document) throw new Error('就地创作对应的规划文档不存在')
    const content = document.content || {}
    const nearby = { ...content }
    delete nearby[target.fieldKey]
    return {
      scopeType: 'project',
      scopeId: workspace.project.id,
      sectionLabel: sectionNames[target.targetId] || '故事规划',
      targetLabel: workspace.project.title,
      fieldKey: target.fieldKey,
      fieldLabel: target.fieldLabel || target.fieldKey,
      currentValue: String(content[target.fieldKey] || ''),
      nearbyContext: JSON.stringify(nearby),
      boundaries: '只生成当前字段候选；遵守已确认项目事实、世界硬规则和章节边界。',
    }
  }
  if (target.kind === 'planning_chapter_bundle') {
    if (!chapter || chapter.id !== target.targetId) throw new Error('整章规划对应的章节不存在')
    const fields = Array.isArray(target.fields) ? target.fields : []
    const content = { ...(chapter.card || {}), scenePlan: chapter.scenePlan || {} }
    return {
      scopeType: 'chapter',
      scopeId: chapter.id,
      sectionLabel: '章节规划',
      targetLabel: `第 ${chapter.chapter_no || chapter.chapterNo || 1} 章《${chapter.title}》`,
      fieldKey: 'chapterBundle',
      fieldLabel: target.fieldLabel || 'AI 补全本章',
      currentValue: JSON.stringify(content),
      nearbyContext: JSON.stringify({
        requestedFields: fields.map((field) => ({ key: field.key, label: field.label, currentValue: field.originalValue })),
        confirmedFields: Object.fromEntries(Object.entries(content)
          .filter(([key, value]) => !target.fieldKeys?.includes(key) && (typeof value === 'object' ? Object.keys(value || {}).length : String(value || '').trim()))),
      }),
      boundaries: [
        '一次完成当前章节规划的所有请求字段；目标、阻力、转折、回报、代价、结尾与场景计划必须形成同一条因果链。',
        '场景计划使用可读文本，逐场写清进入状态、目标、阻力、行动、转折与退出状态。',
        '已确认且未列入 requestedFields 的字段是受保护事实，不得改写；不得越过已确认章节结尾。',
        '只返回符合输出 Schema 的 JSON；不要返回说明、Markdown 或额外字段。',
      ].join(''),
    }
  }
  if (target.kind === 'planning_entity_bundle') {
    const entity = [...(planningCenter.characters || []), ...(planningCenter.worldElements || []), ...(planningCenter.volumes || [])]
      .find((item) => item.id === target.targetId)
    if (!entity) throw new Error('整卡生成对应的规划对象不存在')
    const fields = Array.isArray(target.fields) ? target.fields : []
    return {
      scopeType: entity.kind === 'volume' ? 'volume' : 'project',
      scopeId: entity.kind === 'volume' ? entity.id : workspace.project.id,
      sectionLabel: entity.kind === 'character' ? '人物与关系' : entity.kind === 'world' ? '世界观' : '分卷规划',
      targetLabel: entity.title,
      fieldKey: 'entityBundle',
      fieldLabel: target.fieldLabel || 'AI 补全整卡',
      currentValue: JSON.stringify({ title: entity.title, ...(entity.data || {}) }),
      nearbyContext: JSON.stringify({
        requestedFields: fields.map((field) => ({ key: field.key, label: field.label, currentValue: field.originalValue })),
        confirmedFields: Object.fromEntries(Object.entries({ title: entity.title, ...(entity.data || {}) })
          .filter(([key, value]) => !target.fieldKeys?.includes(key) && String(value || '').trim())),
      }),
      boundaries: [
        '一次完成当前卡片所有请求字段，字段之间必须互相一致。',
        '已确认且未列入 requestedFields 的字段是受保护事实，不得改写。',
        '只返回符合输出 Schema 的 JSON；不要返回说明、Markdown 或额外字段。',
      ].join(''),
    }
  }
  if (target.kind === 'planning_entity') {
    const entity = [...(planningCenter.characters || []), ...(planningCenter.worldElements || []), ...(planningCenter.volumes || [])]
      .find((item) => item.id === target.targetId)
    if (!entity) throw new Error('就地创作对应的规划对象不存在')
    const currentValue = target.fieldKey === 'title' ? entity.title : entity.data?.[target.fieldKey]
    const nearby = { title: entity.title, ...(entity.data || {}) }
    delete nearby[target.fieldKey]
    return {
      scopeType: entity.kind === 'volume' ? 'volume' : 'project',
      scopeId: entity.kind === 'volume' ? entity.id : workspace.project.id,
      sectionLabel: entity.kind === 'character' ? '人物与关系' : entity.kind === 'world' ? '世界观' : '分卷规划',
      targetLabel: entity.title,
      fieldKey: target.fieldKey,
      fieldLabel: target.fieldLabel || target.fieldKey,
      currentValue: String(currentValue || ''),
      nearbyContext: JSON.stringify(nearby),
      boundaries: '只生成当前字段候选；不得改写该对象其他已确认字段。',
    }
  }
  if (target.kind === 'chapter_field') {
    const currentValue = target.fieldKey === 'title' ? chapter?.title : chapter?.card?.[target.fieldKey]
    return {
      scopeType: 'chapter',
      scopeId: chapter?.id || '',
      sectionLabel: '章节规划',
      targetLabel: `第 ${chapter?.chapterNo || chapter?.chapter_no || 1} 章《${chapter?.title || '未命名章节'}》`,
      fieldKey: target.fieldKey,
      fieldLabel: target.fieldLabel || target.fieldKey,
      currentValue: String(currentValue || ''),
      nearbyContext: JSON.stringify(chapter?.card || {}),
      boundaries: '只生成当前章节字段候选；不得越过本章已确认结尾。',
    }
  }
  if (target.kind === 'project_brief_draft') {
    const draft = sanitizeProjectDraftContext(target.draftContext)
    const nearby = { ...draft }
    delete nearby[target.fieldKey]
    return {
      scopeType: 'project',
      scopeId: workspace.project.id,
      sectionLabel: '待保存项目信息',
      targetLabel: draft.title || workspace.project.title,
      fieldKey: target.fieldKey,
      fieldLabel: target.fieldLabel || target.fieldKey,
      currentValue: String(draft[target.fieldKey] || ''),
      nearbyContext: JSON.stringify(nearby),
      boundaries: `这是尚未保存的项目表单。本次候选必须以待保存题材“${draft.genre || '未指定'}”为准；只返回可直接填入当前字段的最终文本，不解释流程，不沿用正式项目中已经被本表单替换的旧题材。`,
    }
  }
  if (step.task === 'planning_field') {
    return {
      scopeType: target.scopeType || 'project',
      scopeId: target.scopeId || workspace.project.id,
      sectionLabel: '当前编辑表单',
      targetLabel: target.fieldLabel || '当前草稿',
      fieldKey: target.fieldKey,
      fieldLabel: target.fieldLabel || target.fieldKey,
      currentValue: String(target.draftValue || ''),
      nearbyContext: '',
      boundaries: '这是尚未保存的编辑器草稿。只返回当前字段可填入的候选文本，不把草稿内容升级为已确认项目事实。',
    }
  }
  return undefined
}

async function prepareCodexPrompt({ run, step, extra = {} }) {
  const workspace = loadWorkspaceSnapshot(run.projectId)
  const chapter = workspace.chapters.find((item) => item.id === run.chapterId) || workspace.chapters[0]
  const planningCenter = loadPlanningCenter(run.projectId)
  const knowledgeCenter = loadKnowledgeCenter(run.projectId)
  const promptContext = resolvePromptContext({
    projectId: run.projectId,
    chapterId: run.chapterId,
    task: step.task,
  })
  const longContext = buildGenerationContext({
    projectId: run.projectId,
    chapterId: run.chapterId,
    styleText: promptContext?.style?.mergedText,
    task: step.task,
  })
  const codexSettings = loadCodexSettings()
  const codexRunSettings = {
    model: run.modelRoutes?.codexModel ?? codexSettings?.model ?? '',
    reasoningEffort: run.modelRoutes?.codexReasoningEffort ?? codexSettings?.reasoningEffort ?? 'high',
    fastMode: run.modelRoutes?.codexFastMode ?? Boolean(codexSettings?.fastMode),
    authMethod: run.modelRoutes?.codexAuthMethod ?? codexSettings?.authMethod ?? 'chatgpt',
  }
  const inlineAction = run.workflowId === 'inline-action' ? step.input || {} : null
  const inlineRevision = inlineAction?.revision || null
  const revisionCandidate = inlineRevision?.parentCandidateId
    ? run.candidates?.find((candidate) => candidate.id === inlineRevision.parentCandidateId)
    : null
  if (inlineRevision && !revisionCandidate) throw new Error('Codex 修改步骤缺少上一版候选')
  const intent = inlineAction?.intent || (step.task === 'quality_review' ? 'analysis' : 'draft')
  const target = inlineAction?.target || null
  const planningBundleSchemaValue = ['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(step.candidateType)
    ? outputSchemaForTask(getAgentRunPack(run.id), step.task, step.candidateType, target)
    : null
  const planningBundleContract = planningBundleSchemaValue
    ? `只返回一个 JSON 对象，不要使用 Markdown 代码围栏。结构必须严格符合：${JSON.stringify(planningBundleSchemaValue)}。fields 中每一项都是可直接写入对应字段的最终文本。`
    : ''
  const promptProject = projectForInlineTarget(workspace.project, target || {})
  const pendingProjectDraft = target?.kind === 'project_brief_draft'
    ? sanitizeProjectDraftContext(target.draftContext)
    : {}
  const rendererDraftContext = Object.keys(pendingProjectDraft).length ? pendingProjectDraft : null
  const effectiveLongContext = rendererDraftContext ? {
    ...longContext,
    text: [
      '【本次待保存项目资料】',
      `项目名称：${rendererDraftContext.title || workspace.project.title}`,
      `题材：${rendererDraftContext.genre || '未指定'}`,
      `一句话想法：${rendererDraftContext.idea || '尚未填写'}`,
      `项目文风：${rendererDraftContext.style || '尚未填写'}`,
      '以上内容只在本次编辑器候选中临时生效；其中待保存题材优先于正式项目的旧题材。',
    ].join('\n'),
  } : longContext
  const manuscript = String(chapter?.manuscript || '')
  const cursorOffset = Math.max(0, Math.min(Number(target?.cursorOffset ?? manuscript.length), manuscript.length))
  const selectionFrom = Math.max(0, Math.min(Number(target?.selectionFrom || 0), manuscript.length))
  const selectionTo = Math.max(selectionFrom, Math.min(Number(target?.selectionTo || 0), manuscript.length))
  const lengthRange = manuscriptLengthRange(run.modelRoutes?.targetLength)
  const selectedSourceGeneration = target?.sourceGenerationId ? getGenerationRecord(target.sourceGenerationId) : null
  if (target?.sourceGenerationId && (!selectedSourceGeneration || selectedSourceGeneration.projectId !== run.projectId)) {
    throw new Error('待评审生成记录不存在或不属于当前项目')
  }
  const selectedQualityReport = target?.reportId ? getQualityReport(target.reportId) : null
  if (target?.reportId && (!selectedQualityReport || selectedQualityReport.projectId !== run.projectId)) {
    throw new Error('质量修复报告不存在或不属于当前项目')
  }
  if (selectedQualityReport && selectedSourceGeneration && selectedQualityReport.generationRecordId !== selectedSourceGeneration.id) {
    throw new Error('质量修复报告与来源生成记录不一致')
  }
  const selectedRepairIssues = selectedQualityReport
    ? selectedQualityReport.modelReview.issues.filter((issue) => target.issueIds?.includes(issue.id))
    : []
  if (intent === 'repair' && selectedQualityReport && !selectedRepairIssues.length) {
    throw new Error('质量修复至少需要选择一个报告问题')
  }
  const storyChangeContext = step.task === 'story_change'
    ? getStoryChangeModelContext(target?.targetId || '')
    : undefined
  const sourceGeneration = extra.sourceCandidate ? {
    id: extra.sourceCandidate.evidence?.generationRecordId || '',
    task: 'chapter',
    intent: 'draft',
    output: extra.sourceCandidate.payload?.manuscript || '',
  } : selectedSourceGeneration ? {
    id: selectedSourceGeneration.id,
    task: selectedSourceGeneration.task,
    intent: selectedSourceGeneration.intent,
    output: selectedSourceGeneration.output,
  } : undefined
  const repairInstruction = extra.structuredRepair
    ? `这是第 ${extra.structuredRepair.attempt} 次结构修复。上一结果不符合合同：${extra.structuredRepair.reason}。重新返回完整结果，不引用损坏输出。`
    : ''
  const qualityRepairInstruction = selectedRepairIssues.length
    ? `只修复以下已选质量问题，保留未涉及的事实、事件顺序、人物状态和章节结尾合同：\n${selectedRepairIssues.map((issue) => `- ${issue.category || issue.criterion}：${issue.repairInstruction || issue.criterion}`).join('\n')}`
    : ''
  const lengthInstruction = lengthRange && step.task === 'chapter'
    ? `本章正文目标为 ${lengthRange.target} 个纯中文字符（不计标点与空白），验收范围 ${lengthRange.minimum}–${lengthRange.maximum}。必须完整展开已确认场景的行动、阻力、转折和状态变化，不得以提纲、概述或提前收束代替篇幅。`
    : lengthRange && step.task === 'quality_review'
      ? `本章正文目标为 ${lengthRange.target} 个纯中文字符，合格范围 ${lengthRange.minimum}–${lengthRange.maximum}；将篇幅是否达标纳入规划遵循与文字质量判断。`
      : ''
  const inlineRevisionInstruction = inlineRevision ? [
    '这是同一就地 Codex 对话中的候选修改。',
    `作者的修改要求：${inlineRevision.instruction}`,
    `上一版候选（状态：${revisionCandidate.status}）：`,
    JSON.stringify(revisionCandidate.payload || {}, null, 2).slice(0, 100000),
    '请返回修改后的完整候选，保持当前任务的输出 Schema；不要只返回差异、解释或修改建议。未被作者点名的有效内容应尽量保留。',
  ].join('\n') : ''
  const compiled = compilePrompt({
    task: step.task,
    intent,
    project: promptProject,
    chapter,
    planningCenter,
    knowledgeCenter,
    promptContext,
    longContext: effectiveLongContext,
    sourceGeneration,
    modelProfile: { id: 'codex-agent', provider: 'codex', name: 'Codex Agent', model: codexRunSettings.model },
    agentRunId: run.id,
    agentStepId: step.id,
    workflow: { id: run.workflowId },
    creativeExecution: inlineAction ? {
      projectDefault: workspace.project.default_execution_mode,
      requested: 'codex',
      override: workspace.project.default_execution_mode !== 'codex',
      intent,
      target,
      revision: inlineRevision || undefined,
    } : undefined,
    promptProfile: target?.promptProfile || '',
    selectedText: target?.kind === 'manuscript_selection' ? manuscript.slice(selectionFrom, selectionTo) : '',
    manuscriptPrefix: intent === 'continue' ? manuscript.slice(0, cursorOffset) : '',
    manuscriptSuffix: intent === 'continue' ? manuscript.slice(cursorOffset) : '',
    sourceText: intent === 'rewrite' || intent === 'repair' ? manuscript : '',
    deterministicChecks: selectedSourceGeneration && step.task === 'quality_review'
      ? deterministicQualityChecks({ task: selectedSourceGeneration.task, output: selectedSourceGeneration.output, chapter, targetLength: run.modelRoutes?.targetLength })
      : undefined,
    storyChangeContext,
    protectedOutputContract: planningBundleContract || undefined,
    planning: step.candidateType === 'foundation_bundle' ? {
      scopeType: 'project', fieldKey: 'foundationBundle', fieldLabel: '故事初始化组合', targetLabel: workspace.project.title,
      currentValue: '', nearbyContext: JSON.stringify({ genre: workspace.project.genre, idea: workspace.project.idea }),
      boundaries: '同时生成故事前提、阅读承诺、核心冲突、主角、关键世界硬规则和总纲；字段必须具体、可判定且能转化为人物行动。',
    } : inlineAction ? inlinePlanningInput({ step, workspace, planningCenter, chapter }) : undefined,
    instruction: [step.task === 'quality_review'
      ? '独立评审当前 AgentRun 的正文候选；隐藏自动分数之外的模型身份，只返回质量报告。'
      : step.task === 'story_change'
        ? '分析根设定对全书已确认内容的影响，只返回符合 StoryChangeSetCandidate Schema 的 JSON 变更集；不修改真实项目。'
      : step.candidateType === 'foundation_bundle'
        ? '初始化当前项目。严格按受保护 Foundation Bundle Schema 只返回一个 JSON 对象；只生成候选，不修改真实项目。'
        : step.candidateType === 'planning_document_bundle'
          ? `一次补全当前规划页的所有请求字段。${planningBundleContract}只生成一个整页候选，不修改真实项目。`
        : step.candidateType === 'planning_entity_bundle'
          ? `一次补全当前规划卡的所有请求字段。${planningBundleContract}只生成一个整卡候选，不修改真实项目。`
        : step.candidateType === 'planning_chapter_bundle'
          ? `一次补全当前章节规划的所有请求字段。${planningBundleContract}只生成一个整章规划候选，不修改真实项目。`
        : '在受控项目镜像中完成当前创作步骤；只生成候选，不修改真实项目。',
    rendererDraftContext
      ? `当前任务是在尚未保存的项目资料表单中生成“${target.fieldLabel || target.fieldKey}”。必须按待保存题材“${rendererDraftContext.genre || '未指定'}”创作；只输出字段最终内容，不要说明任务、流程、候选机制或是否写入项目。`
      : '',
    inlineRevision ? '' : inlineAction?.instruction || '', inlineRevisionInstruction,
    qualityRepairInstruction, lengthInstruction, repairInstruction].filter(Boolean).join('\n'),
  })
  const displayTitle = codexTaskDisplayTitle({
    project: promptProject,
    chapter,
    planningCenter,
    run,
    step,
  })
  const generationRecord = startGenerationRecord({
    taskId: `codex-${run.id}-${step.id}-${Date.now()}`,
    projectId: run.projectId,
    chapterId: run.chapterId,
    task: step.task,
    model: { provider: 'codex', name: 'Codex Agent', model: codexRunSettings.model },
    promptSnapshot: compiled.snapshot,
    request: {
      task: step.task,
      projectId: run.projectId,
      chapterId: run.chapterId,
      agentRunId: run.id,
      agentStepId: step.id,
      targetLength: lengthRange?.target || 0,
      intent,
      target: target || undefined,
      promptProfile: target?.promptProfile || '',
      codexDisplayTitle: displayTitle,
    },
    intent,
    parentGenerationId: revisionCandidate?.evidence?.generationRecordId || selectedSourceGeneration?.id || null,
    executionBackend: 'codex_acp',
    agentRunId: run.id,
    agentStepId: step.id,
    retryOfId: extra.structuredRepair?.retryOfGenerationId || null,
  })
  return {
    messages: compiled.messages,
    outputSchema: (() => {
      const schema = outputSchemaForTask(getAgentRunPack(run.id), step.task, step.candidateType, target)
      if (step.task !== 'chapter' || !lengthRange || !schema?.properties?.manuscript) return schema
      return {
        ...schema,
        properties: {
          ...schema.properties,
          manuscript: {
            ...schema.properties.manuscript,
            minLength: lengthRange.minimum,
          },
        },
      }
    })(),
    model: codexRunSettings.model,
    reasoningEffort: codexRunSettings.reasoningEffort,
    fastMode: Boolean(codexRunSettings.fastMode),
    authMethod: codexRunSettings.authMethod === 'environment' ? 'api-key' : 'chat-gpt',
    displayTitle,
    generationRecordId: generationRecord.id,
    promptSnapshot: compiled.snapshot,
  }
}

async function completeCodexGeneration({ prepared, result, error, status, attempt }) {
  if (!prepared?.generationRecordId) return
  finishGenerationRecord({
    id: prepared.generationRecordId,
    status,
    output: result ? codexGenerationOutput(result) : '',
    error: error?.message || '',
    attemptCount: attempt,
    events: (result?.events || []).slice(0, 200).map((event) => ({
      type: event.type || 'status',
      text: String(event.text || '').slice(0, 2000),
      createdAt: event.createdAt || '',
    })),
    executionBackend: result?.backend || 'codex_acp',
  })
}

async function runAgentAppModel({ run, step, eventContext, extra }) {
  if (step.task === 'quality_review') {
    const generationRecordId = extra.sourceCandidate?.evidence?.generationRecordId
    if (!generationRecordId) throw new Error('应用模型质量评审缺少正文生成记录')
    const report = await reviewGenerationQuality(eventContext, {
      generationRecordId,
      reviewerProfileId: run.modelRoutes?.reviewerProfileId || '',
      taskId: `agent-${run.id}-${step.id}`,
    })
    return {
      review: report.modelReview,
      generationRecordId: report.reviewerGenerationRecordId || '',
      qualityReportId: report.id,
      execution: 'app_model',
    }
  }
  const repairInstruction = extra.structuredRepair
    ? `第 ${extra.structuredRepair.attempt} 次结构修复：${extra.structuredRepair.reason}。重新返回完整结果，不引用损坏输出。`
    : ''
  const lengthRange = manuscriptLengthRange(run.modelRoutes?.targetLength)
  const lengthInstruction = step.task === 'chapter' && lengthRange
    ? `正文目标为 ${lengthRange.target} 个纯中文字符（不计标点与空白），必须落在 ${lengthRange.minimum}–${lengthRange.maximum} 之间，并完整展开每个已确认场景。`
    : ''
  const inlineAction = run.workflowId === 'inline-action' ? step.input || {} : null
  const target = inlineAction?.target || null
  const planningBundleSchemaValue = ['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(step.candidateType)
    ? outputSchemaForTask(getAgentRunPack(run.id), step.task, step.candidateType, target)
    : null
  const planningBundleContract = planningBundleSchemaValue
    ? `只返回一个 JSON 对象，不要使用 Markdown 代码围栏。结构必须严格符合：${JSON.stringify(planningBundleSchemaValue)}。fields 中每一项都是可直接写入对应字段的最终文本。`
    : ''
  const workspace = inlineAction ? loadWorkspaceSnapshot(run.projectId) : null
  const inlineChapter = workspace?.chapters.find((item) => item.id === run.chapterId) || workspace?.chapters[0]
  const inlinePlanning = inlineAction
    ? inlinePlanningInput({ step, workspace, planningCenter: loadPlanningCenter(run.projectId), chapter: inlineChapter })
    : undefined
  return runGenerationTask(eventContext, {
    taskId: `agent-${run.id}-${step.id}-${Date.now()}`,
    task: step.task,
    projectId: run.projectId,
    chapterId: run.chapterId,
    modelProfileId: run.modelRoutes?.[step.task] || run.modelRoutes?.modelProfileId || '',
    intent: step.task === 'chapter' ? 'draft' : 'analysis',
    planning: step.candidateType === 'foundation_bundle' ? {
      scopeType: 'project', fieldKey: 'foundationBundle', fieldLabel: '故事初始化组合', targetLabel: '当前项目',
      currentValue: '', nearbyContext: '',
      boundaries: '按 Foundation Bundle JSON 生成故事前提、阅读承诺、核心冲突、主角、世界硬规则和总纲。',
    } : inlinePlanning,
    promptProfile: target?.promptProfile || '',
    protectedOutputContract: planningBundleContract || undefined,
    instruction: [step.candidateType === 'foundation_bundle'
      ? `只输出 JSON 对象，字段结构必须严格符合：${JSON.stringify(outputSchemaForTask(getAgentRunPack(run.id), step.task, step.candidateType))}`
      : step.candidateType === 'planning_document_bundle'
        ? `一次补全当前规划页的所有请求字段。${planningBundleContract}`
      : step.candidateType === 'planning_entity_bundle'
        ? `一次补全当前规划卡的所有请求字段。${planningBundleContract}`
      : step.candidateType === 'planning_chapter_bundle'
        ? `一次补全当前章节规划的所有请求字段。${planningBundleContract}`
        : '', inlineAction?.instruction || '', lengthInstruction, repairInstruction].filter(Boolean).join('\n'),
    agentRunId: run.id,
    agentStepId: step.id,
    executionBackend: 'app_model',
  }, {
    retryOfId: extra.structuredRepair?.retryOfGenerationId || null,
    attemptCount: extra.structuredRepair?.attempt || 1,
  })
}

async function applyAgentCandidate({ run, candidate, applyOptions = {} }) {
  const refreshedRun = getAgentRun(run.id)
  const sourceStep = refreshedRun?.steps.find((step) => step.id === candidate.stepId)
  const inlineTarget = run.workflowId === 'inline-action' ? sourceStep?.input?.target || null : null
  const inlineIntent = run.workflowId === 'inline-action' ? sourceStep?.input?.intent || 'draft' : 'draft'
  if (candidate.artifactType === 'renderer_draft') return
  if (candidate.artifactType === 'story_change_set') {
    const changeSetId = inlineTarget?.targetId || ''
    if (!changeSetId) throw new Error('设定联动候选缺少变更集目标')
    applyStoryChangeSet({ changeSetId, excludeAgentCandidateId: candidate.id })
    return
  }
  if (candidate.artifactType === 'foundation_bundle') {
    applyPlanningFoundationBundle({ projectId: run.projectId, ...candidate.payload })
    return
  }
  if (candidate.artifactType === 'planning_document_bundle') {
    if (inlineTarget?.kind !== 'planning_document_bundle') throw new Error('整页候选缺少规划文档目标')
    const planningCenter = loadPlanningCenter(run.projectId)
    const document = planningCenter.documents?.[inlineTarget.targetId]
    if (!document) throw new Error('整页候选对应的规划文档不存在')
    const fields = Array.isArray(candidate.payload?.fields) ? candidate.payload.fields : []
    const requestedKeys = Array.isArray(applyOptions.fieldKeys) && applyOptions.fieldKeys.length
      ? new Set(applyOptions.fieldKeys.map(String))
      : new Set(fields.map((field) => field.key))
    const selected = fields.filter((field) => requestedKeys.has(field.key))
    if (!selected.length) throw new Error('请至少选择一个需要写入的字段')
    const content = { ...(document.content || {}) }
    selected.forEach((field) => { content[field.key] = String(field.candidateValue || '').trim() })
    savePlanningDocument({ projectId: run.projectId, kind: inlineTarget.targetId, content })
    return
  }
  if (candidate.artifactType === 'planning_entity_bundle') {
    if (inlineTarget?.kind !== 'planning_entity_bundle') throw new Error('整卡候选缺少规划卡片目标')
    const planningCenter = loadPlanningCenter(run.projectId)
    const entity = [...(planningCenter.characters || []), ...(planningCenter.worldElements || []), ...(planningCenter.volumes || [])]
      .find((item) => item.id === inlineTarget.targetId)
    if (!entity) throw new Error('整卡候选对应的规划卡片不存在')
    const fields = Array.isArray(candidate.payload?.fields) ? candidate.payload.fields : []
    const requestedKeys = Array.isArray(applyOptions.fieldKeys) && applyOptions.fieldKeys.length
      ? new Set(applyOptions.fieldKeys.map(String))
      : new Set(fields.map((field) => field.key))
    const selected = fields.filter((field) => requestedKeys.has(field.key))
    if (!selected.length) throw new Error('请至少选择一个需要写入的字段')
    const data = {}
    let title
    selected.forEach((field) => {
      if (field.key === 'title') title = String(field.candidateValue || '').trim()
      else data[field.key] = String(field.candidateValue || '').trim()
    })
    updatePlanningEntity({ id: entity.id, ...(title ? { title } : {}), data })
    return
  }
  if (candidate.artifactType === 'planning_chapter_bundle') {
    if (inlineTarget?.kind !== 'planning_chapter_bundle') throw new Error('整章规划候选缺少章节目标')
    const planningCenter = loadPlanningCenter(run.projectId)
    const chapter = planningCenter.chapters.find((item) => item.id === inlineTarget.targetId)
    if (!chapter) throw new Error('整章规划候选对应的章节不存在')
    const fields = Array.isArray(candidate.payload?.fields) ? candidate.payload.fields : []
    const requestedKeys = Array.isArray(applyOptions.fieldKeys) && applyOptions.fieldKeys.length
      ? new Set(applyOptions.fieldKeys.map(String))
      : new Set(fields.map((field) => field.key))
    const selected = fields.filter((field) => requestedKeys.has(field.key))
    if (!selected.length) throw new Error('请至少选择一个需要写入的章节规划字段')
    const card = { ...(chapter.card || {}) }
    let scenePlan
    selected.forEach((field) => {
      const value = String(field.candidateValue || '').trim()
      if (field.key === 'scenePlan') scenePlan = value
      else card[field.key] = value
    })
    updateChapter({ id: chapter.id, card, ...(scenePlan === undefined ? {} : { scenePlan }) })
    return
  }
  if (candidate.artifactType === 'planning_field') {
    const text = String(candidate.payload?.text || '').trim()
    if (!text || !inlineTarget) throw new Error('规划字段候选缺少目标或内容')
    const planningCenter = loadPlanningCenter(run.projectId)
    if (inlineTarget.kind === 'planning_document') {
      const document = planningCenter.documents?.[inlineTarget.targetId]
      if (!document) throw new Error('规划文档不存在')
      savePlanningDocument({
        projectId: run.projectId,
        kind: inlineTarget.targetId,
        content: { ...(document.content || {}), [inlineTarget.fieldKey]: text },
      })
      return
    }
    if (inlineTarget.kind === 'planning_entity') {
      const entity = [...(planningCenter.characters || []), ...(planningCenter.worldElements || []), ...(planningCenter.volumes || [])]
        .find((item) => item.id === inlineTarget.targetId)
      if (!entity) throw new Error('规划对象不存在')
      updatePlanningEntity(inlineTarget.fieldKey === 'title'
        ? { id: entity.id, title: text }
        : { id: entity.id, data: { [inlineTarget.fieldKey]: text } })
      return
    }
    if (inlineTarget.kind === 'chapter_field') {
      const chapter = loadWorkspaceSnapshot(run.projectId).chapters.find((item) => item.id === inlineTarget.targetId)
      if (!chapter) throw new Error('章节不存在')
      updateChapter(inlineTarget.fieldKey === 'title'
        ? { id: chapter.id, title: text }
        : { id: chapter.id, card: { ...(chapter.card || {}), [inlineTarget.fieldKey]: text } })
      return
    }
    throw new Error('规划字段候选目标不支持持久化')
  }
  if (candidate.artifactType === 'chapter_card') {
    updateChapter({
      id: run.chapterId,
      card: {
        ...candidate.payload,
        targetLength: manuscriptLengthRange(run.modelRoutes?.targetLength)?.target || 2000,
      },
    })
    return
  }
  if (candidate.artifactType === 'scene_plan') {
    updateChapter({ id: run.chapterId, scenePlan: candidate.payload })
    return
  }
  if (candidate.artifactType === 'manuscript') {
    const chapter = loadWorkspaceSnapshot(run.projectId).chapters.find((item) => item.id === run.chapterId)
    const generated = String(candidate.payload.manuscript || '')
    const offset = Math.max(0, Math.min(Number(inlineTarget?.cursorOffset ?? chapter?.manuscript?.length ?? 0), String(chapter?.manuscript || '').length))
    const manuscript = inlineIntent === 'continue'
      ? String(chapter?.manuscript || '').slice(0, offset) + generated + String(chapter?.manuscript || '').slice(offset)
      : generated
    if (chapter?.manuscript !== manuscript) {
      createRevision({ chapterId: run.chapterId, content: chapter?.manuscript || '', source: 'before-agent-accept' })
      updateChapter({ id: run.chapterId, manuscript })
    }
    return
  }
  if (candidate.artifactType === 'manuscript_selection') {
    const chapter = loadWorkspaceSnapshot(run.projectId).chapters.find((item) => item.id === run.chapterId)
    if (!chapter || !inlineTarget) throw new Error('局部重写缺少章节目标')
    const source = String(chapter.manuscript || '')
    const from = Math.max(0, Math.min(Number(inlineTarget.selectionFrom), source.length))
    const to = Math.max(from, Math.min(Number(inlineTarget.selectionTo), source.length))
    const replacement = String(candidate.payload?.text || '')
    const manuscript = source.slice(0, from) + replacement + source.slice(to)
    createRevision({ chapterId: run.chapterId, content: source, source: 'before-agent-selection-accept' })
    updateChapter({ id: run.chapterId, manuscript })
    return
  }
  if (candidate.artifactType === 'chapter_state') {
    createKnowledgeCandidate({
      projectId: run.projectId,
      chapterId: run.chapterId,
      task: 'chapter_state_extract',
      payload: candidate.payload,
      model: { provider: run.actualBackend || run.executionMode },
    })
    return
  }
  if (candidate.artifactType === 'continuity_audit') {
    createKnowledgeCandidate({
      projectId: run.projectId,
      chapterId: run.chapterId,
      task: 'continuity_audit',
      payload: candidate.payload,
      model: { provider: run.actualBackend || run.executionMode },
    })
    return
  }
  if (candidate.artifactType === 'quality_review') {
    const sourceGeneration = getGenerationRecord(inlineTarget?.sourceGenerationId || '')
    if (!sourceGeneration || sourceGeneration.projectId !== run.projectId) throw new Error('质量评审缺少有效生成记录')
    const chapter = loadWorkspaceSnapshot(run.projectId).chapters.find((item) => item.id === run.chapterId)
    const codexBackends = new Set(['codex_acp', 'codex_exec'])
    const sourceRemote = codexBackends.has(sourceGeneration.executionBackend)
      || qualityEvidenceExecution(sourceGeneration, 'remote') === 'remote'
    const reviewerRemote = codexBackends.has(candidate.evidence?.executionBackend)
    createQualityReport({
      projectId: run.projectId,
      chapterId: run.chapterId,
      generationRecordId: sourceGeneration.id,
      deterministicChecks: deterministicQualityChecks({
        task: sourceGeneration.task,
        output: sourceGeneration.output,
        chapter,
        targetLength: run.modelRoutes?.targetLength,
      }),
      modelReview: candidate.payload,
      execution: sourceRemote && reviewerRemote ? 'remote' : 'mock',
      repaired: sourceGeneration.intent === 'repair',
    })
    return
  }
  throw new Error(`候选类型暂不支持写入：${candidate.artifactType}`)
}

function initializeCodexIntegration() {
  const repository = agentRepositoryApi()
  codexGateway = new CodexAgentGateway({
    appPath: path.join(__dirname, '..'),
    resourcesPath: process.resourcesPath,
    repository,
    shouldAutoApprove: ({ actionType, projectId }) => actionType === 'model_call' && codexSessionModelApprovalProjects.has(projectId),
    onGlobalEvent: (payload) => {
      publishCodexEvent('codex:event', payload)
      if (payload.type === 'permission') {
        const approval = payload.approval || payload
        if (approval.agentRunId) updateAgentRun(approval.agentRunId, { status: 'waiting_approval' })
        if (approval.agentStepId) updateAgentStep(approval.agentStepId, { status: 'waiting_approval', approvalId: approval.id })
        publishCodexEvent('approvals:event', approval)
      }
    },
  })
  agentRuntime = new AgentRuntime({
    repository,
    codexGateway,
    createMirror: async (run) => mirrorForRun(run),
    refreshMirror: async (run) => mirrorForRun(run),
    prepareCodexPrompt,
    completeCodexGeneration,
    persistQualityReview: async ({ run, sourceCandidate, result, review }) => {
      const sourceGenerationId = sourceCandidate.evidence?.generationRecordId || ''
      const source = getGenerationRecord(sourceGenerationId)
      if (!source) throw new Error('Codex 质量评审缺少正文生成记录')
      const workspace = loadWorkspaceSnapshot(run.projectId)
      const chapter = workspace.chapters.find((item) => item.id === run.chapterId) || workspace.chapters[0]
      const deterministicChecks = deterministicQualityChecks({
        task: 'chapter',
        output: sourceCandidate.payload?.manuscript || source.output,
        chapter,
        targetLength: run.modelRoutes?.targetLength,
      })
      const sourceBackend = source.executionBackend || sourceCandidate.evidence?.executionBackend || ''
      const reviewerBackend = result.backend || result.execution || ''
      const realCodexBackends = new Set(['codex_acp', 'codex_exec'])
      const report = createQualityReport({
        projectId: run.projectId,
        chapterId: run.chapterId,
        generationRecordId: source.id,
        reviewerProfileId: '',
        deterministicChecks,
        modelReview: review,
        execution: realCodexBackends.has(sourceBackend) && realCodexBackends.has(reviewerBackend) ? 'remote' : 'mock',
        repaired: source.intent === 'repair',
      })
      return report.id
    },
    runAppModel: runAgentAppModel,
    runPreflight: async ({ run }) => run.executionMode === 'codex'
      ? buildReadinessReport({
          project: loadWorkspaceSnapshot(run.projectId).project,
          chapter: loadWorkspaceSnapshot(run.projectId).chapters.find((item) => item.id === run.chapterId),
          planningCenter: loadPlanningCenter(run.projectId),
          knowledgeCenter: loadKnowledgeCenter(run.projectId),
          intent: 'draft',
        })
      : qualityPreflight({ projectId: run.projectId, chapterId: run.chapterId, intent: 'draft' }),
    applyCandidate: applyAgentCandidate,
    onCandidateCreated: async ({ run, step, candidate }) => {
      if (candidate.artifactType !== 'story_change_set') return
      const changeSetId = step.input?.target?.targetId || ''
      attachStoryChangeAnalysis({ changeSetId, analysis: candidate.payload, agentRunId: run.id })
    },
    currentSourceDigest: async (run) => mirrorForRun(run).sourceDigest,
    onEvent: (payload) => publishCodexEvent('agent:event', payload),
  })
}

function runtimeInfo() {
  const codex = codexGateway?.inspectRuntime?.() || inspectCodexRuntime({
    appPath: path.join(__dirname, '..'),
    resourcesPath: process.resourcesPath,
  })
  return {
    mode: goServiceStatus === 'ready' ? 'go-service' : 'embedded',
    goServiceStatus,
    database: getDatabaseInfo(),
    editor: 'codemirror-6',
    generation: {
      streaming: true,
      cancellation: true,
      fallback: 'embedded',
    },
    codex,
  }
}

function publishRuntimeInfo() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('runtime:changed', runtimeInfo())
  }
}

function setGoServiceStatus(status) {
  goServiceStatus = status
  publishRuntimeInfo()
}

function serviceBinaryCandidates() {
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const arch = process.arch
  const fileName = process.platform === 'win32' ? 'novel-studio-service.exe' : 'novel-studio-service'
  return [
    process.env.NOVEL_STUDIO_GO_SERVICE,
    path.join(process.resourcesPath, 'novel-studio-service', `${platform}-${arch}`, fileName),
    path.join(__dirname, '..', 'resources', 'novel-studio-service', `${platform}-${arch}`, fileName),
  ].filter(Boolean)
}

function startGoService() {
  const candidate = serviceBinaryCandidates().find((filePath) => fs.existsSync(filePath))
  if (!candidate) {
    setGoServiceStatus('embedded-fallback')
    return
  }

  try {
    const dataDirectory = path.join(app.getPath('userData'), 'service-data')
    fs.mkdirSync(dataDirectory, { recursive: true })
    goServiceAuthToken = randomBytes(32).toString('base64url')
    goServiceProcess = spawn(candidate, ['--port', '0', '--data-dir', dataDirectory], {
      cwd: path.dirname(candidate),
      env: { ...process.env, NOVEL_STUDIO_SERVICE_TOKEN: goServiceAuthToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    setGoServiceStatus('starting')
    let stdoutBuffer = ''
    goServiceProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const message = line.trim()
        if (message) console.log(`[GoService] ${message}`)
        const ready = message.match(/novel-studio-service ready port=(\d+)/)
        if (ready) {
          goServiceBaseUrl = `http://127.0.0.1:${ready[1]}`
          setGoServiceStatus('ready')
        }
      }
    })
    goServiceProcess.stderr.on('data', (chunk) => console.error(`[GoService] ${String(chunk).trim()}`))
    goServiceProcess.on('error', (error) => {
      goServiceBaseUrl = ''
      setGoServiceStatus('error')
      console.error('[GoService] failed to start', error)
    })
    goServiceProcess.on('exit', () => {
      goServiceProcess = null
      goServiceBaseUrl = ''
      if (goServiceStatus !== 'stopping') setGoServiceStatus('stopped')
    })
  } catch (error) {
    goServiceBaseUrl = ''
    setGoServiceStatus('error')
    console.error('[GoService] spawn error', error)
  }
}

function stopGoService() {
  void modelGateway.cancelAll()
  if (!goServiceProcess) return
  setGoServiceStatus('stopping')
  goServiceProcess.kill()
  goServiceProcess = null
  goServiceBaseUrl = ''
}

function generationOutput(result = {}) {
  if (typeof result.manuscript === 'string') return result.manuscript
  if (result.scenePlan && typeof result.scenePlan === 'object') return JSON.stringify(result.scenePlan)
  if (typeof result.text === 'string') return result.text
  if (result.card && typeof result.card === 'object') return JSON.stringify(result.card)
  if (result.stateSnapshot && typeof result.stateSnapshot === 'object') return JSON.stringify(result.stateSnapshot)
  if (result.audit && typeof result.audit === 'object') return JSON.stringify(result.audit)
  if (result.review && typeof result.review === 'object') return JSON.stringify(result.review)
  return ''
}

function generationRequestSnapshot(payload = {}) {
  const planning = payload.planning && typeof payload.planning === 'object'
    ? JSON.parse(JSON.stringify(payload.planning))
    : undefined
  return Object.fromEntries(Object.entries({
    task: String(payload.task || ''),
    projectId: String(payload.projectId || ''),
    chapterId: String(payload.chapterId || ''),
    instruction: String(payload.instruction || ''),
    modelProfileId: String(payload.modelProfileId || ''),
    selectedText: String(payload.selectedText || ''),
    rewriteMode: String(payload.rewriteMode || ''),
    intent: String(payload.intent || ''),
    cursorOffset: Number.isFinite(Number(payload.cursorOffset)) ? Number(payload.cursorOffset) : undefined,
    promptProfile: String(payload.promptProfile || ''),
    parentGenerationId: String(payload.parentGenerationId || ''),
    sourceText: String(payload.sourceText || ''),
    repairIssues: Array.isArray(payload.repairIssues) ? JSON.parse(JSON.stringify(payload.repairIssues)) : undefined,
    deterministicChecks: Array.isArray(payload.deterministicChecks) ? JSON.parse(JSON.stringify(payload.deterministicChecks)) : undefined,
    sourceGeneration: payload.sourceGeneration && typeof payload.sourceGeneration === 'object'
      ? JSON.parse(JSON.stringify(payload.sourceGeneration))
      : undefined,
    evaluationCase: payload.evaluationCase && typeof payload.evaluationCase === 'object'
      ? JSON.parse(JSON.stringify(payload.evaluationCase))
      : undefined,
    planning,
  }).filter(([, value]) => value !== undefined && value !== ''))
}

function compactGenerationEvent(event = {}) {
  return Object.fromEntries(Object.entries({
    type: event.type,
    attempt: event.attempt,
    nextAttempt: event.nextAttempt,
    maxAttempts: event.maxAttempts,
    delayMs: event.delayMs,
    gateway: event.gateway,
    error: event.error,
    createdAt: event.createdAt,
  }).filter(([, value]) => value !== undefined && value !== ''))
}

async function runGenerationTask(event, payload = {}, { retryOfId = '' } = {}) {
  const taskId = String(payload.taskId || '')
  if (!taskId) throw new Error('生成任务缺少 taskId')
  const workspace = loadWorkspaceSnapshot(payload.projectId)
  const chapter = workspace.chapters.find((item) => item.id === payload.chapterId) || workspace.chapters[0]
  const planningCenter = workspace.project ? loadPlanningCenter(workspace.project.id) : null
  const knowledgeCenter = workspace.project ? loadKnowledgeCenter(workspace.project.id) : null
  const chapterScopedTasks = new Set(['chapter', 'chapter_card', 'scene_plan', 'rewrite', 'chapter_state_extract', 'continuity_audit', 'quality_review'])
  const promptChapterId = payload.chapterId || (chapterScopedTasks.has(payload.task) ? chapter?.id : '')
  const promptVolumeId = payload.planning?.scopeType === 'volume' ? payload.planning.scopeId : ''
  const promptContext = workspace.project ? resolvePromptContext({
    projectId: workspace.project.id,
    chapterId: promptChapterId,
    volumeId: promptVolumeId,
    task: payload.task,
  }) : null
  const longContext = workspace.project ? buildGenerationContext({
    projectId: workspace.project.id,
    chapterId: chapter?.id,
    instruction: payload.instruction,
    styleText: promptContext?.style?.mergedText,
    task: payload.task,
  }) : null
  const modelSettings = loadModelSettings()
  const routedModelProfileId = modelSettings.routes[payload.task]
    || (payload.task === 'quality_review' ? modelSettings.routes.chapter : '')
    || 'local-default'
  const requestedProfile = modelSettings.profiles.find((profile) => profile.id === payload.modelProfileId)
  const modelProfileId = requestedProfile?.id || routedModelProfileId
  const modelProfile = requestedProfile || modelSettings.profiles.find((profile) => profile.id === routedModelProfileId)
  const apiKey = getModelApiKey(modelProfileId)
  const allowedIntents = new Set(['draft', 'continue', 'rewrite', 'repair', 'analysis'])
  const defaultIntent = payload.task === 'chapter'
    ? (chapter?.manuscript?.trim() ? 'rewrite' : 'draft')
    : payload.task === 'quality_review' ? 'analysis' : 'draft'
  const intent = allowedIntents.has(payload.intent) ? payload.intent : defaultIntent
  const manuscript = String(chapter?.manuscript || '')
  const cursorOffset = Math.max(0, Math.min(Number(payload.cursorOffset ?? manuscript.length), manuscript.length))
  const projectDraftContext = payload.planning?.targetType === 'renderer_draft'
    && payload.projectDraftContext
    && typeof payload.projectDraftContext === 'object'
    ? sanitizeProjectDraftContext(payload.projectDraftContext)
    : null
  const effectiveProject = projectDraftContext
    ? projectForInlineTarget(workspace.project, { kind: 'project_brief_draft', draftContext: projectDraftContext })
    : workspace.project
  const effectiveLongContext = projectDraftContext ? {
    ...longContext,
    text: [
      '【本次待保存项目资料】',
      `项目名称：${projectDraftContext.title || workspace.project.title}`,
      `题材：${projectDraftContext.genre || '未指定'}`,
      `一句话想法：${projectDraftContext.idea || '尚未填写'}`,
      `项目文风：${projectDraftContext.style || '尚未填写'}`,
      '待保存题材优先于正式项目旧题材；只为当前表单字段生成候选。',
    ].join('\n'),
  } : longContext
  const generationInput = {
    ...payload,
    intent,
    cursorOffset,
    manuscriptPrefix: intent === 'continue' ? manuscript.slice(0, cursorOffset) : '',
    manuscriptSuffix: intent === 'continue' ? manuscript.slice(cursorOffset) : '',
    sourceText: payload.sourceText || (intent === 'rewrite' ? manuscript : ''),
    project: effectiveProject,
    chapter,
    planningCenter,
    knowledgeCenter,
    longContext: effectiveLongContext,
    promptContext,
    modelProfile,
    apiKey,
  }
  const compiledPrompt = compilePrompt(generationInput)
  const generationRecord = startGenerationRecord({
    taskId,
    projectId: workspace.project.id,
    chapterId: promptChapterId,
    task: payload.task,
    modelProfileId: modelProfile?.id,
    model: modelProfile ? { id: modelProfile.id, provider: modelProfile.provider, name: modelProfile.name, model: modelProfile.model } : {},
    promptSnapshot: compiledPrompt.snapshot,
    request: generationRequestSnapshot({ ...generationInput, projectId: workspace.project.id, chapterId: promptChapterId, modelProfileId: modelProfile?.id || '' }),
    retryOfId,
    intent,
    parentGenerationId: payload.parentGenerationId || null,
    executionBackend: payload.executionBackend || '',
    agentRunId: payload.agentRunId || null,
    agentStepId: payload.agentStepId || null,
  })
  let generationParameters = {}
  const recordEvents = []
  try {
    const result = await modelGateway.generate(
      { ...generationInput, compiledPrompt },
      {
        taskId,
        onEvent: (generationEvent) => {
          if (generationEvent.type !== 'delta' && recordEvents.length < 60) recordEvents.push(compactGenerationEvent(generationEvent))
          if (event?.sender && !event.sender.isDestroyed()) event.sender.send('generation:event', generationEvent)
        },
        onPrepared: (prepared) => { generationParameters = prepared.parameters },
      },
    )
    if (recordEvents.length < 60) recordEvents.push({ type: 'execution', execution: result.execution, gateway: result.gateway, createdAt: new Date().toISOString() })
    finishGenerationRecord({
      id: generationRecord.id,
      status: 'completed',
      parameters: generationParameters,
      output: generationOutput(result),
      attemptCount: result.attemptCount || 1,
      events: recordEvents,
    })
    return { ...result, generationRecordId: generationRecord.id, intent, cursorOffset }
  } catch (error) {
    const attemptCount = Math.max(1, ...recordEvents.map((entry) => Number(entry.attempt || 1)))
    if (error?.name === 'GenerationCancelledError') {
      finishGenerationRecord({ id: generationRecord.id, status: 'cancelled', parameters: generationParameters, attemptCount, events: recordEvents })
      return { cancelled: true, taskId }
    }
    finishGenerationRecord({
      id: generationRecord.id,
      status: 'failed',
      parameters: generationParameters,
      output: error?.rawOutput || '',
      error: error?.message || String(error),
      attemptCount,
      events: recordEvents,
    })
    error.generationRecordId = generationRecord.id
    throw error
  }
}

function qualityPreflight(payload = {}) {
  const workspace = loadWorkspaceSnapshot(payload.projectId)
  const chapter = workspace.chapters.find((item) => item.id === payload.chapterId) || workspace.chapters[0]
  if (!chapter) throw new Error('章节不存在')
  const report = buildReadinessReport({
    project: workspace.project,
    chapter,
    planningCenter: loadPlanningCenter(workspace.project.id),
    knowledgeCenter: loadKnowledgeCenter(workspace.project.id),
    intent: payload.intent || (chapter.manuscript?.trim() ? 'rewrite' : 'draft'),
    cursorOffset: payload.cursorOffset,
  })
  const settings = loadModelSettings()
  const profileId = payload.modelProfileId || settings.routes.chapter || ''
  const profile = settings.profiles.find((item) => item.id === profileId && item.enabled)
  const needsKey = profile && !['local', 'mock'].includes(profile.provider)
  const modelReady = Boolean(profile?.baseUrl && profile?.model && (!needsKey || profile.apiKeyConfigured))
  if (!modelReady) {
    const modelError = {
      id: 'technical-model-config', label: '正文生成模型配置完整', passed: false, critical: true, severity: 'high',
      detail: '请在模型设置中完成正文模型的 Base URL、模型名称和所需密钥。',
    }
    report.checks.unshift(modelError)
    report.technicalErrors = [modelError, ...(report.technicalErrors || [])]
    report.blocked = true
    report.criticalPassed = false
    report.missingCount += 1
    report.summary = `发现 ${report.missingCount} 项缺失或风险，其中 ${report.technicalErrors.length} 项技术错误需要先处理。`
  }
  return report
}

async function reviewGenerationQuality(event, payload = {}) {
  const source = getGenerationRecord(payload.generationRecordId)
  if (!source || source.status !== 'completed') throw new Error('请选择已完成的生成记录进行评审')
  if (!['chapter', 'chapter_card', 'scene_plan'].includes(source.task)) throw new Error('当前生成类型暂不进入创作质量评审')
  const existingReport = getQualityReportByGeneration(source.id)
  if (existingReport) return existingReport
  const workspace = loadWorkspaceSnapshot(source.projectId)
  const chapter = workspace.chapters.find((item) => item.id === source.chapterId) || workspace.chapters[0]
  const deterministicChecks = deterministicQualityChecks({ task: source.task, output: source.output, chapter })
  const result = await runGenerationTask(event, {
    taskId: payload.taskId || `quality-${Date.now()}`,
    task: 'quality_review',
    intent: 'analysis',
    projectId: source.projectId,
    chapterId: source.chapterId,
    modelProfileId: payload.reviewerProfileId || '',
    parentGenerationId: source.id,
    deterministicChecks,
    sourceGeneration: {
      id: source.id,
      task: source.task,
      intent: source.intent,
      output: source.output,
      promptSnapshot: source.promptSnapshot,
    },
  })
  if (result.cancelled) return result
  const report = createQualityReport({
    projectId: source.projectId,
    chapterId: source.chapterId,
    generationRecordId: source.id,
    reviewerProfileId: result.model?.profileId || payload.reviewerProfileId || '',
    deterministicChecks,
    modelReview: result.review,
    execution: qualityEvidenceExecution(source, result.execution),
    repaired: source.intent === 'repair',
  })
  return { ...report, reviewerGenerationRecordId: result.generationRecordId }
}

async function repairQualityIssues(event, payload = {}) {
  const report = getQualityReport(payload.reportId)
  if (!report) throw new Error('质量报告不存在')
  const selectedIds = new Set(Array.isArray(payload.issueIds) ? payload.issueIds : [])
  const repairIssues = report.modelReview.issues.filter((issue) => selectedIds.has(issue.id))
  if (!repairIssues.length) throw new Error('请至少选择一个需要修复的问题')
  const source = getGenerationRecord(report.generationRecordId)
  if (!source || source.status !== 'completed') throw new Error('质量报告对应的候选已经不可用')
  const instruction = repairIssues.map((issue) => `${issue.category}：${issue.repairInstruction || issue.criterion}`).join('\n')
  return runGenerationTask(event, {
    taskId: payload.taskId || `repair-${Date.now()}`,
    task: source.task,
    intent: 'repair',
    projectId: source.projectId,
    chapterId: source.chapterId,
    modelProfileId: payload.modelProfileId || source.modelProfileId,
    parentGenerationId: source.id,
    sourceText: source.output,
    repairIssues,
    instruction: `根据已选质量问题定向修复：\n${instruction}`,
  })
}

function publishBenchmarkEvent(event, payload) {
  if (event?.sender && !event.sender.isDestroyed()) event.sender.send('benchmark:event', payload)
}

function promptEvalSuite() {
  const candidates = [
    path.join(app.getAppPath(), 'research', 'prompt-eval-cases.json'),
    path.join(__dirname, '..', 'research', 'prompt-eval-cases.json'),
  ]
  const filePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!filePath) throw new Error('提示词评测集文件缺失')
  return validatePromptEvalSuite(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

function benchmarkCancelledError() {
  return Object.assign(new Error('基准运行已取消'), { name: 'GenerationCancelledError' })
}

async function waitForBenchmarkControl(runId, event) {
  const control = activeBenchmarkControls.get(runId)
  if (!control) return
  if (control.cancelled) throw benchmarkCancelledError()
  let published = false
  while (control.paused) {
    if (!published) {
      publishBenchmarkEvent(event, { runId, type: 'paused', run: getBenchmarkRun(runId) })
      published = true
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (control.cancelled) throw benchmarkCancelledError()
  }
}

function promptEvalGenerationPayload(run, definition) {
  const chapter = loadWorkspaceSnapshot(run.projectId).chapters[0]
  const input = definition.input || {}
  const requiredScenes = (input.requiredScenes || ['评测场景']).map((title, index) => ({
    id: `S${index + 1}`,
    title,
    goal: `完成“${title}”中的具体目标`,
    result: index === (input.requiredScenes || ['评测场景']).length - 1 ? '停在评测边界' : '状态变化并进入下一场',
  }))
  updateChapter({
    id: chapter.id,
    manuscript: input.textFact || input.draft || '',
    card: {
      goal: definition.title,
      protagonistGoal: input.sceneGoal || '完成当前案例指定的行动目标',
      resistance: input.constraint || input.rule || input.openCost || '已确认边界限制当前行动',
      turningPoint: '由人物行动或新信息触发局势变化',
      payoff: '取得当前案例允许的进展',
      cost: input.openCost || '行动压缩后续选择',
      ending: input.ending || '严格停在当前评测案例指定的边界',
      requiredScenes,
    },
  })
  const instruction = [
    `这是固定提示词回归案例“${definition.title}”。`,
    `评测输入：${JSON.stringify(input)}`,
    definition.task === 'continuity_audit' && input.canon
      ? `来源声明：input.canon 是已确认设定，位置为“固定评测输入.canon”；input.draft 是当前正文，位置为“第 1 章评测正文”。`
      : '',
    '严格执行输入中的事实和边界，不解释评测过程。',
  ].filter(Boolean).join('\n')
  if (definition.task === 'rewrite') return {
    runtimeTask: 'rewrite',
    payload: { chapterId: chapter.id, modelProfileId: run.generatorProfileId, selectedText: input.selectedText || '', rewriteMode: input.mode || 'general', instruction },
  }
  if (definition.task === 'voice_audit') return {
    runtimeTask: 'planning_field',
    payload: {
      chapterId: chapter.id,
      modelProfileId: run.generatorProfileId,
      promptProfile: 'generic',
      planning: { scopeType: 'audit', fieldKey: 'voiceAudit', fieldLabel: '人物声音审计', targetLabel: '评测对白', currentValue: '', nearbyContext: JSON.stringify(input), boundaries: '审计必须从多维语言习惯判断，不依赖添加口头禅。' },
      instruction: `${instruction}\n输出一份具体、可执行的人物声音区分审计。`,
    },
  }
  return {
    runtimeTask: definition.task,
    payload: {
      chapterId: chapter.id,
      modelProfileId: run.generatorProfileId,
      intent: definition.task === 'chapter' ? 'draft' : 'analysis',
      instruction,
    },
  }
}

async function runBenchmark(event, payload = {}) {
  const fixture = payload.fixtureId === PROMPT_EVAL_BENCHMARK.id ? PROMPT_EVAL_BENCHMARK : URBAN_SUSPENSE_BENCHMARK
  const run = createBenchmarkRun({
    generatorProfileId: payload.generatorProfileId,
    reviewerProfileId: payload.reviewerProfileId || payload.generatorProfileId,
    fixture,
  })
  const totalSteps = fixture.id === PROMPT_EVAL_BENCHMARK.id ? promptEvalSuite().cases.length * 2 : 22
  activeBenchmarkControls.set(run.id, { paused: false, cancelled: false })
  updateBenchmarkRun(run.id, { status: 'running', summary: { completedSteps: 0, totalSteps, paused: false } })
  publishBenchmarkEvent(event, { runId: run.id, type: 'started', run: getBenchmarkRun(run.id) })
  let completedSteps = 0

  const executeStep = async (stepKey, task, generationPayload, onComplete = null) => {
    await waitForBenchmarkControl(run.id, event)
    const step = startBenchmarkStep({ runId: run.id, stepKey, task, input: generationPayload })
    const taskId = `benchmark-${run.id}-${step.position}`
    activeBenchmarkTasks.set(run.id, taskId)
    publishBenchmarkEvent(event, { runId: run.id, type: 'step-started', step: { ...step, taskId } })
    try {
      if (activeBenchmarkControls.get(run.id)?.cancelled) throw benchmarkCancelledError()
      const execution = await runWithStructuredOutputRetry({
        task,
        payload: generationPayload,
        // Keep one retry for transport/JSON truncation and one for schema-semantic repair.
        // Some providers can return an empty JSON-mode response before a valid but
        // contract-incomplete object, so a single shared retry is insufficient.
        maxRetries: 2,
        runAttempt: ({ attempt, payload: attemptPayload, retryOfId }) => {
          const attemptTaskId = attempt === 1 ? taskId : `${taskId}-structured-retry-${attempt}`
          activeBenchmarkTasks.set(run.id, attemptTaskId)
          return runGenerationTask(event, {
            ...attemptPayload,
            taskId: attemptTaskId,
            task,
            projectId: run.projectId,
          }, { retryOfId })
        },
        onRetry: ({ error, nextAttempt, retryOfId }) => {
          publishBenchmarkEvent(event, {
            runId: run.id,
            type: 'step-retrying',
            stepId: step.id,
            task,
            nextAttempt,
            retryOfId,
            error: error.message,
          })
        },
      })
      const result = execution.result
      if (result.cancelled) throw Object.assign(new Error('基准运行已取消'), { name: 'GenerationCancelledError' })
      if (onComplete) await onComplete(result)
      const finished = finishBenchmarkStep(step.id, {
        generationRecordId: result.generationRecordId,
        output: execution.retryCount ? {
          ...result,
          structuredRetry: { count: execution.retryCount, retryOfId: execution.retryOfId },
        } : result,
      })
      completedSteps += 1
      publishBenchmarkEvent(event, { runId: run.id, type: 'step-completed', step: finished, completedSteps })
      return result
    } catch (error) {
      finishBenchmarkStep(step.id, { status: error?.name === 'GenerationCancelledError' ? 'cancelled' : 'failed', error: error.message })
      throw error
    } finally {
      activeBenchmarkTasks.delete(run.id)
    }
  }

  try {
    if (fixture.id === PROMPT_EVAL_BENCHMARK.id) {
      const results = []
      for (const definition of promptEvalSuite().cases) {
        const prepared = promptEvalGenerationPayload(run, definition)
        const generated = await executeStep(`eval-${definition.id}-generate`, prepared.runtimeTask, prepared.payload)
        const output = generated.manuscript || generated.text || JSON.stringify(generated.card || generated.scenePlan || generated.stateSnapshot || generated.audit || {})
        let scored = null
        await executeStep(`eval-${definition.id}-review`, 'quality_review', {
          chapterId: prepared.payload.chapterId,
          modelProfileId: run.reviewerProfileId,
          intent: 'analysis',
          parentGenerationId: generated.generationRecordId,
          evaluationCase: { id: definition.id, title: definition.title, assertions: definition.assertions },
          sourceGeneration: { id: generated.generationRecordId, task: definition.task, intent: 'analysis', output },
        }, (review) => {
          scored = scorePromptEvalCase(definition, review.review?.assertionScores, {
            execution: generated.execution === 'remote' && review.execution === 'remote' ? 'remote' : 'mock',
            assertionEvidence: review.review?.assertionEvidence,
            requireEvidence: true,
            blockingIssues: review.review?.issues,
          })
          review.promptEvalScore = scored
        })
        results.push(scored)
      }
      const aggregate = aggregatePromptEvalResults(results)
      const summary = {
        completedSteps,
        totalSteps,
        results,
        modelAverage: aggregate.average,
        automaticPassed: aggregate.passed,
        finalPassed: aggregate.passed,
        verdict: aggregate.verdict,
        execution: aggregate.execution,
      }
      const completed = updateBenchmarkRun(run.id, { status: 'completed', summary })
      publishBenchmarkEvent(event, { runId: run.id, type: 'completed', run: completed })
      return completed
    }

    for (const field of URBAN_SUSPENSE_BENCHMARK.planningFields) {
      const center = loadPlanningCenter(run.projectId)
      let targetType = 'document'
      let targetId = field.scopeType
      let currentValue = center.documents[field.scopeType]?.content?.[field.fieldKey] || ''
      if (field.entityKind === 'character') {
        targetType = 'entity'
        targetId = center.characters[0].id
        currentValue = center.characters[0].data[field.fieldKey] || ''
      }
      const planning = {
        ...field,
        targetType,
        targetId,
        targetLabel: field.entityKind === 'character' ? '林砚' : URBAN_SUSPENSE_BENCHMARK.project.title,
        sectionLabel: field.scopeType,
        currentValue,
        nearbyContext: URBAN_SUSPENSE_BENCHMARK.project.idea,
        boundaries: '医生只是嫌疑人；第一章尚未取得钥匙，第二章取得但不使用，第三章午夜首次使用且只使用一次；第三章停在门后第一次传出自己的声音和一个即时反应，不重复声音，不继续调查或解释来源。',
      }
      await executeStep(`planning-${field.fieldKey}`, 'planning_field', {
        modelProfileId: run.generatorProfileId,
        planning,
        promptProfile: planningPromptProfile(planning),
      }, async (result) => {
        if (targetType === 'entity') {
          const entity = loadPlanningCenter(run.projectId).characters.find((item) => item.id === targetId)
          updatePlanningEntity({ id: targetId, data: { ...entity.data, [field.fieldKey]: result.text } })
        } else {
          const document = loadPlanningCenter(run.projectId).documents[targetId]
          savePlanningDocument({ projectId: run.projectId, kind: targetId, content: { ...document.content, [field.fieldKey]: result.text } })
        }
      })
    }

    const chapters = loadWorkspaceSnapshot(run.projectId).chapters
    const draftGenerations = []
    for (const chapter of chapters) {
      await executeStep(`chapter-${chapter.chapter_no}-card`, 'chapter_card', {
        chapterId: chapter.id,
        modelProfileId: run.generatorProfileId,
      }, (result) => updateChapter({ id: chapter.id, card: result.card }))
      await executeStep(`chapter-${chapter.chapter_no}-scenes`, 'scene_plan', {
        chapterId: chapter.id,
        modelProfileId: run.generatorProfileId,
      }, (result) => updateChapter({ id: chapter.id, scenePlan: result.scenePlan }))
      const manuscript = await executeStep(`chapter-${chapter.chapter_no}-draft`, 'chapter', {
        chapterId: chapter.id,
        intent: 'draft',
        modelProfileId: run.generatorProfileId,
      }, (result) => updateChapter({ id: chapter.id, manuscript: result.manuscript }))
      draftGenerations.push(manuscript)

      await waitForBenchmarkControl(run.id, event)
      const qualityStep = startBenchmarkStep({ runId: run.id, stepKey: `chapter-${chapter.chapter_no}-quality`, task: 'quality_review', input: { generationRecordId: manuscript.generationRecordId } })
      const qualityTaskId = `benchmark-${run.id}-quality-${chapter.chapter_no}`
      activeBenchmarkTasks.set(run.id, qualityTaskId)
      publishBenchmarkEvent(event, { runId: run.id, type: 'step-started', step: { ...qualityStep, taskId: qualityTaskId } })
      try {
        const report = await reviewGenerationQuality(event, {
          generationRecordId: manuscript.generationRecordId,
          reviewerProfileId: run.reviewerProfileId,
          taskId: qualityTaskId,
        })
        if (report.cancelled) throw benchmarkCancelledError()
        const finished = finishBenchmarkStep(qualityStep.id, {
          generationRecordId: report.reviewerGenerationRecordId,
          qualityReportId: report.id,
          output: report,
        })
        completedSteps += 1
        publishBenchmarkEvent(event, { runId: run.id, type: 'step-completed', step: finished, completedSteps })
      } catch (error) {
        finishBenchmarkStep(qualityStep.id, { status: error?.name === 'GenerationCancelledError' ? 'cancelled' : 'failed', error: error.message })
        throw error
      } finally {
        activeBenchmarkTasks.delete(run.id)
      }

      await executeStep(`chapter-${chapter.chapter_no}-state`, 'chapter_state_extract', {
        chapterId: chapter.id,
        modelProfileId: run.reviewerProfileId,
      }, (result) => {
        const candidate = createKnowledgeCandidate({
          projectId: run.projectId,
          chapterId: chapter.id,
          task: 'chapter_state_extract',
          payload: result.stateSnapshot,
          model: result.model,
        })
        resolveKnowledgeCandidate({ id: candidate.id, status: 'accepted' })
      })
    }

    const completedWorkspace = loadWorkspaceSnapshot(run.projectId)
    const stateSnapshots = loadKnowledgeCenter(run.projectId).stateSnapshots
    const completedPlanning = loadPlanningCenter(run.projectId)
    const deterministicCrossEvaluation = urbanSuspenseDeterministicEvaluation({
      chapters: completedWorkspace.chapters,
      stateSnapshots,
      hardRules: completedPlanning.documents?.world?.content?.hardRules || '',
    })
    const crossChapterSource = [
      ...completedWorkspace.chapters.map((chapter) => `【第 ${chapter.chapter_no} 章《${chapter.title}》正文】\n${chapter.manuscript}`),
      ...stateSnapshots.sort((left, right) => left.chapterNo - right.chapterNo)
        .map((snapshot) => `【第 ${snapshot.chapterNo} 章章后状态】\n${JSON.stringify(snapshot.payload)}`),
    ].join('\n\n')
    let crossChapterScore = null
    const lastDraft = draftGenerations.at(-1)
    await executeStep('cross-chapter-quality', 'quality_review', {
      chapterId: completedWorkspace.chapters.at(-1)?.id,
      modelProfileId: run.reviewerProfileId,
      intent: 'analysis',
      parentGenerationId: lastDraft?.generationRecordId || '',
      evaluationCase: {
        id: URBAN_SUSPENSE_BENCHMARK.id,
        title: '都市悬疑三章跨章连续性与边界',
        assertions: URBAN_SUSPENSE_BENCHMARK.evaluationAssertions,
      },
      sourceGeneration: {
        id: lastDraft?.generationRecordId || '',
        task: 'chapter',
        intent: 'analysis',
        output: crossChapterSource,
      },
    }, (review) => {
      crossChapterScore = scorePromptEvalCase(
        { id: URBAN_SUSPENSE_BENCHMARK.id, assertions: URBAN_SUSPENSE_BENCHMARK.evaluationAssertions },
        review.review?.assertionScores,
        {
          execution: review.execution,
          assertionEvidence: review.review?.assertionEvidence,
          requireEvidence: true,
          scoreOverrides: deterministicCrossEvaluation.scores,
          blockingIssues: review.review?.issues,
        },
      )
      review.promptEvalScore = crossChapterScore
      review.deterministicEvaluation = deterministicCrossEvaluation
    })

    const reports = listQualityReports({ projectId: run.projectId })
    const remote = reports.length === 3 && reports.every((report) => report.execution === 'remote')
    const automaticPassed = remote && reports.every((report) => report.aggregate.automaticPassed) && Boolean(crossChapterScore?.passed)
    const summary = {
      completedSteps,
      totalSteps,
      chapterCount: 3,
      reportIds: reports.map((report) => report.id),
      modelAverage: reports.length ? Number((reports.reduce((sum, report) => sum + Number(report.aggregate.modelAverage || 0), 0) / reports.length).toFixed(2)) : 0,
      crossChapterScore,
      deterministicCrossChecks: deterministicCrossEvaluation.checks,
      automaticPassed,
      finalPassed: false,
      verdict: automaticPassed ? 'awaiting_human_review' : 'fail',
      execution: remote ? 'remote' : 'mock',
    }
    const completed = updateBenchmarkRun(run.id, { status: 'completed', summary })
    publishBenchmarkEvent(event, { runId: run.id, type: 'completed', run: completed })
    return completed
  } catch (error) {
    const cancelled = error?.name === 'GenerationCancelledError'
    const failed = updateBenchmarkRun(run.id, { status: cancelled ? 'cancelled' : 'failed', summary: { completedSteps, totalSteps, paused: false }, error: error.message })
    publishBenchmarkEvent(event, { runId: run.id, type: cancelled ? 'cancelled' : 'failed', run: failed, error: error.message })
    if (cancelled) return failed
    throw error
  } finally {
    activeBenchmarkControls.delete(run.id)
    activeBenchmarkTasks.delete(run.id)
  }
}

function compilePromptPreview(payload = {}) {
  const workspace = loadWorkspace(payload.projectId)
  const chapter = workspace.chapters.find((item) => item.id === payload.chapterId) || workspace.chapters[0]
  const planningCenter = loadPlanningCenter(workspace.project.id)
  const knowledgeCenter = loadKnowledgeCenter(workspace.project.id)
  const promptContext = resolvePromptContext({
    projectId: workspace.project.id,
    chapterId: payload.chapterId || chapter?.id || '',
    volumeId: payload.volumeId || '',
    task: payload.task || 'chapter',
  })
  const longContext = buildGenerationContext({
    projectId: workspace.project.id,
    chapterId: chapter?.id,
    instruction: payload.instruction,
    styleText: promptContext.style?.mergedText,
    task: payload.task || 'chapter',
  })
  return compilePrompt({
    ...payload,
    project: workspace.project,
    chapter,
    planningCenter,
    knowledgeCenter,
    promptContext,
    longContext,
  })
}

const PROJECT_FILE_FORMATS = {
  txt: { extension: 'txt', label: '纯文本', filters: [{ name: '纯文本', extensions: ['txt'] }] },
  markdown: { extension: 'md', label: 'Markdown', filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] },
  docx: { extension: 'docx', label: 'Word 文档', filters: [{ name: 'Word 文档', extensions: ['docx'] }] },
  json: { extension: 'novelstudio.json', label: 'Novel Studio 项目备份', filters: [{ name: 'Novel Studio 项目备份', extensions: ['json'] }] },
}

function safeFileName(value = '未命名小说') {
  return String(value).trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[.\s]+$/g, '').slice(0, 80) || '未命名小说'
}

function dialogOptions(method, options) {
  return mainWindow && !mainWindow.isDestroyed() ? dialog[method](mainWindow, options) : dialog[method](options)
}

async function exportProjectFile(payload = {}) {
  const format = String(payload.format || '').toLowerCase()
  const formatInfo = PROJECT_FILE_FORMATS[format]
  if (!formatInfo) throw new Error(`不支持的导出格式：${format}`)
  const workspace = loadWorkspace(payload.projectId)
  const content = format === 'json'
    ? `${JSON.stringify(exportProjectBackup(workspace.project.id), null, 2)}\n`
    : manuscriptExport(workspace, format)
  const result = await dialogOptions('showSaveDialog', {
    title: `导出${formatInfo.label}`,
    defaultPath: `${safeFileName(workspace.project.title)}.${formatInfo.extension}`,
    filters: formatInfo.filters,
  })
  if (result.canceled || !result.filePath) return { cancelled: true }
  fs.writeFileSync(result.filePath, content)
  return { cancelled: false, filePath: result.filePath, format }
}

function importFormatFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.docx') return 'docx'
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.json') return 'json'
  return 'txt'
}

async function importProjectFile() {
  const result = await dialogOptions('showOpenDialog', {
    title: '导入小说正文或项目备份',
    properties: ['openFile'],
    filters: [
      { name: '支持的小说与项目文件', extensions: ['txt', 'md', 'markdown', 'docx', 'json'] },
      ...Object.values(PROJECT_FILE_FORMATS).map((item) => item.filters[0]),
    ],
  })
  const filePath = result.filePaths?.[0]
  if (result.canceled || !filePath) return { cancelled: true }
  const stat = fs.statSync(filePath)
  if (stat.size > 100 * 1024 * 1024) throw new Error('导入文件超过 100 MB，请拆分后重试')
  const format = importFormatFromPath(filePath)
  const parsed = parseManuscript(fs.readFileSync(filePath), {
    format,
    fallbackTitle: path.basename(filePath, path.extname(filePath)),
  })
  const imported = parsed.backup ? restoreProjectBackupData(parsed.backup) : importManuscriptData(parsed)
  return {
    cancelled: false,
    filePath,
    format,
    mode: parsed.backup ? 'backup' : 'manuscript',
    ...imported,
  }
}

function registerIpc() {
  ipcMain.handle('workspace:load', (_event, projectId) => loadWorkspace(projectId))
  ipcMain.handle('projects:list', listProjects)
  ipcMain.handle('project:create', (_event, input) => createProject(input))
  ipcMain.handle('project:update', (_event, patch) => updateProject(patch))
  ipcMain.handle('project:archive', (_event, projectId) => archiveProject(projectId))
  ipcMain.handle('project:restore', (_event, projectId) => restoreProject(projectId))
  ipcMain.handle('project:delete', (_event, projectId) => {
    const result = deleteProject(projectId)
    try { removeCodexBookWorkspace({ baseDirectory: app.getPath('userData'), projectId }) }
    catch (error) { console.warn(`[Codex] 清理书籍工作区失败：${error.message}`) }
    return result
  })
  ipcMain.handle('project:export-file', (_event, payload) => exportProjectFile(payload))
  ipcMain.handle('project:import-file', () => importProjectFile())
  ipcMain.handle('chapter:create', (_event, input) => createChapter(input))
  ipcMain.handle('chapter:update', (_event, patch) => updateChapter(patch))
  ipcMain.handle('chapters:reorder', (_event, input) => reorderChapters(input))
  ipcMain.handle('chapter:duplicate', (_event, chapterId) => duplicateChapter(chapterId))
  ipcMain.handle('chapter:delete', (_event, chapterId) => deleteChapter(chapterId))
  ipcMain.handle('revision:create', (_event, payload) => createRevision(payload))
  ipcMain.handle('revisions:list', (_event, chapterId) => listRevisions(chapterId))
  ipcMain.handle('revision:restore', (_event, payload) => restoreRevision(payload))
  ipcMain.handle('planning:load', (_event, projectId) => loadPlanningCenter(projectId))
  ipcMain.handle('planning:document-save', (_event, payload) => savePlanningDocument(payload))
  ipcMain.handle('planning:entity-create', (_event, payload) => createPlanningEntity(payload))
  ipcMain.handle('planning:entity-update', (_event, payload) => updatePlanningEntity(payload))
  ipcMain.handle('planning:entities-reorder', (_event, payload) => reorderPlanningEntities(payload))
  ipcMain.handle('planning:entity-delete', (_event, entityId) => deletePlanningEntity(entityId))
  ipcMain.handle('planning:relationship-create', (_event, payload) => createCharacterRelationship(payload))
  ipcMain.handle('planning:relationship-update', (_event, payload) => updateCharacterRelationship(payload))
  ipcMain.handle('planning:relationship-delete', (_event, id) => deleteCharacterRelationship(id))
  ipcMain.handle('planning:arc-create', (_event, payload) => createStoryArc(payload))
  ipcMain.handle('planning:arc-update', (_event, payload) => updateStoryArc(payload))
  ipcMain.handle('planning:arc-delete', (_event, id) => deleteStoryArc(id))
  ipcMain.handle('planning:arc-beat-create', (_event, payload) => createStoryArcBeat(payload))
  ipcMain.handle('planning:arc-beat-update', (_event, payload) => updateStoryArcBeat(payload))
  ipcMain.handle('planning:arc-beat-delete', (_event, id) => deleteStoryArcBeat(id))
  ipcMain.handle('planning:candidate-create', (_event, payload) => createPlanningCandidate(payload))
  ipcMain.handle('planning:candidate-resolve', (_event, payload) => resolvePlanningCandidate(payload))
  ipcMain.handle('story-change:create', (_event, payload) => createStoryChangeSet(payload))
  ipcMain.handle('story-change:get', (_event, id) => getStoryChangeSet(id))
  ipcMain.handle('story-change:list', (_event, payload) => listStoryChangeSets(payload))
  ipcMain.handle('story-change:selection', (_event, payload) => updateStoryChangeSelection(payload))
  ipcMain.handle('story-change:apply', (_event, payload) => applyStoryChangeSet(payload))
  ipcMain.handle('story-change:revert', (_event, id) => revertStoryChangeSet(id))
  ipcMain.handle('story-change:cancel', (_event, id) => updateStoryChangeStatus({ changeSetId: id, status: 'cancelled' }))
  ipcMain.handle('knowledge:load', (_event, projectId) => loadKnowledgeCenter(projectId))
  ipcMain.handle('knowledge:sync', (_event, projectId) => syncKnowledgeSources(projectId))
  ipcMain.handle('knowledge:checks-refresh', (_event, projectId) => refreshContinuityChecks(projectId))
  ipcMain.handle('knowledge:item-create', (_event, payload) => createKnowledgeItem(payload))
  ipcMain.handle('knowledge:item-update', (_event, payload) => updateKnowledgeItem(payload))
  ipcMain.handle('knowledge:items-reorder', (_event, payload) => reorderKnowledgeItems(payload))
  ipcMain.handle('knowledge:item-delete', (_event, itemId) => deleteKnowledgeItem(itemId))
  ipcMain.handle('knowledge:check-resolve', (_event, payload) => resolveContinuityCheck(payload))
  ipcMain.handle('knowledge:candidate-create', (_event, payload) => createKnowledgeCandidate(payload))
  ipcMain.handle('knowledge:candidate-resolve', (_event, payload) => resolveKnowledgeCandidate(payload))
  ipcMain.handle('knowledge:item-candidate-update', (_event, payload) => updateKnowledgeItemCandidate(payload))
  ipcMain.handle('knowledge:item-candidate-resolve', (_event, payload) => resolveKnowledgeItemCandidate(payload))
  ipcMain.handle('context:load', (_event, projectId) => loadContextManager(projectId))
  ipcMain.handle('context:update', (_event, payload) => updateContextProfile(payload))
  ipcMain.handle('context:rebuild', (_event, projectId) => rebuildContextMemories(projectId))
  ipcMain.handle('prompts:load', (_event, projectId) => loadPromptCenter(projectId))
  ipcMain.handle('prompts:template-save', (_event, payload) => savePromptTemplate(payload))
  ipcMain.handle('prompts:template-bind', (_event, payload) => bindPromptTemplate(payload))
  ipcMain.handle('prompts:style-save', (_event, payload) => saveStyleProfile(payload))
  ipcMain.handle('prompts:addon-save', (_event, payload) => savePromptAddon(payload))
  ipcMain.handle('prompts:addon-bind', (_event, payload) => setPromptAddonBinding(payload))
  ipcMain.handle('prompts:preview', (_event, payload) => compilePromptPreview(payload))
  ipcMain.handle('models:load', () => loadModelSettings())
  ipcMain.handle('models:save', (_event, profile) => saveModelProfile(profile))
  ipcMain.handle('models:delete', (_event, id) => deleteModelProfile(id))
  ipcMain.handle('models:route', (_event, payload) => updateTaskRoute(payload.task, payload.modelProfileId))
  ipcMain.handle('models:test', async (_event, payload = {}) => {
    const profile = { ...payload, settings: payload.settings || {} }
    const apiKey = String(payload.apiKey || '') || (profile.id ? getModelApiKey(profile.id) : '')
    const capabilities = await probeModelCapabilities(profile, apiKey)
    return {
      ok: capabilities.text.supported,
      latencyMs: capabilities.text.latencyMs,
      gateway: 'embedded',
      model: { id: profile.id, provider: profile.provider, name: profile.name, model: profile.model },
      response: capabilities.text.response || '',
      capabilities,
      testedAt: capabilities.checkedAt,
    }
  })
  ipcMain.handle('codex:status', () => ({
    runtime: codexGateway.inspectRuntime(),
    settings: loadCodexSettings(),
  }))
  ipcMain.handle('codex:settings-save', (_event, payload) => saveCodexSettings(payload))
  ipcMain.handle('codex:start-auth', async (_event, methodId) => {
    await codexGateway.authenticate(methodId || 'chat-gpt')
    return codexGateway.inspectRuntime()
  })
  ipcMain.handle('codex:cancel-auth', async () => codexGateway.restartAdapter({ suppressErrors: true }))
  ipcMain.handle('codex:test', async () => {
    const diagnosticDirectory = path.join(app.getPath('userData'), 'codex-diagnostics')
    fs.mkdirSync(diagnosticDirectory, { recursive: true, mode: 0o700 })
    const status = await codexGateway.testConnection({ cwd: diagnosticDirectory })
    return { ok: true, status, message: 'ACP 初始化、协议协商与最小会话创建成功；未调用模型或写入项目。' }
  })
  ipcMain.handle('codex:restart-adapter', () => codexGateway.restartAdapter())
  ipcMain.handle('codex:open-project', async (_event, projectId) => {
    const workspace = codexBookWorkspaceForProject(String(projectId || ''))
    return codexGateway.openDesktopWorkspace({ workspaceRoot: workspace.root, waitForRegistration: true })
  })
  ipcMain.handle('approvals:session-model-policy', (_event, payload = {}) => {
    const projectId = String(payload.projectId || '')
    if (!projectId || !listProjects().some((item) => item.id === projectId)) throw new Error('项目不存在')
    if (typeof payload.enabled === 'boolean') {
      if (payload.enabled) codexSessionModelApprovalProjects.add(projectId)
      else codexSessionModelApprovalProjects.delete(projectId)
    }
    return { projectId, enabled: codexSessionModelApprovalProjects.has(projectId), expiresOnAppExit: true }
  })
  ipcMain.handle('agent:start', (event, payload) => {
    const codexDefaults = loadCodexSettings()
    return agentRuntime.start({
      ...payload,
      modelRoutes: {
        modelProfileId: payload.modelProfileId || '',
        reviewerProfileId: payload.reviewerProfileId || '',
      targetLength: Math.max(800, Math.min(12000, Math.round(Number(payload.targetLength) || 2000))),
        codexModel: payload.codexModel ?? codexDefaults.model ?? '',
        codexReasoningEffort: payload.codexReasoningEffort ?? codexDefaults.reasoningEffort ?? 'high',
        codexFastMode: payload.codexFastMode ?? Boolean(codexDefaults.fastMode),
        codexAuthMethod: payload.codexAuthMethod ?? codexDefaults.authMethod ?? 'chatgpt',
      },
    }, event)
  })
  ipcMain.handle('agent:start-inline', (event, payload = {}) => {
    const codexDefaults = loadCodexSettings()
    return agentRuntime.startInline({
      ...payload,
      modelRoutes: {
        modelProfileId: payload.modelProfileId || '',
        planning_field: payload.modelProfileId || '',
        appModelName: payload.modelProfileName || '',
        targetLength: Math.max(0, Math.min(12000, Math.round(Number(payload.targetLength) || 0))),
        codexModel: payload.codexModel ?? codexDefaults.model ?? '',
        codexReasoningEffort: payload.codexReasoningEffort ?? codexDefaults.reasoningEffort ?? 'high',
        codexFastMode: payload.codexFastMode ?? Boolean(codexDefaults.fastMode),
        codexAuthMethod: payload.codexAuthMethod ?? codexDefaults.authMethod ?? 'chatgpt',
      },
    }, event)
  })
  ipcMain.handle('agent:continue-inline', (event, payload = {}) => agentRuntime.continueInline(payload, event))
  ipcMain.handle('agent:finish-inline', (_event, runId) => agentRuntime.finishInline(runId))
  ipcMain.handle('agent:list', (_event, payload) => listAgentRuns(payload))
  ipcMain.handle('agent:get', (_event, runId) => getAgentRun(runId))
  ipcMain.handle('agent:pause', (_event, runId) => agentRuntime.pause(runId))
  ipcMain.handle('agent:resume', (event, runId) => agentRuntime.resume(runId, event))
  ipcMain.handle('agent:cancel', (_event, runId) => agentRuntime.cancel(runId))
  ipcMain.handle('agent:confirm-candidate', (event, payload) => agentRuntime.confirmCandidate({ ...payload, accept: true }, event))
  ipcMain.handle('agent:reject-candidate', (event, payload) => agentRuntime.confirmCandidate({ ...payload, accept: false }, event))
  ipcMain.handle('agent:retry-step', (event, payload) => agentRuntime.retryStep(payload, event))
  ipcMain.handle('agent:events', (_event, payload) => listAgentEvents(payload.agentRunId, payload))
  ipcMain.handle('approvals:list', (_event, payload) => listApprovalRequests(payload))
  ipcMain.handle('approvals:get', (_event, id) => getApprovalRequest(id))
  ipcMain.handle('approvals:resolve', (_event, payload) => {
    const before = getApprovalRequest(payload.id)
    const resolved = codexGateway.resolveApproval(payload)
    if (before?.agentRunId) {
      updateAgentRun(before.agentRunId, { status: payload.approved ? 'running' : 'paused' })
      if (before.agentStepId) updateAgentStep(before.agentStepId, {
        status: payload.approved ? 'running' : 'interrupted',
        approvalId: before.id,
        error: payload.approved ? '' : payload.reason || '用户拒绝审批',
      })
    }
    publishCodexEvent('approvals:event', resolved)
    return resolved
  })
  ipcMain.handle('generation:start', (event, payload) => runGenerationTask(event, payload))
  ipcMain.handle('generation:list', (_event, payload) => listGenerationRecords(payload))
  ipcMain.handle('generation:retry', (event, payload = {}) => {
    const source = getGenerationRecord(payload.recordId)
    if (!source) throw new Error('生成记录不存在')
    if (source.status === 'pending') throw new Error('当前生成任务仍在执行')
    if (source.task === 'rewrite') throw new Error('局部重写需要重新选择原文范围')
    if (!source.request?.task || !source.request?.projectId) throw new Error('旧生成记录缺少可重试任务快照')
    return runGenerationTask(event, { ...source.request, taskId: payload.taskId }, { retryOfId: source.id })
  })
  ipcMain.handle('generation:cancel', (_event, taskId) => modelGateway.cancel(String(taskId || '')))
  ipcMain.handle('quality:preflight', (_event, payload) => qualityPreflight(payload))
  ipcMain.handle('quality:list', (_event, payload) => listQualityReports(payload))
  ipcMain.handle('quality:get', (_event, reportId) => getQualityReport(reportId))
  ipcMain.handle('quality:blind-packet', (_event, reportId) => getBlindQualityReviewPacket(reportId))
  ipcMain.handle('quality:review', (event, payload) => reviewGenerationQuality(event, payload))
  ipcMain.handle('quality:repair', (event, payload) => repairQualityIssues(event, payload))
  ipcMain.handle('quality:human-review', (_event, payload) => addQualityHumanReview(payload))
  ipcMain.handle('benchmark:start', (event, payload) => runBenchmark(event, payload))
  ipcMain.handle('benchmark:list', (_event, payload) => listBenchmarkRuns(payload))
  ipcMain.handle('benchmark:get', (_event, runId) => getBenchmarkRun(runId))
  ipcMain.handle('benchmark:pause', (_event, runId) => {
    const control = activeBenchmarkControls.get(runId)
    const run = getBenchmarkRun(runId)
    if (!control || !run || run.status !== 'running') return run
    control.paused = true
    const updated = updateBenchmarkRun(runId, { status: 'running', summary: { ...run.summary, paused: true } })
    publishBenchmarkEvent(_event, { runId, type: 'pause-requested', run: updated })
    return updated
  })
  ipcMain.handle('benchmark:resume', (_event, runId) => {
    const control = activeBenchmarkControls.get(runId)
    const run = getBenchmarkRun(runId)
    if (!control || !run || run.status !== 'running') return run
    control.paused = false
    const updated = updateBenchmarkRun(runId, { status: 'running', summary: { ...run.summary, paused: false } })
    publishBenchmarkEvent(_event, { runId, type: 'resumed', run: updated })
    return updated
  })
  ipcMain.handle('benchmark:cancel', async (_event, runId) => {
    const control = activeBenchmarkControls.get(runId)
    if (control) control.cancelled = true
    const taskId = activeBenchmarkTasks.get(runId)
    if (taskId) await modelGateway.cancel(taskId)
    const run = getBenchmarkRun(runId)
    if (run && ['pending', 'running'].includes(run.status)) return updateBenchmarkRun(runId, { status: 'cancelled', summary: run.summary, error: '用户取消基准运行' })
    return run
  })
  ipcMain.handle('runtime:info', runtimeInfo)
  ipcMain.on('window:close-response', (event, payload = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (!payload.saved && !payload.discard) return
    closeResponsePending = true
    mainWindow.close()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#1d2024',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  window.on('close', (event) => {
    if (closeResponsePending || window.webContents.isLoading()) return
    event.preventDefault()
    void window.webContents.executeJavaScript(
      'Boolean(document.querySelector("#app")?.childElementCount)',
      true,
    ).then((rendererReady) => {
      if (window.isDestroyed()) return
      if (rendererReady) {
        window.webContents.send('window:close-requested')
        return
      }
      // If the renderer failed before Vue mounted, there is no listener that
      // can answer the save-before-close handshake. Let the window close.
      closeResponsePending = true
      window.close()
    }).catch(() => {
      if (window.isDestroyed()) return
      closeResponsePending = true
      window.close()
    })
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
      closeResponsePending = false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })
  if (devUrl) {
    window.loadURL(devUrl)
    if (process.env.NOVEL_STUDIO_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  openDatabase()
  initializeCodexIntegration()
  registerIpc()
  startGoService()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopGoService()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopGoService()
  expirePendingApprovalRequests()
  void codexGateway?.shutdown()
})
