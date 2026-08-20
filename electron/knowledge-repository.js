import { randomUUID } from 'node:crypto'

const KNOWLEDGE_KINDS = new Set(['fact', 'timeline', 'foreshadow'])
const ITEM_STATUSES = new Set(['open', 'resolved', 'archived'])
const CHECK_STATUSES = new Set(['open', 'resolved', 'dismissed'])

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

function mapItem(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    content: parseJson(row.content_json),
    sourceType: row.source_type,
    sourceId: row.source_id,
    status: row.status,
    position: Number(row.position),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCheck(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id || '',
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    source: parseJson(row.source_json),
    origin: row.origin,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  }
}

function contentText(content, keys = []) {
  return keys.map((key) => cleanText(content?.[key])).filter(Boolean).join('；')
}

export function createKnowledgeRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')
  const itemById = database.prepare('SELECT * FROM knowledge_items WHERE id = ?')
  const checkById = database.prepare('SELECT * FROM continuity_checks WHERE id = ?')

  function assertProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能编辑知识库')
    return project
  }

  function listItems(projectId, kind = '') {
    const rows = kind
      ? database.prepare('SELECT * FROM knowledge_items WHERE project_id = ? AND kind = ? ORDER BY position, created_at').all(projectId, kind)
      : database.prepare('SELECT * FROM knowledge_items WHERE project_id = ? ORDER BY kind, position, created_at').all(projectId)
    return rows.map(mapItem)
  }

  function listChecks(projectId) {
    return database.prepare(`
      SELECT * FROM continuity_checks
      WHERE project_id = ?
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        updated_at DESC
    `).all(projectId).map(mapCheck)
  }

  function derivedRecords(projectId) {
    const records = []
    const documents = database.prepare('SELECT kind, content_json FROM planning_documents WHERE project_id = ?').all(projectId)
    const documentLabels = {
      foundation: { premise: '故事前提', coreConflict: '核心冲突', storyPromise: '阅读承诺', tone: '项目氛围' },
      world: { hardRules: '世界硬规则', costs: '世界代价', history: '共同历史' },
      outline: { logline: '全书总纲', thematicArc: '主题变化线', climax: '高潮选择', ending: '结局兑现' },
    }
    for (const document of documents) {
      const content = parseJson(document.content_json)
      for (const [field, label] of Object.entries(documentLabels[document.kind] || {})) {
        const statement = cleanText(content[field])
        if (!statement) continue
        records.push({
          kind: 'fact',
          title: label,
          content: { category: document.kind, statement, scope: '全书已确认规划' },
          sourceType: 'planning',
          sourceId: `document:${document.kind}:${field}`,
        })
      }
    }

    const entities = database.prepare('SELECT id, kind, title, data_json FROM planning_entities WHERE project_id = ? ORDER BY kind, position').all(projectId)
    for (const entity of entities) {
      const data = parseJson(entity.data_json)
      const statement = contentText(data, entity.kind === 'character'
        ? ['role', 'identity', 'desire', 'secret']
        : entity.kind === 'world'
          ? ['summary', 'rules', 'storyUse']
          : ['goal', 'conflict', 'arc', 'ending'])
      if (!statement && !cleanText(entity.title)) continue
      records.push({
        kind: 'fact',
        title: entity.kind === 'character' ? `人物：${entity.title}` : entity.kind === 'world' ? `设定：${entity.title}` : `分卷：${entity.title}`,
        content: { category: entity.kind, statement: statement || entity.title, scope: '规划卡片' },
        sourceType: 'planning',
        sourceId: `entity:${entity.id}`,
      })
    }

    const chapters = database.prepare('SELECT id, chapter_no, title, card_json, scene_plan FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId)
    for (const chapter of chapters) {
      const card = parseJson(chapter.card_json)
      const event = cleanText(card.goal, chapter.title)
      const consequence = cleanText(card.ending || card.turningPoint)
      if (!event && !consequence && !cleanText(chapter.scene_plan)) continue
      records.push({
        kind: 'timeline',
        title: `第 ${chapter.chapter_no} 章 · ${chapter.title}`,
        content: {
          dateLabel: `第 ${chapter.chapter_no} 章`,
          event,
          participants: cleanText(card.protagonistGoal),
          consequence,
          chapterNo: chapter.chapter_no,
        },
        sourceType: 'chapter',
        sourceId: `chapter:${chapter.id}`,
      })
    }
    return records
  }

  function ensurePlanningSources(projectId) {
    const project = assertProject(projectId)
    const existing = Number(database.prepare('SELECT COUNT(*) AS count FROM planning_documents WHERE project_id = ?').get(projectId).count)
    if (existing > 0) return
    const timestamp = now()
    const documents = {
      foundation: { premise: project.idea || '', tone: project.style || '' },
      world: {},
      outline: {},
    }
    const insert = database.prepare(`
      INSERT OR IGNORE INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const [kind, content] of Object.entries(documents)) insert.run(projectId, kind, JSON.stringify(content), timestamp, timestamp)
  }

  function upsertDerived(projectId, record, timestamp) {
    const existing = database.prepare(`
      SELECT * FROM knowledge_items
      WHERE project_id = ? AND kind = ? AND source_id = ?
      ORDER BY CASE source_type WHEN 'manual' THEN 0 ELSE 1 END
      LIMIT 1
    `).get(projectId, record.kind, record.sourceId)
    if (existing?.source_type === 'manual') return existing.id
    if (existing) {
      database.prepare(`
        UPDATE knowledge_items SET title = ?, content_json = ?, status = 'open', updated_at = ?
        WHERE id = ?
      `).run(record.title, JSON.stringify(record.content), timestamp, existing.id)
      return existing.id
    }
    const position = Number(database.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM knowledge_items WHERE project_id = ? AND kind = ?').get(projectId, record.kind).position)
    const id = createId('knowledge')
    database.prepare(`
      INSERT INTO knowledge_items (id, project_id, kind, title, content_json, source_type, source_id, status, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(id, projectId, record.kind, record.title, JSON.stringify(record.content), record.sourceType, record.sourceId, position, timestamp, timestamp)
    return id
  }

  function syncPlanningSources(projectId) {
    assertProject(projectId)
    ensurePlanningSources(projectId)
    const timestamp = now()
    const records = derivedRecords(projectId)
    const sourceIds = new Set(records.map((record) => record.sourceId))
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) upsertDerived(projectId, record, timestamp)
      const derived = database.prepare(`
        SELECT id, source_id FROM knowledge_items
        WHERE project_id = ? AND source_type IN ('planning', 'chapter')
      `).all(projectId)
      for (const item of derived) {
        if (!sourceIds.has(item.source_id)) {
          database.prepare("UPDATE knowledge_items SET status = 'archived', updated_at = ? WHERE id = ?").run(timestamp, item.id)
        }
      }
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function buildSystemChecks(projectId) {
    const checks = []
    const chapters = database.prepare('SELECT id, chapter_no, title, card_json, scene_plan, manuscript FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId)
    const maxChapterNo = chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapter_no)), 0)
    for (const chapter of chapters) {
      const card = parseJson(chapter.card_json)
      if (cleanText(chapter.manuscript) && !cleanText(card.goal)) {
        checks.push({
          chapterId: chapter.id,
          kind: 'missing-contract',
          severity: 'warning',
          title: `第 ${chapter.chapter_no} 章已有正文，但缺少章节合同`,
          detail: '先补充本章必须完成的变化，后续续写和连续性检查才有明确依据。',
          source: { chapterId: chapter.id },
        })
      }
      if (cleanText(card.goal) && !cleanText(chapter.scene_plan)) {
        checks.push({
          chapterId: chapter.id,
          kind: 'missing-scene-plan',
          severity: 'info',
          title: `第 ${chapter.chapter_no} 章已有合同，但还没有场景计划`,
          detail: '章节合同已经确认，可以继续拆成场景目标、阻力和变化。',
          source: { chapterId: chapter.id },
        })
      }
    }

    const foreshadows = listItems(projectId, 'foreshadow').filter((item) => item.status === 'open')
    for (const item of foreshadows) {
      const dueChapterNo = Number(item.content.dueChapterNo || 0)
      if (dueChapterNo > 0 && dueChapterNo < maxChapterNo) {
        checks.push({
          kind: 'overdue-foreshadow',
          severity: 'warning',
          title: `伏笔“${item.title}”已经超过预定回收章`,
          detail: `预定第 ${dueChapterNo} 章回收，当前项目已规划到第 ${maxChapterNo} 章。请确认延后、回收或关闭它。`,
          source: { itemId: item.id, dueChapterNo, maxChapterNo },
        })
      }
    }

    const facts = listItems(projectId, 'fact')
      .filter((item) => item.status === 'open' && cleanText(item.content.key) && cleanText(item.content.value))
    const byKey = new Map()
    for (const fact of facts) {
      const key = cleanText(fact.content.key)
      const values = byKey.get(key) || new Map()
      values.set(cleanText(fact.content.value), [...(values.get(cleanText(fact.content.value)) || []), fact])
      byKey.set(key, values)
    }
    for (const [key, values] of byKey) {
      if (values.size < 2) continue
      checks.push({
        kind: 'conflicting-fact',
        severity: 'critical',
        title: `事实键“${key}”出现互相冲突的值`,
        detail: [...values.keys()].join(' / '),
        source: { factIds: [...values.values()].flat().map((item) => item.id) },
      })
    }
    return checks
  }

  function refreshSystemChecks(projectId) {
    assertProject(projectId)
    const timestamp = now()
    const checks = buildSystemChecks(projectId)
    database.exec('BEGIN IMMEDIATE')
    try {
      const existing = database.prepare("SELECT * FROM continuity_checks WHERE project_id = ? AND origin = 'system'").all(projectId)
      const checkKey = (check) => `${check.kind}:${check.chapter_id || ''}:${check.source_json || JSON.stringify(check.source || {})}`
      const existingByKey = new Map()
      for (const row of existing) {
        const key = checkKey(row)
        const previous = existingByKey.get(key)
        if (!previous || (row.status === 'open' && previous.status !== 'open') || row.updated_at > previous.updated_at) {
          existingByKey.set(key, row)
        }
      }
      const keepIds = new Set(existingByKey.values().map((row) => row.id))
      for (const row of existing) {
        if (!keepIds.has(row.id)) database.prepare('DELETE FROM continuity_checks WHERE id = ?').run(row.id)
      }
      const generatedKeys = new Set(checks.map((check) => `${check.kind}:${check.chapterId || ''}:${JSON.stringify(check.source || {})}`))
      for (const row of existingByKey.values()) {
        if (!generatedKeys.has(checkKey(row))) {
          database.prepare('DELETE FROM continuity_checks WHERE id = ?').run(row.id)
        }
      }
      const insert = database.prepare(`
        INSERT INTO continuity_checks (id, project_id, chapter_id, kind, severity, title, detail, source_json, origin, status, created_at, updated_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system', 'open', ?, ?, '')
      `)
      for (const check of checks) {
        const sourceJson = JSON.stringify(check.source || {})
        const key = `${check.kind}:${check.chapterId || ''}:${sourceJson}`
        const existingCheck = existingByKey.get(key)
        if (existingCheck) {
          database.prepare('UPDATE continuity_checks SET severity = ?, title = ?, detail = ?, source_json = ?, updated_at = ? WHERE id = ?')
            .run(check.severity, check.title, check.detail, sourceJson, timestamp, existingCheck.id)
          continue
        }
        insert.run(createId('check'), projectId, check.chapterId || null, check.kind, check.severity, check.title, check.detail, sourceJson, timestamp, timestamp)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function loadKnowledgeCenter(projectId) {
    assertProject(projectId)
    syncPlanningSources(projectId)
    refreshSystemChecks(projectId)
    const items = listItems(projectId)
    const checks = listChecks(projectId)
    return {
      items,
      facts: items.filter((item) => item.kind === 'fact'),
      timeline: items.filter((item) => item.kind === 'timeline'),
      foreshadows: items.filter((item) => item.kind === 'foreshadow'),
      checks,
      counts: {
        facts: items.filter((item) => item.kind === 'fact' && item.status !== 'archived').length,
        timeline: items.filter((item) => item.kind === 'timeline' && item.status !== 'archived').length,
        foreshadows: items.filter((item) => item.kind === 'foreshadow' && item.status !== 'archived').length,
        openChecks: checks.filter((check) => check.status === 'open').length,
      },
    }
  }

  function createItem({ projectId, kind, title = '', content = {}, status = 'open' }) {
    assertProject(projectId)
    if (!KNOWLEDGE_KINDS.has(kind)) throw new Error('知识条目类型不受支持')
    if (!ITEM_STATUSES.has(status)) throw new Error('知识条目状态不受支持')
    const timestamp = now()
    const id = createId('knowledge')
    const position = Number(database.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM knowledge_items WHERE project_id = ? AND kind = ?').get(projectId, kind).position)
    database.prepare(`
      INSERT INTO knowledge_items (id, project_id, kind, title, content_json, source_type, source_id, status, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
    `).run(id, projectId, kind, cleanText(title, kind === 'fact' ? '新事实' : kind === 'timeline' ? '新时间节点' : '新伏笔'), JSON.stringify(content || {}), `manual:${id}`, status, position, timestamp, timestamp)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId)
    return mapItem(itemById.get(id))
  }

  function updateItem({ id, title, content, status }) {
    const current = itemById.get(id)
    if (!current) throw new Error('知识条目不存在')
    assertProject(current.project_id)
    if (status && !ITEM_STATUSES.has(status)) throw new Error('知识条目状态不受支持')
    const timestamp = now()
    const nextContent = content && typeof content === 'object' ? content : parseJson(current.content_json)
    database.prepare(`
      UPDATE knowledge_items
      SET title = ?, content_json = ?, source_type = 'manual', status = ?, updated_at = ?
      WHERE id = ?
    `).run(cleanText(title, current.title), JSON.stringify(nextContent), status || current.status, timestamp, id)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
    return mapItem(itemById.get(id))
  }

  function reorderItems({ projectId, kind, itemIds = [] }) {
    assertProject(projectId)
    if (!KNOWLEDGE_KINDS.has(kind)) throw new Error('知识条目类型不受支持')
    const current = listItems(projectId, kind)
    const currentIds = current.map((item) => item.id)
    if (itemIds.length !== currentIds.length || new Set(itemIds).size !== currentIds.length || currentIds.some((id) => !itemIds.includes(id))) {
      throw new Error('知识条目排序列表与当前数据不一致')
    }
    const offset = current.length * 2 + 1
    const update = database.prepare('UPDATE knowledge_items SET position = ? WHERE id = ? AND project_id = ? AND kind = ?')
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      itemIds.forEach((id, index) => update.run(offset + index, id, projectId, kind))
      itemIds.forEach((id, index) => update.run(index + 1, id, projectId, kind))
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return listItems(projectId, kind)
  }

  function deleteItem(id) {
    const current = itemById.get(id)
    if (!current) throw new Error('知识条目不存在')
    assertProject(current.project_id)
    const remaining = listItems(current.project_id, current.kind).filter((item) => item.id !== id)
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id)
      const update = database.prepare('UPDATE knowledge_items SET position = ? WHERE id = ?')
      remaining.forEach((item, index) => update.run(index + 1, item.id))
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, current.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return remaining
  }

  function resolveCheck({ id, status }) {
    const current = checkById.get(id)
    if (!current) throw new Error('连续性检查不存在')
    assertProject(current.project_id)
    if (!CHECK_STATUSES.has(status)) throw new Error('连续性检查处理方式不受支持')
    const timestamp = now()
    database.prepare('UPDATE continuity_checks SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?')
      .run(status, timestamp, status === 'open' ? '' : timestamp, id)
    return mapCheck(checkById.get(id))
  }

  return {
    loadKnowledgeCenter,
    syncPlanningSources: (projectId) => { syncPlanningSources(projectId); return loadKnowledgeCenter(projectId) },
    refreshContinuityChecks: (projectId) => { refreshSystemChecks(projectId); return loadKnowledgeCenter(projectId) },
    createItem,
    updateItem,
    reorderItems,
    deleteItem,
    resolveCheck,
  }
}
