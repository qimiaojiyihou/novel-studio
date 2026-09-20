import { createHash, randomUUID } from 'node:crypto'
import { createWorkspaceRepository } from './workspace-repository.js'
import { createPlanningRepository } from './planning-repository.js'
import { createKnowledgeRepository } from './knowledge-repository.js'

const ENTITY_KINDS = new Set(['character', 'world', 'volume'])
const KNOWLEDGE_KINDS = new Set(['fact', 'timeline', 'foreshadow'])
const PACKAGE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/
const REF_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024

function stamp() { return new Date().toISOString() }
function parseJson(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback } catch { return fallback } }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}
function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }
function cleanText(value, fallback = '') { const text = String(value ?? '').trim(); return text || fallback }
function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}需要是 JSON 对象`)
  return value
}
function listValue(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}需要是数组`)
  return value
}
function boundedText(value, label, max = 400) {
  const text = cleanText(value)
  if (!text) throw new Error(`${label}不能为空`)
  if (text.length > max) throw new Error(`${label}过长`)
  return text
}
function normalizeRef(value, label) {
  const ref = boundedText(value, label, 120)
  if (!REF_VALUE.test(ref)) throw new Error(`${label}只能使用字母、数字、点、下划线、冒号或短横线`)
  return ref
}

export function parseWorkDesignPackage(text) {
  const source = String(text || '').trim()
  if (!source) throw new Error('请粘贴 ChatGPT Work 返回的同步包')
  if (Buffer.byteLength(source, 'utf8') > MAX_PACKAGE_BYTES) throw new Error('同步包超过 2 MB，请拆分后重试')
  let json = source
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) json = fenced[1]
  let value
  try { value = JSON.parse(json) } catch { throw new Error('同步包不是有效 JSON；请让 ChatGPT Work 只返回 JSON 对象') }
  return normalizePackage(value)
}

