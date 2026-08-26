import { renderScenePlan } from './creative-quality.js'

const FIELD_DEFINITIONS = Object.freeze({
  character: Object.freeze([
    { key: 'title', label: '人物姓名 / 称谓' },
    { key: 'role', label: '故事角色' },
    { key: 'identity', label: '身份与处境' },
    { key: 'desire', label: '外在欲望' },
    { key: 'need', label: '内在需要' },
    { key: 'fear', label: '恐惧与底线' },
    { key: 'flaw', label: '缺陷与惯性' },
    { key: 'secret', label: '秘密与知情范围' },
    { key: 'arc', label: '人物弧' },
    { key: 'voice', label: '说话与行为辨识度' },
    { key: 'relationships', label: '关键关系' },
  ]),
  world: Object.freeze([
    { key: 'title', label: '设定名称' },
    { key: 'category', label: '设定类型' },
    { key: 'summary', label: '核心说明' },
    { key: 'rules', label: '成立规则' },
    { key: 'storyUse', label: '剧情用途' },
    { key: 'connections', label: '关联对象' },
    { key: 'constraints', label: '连续性约束' },
  ]),
  volume: Object.freeze([
    { key: 'title', label: '分卷名称' },
    { key: 'chapterRange', label: '章节范围' },
    { key: 'goal', label: '本卷目标' },
    { key: 'conflict', label: '主要阻力' },
    { key: 'arc', label: '阶段变化' },
    { key: 'turn', label: '卷中转折' },
    { key: 'ending', label: '卷末兑现' },
    { key: 'volumeStyle', label: '卷级文风' },
  ]),
})

const DOCUMENT_FIELD_DEFINITIONS = Object.freeze({
  foundation: Object.freeze([
    { key: 'audience', label: '目标读者' },
    { key: 'lengthTarget', label: '篇幅目标' },
    { key: 'pov', label: '叙事视角' },
    { key: 'premise', label: '故事前提' },
    { key: 'coreConflict', label: '核心冲突' },
    { key: 'storyPromise', label: '阅读承诺' },
    { key: 'themes', label: '主题母题' },
    { key: 'tone', label: '氛围基调' },
    { key: 'endingDirection', label: '结局方向' },
    { key: 'boundaries', label: '创作边界' },
  ]),
  world: Object.freeze([
    { key: 'era', label: '时代与时间' },
    { key: 'geography', label: '空间结构' },
    { key: 'society', label: '社会与秩序' },
    { key: 'powerSystem', label: '能力与资源体系' },
    { key: 'hardRules', label: '硬规则' },
    { key: 'costs', label: '代价与限制' },
    { key: 'dailyLife', label: '日常质感' },
    { key: 'history', label: '共同历史' },
  ]),
  outline: Object.freeze([
    { key: 'logline', label: '总纲一句话' },
    { key: 'opening', label: '开局常态' },
    { key: 'incitingIncident', label: '诱发事件' },
    { key: 'firstTurn', label: '第一次转向' },
    { key: 'midpoint', label: '中点变化' },
    { key: 'crisis', label: '危机与最低点' },
    { key: 'climax', label: '高潮选择' },
    { key: 'ending', label: '结局兑现' },
    { key: 'thematicArc', label: '主题变化线' },
  ]),
})

const DOCUMENT_META = Object.freeze({
  foundation: Object.freeze({ label: '故事基础', promptProfile: 'generic' }),
  world: Object.freeze({ label: '世界总览', promptProfile: 'world_rule' }),
  outline: Object.freeze({ label: '总纲骨架', promptProfile: 'outline_tree' }),
})

const CHAPTER_FIELD_DEFINITIONS = Object.freeze([
  { key: 'goal', label: '本章合同' },
  { key: 'protagonistGoal', label: '主角目标' },
  { key: 'resistance', label: '主要阻力' },
  { key: 'turningPoint', label: '本章转折' },
  { key: 'payoff', label: '本章回报' },
  { key: 'cost', label: '本章代价' },
  { key: 'ending', label: '结尾合同' },
  { key: 'chapterStyle', label: '章节级文风' },
  { key: 'scenePlan', label: '场景计划' },
])

const PROFILE_BY_KIND = Object.freeze({
  character: 'character_card',
  world: 'world_rule',
  volume: 'volume_plan',
})

function cleanText(value, maxLength = 100000) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function entityData(entity = {}) {
  if (entity.data && typeof entity.data === 'object' && !Array.isArray(entity.data)) return entity.data
  try { return entity.data_json ? JSON.parse(entity.data_json) : {} } catch { return {} }
}

