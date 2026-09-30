import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { CREATIVE_BUILD_ID } from '../electron/build-info.js'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'

const require = createRequire(import.meta.url)
const { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'novel-library-smoke-')))
const bootstrap = path.join(directory, 'source'), target = path.join(directory, 'migrated')
await fs.mkdir(bootstrap); await fs.mkdir(target)
const env = { ...process.env, NOVEL_STUDIO_TEST_USER_DATA: bootstrap, NOVEL_STUDIO_NO_GO: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
const errors = [], measurements = []
let app, page
async function launch(expectedDirectory = bootstrap) {
  app = await _electron.launch({ executablePath: process.env.NOVEL_STUDIO_TEST_APP || require('electron'),
    args: process.env.NOVEL_STUDIO_TEST_APP ? [] : ['.'], cwd: root, env, timeout: 60000 })
  // Migration briefly opens a progress window before the real editor.
  for (let attempt=0;attempt<200;attempt++) {
    page = app.windows().find(window => /index\.html/.test(window.url()))
    if (page) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(page, 'editor appears after migration')
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(20000)
  await page.waitForFunction(() => Boolean(window.novelStudio))
  const runtime = await page.evaluate(() => window.novelStudio.getRuntimeInfo())
  assertIsolatedRuntime(runtime, expectedDirectory)
  assert.equal(runtime.buildId, CREATIVE_BUILD_ID)
  await page.locator('.cm-content').waitFor()
  return runtime
}
async function switchBook(title) {
  const start = performance.now()
  await page.locator('.project-switch-trigger').click()
  await page.locator('.project-select').filter({ hasText: title }).click()
  await page.locator('.project-switch-trigger').filter({ hasText: title }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.editor-panel')?.inert)
  measurements.push({ operation: `切书：${title}`, milliseconds: Math.round(performance.now()-start) })
}
try {
  const initial = await launch()
  const a = await page.evaluate(() => window.novelStudio.createProject({ title: '模拟 500 章 A' }))
  const b = await page.evaluate(() => window.novelStudio.createProject({ title: '模拟 B' }))
  await page.evaluate(async ({ a, b }) => {
    await window.novelStudio.updateChapter({ id: a.chapters[0].id, manuscript: 'A 第一章正文。' })
    await window.novelStudio.updateChapter({ id: b.chapters[0].id, manuscript: 'B 的独立正文。' })
  }, { a, b })
  await app.evaluate(({ }, input) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path')
    const actual = fs.realpathSync(input.databasePath), allowed = fs.realpathSync(input.directory)
    assertFixturePath(actual, allowed, path.sep)
    function assertFixturePath(file, root, separator) { if (!file.startsWith(root+separator)) throw new Error('test database is not isolated') }
    const db = new DatabaseSync(actual)
    db.exec('PRAGMA foreign_keys=ON; BEGIN')
    const insert = db.prepare(`INSERT INTO chapters (id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at)
      VALUES(?,?,?,?,'draft','{}','',?,'now')`)
    for (let i=2;i<=500;i++) insert.run(`fixture-chapter-${i}`, input.projectId, i, `模拟章节 ${i}`, `A 第${i}章独立正文。`+'正文。'.repeat(1000))
    db.exec('COMMIT'); db.close()
  }, { databasePath: initial.database.path, directory, projectId: a.project.id })
  await page.reload(); await page.locator('.cm-content').filter({ hasText: 'B 的独立正文' }).waitFor()
  const catalog = await page.evaluate(projectId => window.novelStudio.loadWorkspaceCatalog({ projectId, select: false }), a.project.id)
  assert.equal(catalog.chapters.length, 500)
  assert.equal(catalog.chapters.filter(chapter => Object.hasOwn(chapter, 'manuscript')).length, 1)
  await switchBook(a.project.title)
  assert.equal(await page.locator('.chapter-row').count(), 25)
  // An out-of-order detail reply must never replace the latest chapter choice.
  await app.evaluate(({ ipcMain }, databasePath) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    ipcMain.removeHandler('workspace:chapter')
    ipcMain.handle('workspace:chapter', async (_event, input) => {
      const number = Number(input.chapterId.split('-').at(-1))
      await new Promise(resolve => setTimeout(resolve, number === 7 ? 350 : 20))
      const db = new DatabaseSync(databasePath, { readOnly: true })
      try {
        const row = db.prepare('SELECT * FROM chapters WHERE id=? AND project_id=?').get(input.chapterId, input.projectId)
        if (!row) throw new Error('fixture chapter not owned')
        return { ...row, detailLoaded: true, card: JSON.parse(row.card_json), scenePlan: { scenes: [] } }
      } finally { db.close() }
    })
    // Directory diagnostics here are a mock; no real Codex prompt or model call.
    ipcMain.removeHandler('codex:models')
    ipcMain.handle('codex:models', () => ({ message: '隔离测试：未调用真实模型', status: { configOptions: [], refreshedAt: new Date().toISOString() } }))
  }, initial.database.path)
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('.chapter-item')
    buttons[6].click(); buttons[7].click(); buttons[8].click()
  })
  await page.locator('.chapter-title-input').filter({ visible: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.chapter-title-input')?.value === '模拟章节 9')
  await page.locator('.cm-content').filter({ hasText: 'A 第9章独立正文' }).waitFor()
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(await page.locator('.chapter-title-input').inputValue(), '模拟章节 9')
  await page.locator('.cm-content').click()
  await page.keyboard.press('End'); await page.keyboard.insertText('【人工编辑保存标记】')
  await page.locator('.chapter-item').filter({ hasText: '模拟章节 10' }).click()
  await page.locator('.cm-content').filter({ hasText: 'A 第10章独立正文' }).waitFor()
  const saved = await page.evaluate(projectId => window.novelStudio.getWorkspaceChapter({ projectId, chapterId: 'fixture-chapter-9' }), a.project.id)
  assert.ok(saved.manuscript.includes('【人工编辑保存标记】'))
  await page.getByRole('tab', { name: '章节卡', exact: true }).click()
  await page.locator('.formal-card-edit > summary').click()
  await page.locator('.formal-card-edit').getByText('本章变化', { exact: true }).locator('..').locator('textarea').fill('模拟章节卡保存验证')
  await page.getByRole('button', { name: '保存章节卡', exact: true }).click()
  await page.locator('.toast').filter({ hasText: '章节卡已保存' }).waitFor()
  const savedCard = await page.evaluate(projectId => window.novelStudio.getWorkspaceChapter({ projectId, chapterId: 'fixture-chapter-10' }), a.project.id)
  assert.equal(savedCard.card.goal, '模拟章节卡保存验证')
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: '模型与项目设置', exact: true }).click()
  await page.getByRole('region', { name: '书库与存储', exact: true }).waitFor()
  assert.ok((await page.locator('.storage-settings').innerText()).includes(bootstrap))
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }) }, target)
  await page.getByRole('button', { name: '更换数据目录…', exact: true }).click()
  await page.getByRole('button', { name: '保存退出并迁移', exact: true }).waitFor()
  await page.getByRole('button', { name: '取消迁移计划', exact: true }).click()
  await page.getByRole('button', { name: '更换数据目录…', exact: true }).click()
  await page.getByRole('button', { name: '保存退出并迁移', exact: true }).waitFor()
  await page.locator('.storage-settings').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(directory, 'storage-settings.png') })
  const before = await page.evaluate(() => window.novelStudio.getStorageStatus())
  assert.equal(before.pending.targetDirectory, target)
  // Exercise the actual save/quit button, but intercept desktop relaunch so
  // the next instance stays under Playwright with the same isolated path.
  await app.evaluate(({ app }, fixtureDirectory) => {
    const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path')
    const actual = fs.realpathSync(app.getPath('userData'))
    if (!actual.startsWith(fs.realpathSync(fixtureDirectory)+path.sep)) throw new Error('restart fixture is not isolated')
    app.relaunch = () => { fs.writeFileSync(path.join(fixtureDirectory, 'relaunch-requested.json'), JSON.stringify({ userData: actual })) }
  }, directory)
  const quitting = new Promise(resolve => app.process().once('exit', resolve))
  await page.getByRole('button', { name: '保存退出并迁移', exact: true }).click()
  let quitTimeout
  try { await Promise.race([quitting, new Promise((_resolve, reject) => { quitTimeout = setTimeout(() => reject(new Error('normal save/quit timed out')), 15000) })]) }
  finally { clearTimeout(quitTimeout) }
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'relaunch-requested.json'), 'utf8')).userData, bootstrap)
  await app.close(); app = null
  const after = await launch(target)
  assert.equal(after.database.path, path.join(target, 'novel-studio.sqlite'))
  assert.equal(after.creativeInterface.serverFile, initial.creativeInterface.serverFile)
  await switchBook(b.project.title)
  await page.locator('.cm-content').filter({ hasText: 'B 的独立正文' }).waitFor()
  const migrated = await page.evaluate(projectId => window.novelStudio.getWorkspaceChapter({ projectId, chapterId: 'fixture-chapter-9' }), a.project.id)
  assert.ok(migrated.manuscript.includes('【人工编辑保存标记】'))
  const migratedCard = await page.evaluate(projectId => window.novelStudio.getWorkspaceChapter({ projectId, chapterId: 'fixture-chapter-10' }), a.project.id)
  assert.equal(migratedCard.card.goal, '模拟章节卡保存验证')
  const status = await page.evaluate(() => window.novelStudio.getStorageStatus())
  assert.equal(status.previousDirectory, bootstrap)
  assert.equal(status.pending, undefined)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'engineering-only-pass', buildId: CREATIVE_BUILD_ID, measurements,
    chapterCount: 500, verification: status.verification, isolatedDirectory: directory, noRemoteModels: true }, null, 2))
} catch (error) {
  console.error('Smoke artifacts:', directory)
  throw error
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
}
