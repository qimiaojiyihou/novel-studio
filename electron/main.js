import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createRevision,
  deleteModelProfile,
  getDatabaseInfo,
  getModelApiKey,
  loadModelSettings,
  loadWorkspace,
  openDatabase,
  saveModelProfile,
  updateChapter,
  updateProject,
  updateTaskRoute,
} from './database.js'
import { generateModelTask } from './model-adapter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let goServiceProcess = null
let goServiceStatus = 'not-started'
let mainWindow = null
let closeResponsePending = false

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
    goServiceStatus = 'embedded-fallback'
    return
  }

  try {
    const dataDirectory = path.join(app.getPath('userData'), 'service-data')
    fs.mkdirSync(dataDirectory, { recursive: true })
    goServiceProcess = spawn(candidate, ['--port', '0', '--data-dir', dataDirectory], {
      cwd: path.dirname(candidate),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    goServiceStatus = 'starting'
    goServiceProcess.stdout.on('data', (chunk) => {
      const message = String(chunk).trim()
      if (message) console.log(`[GoService] ${message}`)
      if (message.includes('ready')) goServiceStatus = 'ready'
    })
    goServiceProcess.stderr.on('data', (chunk) => console.error(`[GoService] ${String(chunk).trim()}`))
    goServiceProcess.on('error', (error) => {
      goServiceStatus = 'error'
      console.error('[GoService] failed to start', error)
    })
    goServiceProcess.on('exit', () => {
      goServiceProcess = null
      if (goServiceStatus !== 'stopping') goServiceStatus = 'stopped'
    })
  } catch (error) {
    goServiceStatus = 'error'
    console.error('[GoService] spawn error', error)
  }
}

function stopGoService() {
  if (!goServiceProcess) return
  goServiceStatus = 'stopping'
  goServiceProcess.kill()
  goServiceProcess = null
}

function registerIpc() {
  ipcMain.handle('workspace:load', () => loadWorkspace())
  ipcMain.handle('project:update', (_event, patch) => updateProject(patch))
  ipcMain.handle('chapter:update', (_event, patch) => updateChapter(patch))
  ipcMain.handle('revision:create', (_event, payload) => createRevision(payload))
  ipcMain.handle('models:load', () => loadModelSettings())
  ipcMain.handle('models:save', (_event, profile) => saveModelProfile(profile))
  ipcMain.handle('models:delete', (_event, id) => deleteModelProfile(id))
  ipcMain.handle('models:route', (_event, payload) => updateTaskRoute(payload.task, payload.modelProfileId))
  ipcMain.handle('generation:mock', async (_event, payload) => {
    const workspace = loadWorkspace()
    const chapter = workspace.chapters.find((item) => item.id === payload?.chapterId) || workspace.chapters[0]
    const modelSettings = loadModelSettings()
    const modelProfileId = payload?.modelProfileId || modelSettings.routes[payload?.task] || 'local-default'
    const modelProfile = modelSettings.profiles.find((profile) => profile.id === modelProfileId)
    const apiKey = getModelApiKey(modelProfileId)
    return generateModelTask({ ...payload, project: workspace.project, chapter, modelProfile, apiKey })
  })
  ipcMain.handle('runtime:info', () => ({
    mode: goServiceStatus === 'ready' || goServiceStatus === 'starting' ? 'go-service' : 'embedded',
    goServiceStatus,
    database: getDatabaseInfo(),
    editor: 'codemirror-6',
  }))
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
  stopGoService()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopGoService)
