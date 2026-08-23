import { createHash } from 'node:crypto'
import {
  builtInPromptTemplate,
  CORE_SYSTEM_RULES,
  PROMPT_SNAPSHOT_SCHEMA_VERSION,
  PROTECTED_OUTPUT_CONTRACTS,
  resolveRewritePreset,
} from './prompt-templates.js'

function compactJson(value, limit = 12000) {
  const content = JSON.stringify(value || {})
  return content.length > limit ? content.slice(0, limit) + '…' : content
}

function fallbackContext({ project, chapter, planningCenter, knowledgeCenter }) {
  const planning = planningCenter ? {
    foundation: planningCenter.documents?.foundation?.content || {},
    worldOverview: planningCenter.documents?.world?.content || {},
    outline: planningCenter.documents?.outline?.content || {},
    characters: (planningCenter.characters || []).map((item) => ({ title: item.title, ...item.data })),
    worldElements: (planningCenter.worldElements || []).map((item) => ({ title: item.title, ...item.data })),
    volumes: (planningCenter.volumes || []).map((item) => ({ title: item.title, ...item.data })),
  } : null
  const knowledge = knowledgeCenter ? {
    facts: (knowledgeCenter.facts || []).filter((item) => item.status === 'open').map((item) => ({ title: item.title, ...item.content })),
    timeline: (knowledgeCenter.timeline || []).filter((item) => item.status === 'open').map((item) => ({ title: item.title, ...item.content })),
    foreshadows: (knowledgeCenter.foreshadows || []).filter((item) => item.status === 'open').map((item) => ({ title: item.title, ...item.content })),
    openChecks: (knowledgeCenter.checks || []).filter((check) => check.status === 'open').map((check) => ({ severity: check.severity, title: check.title, detail: check.detail })),
  } : null
  return [
    '项目：' + (project?.title || '未命名小说'),
    '题材：' + (project?.genre || '未设置'),
    '故事想法：' + (project?.idea || '暂无'),
    '章节：' + (chapter?.chapter_no || chapter?.chapterNo || 1) + ' · ' + (chapter?.title || '新章节'),
    '章节卡：' + JSON.stringify(chapter?.card || {}),
    '场景计划：' + (chapter?.scene_plan || chapter?.scenePlan || '暂无'),
    planning ? '已确认故事规划：' + compactJson(planning) : '',
    knowledge ? '已确认知识与连续性：' + compactJson(knowledge) : '',
  ].filter(Boolean).join('\n')
}

function styleContext(input) {
  const resolved = input.promptContext?.style
  if (resolved) return {
    sources: Array.isArray(resolved.sources) ? resolved.sources : [],
    mergedText: String(resolved.mergedText || '').trim(),
    mergedStyle: resolved.mergedStyle && typeof resolved.mergedStyle === 'object' ? resolved.mergedStyle : {},
    volume: resolved.volume || null,
  }
  const sources = []
  const projectStyle = String(input.project?.style || '').trim()
  const chapterStyle = String(input.chapter?.card?.chapterStyle || '').trim()
  if (projectStyle) sources.push({ scopeType: 'project', scopeId: input.project?.id || '', label: '项目级', text: projectStyle })
  if (chapterStyle) sources.push({ scopeType: 'chapter', scopeId: input.chapter?.id || '', label: '章节级', text: chapterStyle })
  return { sources, mergedText: sources.map((item) => item.text).join('\n'), mergedStyle: {}, volume: null }
}

function planningDetails(input) {
  const planning = input.planning || {}
  return [
    `规划模块：${planning.sectionLabel || '故事规划'}`,
    `对象：${planning.targetLabel || '当前项目'}`,
    `字段：${planning.fieldLabel || planning.fieldKey || '当前字段'}`,
    `当前内容：${planning.currentValue || '尚未填写'}`,
    planning.nearbyContext ? `相关上下文：${planning.nearbyContext}` : '',
    planning.currentValue ? '在保留有效信息的基础上给出一版更完整的候选。' : '',
  ].filter(Boolean).join('\n')
}

