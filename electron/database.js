import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getSchemaVersion, runMigrations } from './database-migrations.js'
import { createKnowledgeRepository } from './knowledge-repository.js'
import { createPlanningRepository } from './planning-repository.js'
import { createWorkspaceRepository } from './workspace-repository.js'

let database
let workspaceRepository
let planningRepository
let knowledgeRepository

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
  runMigrations(database)
  seedDatabase()
  seedModelProfiles()
  workspaceRepository = createWorkspaceRepository(database)
  planningRepository = createPlanningRepository(database)
  knowledgeRepository = createKnowledgeRepository(database)
  return database
}

function workspaceStore() {
  openDatabase()
  return workspaceRepository
}

function planningStore() {
  openDatabase()
  return planningRepository
}

function knowledgeStore() {
  openDatabase()
  return knowledgeRepository
}

export function getDatabaseInfo() {
  openDatabase()
  return {
    path: getDatabasePath(),
    schemaVersion: getSchemaVersion(database),
    foreignKeys: Boolean(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys),
    journalMode: database.prepare('PRAGMA journal_mode').get()?.journal_mode || '',
  }
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

  const createdAt = timestamp()
  const insert = database.prepare('INSERT OR IGNORE INTO task_routes (task, model_profile_id, updated_at) VALUES (?, ?, ?)')
  insert.run('chapter', 'local-default', createdAt)
  insert.run('planning_field', 'deepseek-default', createdAt)
  insert.run('chapter_card', 'deepseek-default', createdAt)
  insert.run('scene_plan', 'deepseek-default', createdAt)
  insert.run('rewrite', 'local-default', createdAt)
}

export function loadWorkspace(projectId = '') {
  return workspaceStore().loadWorkspace(projectId)
}

export function listProjects() {
  return workspaceStore().listProjects()
}

export function createProject(input) {
  return workspaceStore().createProject(input)
}

export function createChapter(input) {
  return workspaceStore().createChapter(input)
}

export function updateProject(patch) {
  return workspaceStore().updateProject(patch)
}

export function archiveProject(projectId) {
  return workspaceStore().archiveProject(projectId)
}

export function restoreProject(projectId) {
  return workspaceStore().restoreProject(projectId)
}

export function deleteProject(projectId) {
  return workspaceStore().deleteProject(projectId)
}

export function updateChapter(patch) {
  return workspaceStore().updateChapter(patch)
}

export function reorderChapters(input) {
  return workspaceStore().reorderChapters(input)
}

export function duplicateChapter(chapterId) {
  return workspaceStore().duplicateChapter(chapterId)
}

export function deleteChapter(chapterId) {
  return workspaceStore().deleteChapter(chapterId)
}

export function createRevision(input) {
  return workspaceStore().createRevision(input)
}

export function listRevisions(chapterId) {
  return workspaceStore().listRevisions(chapterId)
}

export function restoreRevision(input) {
  return workspaceStore().restoreRevision(input)
}

export function loadPlanningCenter(projectId) {
  return planningStore().loadPlanningCenter(projectId)
}

export function savePlanningDocument(input) {
  return planningStore().saveDocument(input)
}

export function createPlanningEntity(input) {
  return planningStore().createEntity(input)
}

export function updatePlanningEntity(input) {
  return planningStore().updateEntity(input)
}

export function reorderPlanningEntities(input) {
  return planningStore().reorderEntities(input)
}

export function deletePlanningEntity(entityId) {
  return planningStore().deleteEntity(entityId)
}

export function createPlanningCandidate(input) {
  return planningStore().createCandidate(input)
}

export function resolvePlanningCandidate(input) {
  return planningStore().resolveCandidate(input)
}

export function loadKnowledgeCenter(projectId) {
  return knowledgeStore().loadKnowledgeCenter(projectId)
}

export function syncKnowledgeSources(projectId) {
  return knowledgeStore().syncPlanningSources(projectId)
}

export function refreshContinuityChecks(projectId) {
  return knowledgeStore().refreshContinuityChecks(projectId)
}

export function createKnowledgeItem(input) {
  return knowledgeStore().createItem(input)
}

export function updateKnowledgeItem(input) {
  return knowledgeStore().updateItem(input)
}

export function reorderKnowledgeItems(input) {
  return knowledgeStore().reorderItems(input)
}

export function deleteKnowledgeItem(itemId) {
  return knowledgeStore().deleteItem(itemId)
}

export function resolveContinuityCheck(input) {
  return knowledgeStore().resolveCheck(input)
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
