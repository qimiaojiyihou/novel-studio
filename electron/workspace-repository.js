import { randomUUID } from 'node:crypto'

function parseJson(value, fallback) {
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

function mapChapter(chapter) {
  if (!chapter) return null
  return { ...chapter, card: parseJson(chapter.card_json, {}) }
}

function mapProject(project) {
  if (!project) return null
  return { ...project, archived: Boolean(project.archived_at) }
}

export function createWorkspaceRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')
  const chapterById = database.prepare('SELECT * FROM chapters WHERE id = ?')

  function listChapters(projectId) {
    return database.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId).map(mapChapter)
  }

  function renumberChapters(projectId, orderedIds) {
    const setChapterNo = database.prepare('UPDATE chapters SET chapter_no = ? WHERE id = ? AND project_id = ?')
    const currentMax = Number(database.prepare('SELECT COALESCE(MAX(chapter_no), 0) AS chapterNo FROM chapters WHERE project_id = ?').get(projectId).chapterNo)
    const temporaryOffset = currentMax + orderedIds.length + 1
    orderedIds.forEach((id, index) => setChapterNo.run(temporaryOffset + index, id, projectId))
    orderedIds.forEach((id, index) => setChapterNo.run(index + 1, id, projectId))
  }

  function activeProjectId() {
    return database.prepare("SELECT value FROM app_settings WHERE key = 'active_project_id'").get()?.value || ''
  }

  function setActiveProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能继续创作')
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(projectId, now())
    return projectId
  }

  function listProjects() {
    return database.prepare(`
      SELECT p.*,
        COUNT(c.id) AS chapterCount,
        COALESCE(SUM(LENGTH(c.manuscript)), 0) AS characterCount
      FROM projects p
      LEFT JOIN chapters c ON c.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.created_at DESC
    `).all().map((project) => ({
      ...project,
      chapterCount: Number(project.chapterCount || 0),
      characterCount: Number(project.characterCount || 0),
      archived: Boolean(project.archived_at),
      active: project.id === activeProjectId(),
    }))
  }

  function loadWorkspace(projectId = '') {
    let selectedId = projectId || activeProjectId()
    let project = selectedId ? projectById.get(selectedId) : null
    if (project?.archived_at) project = null
    if (!project) {
      project = database.prepare("SELECT * FROM projects WHERE archived_at = '' ORDER BY updated_at DESC, created_at DESC LIMIT 1").get()
      selectedId = project?.id || ''
    }
    if (!project) return { project: null, chapters: [], projects: [] }
    setActiveProject(selectedId)
    return { project: mapProject(project), chapters: listChapters(selectedId), projects: listProjects() }
  }

  function createChapter({ projectId, title = '', mode = 'blank', sourceChapterId = '' }) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    if (project.archived_at) throw new Error('归档项目需要先恢复才能添加章节')
    const source = sourceChapterId ? chapterById.get(sourceChapterId) : null
    if (source && source.project_id !== projectId) throw new Error('模板章节不属于当前项目')
    const chapterNo = Number(database.prepare('SELECT COALESCE(MAX(chapter_no), 0) + 1 AS chapterNo FROM chapters WHERE project_id = ?').get(projectId).chapterNo)
    const id = createId('chapter')
    const updatedAt = now()
    const copyPlan = mode === 'copy-plan' && source
    database.prepare(`
      INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, '', ?)
    `).run(
      id,
      projectId,
      chapterNo,
      cleanText(title, `第 ${chapterNo} 章`),
      copyPlan ? source.card_json : '{}',
      copyPlan ? source.scene_plan : '',
      updatedAt,
    )
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, projectId)
    return mapChapter(chapterById.get(id))
  }

  function createProject(input = {}) {
    const id = createId('project')
    const createdAt = now()
    const title = cleanText(input.title, '未命名小说')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        title,
        cleanText(input.genre, '未设置题材'),
        cleanText(input.idea),
        cleanText(input.style, '克制、具体、以动作和对白推进。'),
        createdAt,
        createdAt,
      )
      const chapterId = createId('chapter')
      database.prepare(`
        INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
        VALUES (?, ?, 1, '第一章', 'draft', '{}', '', '', ?)
      `).run(chapterId, id, createdAt)
      database.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(id, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return loadWorkspace(id)
  }

  function updateProject(patch = {}) {
    const projectId = patch.id || activeProjectId()
    if (!projectById.get(projectId)) throw new Error('项目不存在')
    const allowed = ['title', 'genre', 'idea', 'style']
    const entries = Object.entries(patch)
      .filter(([key]) => allowed.includes(key))
      .map(([key, value]) => [key, key === 'title' ? cleanText(value, '未命名小说') : String(value ?? '').trim()])
    if (!entries.length) return projectById.get(projectId)
    const values = entries.map(([, value]) => value)
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
    values.push(now(), projectId)
    database.prepare(`UPDATE projects SET ${assignments}, updated_at = ? WHERE id = ?`).run(...values)
    return mapProject(projectById.get(projectId))
  }

  function updateChapter(patch = {}) {
    const chapterId = patch.id
    const current = chapterById.get(chapterId)
    if (!current) throw new Error('章节不存在')
    const updates = []
    const values = []
    let nextVolumeId = null
    if (typeof patch.title === 'string') { updates.push('title = ?'); values.push(cleanText(patch.title, `第 ${current.chapter_no} 章`)) }
    if (typeof patch.status === 'string') { updates.push('status = ?'); values.push(patch.status) }
    if (typeof patch.manuscript === 'string') { updates.push('manuscript = ?'); values.push(patch.manuscript) }
    if (typeof patch.scenePlan === 'string') { updates.push('scene_plan = ?'); values.push(patch.scenePlan) }
    if (patch.card && typeof patch.card === 'object') {
      nextVolumeId = cleanText(patch.card.volumeId)
      if (nextVolumeId) {
        const volume = database.prepare("SELECT id FROM planning_entities WHERE id = ? AND project_id = ? AND kind = 'volume'").get(nextVolumeId, current.project_id)
        if (!volume) throw new Error('章节所属分卷必须来自当前项目')
      }
      updates.push('card_json = ?')
      values.push(JSON.stringify(patch.card))
    }
    if (!updates.length) return mapChapter(current)
    const updatedAt = now()
    values.push(updatedAt, chapterId)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`UPDATE chapters SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...values)
      if (patch.card && typeof patch.card === 'object') {
        database.prepare('UPDATE story_arc_beats SET volume_id = ?, updated_at = ? WHERE chapter_id = ?')
          .run(nextVolumeId || null, updatedAt, chapterId)
      }
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, current.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapChapter(chapterById.get(chapterId))
  }

  function createRevision({ chapterId, content = '', source = 'manual' }) {
    if (!chapterById.get(chapterId)) throw new Error('章节不存在')
    const revision = { id: createId('revision'), chapterId, content, source, createdAt: now() }
    database.prepare(`
      INSERT INTO revisions (id, chapter_id, content, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(revision.id, chapterId, content, source, revision.createdAt)
    return revision
  }

  function listRevisions(chapterId) {
    if (!chapterById.get(chapterId)) throw new Error('章节不存在')
    return database.prepare(`
      SELECT id, chapter_id AS chapterId, content, source, created_at AS createdAt
      FROM revisions
      WHERE chapter_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(chapterId).map((revision) => ({ ...revision, characterCount: Array.from(revision.content).length }))
  }

  function restoreRevision({ chapterId, revisionId }) {
    const chapter = chapterById.get(chapterId)
    if (!chapter) throw new Error('章节不存在')
    const revision = database.prepare('SELECT * FROM revisions WHERE id = ? AND chapter_id = ?').get(revisionId, chapterId)
    if (!revision) throw new Error('版本不存在或不属于当前章节')
    if (revision.content === chapter.manuscript) {
      return { chapter: mapChapter(chapter), preservedRevisionId: '' }
    }
    const restoredAt = now()
    const preservedRevisionId = createId('revision')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO revisions (id, chapter_id, content, source, created_at)
        VALUES (?, ?, ?, 'before-version-restore', ?)
      `).run(preservedRevisionId, chapterId, chapter.manuscript, restoredAt)
      database.prepare('UPDATE chapters SET manuscript = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(revision.content, 'draft', restoredAt, chapterId)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(restoredAt, chapter.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { chapter: mapChapter(chapterById.get(chapterId)), preservedRevisionId }
  }

  function archiveProject(projectId) {
    const current = projectById.get(projectId)
    if (!current) throw new Error('项目不存在')
    if (current.archived_at) return loadWorkspace()
    const availableCount = Number(database.prepare("SELECT COUNT(*) AS count FROM projects WHERE archived_at = ''").get().count)
    if (availableCount <= 1) throw new Error('至少保留一个未归档项目')
    const archivedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?').run(archivedAt, archivedAt, projectId)
      if (activeProjectId() === projectId) {
        const next = database.prepare("SELECT id FROM projects WHERE archived_at = '' ORDER BY updated_at DESC, created_at DESC LIMIT 1").get()
        database.prepare(`
          INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(next.id, archivedAt)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return loadWorkspace()
  }

  function restoreProject(projectId) {
    const current = projectById.get(projectId)
    if (!current) throw new Error('项目不存在')
    if (!current.archived_at) return mapProject(current)
    const restoredAt = now()
    database.prepare("UPDATE projects SET archived_at = '', updated_at = ? WHERE id = ?").run(restoredAt, projectId)
    return mapProject(projectById.get(projectId))
  }

  function deleteProject(projectId) {
    const current = projectById.get(projectId)
    if (!current) throw new Error('项目不存在')
    const availableCount = Number(database.prepare("SELECT COUNT(*) AS count FROM projects WHERE archived_at = ''").get().count)
    if (!current.archived_at && availableCount <= 1) throw new Error('至少保留一个未归档项目')
    const deletedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      if (activeProjectId() === projectId) {
        const next = database.prepare("SELECT id FROM projects WHERE archived_at = '' ORDER BY updated_at DESC, created_at DESC LIMIT 1").get()
        database.prepare(`
          INSERT INTO app_settings (key, value, updated_at) VALUES ('active_project_id', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(next.id, deletedAt)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return loadWorkspace()
  }

  function reorderChapters({ projectId, chapterIds = [] }) {
    const currentIds = listChapters(projectId).map((chapter) => chapter.id)
    if (chapterIds.length !== currentIds.length || new Set(chapterIds).size !== currentIds.length || currentIds.some((id) => !chapterIds.includes(id))) {
      throw new Error('章节排序列表与当前项目不一致')
    }
    const updatedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      renumberChapters(projectId, chapterIds)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, projectId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return listChapters(projectId)
  }

  function duplicateChapter(chapterId) {
    const source = chapterById.get(chapterId)
    if (!source) throw new Error('章节不存在')
    const id = createId('chapter')
    const updatedAt = now()
    const currentChapters = listChapters(source.project_id)
    const sourceIndex = currentChapters.findIndex((chapter) => chapter.id === chapterId)
    const orderedIds = currentChapters.map((chapter) => chapter.id)
    orderedIds.splice(sourceIndex + 1, 0, id)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `).run(id, source.project_id, currentChapters.length + 1, `${source.title} · 副本`, source.card_json, source.scene_plan, source.manuscript, updatedAt)
      renumberChapters(source.project_id, orderedIds)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, source.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { chapter: mapChapter(chapterById.get(id)), chapters: listChapters(source.project_id) }
  }

  function deleteChapter(chapterId) {
    const current = chapterById.get(chapterId)
    if (!current) throw new Error('章节不存在')
    const currentChapters = listChapters(current.project_id)
    if (currentChapters.length <= 1) throw new Error('每个项目至少保留一个章节')
    const currentIndex = currentChapters.findIndex((chapter) => chapter.id === chapterId)
    const remainingIds = currentChapters.filter((chapter) => chapter.id !== chapterId).map((chapter) => chapter.id)
    const nextId = remainingIds[Math.min(currentIndex, remainingIds.length - 1)]
    const updatedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("DELETE FROM style_profiles WHERE project_id = ? AND scope_type = 'chapter' AND scope_id = ?")
        .run(current.project_id, chapterId)
      database.prepare("DELETE FROM prompt_bindings WHERE project_id = ? AND scope_type = 'chapter' AND scope_id = ?")
        .run(current.project_id, chapterId)
      database.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId)
      renumberChapters(current.project_id, remainingIds)
      database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, current.project_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { activeChapterId: nextId, chapters: listChapters(current.project_id) }
  }

  return {
    activeProjectId,
    setActiveProject,
    listProjects,
    loadWorkspace,
    createProject,
    createChapter,
    updateProject,
    archiveProject,
    restoreProject,
    deleteProject,
    updateChapter,
    reorderChapters,
    duplicateChapter,
    deleteChapter,
    createRevision,
    listRevisions,
    restoreRevision,
  }
}
