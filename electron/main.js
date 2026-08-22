import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  archiveProject,
  buildGenerationContext,
  createChapter,
  createKnowledgeItem,
  createPlanningCandidate,
  createPlanningEntity,
  createProject,
  createRevision,
  deleteChapter,
  deleteKnowledgeItem,
  deleteModelProfile,
  deletePlanningEntity,
  deleteProject,
  duplicateChapter,
  getDatabaseInfo,
  getModelApiKey,
  listProjects,
  listRevisions,
  loadPlanningCenter,
  loadKnowledgeCenter,
  loadContextManager,
  loadModelSettings,
  loadWorkspace,
  openDatabase,
  reorderChapters,
  reorderKnowledgeItems,
  reorderPlanningEntities,
  rebuildContextMemories,
  restoreProject,
  restoreRevision,
  resolvePlanningCandidate,
  resolveContinuityCheck,
  savePlanningDocument,
  saveModelProfile,
  updateChapter,
  updateKnowledgeItem,
  updateProject,
  updatePlanningEntity,
  updateTaskRoute,
  updateContextProfile,
  refreshContinuityChecks,
  syncKnowledgeSources,
} from './database.js'
import { createModelGateway } from './model-gateway.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let goServiceProcess = null
let goServiceStatus = 'not-started'
let goServiceBaseUrl = ''
let goServiceAuthToken = ''
let mainWindow = null
let closeResponsePending = false

const modelGateway = createModelGateway({
  getGoRuntime: () => ({
    status: goServiceStatus,
    baseUrl: goServiceBaseUrl,
    authToken: goServiceAuthToken,
  }),
  onGoUnavailable: (error) => {
    console.error('[GoService] gateway unavailable, using embedded adapter', error)
    goServiceBaseUrl = ''
    setGoServiceStatus('error')
  },
})

function runtimeInfo() {
  return {
    mode: goServiceStatus === 'ready' ? 'go-service' : 'embedded',
    goServiceStatus,
    database: getDatabaseInfo(),
    editor: 'codemirror-6',
    generation: {
      streaming: true,
      cancellation: true,
      fallback: 'embedded',
    },
  }
}

function publishRuntimeInfo() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('runtime:changed', runtimeInfo())
  }
}

function setGoServiceStatus(status) {
  goServiceStatus = status
  publishRuntimeInfo()
}

function serviceBinaryCandidates() {
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const arch = process.arch
  const fileName = process.platform === 'win32' ? 'novel-studio-service.exe' : 'novel-studio-service'
  return [
    process.env.NOVEL_STUDIO_GO_SERVICE,
    path.join(process.resourcesPath, 'novel-studio-service', `${platform}-${arch}`, fileName),
    path.join(__dirname, '..', 'resources', 'novel-studio-service', `${platform}-${arch}`, fileName),
  ].filter(Boolean)
}

function startGoService() {
  const candidate = serviceBinaryCandidates().find((filePath) => fs.existsSync(filePath))
  if (!candidate) {
    setGoServiceStatus('embedded-fallback')
    return
  }

  try {
    const dataDirectory = path.join(app.getPath('userData'), 'service-data')
    fs.mkdirSync(dataDirectory, { recursive: true })
    goServiceAuthToken = randomBytes(32).toString('base64url')
    goServiceProcess = spawn(candidate, ['--port', '0', '--data-dir', dataDirectory], {
      cwd: path.dirname(candidate),
      env: { ...process.env, NOVEL_STUDIO_SERVICE_TOKEN: goServiceAuthToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    setGoServiceStatus('starting')
    let stdoutBuffer = ''
    goServiceProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const message = line.trim()
        if (message) console.log(`[GoService] ${message}`)
        const ready = message.match(/novel-studio-service ready port=(\d+)/)
        if (ready) {
          goServiceBaseUrl = `http://127.0.0.1:${ready[1]}`
          setGoServiceStatus('ready')
        }
      }
    })
    goServiceProcess.stderr.on('data', (chunk) => console.error(`[GoService] ${String(chunk).trim()}`))
    goServiceProcess.on('error', (error) => {
      goServiceBaseUrl = ''
      setGoServiceStatus('error')
      console.error('[GoService] failed to start', error)
    })
    goServiceProcess.on('exit', () => {
      goServiceProcess = null
      goServiceBaseUrl = ''
      if (goServiceStatus !== 'stopping') setGoServiceStatus('stopped')
    })
  } catch (error) {
    goServiceBaseUrl = ''
    setGoServiceStatus('error')
    console.error('[GoService] spawn error', error)
  }
}

function stopGoService() {
  void modelGateway.cancelAll()
  if (!goServiceProcess) return
  setGoServiceStatus('stopping')
  goServiceProcess.kill()
  goServiceProcess = null
  goServiceBaseUrl = ''
}