function genericTitle(kind, title) {
  const value = cleanText(title, 300)
  if (kind === 'character') return /^人物\s*\d+$/u.test(value)
  if (kind === 'world') return /^(?:世界设定|新地点)\s*\d*$/u.test(value)
  if (kind === 'volume') return /^第\s*\d+\s*卷$/u.test(value)
  return false
}

export function planningEntityFieldDefinitions(kind) {
  return FIELD_DEFINITIONS[kind] ? FIELD_DEFINITIONS[kind].map((field) => ({ ...field })) : []
}

export function planningDocumentFieldDefinitions(kind) {
  return DOCUMENT_FIELD_DEFINITIONS[kind] ? DOCUMENT_FIELD_DEFINITIONS[kind].map((field) => ({ ...field })) : []
}

export function planningChapterFieldDefinitions() {
  return CHAPTER_FIELD_DEFINITIONS.map((field) => ({ ...field }))
}

function chapterCard(chapter = {}) {
  if (chapter.card && typeof chapter.card === 'object' && !Array.isArray(chapter.card)) return chapter.card
  try { return chapter.card_json ? JSON.parse(chapter.card_json) : {} } catch { return {} }
}

function chapterFieldValue(chapter = {}, key) {
  if (key !== 'scenePlan') return chapterCard(chapter)[key]
  if (typeof chapter.scenePlan === 'string') return chapter.scenePlan
  if (chapter.scenePlan && typeof chapter.scenePlan === 'object') return renderScenePlan(chapter.scenePlan)
  return chapter.scene_plan || ''
}

export function buildPlanningEntityBundleTarget(entity = {}, request = {}) {
  const kind = cleanText(entity.kind, 40)
  const definitions = planningEntityFieldDefinitions(kind)
  if (!definitions.length) throw new Error('规划卡片类型不支持整卡生成')
  const data = entityData(entity)
  const requestedKeys = Array.isArray(request.fieldKeys)
    ? new Set(request.fieldKeys.map((key) => cleanText(key, 120)).filter(Boolean))
    : null
  const includeFilled = Boolean(request.includeFilled)
  const fields = definitions.filter((definition) => {
    if (requestedKeys?.size && !requestedKeys.has(definition.key)) return false
    const currentValue = definition.key === 'title' ? entity.title : data[definition.key]
    if (includeFilled) return true
    if (definition.key === 'title') return genericTitle(kind, currentValue)
    return !cleanText(currentValue)
  }).map((definition) => ({
    ...definition,
    originalValue: cleanText(definition.key === 'title' ? entity.title : data[definition.key]),
  }))
  if (!fields.length) throw new Error('这张卡已经没有需要补全的空白字段')
  return {
    ...request,
    kind: 'planning_entity_bundle',
    targetId: cleanText(entity.id, 200),
    fieldKey: '*',
    fieldLabel: `${cleanText(entity.title, 300) || '当前规划卡'} · AI 补全整卡`,
    promptProfile: PROFILE_BY_KIND[kind],
    entityKind: kind,
    includeFilled,
    fieldKeys: fields.map((field) => field.key),
    fields,
  }
}

export function buildPlanningDocumentBundleTarget(document = {}, request = {}) {
  const kind = cleanText(document.kind || request.targetId, 40)
  const definitions = planningDocumentFieldDefinitions(kind)
  const meta = DOCUMENT_META[kind]
  if (!definitions.length || !meta) throw new Error('规划文档类型不支持整页生成')
  const content = document.content && typeof document.content === 'object' && !Array.isArray(document.content)
    ? document.content
    : (() => { try { return document.content_json ? JSON.parse(document.content_json) : {} } catch { return {} } })()
  const requestedKeys = Array.isArray(request.fieldKeys)
    ? new Set(request.fieldKeys.map((key) => cleanText(key, 120)).filter(Boolean))
    : null
  const includeFilled = Boolean(request.includeFilled)
  const fields = definitions.filter((definition) => {
    if (requestedKeys?.size && !requestedKeys.has(definition.key)) return false
    return includeFilled || !cleanText(content[definition.key])
  }).map((definition) => ({
    ...definition,
    originalValue: cleanText(content[definition.key]),
  }))
  if (!fields.length) throw new Error('这一页已经没有需要补全的空白字段')
  return {
    ...request,
    kind: 'planning_document_bundle',
    targetId: kind,
    fieldKey: '*',
    fieldLabel: `${meta.label} · AI 补全本页`,
    promptProfile: meta.promptProfile,
    documentKind: kind,
    includeFilled,
    fieldKeys: fields.map((field) => field.key),
    fields,
  }
}

