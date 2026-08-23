import { createHash, randomUUID } from 'node:crypto'

export const PROJECT_BACKUP_FORMAT = 'novel-studio-project'
export const PROJECT_BACKUP_VERSION = 1

const PROJECT_TABLES = [
  'chapters', 'revisions', 'planning_documents', 'planning_entities', 'planning_candidates',
  'character_relationships', 'story_arcs', 'story_arc_beats', 'knowledge_items',
  'continuity_checks', 'knowledge_candidates', 'knowledge_item_candidates', 'context_profiles',
  'chapter_memories', 'prompt_templates', 'prompt_template_versions', 'prompt_bindings',
  'style_profiles', 'prompt_addons', 'prompt_addon_versions', 'prompt_addon_bindings',
  'generation_records',
]

const ID_COLUMNS = {
  chapters: 'id', revisions: 'id', planning_entities: 'id', planning_candidates: 'id',
  character_relationships: 'id', story_arcs: 'id', story_arc_beats: 'id', knowledge_items: 'id',
  continuity_checks: 'id', knowledge_candidates: 'id', knowledge_item_candidates: 'id',
  prompt_templates: 'id', prompt_template_versions: 'id', prompt_bindings: 'id', style_profiles: 'id',
  prompt_addons: 'id', prompt_addon_versions: 'id', prompt_addon_bindings: 'id', generation_records: 'id',
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function selectByProject(database, table, projectId) {
  return database.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY rowid`).all(projectId)
}

function selectByIds(database, table, column, ids) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(', ')
  return database.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders}) ORDER BY rowid`).all(...ids)
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function exportData(database, projectId) {
  const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
  if (!project) throw new Error('项目不存在')
  const chapters = selectByProject(database, 'chapters', projectId)
  const chapterIds = chapters.map((row) => row.id)
  const entities = selectByProject(database, 'planning_entities', projectId)
  const arcs = selectByProject(database, 'story_arcs', projectId)
  const knowledgeCandidates = selectByProject(database, 'knowledge_candidates', projectId)
  const promptBindings = selectByProject(database, 'prompt_bindings', projectId)
  const addonBindings = selectByProject(database, 'prompt_addon_bindings', projectId)
  const referencedTemplateIds = [...new Set(promptBindings.map((row) => row.template_id))]
  const referencedAddonIds = [...new Set(addonBindings.map((row) => row.addon_id))]
  const customTemplates = selectByIds(database, 'prompt_templates', 'id', referencedTemplateIds).filter((row) => row.kind === 'user')
  const customAddons = selectByIds(database, 'prompt_addons', 'id', referencedAddonIds).filter((row) => row.kind === 'user')
  const tables = {
    chapters,
    revisions: selectByIds(database, 'revisions', 'chapter_id', chapterIds),
    planning_documents: selectByProject(database, 'planning_documents', projectId),
    planning_entities: entities,
    planning_candidates: selectByProject(database, 'planning_candidates', projectId),
    character_relationships: selectByProject(database, 'character_relationships', projectId),
    story_arcs: arcs,
    story_arc_beats: selectByIds(database, 'story_arc_beats', 'arc_id', arcs.map((row) => row.id)),
    knowledge_items: selectByProject(database, 'knowledge_items', projectId),
    continuity_checks: selectByProject(database, 'continuity_checks', projectId),
    knowledge_candidates: knowledgeCandidates,
    knowledge_item_candidates: selectByProject(database, 'knowledge_item_candidates', projectId),
    context_profiles: selectByProject(database, 'context_profiles', projectId),
    chapter_memories: selectByProject(database, 'chapter_memories', projectId),
    prompt_templates: customTemplates,
    prompt_template_versions: selectByIds(database, 'prompt_template_versions', 'template_id', customTemplates.map((row) => row.id)),
    prompt_bindings: promptBindings,
    style_profiles: selectByProject(database, 'style_profiles', projectId),
    prompt_addons: customAddons,
    prompt_addon_versions: selectByIds(database, 'prompt_addon_versions', 'addon_id', customAddons.map((row) => row.id)),
    prompt_addon_bindings: addonBindings,
    generation_records: selectByProject(database, 'generation_records', projectId),
  }
  return { project, tables }
}

export function createProjectBackup(database, projectId, { now = () => new Date().toISOString() } = {}) {
  const data = exportData(database, projectId)
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: PROJECT_BACKUP_VERSION,
    exportedAt: now(),
    integrity: { algorithm: 'sha256', digest: sha256(data) },
    data,
  }
}