export function normalizePackage(raw) {
  objectValue(raw, '同步包')
  if (Number(raw.schemaVersion) !== 1) throw new Error('当前仅支持 schemaVersion 1 的同步包')
  const packageVersion = boundedText(raw.packageVersion, 'packageVersion', 80)
  if (!PACKAGE_VERSION.test(packageVersion)) throw new Error('packageVersion 格式无效')
  const projectInput = raw.project === undefined ? {} : objectValue(raw.project, 'project')
  const project = Object.fromEntries(['genre', 'idea', 'style']
    .filter(key => typeof projectInput[key] === 'string' && projectInput[key].trim())
    .map(key => [key, projectInput[key].trim()]))
  const documentInput = raw.documents === undefined ? {} : objectValue(raw.documents, 'documents')
  for (const key of Object.keys(documentInput)) if (!['foundation', 'world', 'outline'].includes(key)) throw new Error(`不支持规划文档 ${key}`)
  const documents = Object.fromEntries(Object.entries(documentInput)
    .filter(([, content]) => Object.keys(objectValue(content, '规划文档内容')).length))
  const refs = new Set()
  const uniqueRef = (value, label) => {
    const ref = normalizeRef(value, label)
    if (refs.has(ref)) throw new Error(`同步包中存在重复 ref：${ref}`)
    refs.add(ref)
    return ref
  }
  const entities = listValue(raw.entities, 'entities').map((item, index) => {
    objectValue(item, `entities[${index}]`)
    if (!ENTITY_KINDS.has(item.kind)) throw new Error(`entities[${index}].kind 不受支持`)
    return { ref:uniqueRef(item.ref, `entities[${index}].ref`), kind:item.kind, title:boundedText(item.title, `entities[${index}].title`), data:objectValue(item.data || {}, `entities[${index}].data`) }
  })
  const chapters = listValue(raw.chapters, 'chapters').map((item, index) => {
    objectValue(item, `chapters[${index}]`)
    return { ref:uniqueRef(item.ref, `chapters[${index}].ref`), title:boundedText(item.title, `chapters[${index}].title`), card:objectValue(item.card || {}, `chapters[${index}].card`),
      ...(Object.hasOwn(item, 'scenePlan') ? { scenePlan:item.scenePlan } : {}) }
  })
  const relationships = listValue(raw.relationships, 'relationships').map((item, index) => {
    objectValue(item, `relationships[${index}]`)
    return { ...item, ref:uniqueRef(item.ref, `relationships[${index}].ref`), fromRef:normalizeRef(item.fromRef, `relationships[${index}].fromRef`), toRef:normalizeRef(item.toRef, `relationships[${index}].toRef`), label:boundedText(item.label, `relationships[${index}].label`) }
  })
  const arcs = listValue(raw.arcs, 'arcs').map((item, index) => {
    objectValue(item, `arcs[${index}]`)
    const ref = uniqueRef(item.ref, `arcs[${index}].ref`)
    const beats = listValue(item.beats, `arcs[${index}].beats`).map((beat, beatIndex) => {
      objectValue(beat, `arcs[${index}].beats[${beatIndex}]`)
      return { ...beat, ref:uniqueRef(beat.ref, `arcs[${index}].beats[${beatIndex}].ref`), label:boundedText(beat.label, `arcs[${index}].beats[${beatIndex}].label`) }
    })
    return { ...item, ref, title:boundedText(item.title, `arcs[${index}].title`), beats }
  })
  const knowledge = listValue(raw.knowledge, 'knowledge').map((item, index) => {
    objectValue(item, `knowledge[${index}]`)
    if (!KNOWLEDGE_KINDS.has(item.kind)) throw new Error(`knowledge[${index}].kind 不受支持`)
    return { ...item, ref:uniqueRef(item.ref, `knowledge[${index}].ref`), title:boundedText(item.title, `knowledge[${index}].title`), content:objectValue(item.content || {}, `knowledge[${index}].content`) }
  })
  return {
    schemaVersion:1,
    packageVersion,
    baseVersion:cleanText(raw.baseVersion),
    sourceThreadId:cleanText(raw.sourceThreadId),
    projectId:cleanText(raw.projectId),
    summary:cleanText(raw.summary),
    project,
    documents,
    entities,
    chapters,
    relationships,
    arcs,
    knowledge,
  }
}

function publicBinding(row) {
  return row ? {
    projectId:row.project_id, threadId:row.thread_id, threadTitle:row.thread_title,
    lastAppliedVersion:row.last_applied_version, lastAppliedDigest:row.last_applied_digest,
    createdAt:row.created_at, updatedAt:row.updated_at,
  } : null
}
function publicPackage(row) {
  return row ? {
    id:row.id, projectId:row.project_id, packageVersion:row.package_version, baseVersion:row.base_version,
    digest:row.package_digest, sourceDigest:row.source_digest, previewDigest:row.preview_digest,
    status:row.status, summary:row.summary, preview:parseJson(row.preview_json, {}),
    results:parseJson(row.results_json, {}), error:parseJson(row.error_json, {}),
    createdAt:row.created_at, updatedAt:row.updated_at, appliedAt:row.applied_at,
  } : null
}

export class WorkDesignSync {
  constructor({ database, snapshot, queue, onChange = () => {} }) {
    Object.assign(this, { db:database, snapshot, queue, onChange })
    this.workspace = createWorkspaceRepository(database)
    this.planning = createPlanningRepository(database)
    this.knowledge = createKnowledgeRepository(database)
    this.db.prepare(`UPDATE work_design_packages
      SET status='failed',error_json=?,updated_at=? WHERE status='applying'`)
      .run(JSON.stringify({ message:'应用在写入过程中退出；请重新检查后继续' }), stamp())
  }

  assertProject(projectId) {
    const row = this.db.prepare("SELECT id,title FROM projects WHERE id=? AND project_type='user' AND archived_at='' ").get(projectId)
    if (!row) throw new Error('项目不存在或已归档')
    return row
  }

