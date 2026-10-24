import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { openReaderStore, digest } from '../reader-service/store.js'
import { startReaderServer } from '../reader-service/server.js'
import { createReaderPublisher, readerOrigin } from '../electron/reader-publisher.js'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'novel-reader-test-')))
  const file = path.join(root, 'reader.sqlite')
  assert.equal(fs.realpathSync(path.dirname(file)), root)
  assert.ok(path.resolve(file).startsWith(`${root}${path.sep}`), 'concrete test database path must be isolated before opening')
  return { root, file, cleanup() { fs.rmSync(root, { recursive: true, force: true }) } }
}
function manifest({ bookId = 'book-a', publicationId = 'release-a', baseRevision = '', body = '模拟正文。', count = 1 } = {}) {
  return { bookId, publicationId, baseRevision, title: '模拟书籍', description: '明确公开的简介', genre: '模拟题材', chapters: Array.from({ length: count }, (_, i) => ({ id: `chapter-${i + 1}`, no: i + 1, title: `章节 ${i + 1}`, hash: digest(body) })) }
}
function publish(store, input, body = '模拟正文。') { const staged = store.stage(input); for (const id of staged.missing) store.upload(input.publicationId, id, body); return store.commit(input.publicationId) }

test('publication is atomic, resumable, incremental and isolates identical chapter IDs in two books', () => {
  const f = fixture(), s = openReaderStore(f.file)
  try {
    const first = manifest({ count: 2 }); publish(s, first)
    const b = manifest({ bookId: 'book-b', publicationId: 'release-b', body: '乙书正文' }); publish(s, b, '乙书正文')
    const next = manifest({ publicationId: 'release-a2', baseRevision: 'release-a', body: '新版正文', count: 2 })
    assert.equal(s.stage(next).missing.length, 2)
    s.upload(next.publicationId, 'chapter-1', '新版正文')
    assert.throws(() => s.commit(next.publicationId), /尚未上传/)
    assert.equal(s.chapter('book-a', 'chapter-1').body, '模拟正文。')
    assert.deepEqual(s.stage(next).missing, ['chapter-2'])
    s.upload(next.publicationId, 'chapter-2', '新版正文'); s.commit(next.publicationId)
    assert.deepEqual(s.commit(next.publicationId), { revision: next.publicationId })
    assert.equal(s.stage(next).committed, true)
    assert.equal(s.chapter('book-b', 'chapter-1').body, '乙书正文')
    const third = manifest({ publicationId: 'release-a3', baseRevision: 'release-a2', body: '新版正文', count: 2 })
    assert.deepEqual(s.stage(third).missing, []); s.commit(third.publicationId)
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n, 0)
  } finally { s.close(); f.cleanup() }
})

test('lost responses, concurrent revisions, cross-publication uploads and stale retry cannot overwrite newer content', () => {
  const f = fixture(), s = openReaderStore(f.file)
  try {
    const a = manifest(); publish(s, a)
    assert.throws(() => s.stage({ ...a, title: '不同内容' }), /不同内容/)
    const x = manifest({ publicationId: 'release-x', baseRevision: a.publicationId, body: 'X' })
    const y = manifest({ publicationId: 'release-y', baseRevision: a.publicationId, body: 'Y' })
    s.stage(x); s.stage(y)
    assert.throws(() => s.upload(x.publicationId, 'other-book-chapter', 'X'), /摘要/)
    assert.throws(() => s.upload(x.publicationId, 'chapter-1', 'Y'), /摘要/)
    s.upload(x.publicationId, 'chapter-1', 'X'); s.upload(y.publicationId, 'chapter-1', 'Y')
    s.commit(x.publicationId); assert.throws(() => s.commit(y.publicationId), /已变化/)
    assert.equal(s.chapter('book-a', 'chapter-1').body, 'X')
    assert.throws(() => s.commit(a.publicationId), /已变化/)
    s.unpublish('book-a'); assert.throws(() => s.commit(x.publicationId), /不存在/)
    assert.throws(() => s.book('book-a'), /下架/)
  } finally { s.close(); f.cleanup() }
})

