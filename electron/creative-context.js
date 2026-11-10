import { createHash } from 'node:crypto'
import { COMPACT_HANDOFF_MODE } from './chapter-handoff.js'
import { shortStoryGuidance } from './work-format.js'
import { createDraftContextDeduper, isChapterFirstDraft } from './draft-context-dedupe.js'
const parse = (text, fallback = {}) => { try { return JSON.parse(text) } catch { return fallback } }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const terms = text => [...new Set(String(text || '').match(/[\u3400-\u9fff]{2,4}|[a-z0-9_]{3,}/gi) || [])]
const score = (text, query) => query.reduce((n, word) => n + (String(text).includes(word) ? 1 : 0), 0)
const manualHandoff = (db, chapterId) => {
  const row = db.prepare("SELECT checks_json,source_digest FROM chapter_finalizations WHERE chapter_id=? AND completed_at<>'' ORDER BY completed_at DESC,rowid DESC LIMIT 1").get(chapterId)
  return row && parse(row.checks_json).manualFinalization ? { mode: 'author-direct', handoff: '未生成交接，请以当前正文为准，不推断已审稿或交接已确认', sourceDigest: row.source_digest } : null
}
const manualHandoffIndex = (db, projectId, chapterNo) => db.prepare(`
  SELECT chapter.id, chapter.chapter_no, finalization.checks_json, finalization.source_digest
  FROM chapters chapter JOIN chapter_finalizations finalization ON finalization.chapter_id = chapter.id
  WHERE chapter.project_id = ? AND chapter.chapter_no < ? AND finalization.completed_at <> ''
    AND finalization.rowid = (SELECT latest.rowid FROM chapter_finalizations latest
      WHERE latest.chapter_id = chapter.id AND latest.completed_at <> ''
      ORDER BY latest.completed_at DESC, latest.rowid DESC LIMIT 1)
  ORDER BY chapter.chapter_no
`).all(projectId, chapterNo).filter(row => parse(row.checks_json).manualFinalization)
  .map(row => ({ chapterNo: row.chapter_no, sourceDigest: row.source_digest }))
const memoryValue = row => {
  const { authorCorrections, ...handoff } = parse(row.handoff_json)
  return { summary: row.summary, handoff, sourceDigest: row.source_digest }
}
export const knowledgeValue = row => ({ title: row.title, content: typeof row.content_json === 'string' ? parse(row.content_json) : row.content,
  scope: parse(row.knowledge_scope_json, { author: true }), evidence: parse(row.evidence_json, []),
  effectiveFrom: row.effective_from_chapter, effectiveTo: row.effective_to_chapter, sourceDigest: row.source_digest })

const localEntityFields = {
  character: ['role', 'personality', 'voice', 'motivation', 'boundaries', 'knowledgeBoundary', 'inheritedRules'],
  world: ['summary', 'hardRules', 'rules', 'trueRule', 'trigger', 'conditions', 'outcomes', 'effect', 'costs', 'limits', 'constraints', 'knowledgeBoundary'],
}
const localKnowledgeFields = ['statement', 'fact', 'rule', 'event', 'consequence', 'entryState', 'exitState', 'knowledgeBoundary', 'setup', 'payoff', 'summary', 'content']
const textValue = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
function localExcerpt(value, limit, anchors = []) {
  const text = textValue(value).trim()
  if (text.length <= limit) return text
  const hit = anchors.map(anchor => text.indexOf(anchor)).find(index => index >= 0)
  if (hit === undefined) {
    const head = Math.floor(limit * 0.7)
    return text.slice(0, head) + '…' + text.slice(-(limit - head - 1))
  }
  const start = Math.min(Math.max(0, hit - Math.floor(limit / 4)), text.length - limit)
  return (start ? '…' : '') + text.slice(start, start + limit - 2) + '…'
}

