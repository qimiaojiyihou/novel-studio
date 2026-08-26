import { createHash, randomUUID } from 'node:crypto'

export const PROJECT_BACKUP_FORMAT = 'novel-studio-project'
export const PROJECT_BACKUP_VERSION = 5

const PROJECT_TABLES = [
  'chapters', 'revisions', 'planning_documents', 'planning_entities', 'planning_candidates',
  'character_relationships', 'story_arcs', 'story_arc_beats', 'knowledge_items',
  'continuity_checks', 'knowledge_candidates', 'knowledge_item_candidates', 'context_profiles',
  'chapter_memories', 'prompt_templates', 'prompt_template_versions', 'prompt_bindings',
  'style_profiles', 'prompt_addons', 'prompt_addon_versions', 'prompt_addon_bindings',
  'generation_records', 'quality_reports', 'quality_human_reviews',
  'creative_packs', 'creative_pack_versions', 'project_pack_bindings',
  'agent_runs', 'agent_steps', 'agent_candidates',
  'story_change_sets', 'story_change_items', 'story_change_snapshots',
]

const ID_COLUMNS = {
  chapters: 'id', revisions: 'id', planning_entities: 'id', planning_candidates: 'id',
  character_relationships: 'id', story_arcs: 'id', story_arc_beats: 'id', knowledge_items: 'id',
  continuity_checks: 'id', knowledge_candidates: 'id', knowledge_item_candidates: 'id',
  prompt_templates: 'id', prompt_template_versions: 'id', prompt_bindings: 'id', style_profiles: 'id',
  prompt_addons: 'id', prompt_addon_versions: 'id', prompt_addon_bindings: 'id', generation_records: 'id',
  quality_reports: 'id', quality_human_reviews: 'id',
  project_pack_bindings: 'id', agent_runs: 'id', agent_steps: 'id', agent_candidates: 'id',
  story_change_sets: 'id', story_change_items: 'id', story_change_snapshots: 'id',
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
  const packBinding = database.prepare('SELECT * FROM project_pack_bindings WHERE project_id = ?').get(projectId)
  const boundPack = packBinding ? database.prepare('SELECT * FROM creative_packs WHERE id = ?').get(packBinding.pack_id) : null
  const customPacks = boundPack?.source === 'user' ? [boundPack] : []
  const customPackVersions = customPacks.length
    ? database.prepare('SELECT * FROM creative_pack_versions WHERE pack_id = ? ORDER BY installed_at').all(boundPack.id)
    : []
  const agentRuns = selectByProject(database, 'agent_runs', projectId)
  const agentRunIds = agentRuns.map((row) => row.id)
  const agentSteps = selectByIds(database, 'agent_steps', 'run_id', agentRunIds)
  const storyChangeSets = selectByProject(database, 'story_change_sets', projectId)
  const storyChangeSetIds = storyChangeSets.map((row) => row.id)
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
    quality_reports: selectByProject(database, 'quality_reports', projectId),
    quality_human_reviews: [],
    creative_packs: customPacks,
    creative_pack_versions: customPackVersions,
    project_pack_bindings: packBinding ? [packBinding] : [],
    agent_runs: agentRuns,
    agent_steps: agentSteps,
    agent_candidates: selectByIds(database, 'agent_candidates', 'run_id', agentRunIds),
    story_change_sets: storyChangeSets,
    story_change_items: selectByIds(database, 'story_change_items', 'change_set_id', storyChangeSetIds),
    story_change_snapshots: selectByIds(database, 'story_change_snapshots', 'change_set_id', storyChangeSetIds),
  }
  tables.quality_human_reviews = selectByIds(database, 'quality_human_reviews', 'report_id', tables.quality_reports.map((row) => row.id))
  return { project, tables }
}

