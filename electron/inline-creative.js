const INLINE_ACTION_SCHEMA_VERSION = 1
export const INLINE_CONVERSATION_STEP_LIMIT = 8

const TARGET_TASKS = Object.freeze({
  planning_document: ['planning_field'],
  planning_document_bundle: ['planning_field'],
  planning_entity: ['planning_field'],
  planning_entity_bundle: ['planning_field'],
  planning_chapter_bundle: ['planning_field'],
  chapter_field: ['planning_field'],
  project_brief_draft: ['planning_field'],
  relationship_draft: ['planning_field'],
  story_arc_draft: ['planning_field'],
  story_arc_beat_draft: ['planning_field'],
  knowledge_item_draft: ['planning_field'],
  prompt_template_draft: ['planning_field'],
  style_profile_draft: ['planning_field'],
  prompt_addon_draft: ['planning_field'],
  chapter_card: ['chapter_card'],
  scene_plan: ['scene_plan'],
  manuscript: ['chapter'],
  manuscript_selection: ['rewrite'],
  chapter_state: ['chapter_state_extract'],
  continuity_audit: ['continuity_audit'],
  quality_review: ['quality_review'],
  story_change_set: ['story_change'],
})

export const INLINE_RENDERER_DRAFT_KINDS = Object.freeze([
  'project_brief_draft',
  'relationship_draft',
  'story_arc_draft',
  'story_arc_beat_draft',
  'knowledge_item_draft',
  'prompt_template_draft',
  'style_profile_draft',
  'prompt_addon_draft',
])

function cleanText(value, maxLength = 2000) {
  return String(value ?? '').trim().slice(0, maxLength)
}

const PROJECT_DRAFT_LIMITS = Object.freeze({
  title: 200,
  genre: 120,
  idea: 6000,
  style: 6000,
})

export function sanitizeProjectDraftContext(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(PROJECT_DRAFT_LIMITS)
    .filter(([key]) => Object.hasOwn(value, key))
    .map(([key, maxLength]) => [key, cleanText(value[key], maxLength)]))
}

export function projectForInlineTarget(project = {}, target = {}) {
  if (target.kind !== 'project_brief_draft') return project
  return { ...project, ...sanitizeProjectDraftContext(target.draftContext) }
}