function buildLocalRevisionContext(db, project, chapter, { instruction, localRevision, styleText }) {
  const scope = localRevision.scope || {}
  const original = String(localRevision.text || chapter.manuscript || '')
  const focus = ['selection', 'scene'].includes(scope.kind) && Number.isInteger(scope.from) && Number.isInteger(scope.to)
    ? original.slice(Math.max(0, scope.from - 250), Math.min(original.length, scope.to + 250)) : original
  const query = [instruction, chapter.title, focus].join('\n')
  const names = title => {
    const name = String(title || '').trim()
    return [...new Set([name, name.split(/[（(]/u)[0]].map(value => value.trim().replace(/^[【《「]|[】》」]$/gu, '')))]
      .filter(value => value.length >= 2)
  }
  const entities = db.prepare("SELECT * FROM planning_entities WHERE project_id=? AND kind IN ('character','world')").all(project.id)
    .map(row => ({ row, hits: names(row.title).filter(name => query.includes(name)) }))
    .filter(({ hits }) => hits.length)
    .sort((a, b) => Number(String(instruction || '').includes(b.hits[0])) - Number(String(instruction || '').includes(a.hits[0])))
  const anchors = [...new Set([...terms(instruction).slice(0, 12), ...entities.flatMap(x => x.hits)])]
  const seen = new Set(), items = [], sources = []
  function add(targetKey, label, text, dependency, required = false) {
    if (!text) return
    const rendered = `【${label}】\n${text}\n`
    const source = { targetKey, digest: hash(dependency), promptDigest: hash(rendered), required }
    sources.push(source)
    items.push({ ...source, label, text: rendered })
  }
  function fields(value, keys, limit, matches = anchors, scopeKey = '') {
    const lines = []
    for (const key of keys) {
      const content = textValue(value?.[key]).trim()
      if (!content) continue
      const identity = scopeKey + '\0' + content.replace(/\s+/g, ' ')
      if (seen.has(identity)) continue
      seen.add(identity)
      lines.push(`${key}：${localExcerpt(content, limit, matches)}`)
    }
    return lines.join('\n')
  }
  const identity = { title: project.title, genre: project.genre, idea: project.idea }
  add(`project:${project.id}:identity`, '当前作品', `${project.title} · ${project.genre}\n${localExcerpt(project.idea, 600, anchors)}`, identity, true)
  const style = project.style || ''
  add(`project:${project.id}:style`, '本次文风要求（不作为剧情事实）', localExcerpt(styleText || style, 3600, anchors), style, true)
  const planning = { title: chapter.title, card: parse(chapter.card_json), scenes: parse(chapter.scene_plan, chapter.scene_plan) }
  add(`chapter:${chapter.id}:planning`, '当前章节目标与边界',
    [planning.title, fields(planning.card, ['goal', 'ending', 'executionNotes', 'protagonistGoal', 'resistance', 'turningPoint'], 500),
      localExcerpt(planning.scenes, 1000, anchors)].filter(Boolean).join('\n'), planning, true)
  const world = db.prepare("SELECT content_json FROM planning_documents WHERE project_id=? AND kind='world'").get(project.id)
  if (world) {
    const data = parse(world.content_json)
    const rules = { hardRules: data.hardRules || '', costs: data.costs || '', powerSystem: data.powerSystem || '' }
    add(`planning_document:${project.id}:world-hardRules`, '世界硬规则摘录', fields(rules, Object.keys(rules), 800), rules)
  }
  const adjacent = db.prepare("SELECT id,chapter_no,manuscript FROM chapters WHERE project_id=? AND chapter_no IN (?,?) ORDER BY chapter_no")
    .all(project.id, chapter.chapter_no - 1, chapter.chapter_no + 1)
  for (const row of adjacent) {
    const previous = row.chapter_no < chapter.chapter_no
    const prose = String(row.manuscript || '').trim()
    add(`chapter:${row.id}:manuscript`, previous ? '前一章结尾（衔接参考）' : '后一章开头（仅供衔接，不是当前人物已知事实）',
      previous ? prose.slice(-800) : prose.slice(0, 800), row.manuscript)
  }
  for (const { row, hits } of entities.slice(0, 8)) {
    const data = parse(row.data_json)
    add(`planning_entity:${row.id}:data`, `本章相关设定 · ${row.title}`, fields(data, localEntityFields[row.kind], 350, [...hits, ...anchors]), { title: row.title, data })
  }
  const knowledge = db.prepare("SELECT * FROM knowledge_items WHERE project_id=? AND status='open'").all(project.id)
    .filter(row => (row.effective_from_chapter == null || row.effective_from_chapter <= chapter.chapter_no)
      && (row.effective_to_chapter == null || row.effective_to_chapter >= chapter.chapter_no))
    .map(row => {
      const value = knowledgeValue(row)
      const atChapter = Number(value.content?.chapterNo) || 0
      const direct = names(row.title).some(name => query.includes(name))
      const hit = score(localKnowledgeFields.map(key => textValue(value.content?.[key])).join(' '), anchors)
      return { row, value, rank: atChapter > chapter.chapter_no ? 0 : (direct ? 20 : 0) + (atChapter === chapter.chapter_no ? 12 : 0) + Math.min(hit, 5) }
    }).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 10)
  for (const { row, value } of knowledge) {
    const scopeKey = JSON.stringify(value.scope)
    const data = typeof value.content === 'string' ? { content: value.content } : value.content
    const excerpt = fields(data, localKnowledgeFields, 220, anchors, value.scope?.author === true && Object.keys(value.scope).length === 1 ? '' : scopeKey)
    if (excerpt) add(`knowledge_item:${row.id}:content`, `相关知识 · ${row.title}`,
      `知情范围：${scopeKey}\n${excerpt}`, value)
  }
  const text = items.map(item => item.text).join('')
  return { text, items, sources, diagnostics: { retrieval: 'local-revision', scoped: true, usedChars: text.length, omitted: [], truncated: false } }
}

