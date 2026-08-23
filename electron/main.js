import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  archiveProject,
  buildGenerationContext,
  bindPromptTemplate,
  createChapter,
  createKnowledgeItem,
  createKnowledgeCandidate,
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
  finishGenerationRecord,
  getDatabaseInfo,
  getModelApiKey,
  listProjects,
  listRevisions,
  loadPromptCenter,
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
  resolvePromptContext,
  restoreProject,
  restoreRevision,
  resolvePlanningCandidate,
  resolveContinuityCheck,
  resolveKnowledgeCandidate,
  resolveKnowledgeItemCandidate,
  savePlanningDocument,
  savePromptAddon,
  savePromptTemplate,
  saveStyleProfile,
  saveModelProfile,
  startGenerationRecord,
  updateChapter,
  updateKnowledgeItem,
  updateKnowledgeItemCandidate,
  updateProject,
  updatePlanningEntity,
  updateTaskRoute,
  updateContextProfile,
  refreshContinuityChecks,
  syncKnowledgeSources,
  setPromptAddonBinding,
} from './database.js'
import { createModelGateway } from './model-gateway.js'
import { compilePrompt } from './prompt-compiler.js'

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

function generationOutput(result = {}) {
  if (typeof result.manuscript === 'string') return result.manuscript
  if (typeof result.scenePlan === 'string') return result.scenePlan
  if (typeof result.text === 'string') return result.text
  if (result.card && typeof result.card === 'object') return JSON.stringify(result.card)
  if (result.stateSnapshot && typeof result.stateSnapshot === 'object') return JSON.stringify(result.stateSnapshot)
  if (result.audit && typeof result.audit === 'object') return JSON.stringify(result.audit)
  return ''
}

function compilePromptPreview(payload = {}) {
  const workspace = loadWorkspace(payload.projectId)
  const chapter = workspace.chapters.find((item) => item.id === payload.chapterId) || workspace.chapters[0]
  const planningCenter = loadPlanningCenter(workspace.project.id)
  const knowledgeCenter = loadKnowledgeCenter(workspace.project.id)
  const promptContext = resolvePromptContext({
    projectId: workspace.project.id,
    chapterId: payload.chapterId || chapter?.id || '',
    volumeId: payload.volumeId || '',
    task: payload.task || 'chapter',
  })
  const longContext = buildGenerationContext({
    projectId: workspace.project.id,
    chapterId: chapter?.id,
    instruction: payload.instruction,
    styleText: promptContext.style?.mergedText,
    task: payload.task || 'chapter',
  })
  return compilePrompt({
    ...payload,
    project: workspace.project,
    chapter,
    planningCenter,
    knowledgeCenter,
    promptContext,
    longContext,
  })
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
  ipcMain.handle('knowledge:candidate-create', (_event, payload) => createKnowledgeCandidate(payload))
  ipcMain.handle('knowledge:candidate-resolve', (_event, payload) => resolveKnowledgeCandidate(payload))
  ipcMain.handle('knowledge:item-candidate-update', (_event, payload) => updateKnowledgeItemCandidate(payload))
  ipcMain.handle('knowledge:item-candidate-resolve', (_event, payload) => resolveKnowledgeItemCandidate(payload))
  ipcMain.handle('context:load', (_event, projectId) => loadContextManager(projectId))
  ipcMain.handle('context:update', (_event, payload) => updateContextProfile(payload))
  ipcMain.handle('context:rebuild', (_event, projectId) => rebuildContextMemories(projectId))
  ipcMain.handle('prompts:load', (_event, projectId) => loadPromptCenter(projectId))
  ipcMain.handle('prompts:template-save', (_event, payload) => savePromptTemplate(payload))
  ipcMain.handle('prompts:template-bind', (_event, payload) => bindPromptTemplate(payload))
  ipcMain.handle('prompts:style-save', (_event, payload) => saveStyleProfile(payload))
  ipcMain.handle('prompts:addon-save', (_event, payload) => savePromptAddon(payload))
  ipcMain.handle('prompts:addon-bind', (_event, payload) => setPromptAddonBinding(payload))
  ipcMain.handle('prompts:preview', (_event, payload) => compilePromptPreview(payload))
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
    const chapterScopedTasks = new Set(['chapter', 'chapter_card', 'scene_plan', 'rewrite', 'chapter_state_extract', 'continuity_audit'])
    const promptChapterId = payload?.chapterId || (chapterScopedTasks.has(payload?.task) ? chapter?.id : '')
    const promptVolumeId = payload?.planning?.scopeType === 'volume' ? payload.planning.scopeId : ''
    const promptContext = workspace.project ? resolvePromptContext({
      projectId: workspace.project.id,
      chapterId: promptChapterId,
      volumeId: promptVolumeId,
      task: payload?.task,
    }) : null
    const longContext = workspace.project ? buildGenerationContext({
      projectId: workspace.project.id,
      chapterId: chapter?.id,
      instruction: payload?.instruction,
      styleText: promptContext?.style?.mergedText,
      task: payload?.task,
    }) : null
    const modelSettings = loadModelSettings()
    const modelProfileId = payload?.modelProfileId || modelSettings.routes[payload?.task] || 'local-default'
    const modelProfile = modelSettings.profiles.find((profile) => profile.id === modelProfileId)
    const apiKey = getModelApiKey(modelProfileId)
    const generationInput = {
      ...payload,
      project: workspace.project,
      chapter,
      planningCenter,
      knowledgeCenter,
      longContext,
      promptContext,
      modelProfile,
      apiKey,
    }
    const compiledPrompt = compilePrompt(generationInput)
    const generationRecord = startGenerationRecord({
      taskId,
      projectId: workspace.project.id,
      chapterId: promptChapterId,
      task: payload?.task,
      modelProfileId: modelProfile?.id,
      model: modelProfile ? { id: modelProfile.id, provider: modelProfile.provider, name: modelProfile.name, model: modelProfile.model } : {},
      promptSnapshot: compiledPrompt.snapshot,
    })
    let generationParameters = {}
    try {
      const result = await modelGateway.generate(
        { ...generationInput, compiledPrompt },
        {
          taskId,
          onEvent: (generationEvent) => {
            if (!event.sender.isDestroyed()) event.sender.send('generation:event', generationEvent)
          },
          onPrepared: (prepared) => { generationParameters = prepared.parameters },
        },
      )
      finishGenerationRecord({
        id: generationRecord.id,
        status: 'completed',
        parameters: generationParameters,
        output: generationOutput(result),
      })
      return result
    } catch (error) {
      if (error?.name === 'GenerationCancelledError') {
        finishGenerationRecord({ id: generationRecord.id, status: 'cancelled' })
        return { cancelled: true, taskId }
      }
      finishGenerationRecord({ id: generationRecord.id, status: 'failed', error: error?.message || String(error) })
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
