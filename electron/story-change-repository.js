import { createHash, randomUUID } from 'node:crypto'

const SET_STATUSES = new Set(['draft', 'analyzing', 'waiting_confirmation', 'applied', 'reverted', 'cancelled', 'failed', 'stale'])
const IMPACT_LEVELS = new Set(['required', 'suggested', 'review'])

function parseJson(value, fallback = null) {
  try {
    return value === '' || value === null || value === undefined ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function digestCatalog(catalog) {
  const payload = catalog
    .map((surface) => [surface.targetKey, surface.value])
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function valueText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function flattenValue(value, prefix = '', output = []) {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    if (prefix) output.push({ path: prefix, value })
    return output
  }
  const entries = Object.entries(value)
  if (!entries.length && prefix) output.push({ path: prefix, value })
  for (const [key, child] of entries) flattenValue(child, prefix ? `${prefix}.${key}` : key, output)
  return output
}

function setPath(source, path, value) {
  if (!path) return value
  const root = source && typeof source === 'object' ? structuredClone(source) : {}
  const segments = path.split('.').filter(Boolean)
  let cursor = root
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value
      return
    }
    const nextSegment = segments[index + 1]
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = /^\d+$/.test(nextSegment) ? [] : {}
    cursor = cursor[segment]
  })
  return root
}

function fieldLabel(path) {
  const labels = {
    title: '标题', genre: '题材', idea: '一句话想法', style: '项目文风', audience: '目标读者',
    lengthTarget: '篇幅目标', pov: '叙事视角', premise: '故事前提', coreConflict: '核心冲突',
    storyPromise: '阅读承诺', themes: '主题母题', tone: '氛围基调', endingDirection: '结局方向',
    boundaries: '创作边界', hardRules: '世界硬规则', costs: '规则代价', summary: '摘要',
    label: '关系或节点名称', surface: '表面关系', tension: '真实张力', destination: '终点',
    manuscript: '正文', goal: '目标', obstacle: '阻力', turn: '转折', exitState: '离场状态',
    change_text: '节点变化', content: '内容', rules: '规则', constraints: '限制',
  }
  const tail = String(path || '').split('.').at(-1)
  return labels[path] || labels[tail] || tail || '内容'
}