// This is a retrieval view of existing facts, not a second truth store.
export function buildCreativeContext(db, input = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(input.projectId)
  const chapter = db.prepare('SELECT * FROM chapters WHERE project_id = ? AND id = ?').get(input.projectId, input.chapterId || '')
  if (!project) throw new Error('创作项目不存在')
  if (input.task === 'chapter_state_extract' && input.chapterStateMode === COMPACT_HANDOFF_MODE) {
    if (!chapter) throw new Error('交接提取需要当前项目的锁定章节')
    const source = { targetKey: `chapter:${chapter.id}:manuscript`, digest: hash(chapter.manuscript), required: true }
    return { text: '', sources: [source], items: [{ ...source, label: '锁定正文', text: String(chapter.manuscript || '') }],
      diagnostics: { retrieval: 'locked-manuscript-only', omitted: [], truncated: false } }
  }
  if (input.localRevision && chapter) return buildLocalRevisionContext(db, project, chapter, input)
  const chapterNo = chapter?.chapter_no || 1
  const query = terms([input.instruction, chapter?.title, chapter?.card_json, project.idea].join('\n'))
  const parts = [], sources = [], items = [], omitted = [], deduplicated = []
  const deduper = isChapterFirstDraft(input, chapter) ? createDraftContextDeduper() : null
  const budget = input.budget === null ? null : Math.max(2000, Number(input.budget || 24000))
  let usedChars = 0
  function add(key, label, value, required = false, dependencyValue = value) {
    const text = `【${label}】\n${typeof value === 'string' ? value : JSON.stringify(value)}\n`
    if (budget !== null && usedChars + text.length > budget) {
      if (required) throw new Error(`必需事实超出上下文预算（${budget}字符），请缩小当前创作范围：${label}`)
      omitted.push({ targetKey: key, reason: '上下文预算不足' }); return false
    }
    const source = { targetKey: key, digest: hash(dependencyValue), required }
    if (deduper) source.promptDigest = hash(text)
    usedChars += text.length
    parts.push(text); sources.push(source); items.push({ ...source, label, text })
    return true
  }
  add(`project:${project.id}:identity`, '任务与作品（作者设定）', { title: project.title, genre: project.genre, idea: project.idea }, true)
  if (shortStoryGuidance(project)) add(`project:${project.id}:work-format`, '短故事篇幅与结构', shortStoryGuidance(project), true)
  if (chapter) add(`chapter:${chapter.id}:planning`, '当前章节目标与边界', { title: chapter.title, card: parse(chapter.card_json), scenes: parse(chapter.scene_plan, chapter.scene_plan) }, true)
  const documents = db.prepare('SELECT * FROM planning_documents WHERE project_id = ?').all(project.id)
  for (const doc of documents.filter(item => item.kind === 'foundation')) {
    const data = parse(doc.content_json)
    if (add(`planning_document:${project.id}:${doc.kind}`, '相关硬事实 · 故事基础', data, true)) deduper?.addDocument(doc.kind, data)
  }
  const world = documents.find(item => item.kind === 'world')
  if (world) {
    const data = parse(world.content_json)
    const rules = { hardRules: data.hardRules || '', costs: data.costs || '', powerSystem: data.powerSystem || '' }
    if (add(`planning_document:${project.id}:world-hardRules`, '世界硬规则与代价', rules, true)) deduper?.addDocument(world.kind, rules)
  }
  add(`project:${project.id}:style`, '作者文风（表达要求，不是剧情事实）', project.style || '', true)
  const entities = db.prepare('SELECT * FROM planning_entities WHERE project_id = ?').all(project.id)
    .map(item => ({ ...item, rank: score(item.title + item.data_json, query) })).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank)
    .map(item => ({ ...item, data: parse(item.data_json) }))
  // With no character budget every matched entity below will be rendered.
  // Under a finite budget optional entities might be omitted, so do not
  // reference them from an earlier required fact.
  if (deduper && budget === null) for (const entity of entities) deduper.addEntity(entity, entity.data)
  const knowledge = db.prepare("SELECT * FROM knowledge_items WHERE project_id = ? AND status = 'open'").all(project.id).map(item => ({ ...item, content: parse(item.content_json) }))
    .filter(item => (item.effective_from_chapter == null || item.effective_from_chapter <= chapterNo) && (item.effective_to_chapter == null || item.effective_to_chapter >= chapterNo))
  for (const fact of knowledge.filter(item => item.kind === 'fact' && score(item.title + JSON.stringify(item.content), query) > 0)) {
    const key = `knowledge_item:${fact.id}:content`
    const value = knowledgeValue(fact)
    if (deduper?.duplicate(fact, value)) {
      // Keep dependency tracking even when this copy adds no prompt text.
      sources.push({ targetKey: key, digest: hash(value), required: true })
      deduplicated.push(key)
    } else {
      const rendered = deduper?.compactLinkedFact(fact, value) || value
      if (add(key, '硬事实（知情范围以标记为准）', rendered, true, value)) {
        if (rendered !== value) deduplicated.push(key)
        deduper?.addFact(fact, value)
      }
    }
  }
  const memories = db.prepare('SELECT * FROM chapter_memories WHERE project_id = ? AND chapter_no < ? AND confirmed = 1 AND needs_review = 0 ORDER BY chapter_no DESC').all(project.id, chapterNo)
  const previous = memories[0]
  if (previous) add(`chapter_memory:${previous.chapter_id}:handoff`, previous.chapter_no === chapterNo - 1 ? '上一章已确认交接' : `第 ${previous.chapter_no} 章最近有效交接（历史记录，非上一章最新状态）`, memoryValue(previous), true)
  const manualIndex = manualHandoffIndex(db, project.id, chapterNo)
  if (chapter && manualIndex.length) add(`chapter:${chapter.id}:manual-handoff-index`, '人工定稿章节',
    `第 ${manualIndex.map(item => item.chapterNo).join('、')} 章由作者直接定稿，未经过审稿、未生成交接；相关事实以已确认正文为准。`, true, manualIndex)
  // Delta handoffs leave history at its original source. Recall relevant earlier
  // records with their chapter scope, never present them as a new/current state.
  for (const memory of memories.slice(1).map(item => ({ ...item, rank: score(JSON.stringify(memoryValue(item)), query) }))
    .filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 4)) {
    add(`chapter_memory:${memory.chapter_id}:handoff`, `第 ${memory.chapter_no} 章相关已确认变化（历史证据，非当前全量状态）`,
      memoryValue(memory))
  }
  for (const entity of entities) {
    const data = entity.data
    const compacted = budget === null ? data : deduper?.compactEntity(entity, data) || data
    const key = `planning_entity:${entity.id}:data`
    if (add(key, '相关人物与设定（非自动角色知情）', { title: entity.title, data: compacted }, false, { title: entity.title, data })
      && compacted !== data) deduplicated.push(key)
  }
  for (const item of knowledge.filter(item => item.kind !== 'fact' && score(item.title + JSON.stringify(item.content), query) > 0)) {
    add(`knowledge_item:${item.id}:content`, '相关知识 / 伏笔', knowledgeValue(item))
  }
  const passages = db.prepare('SELECT id, chapter_no, manuscript FROM chapters WHERE project_id = ? AND chapter_no <= ?').all(project.id, chapterNo)
    .flatMap(item => String(item.manuscript).split(/\n\s*\n/).map((text, index) => ({ id: item.id, index, text, rank: score(text, query) })))
    .filter(item => item.text && item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 12)
  for (const passage of passages) add(`chapter:${passage.id}:paragraph-${passage.index}`, '相关正文证据（按段落召回）', passage.text)
  const samples = db.prepare('SELECT * FROM author_style_samples WHERE project_id = ? AND active = 1 ORDER BY updated_at DESC').all(project.id)
    .sort((a, b) => score(b.reason + b.text, query) - score(a.reason + a.text, query)).slice(0, 3)
  for (const sample of samples) add(`style_sample:${sample.id}:text`, '认可片段：只参考表达与取舍，不继承人物/事件/事实', { text: sample.text, reason: sample.reason })
  return { text: parts.join(''), sources, items, diagnostics: { budgetChars: budget, usedChars, omitted, ...(deduper ? { deduplicated } : {}), truncated: omitted.length > 0, retrieval: 'local-entity-paragraph', globalDependencies: sources.filter(item => item.required).map(item => item.targetKey) } }
}

