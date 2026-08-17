import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRevision, loadWorkspace, openDatabase, updateChapter, updateProject } from './database.js'
import { generateMock } from './mock-provider.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let goServiceProcess = null
let goServiceStatus = 'not-started'

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
  ipcMain.handle('generation:mock', (_event, payload) => {
    const workspace = loadWorkspace()
    const chapter = workspace.chapters.find((item) => item.id === payload?.chapterId) || workspace.chapters[0]
    return generateMock({ ...payload, project: workspace.project, chapter })
  })
  ipcMain.handle('runtime:info', () => ({
    mode: goServiceStatus === 'ready' || goServiceStatus === 'starting' ? 'go-service' : 'embedded',
    goServiceStatus,
    database: 'sqlite',
    editor: 'codemirror-6',
  }))
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