  state(projectId) {
    this.assertProject(projectId)
    const binding = this.db.prepare('SELECT * FROM work_design_bindings WHERE project_id=?').get(projectId)
    const packages = this.db.prepare('SELECT * FROM work_design_packages WHERE project_id=? ORDER BY created_at DESC LIMIT 30').all(projectId)
    return { binding:publicBinding(binding), packages:packages.map(publicPackage) }
  }

  saveBinding({ projectId, threadId, threadTitle = '' }) {
    const project = this.assertProject(projectId)
    const id = boundedText(threadId, 'ChatGPT Work 对话 ID 或链接', 1000)
    const current = this.db.prepare('SELECT * FROM work_design_bindings WHERE project_id=?').get(projectId)
    if (current?.last_applied_version && current.thread_id !== id) throw new Error('已有同步记录时不可更换来源对话；请继续使用原对话，或新建书籍项目')
    const now = stamp()
    this.db.prepare(`INSERT INTO work_design_bindings(project_id,thread_id,thread_title,created_at,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET thread_id=excluded.thread_id,thread_title=excluded.thread_title,updated_at=excluded.updated_at`)
      .run(projectId, id, cleanText(threadTitle, `${project.title} · ChatGPT Work`), current?.created_at || now, now)
    return publicBinding(this.db.prepare('SELECT * FROM work_design_bindings WHERE project_id=?').get(projectId))
  }

  prompt(projectId) {
    const project = this.assertProject(projectId)
    const binding = this.db.prepare('SELECT * FROM work_design_bindings WHERE project_id=?').get(projectId)
    if (!binding) throw new Error('请先绑定 ChatGPT Work 对话')
    const base = binding.last_applied_version || ''
    return [
      `为 Novel Studio 项目《${project.title}》发布一个增量设计同步包。`,
      `sourceThreadId 必须填写：${binding.thread_id}`,
      `projectId 必须填写：${projectId}`,
      `baseVersion 必须填写：${base}`,
      '',
      '只包含自上一个同步版本以来已经确认的变化；不要包含讨论草案。只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码围栏。',
      'packageVersion 使用新的稳定版本号，例如 RW-20260921-001。ref 是同一对象跨版本不变的英文或数字标识。不得输出正文和删除指令。',
      '',
      '{',
      '  "schemaVersion": 1,',
      '  "packageVersion": "RW-YYYYMMDD-001",',
      `  "baseVersion": ${JSON.stringify(base)},`,
      `  "sourceThreadId": ${JSON.stringify(binding.thread_id)},`,
      `  "projectId": ${JSON.stringify(projectId)},`,
      '  "summary": "本轮确认的设计变化",',
      '  "project": { "genre": "", "idea": "", "style": "" },',
      '  "documents": { "foundation": {}, "world": {}, "outline": {} },',
      '  "entities": [{ "ref": "character.protagonist", "kind": "character", "title": "人物名", "data": {} }],',
      '  "chapters": [{ "ref": "chapter.001", "title": "章节名", "card": {}, "scenePlan": "" }],',
      '  "relationships": [{ "ref": "relationship.a-b", "fromRef": "character.a", "toRef": "character.b", "label": "关系", "surface": "", "tension": "", "direction": "mutual", "trend": "stable", "status": "active" }],',
      '  "arcs": [{ "ref": "arc.main", "title": "主线", "category": "main", "premise": "", "destination": "", "status": "planned", "colorKey": "copper", "beats": [{ "ref": "beat.main.001", "label": "关键变化", "changeText": "", "volumeRef": "volume.001", "chapterRef": "chapter.001" }] }],',
      '  "knowledge": [{ "ref": "fact.identity", "kind": "fact", "title": "事实", "content": {}, "status": "open" }]',
      '}',
      '',
      '没有变化的顶层字段可省略或填写空数组/空对象。人物关系只能引用 character ref；节点可引用 volume 或 chapter ref。',
    ].join('\n')
  }

