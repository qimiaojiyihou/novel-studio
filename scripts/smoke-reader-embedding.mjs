import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { startReaderServer } from '../reader-service/server.js'
import { digest } from '../reader-service/store.js'

const { chromium } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'novel-reader-embedding-')))
const file = path.join(directory, 'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(file)), directory, 'verify isolated database before writes')
// TLS is local to this disposable fixture. No production certificate changes.
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio:'ignore' })
let service, browser
const proxy = httpsServer({ key:await fs.readFile(path.join(directory, 'key.pem')), cert:await fs.readFile(path.join(directory, 'cert.pem')) }, async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const response = await fetch(`http://127.0.0.1:${service.port}${req.url}`, { method:req.method, headers:req.headers, body:chunks.length ? Buffer.concat(chunks) : undefined })
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
  } catch { res.writeHead(502); res.end('fixture proxy error') }
})
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
await listen(proxy)
const origin = `https://127.0.0.1:${proxy.address().port}`
const parent = httpServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><title>跨站登录隔离测试</title><h1>隔离模拟书架</h1><iframe title="reader" src="${origin}" style="width:100%;height:800px"></iframe>`)
})
try {
  service = await startReaderServer({ databasePath:file, adminToken:randomBytes(32).toString('hex'), origin, allowEmbedding:true })
  await service.store.saveAccount({ username:'fixture-reader', password:'fixture-password-123' })
  const body = '这是隔离数据库中的模拟正文。只用于验证 iframe 登录与阅读。'
  service.store.stage({ publicationId:'release-1', bookId:'fixture-book', baseRevision:'', title:'跨站登录模拟书', description:'测试数据', genre:'模拟', chapters:[{ id:'chapter-1', no:1, title:'模拟章节', hash:digest(body) }] })
  service.store.upload('release-1', 'chapter-1', body); service.store.commit('release-1')
  await listen(parent)
  browser = await chromium.launch({ headless:true, executablePath:process.env.NOVEL_STUDIO_BROWSER || undefined, args:['--test-third-party-cookie-phaseout'] })
  const context = await browser.newContext({ ignoreHTTPSErrors:true, viewport:{ width:1000, height:1000 } })
  const page = await context.newPage(), failures = []
  page.on('pageerror', e => failures.push(e.message))
  const parentOrigin = `http://localhost:${parent.address().port}`
  await page.goto(parentOrigin)
  const frame = page.frameLocator('iframe')
  const login = async target => {
    await target.locator('[name=username]').fill('fixture-reader')
    await target.locator('[name=password]').fill('fixture-password-123')
    await target.getByRole('button', { name:'登录阅读', exact:true }).click()
    await target.locator('#shelf').waitFor({ state:'visible' })
  }
  await login(frame)
  const cookies = await context.cookies(origin)
  const session = cookies.find(c => c.name === '__Host-reader_embed_session')
  assert.ok(session?.partitionKey?.includes('localhost'), 'cookie is partitioned by the embedding site')
  assert.equal(session.httpOnly, true); assert.equal(session.secure, true); assert.equal(session.sameSite, 'None')
  await page.reload(); await frame.locator('#shelf').waitFor({ state:'visible' })
  await frame.getByRole('button', { name:'开始阅读', exact:true }).click()
  await frame.locator('#reader').waitFor({ state:'visible' })
  assert.ok((await frame.locator('#pages').innerText()).includes(body))
  await page.reload(); await frame.locator('#shelf').waitFor({ state:'visible' })
  await page.screenshot({ path:path.join(directory, 'iframe-shelf.png') })
  // A second top-level site and a direct tab must not inherit the first login.
  const second = await context.newPage()
  await second.goto(`http://127.0.0.1:${parent.address().port}`)
  const secondFrame = second.frameLocator('iframe')
  await secondFrame.locator('#login').waitFor({ state:'visible' })
  const direct = await context.newPage(); await direct.goto(origin)
  await direct.locator('#login').waitFor({ state:'visible' }); await login(direct)
  await frame.getByRole('button', { name:'退出登录', exact:true }).click()
  await frame.locator('#login').waitFor({ state:'visible' })
  await page.reload(); await frame.locator('#login').waitFor({ state:'visible' })
  await direct.reload(); await direct.locator('#shelf').waitFor({ state:'visible' })
  // Simulate a browser discarding Set-Cookie and ensure actionable feedback.
  await second.route('**/api/login', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ authenticated:true }) }))
  await secondFrame.locator('[name=username]').fill('fixture-reader'); await secondFrame.locator('[name=password]').fill('fixture-password-123')
  await secondFrame.getByRole('button', { name:'登录阅读', exact:true }).click()
  await secondFrame.getByText('账号验证成功，但浏览器未保留登录状态。请在新标签页打开阅读站后登录。', { exact:true }).waitFor()
  assert.deepEqual(failures, [])
  console.log(JSON.stringify({ ok:true, fixtureDirectory:directory, crossSiteLogin:true, reload:true, reading:true, partitionIsolation:true, logoutIsolation:true, blockedCookieFeedback:true }))
} finally { await browser?.close(); await close(parent); await close(proxy); await service?.close() }