export function contextDependencyDigest(context) { return hash(context.sources.map(item => [item.targetKey, item.digest])) }

export function recordCreativeDependencies(db, { projectId, artifactKind, artifactId, sources }) {
  const insert = db.prepare(`INSERT INTO creative_dependencies (id, project_id, artifact_kind, artifact_id, target_key, source_digest, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(artifact_kind, artifact_id, target_key) DO UPDATE SET source_digest=excluded.source_digest, evidence_json=excluded.evidence_json`)
  for (const source of sources) insert.run(hash([artifactKind, artifactId, source.targetKey]), projectId, artifactKind, artifactId, source.targetKey, source.digest, JSON.stringify(source), new Date().toISOString())
}

function dependencyValue(db, key) {
  const [kind, id, field] = key.split(':')
  if (kind === 'project') {
    const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id)
    if (field === 'work-format') return row ? shortStoryGuidance(row) : null
    return !row ? null : field === 'style' ? row.style || '' : { title: row.title, genre: row.genre, idea: row.idea }
  }
  if (kind === 'planning_document') {
    const row = db.prepare('SELECT content_json FROM planning_documents WHERE project_id=? AND kind=?').get(id, field === 'world-hardRules' ? 'world' : field)
    if (!row) return null
    const value = parse(row.content_json)
    return field === 'world-hardRules' ? { hardRules: value.hardRules || '', costs: value.costs || '', powerSystem: value.powerSystem || '' } : value
  }
  if (kind === 'chapter') {
    const row = db.prepare('SELECT * FROM chapters WHERE id=?').get(id)
    if (!row) return null
    if (field === 'manuscript') return row.manuscript
    if (field === 'manual-handoff-index') return manualHandoffIndex(db, row.project_id, row.chapter_no)
    if (field === 'manual-handoff') return manualHandoff(db, id)
    return field === 'planning' ? { title: row.title, card: parse(row.card_json), scenes: parse(row.scene_plan, row.scene_plan) }
      : row.manuscript.split(/\n\s*\n/)[Number(field.replace('paragraph-', ''))] ?? null
  }
  if (kind === 'planning_entity') {
    const row = db.prepare('SELECT * FROM planning_entities WHERE id=?').get(id)
    return row ? { title: row.title, data: parse(row.data_json) } : null
  }
  if (kind === 'chapter_memory') {
    const row = db.prepare('SELECT * FROM chapter_memories WHERE chapter_id=? AND confirmed=1 AND needs_review=0').get(id)
    return row ? memoryValue(row) : null
  }
  if (kind === 'style_sample') {
    const row = db.prepare('SELECT * FROM author_style_samples WHERE id=? AND active=1').get(id)
    return row ? { text: row.text, reason: row.reason } : null
  }
  if (kind === 'knowledge_item') {
    const row = db.prepare("SELECT * FROM knowledge_items WHERE id=? AND status='open'").get(id)
    if (!row) return null
    return knowledgeValue(row)
  }
  return undefined
}

