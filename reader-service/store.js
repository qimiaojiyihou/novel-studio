import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
export const digest = value => createHash('sha256').update(value).digest('hex')
export function fail(status, message) { throw Object.assign(new Error(message), { status }) }
export function text(value, max, name, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(400, `${name}无效`)
  return value
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail(400, '标识无效')
  return value
}
export function constantEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// A separate publication database. Never open or migrate the author's library here.
export function openReaderStore(file, { now = () => Date.now() } = {}) {
  let deriving = 0
  async function derive(password, salt) {
    if (deriving >= 4) fail(429, '登录或密码设置繁忙，请稍后重试')
    deriving++
    try { return Buffer.from(await scrypt(password, salt, 64)).toString('hex') } finally { deriving-- }
  }
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES('requireLogin','true');
    CREATE TABLE IF NOT EXISTS accounts(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,salt TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,genre TEXT NOT NULL,revision TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chapters(book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,id TEXT NOT NULL,no INTEGER NOT NULL,title TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(book_id,id));
    CREATE INDEX IF NOT EXISTS chapter_order ON chapters(book_id,no);
    CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,base_revision TEXT NOT NULL,manifest TEXT NOT NULL,created INTEGER NOT NULL,committed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS uploads(publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,chapter_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(publication_id,chapter_id));`)
  const one = (sql, ...args) => db.prepare(sql).get(...args)
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  function prune() {
    run('DELETE FROM sessions WHERE expires<=?', now())
    run('DELETE FROM publications WHERE created<?', now() - 24 * 3600_000)
  }
  function access() { return { requireLogin: one("SELECT value FROM settings WHERE key='requireLogin'").value === 'true', accounts: all('SELECT username,disabled FROM accounts ORDER BY username').map(a => ({ ...a, disabled: Boolean(a.disabled) })) } }
  async function saveAccount(input) {
    const username = text(input.username, 64, '账号').trim()
    if (!/^[\p{L}\p{N}_@.\-]{1,64}$/u.test(username)) fail(400, '账号只接受文字、数字及 _ @ . -')
    const previous = one('SELECT * FROM accounts WHERE username=?', username)
    let salt = previous?.salt, hash = previous?.password_hash
    if (input.password) {
      const password = text(input.password, 256, '密码')
      if (password.length < 10) fail(400, '密码至少 10 位')
      salt = randomBytes(16).toString('hex'); hash = await derive(password, salt)
    }
    if (!hash) fail(400, '新账号需要密码')
    transaction(() => {
      run('INSERT INTO accounts VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,disabled=excluded.disabled', username, hash, salt, input.disabled === true ? 1 : 0)
      if (access().requireLogin && !one('SELECT username FROM accounts WHERE disabled=0')) fail(400, '登录模式至少保留一个可用账号')
      run('DELETE FROM sessions WHERE username=?', username)
    })
    return access()
  }
  async function login(input) {
    prune()
    const username = text(input.username, 64, '账号').trim(), password = text(input.password, 256, '密码')
    const account = one('SELECT * FROM accounts WHERE username=?', username)
    const hash = await derive(password, account?.salt || 'reader-dummy-salt')
    if (!account || account.disabled || !constantEqual(hash, account.password_hash)) fail(401, '账号或密码错误')
    const token = randomBytes(32).toString('hex'), expires = now() + 7 * 24 * 3600_000
    transaction(() => {
      // Bound per-account sessions, without collecting readers' browsing activity.
      run('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE username=? ORDER BY expires DESC LIMIT -1 OFFSET 9)', username)
      run('INSERT INTO sessions VALUES(?,?,?)', digest(token), username, expires)
    })
    return token
  }
  function authenticated(token) {
    return Boolean(token && one('SELECT s.token_hash FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token_hash=? AND s.expires>? AND a.disabled=0', digest(token), now()))
  }
  function readerAccount(token) {
    return token ? one('SELECT s.username FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token_hash=? AND s.expires>? AND a.disabled=0', digest(token), now())?.username || null : null
  }
  function book(bookId) {
    const row = one('SELECT * FROM books WHERE id=?', id(bookId))
    if (!row) fail(404, '书籍已下架或尚未发布')
    return { ...row, chapters: all('SELECT id,no,title,hash FROM chapters WHERE book_id=? ORDER BY no', bookId) }
  }
  function stage(input) {
    prune()
    id(input.publicationId); id(input.bookId)
    text(input.baseRevision, 100, '基准版本', true)
    text(input.title, 200, '书名'); text(input.description, 5000, '简介', true); text(input.genre, 200, '题材', true)
    if (!Array.isArray(input.chapters) || input.chapters.length > 5000) fail(400, '章节目录无效或超过 5000 章')
    const ids = new Set(), numbers = new Set()
    const chapters = input.chapters.map(c => {
      id(c.id); text(c.title, 300, '章节名')
      if (!Number.isSafeInteger(c.no) || c.no < 1 || ids.has(c.id) || numbers.has(c.no) || !/^[a-f0-9]{64}$/.test(c.hash)) fail(400, '章节序号或摘要无效')
      ids.add(c.id); numbers.add(c.no); return { id: c.id, no: c.no, title: c.title, hash: c.hash }
    })
    const manifest = JSON.stringify({ title: input.title, description: input.description, genre: input.genre, chapters })
    const existing = one('SELECT * FROM publications WHERE id=?', input.publicationId)
    if (existing && (existing.manifest !== manifest || existing.book_id !== input.bookId || existing.base_revision !== input.baseRevision)) fail(409, '重复请求携带了不同内容')
    if (existing?.committed) {
      if (one('SELECT revision FROM books WHERE id=?', input.bookId)?.revision !== input.publicationId) fail(409, '此发布已被后续版本或下架替代')
      return { publicationId: input.publicationId, missing: [], committed: true }
    }
    if ((one('SELECT revision FROM books WHERE id=?', input.bookId)?.revision || '') !== input.baseRevision) fail(409, '云端版本已变化，请重新读取再发布')
    if (!existing) {
      if (one('SELECT COUNT(*) AS count FROM publications WHERE committed=0').count >= 100) fail(429, '未完成的发布过多，请稍后重试')
      run('INSERT INTO publications VALUES(?,?,?,?,?,0)', input.publicationId, input.bookId, input.baseRevision, manifest, now())
    }
    const current = new Map(all('SELECT id,hash FROM chapters WHERE book_id=?', input.bookId).map(c => [c.id, c.hash]))
    const uploaded = new Map(all('SELECT chapter_id,body FROM uploads WHERE publication_id=?', input.publicationId).map(c => [c.chapter_id, digest(c.body)]))
    return { publicationId: input.publicationId, missing: chapters.filter(c => current.get(c.id) !== c.hash && uploaded.get(c.id) !== c.hash).map(c => c.id) }
  }
  function upload(publicationId, chapterId, body) {
    const publication = one('SELECT * FROM publications WHERE id=?', id(publicationId))
    if (!publication || publication.committed) fail(409, '发布不存在或已经结束')
    const chapter = JSON.parse(publication.manifest).chapters.find(c => c.id === id(chapterId))
    text(body, 1000_000, '章节正文', true)
    if (!chapter || digest(body) !== chapter.hash) fail(400, '正文与目录摘要不一致')
    run('INSERT INTO uploads VALUES(?,?,?) ON CONFLICT(publication_id,chapter_id) DO UPDATE SET body=excluded.body', publicationId, chapterId, body)
    return { uploaded: true }
  }
  function commit(publicationId) {
    return transaction(() => {
      const p = one('SELECT * FROM publications WHERE id=?', id(publicationId))
      if (!p) fail(404, '发布不存在')
      const current = one('SELECT revision FROM books WHERE id=?', p.book_id)?.revision || ''
      if (p.committed && current === p.id) return { revision: p.id }
      if (p.committed || current !== p.base_revision) fail(409, '云端版本已变化，本次发布未覆盖它')
      const m = JSON.parse(p.manifest)
      const chapters = m.chapters.map(c => {
        const row = one('SELECT body FROM uploads WHERE publication_id=? AND chapter_id=?', p.id, c.id) || one('SELECT body FROM chapters WHERE book_id=? AND id=? AND hash=?', p.book_id, c.id, c.hash)
        if (!row || digest(row.body) !== c.hash) fail(409, '部分章节尚未上传，旧版保持可读')
        return { ...c, body: row.body }
      })
      run('INSERT INTO books VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,genre=excluded.genre,revision=excluded.revision,updated_at=excluded.updated_at', p.book_id, m.title, m.description, m.genre, p.id, new Date(now()).toISOString())
      const retained = new Set(chapters.map(c => c.id))
      for (const row of all('SELECT id FROM chapters WHERE book_id=?', p.book_id)) if (!retained.has(row.id)) run('DELETE FROM chapters WHERE book_id=? AND id=?', p.book_id, row.id)
      for (const c of chapters) run('INSERT INTO chapters VALUES(?,?,?,?,?,?) ON CONFLICT(book_id,id) DO UPDATE SET no=excluded.no,title=excluded.title,hash=excluded.hash,body=excluded.body WHERE chapters.hash<>excluded.hash OR chapters.no<>excluded.no OR chapters.title<>excluded.title', p.book_id, c.id, c.no, c.title, c.hash, c.body)
      run('UPDATE publications SET committed=1 WHERE id=?', p.id)
      run('DELETE FROM uploads WHERE publication_id=?', p.id)
      return { revision: p.id }
    })
  }
  return {
    db, close: () => db.close(), access, saveAccount, login, authenticated, readerAccount, stage, upload, commit,
    logout: token => run('DELETE FROM sessions WHERE token_hash=?', digest(token || '')),
    setAccess(requireLogin) {
      if (typeof requireLogin !== 'boolean') fail(400, '访问模式无效')
      if (requireLogin && !one('SELECT username FROM accounts WHERE disabled=0')) fail(400, '请先添加一个可用阅读账号')
      transaction(() => { run("UPDATE settings SET value=? WHERE key='requireLogin'", JSON.stringify(requireLogin)); run('DELETE FROM sessions') })
      return access()
    },
    removeAccount(username) {
      text(username, 64, '账号')
      if (access().requireLogin && all('SELECT username FROM accounts WHERE disabled=0').every(a => a.username === username)) fail(400, '登录模式至少保留一个可用账号')
      run('DELETE FROM accounts WHERE username=?', username); return access()
    },
    books: () => all('SELECT b.*,COUNT(c.id) AS chapterCount FROM books b LEFT JOIN chapters c ON c.book_id=b.id GROUP BY b.id ORDER BY b.updated_at DESC'),
    book,
    chapter(bookId, chapterId) {
      const row = one('SELECT id,no,title,body,hash FROM chapters WHERE book_id=? AND id=?', id(bookId), id(chapterId))
      if (!row) fail(404, '章节不存在'); return { ...row, revision: one('SELECT revision FROM books WHERE id=?', bookId).revision }
    },
    unpublish(bookId) { transaction(() => { run('DELETE FROM books WHERE id=?', id(bookId)); run('DELETE FROM publications WHERE book_id=?', bookId) }); return { removed: true } },
  }
}