test('service restart recovers staged uploads and validates pending expiry and manifest ownership', () => {
  const f = fixture(); let time = Date.now(), s = openReaderStore(f.file, { now: () => time })
  try {
    const input = manifest(); s.stage(input); s.upload(input.publicationId, 'chapter-1', '模拟正文。'); s.close()
    s = openReaderStore(f.file, { now: () => time }); assert.deepEqual(s.stage(input).missing, []); s.commit(input.publicationId)
    const pending = manifest({ publicationId:'pending', baseRevision:input.publicationId }); s.stage(pending)
    time += 25 * 3600_000; s.stage(manifest({ bookId:'book-b', publicationId:'cleanup' }))
    assert.equal(s.db.prepare('SELECT 1 FROM publications WHERE id=?').get('pending'), undefined)
    assert.throws(() => s.stage({ ...manifest({ publicationId:'duplicate' }), chapters:[...input.chapters, ...input.chapters] }), /序号/)
  } finally { s.close(); f.cleanup() }
})

test('passwords are salted hashes, changes revoke sessions and last enabled account is protected', async () => {
  const f = fixture(), s = openReaderStore(f.file)
  try {
    const password = 'fixture-password-123'
    await s.saveAccount({ username:'读者', password })
    const row = s.db.prepare('SELECT * FROM accounts').get()
    assert.notEqual(row.password_hash, password); assert.equal(row.password_hash.length, 128)
    await assert.rejects(s.login({ username:'读者', password:'incorrect-password' }), /错误/)
    const token = await s.login({ username:'读者', password }); assert.ok(s.authenticated(token))
    await s.saveAccount({ username:'读者', password:'new-fixture-password' }); assert.equal(s.authenticated(token), false)
    await assert.rejects(s.saveAccount({ username:'读者', disabled:true }), /至少保留/)
    assert.throws(() => s.removeAccount('读者'), /至少保留/)
    await s.saveAccount({ username:'备用', password })
    const second = await s.login({ username:'读者', password:'new-fixture-password' })
    await s.saveAccount({ username:'读者', disabled:true }); assert.equal(s.authenticated(second), false)
    s.setAccess(false); s.setAccess(true)
    assert.deepEqual(Object.keys(s.access()).sort(), ['accounts','requireLogin'])
  } finally { s.close(); f.cleanup() }
})

test('HTTP protects all private content and management, rejects origin/CSRF, limits login and serves only whitelisted assets', async () => {
  const f = fixture(), token = randomBytes(32).toString('hex')
  const service = await startReaderServer({ databasePath:f.file, adminToken:token, origin:'http://127.0.0.1:0', allowHttp:true })
  try {
    publish(service.store, manifest())
    await service.store.saveAccount({ username:'reader', password:'fixture-password' })
    const request = (route, options={}) => fetch(service.origin + route, options)
    for (const route of ['/api/books', '/api/books/book-a', '/api/books/book-a/chapters/chapter-1', '/manage/status']) assert.equal((await request(route)).status, 401)
    const login = input => request('/api/login', { method:'POST', headers:{ Origin:service.origin,'Content-Type':'application/json' }, body:JSON.stringify(input) })
    const response = await login({ username:'reader', password:'fixture-password' }), cookie = response.headers.get('set-cookie').split(';')[0]
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly/)
    assert.equal((await request('/api/books', { headers:{ Cookie:cookie } })).status, 200)
    assert.equal((await request('/manage/status', { headers:{ Cookie:cookie } })).status, 401)
    assert.equal((await request('/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' },body:'{}' })).status, 403)
    assert.equal((await request('/api/books', { headers:{ Origin:'https://other.invalid' } })).status, 403)
    const admin = await request('/manage/status', { headers:{ Authorization:`Bearer ${token}` } }); assert.equal(admin.status, 200)
    assert.equal((await request('/store.js')).status, 404); assert.equal((await request('/reader.sqlite')).status, 404)
    assert.equal((await request('/manage/status?token=redacted')).status, 400)
    const html = await request('/'); assert.match(html.headers.get('content-security-policy'), /script-src 'self'/); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(html.headers.get('cache-control'), 'no-store')
    service.store.setAccess(false); assert.equal((await request('/api/books')).status, 200)
    service.store.setAccess(true); assert.equal((await request('/api/books', { headers:{ Cookie:cookie } })).status, 401)
    for (let i=0;i<10;i++) await login({ username:'attacker', password:'invalid-password' })
    assert.equal((await login({ username:'attacker', password:'invalid-password' })).status, 429)
  } finally { await service.close(); f.cleanup() }
})

