const readJson = (value, fallback) => {
  try { return JSON.parse(value) ?? fallback } catch { return fallback }
}

const foundationFields = ['premise', 'coreConflict', 'storyPromise', 'pov', 'audience', 'lengthTarget', 'tone', 'boundaries']
const characterFields = ['role', 'identity', 'occupation', 'age', 'personality', 'desire', 'motivation', 'voice', 'relationships',
  'boundaries', 'knowledgeBoundary', 'abilities', 'inheritedRules', 'currentNewRule', 'disclosurePolicy', 'secret']
const worldFields = ['summary', 'rules', 'hardRules', 'trueRule', 'trigger', 'triggerAndTarget', 'conditions', 'outcomes',
  'effect', 'costs', 'carrierCost', 'powerSystem', 'limits', 'limitsAndExit', 'constraints', 'boundary', 'boundaries',
  'carrierAndAnchor', 'attack', 'escape', 'window', 'death', 'deathMechanism', 'whyCounterWorks', 'inheritance',
  'inheritanceFiveConditions', 'newRule', 'currentNewRule', 'activationRules', 'combinationRules', 'disclosureBoundary', 'knowledgeBoundary', 'characterKnowledge']
const recordQualifiers = ['category', 'scope', 'planningOnly', 'occurred', 'planningStatus', 'authority', 'knowledgeBoundary',
  'mechanismAuthority', 'siteAuthority', 'certainty', 'limit', 'knownTo', 'chapterNo', 'chapterId', 'sourceChapterNumber',
  'sourceChapterId', 'sourceEntityId', 'chapterRange', 'designVersion']
const knowledgeFields = ['statement', 'fact', 'rule', 'event', 'participants', 'consequence', 'entryState', 'exitState',
  'seed', 'setup', 'promise', 'payoff', 'payoffChapterNo', 'summary', 'content', 'conditions', 'trigger', 'activeRules', 'dormantRules',
  ...recordQualifiers]

function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => value?.[key] != null && value[key] !== '').map(key => [key, value[key]]))
}

export function draftChapterPlanning(chapter) {
  const structured = readJson(chapter.scene_plan_json, null)
  const scenes = structured?.scenes?.length ? structured : readJson(chapter.scene_plan, chapter.scene_plan)
  return { title: chapter.title, card: readJson(chapter.card_json, {}), scenes }
}

export const draftFoundation = data => pick(data, foundationFields)

export function draftEntityData(entity, data) {
  const fields = entity.kind === 'character' ? characterFields : entity.kind === 'world' ? worldFields
    : ['theme', 'stage', 'goal', 'conflict', 'chapterPlanningAuthority', ...(data?.goal || data?.conflict ? [] : ['summary'])]
  const selected = pick(data, fields)
  if (entity.kind !== 'volume' && !Object.keys(selected).length) {
    // Some imported cards keep their operative rules in a custom field.
    Object.assign(selected, pick(data, ['design', 'description', 'notes']))
  }
  return { ...selected, ...pick(data, recordQualifiers) }
}

export function draftKnowledgeView(value) {
  if (!value.content || typeof value.content !== 'object' || Array.isArray(value.content)) return value
  const content = pick(value.content, knowledgeFields)
  const hasBody = Object.keys(content).some(key => !recordQualifiers.includes(key))
  return hasBody ? { ...value, content } : value
}

export function createDraftScope(chapter, planning, instruction) {
  const chapterNo = Number(chapter.chapter_no)
  const normalized = value => String(value ?? '').trim().toLowerCase()
  const source = normalized([planning.title, JSON.stringify(planning.card), JSON.stringify(planning.scenes), instruction || ''].join('\n'))
  const refs = new Set(normalized(instruction).match(/[a-z0-9_-]+/g) || [])
  const collect = value => {
    if (typeof value === 'string') refs.add(normalized(value))
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(planning.card)
  collect(planning.scenes)
  const idReferenced = id => Boolean(id && refs.has(normalized(id)))
  const named = title => {
    const full = normalized(title)
    const core = full.replace(/^(人物|设定|事实|伏笔)[:：]\s*/u, '').split(/[（(]/u)[0].replace(/^[【《「]|[】》」]$/gu, '')
    return [full, core].some(name => name.length >= 2 && source.includes(name))
  }
  return {
    chapterNo,
    entity(row) {
      if (row.kind === 'volume') return row.id === planning.card.volumeId ? 2 : 0
      if (!['character', 'world'].includes(row.kind)) return 0
      return idReferenced(row.id) ? 2 : named(row.title) ? 1 : 0
    },
    knowledge(row, value, entityIds) {
      const data = value.content || {}
      const at = Number(data.chapterNo) || 0
      const origin = Number(data.sourceChapterNumber) || 0
      if (at > chapterNo || origin > chapterNo
        || (value.effectiveFrom != null && value.effectiveFrom > chapterNo)
        || (value.effectiveTo != null && value.effectiveTo < chapterNo)) return 0
      const direct = idReferenced(row.id)
      const attached = row.source_id === `chapter:${chapter.id}` || data.chapterId === chapter.id || at === chapterNo
      if (direct || attached || (row.kind === 'foreshadow' && Number(data.payoffChapterNo) === chapterNo)) return 3
      if (row.kind === 'timeline') return named(row.title) ? 1 : 0
      if (row.kind === 'fact' && (value.effectiveFrom != null || value.effectiveTo != null)) return 3
      if (named(row.title)) return 2
      const linked = data.sourceEntityId || (row.source_id?.startsWith('entity:') ? row.source_id.slice(7) : '')
      const prefix = normalized(row.title).match(/^[\p{Script=Han}]{4}/u)?.[0]
      return (linked && entityIds.has(linked)) || (prefix && source.includes(prefix)) ? 1 : 0
    },
  }
}
