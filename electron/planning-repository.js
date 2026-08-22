import { randomUUID } from 'node:crypto'

const DOCUMENT_KINDS = new Set(['foundation', 'world', 'outline'])
const ENTITY_KINDS = new Set(['character', 'world', 'volume'])

const DOCUMENT_DEFAULTS = {
  foundation: {
    audience: '',
    lengthTarget: '',
    pov: '',
    premise: '',
    coreConflict: '',
    storyPromise: '',
    themes: '',
    tone: '',
    endingDirection: '',
    boundaries: '',
  },
  world: {
    era: '',
    geography: '',
    society: '',
    powerSystem: '',
    hardRules: '',
    costs: '',
    dailyLife: '',
    history: '',
  },
  outline: {
    logline: '',
    opening: '',
    incitingIncident: '',
    firstTurn: '',
    midpoint: '',
    crisis: '',
    climax: '',
    ending: '',
    thematicArc: '',
  },
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function mapDocument(row) {
  return row ? { kind: row.kind, content: parseJson(row.content_json), createdAt: row.created_at, updatedAt: row.updated_at } : null
}

function mapEntity(row) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    position: Number(row.position),
    data: parseJson(row.data_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapCandidate(row) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    originalValue: row.original_value,
    candidateValue: row.candidate_value,
    instruction: row.instruction,
    model: parseJson(row.model_json),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  } : null
}