test('embedding opt-in allows all frame origins without opening private APIs or management', async () => {
  const f = fixture()
  const service = await startReaderServer({ databasePath:f.file, adminToken:randomBytes(32).toString('hex'), origin:'http://127.0.0.1:0', allowHttp:true, allowEmbedding:true })
  try {
    const html = await fetch(service.origin)
    assert.equal(html.status, 200)
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors \*;/)
    assert.match(html.headers.get('content-security-policy'), /script-src 'self';/)
    assert.equal(html.headers.get('x-frame-options'), null)
    for (const route of ['/api/books', '/manage/status']) assert.equal((await fetch(service.origin + route)).status, 401)
    assert.equal((await fetch(service.origin + '/api/login', { method:'POST', headers:{ Origin:'https://parent.example', 'Content-Type':'application/json' }, body:'{}' })).status, 403)
    await service.store.saveAccount({ username:'embed-reader', password:'fixture-password' })
    const response = await fetch(service.origin + '/api/login', { method:'POST', headers:{ Origin:service.origin, 'Content-Type':'application/json' }, body:JSON.stringify({ username:'embed-reader', password:'fixture-password' }) })
    assert.equal(response.status, 200)
    const header = response.headers.get('set-cookie'), session = header.split(';')[0]
    assert.match(header, /^__Host-reader_embed_session=/)
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/']) assert.ok(header.includes(attribute))
    assert.equal(header.includes('Domain='), false)
    assert.equal((await (await fetch(service.origin + '/api/session', { headers:{ Cookie:session } })).json()).authenticated, true)
    assert.equal((await fetch(service.origin + '/manage/status', { headers:{ Cookie:session } })).status, 401)
    const logout = await fetch(service.origin + '/api/logout', { method:'POST', headers:{ Origin:service.origin, Cookie:session, 'Content-Type':'application/json' }, body:'{}' })
    assert.match(logout.headers.get('set-cookie'), /Partitioned; Max-Age=0/)
    assert.equal((await (await fetch(service.origin + '/api/session', { headers:{ Cookie:session } })).json()).authenticated, false)
  } finally { await service.close(); f.cleanup() }
})