  objectMap(projectId) {
    return new Map(this.db.prepare('SELECT object_type,external_ref,target_id FROM work_design_objects WHERE project_id=?').all(projectId)
      .map(row => [`${row.object_type}:${row.external_ref}`, row.target_id]))
  }

  findAdoption(projectId, type, item) {
    if (type === 'entity') {
      const rows = this.db.prepare('SELECT id FROM planning_entities WHERE project_id=? AND kind=? AND title=?').all(projectId, item.kind, item.title)
      return rows.length === 1 ? rows[0].id : rows.length > 1 ? 'ambiguous' : ''
    }
    if (type === 'chapter') {
      const rows = this.db.prepare('SELECT id FROM chapters WHERE project_id=? AND title=?').all(projectId, item.title)
      return rows.length === 1 ? rows[0].id : rows.length > 1 ? 'ambiguous' : ''
    }
    if (type === 'arc') {
      const rows = this.db.prepare('SELECT id FROM story_arcs WHERE project_id=? AND title=?').all(projectId, item.title)
      return rows.length === 1 ? rows[0].id : rows.length > 1 ? 'ambiguous' : ''
    }
    if (type === 'knowledge') {
      const rows = this.db.prepare('SELECT id FROM knowledge_items WHERE project_id=? AND kind=? AND title=?').all(projectId, item.kind, item.title)
      return rows.length === 1 ? rows[0].id : rows.length > 1 ? 'ambiguous' : ''
    }
    return ''
  }

  plan(projectId, value) {
    const mapped = this.objectMap(projectId)
    const planned = new Map(mapped)
    const adopted = new Set()
    const changes = []
    const conflicts = []
    const add = (type, ref, label, payload) => {
      const key = ref ? `${type}:${ref}` : ''
      let targetId = key ? planned.get(key) || '' : ''
      let action = targetId ? (adopted.has(key) ? 'match' : 'update') : 'create'
      if (!targetId && ['entity','chapter','arc','knowledge'].includes(type)) {
        const adoptionTarget = this.findAdoption(projectId, type, payload)
        if (adoptionTarget === 'ambiguous') conflicts.push({ type, ref, message:`“${label}”存在多个同名对象，无法自动绑定` })
        else if (adoptionTarget) { targetId=adoptionTarget; action='match'; planned.set(key, adoptionTarget); adopted.add(key) }
      }
      if (!targetId && action === 'create' && key) planned.set(key, `planned:${key}`)
      changes.push({ opId:`${type}:${ref || label}`, type, ref:ref || '', label, action, targetId:targetId || '', payload })
    }
    if (Object.keys(value.project).length) changes.push({ opId:'project', type:'project', ref:'', label:'项目元信息', action:'update', targetId:projectId, payload:value.project })
    for (const [kind, content] of Object.entries(value.documents)) add('document', kind, ({foundation:'故事基础',world:'世界设定',outline:'故事总纲'})[kind], { kind, content })
    value.entities.forEach(item => add('entity', item.ref, item.title, item))
    value.chapters.forEach(item => add('chapter', item.ref, item.title, item))
    value.relationships.forEach(item => {
      for (const ref of [item.fromRef, item.toRef]) if (!planned.has(`entity:${ref}`)) conflicts.push({ type:'relationship', ref:item.ref, message:`人物关系引用了未绑定人物 ${ref}` })
      const relationshipKey = `relationship:${item.ref}`
      if (!planned.has(relationshipKey)) {
        const fromId = planned.get(`entity:${item.fromRef}`), toId = planned.get(`entity:${item.toRef}`)
        if (fromId && toId && !String(fromId).startsWith('planned:') && !String(toId).startsWith('planned:')) {
          const rows = this.db.prepare(`SELECT id FROM character_relationships WHERE project_id=? AND
            ((from_character_id=? AND to_character_id=?) OR (from_character_id=? AND to_character_id=?))`).all(projectId,fromId,toId,toId,fromId)
          if (rows.length === 1) { planned.set(relationshipKey, rows[0].id); adopted.add(relationshipKey) }
          else if (rows.length > 1) conflicts.push({ type:'relationship', ref:item.ref, message:`人物关系“${item.label}”存在多个候选对象` })
        }
      }
      add('relationship', item.ref, item.label, item)
    })
    value.arcs.forEach(item => {
      add('arc', item.ref, item.title, item)
      item.beats.forEach(beat => {
        if (beat.volumeRef && !planned.has(`entity:${beat.volumeRef}`)) conflicts.push({ type:'beat', ref:beat.ref, message:`情节节点引用了未绑定分卷 ${beat.volumeRef}` })
        if (beat.chapterRef && !planned.has(`chapter:${beat.chapterRef}`)) conflicts.push({ type:'beat', ref:beat.ref, message:`情节节点引用了未绑定章节 ${beat.chapterRef}` })
        const beatKey = `beat:${beat.ref}`, arcId = planned.get(`arc:${item.ref}`)
        if (!planned.has(beatKey) && arcId && !String(arcId).startsWith('planned:')) {
          const rows = this.db.prepare('SELECT id FROM story_arc_beats WHERE arc_id=? AND label=?').all(arcId,beat.label)
          if (rows.length === 1) { planned.set(beatKey,rows[0].id); adopted.add(beatKey) }
          else if (rows.length > 1) conflicts.push({ type:'beat', ref:beat.ref, message:`情节节点“${beat.label}”存在多个候选对象` })
        }
        add('beat', beat.ref, beat.label, { ...beat, arcRef:item.ref })
      })
    })
    value.knowledge.forEach(item => add('knowledge', item.ref, item.title, item))
    if (!changes.length) conflicts.push({ type:'package', ref:'', message:'同步包没有任何可写入的设计变化' })
    return { changes, conflicts }
  }