export function createProjectBackup(database, projectId, { now = () => new Date().toISOString() } = {}) {
  const data = exportData(database, projectId)
  if (!data.project) throw new Error('要导出的项目不存在')
  if (data.project.project_type === 'benchmark') throw new Error('内置基准工作区不进入项目备份')
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
  const version = Number(bundle.version)
  if (![1, 2, 3, 4, PROJECT_BACKUP_VERSION].includes(version)) throw new Error(`暂不支持备份版本 ${bundle.version}`)
  if (!bundle.data?.project || !bundle.data?.tables) throw new Error('项目备份缺少数据区')
  if (!Array.isArray(bundle.data.tables.chapters) || !bundle.data.tables.chapters.length) throw new Error('项目备份至少需要一个章节')
  const legacyMissing = version === 1
    ? new Set(['quality_reports', 'quality_human_reviews', 'creative_packs', 'creative_pack_versions', 'project_pack_bindings', 'agent_runs', 'agent_steps', 'agent_candidates'])
    : version === 2
      ? new Set(['creative_packs', 'creative_pack_versions', 'project_pack_bindings', 'agent_runs', 'agent_steps', 'agent_candidates'])
      : new Set()
  if (version < 5) {
    legacyMissing.add('story_change_sets')
    legacyMissing.add('story_change_items')
    legacyMissing.add('story_change_snapshots')
  }
  const requiredTables = PROJECT_TABLES.filter((table) => !legacyMissing.has(table))
  for (const table of requiredTables) {
    if (!Array.isArray(bundle.data.tables[table])) throw new Error(`项目备份缺少 ${table} 数据表`)
  }
  if (bundle.integrity?.algorithm !== 'sha256' || bundle.integrity.digest !== sha256(bundle.data)) throw new Error('项目备份完整性校验失败')
  const normalizedProject = {
    ...bundle.data.project,
    default_execution_mode: ['app_model', 'codex'].includes(bundle.data.project.default_execution_mode)
      ? bundle.data.project.default_execution_mode
      : 'app_model',
  }
  if (version === PROJECT_BACKUP_VERSION) {
    return { ...bundle, data: { ...bundle.data, project: normalizedProject } }
  }
  return {
    ...bundle,
    version: PROJECT_BACKUP_VERSION,
    data: {
      ...bundle.data,
      project: normalizedProject,
      tables: Object.fromEntries(PROJECT_TABLES.map((table) => [table, bundle.data.tables[table] || []])),
    },
  }
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

function remapTargetKey(value, idMap) {
  const parts = String(value || '').split(':')
  if (parts.length < 3) return value
  if (['project', 'planning_entity', 'relationship', 'story_arc', 'story_arc_beat', 'chapter', 'knowledge_item'].includes(parts[0])) {
    parts[1] = idMap.get(parts[1]) || parts[1]
  }
  return parts.join(':')
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
    row.retry_of_id = source.retry_of_id ? idMap.get(source.retry_of_id) || null : null
    row.parent_generation_id = source.parent_generation_id ? idMap.get(source.parent_generation_id) || null : null
    row.agent_run_id = source.agent_run_id ? idMap.get(source.agent_run_id) || null : null
    row.agent_step_id = source.agent_step_id ? idMap.get(source.agent_step_id) || null : null
  }
  if (table === 'quality_reports') {
    row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
    row.generation_record_id = idMap.get(source.generation_record_id)
    row.reviewer_profile_id = null
  }
  if (table === 'quality_human_reviews') {
    row.report_id = idMap.get(source.report_id)
  }
  if (table === 'project_pack_bindings') row.project_id = newProjectId
  if (table === 'agent_runs') {
    row.project_id = newProjectId
    row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
    row.current_step_id = source.current_step_id ? idMap.get(source.current_step_id) || '' : ''
    if (!['completed', 'cancelled', 'failed'].includes(source.status)) {
      row.status = 'paused'
      row.session_recreated = 1
      row.error = '备份恢复后需要重建 Codex 会话'
    }
  }
  if (table === 'agent_steps') {
    row.run_id = idMap.get(source.run_id)
    row.generation_record_id = source.generation_record_id ? idMap.get(source.generation_record_id) || null : null
    row.quality_report_id = source.quality_report_id ? idMap.get(source.quality_report_id) || null : null
    row.approval_id = ''
    if (['waiting_approval', 'running', 'interrupted', 'waiting_confirmation'].includes(source.status)) row.status = 'stale'
  }
  if (table === 'agent_candidates') {
    row.run_id = idMap.get(source.run_id)
    row.step_id = idMap.get(source.step_id)
    row.project_id = newProjectId
    row.chapter_id = source.chapter_id ? idMap.get(source.chapter_id) || null : null
    if (source.status === 'pending') row.status = 'stale'
  }
  if (table === 'story_change_sets') {
    row.project_id = newProjectId
    row.agent_run_id = source.agent_run_id ? idMap.get(source.agent_run_id) || null : null
    row.root_target_key = remapTargetKey(source.root_target_key, idMap)
    if (!['applied', 'reverted', 'cancelled', 'failed'].includes(source.status)) {
      row.status = 'stale'
      row.summary = cleanText(source.summary, '备份恢复后项目标识已变化，请重新分析联动修改')
    }
  }
  if (table === 'story_change_items') {
    row.change_set_id = idMap.get(source.change_set_id)
    row.target_id = idMap.get(source.target_id) || source.target_id
    row.target_key = remapTargetKey(source.target_key, idMap)
    if (source.status === 'proposed') row.status = 'stale'
  }
  if (table === 'story_change_snapshots') {
    row.change_set_id = idMap.get(source.change_set_id)
    row.item_id = idMap.get(source.item_id)
    row.target_key = remapTargetKey(source.target_key, idMap)
    row.revision_id = source.revision_id ? idMap.get(source.revision_id) || null : null
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
  'quality_reports', 'quality_human_reviews', 'project_pack_bindings', 'agent_runs', 'agent_steps', 'agent_candidates',
  'story_change_sets', 'story_change_items', 'story_change_snapshots',
]

function installPortablePacks(database, tables) {
  for (const pack of tables.creative_packs || []) {
    const existing = database.prepare('SELECT source FROM creative_packs WHERE id = ?').get(pack.id)
    if (!existing) insertRow(database, 'creative_packs', pack)
    else if (existing.source !== 'user') throw new Error(`能力包 ${pack.id} 与当前内置包冲突`)
  }
  for (const version of tables.creative_pack_versions || []) {
    const existing = database.prepare('SELECT digest FROM creative_pack_versions WHERE pack_id = ? AND version = ?').get(version.pack_id, version.version)
    if (existing && existing.digest !== version.digest) throw new Error(`能力包 ${version.pack_id}@${version.version} 内容冲突`)
    if (!existing) insertRow(database, 'creative_pack_versions', version)
  }
}

function bindDefaultPack(database, projectId, boundAt) {
  const existing = database.prepare('SELECT id FROM project_pack_bindings WHERE project_id = ?').get(projectId)
  if (existing) return
  const pack = database.prepare("SELECT id, current_version FROM creative_packs WHERE source = 'official' AND enabled = 1 ORDER BY updated_at DESC LIMIT 1").get()
  if (!pack) throw new Error('缺少可用于恢复项目的官方 Creative Pack')
  insertRow(database, 'project_pack_bindings', {
    id: `pack-binding-${projectId}`, project_id: projectId, pack_id: pack.id,
    pack_version: pack.current_version, bound_at: boundAt, updated_at: boundAt,
  })
}

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
    // Retry records can reference another record that appears later in a portable bundle.
    database.exec('PRAGMA defer_foreign_keys = ON')
    installPortablePacks(database, tables)
    insertRow(database, 'projects', {
      ...project,
      id: newProjectId,
      title: `${cleanText(project.title, '未命名小说')} · 恢复副本`,
      updated_at: restoredAt,
      archived_at: '',
      project_type: 'user',
    })
    for (const table of RESTORE_ORDER) {
      for (const source of tables[table]) insertRow(database, table, transformedRow(table, source, idMap, newProjectId, createId))
    }
    bindDefaultPack(database, newProjectId, restoredAt)
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
      project_type: 'user',
    })
    chapters.forEach((chapter, index) => insertRow(database, 'chapters', {
      id: createId('chapter'), project_id: projectId, chapter_no: index + 1,
      title: cleanText(chapter.title, `第 ${index + 1} 章`), status: 'draft', card_json: '{}',
      scene_plan: '', manuscript: String(chapter.manuscript || ''), updated_at: importedAt,
    }))
    bindDefaultPack(database, projectId, importedAt)
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
