import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let database

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function timestamp() {
  return new Date().toISOString()
}

export function getDatabasePath() {
  const directory = app.getPath('userData')
  fs.mkdirSync(directory, { recursive: true })
  return path.join(directory, 'novel-studio.sqlite')
}

export function openDatabase() {
  if (database) return database
  database = new DatabaseSync(getDatabasePath())
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      idea TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      card_json TEXT NOT NULL DEFAULT '{}',
      scene_plan TEXT NOT NULL DEFAULT '',
      manuscript TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(chapter_id) REFERENCES chapters(id)
    );
  `)
  seedDatabase()
  return database
}

function seedDatabase() {
  const project = database.prepare('SELECT id FROM projects LIMIT 1').get()
  if (project) return

  const projectId = 'project-demo'
  const chapterId = 'chapter-001'
  const createdAt = timestamp()
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    '未完成的第二幕',
    '都市 · 文娱',
    '一个被行业忽视的年轻人，在一次意外机会后决定重新进入故事中心。',
    '克制、具体、以动作和对白推进；情绪不直接解释，让人物自己暴露选择。',
    createdAt,
    createdAt,
  )
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chapterId,
    projectId,
    1,
    '旧车站的邀请',
    'draft',
    JSON.stringify({ goal: '让主角面对一个无法继续回避的选择。', requiredScenes: [] }),
    '',
    '夜里的工作室只开着一盏台灯。\n\n这里还没有正文。你可以先填写故事基础，也可以让 Novel Studio 生成一张章节卡。',
    createdAt,
  )
}

export function loadWorkspace() {
  openDatabase()
  const project = database.prepare('SELECT * FROM projects ORDER BY created_at LIMIT 1').get()
  const chapters = database.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(project.id)
  return {
    project,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      card: parseJson(chapter.card_json, {}),
    })),
  }
}

export function updateProject(patch) {
  openDatabase()
  const allowed = ['title', 'genre', 'idea', 'style']
  const entries = Object.entries(patch || {}).filter(([key]) => allowed.includes(key))
  if (!entries.length) return loadWorkspace().project
  const values = entries.map(([, value]) => value)
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
  values.push(timestamp(), patch.id || 'project-demo')
  database.prepare(`UPDATE projects SET ${assignments}, updated_at = ? WHERE id = ?`).run(...values)
  return loadWorkspace().project
}

export function updateChapter(patch) {
  openDatabase()
  const chapterId = patch.id || 'chapter-001'
  const updates = []
  const values = []
  if (typeof patch.title === 'string') { updates.push('title = ?'); values.push(patch.title) }
  if (typeof patch.status === 'string') { updates.push('status = ?'); values.push(patch.status) }
  if (typeof patch.manuscript === 'string') { updates.push('manuscript = ?'); values.push(patch.manuscript) }
  if (typeof patch.scenePlan === 'string') { updates.push('scene_plan = ?'); values.push(patch.scenePlan) }
  if (patch.card && typeof patch.card === 'object') { updates.push('card_json = ?'); values.push(JSON.stringify(patch.card)) }
  if (!updates.length) return loadWorkspace().chapters.find((chapter) => chapter.id === chapterId)
  values.push(timestamp(), chapterId)
  database.prepare(`UPDATE chapters SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...values)
  return loadWorkspace().chapters.find((chapter) => chapter.id === chapterId)
}

export function createRevision({ chapterId = 'chapter-001', content = '', source = 'manual' }) {
  openDatabase()
  const id = `revision-${Date.now()}`
  database.prepare(`
    INSERT INTO revisions (id, chapter_id, content, source, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, chapterId, content, source, timestamp())
  return { id, chapterId, content, source }
}
