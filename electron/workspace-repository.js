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

export function createWorkspaceRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')
  const chapterById = database.prepare('SELECT * FROM chapters WHERE id = ?')

  function activeProjectId() {
    return database.prepare("SELECT value FROM app_settings WHERE key = 'active_project_id'").get()?.value || ''
  }

  function setActiveProject(projectId) {
    if (!projectById.get(projectId)) throw new Error('项目不存在')
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
      active: project.id === activeProjectId(),
    }))
  }

  function loadWorkspace(projectId = '') {
    let selectedId = projectId || activeProjectId()
    let project = selectedId ? projectById.get(selectedId) : null
    if (!project) {
      project = database.prepare('SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC LIMIT 1').get()
      selectedId = project?.id || ''
    }
    if (!project) return { project: null, chapters: [], projects: [] }
    setActiveProject(selectedId)
    const chapters = database.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(selectedId)
    return { project, chapters: chapters.map(mapChapter), projects: listProjects() }
  }

  function createChapter({ projectId, title = '' }) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    const chapterNo = Number(database.prepare('SELECT COALESCE(MAX(chapter_no), 0) + 1 AS chapterNo FROM chapters WHERE project_id = ?').get(projectId).chapterNo)
    const id = createId('chapter')
    const updatedAt = now()
    database.prepare(`
      INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
      VALUES (?, ?, ?, ?, 'draft', '{}', '', '', ?)
    `).run(id, projectId, chapterNo, cleanText(title, `第 ${chapterNo} 章`), updatedAt)
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
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key))
    if (!entries.length) return projectById.get(projectId)
    const values = entries.map(([, value]) => value)
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
    values.push(now(), projectId)
    database.prepare(`UPDATE projects SET ${assignments}, updated_at = ? WHERE id = ?`).run(...values)
    return projectById.get(projectId)
  }

  function updateChapter(patch = {}) {
    const chapterId = patch.id
    const current = chapterById.get(chapterId)
    if (!current) throw new Error('章节不存在')
    const updates = []
    const values = []
    if (typeof patch.title === 'string') { updates.push('title = ?'); values.push(patch.title) }
    if (typeof patch.status === 'string') { updates.push('status = ?'); values.push(patch.status) }
    if (typeof patch.manuscript === 'string') { updates.push('manuscript = ?'); values.push(patch.manuscript) }
    if (typeof patch.scenePlan === 'string') { updates.push('scene_plan = ?'); values.push(patch.scenePlan) }
    if (patch.card && typeof patch.card === 'object') { updates.push('card_json = ?'); values.push(JSON.stringify(patch.card)) }
    if (!updates.length) return mapChapter(current)
    const updatedAt = now()
    values.push(updatedAt, chapterId)
    database.prepare(`UPDATE chapters SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...values)
    database.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(updatedAt, current.project_id)
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

  return {
    activeProjectId,
    setActiveProject,
    listProjects,
    loadWorkspace,
    createProject,
    createChapter,
    updateProject,
    updateChapter,
    createRevision,
    listRevisions,
    restoreRevision,
  }
}
