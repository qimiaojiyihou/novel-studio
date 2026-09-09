import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getSchemaVersion, runMigrations } from './database-migrations.js'
import { createKnowledgeRepository } from './knowledge-repository.js'
import { createContextRepository } from './context-repository.js'
import { createCodexRepository } from './codex-repository.js'
import { repairMissingCreativePackBindings } from './creative-pack.js'
import { createPlanningRepository } from './planning-repository.js'
import { createProjectBackup, importManuscriptProject, restoreProjectBackup } from './project-portability.js'
import { createPromptRepository } from './prompt-repository.js'
import { createQualityRepository } from './quality-repository.js'
import { createStoryChangeRepository } from './story-change-repository.js'
import { createWorkspaceRepository } from './workspace-repository.js'

let database
let workspaceRepository
let planningRepository
let knowledgeRepository
let contextRepository
let promptRepository
let qualityRepository
let codexRepository
let storyChangeRepository

function timestamp() {
  return new Date().toISOString()
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function defaultModelSettings(provider) {
  if (provider !== 'deepseek') return {}
  return {
    thinkingEnabled: true,
    reasoningEffort: 'high',
    samplingMode: 'task-default',
    maxTokens: 4096,
    responseFormat: 'auto',
  }
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
  repairMissingCreativePackBindings(database, { boundAt: timestamp() })
  seedModelProfiles()
  workspaceRepository = createWorkspaceRepository(database)
  planningRepository = createPlanningRepository(database)
  knowledgeRepository = createKnowledgeRepository(database)
  contextRepository = createContextRepository(database)
  promptRepository = createPromptRepository(database)
  qualityRepository = createQualityRepository(database)
  codexRepository = createCodexRepository(database)
  storyChangeRepository = createStoryChangeRepository(database)
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

function contextStore() {
  openDatabase()
  return contextRepository
}

function promptStore() {
  openDatabase()
  return promptRepository
}

function qualityStore() {
  openDatabase()
  return qualityRepository
}

function codexStore() {
  openDatabase()
  return codexRepository
}

function storyChangeStore() {
  openDatabase()
  return storyChangeRepository
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
      ['local-default', 'local', '本地正文模型', 'http://127.0.0.1:8080/v1', '', '', {}],
      ['deepseek-default', 'deepseek', 'DeepSeek', 'https://api.deepseek.com', 'deepseek-v4-flash', '', defaultModelSettings('deepseek')],
      ['openai-default', 'openai', 'OpenAI', 'https://api.openai.com/v1', '', '', {}],
      ['kimi-default', 'kimi', 'Kimi', 'https://api.moonshot.cn/v1', '', '', {}],
    ]
    const statement = `
      INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `
    const insert = database.prepare(statement)
    for (const [id, provider, name, baseUrl, model, apiKey, settings] of profiles) {
      insert.run(id, provider, name, baseUrl, model, encryptApiKey(apiKey), createdAt, createdAt, JSON.stringify(settings))
    }
  }

  database.prepare(`
    UPDATE model_profiles
    SET base_url = 'https://api.deepseek.com', updated_at = ?
    WHERE id = 'deepseek-default' AND base_url = 'https://api.deepseek.com/v1'
  `).run(timestamp())

  const createdAt = timestamp()
  const insert = database.prepare('INSERT OR IGNORE INTO task_routes (task, model_profile_id, updated_at) VALUES (?, ?, ?)')
  insert.run('chapter', 'local-default', createdAt)
  insert.run('planning_field', 'deepseek-default', createdAt)
  insert.run('chapter_card', 'deepseek-default', createdAt)
  insert.run('scene_plan', 'deepseek-default', createdAt)
  insert.run('rewrite', 'local-default', createdAt)
  insert.run('chapter_state_extract', 'deepseek-default', createdAt)
  insert.run('continuity_audit', 'deepseek-default', createdAt)
  insert.run('quality_review', 'deepseek-default', createdAt)
}

export function loadWorkspace(projectId = '') {
  return workspaceStore().loadWorkspace(projectId)
}

