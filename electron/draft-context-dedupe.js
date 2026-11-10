import { planningEntityFactFields, planningEntityFactText } from './knowledge-repository.js'

export function isChapterFirstDraft(input, chapter) {
  return input.task === 'chapter' && (input.intent === 'draft' || (!input.intent && !String(chapter?.manuscript || '').trim()))
}

const normalize = (value) => typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
const factFields = ['statement', 'fact', 'rule']
const provenanceFields = ['category', 'scope', ...factFields]
// Keep conditional, scoped or otherwise annotated statements separate. In
// particular a copied sentence is not evidence that its applicability agrees.
function comparableFact(row, value) {
  if (row.kind !== 'fact' || row.status !== 'open'
    || value.effectiveFrom != null || value.effectiveTo != null
    || value.scope?.author !== true || Object.keys(value.scope).length !== 1
    || !Array.isArray(value.evidence) || value.evidence.length) return null
  const content = value.content
  if (!content || typeof content !== 'object' || Array.isArray(content)
    || Object.keys(content).some(key => !provenanceFields.includes(key))) return null
  const statements = factFields.filter(key => Object.hasOwn(content, key))
  const statement = statements.length === 1 ? normalize(content[statements[0]]) : ''
  if (!statement) return null
  if (row.source_type === 'planning' && content.scope === '全书已确认规划'
    && row.source_id?.startsWith(`document:${content.category}:`)) return { statement, projection: row.source_id }
  if (row.source_type === 'planning' && content.scope === '规划卡片'
    && row.source_id?.startsWith('entity:')) return { statement, projection: row.source_id, category: content.category }
  if (content.scope != null && content.scope !== '') return null
  return { statement, world: ['', 'world', '世界', '规则'].includes(content.category ?? ''), key: JSON.stringify([content.category ?? '', statement]) }
}

const qualifier = /scope|authority|knowledge|planning|occurred|effectiv|certainty|status|condition|time|chapter|boundar|exception|active|draft|confirm|review|future|histor/i
const worldRuleFields = ['rules', 'hardRules', 'trueRule']
function exactEntityProjection(entity, data, fact) {
  return fact?.category === entity.kind
    && !Object.keys(data).some(key => qualifier.test(key))
    && normalize(planningEntityFactText(entity, data) || entity.title) === fact.statement
}

export function createDraftContextDeduper() {
  const documents = new Map(), worldFacts = new Set(), entities = new Map(), facts = new Set(), entityProjections = new Map()
  return {
    addDocument(kind, data) {
      for (const [field, value] of Object.entries(data || {})) {
        const statement = normalize(value)
        if (statement) documents.set(`document:${kind}:${field}`, statement)
        if (kind !== 'world' || !['hardRules', 'costs', 'powerSystem'].includes(field)) continue
        if (statement) worldFacts.add(statement)
        // Only standalone bullet lists/array entries; do not infer that an
        // arbitrary substring of a rule carries its surrounding conditions.
        const lines = statement.split('\n').map(line => line.trim()).filter(Boolean)
        const bullet = /^[-*•]\s+/u
        const entries = Array.isArray(value) ? value : lines.length > 1 && lines.every(line => bullet.test(line))
          ? lines.map(line => line.replace(bullet, '')) : []
        for (const entry of entries) if (normalize(entry)) worldFacts.add(normalize(entry))
      }
    },
    addEntity(entity, data) {
      entities.set(`entity:${entity.id}`, { entity, data })
      if (entity.kind === 'world' && !Object.keys(data).some(key => qualifier.test(key))) {
        for (const key of worldRuleFields) if (normalize(data[key])) worldFacts.add(normalize(data[key]))
      }
    },
    duplicate(row, value) {
      const fact = comparableFact(row, value)
      if (!fact) return false
      if (fact.key) return (fact.world && worldFacts.has(fact.statement)) || facts.has(fact.key)
      const linked = entities.get(fact.projection)
      return documents.get(fact.projection) === fact.statement
        || Boolean(linked && exactEntityProjection(linked.entity, linked.data, fact))
    },
    addFact(row, value) {
      const fact = comparableFact(row, value)
      if (fact?.key) {
        facts.add(fact.key)
        if (fact.world) worldFacts.add(fact.statement)
      }
      else if (fact?.projection?.startsWith('entity:')) entityProjections.set(fact.projection, fact)
    },
    compactLinkedFact(row, value) {
      if (row.kind !== 'fact' || row.status !== 'open' || !value.content || typeof value.content !== 'object') return value
      const fields = factFields.filter(key => Object.hasOwn(value.content, key))
      const field = fields.length === 1 ? fields[0] : ''
      const statement = normalize(value.content[field])
      if (!statement) return value
      let reference = ''
      if (documents.get(row.source_id) === statement) {
        reference = row.source_id.slice('document:'.length).replace(':', '.')
      } else {
        const explicit = typeof value.content.sourceEntityId === 'string' ? `entity:${value.content.sourceEntityId}` : ''
        if (explicit && row.source_id?.startsWith('entity:') && explicit !== row.source_id) return value
        const linked = entities.get(explicit || row.source_id)
        if (linked && ![...entities.values()].some(other => other !== linked && other.entity.title === linked.entity.title)) {
          const match = Object.entries(linked.data).find(([key, entry]) => !qualifier.test(key) && normalize(entry) === statement)
          if (match) reference = `设定《${linked.entity.title}》.${match[0]}`
        }
      }
      if (!reference) return value
      // Reuse only the identical sentence, never the source's scope. All of
      // this record's qualifiers and evidence stay with its own reference.
      return { ...value, content: { ...value.content, [field]: `见本请求的 ${reference}；本条的知情范围、生效条件和说明独立有效。` } }
    },
    compactEntity(entity, data) {
      if (Object.keys(data).some(key => qualifier.test(key))) return data
      const repeated = new Set(entity.kind === 'world'
        ? worldRuleFields.filter(key => worldFacts.has(normalize(data[key]))) : [])
      const projectedFields = planningEntityFactFields(entity.kind)
      if (exactEntityProjection(entity, data, entityProjections.get(`entity:${entity.id}`))
        && projectedFields.every(key => !data[key] || typeof data[key] === 'string')) {
        for (const key of projectedFields) if (normalize(data[key])) repeated.add(key)
      }
      if (!repeated.size) return data
      const next = { ...data }
      for (const key of repeated) delete next[key]
      return { ...next, 同源字段: `${[...repeated].join('、')}的相同内容已在前文提供。` }
    },
  }
}