  async preview({ projectId, packageText }) {
    const project = this.assertProject(projectId)
    const binding = this.db.prepare('SELECT * FROM work_design_bindings WHERE project_id=?').get(projectId)
    if (!binding) throw new Error('请先绑定 ChatGPT Work 对话')
    const value = parseWorkDesignPackage(packageText)
    if (value.projectId && value.projectId !== projectId) throw new Error('同步包绑定的 Novel Studio 项目 ID 不一致')
    if (!value.sourceThreadId || value.sourceThreadId !== binding.thread_id) throw new Error('同步包来源对话与当前绑定不一致')
    const packageDigest = digest(value)
    const existing = this.db.prepare('SELECT * FROM work_design_packages WHERE project_id=? AND package_version=?').get(projectId, value.packageVersion)
    if (existing && existing.package_digest !== packageDigest) throw new Error('同一 packageVersion 已用于另一份内容')
    if (existing?.status === 'applied') return publicPackage(existing)
    if (value.baseVersion !== binding.last_applied_version) throw new Error(`同步基线不连续；当前应基于 ${binding.last_applied_version || '空版本'}`)
    const source = await this.snapshot(projectId)
    const preview = this.plan(projectId, value)
    const previewDigest = digest({ projectId, packageDigest, sourceDigest:source.sourceDigest, preview })
    const now = stamp(), id = existing?.id || `work-package-${randomUUID()}`
    this.db.prepare(`INSERT INTO work_design_packages(id,project_id,package_version,base_version,package_digest,source_digest,preview_digest,summary,payload_json,preview_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'previewed',?,?) ON CONFLICT(project_id,package_version) DO UPDATE SET
      source_digest=excluded.source_digest,preview_digest=excluded.preview_digest,summary=excluded.summary,payload_json=excluded.payload_json,
      preview_json=excluded.preview_json,error_json='{}',status='previewed',updated_at=excluded.updated_at`)
      .run(id, projectId, value.packageVersion, value.baseVersion, packageDigest, source.sourceDigest, previewDigest, value.summary, JSON.stringify(value), JSON.stringify(preview), existing?.created_at || now, now)
    return publicPackage(this.db.prepare('SELECT * FROM work_design_packages WHERE id=?').get(id))
  }