export function buildPlanningChapterBundleTarget(chapter = {}, request = {}) {
  const definitions = planningChapterFieldDefinitions()
  const requestedKeys = Array.isArray(request.fieldKeys)
    ? new Set(request.fieldKeys.map((key) => cleanText(key, 120)).filter(Boolean))
    : null
  const includeFilled = Boolean(request.includeFilled)
  const fields = definitions.filter((definition) => {
    if (requestedKeys?.size && !requestedKeys.has(definition.key)) return false
    return includeFilled || !cleanText(chapterFieldValue(chapter, definition.key))
  }).map((definition) => ({
    ...definition,
    originalValue: cleanText(chapterFieldValue(chapter, definition.key)),
  }))
  if (!fields.length) throw new Error('本章已经没有需要补全的空白规划字段')
  const chapterNo = Number(chapter.chapterNo || chapter.chapter_no || 1)
  const title = cleanText(chapter.title, 300) || `第 ${chapterNo} 章`
  return {
    ...request,
    kind: 'planning_chapter_bundle',
    targetId: cleanText(chapter.id, 200),
    fieldKey: '*',
    fieldLabel: `第 ${chapterNo} 章《${title}》 · AI 补全本章`,
    promptProfile: 'generic',
    includeFilled,
    fieldKeys: fields.map((field) => field.key),
    fields,
  }
}

export function planningBundleSchema(target = {}) {
  const fields = Array.isArray(target.fields) ? target.fields : []
  const properties = Object.fromEntries(fields.map((field) => [field.key, { type: 'string', minLength: 1 }]))
  return {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'object',
        required: fields.map((field) => field.key),
        properties,
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  }
}

export function planningEntityBundleSchema(target = {}) {
  return planningBundleSchema(target)
}

function parseJsonResult(result = {}) {
  if (result.structuredOutput && typeof result.structuredOutput === 'object' && !Array.isArray(result.structuredOutput)) {
    return result.structuredOutput
  }
  const source = result.fields && typeof result.fields === 'object'
    ? result
    : result.text || result.content || ''
  if (source && typeof source === 'object' && !Array.isArray(source)) return source
  const text = cleanText(source)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)
  try { return JSON.parse(fenced ? fenced[1].trim() : text) } catch {
    throw Object.assign(new Error('批量规划候选不是有效 JSON'), { name: 'StructuredOutputError' })
  }
}

export function normalizePlanningEntityBundleCandidate(result = {}, target = {}) {
  const fields = normalizePlanningBundleFields(result, target, '整卡')
  return {
    entityId: cleanText(target.targetId, 200),
    entityKind: cleanText(target.entityKind, 40),
    entityTitle: cleanText(target.fieldLabel, 300).replace(/\s*·\s*AI 补全整卡$/u, ''),
    fields,
  }
}

function normalizePlanningBundleFields(result = {}, target = {}, bundleLabel = '批量') {
  const parsed = parseJsonResult(result)
  const generatedFields = parsed?.fields
  const definitions = Array.isArray(target.fields) ? target.fields : []
  if (!generatedFields || typeof generatedFields !== 'object' || Array.isArray(generatedFields)) {
    throw Object.assign(new Error(`${bundleLabel}候选缺少 fields 对象`), { name: 'StructuredOutputError' })
  }
  const allowedKeys = new Set(definitions.map((field) => field.key))
  const unexpected = Object.keys(generatedFields).filter((key) => !allowedKeys.has(key))
  if (unexpected.length) {
    throw Object.assign(new Error(`${bundleLabel}候选包含未请求字段：${unexpected.join('、')}`), { name: 'StructuredOutputError' })
  }
  const fields = definitions.map((field) => ({
    key: field.key,
    label: field.label,
    originalValue: cleanText(field.originalValue),
    candidateValue: cleanText(generatedFields[field.key]),
  }))
  const missing = fields.filter((field) => !field.candidateValue).map((field) => field.label)
  if (missing.length) {
    throw Object.assign(new Error(`${bundleLabel}候选缺少字段：${missing.join('、')}`), { name: 'StructuredOutputError' })
  }
  return fields
}

export function normalizePlanningDocumentBundleCandidate(result = {}, target = {}) {
  const fields = normalizePlanningBundleFields(result, target, '整页')
  return {
    documentKind: cleanText(target.documentKind || target.targetId, 40),
    documentTitle: cleanText(target.fieldLabel, 300).replace(/\s*·\s*AI 补全本页$/u, ''),
    fields,
  }
}

export function normalizePlanningChapterBundleCandidate(result = {}, target = {}) {
  const fields = normalizePlanningBundleFields(result, target, '整章规划')
  return {
    chapterId: cleanText(target.targetId, 200),
    chapterTitle: cleanText(target.fieldLabel, 300).replace(/\s*·\s*AI 补全本章$/u, ''),
    fields,
  }
}
