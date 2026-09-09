import { createHash } from 'node:crypto'
import { COMPACT_HANDOFF_MODE } from './chapter-handoff.js'
const parse = (text, fallback = {}) => { try { return JSON.parse(text) } catch { return fallback } }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const terms = text => [...new Set(String(text || '').match(/[\u3400-\u9fff]{2,4}|[a-z0-9_]{3,}/gi) || [])]
const score = (text, query) => query.reduce((n, word) => n + (String(text).includes(word) ? 1 : 0), 0)
const manualHandoff = (db, chapterId) => {
  const row = db.prepare("SELECT checks_json,source_digest FROM chapter_finalizations WHERE chapter_id=? AND completed_at<>'' ORDER BY completed_at DESC,rowid DESC LIMIT 1").get(chapterId)
  return row && parse(row.checks_json).manualFinalization ? { mode: 'author-direct', handoff: '未生成交接，请以当前正文为准，不推断已审稿或交接已确认', sourceDigest: row.source_digest } : null
}
const memoryValue = row => {
  const { authorCorrections, ...handoff } = parse(row.handoff_json)
  return { summary: row.summary, handoff, sourceDigest: row.source_digest }
}
const knowledgeValue = row => ({ title: row.title, content: typeof row.content_json === 'string' ? parse(row.content_json) : row.content,
  scope: parse(row.knowledge_scope_json, { author: true }), evidence: parse(row.evidence_json, []),
  effectiveFrom: row.effective_from_chapter, effectiveTo: row.effective_to_chapter, sourceDigest: row.source_digest })

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
  const chapterNo = chapter?.chapter_no || 1
  const query = terms([input.instruction, chapter?.title, chapter?.card_json, project.idea].join('\n'))
  const parts = [], sources = [], items = [], omitted = []
  const budget = Math.max(2000, Number(input.budget || 24000))
  function add(key, label, value, required = false, dependencyValue = value) {
    const text = `【${label}】\n${typeof value === 'string' ? value : JSON.stringify(value)}\n`
    if (parts.join('').length + text.length > budget) {
      if (required) throw new Error(`必需事实超出上下文预算（${budget}字符），请缩小当前创作范围：${label}`)
      omitted.push({ targetKey: key, reason: '上下文预算不足' }); return
    }
    const source = { targetKey: key, digest: hash(dependencyValue), required }
    parts.push(text); sources.push(source); items.push({ ...source, label, text })
  }
  add(`project:${project.id}:identity`, '任务与作品（作者设定）', { title: project.title, genre: project.genre, idea: project.idea }, true)
  if (chapter) add(`chapter:${chapter.id}:planning`, '当前章节目标与边界', { title: chapter.title, card: parse(chapter.card_json), scenes: parse(chapter.scene_plan, chapter.scene_plan) }, true)
  const documents = db.prepare('SELECT * FROM planning_documents WHERE project_id = ?').all(project.id)
  for (const doc of documents.filter(item => item.kind === 'foundation')) add(`planning_document:${project.id}:${doc.kind}`, '相关硬事实 · 故事基础', parse(doc.content_json), true)
  const world = documents.find(item => item.kind === 'world')
  if (world) { const data = parse(world.content_json); add(`planning_document:${project.id}:world-hardRules`, '世界硬规则与代价', { hardRules: data.hardRules || '', costs: data.costs || '', powerSystem: data.powerSystem || '' }, true) }
  const knowledge = db.prepare("SELECT * FROM knowledge_items WHERE project_id = ? AND status = 'open'").all(project.id).map(item => ({ ...item, content: parse(item.content_json) }))
    .filter(item => (item.effective_from_chapter == null || item.effective_from_chapter <= chapterNo) && (item.effective_to_chapter == null || item.effective_to_chapter >= chapterNo))
  for (const fact of knowledge.filter(item => item.kind === 'fact' && score(item.title + JSON.stringify(item.content), query) > 0)) add(`knowledge_item:${fact.id}:content`, '硬事实（知情范围以标记为准）', knowledgeValue(fact), true)
  const memories = db.prepare('SELECT * FROM chapter_memories WHERE project_id = ? AND chapter_no < ? AND confirmed = 1 AND needs_review = 0 ORDER BY chapter_no DESC').all(project.id, chapterNo)
  const previous = memories[0]
  if (previous) add(`chapter_memory:${previous.chapter_id}:handoff`, previous.chapter_no === chapterNo - 1 ? '上一章已确认交接' : `第 ${previous.chapter_no} 章最近有效交接（历史记录，非上一章最新状态）`, memoryValue(previous), true)
  for (const prior of db.prepare('SELECT id,chapter_no FROM chapters WHERE project_id=? AND chapter_no<? ORDER BY chapter_no').all(project.id, chapterNo)) {
    const skipped = manualHandoff(db, prior.id)
    if (skipped) add(`chapter:${prior.id}:manual-handoff`, `第 ${prior.chapter_no} 章人工定稿说明`, skipped, true)
  }
  // Delta handoffs leave history at its original source. Recall relevant earlier
  // records with their chapter scope, never present them as a new/current state.
  for (const memory of memories.slice(1).map(item => ({ ...item, rank: score(JSON.stringify(memoryValue(item)), query) }))
    .filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 4)) {
    add(`chapter_memory:${memory.chapter_id}:handoff`, `第 ${memory.chapter_no} 章相关已确认变化（历史证据，非当前全量状态）`,
      memoryValue(memory))
  }
  const entities = db.prepare('SELECT * FROM planning_entities WHERE project_id = ?').all(project.id)
    .map(item => ({ ...item, rank: score(item.title + item.data_json, query) })).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank)
  for (const entity of entities) add(`planning_entity:${entity.id}:data`, '相关人物与设定（非自动角色知情）', { title: entity.title, data: parse(entity.data_json) })
  for (const item of knowledge.filter(item => item.kind !== 'fact' && score(item.title + JSON.stringify(item.content), query) > 0)) {
    add(`knowledge_item:${item.id}:content`, '相关知识 / 伏笔', knowledgeValue(item))
  }
  const passages = db.prepare('SELECT id, chapter_no, manuscript FROM chapters WHERE project_id = ? AND chapter_no <= ?').all(project.id, chapterNo)
    .flatMap(item => String(item.manuscript).split(/\n\s*\n/).map((text, index) => ({ id: item.id, index, text, rank: score(text, query) })))
    .filter(item => item.text && item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 12)
  for (const passage of passages) add(`chapter:${passage.id}:paragraph-${passage.index}`, '相关正文证据（按段落召回）', passage.text)
  add(`project:${project.id}:style`, '作者文风（表达要求，不是剧情事实）', project.style || '')
  const samples = db.prepare('SELECT * FROM author_style_samples WHERE project_id = ? AND active = 1 ORDER BY updated_at DESC').all(project.id)
    .sort((a, b) => score(b.reason + b.text, query) - score(a.reason + a.text, query)).slice(0, 3)
  for (const sample of samples) add(`style_sample:${sample.id}:text`, '认可片段：只参考表达与取舍，不继承人物/事件/事实', { text: sample.text, reason: sample.reason })
  return { text: parts.join(''), sources, items, diagnostics: { budgetChars: budget, usedChars: parts.join('').length, omitted, truncated: omitted.length > 0, retrieval: 'local-entity-paragraph', globalDependencies: sources.filter(item => item.required).map(item => item.targetKey) } }
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
