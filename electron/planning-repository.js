import { randomUUID } from 'node:crypto'
import { normalizeScenePlan, renderScenePlan } from './creative-quality.js'

const DOCUMENT_KINDS = new Set(['foundation', 'world', 'outline'])
const ENTITY_KINDS = new Set(['character', 'world', 'volume'])
const RELATION_DIRECTIONS = new Set(['mutual', 'from_to', 'to_from'])
const RELATION_TRENDS = new Set(['warming', 'stable', 'cooling', 'hostile'])
const RELATION_STATUSES = new Set(['active', 'changed', 'ended'])
const ARC_CATEGORIES = new Set(['main', 'character', 'relationship', 'mystery', 'world', 'other'])
const ARC_STATUSES = new Set(['planned', 'active', 'resolved', 'paused'])
const ARC_COLORS = new Set(['copper', 'pine', 'slate', 'ochre', 'plum'])

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

function mapRelationship(row) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    fromCharacterId: row.from_character_id,
    fromCharacterName: row.from_character_name || '',
    toCharacterId: row.to_character_id,
    toCharacterName: row.to_character_name || '',
    label: row.label,
    surface: row.surface,
    tension: row.tension,
    direction: row.direction,
    trend: row.trend,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapStoryArcBeat(row) {
  return row ? {
    id: row.id,
    arcId: row.arc_id,
    volumeId: row.volume_id || '',
    volumeTitle: row.volume_title || '',
    chapterId: row.chapter_id || '',
    chapterNo: row.chapter_no ? Number(row.chapter_no) : null,
    chapterTitle: row.chapter_title || '',
    label: row.label,
    changeText: row.change_text,
    position: Number(row.position),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapStoryArc(row, beats = []) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    category: row.category,
    premise: row.premise,
    destination: row.destination,
    status: row.status,
    colorKey: row.color_key,
    position: Number(row.position),
    beats,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  const relationshipById = database.prepare('SELECT * FROM character_relationships WHERE id = ?')
  const storyArcById = database.prepare('SELECT * FROM story_arcs WHERE id = ?')
  const storyArcBeatById = database.prepare('SELECT * FROM story_arc_beats WHERE id = ?')

  function assertProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能编辑规划')
    return project
  }

  function seedDocuments(projectId) {
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
    insert.run(projectId, 'foundation', JSON.stringify(foundation), createdAt, createdAt)
    insert.run(projectId, 'world', JSON.stringify(DOCUMENT_DEFAULTS.world), createdAt, createdAt)
    insert.run(projectId, 'outline', JSON.stringify(DOCUMENT_DEFAULTS.outline), createdAt, createdAt)
  }

  function ensureDocuments(projectId) {
    database.exec('BEGIN IMMEDIATE')
    try {
      seedDocuments(projectId)
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

  function listRelationships(projectId) {
    return database.prepare(`
      SELECT relationship.*, source.title AS from_character_name, target.title AS to_character_name
      FROM character_relationships relationship
      JOIN planning_entities source ON source.id = relationship.from_character_id
      JOIN planning_entities target ON target.id = relationship.to_character_id
      WHERE relationship.project_id = ?
      ORDER BY CASE relationship.status WHEN 'active' THEN 0 WHEN 'changed' THEN 1 ELSE 2 END,
        relationship.updated_at DESC, relationship.created_at
    `).all(projectId).map(mapRelationship)
  }

  function listStoryArcs(projectId) {
    const rows = database.prepare('SELECT * FROM story_arcs WHERE project_id = ? ORDER BY position, created_at').all(projectId)
    const beats = database.prepare(`
      SELECT beat.*, volume.title AS volume_title, chapter.chapter_no, chapter.title AS chapter_title
      FROM story_arc_beats beat
      JOIN story_arcs arc ON arc.id = beat.arc_id
      LEFT JOIN planning_entities volume ON volume.id = beat.volume_id
      LEFT JOIN chapters chapter ON chapter.id = beat.chapter_id
      WHERE arc.project_id = ?
      ORDER BY arc.position, beat.position, beat.created_at
    `).all(projectId).map(mapStoryArcBeat)
    const beatsByArc = new Map()
    for (const beat of beats) {
      if (!beatsByArc.has(beat.arcId)) beatsByArc.set(beat.arcId, [])
      beatsByArc.get(beat.arcId).push(beat)
    }
    return rows.map((row) => mapStoryArc(row, beatsByArc.get(row.id) || []))
  }

  function buildLocationView(projectId, worldElements, characters) {
    const locationPattern = /地点|城市|区域|场所|空间|建筑|国家|城镇|村庄|街区/
    const locations = worldElements.filter((entity) => locationPattern.test(cleanText(entity.data.category)))
      .map((entity) => ({
        id: entity.id,
        entityId: entity.id,
        title: entity.title,
        category: cleanText(entity.data.category, '地点'),
        summary: cleanText(entity.data.summary),
        rules: cleanText(entity.data.rules),
        storyUse: cleanText(entity.data.storyUse),
        connections: cleanText(entity.data.connections),
        constraints: cleanText(entity.data.constraints),
        sourceType: 'planning',
        occupants: [],
      }))
    const byTitle = new Map(locations.map((location) => [location.title.toLocaleLowerCase('zh-CN'), location]))
    const characterByTitle = new Map(characters.map((character) => [character.title.toLocaleLowerCase('zh-CN'), character]))
    const latestByCharacter = new Map()
    const snapshots = database.prepare(`
      SELECT candidate.payload_json, chapter.chapter_no, chapter.title AS chapter_title, candidate.resolved_at
      FROM knowledge_candidates candidate
      JOIN chapters chapter ON chapter.id = candidate.chapter_id
      WHERE candidate.project_id = ? AND candidate.task = 'chapter_state_extract' AND candidate.status = 'accepted'
      ORDER BY chapter.chapter_no DESC, candidate.created_at DESC
    `).all(projectId)
    for (const snapshot of snapshots) {
      for (const state of parseJson(snapshot.payload_json).characterStates || []) {
        const characterName = cleanText(state?.character)
        const locationName = cleanText(state?.location)
        const key = characterName.toLocaleLowerCase('zh-CN')
        if (!characterName || !locationName || latestByCharacter.has(key)) continue
        latestByCharacter.set(key, { characterName, locationName, snapshot, state })
      }
    }
    for (const current of latestByCharacter.values()) {
      const locationKey = current.locationName.toLocaleLowerCase('zh-CN')
      let location = byTitle.get(locationKey)
      if (!location) {
        location = {
          id: `observed:${current.locationName}`,
          entityId: '',
          title: current.locationName,
          category: '正文地点',
          summary: '', rules: '', storyUse: '', connections: '', constraints: '',
          sourceType: 'observed', occupants: [],
        }
        locations.push(location)
        byTitle.set(locationKey, location)
      }
      const character = characterByTitle.get(current.characterName.toLocaleLowerCase('zh-CN'))
      location.occupants.push({
        characterId: character?.id || '',
        characterName: current.characterName,
        physical: cleanText(current.state?.physical),
        emotional: cleanText(current.state?.emotional),
        chapterNo: Number(current.snapshot.chapter_no),
        chapterTitle: current.snapshot.chapter_title,
        resolvedAt: current.snapshot.resolved_at,
      })
    }
    return locations
  }

  function loadPlanningCenter(projectId) {
    ensureDocuments(projectId)
    const documents = Object.fromEntries(database.prepare(`
      SELECT * FROM planning_documents WHERE project_id = ? ORDER BY kind
    `).all(projectId).map((row) => [row.kind, mapDocument(row)]))
    const chapters = database.prepare(`
      SELECT id, project_id AS projectId, chapter_no AS chapterNo, title, status,
        card_json AS cardJson, scene_plan AS scenePlanText, scene_plan_json AS scenePlanJson, updated_at AS updatedAt
      FROM chapters WHERE project_id = ? ORDER BY chapter_no
    `).all(projectId).map((chapter) => ({
      ...chapter,
      card: parseJson(chapter.cardJson),
      scenePlan: normalizeScenePlan(chapter.scenePlanJson, chapter.scenePlanText),
    }))
    const characters = listEntities(projectId, 'character')
    const worldElements = listEntities(projectId, 'world')
    return {
      documents,
      characters,
      worldElements,
      volumes: listEntities(projectId, 'volume'),
      chapters,
      candidates: listPendingCandidates(projectId),
      relationships: listRelationships(projectId),
      locations: buildLocationView(projectId, worldElements, characters),
      storyArcs: listStoryArcs(projectId),
    }
  }

  function assertCharacter(projectId, characterId) {
    const character = entityById.get(characterId)
    if (!character || character.project_id !== projectId || character.kind !== 'character') throw new Error('关系节点必须是当前项目的人物卡')
    return character
  }

  function normalizeRelationshipInput(input, current = null) {
    const projectId = current?.project_id || input.projectId
    const fromCharacterId = input.fromCharacterId || current?.from_character_id
    const toCharacterId = input.toCharacterId || current?.to_character_id
    assertProject(projectId)
    assertCharacter(projectId, fromCharacterId)
    assertCharacter(projectId, toCharacterId)
    if (fromCharacterId === toCharacterId) throw new Error('人物不能与自己建立关系')
    const duplicate = database.prepare(`
      SELECT id FROM character_relationships
      WHERE project_id = ? AND id != ? AND (
        (from_character_id = ? AND to_character_id = ?) OR
        (from_character_id = ? AND to_character_id = ?)
      )
    `).get(projectId, current?.id || '', fromCharacterId, toCharacterId, toCharacterId, fromCharacterId)
    if (duplicate) throw new Error('这两个人物之间已经存在关系，请编辑现有连线')
    const direction = input.direction || current?.direction || 'mutual'
    const trend = input.trend || current?.trend || 'stable'
    const status = input.status || current?.status || 'active'
    if (!RELATION_DIRECTIONS.has(direction)) throw new Error('关系方向不受支持')
    if (!RELATION_TRENDS.has(trend)) throw new Error('关系趋势不受支持')
    if (!RELATION_STATUSES.has(status)) throw new Error('关系状态不受支持')
    return {
      projectId, fromCharacterId, toCharacterId,
      label: cleanText(input.label, current?.label || '未定义关系'),
      surface: typeof input.surface === 'string' ? input.surface.trim() : current?.surface || '',
      tension: typeof input.tension === 'string' ? input.tension.trim() : current?.tension || '',
      direction, trend, status,
    }
  }

  function createRelationship(input = {}) {
    const value = normalizeRelationshipInput(input)
    const id = createId('relationship')
    const timestamp = now()
    database.prepare(`
      INSERT INTO character_relationships (
        id, project_id, from_character_id, to_character_id, label, surface, tension,
        direction, trend, status, source_type, source_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', '', ?, ?)
    `).run(id, value.projectId, value.fromCharacterId, value.toCharacterId, value.label, value.surface, value.tension, value.direction, value.trend, value.status, timestamp, timestamp)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, value.projectId)
    return listRelationships(value.projectId).find((relationship) => relationship.id === id)
  }

  function updateRelationship(input = {}) {
    const current = relationshipById.get(input.id)
    if (!current) throw new Error('人物关系不存在')
    const value = normalizeRelationshipInput(input, current)
    const timestamp = now()
    database.prepare(`
      UPDATE character_relationships
      SET from_character_id = ?, to_character_id = ?, label = ?, surface = ?, tension = ?,
        direction = ?, trend = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(value.fromCharacterId, value.toCharacterId, value.label, value.surface, value.tension, value.direction, value.trend, value.status, timestamp, current.id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
    return listRelationships(current.project_id).find((relationship) => relationship.id === current.id)
  }

  function deleteRelationship(id) {
    const current = relationshipById.get(id)
    if (!current) throw new Error('人物关系不存在')
    assertProject(current.project_id)
    const timestamp = now()
    database.prepare('DELETE FROM character_relationships WHERE id = ?').run(id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
    return listRelationships(current.project_id)
  }

  function normalizeStoryArcInput(input, current = null) {
    const projectId = current?.project_id || input.projectId
    assertProject(projectId)
    const category = input.category || current?.category || 'main'
    const status = input.status || current?.status || 'planned'
    const colorKey = input.colorKey || current?.color_key || 'copper'
    if (!ARC_CATEGORIES.has(category)) throw new Error('情节线类型不受支持')
    if (!ARC_STATUSES.has(status)) throw new Error('情节线状态不受支持')
    if (!ARC_COLORS.has(colorKey)) throw new Error('情节线颜色不受支持')
    return {
      projectId,
      title: cleanText(input.title, current?.title || '未命名情节线'),
      category,
      premise: typeof input.premise === 'string' ? input.premise.trim() : current?.premise || '',
      destination: typeof input.destination === 'string' ? input.destination.trim() : current?.destination || '',
      status,
      colorKey,
    }
  }

  function createStoryArc(input = {}) {
    const value = normalizeStoryArcInput(input)
    const position = Number(database.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM story_arcs WHERE project_id = ?').get(value.projectId).position)
    const id = createId('arc')
    const timestamp = now()
    database.prepare(`
      INSERT INTO story_arcs (id, project_id, title, category, premise, destination, status, color_key, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, value.projectId, value.title, value.category, value.premise, value.destination, value.status, value.colorKey, position, timestamp, timestamp)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, value.projectId)
    return listStoryArcs(value.projectId).find((arc) => arc.id === id)
  }

  function updateStoryArc(input = {}) {
    const current = storyArcById.get(input.id)
    if (!current) throw new Error('情节线不存在')
    const value = normalizeStoryArcInput(input, current)
    const timestamp = now()
    database.prepare(`
      UPDATE story_arcs SET title = ?, category = ?, premise = ?, destination = ?, status = ?, color_key = ?, updated_at = ?
      WHERE id = ?
    `).run(value.title, value.category, value.premise, value.destination, value.status, value.colorKey, timestamp, current.id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
    return listStoryArcs(current.project_id).find((arc) => arc.id === current.id)
  }

  function deleteStoryArc(id) {
    const current = storyArcById.get(id)
    if (!current) throw new Error('情节线不存在')
    assertProject(current.project_id)
    const timestamp = now()
    database.prepare('DELETE FROM story_arcs WHERE id = ?').run(id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
    return listStoryArcs(current.project_id)
  }

  function normalizeStoryArcBeatInput(input, current = null) {
    const arcId = current?.arc_id || input.arcId
    const arc = storyArcById.get(arcId)
    if (!arc) throw new Error('情节线不存在')
    assertProject(arc.project_id)
    const hasVolume = Object.prototype.hasOwnProperty.call(input, 'volumeId')
    const hasChapter = Object.prototype.hasOwnProperty.call(input, 'chapterId')
    let volumeId = hasVolume ? cleanText(input.volumeId) : current?.volume_id || ''
    const chapterId = hasChapter ? cleanText(input.chapterId) : current?.chapter_id || ''
    if (volumeId) {
      const volume = entityById.get(volumeId)
      if (!volume || volume.project_id !== arc.project_id || volume.kind !== 'volume') throw new Error('情节节点必须关联当前项目的分卷')
    }
    if (chapterId) {
      const chapter = chapterById.get(chapterId)
      if (!chapter || chapter.project_id !== arc.project_id) throw new Error('情节节点必须关联当前项目的章节')
      const chapterVolumeId = cleanText(parseJson(chapter.card_json).volumeId)
      if (!volumeId && chapterVolumeId) volumeId = chapterVolumeId
      if (volumeId && chapterVolumeId !== volumeId) throw new Error('章节所属分卷与情节节点不一致')
    }
    return {
      arc,
      arcId,
      volumeId,
      chapterId,
      label: cleanText(input.label, current?.label || '关键变化'),
      changeText: typeof input.changeText === 'string' ? input.changeText.trim() : current?.change_text || '',
    }
  }

  function createStoryArcBeat(input = {}) {
    const value = normalizeStoryArcBeatInput(input)
    const position = Number(database.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM story_arc_beats WHERE arc_id = ?').get(value.arcId).position)
    const id = createId('arc-beat')
    const timestamp = now()
    database.prepare(`
      INSERT INTO story_arc_beats (id, arc_id, volume_id, chapter_id, label, change_text, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, value.arcId, value.volumeId || null, value.chapterId || null, value.label, value.changeText, position, timestamp, timestamp)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, value.arc.project_id)
    return listStoryArcs(value.arc.project_id).find((arc) => arc.id === value.arcId)?.beats.find((beat) => beat.id === id)
  }

  function updateStoryArcBeat(input = {}) {
    const current = storyArcBeatById.get(input.id)
    if (!current) throw new Error('情节节点不存在')
    const value = normalizeStoryArcBeatInput(input, current)
    const timestamp = now()
    database.prepare(`
      UPDATE story_arc_beats SET volume_id = ?, chapter_id = ?, label = ?, change_text = ?, updated_at = ? WHERE id = ?
    `).run(value.volumeId || null, value.chapterId || null, value.label, value.changeText, timestamp, current.id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, value.arc.project_id)
    return listStoryArcs(value.arc.project_id).find((arc) => arc.id === value.arcId)?.beats.find((beat) => beat.id === current.id)
  }

  function deleteStoryArcBeat(id) {
    const current = storyArcBeatById.get(id)
    if (!current) throw new Error('情节节点不存在')
    const arc = storyArcById.get(current.arc_id)
    assertProject(arc.project_id)
    const timestamp = now()
    database.prepare('DELETE FROM story_arc_beats WHERE id = ?').run(id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, arc.project_id)
    return listStoryArcs(arc.project_id).find((item) => item.id === arc.id)
  }

  function saveDocumentRecord({ projectId, kind, content = {} }, { ensure = true } = {}) {
    assertProject(projectId)
    if (!DOCUMENT_KINDS.has(kind)) throw new Error('规划文档类型不受支持')
    if (ensure) ensureDocuments(projectId)
    const updatedAt = now()
    const normalized = { ...DOCUMENT_DEFAULTS[kind], ...content }
    database.prepare(`
      UPDATE planning_documents SET content_json = ?, updated_at = ? WHERE project_id = ? AND kind = ?
    `).run(JSON.stringify(normalized), updatedAt, projectId, kind)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, projectId)
    return mapDocument(database.prepare('SELECT * FROM planning_documents WHERE project_id = ? AND kind = ?').get(projectId, kind))
  }

  function saveDocument(input) {
    return saveDocumentRecord(input)
  }

  function applyFoundationBundle({ projectId, foundation = {}, mainCharacter = {}, world = {}, outline = {} }) {
    assertProject(projectId)
    const existingCharacters = listEntities(projectId, 'character')
    database.exec('BEGIN IMMEDIATE')
    try {
      seedDocuments(projectId)
      saveDocumentRecord({ projectId, kind: 'foundation', content: foundation }, { ensure: false })
      saveDocumentRecord({ projectId, kind: 'world', content: world }, { ensure: false })
      saveDocumentRecord({ projectId, kind: 'outline', content: outline }, { ensure: false })
      const existingMainCharacter = existingCharacters.find((character) => /主角|protagonist/i.test(String(character.data?.role || '')))
      if (existingMainCharacter) updateEntity({ id: existingMainCharacter.id, title: mainCharacter.title, data: mainCharacter })
      else createEntity({ projectId, kind: 'character', title: mainCharacter.title, data: mainCharacter })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return loadPlanningCenter(projectId)
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
    if (candidate.field_key === 'scenePlan') {
      return candidate.original_value.trim().startsWith('{')
        ? JSON.stringify(normalizeScenePlan(chapter.scene_plan_json, chapter.scene_plan))
        : chapter.scene_plan
    }
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
      const structuredCandidate = candidate.candidate_value.trim().startsWith('{')
      const scenePlan = normalizeScenePlan(candidate.candidate_value)
      if (!scenePlan.scenes.length && !scenePlan.legacyNotes) throw new Error('场景计划候选没有可用内容')
      database.prepare('UPDATE chapters SET scene_plan_json = ?, scene_plan = ?, updated_at = ? WHERE id = ?')
        .run(
          JSON.stringify(scenePlan),
          structuredCandidate ? renderScenePlan(scenePlan) : candidate.candidate_value,
          resolvedAt,
          candidate.target_id,
        )
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
    applyFoundationBundle,
    createEntity,
    updateEntity,
    reorderEntities,
    deleteEntity,
    createRelationship,
    updateRelationship,
    deleteRelationship,
    createStoryArc,
    updateStoryArc,
    deleteStoryArc,
    createStoryArcBeat,
    updateStoryArcBeat,
    deleteStoryArcBeat,
    createCandidate,
    resolveCandidate,
  }
}