function mapItem(row) {
  if (!row) return null
  return {
    id: row.id,
    changeSetId: row.change_set_id,
    targetKey: row.target_key,
    targetKind: row.target_kind,
    targetId: row.target_id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    impactLevel: row.impact_level,
    reason: row.reason,
    evidence: parseJson(row.evidence_json, []),
    selected: Boolean(row.selected),
    applyOrder: Number(row.apply_order || 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSet(row, items = []) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    agentRunId: row.agent_run_id || '',
    rootTargetKey: row.root_target_key,
    rootLabel: row.root_label,
    rootBefore: parseJson(row.root_before_json),
    rootAfter: parseJson(row.root_after_json),
    instruction: row.instruction,
    scope: parseJson(row.scope_json, {}),
    sourceDigest: row.source_digest,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
    items,
    counts: {
      total: items.length,
      selected: items.filter((item) => item.selected).length,
      required: items.filter((item) => item.impactLevel === 'required').length,
      suggested: items.filter((item) => item.impactLevel === 'suggested').length,
      review: items.filter((item) => item.impactLevel === 'review').length,
    },
  }
}

export function createStoryChangeRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const setById = database.prepare('SELECT * FROM story_change_sets WHERE id = ?')

  function assertProject(projectId) {
    const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能联动修改')
    return project
  }

  function buildCatalog(projectId, { includeManuscript = true } = {}) {
    const project = assertProject(projectId)
    const surfaces = []
    const add = (surface) => {
      surfaces.push({ editable: true, manuscript: false, ...surface })
    }
    for (const column of ['title', 'genre', 'idea', 'style']) {
      add({
        targetKey: `project:${project.id}:${column}`,
        targetKind: 'project', targetId: project.id, fieldKey: column,
        fieldLabel: fieldLabel(column), value: project[column],
        storage: { table: 'projects', idColumn: 'id', id: project.id, column },
      })
    }

    for (const row of database.prepare('SELECT * FROM planning_documents WHERE project_id = ? ORDER BY kind').all(projectId)) {
      for (const leaf of flattenValue(parseJson(row.content_json, {}))) {
        add({
          targetKey: `planning_document:${row.kind}:${leaf.path}`,
          targetKind: 'planning_document', targetId: row.kind, fieldKey: leaf.path,
          fieldLabel: fieldLabel(leaf.path), value: leaf.value,
          storage: { table: 'planning_documents', idColumn: 'project_id', id: projectId, extra: { column: 'kind', value: row.kind }, jsonColumn: 'content_json', jsonPath: leaf.path },
        })
      }
    }

    for (const row of database.prepare('SELECT * FROM planning_entities WHERE project_id = ? ORDER BY kind, position').all(projectId)) {
      add({
        targetKey: `planning_entity:${row.id}:title`, targetKind: 'planning_entity', targetId: row.id,
        fieldKey: 'title', fieldLabel: `${row.kind === 'character' ? '人物' : row.kind === 'volume' ? '分卷' : '世界设定'}名称`,
        value: row.title, storage: { table: 'planning_entities', idColumn: 'id', id: row.id, column: 'title' },
      })
      for (const leaf of flattenValue(parseJson(row.data_json, {}))) {
        add({
          targetKey: `planning_entity:${row.id}:${leaf.path}`, targetKind: 'planning_entity', targetId: row.id,
          fieldKey: leaf.path, fieldLabel: `${row.title} · ${fieldLabel(leaf.path)}`, value: leaf.value,
          storage: { table: 'planning_entities', idColumn: 'id', id: row.id, jsonColumn: 'data_json', jsonPath: leaf.path },
        })
      }
    }

    for (const row of database.prepare('SELECT * FROM character_relationships WHERE project_id = ? ORDER BY created_at').all(projectId)) {
      for (const column of ['label', 'surface', 'tension']) {
        add({
          targetKey: `relationship:${row.id}:${column}`, targetKind: 'relationship', targetId: row.id,
          fieldKey: column, fieldLabel: `人物关系 · ${fieldLabel(column)}`, value: row[column],
          storage: { table: 'character_relationships', idColumn: 'id', id: row.id, column },
          links: [row.from_character_id, row.to_character_id],
        })
      }
    }

    const arcs = database.prepare('SELECT * FROM story_arcs WHERE project_id = ? ORDER BY position').all(projectId)
    for (const row of arcs) {
      for (const column of ['title', 'premise', 'destination']) {
        add({
          targetKey: `story_arc:${row.id}:${column}`, targetKind: 'story_arc', targetId: row.id,
          fieldKey: column, fieldLabel: `情节弧 · ${fieldLabel(column)}`, value: row[column],
          storage: { table: 'story_arcs', idColumn: 'id', id: row.id, column },
        })
      }
    }
    const arcIds = new Set(arcs.map((arc) => arc.id))
    for (const row of database.prepare('SELECT * FROM story_arc_beats ORDER BY created_at').all().filter((beat) => arcIds.has(beat.arc_id))) {
      for (const column of ['label', 'change_text']) {
        add({
          targetKey: `story_arc_beat:${row.id}:${column}`, targetKind: 'story_arc_beat', targetId: row.id,
          fieldKey: column, fieldLabel: `情节节点 · ${fieldLabel(column)}`, value: row[column],
          storage: { table: 'story_arc_beats', idColumn: 'id', id: row.id, column },
          links: [row.volume_id, row.chapter_id].filter(Boolean),
        })
      }
    }

    for (const row of database.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId)) {
      add({
        targetKey: `chapter:${row.id}:title`, targetKind: 'chapter', targetId: row.id, fieldKey: 'title',
        fieldLabel: `第 ${row.chapter_no} 章 · 标题`, value: row.title,
        storage: { table: 'chapters', idColumn: 'id', id: row.id, column: 'title' }, chapterNo: Number(row.chapter_no),
      })
      for (const leaf of flattenValue(parseJson(row.card_json, {}))) {
        add({
          targetKey: `chapter:${row.id}:card.${leaf.path}`, targetKind: 'chapter_card', targetId: row.id,
          fieldKey: leaf.path, fieldLabel: `第 ${row.chapter_no} 章卡 · ${fieldLabel(leaf.path)}`, value: leaf.value,
          storage: { table: 'chapters', idColumn: 'id', id: row.id, jsonColumn: 'card_json', jsonPath: leaf.path }, chapterNo: Number(row.chapter_no),
        })
      }
      for (const leaf of flattenValue(parseJson(row.scene_plan_json, {}))) {
        add({
          targetKey: `chapter:${row.id}:scene.${leaf.path}`, targetKind: 'scene_plan', targetId: row.id,
          fieldKey: leaf.path, fieldLabel: `第 ${row.chapter_no} 章场景 · ${fieldLabel(leaf.path)}`, value: leaf.value,
          storage: { table: 'chapters', idColumn: 'id', id: row.id, jsonColumn: 'scene_plan_json', jsonPath: leaf.path, projection: 'scene_plan' }, chapterNo: Number(row.chapter_no),
        })
      }
      if (includeManuscript) {
        add({
          targetKey: `chapter:${row.id}:manuscript`, targetKind: 'manuscript', targetId: row.id, fieldKey: 'manuscript',
          fieldLabel: `第 ${row.chapter_no} 章正文`, value: row.manuscript, manuscript: true, chapterNo: Number(row.chapter_no),
          storage: { table: 'chapters', idColumn: 'id', id: row.id, column: 'manuscript' },
        })
      }
    }

    for (const row of database.prepare('SELECT * FROM knowledge_items WHERE project_id = ? ORDER BY kind, position').all(projectId)) {
      add({
        targetKey: `knowledge_item:${row.id}:title`, targetKind: 'knowledge_item', targetId: row.id,
        fieldKey: 'title', fieldLabel: `知识条目 · 标题`, value: row.title,
        storage: { table: 'knowledge_items', idColumn: 'id', id: row.id, column: 'title' },
        source: { type: row.source_type, id: row.source_id },
      })
      for (const leaf of flattenValue(parseJson(row.content_json, {}))) {
        add({
          targetKey: `knowledge_item:${row.id}:${leaf.path}`, targetKind: 'knowledge_item', targetId: row.id,
          fieldKey: leaf.path, fieldLabel: `${row.title} · ${fieldLabel(leaf.path)}`, value: leaf.value,
          storage: { table: 'knowledge_items', idColumn: 'id', id: row.id, jsonColumn: 'content_json', jsonPath: leaf.path },
          source: { type: row.source_type, id: row.source_id },
        })
      }
    }
    return surfaces
  }

  function resolveTargetKey(target = {}) {
    if (cleanText(target.targetKey)) return cleanText(target.targetKey)
    const kind = cleanText(target.kind)
    const targetId = cleanText(target.targetId)
    const fieldKey = cleanText(target.fieldKey)
    if (kind === 'project' || kind === 'project_brief_draft') return `project:${targetId}:${fieldKey}`
    if (kind === 'planning_document') return `planning_document:${targetId}:${fieldKey}`
    if (kind === 'planning_entity') return `planning_entity:${targetId}:${fieldKey}`
    if (kind === 'relationship') return `relationship:${targetId}:${fieldKey}`
    if (kind === 'story_arc') return `story_arc:${targetId}:${fieldKey}`
    if (kind === 'story_arc_beat') return `story_arc_beat:${targetId}:${fieldKey}`
    if (kind === 'knowledge_item') return `knowledge_item:${targetId}:${fieldKey}`
    if (kind === 'chapter_field') {
      if (['title', 'manuscript'].includes(fieldKey)) return `chapter:${targetId}:${fieldKey}`
      if (fieldKey === 'scenePlan') return `chapter:${targetId}:scene`
      return `chapter:${targetId}:card.${fieldKey}`
    }
    return ''
  }

  function deterministicImpacts(root, catalog) {
    const impacts = new Map()
    const add = (surface, impactLevel, reason, evidence = [], selected = impactLevel !== 'review') => {
      const current = impacts.get(surface.targetKey)
      const rank = { required: 3, suggested: 2, review: 1 }
      if (current && rank[current.impactLevel] >= rank[impactLevel]) return
      impacts.set(surface.targetKey, { surface, impactLevel, reason, evidence, selected })
    }
    add(root, 'required', '这是本次联动修改的根设定。', ['root_target'], true)

    const anchors = []
    const rootText = valueText(root.value).trim()
    if (rootText.length >= 2 && rootText.length <= 160) anchors.push(rootText)
    const subjectAnchor = rootText.split(/[，。；：、\s]|每天|每次|每隔|只能|必须|不得|不可|会在|会于|是|为/)[0]?.trim()
    if (subjectAnchor?.length >= 2 && subjectAnchor.length <= 24 && !anchors.includes(subjectAnchor)) anchors.push(subjectAnchor)
    if (root.targetKind === 'planning_entity') {
      const title = catalog.find((surface) => surface.targetKey === `planning_entity:${root.targetId}:title`)?.value
      if (cleanText(title).length >= 2) anchors.push(cleanText(title))
      for (const surface of catalog.filter((candidate) => candidate.links?.includes(root.targetId))) {
        add(surface, 'required', '该内容通过结构化关系直接引用了根设定。', [`link:${root.targetId}`], true)
      }
    }
    if (root.targetKind === 'chapter' || root.targetKind === 'chapter_card' || root.targetKind === 'scene_plan' || root.targetKind === 'manuscript') {
      for (const surface of catalog.filter((candidate) => candidate.targetId === root.targetId && candidate.targetKey !== root.targetKey)) {
        add(surface, surface.manuscript ? 'review' : 'suggested', '该内容与根设定位于同一章节，需要检查状态和因果承接。', [`chapter:${root.targetId}`], !surface.manuscript)
      }
    }
    for (const surface of catalog) {
      if (surface.targetKey === root.targetKey) continue
      const text = valueText(surface.value)
      const matched = anchors.find((anchor) => text.includes(anchor))
      if (matched) {
        add(
          surface,
          surface.manuscript ? 'review' : 'suggested',
          `当前内容明确提到了“${matched.slice(0, 40)}”，需要核对是否仍成立。`,
          [`text:${matched.slice(0, 80)}`],
          !surface.manuscript,
        )
      }
    }
    return [...impacts.values()]
  }

  function insertItem(changeSetId, draft, timestamp, order) {
    const surface = draft.surface
    const id = createId('story-change-item')
    database.prepare(`
      INSERT INTO story_change_items (
        id, change_set_id, target_key, target_kind, target_id, field_key, field_label,
        before_json, after_json, impact_level, reason, evidence_json, selected,
        apply_order, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
    `).run(
      id, changeSetId, surface.targetKey, surface.targetKind, surface.targetId, surface.fieldKey,
      surface.fieldLabel, JSON.stringify(surface.value), JSON.stringify(draft.after ?? surface.value),
      draft.impactLevel, cleanText(draft.reason), JSON.stringify(draft.evidence || []), draft.selected ? 1 : 0,
      Number.isFinite(draft.applyOrder) ? draft.applyOrder : order, timestamp, timestamp,
    )
    return id
  }

  function getChangeSet(id) {
    const row = setById.get(id)
    if (!row) return null
    const items = database.prepare('SELECT * FROM story_change_items WHERE change_set_id = ? ORDER BY apply_order, created_at, rowid').all(id).map(mapItem)
    return mapSet(row, items)
  }

  function catalogForChangeSet(changeSet) {
    return buildCatalog(changeSet.projectId, { includeManuscript: changeSet.scope?.includeManuscript !== false })
  }

  function listChangeSets({ projectId, status = '', limit = 50 } = {}) {
    assertProject(projectId)
    const rows = status
      ? database.prepare('SELECT * FROM story_change_sets WHERE project_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?').all(projectId, status, Math.max(1, Math.min(Number(limit) || 50, 200)))
      : database.prepare('SELECT * FROM story_change_sets WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?').all(projectId, Math.max(1, Math.min(Number(limit) || 50, 200)))
    return rows.map((row) => getChangeSet(row.id))
  }

  function createChangeSet(input = {}) {
    const projectId = cleanText(input.projectId)
    assertProject(projectId)
    const scope = input.scope && typeof input.scope === 'object' && !Array.isArray(input.scope) ? input.scope : {}
    const catalog = buildCatalog(projectId, { includeManuscript: scope.includeManuscript !== false })
    const rootTargetKey = resolveTargetKey(input.target || input)
    const root = catalog.find((surface) => surface.targetKey === rootTargetKey)
    if (!root) throw new Error('联动修改的根设定不存在或尚未保存')
    const id = createId('story-change')
    const timestamp = now()
    const hasProposedValue = Object.hasOwn(input, 'proposedValue')
    const rootAfter = hasProposedValue ? input.proposedValue : root.value
    const impacts = deterministicImpacts(root, catalog).map((impact) => (
      impact.surface.targetKey === root.targetKey ? { ...impact, after: rootAfter } : impact
    ))
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO story_change_sets (
          id, project_id, agent_run_id, root_target_key, root_label, root_before_json, root_after_json,
          instruction, scope_json, source_digest, summary, status, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, '', 'draft', ?, ?)
      `).run(
        id, projectId, root.targetKey, root.fieldLabel, JSON.stringify(root.value), JSON.stringify(rootAfter),
        cleanText(input.instruction), JSON.stringify(scope), digestCatalog(catalog), timestamp, timestamp,
      )
      impacts.forEach((impact, index) => insertItem(id, impact, timestamp, index))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getChangeSet(id)
  }

  function modelContext(changeSetId) {
    const changeSet = getChangeSet(changeSetId)
    if (!changeSet) throw new Error('设定变更集不存在')
    if (!['draft', 'analyzing', 'waiting_confirmation'].includes(changeSet.status)) throw new Error('当前变更集已经结束')
    const catalog = catalogForChangeSet(changeSet)
    if (digestCatalog(catalog) !== changeSet.sourceDigest) {
      database.prepare("UPDATE story_change_sets SET status = 'stale', updated_at = ? WHERE id = ?").run(now(), changeSetId)
      throw new Error('项目内容已变化，请重新创建联动修改')
    }
    return {
      schemaVersion: 1,
      changeSetId,
      root: {
        targetKey: changeSet.rootTargetKey,
        label: changeSet.rootLabel,
        before: changeSet.rootBefore,
        proposedAfter: changeSet.rootAfter,
        instruction: changeSet.instruction,
      },
      scope: changeSet.scope,
      deterministicImpacts: changeSet.items.map((item) => ({
        targetKey: item.targetKey, impactLevel: item.impactLevel, reason: item.reason, evidence: item.evidence,
      })),
      catalog: catalog.map((surface) => ({
        targetKey: surface.targetKey,
        kind: surface.targetKind,
        label: surface.fieldLabel,
        value: surface.manuscript && valueText(surface.value).length > 4000
          ? `${valueText(surface.value).slice(0, 2000)}\n……\n${valueText(surface.value).slice(-2000)}`
          : surface.value,
        manuscript: surface.manuscript,
        chapterNo: surface.chapterNo || null,
      })),
    }
  }

  function attachAnalysis({ changeSetId, analysis = {}, agentRunId = '' } = {}) {
    const changeSet = getChangeSet(changeSetId)
    if (!changeSet) throw new Error('设定变更集不存在')
    if (!['draft', 'analyzing', 'waiting_confirmation'].includes(changeSet.status)) throw new Error('当前变更集已经结束')
    const catalog = catalogForChangeSet(changeSet)
    if (digestCatalog(catalog) !== changeSet.sourceDigest) throw new Error('项目内容已变化，请重新分析联动修改')
    const catalogMap = new Map(catalog.map((surface) => [surface.targetKey, surface]))
    const requested = Array.isArray(analysis.items) ? analysis.items : Array.isArray(analysis.changes) ? analysis.changes : []
    const drafts = new Map()
    for (const item of requested) {
      const targetKey = cleanText(item?.targetKey)
      const surface = catalogMap.get(targetKey)
      if (!surface) throw new Error(`联动候选引用了未知目标：${targetKey || '空目标'}`)
      const after = Object.hasOwn(item, 'after') ? item.after : Object.hasOwn(item, 'afterValue') ? item.afterValue : item.value
      if (after === undefined) throw new Error(`联动候选缺少修改后内容：${targetKey}`)
      const impactLevel = IMPACT_LEVELS.has(item.impactLevel) ? item.impactLevel : surface.targetKey === changeSet.rootTargetKey ? 'required' : surface.manuscript ? 'review' : 'suggested'
      drafts.set(targetKey, {
        surface, after, impactLevel,
        reason: cleanText(item.reason, '根据根设定变化同步校准。'),
        evidence: Array.isArray(item.evidence) ? item.evidence : [],
        selected: surface.targetKey === changeSet.rootTargetKey
          ? true
          : surface.manuscript ? item.selected === true : item.selected !== false,
        applyOrder: surface.targetKey === changeSet.rootTargetKey ? 0 : surface.manuscript ? 1000 + Number(surface.chapterNo || 0) : 100,
      })
    }
    if (!drafts.has(changeSet.rootTargetKey)) {
      const root = catalogMap.get(changeSet.rootTargetKey)
      if (jsonEqual(changeSet.rootBefore, changeSet.rootAfter) && !changeSet.instruction) throw new Error('联动分析没有返回根设定的新内容')
      drafts.set(changeSet.rootTargetKey, {
        surface: root, after: changeSet.rootAfter, impactLevel: 'required', reason: '本次联动修改的根设定。', evidence: ['root_target'], selected: true, applyOrder: 0,
      })
    }
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM story_change_items WHERE change_set_id = ?').run(changeSetId)
      ;[...drafts.values()].sort((left, right) => left.applyOrder - right.applyOrder).forEach((draft, index) => insertItem(changeSetId, draft, timestamp, draft.applyOrder + index))
      database.prepare(`
        UPDATE story_change_sets
        SET agent_run_id = NULLIF(?, ''), root_after_json = ?, summary = ?, status = 'waiting_confirmation', updated_at = ?
        WHERE id = ?
      `).run(
        agentRunId, JSON.stringify(drafts.get(changeSet.rootTargetKey).after),
        cleanText(analysis.summary, `“${changeSet.rootLabel}”联动修改，共 ${drafts.size} 项。`), timestamp, changeSetId,
      )
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getChangeSet(changeSetId)
  }

  function updateSelection({ changeSetId, itemIds = [], selected } = {}) {
    const changeSet = getChangeSet(changeSetId)
    if (!changeSet) throw new Error('设定变更集不存在')
    if (changeSet.status !== 'waiting_confirmation') throw new Error('当前变更集不在确认阶段')
    const allowed = new Set(changeSet.items.filter((item) => item.impactLevel !== 'required').map((item) => item.id))
    const ids = [...new Set(itemIds.map(cleanText).filter((id) => allowed.has(id)))]
    const timestamp = now()
    const update = database.prepare('UPDATE story_change_items SET selected = ?, updated_at = ? WHERE id = ? AND change_set_id = ?')
    database.exec('BEGIN IMMEDIATE')
    try {
      ids.forEach((id) => update.run(selected ? 1 : 0, timestamp, id, changeSetId))
      database.prepare('UPDATE story_change_sets SET updated_at = ? WHERE id = ?').run(timestamp, changeSetId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getChangeSet(changeSetId)
  }

  function writeSurface(surface, value, timestamp) {
    const storage = surface.storage
    const where = storage.extra
      ? `${storage.idColumn} = ? AND ${storage.extra.column} = ?`
      : `${storage.idColumn} = ?`
    const whereValues = storage.extra ? [storage.id, storage.extra.value] : [storage.id]
    if (storage.jsonColumn) {
      const row = database.prepare(`SELECT ${storage.jsonColumn} AS value FROM ${storage.table} WHERE ${where}`).get(...whereValues)
      if (!row) throw new Error(`联动目标已经不存在：${surface.targetKey}`)
      const next = setPath(parseJson(row.value, {}), storage.jsonPath, value)
      if (storage.projection === 'scene_plan') {
        database.prepare(`UPDATE ${storage.table} SET ${storage.jsonColumn} = ?, scene_plan = ?, updated_at = ? WHERE ${where}`)
          .run(JSON.stringify(next), renderScenePlanProjection(next), timestamp, ...whereValues)
      } else {
        database.prepare(`UPDATE ${storage.table} SET ${storage.jsonColumn} = ?, updated_at = ? WHERE ${where}`)
          .run(JSON.stringify(next), timestamp, ...whereValues)
      }
      return
    }
    database.prepare(`UPDATE ${storage.table} SET ${storage.column} = ?, updated_at = ? WHERE ${where}`)
      .run(typeof value === 'string' ? value : JSON.stringify(value), timestamp, ...whereValues)
  }

  function renderScenePlanProjection(scenePlan) {
    const lines = []
    if (cleanText(scenePlan?.summary)) lines.push(cleanText(scenePlan.summary))
    for (const scene of Array.isArray(scenePlan?.scenes) ? scenePlan.scenes : []) {
      const title = cleanText(scene?.title, cleanText(scene?.id, '场景'))
      const detail = [scene?.goal, scene?.obstacle, scene?.turn, scene?.exitState].map(cleanText).filter(Boolean).join(' → ')
      lines.push(detail ? `${title}：${detail}` : title)
    }
    if (cleanText(scenePlan?.legacyNotes)) lines.push(cleanText(scenePlan.legacyNotes))
    return lines.join('\n\n')
  }

  function applyChangeSet({ changeSetId, excludeAgentCandidateId = '' } = {}) {
    const changeSet = getChangeSet(changeSetId)
    if (!changeSet) throw new Error('设定变更集不存在')
    if (changeSet.status !== 'waiting_confirmation') throw new Error('当前变更集不在待确认状态')
    const catalog = catalogForChangeSet(changeSet)
    const catalogMap = new Map(catalog.map((surface) => [surface.targetKey, surface]))
    const selected = changeSet.items.filter((item) => item.selected)
    if (!selected.length) throw new Error('至少选择一项联动修改')
    for (const item of selected) {
      const surface = catalogMap.get(item.targetKey)
      if (!surface || !jsonEqual(surface.value, item.before)) {
        database.prepare("UPDATE story_change_sets SET status = 'stale', updated_at = ? WHERE id = ?").run(now(), changeSetId)
        throw new Error(`“${item.fieldLabel}”已被修改，请重新分析后再应用`)
      }
    }
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const insertSnapshot = database.prepare(`
        INSERT INTO story_change_snapshots (id, change_set_id, item_id, target_key, value_json, revision_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of selected.sort((left, right) => left.applyOrder - right.applyOrder)) {
        const surface = catalogMap.get(item.targetKey)
        let revisionId = null
        if (surface.manuscript) {
          revisionId = createId('revision')
          database.prepare('INSERT INTO revisions (id, chapter_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(revisionId, surface.targetId, String(surface.value || ''), `before-story-change:${changeSetId}`, timestamp)
        }
        insertSnapshot.run(createId('story-change-snapshot'), changeSetId, item.id, item.targetKey, JSON.stringify(surface.value), revisionId, timestamp)
        writeSurface(surface, item.after, timestamp)
        database.prepare("UPDATE story_change_items SET status = 'applied', updated_at = ? WHERE id = ?").run(timestamp, item.id)
      }
      database.prepare("UPDATE story_change_items SET status = 'skipped', updated_at = ? WHERE change_set_id = ? AND selected = 0")
        .run(timestamp, changeSetId)
      database.prepare("UPDATE story_change_sets SET status = 'applied', applied_at = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, timestamp, changeSetId)
      database.prepare("UPDATE planning_candidates SET status = 'discarded', resolved_at = ? WHERE project_id = ? AND status = 'pending'")
        .run(timestamp, changeSet.projectId)
      if (excludeAgentCandidateId) {
        database.prepare(`
          UPDATE agent_candidates SET status = 'stale', resolved_at = ?
          WHERE status = 'pending' AND id != ? AND run_id IN (SELECT id FROM agent_runs WHERE project_id = ?)
        `).run(timestamp, excludeAgentCandidateId, changeSet.projectId)
      } else {
        database.prepare(`
          UPDATE agent_candidates SET status = 'stale', resolved_at = ?
          WHERE status = 'pending' AND run_id IN (SELECT id FROM agent_runs WHERE project_id = ?)
        `).run(timestamp, changeSet.projectId)
      }
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, changeSet.projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getChangeSet(changeSetId)
  }

  function revertChangeSet(changeSetId) {
    const changeSet = getChangeSet(changeSetId)
    if (!changeSet) throw new Error('设定变更集不存在')
    if (changeSet.status !== 'applied') throw new Error('只有已应用的变更集可以撤销')
    const catalog = catalogForChangeSet(changeSet)
    const catalogMap = new Map(catalog.map((surface) => [surface.targetKey, surface]))
    const snapshots = database.prepare(`
      SELECT snapshot.*, item.after_json, item.field_label, item.apply_order
      FROM story_change_snapshots snapshot
      JOIN story_change_items item ON item.id = snapshot.item_id
      WHERE snapshot.change_set_id = ?
      ORDER BY item.apply_order DESC, snapshot.created_at DESC
    `).all(changeSetId)
    for (const snapshot of snapshots) {
      const surface = catalogMap.get(snapshot.target_key)
      if (!surface || !jsonEqual(surface.value, parseJson(snapshot.after_json))) {
        throw new Error(`“${snapshot.field_label}”在应用后又被修改，为避免覆盖新内容，暂不撤销整组`)
      }
    }
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const snapshot of snapshots) {
        const surface = catalogMap.get(snapshot.target_key)
        if (surface.manuscript) {
          database.prepare('INSERT INTO revisions (id, chapter_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(createId('revision'), surface.targetId, String(surface.value || ''), `before-story-change-revert:${changeSetId}`, timestamp)
        }
        writeSurface(surface, parseJson(snapshot.value_json), timestamp)
      }
      database.prepare("UPDATE story_change_items SET status = CASE WHEN status = 'applied' THEN 'reverted' ELSE status END, updated_at = ? WHERE change_set_id = ?")
        .run(timestamp, changeSetId)
      database.prepare("UPDATE story_change_sets SET status = 'reverted', reverted_at = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, timestamp, changeSetId)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, changeSet.projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getChangeSet(changeSetId)
  }

  function updateStatus({ changeSetId, status, summary = '' } = {}) {
    if (!SET_STATUSES.has(status)) throw new Error('设定变更集状态不受支持')
    if (!setById.get(changeSetId)) throw new Error('设定变更集不存在')
    database.prepare('UPDATE story_change_sets SET status = ?, summary = CASE WHEN ? = \'\' THEN summary ELSE ? END, updated_at = ? WHERE id = ?')
      .run(status, cleanText(summary), cleanText(summary), now(), changeSetId)
    return getChangeSet(changeSetId)
  }

  return {
    buildCatalog: (projectId, options) => buildCatalog(projectId, options).map(({ storage, links, source, ...surface }) => surface),
    createChangeSet,
    getChangeSet,
    listChangeSets,
    modelContext,
    attachAnalysis,
    updateSelection,
    applyChangeSet,
    revertChangeSet,
    updateStatus,
    resolveTargetKey,
  }
}