export function dependencyDigest(db, key) {
  const value = dependencyValue(db, key)
  return value === undefined ? null : hash(value)
}

export function invalidateCreativeDependencies(db, projectId, { excludeArtifactId = '' } = {}) {
  const changed = db.prepare('SELECT * FROM creative_dependencies WHERE project_id=?').all(projectId)
    .filter(row => { const current = dependencyValue(db, row.target_key); return row.artifact_id !== excludeArtifactId && current !== undefined && hash(current) !== row.source_digest })
  for (const row of changed) {
    const reason = `实际依赖已变化：${row.target_key}`
    if (row.artifact_kind === 'candidate') db.prepare("UPDATE agent_candidates SET status='stale', override_reason=? WHERE id=? AND status='pending'").run(reason, row.artifact_id)
    if (row.artifact_kind === 'finalization') {
      db.prepare("UPDATE chapter_finalizations SET status='stale', error=? WHERE id=? AND status NOT IN ('cancelled','stale')").run(reason, row.artifact_id)
      // A historical record must not dirty a newer confirmed/corrected version.
      db.prepare('UPDATE chapter_memories SET needs_review=1 WHERE confirmed=1 AND source_revision_id=(SELECT revision_id FROM chapter_finalizations WHERE id=?)').run(row.artifact_id)
      db.prepare(`UPDATE chapters SET status='draft' WHERE status='completed'
        AND (SELECT id FROM chapter_finalizations WHERE chapter_id=chapters.id AND completed_at<>'' ORDER BY completed_at DESC,rowid DESC LIMIT 1)=?
        AND id IN (SELECT chapter_id FROM chapter_memories WHERE source_revision_id=(SELECT revision_id FROM chapter_finalizations WHERE id=?) AND needs_review=1)`)
        .run(row.artifact_id, row.artifact_id)
    }
    if (row.artifact_kind === 'review') db.prepare("UPDATE quality_reports SET aggregate_json=json_set(aggregate_json, '$.stale', json('true'), '$.automaticPassed', json('false'), '$.finalPassed', json('false'), '$.staleReason', ?) WHERE id=?").run(reason, row.artifact_id)
  }
  return changed.map(row => ({ artifactId: row.artifact_id, targetKey: row.target_key }))
}