export function validateProjectBackup(bundle) {
  if (!bundle || bundle.format !== PROJECT_BACKUP_FORMAT) throw new Error('这不是 Novel Studio 项目备份')
  if (Number(bundle.version) !== PROJECT_BACKUP_VERSION) throw new Error(`暂不支持备份版本 ${bundle.version}`)
  if (!bundle.data?.project || !bundle.data?.tables) throw new Error('项目备份缺少数据区')
  if (!Array.isArray(bundle.data.tables.chapters) || !bundle.data.tables.chapters.length) throw new Error('项目备份至少需要一个章节')
  for (const table of PROJECT_TABLES) {
    if (!Array.isArray(bundle.data.tables[table])) throw new Error(`项目备份缺少 ${table} 数据表`)
  }
  if (bundle.integrity?.algorithm !== 'sha256' || bundle.integrity.digest !== sha256(bundle.data)) throw new Error('项目备份完整性校验失败')
  return bundle
}

function insertRow(database, table, row) {
  const columns = Object.keys(row)
  const allowedColumns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
  const unknownColumn = columns.find((column) => !allowedColumns.has(column))
  if (unknownColumn) throw new Error(`项目备份的 ${table} 包含未知字段：${unknownColumn}`)
  const placeholders = columns.map(() => '?').join(', ')
  database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]))
}

function remapJson(value, idMap) {
  if (typeof value === 'string') return idMap.get(value) || value
  if (Array.isArray(value)) return value.map((item) => remapJson(item, idMap))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapJson(item, idMap)]))
  return value
}

function remapJsonText(value, idMap) {
  if (typeof value !== 'string' || !value.trim()) return value
  try { return JSON.stringify(remapJson(JSON.parse(value), idMap)) } catch { return value }
}

function remapScope(row, idMap) {
  if (row.scope_type === 'project' || row.scope_type === 'volume' || row.scope_type === 'chapter') row.scope_id = idMap.get(row.scope_id) || row.scope_id
}

function transformedRow(table, source, idMap, newProjectId, createId) {
  const row = { ...source }
  if ('project_id' in row) row.project_id = newProjectId
  if (ID_COLUMNS[table]) row[ID_COLUMNS[table]] = idMap.get(source[ID_COLUMNS[table]])
  for (const column of Object.keys(row)) {
    if (column.endsWith('_json')) row[column] = remapJsonText(row[column], idMap)
  }
  if (table === 'chapters') row.project_id = newProjectId
  if (table === 'revisions') row.chapter_id = idMap.get(source.chapter_id)
  if (table === 'planning_documents' || table === 'context_profiles') row.project_id = newProjectId
  if (table === 'planning_candidates') {
    if (source.target_type === 'entity' || source.target_type === 'chapter') row.target_id = idMap.get(source.target_id) || source.target_id
  }
  if (table === 'character_relationships') {
    row.from_character_id = idMap.get(source.from_character_id)
    row.to_character_id = idMap.get(source.to_character_id)
    row.source_id = idMap.get(source.source_id) || source.source_id
  }
  if (table === 'story_arc_beats') {
    row.arc_id = idMap.get(source.arc_id)
    row.volume_id = source.volume_id ? idMap.get(source.volume_id) || null : null
    row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
  }
  if (table === 'knowledge_items') row.source_id = idMap.get(source.source_id) || source.source_id
  if (table === 'continuity_checks' || table === 'knowledge_candidates') row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
  if (table === 'knowledge_item_candidates') {
    row.chapter_id = idMap.get(source.chapter_id)
    row.source_candidate_id = idMap.get(source.source_candidate_id)
  }
  if (table === 'chapter_memories') row.chapter_id = idMap.get(source.chapter_id)
  if (table === 'prompt_template_versions') row.template_id = idMap.get(source.template_id)
  if (table === 'prompt_bindings') {
    row.template_id = idMap.get(source.template_id) || source.template_id
    remapScope(row, idMap)
  }
  if (table === 'style_profiles') remapScope(row, idMap)
  if (table === 'prompt_addon_versions') row.addon_id = idMap.get(source.addon_id)
  if (table === 'prompt_addon_bindings') {
    row.addon_id = idMap.get(source.addon_id) || source.addon_id
    remapScope(row, idMap)
  }
  if (table === 'generation_records') {
    row.task_id = createId('task')
    row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
    row.model_profile_id = null
    row.prompt_template_id = idMap.get(source.prompt_template_id) || source.prompt_template_id
  }
  return row
}

