const TASK_LABELS = {
  planning_field: '规划字段',
  chapter_card: '章节卡',
  scene_plan: '场景计划',
  chapter: '正文',
  rewrite: '局部重写',
  quality_review: '质量评审',
  chapter_state_extract: '章后状态',
  continuity_audit: '连续性审计',
  story_change: '设定联动修改',
}

function clean(value = '', fallback = '') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function entityForTarget(planningCenter, targetId) {
  return [
    ...(planningCenter?.characters || []),
    ...(planningCenter?.worldElements || []),
    ...(planningCenter?.volumes || []),
  ].find((item) => item.id === targetId)
}

function chapterScope(chapter) {
  const numberLabel = `第 ${chapter?.chapter_no || chapter?.chapterNo || 1} 章`
  const title = clean(chapter?.title)
  if (!title) return numberLabel
  if (/^第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*章$/i.test(title)) return title.replace(/\s+/g, '')
  return `${numberLabel} · ${title}`
}

function inlineQualifier({ target, planningCenter, chapter }) {
  if (target.kind === 'planning_document' || target.kind === 'project_brief_draft') return ''
  if (target.kind === 'story_change_set') return ''
  if (target.kind === 'planning_entity') {
    const entity = entityForTarget(planningCenter, target.targetId)
    return clean(entity?.title)
  }
  if (target.kind === 'chapter_field' || [
    'manuscript',
    'manuscript_selection',
    'chapter_card',
    'scene_plan',
    'chapter_state',
    'continuity_audit',
    'quality_review',
  ].includes(target.kind)) return chapterScope(chapter)
  return ''
}

export function codexTaskDisplayTitle({ chapter = null, planningCenter = {}, run = {}, step = {} }) {
  if (run.workflowId === 'inline-action') {
    const target = step.input?.target || {}
    const qualifier = inlineQualifier({ target, planningCenter, chapter })
    const action = clean(target.fieldLabel || TASK_LABELS[step.task] || step.key, '创作任务')
    return [qualifier, action].filter(Boolean).join(' · ')
  }
  if (run.workflowId === 'project-initialization') return '项目初始化'
  const action = TASK_LABELS[step.task] || clean(step.key, '创作任务')
  if (!chapter || step.candidateType === 'foundation_bundle') return action
  return `${chapterScope(chapter)} · ${action}`
}