export function loadWorkspaceSnapshot(projectId) {
  return workspaceStore().loadWorkspaceSnapshot(projectId)
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

export function exportProjectBackup(projectId) {
  openDatabase()
  return createProjectBackup(database, projectId)
}

export function restoreProjectBackupData(bundle) {
  openDatabase()
  const restored = restoreProjectBackup(database, bundle)
  return { ...restored, workspace: workspaceStore().loadWorkspace(restored.projectId) }
}

export function importManuscriptData(manuscript) {
  openDatabase()
  const imported = importManuscriptProject(database, manuscript)
  return { ...imported, workspace: workspaceStore().loadWorkspace(imported.projectId) }
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

export function applyPlanningFoundationBundle(input) {
  return planningStore().applyFoundationBundle(input)
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

export function createCharacterRelationship(input) {
  return planningStore().createRelationship(input)
}

export function updateCharacterRelationship(input) {
  return planningStore().updateRelationship(input)
}

export function deleteCharacterRelationship(id) {
  return planningStore().deleteRelationship(id)
}

export function createStoryArc(input) {
  return planningStore().createStoryArc(input)
}

export function updateStoryArc(input) {
  return planningStore().updateStoryArc(input)
}

export function deleteStoryArc(id) {
  return planningStore().deleteStoryArc(id)
}

export function createStoryArcBeat(input) {
  return planningStore().createStoryArcBeat(input)
}

export function updateStoryArcBeat(input) {
  return planningStore().updateStoryArcBeat(input)
}

export function deleteStoryArcBeat(id) {
  return planningStore().deleteStoryArcBeat(id)
}

export function createPlanningCandidate(input) {
  return planningStore().createCandidate(input)
}

export function resolvePlanningCandidate(input) {
  return planningStore().resolveCandidate(input)
}

export function createStoryChangeSet(input) {
  return storyChangeStore().createChangeSet(input)
}

export function getStoryChangeSet(id) {
  return storyChangeStore().getChangeSet(id)
}

export function listStoryChangeSets(input) {
  return storyChangeStore().listChangeSets(input)
}

export function getStoryChangeModelContext(id) {
  return storyChangeStore().modelContext(id)
}

export function attachStoryChangeAnalysis(input) {
  return storyChangeStore().attachAnalysis(input)
}

export function updateStoryChangeSelection(input) {
  return storyChangeStore().updateSelection(input)
}

function refreshStoryChangeDerivedData(projectId) {
  knowledgeStore().syncPlanningSources(projectId)
  contextStore().rebuildChapterMemories(projectId)
  knowledgeStore().refreshContinuityChecks(projectId)
}

export function applyStoryChangeSet(input) {
  const result = storyChangeStore().applyChangeSet(input)
  refreshStoryChangeDerivedData(result.projectId)
  return storyChangeStore().getChangeSet(result.id)
}

export function revertStoryChangeSet(id) {
  const result = storyChangeStore().revertChangeSet(id)
  refreshStoryChangeDerivedData(result.projectId)
  return storyChangeStore().getChangeSet(result.id)
}

export function updateStoryChangeStatus(input) {
  return storyChangeStore().updateStatus(input)
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

export function createKnowledgeCandidate(input) {
  return knowledgeStore().createCandidate(input)
}

export function resolveKnowledgeCandidate(input) {
  return knowledgeStore().resolveCandidate(input)
}

export function updateKnowledgeItemCandidate(input) {
  return knowledgeStore().updateItemCandidate(input)
}

export function resolveKnowledgeItemCandidate(input) {
  return knowledgeStore().resolveItemCandidate(input)
}

export function loadContextManager(projectId) {
  return contextStore().loadContextManager(projectId)
}

export function updateContextProfile(input) {
  return contextStore().updateContextProfile(input)
}

export function rebuildContextMemories(projectId) {
  return contextStore().rebuildChapterMemories(projectId)
}

export function buildGenerationContext(input) {
  return contextStore().buildGenerationContext(input)
}

export function resolvePromptContext(input) {
  return promptStore().resolvePromptContext(input)
}

export function loadPromptCenter(projectId) {
  return promptStore().loadPromptCenter(projectId)
}

export function savePromptTemplate(input) {
  return promptStore().savePromptTemplate(input)
}

export function bindPromptTemplate(input) {
  return promptStore().bindPromptTemplate(input)
}

export function saveStyleProfile(input) {
  return promptStore().saveStyleProfile(input)
}

export function savePromptAddon(input) {
  return promptStore().savePromptAddon(input)
}

export function setPromptAddonBinding(input) {
  return promptStore().setPromptAddonBinding(input)
}

export function startGenerationRecord(input) {
  return promptStore().startGenerationRecord(input)
}

export function finishGenerationRecord(input) {
  return promptStore().finishGenerationRecord(input)
}

export function getGenerationRecord(id) {
  return promptStore().getGenerationRecord(id)
}

export function listGenerationRecords(input) {
  return promptStore().listGenerationRecords(input)
}

export function createQualityReport(input) {
  return qualityStore().createReport(input)
}

export function getQualityReport(id) {
  return qualityStore().getReport(id)
}

export function getQualityReportByGeneration(generationRecordId) {
  return qualityStore().getReportByGeneration(generationRecordId)
}

export function getBlindQualityReviewPacket(id) {
  return qualityStore().getBlindReviewPacket(id)
}

export function addQualityHumanReview(input) {
  return qualityStore().addHumanReview(input)
}

export function listQualityReports(input) {
  return qualityStore().listReports(input)
}

export function createBenchmarkRun(input) {
  return qualityStore().createBenchmarkRun(input)
}

export function updateBenchmarkRun(id, input) {
  return qualityStore().updateBenchmarkRun(id, input)
}

export function startBenchmarkStep(input) {
  return qualityStore().startBenchmarkStep(input)
}

export function finishBenchmarkStep(id, input) {
  return qualityStore().finishBenchmarkStep(id, input)
}

export function getBenchmarkRun(id) {
  return qualityStore().getBenchmarkRun(id)
}

export function listBenchmarkRuns(input) {
  return qualityStore().listBenchmarkRuns(input)
}

export function loadModelSettings() {
  openDatabase()
  const profiles = database.prepare(`
    SELECT id, provider, name, base_url AS baseUrl, model, enabled, settings_json AS settingsJson,
      capabilities_json AS capabilitiesJson, tested_at AS testedAt,
      created_at AS createdAt, updated_at AS updatedAt,
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
    settings: { ...defaultModelSettings(profile.provider), ...parseJson(profile.settingsJson) },
    capabilities: parseJson(profile.capabilitiesJson),
    settingsJson: undefined,
    capabilitiesJson: undefined,
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
  const provider = profile.provider || existing?.provider || 'custom'
  const settings = {
    ...defaultModelSettings(provider),
    ...parseJson(existing?.settings_json),
    ...(profile.settings && typeof profile.settings === 'object' ? profile.settings : {}),
  }
  database.prepare(`
    INSERT INTO model_profiles (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at, settings_json, capabilities_json, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      name = excluded.name,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key_cipher = excluded.api_key_cipher,
      enabled = excluded.enabled,
      settings_json = excluded.settings_json,
      capabilities_json = excluded.capabilities_json,
      tested_at = excluded.tested_at,
      updated_at = excluded.updated_at
  `).run(
    id,
    provider,
    profile.name || '未命名模型',
    profile.baseUrl || '',
    profile.model || '',
    apiKeyCipher,
    profile.enabled === false ? 0 : 1,
    createdAt,
    updatedAt,
    JSON.stringify(settings),
    JSON.stringify(profile.capabilities || parseJson(existing?.capabilities_json)),
    profile.testedAt || existing?.tested_at || '',
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

export function loadCodexSettings() {
  return codexStore().getProviderSettings()
}

export function saveCodexSettings(input) {
  return codexStore().updateProviderSettings(input)
}

export function createAgentRun(input) {
  return codexStore().createRun(input)
}

export function createInlineAgentRun(input) {
  return codexStore().createInlineRun(input)
}

export function appendInlineAgentRevision(input) {
  return codexStore().appendInlineRevision(input)
}

export function listAgentRuns(input) {
  return codexStore().listRuns(input)
}

export function getAgentRun(id, options) {
  return codexStore().getRun(id, options)
}

export function getAgentRunPack(id) {
  return codexStore().getRunPack(id)
}

export function updateAgentRun(id, input) {
  return codexStore().updateRun(id, input)
}

export function updateAgentStep(id, input) {
  return codexStore().updateStep(id, input)
}

export function createAgentCandidate(input) {
  return codexStore().createCandidate(input)
}

export function saveAgentDiscussion(input) {
  return codexStore().saveDiscussion(input)
}

export function resolveAgentCandidate(input) {
  return codexStore().resolveCandidate(input)
}

export function markAgentCandidateStale(id, reason) {
  return codexStore().markCandidateStale(id, reason)
}

export function cancelPendingAgentCandidates(agentRunId) {
  return codexStore().cancelPendingCandidates(agentRunId)
}

export function saveAgentSession(input) {
  return codexStore().upsertSession(input)
}

export function appendAgentEvent(input) {
  return codexStore().appendEvent(input)
}

export function listAgentEvents(agentRunId, options) {
  return codexStore().listEvents(agentRunId, options)
}

export function createApprovalRequest(input) {
  return codexStore().createApproval(input)
}

export function listApprovalRequests(input) {
  return codexStore().listApprovals(input)
}

export function getApprovalRequest(id) {
  return codexStore().getApproval(id)
}

export function resolveApprovalRequest(input) {
  return codexStore().resolveApproval(input)
}

export function completeApprovalRequest(id, input) {
  return codexStore().completeApproval(id, input)
}

export function expirePendingApprovalRequests() {
  return codexStore().expireAllPendingApprovals()
}