function buildIdMap(tables, createId) {
  const idMap = new Map()
  for (const table of PROJECT_TABLES) {
    const idColumn = ID_COLUMNS[table]
    if (!idColumn) continue
    for (const row of tables[table]) idMap.set(row[idColumn], createId(table.replace(/s$/, '')))
  }
  return idMap
}

const RESTORE_ORDER = [
  'prompt_templates', 'prompt_template_versions', 'prompt_addons', 'prompt_addon_versions',
  'chapters', 'revisions', 'planning_documents', 'planning_entities', 'planning_candidates',
  'character_relationships', 'story_arcs', 'story_arc_beats', 'knowledge_items',
  'continuity_checks', 'knowledge_candidates', 'knowledge_item_candidates', 'context_profiles',
  'chapter_memories', 'prompt_bindings', 'style_profiles', 'prompt_addon_bindings', 'generation_records',
]

export function restoreProjectBackup(database, input, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const bundle = validateProjectBackup(input)
  const { project, tables } = bundle.data
  const newProjectId = createId('project')
  const idMap = buildIdMap(tables, createId)
  idMap.set(project.id, newProjectId)
  const restoredAt = now()
  database.exec('BEGIN IMMEDIATE')
  try {
    insertRow(database, 'projects', {
      ...project,
      id: newProjectId,
      title: `${cleanText(project.title, '未命名小说')} · 恢复副本`,
      updated_at: restoredAt,
      archived_at: '',
    })
    for (const table of RESTORE_ORDER) {
      for (const source of tables[table]) insertRow(database, table, transformedRow(table, source, idMap, newProjectId, createId))
    }
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(newProjectId, restoredAt)
    const violations = database.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error(`恢复后外键检查失败：${violations[0].table}`)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return { projectId: newProjectId, restoredFrom: project.id }
}

export function importManuscriptProject(database, manuscript, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectId = createId('project')
  const importedAt = now()
  const chapters = Array.isArray(manuscript.chapters) && manuscript.chapters.length
    ? manuscript.chapters
    : [{ title: '第一章', manuscript: '' }]
  database.exec('BEGIN IMMEDIATE')
  try {
    insertRow(database, 'projects', {
      id: projectId,
      title: cleanText(manuscript.title, '导入的小说'),
      genre: cleanText(manuscript.genre, '未设置题材'),
      idea: cleanText(manuscript.idea),
      style: cleanText(manuscript.style, '克制、具体、以动作和对白推进。'),
      created_at: importedAt,
      updated_at: importedAt,
      archived_at: '',
    })
    chapters.forEach((chapter, index) => insertRow(database, 'chapters', {
      id: createId('chapter'), project_id: projectId, chapter_no: index + 1,
      title: cleanText(chapter.title, `第 ${index + 1} 章`), status: 'draft', card_json: '{}',
      scene_plan: '', manuscript: String(chapter.manuscript || ''), updated_at: importedAt,
    }))
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(projectId, importedAt)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return { projectId, chapterCount: chapters.length }
}
