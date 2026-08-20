import { app, safeStorage } from 'electron'
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

function encryptApiKey(value) {
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(value).toString('base64')
  }
  return 'plain:' + value
}

function decryptApiKey(value) {
  if (!value) return ''
  if (value.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return value.startsWith('plain:') ? value.slice(6) : ''
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
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      api_key_cipher TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_routes (
      task TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(model_profile_id) REFERENCES model_profiles(id)
    );
  `)
  seedDatabase()
  seedModelProfiles()
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

function seedModelProfiles() {
  const profile = database.prepare('SELECT id FROM model_profiles LIMIT 1').get()
  if (!profile) {
    const createdAt = timestamp()
    const profiles = [
      ['local-default', 'local', '本地正文模型', 'http://127.0.0.1:8080/v1', '', ''],
      ['deepseek-default', 'deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', '', ''],
      ['openai-default', 'openai', 'OpenAI', 'https://api.openai.com/v1', '', ''],
      ['kimi-default', 'kimi', 'Kimi', 'https://api.moonshot.cn/v1', '', ''],
    ]
    const statement = `
      INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `
    const insert = database.prepare(statement)
    for (const [id, provider, name, baseUrl, model, apiKey] of profiles) {
      insert.run(id, provider, name, baseUrl, model, encryptApiKey(apiKey), createdAt, createdAt)
    }
  }

  const routeCount = database.prepare('SELECT COUNT(*) AS count FROM task_routes').get()
  if (Number(routeCount.count) === 0) {
    const createdAt = timestamp()
    const insert = database.prepare('INSERT INTO task_routes (task, model_profile_id, updated_at) VALUES (?, ?, ?)')
    insert.run('chapter', 'local-default', createdAt)
    insert.run('chapter_card', 'deepseek-default', createdAt)
    insert.run('scene_plan', 'deepseek-default', createdAt)
    insert.run('rewrite', 'local-default', createdAt)
  }
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

export function loadModelSettings() {
  openDatabase()
  const profiles = database.prepare(`
    SELECT id, provider, name, base_url AS baseUrl, model, enabled, created_at AS createdAt, updated_at AS updatedAt,
      CASE WHEN api_key_cipher != '' THEN 1 ELSE 0 END AS apiKeyConfigured
    FROM model_profiles
    ORDER BY CASE provider
      WHEN 'local' THEN 0
      WHEN 'deepseek' THEN 1
      WHEN 'openai' THEN 2
      WHEN 'kimi' THEN 3
      ELSE 4
    END, created_at
  `).all().map((profile) => ({
    ...profile,
    enabled: Boolean(profile.enabled),
    apiKeyConfigured: Boolean(profile.apiKeyConfigured),
  }))
  const routes = Object.fromEntries(database.prepare(`
    SELECT task, model_profile_id AS modelProfileId FROM task_routes
  `).all().map((route) => [route.task, route.modelProfileId]))
  return { profiles, routes }
}

export function saveModelProfile(profile = {}) {
  openDatabase()
  const id = profile.id || 'profile-' + Date.now()
  const existing = database.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id)
  const createdAt = existing?.created_at || timestamp()
  const updatedAt = timestamp()
  const apiKeyCipher = Object.prototype.hasOwnProperty.call(profile, 'apiKey')
    ? encryptApiKey(String(profile.apiKey || ''))
    : existing?.api_key_cipher || ''
  database.prepare(`
    INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      name = excluded.name,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key_cipher = excluded.api_key_cipher,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    id,
    profile.provider || 'custom',
    profile.name || '未命名模型',
    profile.baseUrl || '',
    profile.model || '',
    apiKeyCipher,
    profile.enabled === false ? 0 : 1,
    createdAt,
    updatedAt,
  )
  return loadModelSettings().profiles.find((item) => item.id === id)
}

export function deleteModelProfile(id) {
  openDatabase()
  const route = database.prepare('SELECT task FROM task_routes WHERE model_profile_id = ? LIMIT 1').get(id)
  if (route) throw new Error('模型仍被任务路由使用，请先切换任务路由')
  database.prepare('DELETE FROM model_profiles WHERE id = ?').run(id)
  return loadModelSettings()
}

export function updateTaskRoute(task, modelProfileId) {
  openDatabase()
  const profile = database.prepare('SELECT id FROM model_profiles WHERE id = ?').get(modelProfileId)
  if (!profile) throw new Error('模型配置不存在')
  database.prepare(`
    INSERT INTO task_routes (task, model_profile_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(task) DO UPDATE SET model_profile_id = excluded.model_profile_id, updated_at = excluded.updated_at
  `).run(task, modelProfileId, timestamp())
  return loadModelSettings().routes
}

export function getModelApiKey(id) {
  openDatabase()
  const profile = database.prepare('SELECT api_key_cipher FROM model_profiles WHERE id = ?').get(id)
  return decryptApiKey(profile?.api_key_cipher || '')
}