function integer(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function candidateTypeFor(kind) {
  if (INLINE_RENDERER_DRAFT_KINDS.includes(kind)) return 'renderer_draft'
  if (kind === 'planning_document_bundle') return 'planning_document_bundle'
  if (kind === 'planning_entity_bundle') return 'planning_entity_bundle'
  if (kind === 'planning_chapter_bundle') return 'planning_chapter_bundle'
  if (['planning_document', 'planning_entity', 'chapter_field'].includes(kind)) return 'planning_field'
  if (kind === 'manuscript_selection') return 'manuscript_selection'
  if (kind === 'story_change_set') return 'story_change_set'
  return kind
}

export function inlineTargetKey(target = {}) {
  const fieldSet = ['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(target.kind)
    ? '*'
    : Array.isArray(target.fieldKeys) && target.fieldKeys.length ? target.fieldKeys.join(',') : target.fieldKey || '*'
  return [target.kind, target.targetId || 'new', fieldSet, target.selectionFrom ?? '', target.selectionTo ?? ''].join(':')
}

const BOOK_PLANNING_TARGETS = new Set([
  'planning_document', 'planning_document_bundle', 'planning_entity', 'planning_entity_bundle',
  'project_brief_draft', 'relationship_draft', 'story_arc_draft', 'story_arc_beat_draft',
  'knowledge_item_draft', 'prompt_template_draft', 'style_profile_draft', 'prompt_addon_draft',
])
const CHAPTER_CREATIVE_TARGETS = new Set([
  'planning_chapter_bundle', 'chapter_field', 'chapter_card', 'scene_plan', 'manuscript', 'manuscript_selection',
])

export function inlineConversationReuseScope(input = {}) {
  const projectId = cleanText(input.projectId, 200) || 'unknown-project'
  const target = input.target && typeof input.target === 'object' ? input.target : {}
  const canonicalTarget = { ...target, selectionFrom: integer(target.selectionFrom), selectionTo: integer(target.selectionTo) }
  const targetKind = cleanText(target.kind, 80)
  const chapterId = cleanText(input.chapterId || target.targetId || target.scopeId, 200)
  const chapterScopedDraft = ['style_profile_draft', 'prompt_addon_draft'].includes(targetKind)
    && cleanText(target.scopeType, 40) === 'chapter'

  if (CHAPTER_CREATIVE_TARGETS.has(targetKind) || chapterScopedDraft) {
    return {
      key: `chapter:${projectId}:${chapterId || 'unknown-chapter'}`,
      kind: 'chapter',
      reusable: true,
      maxSteps: INLINE_CONVERSATION_STEP_LIMIT,
    }
  }
  if (BOOK_PLANNING_TARGETS.has(targetKind)) {
    return {
      key: `planning:${projectId}`,
      kind: 'planning',
      reusable: true,
      maxSteps: INLINE_CONVERSATION_STEP_LIMIT,
    }
  }
  const kind = targetKind === 'quality_review' ? 'review' : 'audit'
  return {
    key: `isolated:${projectId}:${inlineTargetKey(canonicalTarget)}`,
    kind,
    reusable: false,
    maxSteps: 1,
  }
}

export function normalizeInlineCreativeAction(input = {}) {
  const task = cleanText(input.task, 80)
  const targetInput = input.target && typeof input.target === 'object' && !Array.isArray(input.target) ? input.target : {}
  const kind = cleanText(targetInput.kind, 80)
  if (!TARGET_TASKS[kind]) {
    const received = kind || '空目标'
    throw new Error(`就地创作目标类型不受支持：${received}`)
  }
  if (!TARGET_TASKS[kind].includes(task)) throw new Error(`任务 ${task || '未指定'} 不能用于 ${kind}`)
  const target = {
    kind,
    targetId: cleanText(targetInput.targetId, 200),
    fieldKey: cleanText(targetInput.fieldKey, 120),
    fieldLabel: cleanText(targetInput.fieldLabel, 200),
    promptProfile: cleanText(targetInput.promptProfile, 120),
    cursorOffset: integer(targetInput.cursorOffset),
    selectionFrom: integer(targetInput.selectionFrom),
    selectionTo: integer(targetInput.selectionTo),
    sourceGenerationId: cleanText(targetInput.sourceGenerationId, 200),
    reportId: cleanText(targetInput.reportId, 200),
    issueIds: Array.isArray(targetInput.issueIds) ? targetInput.issueIds.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, 100) : [],
    draftDigest: cleanText(targetInput.draftDigest, 160),
    scopeType: cleanText(targetInput.scopeType, 40),
    scopeId: cleanText(targetInput.scopeId, 200),
    fieldKeys: Array.isArray(targetInput.fieldKeys)
      ? targetInput.fieldKeys.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 40)
      : [],
    includeFilled: Boolean(targetInput.includeFilled),
    draftContext: kind === 'project_brief_draft' ? sanitizeProjectDraftContext(targetInput.draftContext) : undefined,
  }
  if (kind === 'manuscript_selection' && target.selectionTo <= target.selectionFrom) throw new Error('局部重写选区无效')
  if (kind === 'quality_review' && !target.sourceGenerationId) throw new Error('质量评审缺少待评审生成记录')
  if (INLINE_RENDERER_DRAFT_KINDS.includes(kind) && !target.fieldKey) throw new Error('编辑器草稿候选缺少字段标识')
  if (INLINE_RENDERER_DRAFT_KINDS.includes(kind) && !target.draftDigest) throw new Error('编辑器草稿候选缺少草稿摘要')
  return {
    schemaVersion: INLINE_ACTION_SCHEMA_VERSION,
    task,
    intent: cleanText(input.intent, 40) || ({ chapter: 'draft', rewrite: 'rewrite', quality_review: 'analysis', continuity_audit: 'analysis', chapter_state_extract: 'analysis' }[task] || 'draft'),
    target,
    targetKey: inlineTargetKey(target),
    conversationScope: inlineConversationReuseScope({ ...input, target }),
    candidateType: candidateTypeFor(kind),
    instruction: cleanText(input.instruction, 20000),
    targetLength: Math.max(0, Math.min(12000, Math.round(Number(input.targetLength) || 0))),
    requestedExecutionMode: input.executionMode === 'app_model' ? 'app_model' : 'codex',
  }
}

export function isRendererDraftTarget(target = {}) {
  return INLINE_RENDERER_DRAFT_KINDS.includes(target.kind)
}

export { INLINE_ACTION_SCHEMA_VERSION }