export function createPlanningRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')
  const entityById = database.prepare('SELECT * FROM planning_entities WHERE id = ?')
  const chapterById = database.prepare('SELECT * FROM chapters WHERE id = ?')
  const candidateById = database.prepare('SELECT * FROM planning_candidates WHERE id = ?')

  function assertProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能编辑规划')
    return project
  }

  function ensureDocuments(projectId) {
    const project = assertProject(projectId)
    const createdAt = now()
    const insert = database.prepare(`
      INSERT OR IGNORE INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const foundation = {
      ...DOCUMENT_DEFAULTS.foundation,
      premise: project.idea || '',
      tone: project.style || '',
    }
    database.exec('BEGIN IMMEDIATE')
    try {
      insert.run(projectId, 'foundation', JSON.stringify(foundation), createdAt, createdAt)
      insert.run(projectId, 'world', JSON.stringify(DOCUMENT_DEFAULTS.world), createdAt, createdAt)
      insert.run(projectId, 'outline', JSON.stringify(DOCUMENT_DEFAULTS.outline), createdAt, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function listEntities(projectId, kind) {
    if (!ENTITY_KINDS.has(kind)) throw new Error('规划实体类型不受支持')
    return database.prepare(`
      SELECT * FROM planning_entities WHERE project_id = ? AND kind = ? ORDER BY position, created_at
    `).all(projectId, kind).map(mapEntity)
  }

  function listPendingCandidates(projectId) {
    return database.prepare(`
      SELECT * FROM planning_candidates
      WHERE project_id = ? AND status = 'pending'
      ORDER BY created_at DESC, rowid DESC
    `).all(projectId).map(mapCandidate)
  }

  function loadPlanningCenter(projectId) {
    ensureDocuments(projectId)
    const documents = Object.fromEntries(database.prepare(`
      SELECT * FROM planning_documents WHERE project_id = ? ORDER BY kind
    `).all(projectId).map((row) => [row.kind, mapDocument(row)]))
    const chapters = database.prepare(`
      SELECT id, project_id AS projectId, chapter_no AS chapterNo, title, status,
        card_json AS cardJson, scene_plan AS scenePlan, updated_at AS updatedAt
      FROM chapters WHERE project_id = ? ORDER BY chapter_no
    `).all(projectId).map((chapter) => ({ ...chapter, card: parseJson(chapter.cardJson) }))
    return {
      documents,
      characters: listEntities(projectId, 'character'),
      worldElements: listEntities(projectId, 'world'),
      volumes: listEntities(projectId, 'volume'),
      chapters,
      candidates: listPendingCandidates(projectId),
    }
  }

  function saveDocument({ projectId, kind, content = {} }) {
    assertProject(projectId)
    if (!DOCUMENT_KINDS.has(kind)) throw new Error('规划文档类型不受支持')
    ensureDocuments(projectId)
    const updatedAt = now()
    const normalized = { ...DOCUMENT_DEFAULTS[kind], ...content }
    database.prepare(`
      UPDATE planning_documents SET content_json = ?, updated_at = ? WHERE project_id = ? AND kind = ?
    `).run(JSON.stringify(normalized), updatedAt, projectId, kind)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, projectId)
    return mapDocument(database.prepare('SELECT * FROM planning_documents WHERE project_id = ? AND kind = ?').get(projectId, kind))
  }

  function createEntity({ projectId, kind, title = '', data = {} }) {
    assertProject(projectId)
    if (!ENTITY_KINDS.has(kind)) throw new Error('规划实体类型不受支持')
    const position = Number(database.prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS position FROM planning_entities WHERE project_id = ? AND kind = ?
    `).get(projectId, kind).position)
    const id = createId(kind)
    const createdAt = now()
    const fallback = { character: `人物 ${position}`, world: `世界设定 ${position}`, volume: `第 ${position} 卷` }[kind]
    database.prepare(`
      INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, kind, cleanText(title, fallback), position, JSON.stringify(data || {}), createdAt, createdAt)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(createdAt, projectId)
    return mapEntity(entityById.get(id))
  }

  function updateEntity({ id, title, data }) {
    const current = entityById.get(id)
    if (!current) throw new Error('规划卡片不存在')
    assertProject(current.project_id)
    const nextTitle = typeof title === 'string' ? cleanText(title, current.title) : current.title
    const nextData = data && typeof data === 'object' ? { ...parseJson(current.data_json), ...data } : parseJson(current.data_json)
    const updatedAt = now()
    database.prepare(`
      UPDATE planning_entities SET title = ?, data_json = ?, updated_at = ? WHERE id = ?
    `).run(nextTitle, JSON.stringify(nextData), updatedAt, id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, current.project_id)
    return mapEntity(entityById.get(id))
  }

  function reorderEntities({ projectId, kind, entityIds = [] }) {
    assertProject(projectId)
    const current = listEntities(projectId, kind)
    const currentIds = current.map((entity) => entity.id)
    if (entityIds.length !== currentIds.length || new Set(entityIds).size !== currentIds.length || currentIds.some((id) => !entityIds.includes(id))) {
      throw new Error('规划卡片排序列表与当前数据不一致')
    }
    const offset = current.length * 2 + 1
    const updatePosition = database.prepare('UPDATE planning_entities SET position = ? WHERE id = ? AND project_id = ? AND kind = ?')
    const updatedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      entityIds.forEach((id, index) => updatePosition.run(offset + index, id, projectId, kind))
      entityIds.forEach((id, index) => updatePosition.run(index + 1, id, projectId, kind))
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return listEntities(projectId, kind)
  }

  function deleteEntity(entityId) {
    const current = entityById.get(entityId)
    if (!current) throw new Error('规划卡片不存在')
    assertProject(current.project_id)
    const remaining = listEntities(current.project_id, current.kind).filter((entity) => entity.id !== entityId)
    const linkedChapters = current.kind === 'volume'
      ? database.prepare('SELECT id, card_json FROM chapters WHERE project_id = ?').all(current.project_id)
        .filter((chapter) => parseJson(chapter.card_json).volumeId === entityId)
      : []
    const updatedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM planning_entities WHERE id = ?').run(entityId)
      const updateChapterCard = database.prepare('UPDATE chapters SET card_json = ?, updated_at = ? WHERE id = ?')
      linkedChapters.forEach((chapter) => {
        const card = parseJson(chapter.card_json)
        delete card.volumeId
        updateChapterCard.run(JSON.stringify(card), updatedAt, chapter.id)
      })
      database.prepare("DELETE FROM style_profiles WHERE project_id = ? AND scope_type = 'volume' AND scope_id = ?")
        .run(current.project_id, entityId)
      database.prepare("DELETE FROM prompt_bindings WHERE project_id = ? AND scope_type = 'volume' AND scope_id = ?")
        .run(current.project_id, entityId)
      const updatePosition = database.prepare('UPDATE planning_entities SET position = ? WHERE id = ?')
      remaining.forEach((entity, index) => updatePosition.run(index + 1, entity.id))
      database.prepare(`
        UPDATE planning_candidates SET status = 'discarded', resolved_at = ?
        WHERE target_type = 'entity' AND target_id = ? AND status = 'pending'
      `).run(updatedAt, entityId)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, current.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return listEntities(current.project_id, current.kind)
  }

  function createCandidate(input = {}) {
    const projectId = input.projectId
    assertProject(projectId)
    if (!['document', 'entity', 'chapter'].includes(input.targetType)) throw new Error('候选目标类型不受支持')
    const candidateValue = String(input.candidateValue ?? '').trim()
    if (!candidateValue) throw new Error('模型没有返回可用候选内容')
    const id = createId('candidate')
    const createdAt = now()
    database.prepare(`
      INSERT INTO planning_candidates (
        id, project_id, target_type, target_id, field_key, field_label,
        original_value, candidate_value, instruction, model_json, status, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '')
    `).run(
      id,
      projectId,
      input.targetType,
      cleanText(input.targetId),
      cleanText(input.fieldKey),
      cleanText(input.fieldLabel),
      String(input.originalValue ?? ''),
      candidateValue,
      String(input.instruction ?? '').trim(),
      JSON.stringify(input.model || {}),
      createdAt,
    )
    return mapCandidate(candidateById.get(id))
  }

  function targetValue(candidate) {
    if (candidate.target_type === 'document') {
      const document = database.prepare('SELECT content_json FROM planning_documents WHERE project_id = ? AND kind = ?').get(candidate.project_id, candidate.target_id)
      return String(parseJson(document?.content_json)[candidate.field_key] ?? '')
    }
    if (candidate.target_type === 'entity') {
      const entity = entityById.get(candidate.target_id)
      if (!entity || entity.project_id !== candidate.project_id) throw new Error('候选对应的规划卡片不存在')
      return candidate.field_key === 'title' ? entity.title : String(parseJson(entity.data_json)[candidate.field_key] ?? '')
    }
    const chapter = chapterById.get(candidate.target_id)
    if (!chapter || chapter.project_id !== candidate.project_id) throw new Error('候选对应的章节不存在')
    if (candidate.field_key === 'title') return chapter.title
    if (candidate.field_key === 'card') return JSON.stringify(parseJson(chapter.card_json))
    if (candidate.field_key === 'scenePlan') return chapter.scene_plan
    return String(parseJson(chapter.card_json)[candidate.field_key] ?? '')
  }

  function applyCandidate(candidate, resolvedAt) {
    if (candidate.target_type === 'document') {
      const row = database.prepare('SELECT content_json FROM planning_documents WHERE project_id = ? AND kind = ?').get(candidate.project_id, candidate.target_id)
      if (!row) throw new Error('候选对应的规划文档不存在')
      const content = parseJson(row.content_json)
      content[candidate.field_key] = candidate.candidate_value
      database.prepare('UPDATE planning_documents SET content_json = ?, updated_at = ? WHERE project_id = ? AND kind = ?')
        .run(JSON.stringify(content), resolvedAt, candidate.project_id, candidate.target_id)
      return
    }
    if (candidate.target_type === 'entity') {
      const entity = entityById.get(candidate.target_id)
      if (candidate.field_key === 'title') {
        database.prepare('UPDATE planning_entities SET title = ?, updated_at = ? WHERE id = ?')
          .run(candidate.candidate_value, resolvedAt, candidate.target_id)
      } else {
        const data = parseJson(entity.data_json)
        data[candidate.field_key] = candidate.candidate_value
        database.prepare('UPDATE planning_entities SET data_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(data), resolvedAt, candidate.target_id)
      }
      return
    }
    const chapter = chapterById.get(candidate.target_id)
    if (candidate.field_key === 'title') {
      database.prepare('UPDATE chapters SET title = ?, updated_at = ? WHERE id = ?').run(candidate.candidate_value, resolvedAt, candidate.target_id)
    } else if (candidate.field_key === 'card') {
      const card = parseJson(candidate.candidate_value, null)
      if (!card || Array.isArray(card) || typeof card !== 'object') throw new Error('章节卡候选不是有效对象')
      database.prepare('UPDATE chapters SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(card), resolvedAt, candidate.target_id)
    } else if (candidate.field_key === 'scenePlan') {
      database.prepare('UPDATE chapters SET scene_plan = ?, updated_at = ? WHERE id = ?').run(candidate.candidate_value, resolvedAt, candidate.target_id)
    } else {
      const card = parseJson(chapter.card_json)
      card[candidate.field_key] = candidate.candidate_value
      database.prepare('UPDATE chapters SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(card), resolvedAt, candidate.target_id)
    }
  }

  function resolveCandidate({ candidateId, decision }) {
    const candidate = candidateById.get(candidateId)
    if (!candidate) throw new Error('规划候选不存在')
    if (candidate.status !== 'pending') throw new Error('规划候选已经处理')
    if (!['accepted', 'discarded'].includes(decision)) throw new Error('候选处理方式不受支持')
    assertProject(candidate.project_id)
    const resolvedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      if (decision === 'accepted') {
        if (targetValue(candidate) !== candidate.original_value) throw new Error('当前字段已经修改，请基于新内容重新生成候选')
        applyCandidate(candidate, resolvedAt)
        database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(resolvedAt, candidate.project_id)
      }
      database.prepare('UPDATE planning_candidates SET status = ?, resolved_at = ? WHERE id = ?')
        .run(decision, resolvedAt, candidateId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapCandidate(candidateById.get(candidateId))
  }

  return {
    loadPlanningCenter,
    saveDocument,
    createEntity,
    updateEntity,
    reorderEntities,
    deleteEntity,
    createCandidate,
    resolveCandidate,
  }
}