test('desktop publisher binds one book, incrementally syncs drafts, blocks stale source and preserves local library', async () => {
  const f = fixture(), localFile = path.join(f.root, 'author.sqlite')
  assert.equal(fs.realpathSync(path.dirname(localFile)), f.root)
  const db = new DatabaseSync(localFile); runMigrations(db)
  const repo = createWorkspaceRepository(db), a = repo.createProject({ title:'模拟甲书' }), b = repo.createProject({ title:'模拟乙书' })
  repo.updateChapter({ id:a.chapters[0].id, manuscript:'甲书初稿' }); repo.updateChapter({ id:b.chapters[0].id, manuscript:'乙书私稿' })
  const token = randomBytes(32).toString('hex'), remote = await startReaderServer({ databasePath:f.file, adminToken:token, origin:'http://127.0.0.1:0', allowHttp:true })
  let uploads = 0, changeDuringUpload = false, loseCommitResponse = false
  const publisher = createReaderPublisher(db, { allowLocal:true, encrypt:v => `test:${v}`, decrypt:v => v.slice(5), fetchImpl:async (...args) => {
    if (args[1]?.method === 'PUT' && args[0].includes('/chapters/')) {
      uploads++
      if (changeDuringUpload) { changeDuringUpload = false; repo.updateChapter({ id:a.chapters[0].id, manuscript:'上传中又修改' }) }
    }
    const response = await fetch(...args)
    if (loseCommitResponse && args[0].endsWith('/commit')) { loseCommitResponse = false; throw new Error('fixture lost response') }
    return response
  } })
  try {
    publisher.save({ origin:remote.origin, token })
    assert.equal(JSON.stringify(publisher.status()).includes(token), false)
    publisher.saveBook({ projectId:a.project.id, scope:'all', description:'公开简介', auto:false })
    await publisher.publish(a.project.id)
    assert.equal(remote.store.books().length, 1); assert.equal(remote.store.book(a.project.id).chapters.length, 1)
    assert.throws(() => remote.store.book(b.project.id), /下架/)
    publisher.saveBook({ projectId:a.project.id, scope:'all', description:'公开简介', auto:true })
    repo.loadWorkspace(b.project.id)
    repo.updateChapter({ id:a.chapters[0].id, manuscript:'甲书只改一字' }); await publisher.tick()
    assert.equal(remote.store.chapter(a.project.id, a.chapters[0].id).body, '甲书只改一字')
    assert.equal(uploads, 2); await publisher.tick(); assert.equal(uploads, 2)
    repo.updateChapter({ id:a.chapters[0].id, manuscript:'准备上传' }); changeDuringUpload = true
    await assert.rejects(publisher.publish(a.project.id), /本地稿件有变化/)
    assert.equal(remote.store.chapter(a.project.id, a.chapters[0].id).body, '甲书只改一字')
    loseCommitResponse = true; await assert.rejects(publisher.publish(a.project.id), /lost response/)
    await publisher.publish(a.project.id)
    assert.equal(remote.store.chapter(a.project.id, a.chapters[0].id).body, '上传中又修改')
    assert.equal(repo.getChapter({ projectId:b.project.id,chapterId:b.chapters[0].id }).manuscript, '乙书私稿')
    await publisher.unpublish(a.project.id); assert.equal(publisher.status().projects.find(p => p.id === a.project.id).auto, false)
    await publisher.tick(); assert.equal(remote.store.books().length, 0)
  } finally { publisher.stop(); await remote.close(); db.close(); f.cleanup() }
})

test('publisher finalized auto-mode retains revised/deleted published chapters, never silently uploads draft changes', async () => {
  const f = fixture(), db = new DatabaseSync(path.join(f.root,'author.sqlite')); runMigrations(db)
  const repo = createWorkspaceRepository(db), a = repo.createProject({ title:'定稿模拟书' })
  repo.updateChapter({ id:a.chapters[0].id, manuscript:'已定稿正文' }); db.prepare("UPDATE chapters SET status='completed' WHERE id=?").run(a.chapters[0].id)
  const token = randomBytes(32).toString('hex'), service = await startReaderServer({ databasePath:f.file, adminToken:token, origin:'http://127.0.0.1:0',allowHttp:true })
  const options = { allowLocal:true,encrypt:v=>v,decrypt:v=>v }
  let p = createReaderPublisher(db,options)
  try {
    p.save({ origin:service.origin,token }); p.saveBook({ projectId:a.project.id,scope:'completed',description:'',auto:false }); await p.publish(a.project.id)
    p.saveBook({ projectId:a.project.id,scope:'completed',description:'',auto:true })
    repo.updateChapter({ id:a.chapters[0].id,manuscript:'未定稿大改' }); await p.tick()
    assert.equal(service.store.chapter(a.project.id,a.chapters[0].id).body,'已定稿正文')
    p.stop(); p = createReaderPublisher(db,options); await p.tick()
    assert.equal(service.store.chapter(a.project.id,a.chapters[0].id).body,'已定稿正文')
    service.store.unpublish(a.project.id); await p.tick()
    assert.equal(service.store.books().length,0); assert.equal(p.status().projects[0].auto,false)
  } finally { p.stop(); await service.close(); db.close(); f.cleanup() }
})

