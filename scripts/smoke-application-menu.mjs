import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'
import { CREATIVE_BUILD_ID } from '../electron/build-info.js'

const require = createRequire(import.meta.url)
const { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-menu-smoke-'))
const env = { ...process.env, NOVEL_STUDIO_TEST_USER_DATA: directory, NOVEL_STUDIO_NO_GO: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
let app
try {
  app = await _electron.launch({
    executablePath: process.env.NOVEL_STUDIO_TEST_APP || require('electron'),
    args: process.env.NOVEL_STUDIO_TEST_APP ? [] : ['.'], cwd: root, env,
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.novelStudio))
  const runtime = await page.evaluate(() => window.novelStudio.getRuntimeInfo())
  assertIsolatedRuntime(runtime, directory)
  const menus = await app.evaluate(({ Menu }) => {
    const serialize = menu => menu.items.map(item => ({
      label: item.label, role: item.role, type: item.type,
      ...(item.submenu ? { submenu: serialize(item.submenu) } : {}),
    }))
    return serialize(Menu.getApplicationMenu())
  })
  assert.deepEqual(menus.map(item => item.label), process.platform === 'darwin'
    ? ['Novel Studio', '文件', '编辑', '视图', '窗口'] : ['文件', '编辑', '视图', '窗口'])
  const flat = items => items.flatMap(item => [item, ...flat(item.submenu || [])])
  for (const item of flat(menus)) {
    if (item.role && item.role !== 'appmenu') assert.match(item.label, /[\u3400-\u9fff]/)
  }
  assert.equal(runtime.buildId, CREATIVE_BUILD_ID)
  // Exercise native role dispatch on this isolated window without changing a book
  // or the user's clipboard. The application's existing role accelerator remains.
  await page.bringToFront()
  const before = await app.evaluate(({ Menu, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.focus()
    const items = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || [])
    const before = window.webContents.getZoomLevel()
    const enlarge = items.find(item => item.role === 'zoomin')
    enlarge.click({}, window, window.webContents)
    return before
  })
  const readZoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())
  let enlarged = await readZoom()
  for (let attempt = 0; attempt < 50 && enlarged <= before; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20))
    enlarged = await readZoom()
  }
  assert.ok(enlarged > before, `native zoom action still works (${before} -> ${enlarged})`)
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.role === 'resetzoom')
    const window = BrowserWindow.getAllWindows()[0]
    item.click({}, window, window.webContents)
  })
  let reset = await readZoom()
  for (let attempt = 0; attempt < 50 && reset !== 0; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20))
    reset = await readZoom()
  }
  assert.equal(reset, 0)
  const zoom = { before, enlarged, reset }
  fs.writeFileSync(path.join(directory, 'menus.json'), JSON.stringify(menus, null, 2))
  console.log(JSON.stringify({ status: 'pass', buildId: runtime.buildId, directory, menus: menus.map(item => item.label), zoom, modelCalls: 0 }))
} finally {
  if (app) {
    const timer = setTimeout(() => app.process().kill('SIGKILL'), 5000)
    try { await app.close() } finally { clearTimeout(timer) }
  }
}
