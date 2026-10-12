import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openReaderStore, constantEqual, fail } from './store.js'

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url))
export async function startReaderServer({ databasePath, adminToken, origin, host = '127.0.0.1', port = 0, allowHttp = false }) {
  if (!/^[a-f0-9]{64}$/.test(adminToken || '')) throw new Error('READER_ADMIN_TOKEN 需要 32 字节随机十六进制凭据')
  const site = new URL(origin)
  if (site.origin !== origin || (site.protocol !== 'https:' && !(allowHttp && ['localhost', '127.0.0.1'].includes(site.hostname)))) throw new Error('公开地址需要 HTTPS；HTTP 仅供本机测试')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 })
  const store = openReaderStore(databasePath), attempts = new Map()
  const cookie = token => `reader_session=${token}; Path=/; HttpOnly; SameSite=Strict; ${allowHttp ? '' : 'Secure; '}Max-Age=${token ? 604800 : 0}`
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    if (!allowHttp) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    const json = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)) }
    try {
      const url = new URL(req.url, origin), route = url.pathname
      if (req.headers.origin && req.headers.origin !== origin) fail(403, '请求来源不匹配')
      if (url.search) fail(400, '接口不接受查询凭据')
      const management = route.startsWith('/manage/')
      if (management && !constantEqual(req.headers.authorization, `Bearer ${adminToken}`)) fail(401, '发布凭据无效')
      let input = {}
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!management && req.headers.origin !== origin) fail(403, '登录操作需要同源请求')
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, '需要 JSON 请求')
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) fail(413, '请求过大'); chunks.push(chunk) }
        input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '请求无效')
      }
      const session = String(req.headers.cookie || '').match(/(?:^|;\s*)reader_session=([a-f0-9]{64})(?:;|$)/)?.[1] || ''
      if (route === '/api/session' && req.method === 'GET') return json({ requireLogin: store.access().requireLogin, authenticated: store.authenticated(session) })
      if (route === '/api/login' && req.method === 'POST') {
        // Do not trust forwarded IP headers. Apply both account and global limits;
        // 1Panel's trusted reverse proxy can add per-IP limits as a second layer.
        const now = Date.now(), keys = ['global', `account:${String(input.username || '').slice(0, 64)}`]
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key)
        if (attempts.size > 2048) fail(429, '登录请求过多，请稍后再试')
        for (const key of keys) {
          const record = attempts.get(key) || { count: 0, until: now + 15 * 60_000 }
          if (++record.count > (key === 'global' ? 100 : 10)) fail(429, '登录尝试过多，请 15 分钟后再试')
          attempts.set(key, record)
        }
        const token = await store.login(input)
        res.setHeader('Set-Cookie', cookie(token)); return json({ authenticated: true })
      }
      if (route === '/api/logout' && req.method === 'POST') { store.logout(session); res.setHeader('Set-Cookie', cookie('')); return json({ authenticated: false }) }
      if (management) {
        if (route === '/manage/status' && req.method === 'GET') return json({ protocolVersion: 1, ...store.access(), books: store.books() })
        if (route === '/manage/access' && req.method === 'PUT') return json(store.setAccess(input.requireLogin))
        if (route === '/manage/account' && req.method === 'PUT') return json(await store.saveAccount(input))
        if (route === '/manage/account' && req.method === 'DELETE') return json(store.removeAccount(input.username))
        if (route === '/manage/publications' && req.method === 'POST') return json(store.stage(input))
        let match = route.match(/^\/manage\/publications\/([\w-]+)\/chapters\/([\w-]+)$/)
        if (match && req.method === 'PUT') return json(store.upload(match[1], match[2], input.body))
        match = route.match(/^\/manage\/publications\/([\w-]+)\/commit$/)
        if (match && req.method === 'POST') return json(store.commit(match[1]))
        match = route.match(/^\/manage\/books\/([\w-]+)$/)
        if (match && req.method === 'GET') return json(store.book(match[1]))
        if (match && req.method === 'DELETE') return json(store.unpublish(match[1]))
        fail(404, '管理接口不存在')
      }
      if (route.startsWith('/api/')) {
        if (store.access().requireLogin && !store.authenticated(session)) fail(401, '请先登录')
        if (req.method !== 'GET') fail(405, '阅读接口只接受读取')
        if (route === '/api/books') return json(store.books())
        let match = route.match(/^\/api\/books\/([\w-]+)$/)
        if (match) return json(store.book(match[1]))
        match = route.match(/^\/api\/books\/([\w-]+)\/chapters\/([\w-]+)$/)
        if (match) return json(store.chapter(match[1], match[2]))
        fail(404, '阅读接口不存在')
      }
      const files = { '/': ['index.html', 'text/html'], '/reader.js': ['reader.js', 'text/javascript'], '/reader.css': ['reader.css', 'text/css'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/icon.svg': ['icon.svg', 'image/svg+xml'] }
      if (!['GET', 'HEAD'].includes(req.method) || !files[route]) fail(404, '页面不存在')
      const [file, mime] = files[route]
      res.setHeader('Content-Type', `${mime}; charset=utf-8`)
      res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(publicDirectory, file)))
    } catch (error) { json({ error: error.status ? error.message : '请求处理失败，请稍后重试' }, error.status || (error instanceof SyntaxError ? 400 : 500)) }
  })
  server.requestTimeout = 30_000; server.headersTimeout = 15_000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) }).catch(error => { store.close(); throw error })
  if (allowHttp && site.port === '0') origin = `http://${site.hostname}:${server.address().port}`
  return { store, origin, port: server.address().port, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => { store.close(); resolve() }) }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077)
  const service = await startReaderServer({ databasePath: path.resolve(process.env.READER_DATA_DIR || './data', 'reader.sqlite'), adminToken: process.env.READER_ADMIN_TOKEN,
    origin: process.env.READER_ORIGIN || 'https://txt.zhijianku.com', host: '0.0.0.0', port: Number(process.env.PORT || 3080) })
  console.log(`Novel Studio 阅读服务已启动，端口 ${service.port}`)
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await service.close(); process.exit(0) })
}