function taskDetails(task, input) {
  if (task === 'planning_field') return planningDetails(input)
  if (task === 'chapter_state_extract' || task === 'continuity_audit') {
    return [
      `待处理章节：第 ${input.chapter?.chapter_no || 1} 章《${input.chapter?.title || '未命名章节'}》`,
      '以下是本次任务唯一的待处理正文；引用证据和位置必须来自这里：',
      input.chapter?.manuscript || '（正文为空）',
    ].join('\n')
  }
  if (task === 'rewrite') {
    const preset = resolveRewritePreset(input.rewriteMode)
    return [
      `重写预设：${preset.name}`,
      `预设要求：${preset.content}`,
      `待处理文字：${input.selectedText || ''}`,
    ].join('\n')
  }
  return ''
}

function promptHash(messages) {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

function uniqueParts(parts) {
  return [...new Set(parts.map((part) => String(part || '').trim()).filter(Boolean))]
}

function normalizedTemplate(task, promptContext) {
  const fallback = builtInPromptTemplate(task)
  const candidate = promptContext?.template
  if (!candidate?.content || candidate.task !== task) return fallback
  return {
    id: candidate.id || fallback.id,
    task,
    name: candidate.name || fallback.name,
    version: Number(candidate.version || 1),
    content: { ...fallback.content, ...candidate.content },
  }
}

export function compilePrompt(input = {}) {
  const task = input.task || 'chapter'
  const template = normalizedTemplate(task, input.promptContext)
  if (task === 'connection_test') {
    const messages = [
      { role: 'system', content: template.content.system },
      { role: 'user', content: template.content.request },
    ]
    return {
      messages,
      snapshot: {
        schemaVersion: PROMPT_SNAPSHOT_SCHEMA_VERSION,
        template: { id: template.id, name: template.name, task, version: template.version },
        styles: { sources: [], mergedText: '', mergedStyle: {}, volume: null },
        addons: [],
        oneTimeInstruction: '',
        messages,
        promptHash: promptHash(messages),
        estimatedChars: messages.reduce((sum, message) => sum + message.content.length, 0),
      },
    }
  }

  const styles = styleContext(input)
  const addons = Array.isArray(input.promptContext?.addons)
    ? input.promptContext.addons.filter((addon) => addon?.content).map((addon) => ({
      id: addon.id,
      name: addon.name,
      category: addon.category || '',
      version: Number(addon.version || 1),
      content: String(addon.content).trim(),
      binding: addon.binding || null,
    }))
    : []
  const referenceContext = input.longContext?.text || fallbackContext(input)
  const styleLines = styles.sources.flatMap((source) => [
    source.text ? `${source.label || source.scopeType}文风：${source.text}` : '',
    source.style && Object.keys(source.style).length ? `${source.label || source.scopeType}结构化文风：${JSON.stringify(source.style)}` : '',
  ]).filter(Boolean)
  const details = taskDetails(task, input)
  const rewritePreset = task === 'rewrite' ? resolveRewritePreset(input.rewriteMode) : null
  const instruction = String(input.instruction || '').trim()
  const userContent = [
    '【已确认参考上下文】',
    referenceContext,
    styleLines.length ? '\n【文风继承】\n' + styleLines.join('\n') : '',
    addons.length ? '\n【叠加写作要求】\n' + addons.map((addon) => `- ${addon.name}：${addon.content}`).join('\n') : '',
    details ? '\n【当前任务细节】\n' + details : '',
    instruction ? '\n【本次补充要求】\n' + instruction : '',
    '\n【执行任务】\n' + template.content.request,
  ].filter(Boolean).join('\n')
  const systemContent = uniqueParts([
    template.content.system,
    template.content.outputContract,
    CORE_SYSTEM_RULES,
    PROTECTED_OUTPUT_CONTRACTS[task],
  ]).join('\n')
  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
  return {
    messages,
    snapshot: {
      schemaVersion: PROMPT_SNAPSHOT_SCHEMA_VERSION,
      template: { id: template.id, name: template.name, task, version: template.version },
      styles,
      addons: addons.map((addon) => ({
        id: addon.id,
        name: addon.name,
        category: addon.category,
        version: addon.version,
        binding: addon.binding,
      })),
      oneTimeInstruction: instruction,
      rewritePreset: rewritePreset ? { id: rewritePreset.id, name: rewritePreset.name } : null,
      messages,
      promptHash: promptHash(messages),
      estimatedChars: messages.reduce((sum, message) => sum + message.content.length, 0),
      contextDiagnostics: input.longContext?.diagnostics || null,
    },
  }
}
