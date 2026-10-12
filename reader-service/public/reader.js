const $ = id => document.getElementById(id)
const state = { book: null, chapter: null, page: 0, count: 1, stride: 0, serial: 0, tocPage: 0, pending: null }
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* reading works without storage */ } }
const preferences = readLocal('reader:preferences', { size: 20, line: '1.85', font: 'serif', theme: 'light' })
let messageTimer
function message(text) { $('message').textContent = text; $('message').hidden = false; clearTimeout(messageTimer); messageTimer = setTimeout(() => { $('message').hidden = true }, 5000) }
async function api(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 401) lock()
    throw new Error(result.error || '连接失败')
  }
  return result
}
function lock() {
  savePosition(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  $('pages').replaceChildren(); $('books').replaceChildren(); $('toc-list').replaceChildren(); $('toc').close()
  $('reader').hidden = true; $('shelf').hidden = true; $('login').hidden = false; $('reading-menu').hidden = true
}
function button(label, fn) { const element = document.createElement('button'); element.textContent = label; element.onclick = () => Promise.resolve(fn()).catch(error => message(error.message)); return element }
function chapterLabel(chapter) {
  const title = chapter.title.replace(/^第\s*[\d一二三四五六七八九十百千万零两]+\s*章\s*/u, '').trim()
  return `第${chapter.no}章${title ? ` ${title}` : ''}`
}
async function shelf() {
  savePosition(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  $('pages').replaceChildren(); $('reading-menu').hidden = true; $('reader').hidden = true
  const session = await api('/api/session')
  if (session.requireLogin && !session.authenticated) { lock(); return }
  $('login').hidden = true; $('shelf').hidden = false; $('logout').hidden = !session.authenticated
  const books = await api('/api/books'); $('books').replaceChildren()
  if (!books.length) { const p = document.createElement('p'); p.textContent = '还没有发布的书籍。'; $('books').append(p) }
  for (const book of books) {
    const item = document.createElement('article'); item.className = 'book'
    const spine = document.createElement('div'); spine.className = 'book-spine'; spine.textContent = book.title.slice(0, 8)
    const copy = document.createElement('div'), title = document.createElement('h2'), info = document.createElement('small'), description = document.createElement('p')
    title.textContent = book.title; description.textContent = book.description
    info.textContent = `${book.genre ? `${book.genre} · ` : ''}${book.chapterCount} 章 · ${new Date(book.updated_at).toLocaleDateString()} 更新`
    copy.append(title, info, description, button(readLocal(`reader:position:${book.id}`, null) ? '继续阅读' : '开始阅读', () => openBook(book.id)))
    item.append(spine, copy); $('books').append(item)
  }
}
async function openBook(id) {
  const serial = ++state.serial, book = await api(`/api/books/${id}`)
  if (serial !== state.serial) return
  if (!book.chapters.length) { message('此书还没有可读章节'); return }
  state.book = book; state.pending = null; $('update').hidden = true
  const position = readLocal(`reader:position:${id}`, null)
  await openChapter(book.chapters.find(c => c.id === position?.chapterId)?.id || book.chapters[0].id, position)
}
async function openChapter(id, position = null, lastPage = false) {
  if (!state.book) return
  savePosition()
  const serial = ++state.serial, bookId = state.book.id
  const chapter = await api(`/api/books/${bookId}/chapters/${id}`)
  if (serial !== state.serial || state.book?.id !== bookId) return
  state.chapter = chapter; state.page = 0
  $('shelf').hidden = true; $('login').hidden = true; $('reader').hidden = false; $('reading-menu').hidden = true
  $('chapter-label').textContent = chapterLabel(chapter)
  $('book-label').textContent = state.book.title
  $('pages').replaceChildren()
  const heading = document.createElement('h2'); heading.textContent = $('chapter-label').textContent; $('pages').append(heading)
  for (const paragraph of chapter.body.replace(/\r\n?/g, '\n').split(/\n+/).filter(p => p.trim())) {
    const p = document.createElement('p'); p.textContent = paragraph.replace(/^[ \t\u3000]+/, ''); $('pages').append(p)
  }
  applyPreferences()
  await document.fonts.ready
  if (serial !== state.serial) return
  paginate(position, lastPage)
  if (chapter.revision !== state.book.revision) { state.pending = true; $('update').hidden = false }
  $('viewport').focus({ preventScroll: true })
}
function applyPreferences() {
  preferences.size = Math.max(16, Math.min(30, Number(preferences.size) || 20))
  preferences.line = ['1.6', '1.85', '2.1'].includes(String(preferences.line)) ? String(preferences.line) : '1.85'
  preferences.font = preferences.font === 'sans-serif' ? 'sans-serif' : 'serif'
  preferences.theme = ['light', 'paper', 'dark'].includes(preferences.theme) ? preferences.theme : 'light'
  document.documentElement.style.setProperty('--font-size', `${preferences.size}px`)
  document.documentElement.style.setProperty('--line-height', preferences.line)
  document.documentElement.style.setProperty('--prose', preferences.font === 'serif' ? '"Songti SC","Noto Serif CJK SC","SimSun",serif' : '"PingFang SC","Microsoft YaHei",sans-serif')
  document.body.dataset.theme = preferences.theme
  $('font-size').value = preferences.size; $('line-height').value = preferences.line; $('font-family').value = preferences.font; $('theme').value = preferences.theme
}
function nodes() { const walker = document.createTreeWalker($('pages'), NodeFilter.SHOW_TEXT), list = []; while (walker.nextNode()) list.push(walker.currentNode); return list }
function characterRect(node, index) { const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1); return range.getBoundingClientRect() }
function currentOffset() {
  if (!state.chapter || !state.stride) return 0
  const left = $('viewport').getBoundingClientRect().left
  let offset = 0
  for (const node of nodes()) {
    let low = 0, high = node.length
    while (low < high) { const mid = Math.floor((low + high) / 2); if (characterRect(node, mid).right <= left + 1) low = mid + 1; else high = mid }
    if (low < node.length) return offset + low
    offset += node.length
  }
  return offset
}
function position() {
  const content = $('pages').textContent, offset = currentOffset()
  return { chapterId: state.chapter?.id, offset, anchor: content.slice(offset, offset + 40), length: content.length, hash: state.chapter?.hash }
}
function savePosition() { if (state.book && state.chapter) saveLocal(`reader:position:${state.book.id}`, position()) }
function paginate(saved = null, lastPage = false) {
  if (!state.chapter || $('reader').hidden) return
  const width = $('viewport').clientWidth, pages = $('pages')
  state.stride = width + 36; pages.style.columnWidth = `${width}px`; pages.style.width = `${width}px`; pages.style.transform = 'translateX(0)'
  state.count = Math.max(1, Math.round((pages.scrollWidth + 36) / state.stride))
  let nextPage = lastPage ? state.count - 1 : state.page
  if (saved?.chapterId === state.chapter.id) {
    let target = Math.max(0, Number(saved.offset) || 0), content = pages.textContent
    if (saved.hash !== state.chapter.hash) {
      const found = saved.anchor ? content.indexOf(saved.anchor) : -1
      target = found >= 0 ? found : Math.floor(target / Math.max(1, saved.length || content.length) * content.length)
    }
    let accumulated = 0
    for (const node of nodes()) {
      if (target < accumulated + node.length) { nextPage = Math.floor((characterRect(node, target - accumulated).left - $('viewport').getBoundingClientRect().left + 1) / state.stride); break }
      accumulated += node.length
    }
  }
  state.page = Math.max(0, Math.min(state.count - 1, nextPage)); renderPage()
}
function renderPage() {
  $('pages').style.transform = `translateX(${-state.page * state.stride}px)`
  const chapterIndex = state.book.chapters.findIndex(c => c.id === state.chapter.id)
  $('progress').textContent = `${state.page + 1} / ${state.count} 页 · ${chapterIndex + 1} / ${state.book.chapters.length} 章`
  savePosition()
}
async function turn(direction) {
  if (!state.chapter) return
  const page = state.page + direction
  if (page >= 0 && page < state.count) { state.page = page; renderPage(); return }
  const index = state.book.chapters.findIndex(c => c.id === state.chapter.id) + direction
  if (index < 0 || index >= state.book.chapters.length) { message(direction < 0 ? '已经是第一章' : '已读到最新发布章节'); return }
  await openChapter(state.book.chapters[index].id, null, direction < 0)
}
function directory() {
  const search = $('toc-search').value.trim(), chapters = state.book?.chapters.filter(c => !search || `${c.no} ${c.title}`.includes(search)) || []
  const count = Math.max(1, Math.ceil(chapters.length / 25)); state.tocPage = Math.max(0, Math.min(count - 1, state.tocPage))
  $('toc-list').replaceChildren()
  for (const chapter of chapters.slice(state.tocPage * 25, (state.tocPage + 1) * 25)) {
    const b = button(chapterLabel(chapter), async () => { $('toc').close(); await openChapter(chapter.id) }); if (chapter.id === state.chapter?.id) b.className = 'current'; $('toc-list').append(b)
  }
  $('toc-page').textContent = `${state.tocPage + 1} / ${count}`; $('toc-prev').disabled = state.tocPage === 0; $('toc-next').disabled = state.tocPage === count - 1
}
function bind(id, fn) { $(id).onclick = () => Promise.resolve(fn()).catch(error => message(error.message)) }
bind('back', shelf); bind('logout', async () => { await api('/api/logout', {}); lock() })
bind('menu-close', () => { $('reading-menu').hidden = true })
bind('directory', () => { $('toc-search').value = ''; state.tocPage = Math.floor(Math.max(0, state.book.chapters.findIndex(c => c.id === state.chapter.id)) / 25); directory(); $('toc').showModal() })
bind('toc-close', () => $('toc').close()); bind('toc-prev', () => { state.tocPage--; directory() }); bind('toc-next', () => { state.tocPage++; directory() })
$('toc-search').oninput = () => { state.tocPage = 0; directory() }
for (const [control, field] of [['font-size', 'size'], ['line-height', 'line'], ['font-family', 'font'], ['theme', 'theme']]) $(control).oninput = () => { const saved = position(); preferences[field] = $(control).value; applyPreferences(); saveLocal('reader:preferences', preferences); paginate(saved) }
for (const [control, direction] of [['previous', -1], ['next', 1]]) bind(control, () => { const index = state.book.chapters.findIndex(c => c.id === state.chapter.id) + direction; return state.book.chapters[index] ? openChapter(state.book.chapters[index].id) : message('没有更多章节') })
bind('update', async () => {
  const saved = position(), bookId = state.book.id, serial = ++state.serial, book = await api(`/api/books/${bookId}`)
  if (serial !== state.serial) return
  state.book = book; state.pending = null; $('update').hidden = true
  if (book.chapters.some(c => c.id === saved.chapterId)) await openChapter(saved.chapterId, saved)
  else if (book.chapters.length) { message('原章节已下架，已进入第一章'); await openChapter(book.chapters[0].id) }
  else await shelf()
})
$('login-form').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('button'); submit.disabled = true; $('login-error').textContent = ''
  try { const data = new FormData(form); await api('/api/login', { username: data.get('username'), password: data.get('password') }); form.reset(); await shelf() } catch (error) { $('login-error').textContent = error.message } finally { submit.disabled = false }
}
let touch = null, swipedAt = 0
$('viewport').addEventListener('pointerdown', event => { touch = { x: event.clientX, y: event.clientY } })
$('viewport').addEventListener('pointercancel', () => { touch = null })
$('viewport').addEventListener('pointerup', event => {
  if (touch && Math.abs(event.clientX - touch.x) > 45 && Math.abs(event.clientY - touch.y) < 50) { swipedAt = Date.now(); void turn(event.clientX < touch.x ? 1 : -1).catch(e => message(e.message)) }
  touch = null
})
$('viewport').onclick = event => {
  if (Date.now() - swipedAt < 400 || String(window.getSelection()).trim()) return
  const rect = $('viewport').getBoundingClientRect(), ratio = (event.clientX - rect.left) / rect.width
  if (ratio > .3 && ratio < .7) $('reading-menu').hidden = !$('reading-menu').hidden
  else void turn(ratio <= .3 ? -1 : 1).catch(e => message(e.message))
}
$('viewport').onkeydown = event => { if (['ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); void turn(event.key === 'ArrowRight' ? 1 : -1).catch(e => message(e.message)) } if (event.key === 'Escape') $('reading-menu').hidden = !$('reading-menu').hidden }
let resizeTimer
function resized() { const saved = state.chapter ? position() : null; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (window.visualViewport) $('reader').style.height = `${window.visualViewport.height}px`; paginate(saved) }, 100) }
new ResizeObserver(resized).observe($('viewport'))
window.visualViewport?.addEventListener('resize', resized)
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); else void checkUpdate() })
window.addEventListener('pagehide', savePosition)
let checking = false
async function checkUpdate() {
  if (checking || !state.book || document.hidden) return
  checking = true; const bookId = state.book.id, serial = state.serial
  try {
    const book = await api(`/api/books/${bookId}`)
    if (state.book?.id === bookId && serial === state.serial && book.revision !== state.book.revision) { state.pending = true; $('update').hidden = false }
  } catch (error) { message(error.message); if (!state.book) return; if (/下架/.test(error.message)) await shelf().catch(e => message(e.message)) }
  finally { checking = false }
}
setInterval(() => void checkUpdate(), 30_000)
applyPreferences(); void shelf().catch(error => message(error.message))
