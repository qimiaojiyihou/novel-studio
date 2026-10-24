import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const serviceRoot = process.env.READER_THEME_SERVICE_ROOT || new URL('../reader-service/', import.meta.url).pathname
const { startReaderServer } = await import(path.join(serviceRoot, 'server.js'))
const { digest } = await import(path.join(serviceRoot, 'store.js'))
const { chromium } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'reader-theme-smoke-')))
const databasePath = path.join(directory, 'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(databasePath)), directory, 'actual database parent verified before fixture writes')
const service = await startReaderServer({ databasePath, adminToken:randomBytes(32).toString('hex'), origin:'http://127.0.0.1:0', allowHttp:true })
let browser
try {
  const content = Array.from({ length:50 }, () => '雨停了，窗边的书页还没有合上。他把杯子放稳，等对面的人说完。').join('\n\n')
  const publication = { publicationId:'theme-fixture', bookId:'theme-book', baseRevision:'', title:'纯白阅读测试', description:'独立临时数据库中的模拟书籍。', genre:'模拟', chapters:[{ id:'chapter-1', no:1, title:'雨后的书页', hash:digest(content) }] }
  service.store.stage(publication); service.store.upload(publication.publicationId, 'chapter-1', content); service.store.commit(publication.publicationId)
  service.store.setAccess(false)
  browser = await chromium.launch({ headless:true, executablePath:process.env.NOVEL_STUDIO_BROWSER || undefined })
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(service.origin)
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'light', 'existing default preserved')
  await page.getByRole('button', { name:'开始阅读', exact:true }).click()
  await page.locator('#progress').filter({ hasText:' / ' }).waitFor()
  await page.locator('#viewport').press('Escape')
  assert.deepEqual(await page.locator('#theme option').allTextContents(), ['浅色', '纯白', '护眼', '夜间'])
  for (const [theme, color] of [['paper','rgb(233, 238, 225)'], ['dark','rgb(25, 35, 38)'], ['white','rgb(255, 255, 255)'], ['light','rgb(247, 250, 249)']]) {
    await page.locator('#theme').selectOption(theme)
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), color)
  }
  await page.locator('#theme').selectOption('dark'); await page.locator('#theme').selectOption('white')
  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body)
    return { background:body.backgroundColor, ink:body.color, scheme:body.colorScheme, panel:getComputedStyle(document.getElementById('reading-menu')).backgroundColor, select:getComputedStyle(document.getElementById('theme')).backgroundColor }
  })
  assert.deepEqual(colors, { background:'rgb(255, 255, 255)', ink:'rgb(36, 36, 36)', scheme:'light', panel:'rgb(255, 255, 255)', select:'rgb(255, 255, 255)' })
  await page.setViewportSize({ width:320, height:740 })
  await page.waitForTimeout(250) // Let the reader's resize pagination debounce settle before comparing progress.
  assert.equal(await page.locator('#reading-menu').evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await page.screenshot({ path:path.join(directory, 'white-settings-320.png') })
  await page.getByRole('button', { name:'继续阅读', exact:true }).click()
  const before = await page.locator('#progress').innerText()
  await page.reload(); await page.getByRole('button', { name:'继续阅读', exact:true }).click()
  await page.locator('#progress').filter({ hasText:' / ' }).waitFor()
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'white', 'pure white survives reload')
  assert.equal(await page.locator('#progress').innerText(), before, 'theme persistence preserves reading progress')
  await page.screenshot({ path:path.join(directory, 'white-reading-320.png') })
  await page.locator('#viewport').press('Escape')
  assert.equal(await page.locator('#theme').inputValue(), 'white')
  await page.locator('#settings-reset').click()
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'light', 'reset keeps original default')
  assert.deepEqual(errors, [])
  if (process.env.READER_THEME_QA_OUTPUT) {
    for (const file of ['white-settings-320.png', 'white-reading-320.png']) await fs.copyFile(path.join(directory,file),path.join(process.env.READER_THEME_QA_OUTPUT,file))
  }
  console.log(JSON.stringify({ ok:true, themes:4, pureWhite:true, persisted:true, reset:'light', databasePath, directory }))
} finally { await browser?.close(); await service.close() }