  mappedId(projectId, map, type, ref) {
    const id = map.get(`${type}:${ref}`)
    if (!id) throw new Error(`同步引用尚未绑定：${type}:${ref}`)
    return id
  }

  saveMap(projectId, map, type, ref, targetId, packageVersion) {
    map.set(`${type}:${ref}`, targetId)
    this.db.prepare(`INSERT INTO work_design_objects(project_id,object_type,external_ref,target_id,package_version,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,object_type,external_ref) DO UPDATE SET target_id=excluded.target_id,package_version=excluded.package_version,updated_at=excluded.updated_at`)
      .run(projectId, type, ref, targetId, packageVersion, stamp())
  }

  execute(projectId, change, map, packageVersion) {
    const value = change.payload
    if (change.type === 'project') return this.workspace.updateProject({ id:projectId, ...value })
    if (change.type === 'document') {
      const current = this.planning.loadPlanningCenter(projectId).documents[value.kind]?.content || {}
      return this.planning.saveDocument({ projectId, kind:value.kind, content:{ ...current, ...value.content } })
    }
    if (change.type === 'entity') {
      let id = map.get(`entity:${change.ref}`)
      if (!id) id = change.targetId || ''
      const result = id ? this.planning.updateEntity({ id, title:value.title, data:value.data }) : this.planning.createEntity({ projectId, kind:value.kind, title:value.title, data:value.data })
      this.saveMap(projectId, map, 'entity', change.ref, result.id, packageVersion)
      return result
    }
    if (change.type === 'chapter') {
      let id = map.get(`chapter:${change.ref}`) || change.targetId || ''
      let result
      if (!id) { result=this.workspace.createChapter({ projectId, title:value.title }); id=result.id }
      const current = this.workspace.loadWorkspaceSnapshot(projectId).chapters.find(item => item.id === id)
      const card = { ...(current?.card || {}), ...value.card }
      if (card.volumeRef) { card.volumeId=this.mappedId(projectId,map,'entity',card.volumeRef); delete card.volumeRef }
      result = this.workspace.updateChapter({ id, title:value.title, card, scenePlan:value.scenePlan })
      this.saveMap(projectId, map, 'chapter', change.ref, result.id, packageVersion)
      return result
    }
    if (change.type === 'relationship') {
      const input = { ...value, fromCharacterId:this.mappedId(projectId,map,'entity',value.fromRef), toCharacterId:this.mappedId(projectId,map,'entity',value.toRef) }
      const id = map.get(`relationship:${change.ref}`) || change.targetId || ''
      const result = id ? this.planning.updateRelationship({ id, ...input }) : this.planning.createRelationship({ projectId, ...input })
      this.saveMap(projectId,map,'relationship',change.ref,result.id,packageVersion)
      return result
    }
    if (change.type === 'arc') {
      const id = map.get(`arc:${change.ref}`) || change.targetId || ''
      const input = { title:value.title, category:value.category, premise:value.premise, destination:value.destination, status:value.status, colorKey:value.colorKey }
      const result = id ? this.planning.updateStoryArc({ id, ...input }) : this.planning.createStoryArc({ projectId, ...input })
      this.saveMap(projectId,map,'arc',change.ref,result.id,packageVersion)
      return result
    }
    if (change.type === 'beat') {
      const input = { arcId:this.mappedId(projectId,map,'arc',value.arcRef), label:value.label, changeText:value.changeText,
        ...(value.volumeRef ? { volumeId:this.mappedId(projectId,map,'entity',value.volumeRef) } : {}),
        ...(value.chapterRef ? { chapterId:this.mappedId(projectId,map,'chapter',value.chapterRef) } : {}) }
      const id = map.get(`beat:${change.ref}`) || change.targetId || ''
      const result = id ? this.planning.updateStoryArcBeat({ id, ...input }) : this.planning.createStoryArcBeat(input)
      this.saveMap(projectId,map,'beat',change.ref,result.id,packageVersion)
      return result
    }
    if (change.type === 'knowledge') {
      const id = map.get(`knowledge:${change.ref}`) || change.targetId || ''
      const current = id ? this.db.prepare('SELECT content_json FROM knowledge_items WHERE id=? AND project_id=?').get(id,projectId) : null
      const content = { ...parseJson(current?.content_json, {}), ...value.content }
      const result = id ? this.knowledge.updateItem({ id, title:value.title, content, status:value.status,
        effectiveFromChapter:value.effectiveFromChapter, effectiveToChapter:value.effectiveToChapter, knowledgeScope:value.knowledgeScope })
        : this.knowledge.createItem({ projectId, kind:value.kind, title:value.title, content, status:value.status })
      this.saveMap(projectId,map,'knowledge',change.ref,result.id,packageVersion)
      return result
    }
    throw new Error(`不支持同步类型 ${change.type}`)
  }