function registerIpc() {
  ipcMain.handle('workspace:load', (_event, projectId) => loadWorkspace(projectId))
  ipcMain.handle('projects:list', listProjects)
  ipcMain.handle('project:create', (_event, input) => createProject(input))
  ipcMain.handle('project:update', (_event, patch) => updateProject(patch))
  ipcMain.handle('project:archive', (_event, projectId) => archiveProject(projectId))
  ipcMain.handle('project:restore', (_event, projectId) => restoreProject(projectId))
  ipcMain.handle('project:delete', (_event, projectId) => deleteProject(projectId))
  ipcMain.handle('chapter:create', (_event, input) => createChapter(input))
  ipcMain.handle('chapter:update', (_event, patch) => updateChapter(patch))
  ipcMain.handle('chapters:reorder', (_event, input) => reorderChapters(input))
  ipcMain.handle('chapter:duplicate', (_event, chapterId) => duplicateChapter(chapterId))
  ipcMain.handle('chapter:delete', (_event, chapterId) => deleteChapter(chapterId))
  ipcMain.handle('revision:create', (_event, payload) => createRevision(payload))
  ipcMain.handle('revisions:list', (_event, chapterId) => listRevisions(chapterId))
  ipcMain.handle('revision:restore', (_event, payload) => restoreRevision(payload))
  ipcMain.handle('planning:load', (_event, projectId) => loadPlanningCenter(projectId))
  ipcMain.handle('planning:document-save', (_event, payload) => savePlanningDocument(payload))
  ipcMain.handle('planning:entity-create', (_event, payload) => createPlanningEntity(payload))
  ipcMain.handle('planning:entity-update', (_event, payload) => updatePlanningEntity(payload))
  ipcMain.handle('planning:entities-reorder', (_event, payload) => reorderPlanningEntities(payload))
  ipcMain.handle('planning:entity-delete', (_event, entityId) => deletePlanningEntity(entityId))
  ipcMain.handle('planning:candidate-create', (_event, payload) => createPlanningCandidate(payload))
  ipcMain.handle('planning:candidate-resolve', (_event, payload) => resolvePlanningCandidate(payload))
  ipcMain.handle('knowledge:load', (_event, projectId) => loadKnowledgeCenter(projectId))
  ipcMain.handle('knowledge:sync', (_event, projectId) => syncKnowledgeSources(projectId))
  ipcMain.handle('knowledge:checks-refresh', (_event, projectId) => refreshContinuityChecks(projectId))
  ipcMain.handle('knowledge:item-create', (_event, payload) => createKnowledgeItem(payload))
  ipcMain.handle('knowledge:item-update', (_event, payload) => updateKnowledgeItem(payload))
  ipcMain.handle('knowledge:items-reorder', (_event, payload) => reorderKnowledgeItems(payload))
  ipcMain.handle('knowledge:item-delete', (_event, itemId) => deleteKnowledgeItem(itemId))
  ipcMain.handle('knowledge:check-resolve', (_event, payload) => resolveContinuityCheck(payload))
  ipcMain.handle('context:load', (_event, projectId) => loadContextManager(projectId))
  ipcMain.handle('context:update', (_event, payload) => updateContextProfile(payload))
  ipcMain.handle('context:rebuild', (_event, projectId) => rebuildContextMemories(projectId))
  ipcMain.handle('models:load', () => loadModelSettings())
  ipcMain.handle('models:save', (_event, profile) => saveModelProfile(profile))
  ipcMain.handle('models:delete', (_event, id) => deleteModelProfile(id))
  ipcMain.handle('models:route', (_event, payload) => updateTaskRoute(payload.task, payload.modelProfileId))
  ipcMain.handle('models:test', async (_event, payload = {}) => {
    const profile = { ...payload, settings: payload.settings || {} }
    const apiKey = String(payload.apiKey || '') || (profile.id ? getModelApiKey(profile.id) : '')
    const startedAt = Date.now()
    const result = await modelGateway.generate(
      { task: 'connection_test', modelProfile: profile, apiKey },
      { taskId: `connection-test-${randomBytes(8).toString('hex')}` },
    )
    return {
      ok: result.execution === 'remote',
      latencyMs: Date.now() - startedAt,
      gateway: result.gateway,
      model: result.model,
      response: result.text,
    }
  })
  ipcMain.handle('generation:start', async (event, payload) => {
    const taskId = String(payload?.taskId || '')
    if (!taskId) throw new Error('生成任务缺少 taskId')
    const workspace = loadWorkspace(payload?.projectId)
    const chapter = workspace.chapters.find((item) => item.id === payload?.chapterId) || workspace.chapters[0]
    const planningCenter = workspace.project ? loadPlanningCenter(workspace.project.id) : null
    const knowledgeCenter = workspace.project ? loadKnowledgeCenter(workspace.project.id) : null
    const longContext = workspace.project ? buildGenerationContext({
      projectId: workspace.project.id,
      chapterId: chapter?.id,
      instruction: payload?.instruction,
      task: payload?.task,
    }) : null
    const modelSettings = loadModelSettings()
    const modelProfileId = payload?.modelProfileId || modelSettings.routes[payload?.task] || 'local-default'
    const modelProfile = modelSettings.profiles.find((profile) => profile.id === modelProfileId)
    const apiKey = getModelApiKey(modelProfileId)
    try {
      return await modelGateway.generate(
        { ...payload, project: workspace.project, chapter, planningCenter, knowledgeCenter, longContext, modelProfile, apiKey },
        {
          taskId,
          onEvent: (generationEvent) => {
            if (!event.sender.isDestroyed()) event.sender.send('generation:event', generationEvent)
          },
        },
      )
    } catch (error) {
      if (error?.name === 'GenerationCancelledError') return { cancelled: true, taskId }
      throw error
    }
  })
  ipcMain.handle('generation:cancel', (_event, taskId) => modelGateway.cancel(String(taskId || '')))
  ipcMain.handle('runtime:info', runtimeInfo)
  ipcMain.on('window:close-response', (event, payload = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (!payload.saved && !payload.discard) return
    closeResponsePending = true
    mainWindow.close()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#1d2024',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  window.on('close', (event) => {
    if (closeResponsePending || window.webContents.isLoading()) return
    event.preventDefault()
    window.webContents.send('window:close-requested')
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
      closeResponsePending = false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })
  if (devUrl) {
    window.loadURL(devUrl)
    if (process.env.NOVEL_STUDIO_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  openDatabase()
  registerIpc()
  startGoService()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopGoService()
    app.quit()
  }
})

app.on('before-quit', stopGoService)