test('origin validation avoids plaintext credentials, paths and non-HTTPS production endpoints', () => {
  assert.equal(readerOrigin('https://txt.zhijianku.com/'),'https://txt.zhijianku.com')
  for (const url of ['http://txt.zhijianku.com','https://user:pass@txt.zhijianku.com','https://txt.zhijianku.com/path','https://txt.zhijianku.com/?token=x']) assert.throws(()=>readerOrigin(url))
  assert.equal(readerOrigin('http://127.0.0.1:8000',true),'http://127.0.0.1:8000')
})

test('automatic sync retries transient outages with bounded backoff and keeps other books unchanged', async () => {
  const f = fixture(), db = new DatabaseSync(path.join(f.root,'author.sqlite')); runMigrations(db)
  const repo = createWorkspaceRepository(db), a = repo.createProject({title:'断线模拟书'})
  const b = repo.createProject({title:'不发布的模拟书'})
  repo.updateChapter({id:b.chapters[0].id,manuscript:'保持私有的乙书正文'})
  repo.updateChapter({id:a.chapters[0].id,manuscript:'初版正文'})
  const token = randomBytes(32).toString('hex'), service = await startReaderServer({databasePath:f.file,adminToken:token,origin:'http://127.0.0.1:0',allowHttp:true})
  let time = Date.now(), offline = false, calls = 0
  const publisher = createReaderPublisher(db,{allowLocal:true,encrypt:v=>v,decrypt:v=>v,now:()=>time,fetchImpl:(...args)=>{calls++;if(offline)throw new Error('fixture offline');return fetch(...args)}})
  try {
    publisher.save({origin:service.origin,token});publisher.saveBook({projectId:a.project.id,scope:'all',description:'',auto:false});await publisher.publish(a.project.id)
    publisher.saveBook({projectId:a.project.id,scope:'all',description:'',auto:true});repo.updateChapter({id:a.chapters[0].id,manuscript:'离线时的新正文'})
    offline = true; await publisher.tick()
    let record = publisher.status().projects.find(p=>p.id===a.project.id)
    assert.equal(record.auto,true);assert.equal(record.retryAt,time+30_000)
    const before = calls;await publisher.tick();assert.equal(calls,before)
    time+=30_000;await publisher.tick();record=publisher.status().projects.find(p=>p.id===a.project.id);assert.equal(record.retryAt,time+60_000)
    assert.equal(service.store.chapter(a.project.id,a.chapters[0].id).body,'初版正文')
    time+=60_000;offline=false;await publisher.tick()
    assert.equal(service.store.chapter(a.project.id,a.chapters[0].id).body,'离线时的新正文')
    record=publisher.status().projects.find(p=>p.id===a.project.id);assert.equal(record.retryAt,0);assert.equal(record.error,'')
    const revision = service.store.book(a.project.id).revision
    repo.updateChapter({id:b.chapters[0].id,title:'乙书仅改章名'})
    await publisher.tick();await publisher.tick()
    assert.equal(service.store.book(a.project.id).revision,revision,'unrelated writes do not republish unchanged prose')
    assert.throws(()=>service.store.book(b.project.id),/下架/)
    repo.archiveProject(a.project.id);await publisher.tick()
    record=publisher.status().projects.find(p=>p.id===a.project.id);assert.equal(record.unavailable,true);assert.equal(record.auto,false)
    await publisher.unpublish(a.project.id);assert.equal(service.store.books().length,0)
  }finally{publisher.stop();await service.close();db.close();f.cleanup()}
})