  async apply({ projectId, packageId, previewDigest, confirm }) {
    if (confirm !== true) throw new Error('正式写入前需要明确确认')
    this.assertProject(projectId)
    return this.queue.run(projectId, async () => {
      let row = this.db.prepare('SELECT * FROM work_design_packages WHERE id=? AND project_id=?').get(packageId, projectId)
      if (!row) throw new Error('同步预览不存在')
      if (row.preview_digest !== previewDigest) throw new Error('同步预览已经变化，请重新检查')
      if (row.status === 'applied') return publicPackage(row)
      const preview = parseJson(row.preview_json, {})
      if (preview.conflicts?.length) throw new Error('同步包仍有冲突，暂不写入')
      const current = await this.snapshot(projectId)
      const priorResults = parseJson(row.results_json, {})
      if (current.sourceDigest !== row.source_digest) throw new Error('项目内容已变化，请重新预览同步包')
      const value = parseJson(row.payload_json, {})
      const map = this.objectMap(projectId)
      const results = { ...priorResults }
      this.db.prepare("UPDATE work_design_packages SET status='applying',error_json='{}',updated_at=? WHERE id=?").run(stamp(), row.id)
      try {
        for (const change of preview.changes || []) {
          if (results[change.opId]?.status === 'completed') continue
          const result = this.execute(projectId, change, map, value.packageVersion)
          results[change.opId] = { status:'completed', targetId:result?.id || projectId, completedAt:stamp() }
          const next = await this.snapshot(projectId)
          this.db.prepare('UPDATE work_design_packages SET results_json=?,source_digest=?,updated_at=? WHERE id=?')
            .run(JSON.stringify(results), next.sourceDigest, stamp(), row.id)
        }
        const finalSource = await this.snapshot(projectId)
        const appliedAt = stamp()
        this.db.prepare("UPDATE work_design_packages SET status='applied',results_json=?,source_digest=?,applied_at=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(results), finalSource.sourceDigest, appliedAt, appliedAt, row.id)
        this.db.prepare('UPDATE work_design_bindings SET last_applied_version=?,last_applied_digest=?,updated_at=? WHERE project_id=?')
          .run(row.package_version, row.package_digest, appliedAt, projectId)
        this.onChange({ projectId, operation:'work-design-sync.apply', packageVersion:row.package_version })
      } catch (error) {
        const next = await this.snapshot(projectId)
        this.db.prepare("UPDATE work_design_packages SET status='failed',results_json=?,source_digest=?,error_json=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(results), next.sourceDigest, JSON.stringify({ message:error.message }), stamp(), row.id)
        throw error
      }
      row = this.db.prepare('SELECT * FROM work_design_packages WHERE id=?').get(row.id)
      return publicPackage(row)
    })
  }
}
