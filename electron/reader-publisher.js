import { createHash } from 'node:crypto'
import { setImmediate as yieldToUi } from 'node:timers/promises'

const hash = value => createHash('sha256').update(value).digest('hex')
const settingsKey = 'reader_publication_settings_v1'
export function readerOrigin(value, allowLocal = false) {
  const url = new URL(String(value || ''))
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('阅读站地址需要 HTTPS 域名，不含路径或凭据')
  return url.origin
}

export function createReaderPublisher(db, { encrypt, decrypt, allowLocal = false, fetchImpl = fetch, now = () => Date.now() } = {}) {
  let busy = false, stopped = false
  const controllers = new Set(), progress = new Map(), metadataSeen = new Map()
  const defaults = () => ({ origin: 'https://txt.zhijianku.com', tokenCipher: '', books: {} })
  function config() { const raw = db.prepare('SELECT value FROM app_settings WHERE key=?').get(settingsKey)?.value; return raw ? JSON.parse(raw) : defaults() }
  function persist(value) { db.prepare('INSERT INTO app_settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(settingsKey, JSON.stringify(value), new Date().toISOString()) }
  function projects() { return db.prepare("SELECT id,title FROM projects WHERE project_type='user' AND archived_at='' ORDER BY updated_at DESC").all() }
  function status() {
    const c = config()
    const available = projects(), liveIds = new Set(available.map(p => p.id))
    const orphaned = Object.entries(c.books).filter(([id, b]) => !liveIds.has(id) && b.published).map(([id, b]) => ({ id, title:b.title || '已归档或删除的已发布书籍', unavailable:true }))
    return { origin: c.origin, configured: Boolean(c.tokenCipher), busy,
      projects: [...available, ...orphaned].map(p => ({ ...p, ...(c.books[p.id] || {}), title:p.title, progress: progress.get(p.id) || null })) }
  }
  function save(input) {
    if (busy) throw new Error('请等待当前发布操作结束再修改设置')
    const c = config(), origin = readerOrigin(input.origin, allowLocal)
    if (origin !== c.origin) { c.tokenCipher = ''; c.books = {}; metadataSeen.clear() }
    c.origin = origin
    if (input.token) {
      if (!/^[a-f0-9]{64}$/.test(input.token)) throw new Error('发布凭据需要 64 位十六进制字符')
      c.tokenCipher = encrypt(input.token)
    }
    persist(c); return status()
  }
  async function request(route, method = 'GET', input) {
    if (stopped) throw new Error('应用正在退出')
    const c = config(), token = c.tokenCipher ? decrypt(c.tokenCipher) : ''
    if (!token) throw new Error('请先配置阅读站发布凭据')
    const controller = new AbortController(); controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetchImpl(`${c.origin}${route}`, { method, redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined })
      // Reject large/error HTML responses from a misconfigured proxy, without
      // exposing request headers, passwords, or token-bearing debug dumps.
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务器未返回阅读接口，请核对域名和反向代理')
      const chunks = []; let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > 4 * 1024 * 1024) { controller.abort(); throw new Error('服务器响应过大') } chunks.push(chunk) }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!response.ok) throw Object.assign(new Error(data.error || `阅读服务返回 ${response.status}`), { permanent:response.status < 500 && response.status !== 429 })
      return data
    } catch (error) {
      if (controller.signal.aborted) throw new Error('发布连接已取消或超时；旧版保持可读，可重新发布')
      throw error
    } finally { clearTimeout(timeout); controllers.delete(controller) }
  }
  async function exclusive(fn) {
    if (busy) throw new Error('已有阅读站操作进行中，请稍后重试')
    busy = true
    try { return await fn() } finally { busy = false }
  }
  async function remote() { const result = await request('/manage/status'); if (result.protocolVersion !== 1) throw new Error('阅读服务版本不匹配'); return result }
  function metadata(projectId) {
    const project = db.prepare("SELECT id,title,genre FROM projects WHERE id=? AND project_type='user' AND archived_at=''").get(projectId)
    if (!project) throw new Error('书籍不存在或已归档')
    const chapters = db.prepare('SELECT id,chapter_no,title,status,updated_at FROM chapters WHERE project_id=? ORDER BY chapter_no').all(projectId)
    return { project, chapters, signature: hash(JSON.stringify([project, chapters])), changes: Number(db.prepare('SELECT total_changes() AS n').get().n) }
  }
  function saveBook(input) {
    if (busy) throw new Error('请等待发布结束')
    metadata(input.projectId)
    if (!['completed', 'all'].includes(input.scope)) throw new Error('发布范围无效')
    if (typeof input.description !== 'string' || input.description.length > 5000) throw new Error('公开简介超过 5000 字')
    const c = config(), previous = c.books[input.projectId] || {}
    if (input.auto && !previous.published) throw new Error('请先手动发布一次，确认公开内容后再开启自动同步')
    c.books[input.projectId] = { ...previous, scope: input.scope, description: input.description, auto: input.auto === true, retryAt:0,failures:0,error:'' }
    persist(c); metadataSeen.delete(input.projectId); return status()
  }
  async function publish(projectId, automatic = false) {
    return exclusive(async () => {
      const c = config(), selection = c.books[projectId]
      if (!selection) throw new Error('请先保存此书的发布范围与公开简介')
      let source
      try { source = metadata(projectId) } catch (error) {
        if (automatic) { c.books[projectId].auto = false; c.books[projectId].error = '本机书籍已归档或删除，自动同步暂停；云端旧版仍在，可使用下架'; persist(c) }
        throw error
      }
      progress.set(projectId, { phase: '检查云端版本', completed: 0, total: 0 })
      try {
        const cloud = await remote(), cloudBook = cloud.books.find(b => b.id === projectId)
        if (automatic && (cloudBook?.revision || '') !== (selection.lastRevision || '')) throw Object.assign(new Error('云端版本被另一端修改或下架，自动发布已暂停，请手动核对'), { permanent:true })
        const seen = metadataSeen.get(projectId)
        if (automatic && seen?.signature === source.signature && seen.changes === source.changes) { progress.delete(projectId); return { unchanged: true } }
        const prior = cloudBook ? await request(`/manage/books/${projectId}`) : null
        const remoteChapters = prior?.chapters || []
        const chapters = [], bodies = new Map()
        for (let index = 0; index < source.chapters.length; index++) {
          const meta = source.chapters[index]
          if (selection.scope === 'completed' && meta.status !== 'completed') {
            if (automatic) { const old = remoteChapters.find(ch => ch.id === meta.id); if (old) chapters.push(old) }
            continue
          }
          const body = db.prepare('SELECT manuscript FROM chapters WHERE id=? AND project_id=?').get(meta.id, projectId)?.manuscript || ''
          if (!body.trim()) continue
          const chapter = { id: meta.id, no: meta.chapter_no, title: meta.title, hash: hash(body) }
          chapters.push(chapter); bodies.set(meta.id, body)
          if (index % 10 === 0) await yieldToUi()
        }
        if (automatic && selection.scope === 'completed') for (const old of remoteChapters) if (!source.chapters.some(ch => ch.id === old.id)) chapters.push(old)
        chapters.sort((a, b) => a.no - b.no)
        if (chapters.length === 0) throw Object.assign(new Error('没有符合范围的非空正文；如需撤下书籍，请使用“下架”'), { permanent:true })
        const manifest = { bookId: projectId, title: source.project.title, genre: source.project.genre || '', description: selection.description, chapters, baseRevision: cloudBook?.revision || '' }
        const remember = result => {
          if (!automatic || !result.unchanged || selection.error || selection.retryAt) {
            const latest = config()
            latest.books[projectId] = { ...selection, title:source.project.title, published:true, lastRevision:result.revision, syncedAt:new Date(now()).toISOString(), chapterCount:chapters.length, error:'',retryAt:0,failures:0 }
            persist(latest)
          }
          // Pin to the source capture, not the later write count: a same-millisecond
          // edit while awaiting commit must still be inspected on the next tick.
          metadataSeen.set(projectId, { signature:source.signature, changes:source.changes })
          progress.set(projectId, { phase:result.unchanged ? '已是最新版本' : '发布完成',completed:chapters.length,total:chapters.length })
          return { ...result,chapterCount:chapters.length }
        }
        if (prior && prior.title === manifest.title && prior.description === manifest.description && prior.genre === manifest.genre && JSON.stringify(prior.chapters) === JSON.stringify(chapters)) {
          return remember({ revision:prior.revision,unchanged:true })
        }
        const publicationId = `publication-${hash(JSON.stringify(manifest))}`
        const stage = await request('/manage/publications', 'POST', { ...manifest, publicationId })
        progress.set(projectId, { phase: '上传变更章节', completed: 0, total: stage.missing.length })
        for (let i = 0; i < stage.missing.length; i++) {
          const chapterId = stage.missing[i]
          if (!bodies.has(chapterId)) throw new Error('保留章节发生冲突，请手动核对后发布')
          await request(`/manage/publications/${publicationId}/chapters/${chapterId}`, 'PUT', { body: bodies.get(chapterId) })
          progress.set(projectId, { phase: '上传变更章节', completed: i + 1, total: stage.missing.length })
        }
        if (metadata(projectId).signature !== source.signature) throw new Error('上传期间本地稿件有变化，本次未发布；请重新同步')
        for (const [chapterId, body] of bodies) {
          if (db.prepare('SELECT manuscript FROM chapters WHERE id=? AND project_id=?').get(chapterId, projectId)?.manuscript !== body) throw new Error('上传期间本地稿件有变化，本次未发布；请重新同步')
        }
        progress.set(projectId, { phase: '核验并发布', completed: stage.missing.length, total: stage.missing.length })
        const result = await request(`/manage/publications/${publicationId}/commit`, 'POST', {})
        return remember(result)
      } catch (error) {
        progress.set(projectId, { phase: '发布未完成', error: error.message })
        const latest = config()
        if (latest.books[projectId]) {
          const b = latest.books[projectId]; b.error = error.message
          if (automatic && !stopped) {
            if (error.permanent) { b.auto = false; b.retryAt = 0 }
            else { b.failures = Math.min(10,(b.failures || 0)+1); b.retryAt = now()+Math.min(300_000,30_000*2**(b.failures-1)) }
          }
          persist(latest)
        }
        throw error
      }
    })
  }
  async function tick() {
    if (busy || stopped || !config().tokenCipher) return
    for (const [projectId, book] of Object.entries(config().books)) {
      if (book.auto && book.published && (book.retryAt || 0) <= now()) { try { await publish(projectId, true) } catch { /* bounded backoff; no event history */ } }
      if (stopped) break
    }
  }
  return { status, save, saveBook, publish, remote, tick, isBusy: () => busy,
    access: requireLogin => exclusive(() => request('/manage/access', 'PUT', { requireLogin })),
    account: input => exclusive(() => request('/manage/account', input.remove ? 'DELETE' : 'PUT', input)),
    unpublish: projectId => exclusive(async () => {
      if (!config().books[projectId]?.published) throw new Error('此书尚未由当前客户端发布')
      await request(`/manage/books/${projectId}`, 'DELETE', {})
      const c = config(); c.books[projectId] = { ...c.books[projectId], auto: false, published: false, lastRevision: '', error: '' }; persist(c); metadataSeen.delete(projectId); progress.delete(projectId); return status()
    }),
    stop() { stopped = true; for (const controller of controllers) controller.abort() },
  }
}
