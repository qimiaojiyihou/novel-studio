const $ = id => document.getElementById(id)
const state = { book: null, chapter: null, page: 0, count: 1, stride: 0, serial: 0, tocPage: 0, tocDescending: false, pending: null }
let shelfBooks = []
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* reading works without storage */ } }
const preferences = readLocal('reader:preferences', { size: 20, line: '1.85', font: 'serif', theme: 'light', effect: 'slide' })
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const chapterCache = new Map(), animations = new Set()
let cacheGeneration = 0, motionGeneration = 0, previewRequest = 0, turning = false, touch = null, swipedAt = 0, dragFrame = 0, preview = null, layoutSize = ''
function clearChapterCache() { cacheGeneration++; chapterCache.clear() }
function cancelMotion() {
  motionGeneration++; previewRequest++; for (const animation of animations) animation.cancel(); animations.clear()
  cancelAnimationFrame(dragFrame); dragFrame = 0; touch = null; turning = false
  preview?.element.remove(); preview = null
  $('viewport').classList.remove('dragging'); $('viewport').removeAttribute('aria-busy'); delete $('viewport').dataset.turning
  if (state.chapter) $('pages').style.transform = `translateX(${-state.page * state.stride}px)`
}
async function loadChapter(id) {
  const book = state.book, generation = cacheGeneration, key = `${book.id}:${book.revision}:${id}`
  if (!chapterCache.has(key)) {
    const promise = api(`/api/books/${book.id}/chapters/${id}`).catch(error => { if (generation === cacheGeneration) chapterCache.delete(key); throw error })
    chapterCache.set(key, promise)
    // At most the current and two adjacent chapters, never the whole novel.
    while (chapterCache.size > 3) chapterCache.delete(chapterCache.keys().next().value)
  }
  return chapterCache.get(key)
}
function adjacent(direction) {
  const index = state.book?.chapters.findIndex(c => c.id === state.chapter?.id)
  return state.book?.chapters[index + direction]
}
function prefetchAdjacent() {
  if (!state.chapter) return
  for (const direction of [-1, 1]) {
    if ((direction < 0 && state.page > 1) || (direction > 0 && state.count - state.page > 3)) continue
    const next = adjacent(direction); if (next) void loadChapter(next.id).catch(() => { /* retry on explicit turn, no background error toast */ })
  }
}
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
  cancelMotion(); savePosition(); clearChapterCache(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  shelfBooks = []; $('pages').replaceChildren(); $('books').replaceChildren(); $('toc-list').replaceChildren(); $('toc').close()
  $('toc-book').textContent = ''; $('toc-total').textContent = ''; $('toc-range').replaceChildren(); $('shelf-summary').textContent = ''
  $('toc-search').value = ''; $('toc-number').value = ''; $('toc-error').textContent = ''; $('toc-error').hidden = true; $('book-search').value = ''
  $('reader').hidden = true; $('shelf').hidden = true; $('login').hidden = false; $('reading-menu').hidden = true
}
function button(label, fn) { const element = document.createElement('button'); element.textContent = label; element.onclick = () => Promise.resolve(fn()).catch(error => message(error.message)); return element }
function chapterLabel(chapter) {
  const title = chapter.title.replace(/^第\s*[\d一二三四五六七八九十百千万零两]+\s*章\s*/u, '').trim()
  return `第${chapter.no}章${title ? ` ${title}` : ''}`
}
async function shelf() {
  cancelMotion(); savePosition(); clearChapterCache(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  const serial = state.serial
  $('pages').replaceChildren(); $('reading-menu').hidden = true; $('reader').hidden = true
  const session = await api('/api/session')
  if (serial !== state.serial) return
  if (session.requireLogin && !session.authenticated) { lock(); return }
  $('login').hidden = true; $('shelf').hidden = false; $('logout').hidden = !session.authenticated
  const books = await api('/api/books'); if (serial !== state.serial) return
  shelfBooks = books; renderShelf()
}
function renderShelf() {
  const search = $('book-search').value.trim().toLocaleLowerCase()
  const books = shelfBooks.filter(b => !search || `${b.title} ${b.genre}`.toLocaleLowerCase().includes(search)).sort((a,b) => $('book-sort').value === 'title' ? a.title.localeCompare(b.title,'zh-CN') : b.updated_at.localeCompare(a.updated_at))
  $('books').replaceChildren()
  $('shelf-summary').textContent = search ? `找到 ${books.length} 本书` : `${books.length} 本书 · 稿件随作者发布更新`
  if (!books.length) { const p = document.createElement('p'); p.className = 'shelf-empty'; p.textContent = search ? '没有找到这本书，试试其他关键词。' : '书架还空着，作者发布后会显示在这里。'; $('books').append(p) }
  for (const book of books) {
    const item = document.createElement('article'); item.className = 'book'
    const saved = readLocal(`reader:position:${book.id}`, null)
    const spine = document.createElement('div'); spine.className = 'book-spine'; spine.setAttribute('aria-hidden','true')
    let hue = 0; for (const char of book.id) hue = (hue * 31 + char.charCodeAt(0)) >>> 0
    spine.dataset.palette = hue % 4
    const coverName = document.createElement('span'); coverName.textContent = book.title
    const coverMark = document.createElement('small'); coverMark.textContent = 'NOVEL / NS'; spine.append(coverName,coverMark)
    const copy = document.createElement('div'), title = document.createElement('h2'), info = document.createElement('small'), description = document.createElement('p')
    copy.className = 'book-copy'
    title.textContent = book.title; description.textContent = book.description
    const genre = document.createElement('span'); genre.className = 'book-genre'; genre.textContent = book.genre || '小说'
    info.textContent = `${book.chapterCount} 章 · ${new Date(book.updated_at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} 更新`
    const resume = document.createElement('span'); resume.className = 'book-resume'
    resume.textContent = saved ? (saved.chapterNo ? `上次读到第${saved.chapterNo}章` : '已保存上次阅读位置') : '从第一章开始'
    const actions = document.createElement('div'); actions.className = 'book-actions'; actions.append(resume,button(saved ? '继续阅读' : '开始阅读', () => openBook(book.id)))
    copy.append(genre, title, info); if (book.description.trim()) copy.append(description); copy.append(actions)
    item.append(spine, copy); $('books').append(item)
  }
}
async function openBook(id) {
  cancelMotion(); clearChapterCache()
  const serial = ++state.serial, book = await api(`/api/books/${id}`)
  if (serial !== state.serial) return
  if (!book.chapters.length) { message('此书还没有可读章节'); return }
  state.book = book; state.pending = null; $('update').hidden = true
  const position = readLocal(`reader:position:${id}`, null)
  await openChapter(book.chapters.find(c => c.id === position?.chapterId)?.id || book.chapters[0].id, position)
}
async function openChapter(id, position = null, lastPage = false, prepared = null) {
  if (!state.book) return
  cancelMotion(); savePosition()
  const serial = ++state.serial, bookId = state.book.id
  const chapter = prepared || await loadChapter(id)
  if (serial !== state.serial || state.book?.id !== bookId) return
  state.chapter = chapter; state.page = 0
  $('shelf').hidden = true; $('login').hidden = true; $('reader').hidden = false; $('reading-menu').hidden = true
  $('chapter-label').textContent = chapterLabel(chapter)
  $('book-label').textContent = state.book.title
  fillChapter($('pages'), chapter)
  applyPreferences()
  await document.fonts.ready
  if (serial !== state.serial) return
  paginate(position, lastPage)
  if (chapter.revision !== state.book.revision) { state.pending = true; $('update').hidden = false }
  $('viewport').focus({ preventScroll: true })
}
function fillChapter(element, chapter) {
  element.replaceChildren()
  const heading = document.createElement('h2'); heading.textContent = chapterLabel(chapter); element.append(heading)
  for (const paragraph of chapter.body.replace(/\r\n?/g, '\n').split(/\n+/).filter(p => p.trim())) {
    const p = document.createElement('p'); p.textContent = paragraph.replace(/^[ \t\u3000]+/, ''); element.append(p)
  }
}
function applyPreferences() {
  preferences.size = Math.max(16, Math.min(30, Number(preferences.size) || 20))
  preferences.line = ['1.6', '1.85', '2.1'].includes(String(preferences.line)) ? String(preferences.line) : '1.85'
  preferences.font = preferences.font === 'sans-serif' ? 'sans-serif' : 'serif'
  preferences.theme = ['light', 'paper', 'dark'].includes(preferences.theme) ? preferences.theme : 'light'
  preferences.effect = preferences.effect === 'none' ? 'none' : 'slide'
  document.documentElement.style.setProperty('--font-size', `${preferences.size}px`)
  document.documentElement.style.setProperty('--line-height', preferences.line)
  document.documentElement.style.setProperty('--prose', preferences.font === 'serif' ? '"Songti SC","Noto Serif CJK SC","SimSun",serif' : '"PingFang SC","Microsoft YaHei",sans-serif')
  document.body.dataset.theme = preferences.theme
  $('font-size').value = preferences.size; $('line-height').value = preferences.line; $('font-family').value = preferences.font; $('theme').value = preferences.theme
  $('page-effect').value = preferences.effect
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
  return { chapterId: state.chapter?.id, chapterNo: state.chapter?.no, offset, anchor: content.slice(offset, offset + 40), length: content.length, hash: state.chapter?.hash }
}
function savePosition() { if (state.book && state.chapter) saveLocal(`reader:position:${state.book.id}`, position()) }
function paginate(saved = null, lastPage = false) {
  if (!state.chapter || $('reader').hidden) return
  clearTimeout(resizeTimer)
  cancelMotion()
  const width = $('viewport').clientWidth, pages = $('pages')
  layoutSize = `${width}:${$('viewport').clientHeight}`
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
  prefetchAdjacent()
}
function motionEnabled() { return preferences.effect !== 'none' && !reducedMotion.matches }
async function animateTo(element, x, duration = 240) {
  if (!motionEnabled()) { element.style.transform = `translateX(${x}px)`; return }
  const animation = element.animate([{ transform: getComputedStyle(element).transform }, { transform: `translateX(${x}px)` }], { duration, easing:'cubic-bezier(.22,.75,.25,1)', fill:'forwards' })
  animations.add(animation)
  try { await animation.finished; element.style.transform = `translateX(${x}px)` } catch { /* cancelled by reflow, navigation or revoked session */ }
  finally { animations.delete(animation); animation.cancel() }
}
async function preparePreview(direction, offset = 0) {
  const next = adjacent(direction), serial = state.serial, generation = motionGeneration, request = ++previewRequest
  if (!next) return null
  const chapter = await loadChapter(next.id)
  if (serial !== state.serial || generation !== motionGeneration || request !== previewRequest || !state.chapter) return null
  if (preview?.chapter.id === next.id && preview.direction === direction) return preview
  preview?.element.remove()
  const element = document.createElement('div'), pages = document.createElement('article')
  element.className = 'page-preview'; element.setAttribute('aria-hidden','true'); element.inert = true; pages.className = 'pages'
  fillChapter(pages, chapter); pages.style.width = `${$('viewport').clientWidth}px`; pages.style.columnWidth = pages.style.width
  element.style.transform = `translateX(${direction * state.stride + offset}px)`; element.append(pages); $('viewport').append(element)
  const count = Math.max(1,Math.round((pages.scrollWidth + 36)/state.stride))
  pages.style.transform = `translateX(${direction < 0 ? -(count - 1) * state.stride : 0}px)`
  preview = { element, chapter, direction }; return preview
}
async function turn(direction) {
  if (!state.chapter || turning) return
  motionGeneration++; previewRequest++
  turning = true; $('viewport').dataset.turning = 'true'
  const serial = state.serial, generation = motionGeneration, page = state.page + direction
  try {
    if (page >= 0 && page < state.count) {
      preview?.element.remove(); preview = null
      await animateTo($('pages'), -page * state.stride)
      if (serial !== state.serial || generation !== motionGeneration) return
      state.page = page; renderPage(); return
    }
    if (!adjacent(direction)) {
      await animateTo($('pages'), -state.page * state.stride, 180)
      if (serial === state.serial) message(direction < 0 ? '已经是第一章' : '已读到最新发布章节')
      return
    }
    $('viewport').setAttribute('aria-busy','true')
    const next = await preparePreview(direction, touch?.dx || 0)
    if (!next || serial !== state.serial || generation !== motionGeneration) return
    await Promise.all([animateTo($('pages'), -state.page * state.stride - direction * state.stride), animateTo(next.element, 0)])
    if (serial !== state.serial || generation !== motionGeneration) return
    // Keep the outgoing page visible until the adjacent body has loaded and slid in.
    $('pages').style.transform = `translateX(${-state.page * state.stride}px)`
    await openChapter(next.chapter.id, null, direction < 0, next.chapter)
  } catch (error) {
    if (serial === state.serial && generation === motionGeneration) {
      await animateTo($('pages'), -state.page * state.stride, 180)
      preview?.element.remove(); preview = null; throw error
    }
  } finally {
    if (generation === motionGeneration) { turning = false; $('viewport').removeAttribute('aria-busy'); delete $('viewport').dataset.turning }
  }
}
function directoryChapters() {
  const search = $('toc-search').value.trim().toLocaleLowerCase()
  const chapters = state.book?.chapters.filter(c => !search || chapterLabel(c).toLocaleLowerCase().includes(search)) || []
  return state.tocDescending ? chapters.reverse() : chapters
}
function locateCurrentChapter() {
  $('toc-search').value = ''
  state.tocPage = Math.floor(Math.max(0,directoryChapters().findIndex(c=>c.id === state.chapter?.id))/25)
  directory()
  $('toc-list').querySelector('.current')?.scrollIntoView({block:'nearest'})
}
function directory() {
  const chapters = directoryChapters()
  const count = Math.max(1, Math.ceil(chapters.length / 25)); state.tocPage = Math.max(0, Math.min(count - 1, state.tocPage))
  $('toc-list').replaceChildren()
  for (const chapter of chapters.slice(state.tocPage * 25, (state.tocPage + 1) * 25)) {
    const b = button(chapterLabel(chapter), async () => { $('toc').close(); await openChapter(chapter.id) })
    if (chapter.id === state.chapter?.id) { b.className = 'current'; b.setAttribute('aria-current','page') }
    $('toc-list').append(b)
  }
  if (!chapters.length) { const empty = document.createElement('p'); empty.className = 'toc-empty'; empty.textContent = '没有匹配的章节'; $('toc-list').append(empty) }
  $('toc-book').textContent = state.book?.title || ''; $('toc-total').textContent = `${state.book?.chapters.length || 0} 章`
  $('toc-number').max = (state.book?.chapters || []).reduce((max,c)=>Math.max(max,c.no),1)
  $('toc-range').replaceChildren()
  for (let i=0;i<count;i++) {
    const option = document.createElement('option'); option.value = i
    const first = chapters[i*25], last = chapters[Math.min(chapters.length-1,(i+1)*25-1)]
    option.textContent = first ? `第 ${first.no}–${last.no} 章` : '无匹配章节'
    $('toc-range').append(option)
  }
  $('toc-range').value = state.tocPage; $('toc-range').disabled = !chapters.length
  $('toc-order').textContent = state.tocDescending ? '正序' : '倒序'; $('toc-order').setAttribute('aria-pressed',String(state.tocDescending))
  $('toc-page').textContent = `${state.tocPage + 1} / ${count}${$('toc-search').value.trim() ? ` · ${chapters.length} 项` : ''}`
  $('toc-prev').disabled = state.tocPage === 0; $('toc-next').disabled = state.tocPage === count - 1
  $('toc-list').scrollTop = 0
}
async function jumpChapter() {
  const raw = $('toc-number').value, no = Number(raw)
  const chapter = raw && Number.isSafeInteger(no) && state.book?.chapters.find(c=>c.no === no)
  if (!chapter) { $('toc-error').textContent = '请输入已发布的章号'; $('toc-error').hidden = false; $('toc-number').focus(); return }
  $('toc').close(); await openChapter(chapter.id)
}
function bind(id, fn) { $(id).onclick = () => Promise.resolve(fn()).catch(error => message(error.message)) }
bind('back', shelf); bind('logout', async () => { await api('/api/logout', {}); lock() })
bind('menu-close', () => { $('reading-menu').hidden = true })
bind('directory', () => { $('toc-number').value = ''; $('toc-error').hidden = true; locateCurrentChapter(); $('toc').showModal(); $('toc-list').querySelector('.current')?.scrollIntoView({block:'nearest'}) })
bind('toc-close', () => $('toc').close()); bind('toc-prev', () => { state.tocPage--; directory() }); bind('toc-next', () => { state.tocPage++; directory() })
bind('toc-current', locateCurrentChapter); bind('toc-order', () => { state.tocDescending = !state.tocDescending; state.tocPage = 0; directory() }); bind('toc-go', jumpChapter)
$('toc-number').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void jumpChapter().catch(e=>message(e.message)) } }
$('toc-number').oninput = () => { $('toc-error').hidden = true }
$('toc-range').onchange = () => { state.tocPage = Number($('toc-range').value); directory() }
$('toc-search').oninput = () => { state.tocPage = 0; directory() }
$('book-search').oninput = renderShelf; $('book-sort').onchange = renderShelf
for (const [control, field] of [['font-size', 'size'], ['line-height', 'line'], ['font-family', 'font'], ['theme', 'theme'], ['page-effect','effect']]) $(control).oninput = () => { cancelMotion(); const saved = position(); preferences[field] = $(control).value; applyPreferences(); saveLocal('reader:preferences', preferences); paginate(saved) }
for (const [control, direction] of [['previous', -1], ['next', 1]]) bind(control, () => { const index = state.book.chapters.findIndex(c => c.id === state.chapter.id) + direction; return state.book.chapters[index] ? openChapter(state.book.chapters[index].id) : message('没有更多章节') })
bind('update', async () => {
  cancelMotion(); clearChapterCache()
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
function dragTo(dx) {
  if (!state.chapter || !motionEnabled()) return
  $('pages').style.transform = `translateX(${-state.page * state.stride + dx}px)`
  if (preview) preview.element.style.transform = `translateX(${preview.direction * state.stride + dx}px)`
}
async function rebound() {
  if (!state.chapter || turning) return
  motionGeneration++; previewRequest++
  turning = true; $('viewport').dataset.turning = 'true'; const generation = motionGeneration
  try { await Promise.all([animateTo($('pages'), -state.page * state.stride, 180), ...(preview ? [animateTo(preview.element, preview.direction * state.stride, 180)] : [])]) }
  finally { if (generation === motionGeneration) { preview?.element.remove(); preview = null; turning = false; delete $('viewport').dataset.turning } }
}
$('viewport').addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || turning || !$('reading-menu').hidden || String(window.getSelection()).trim()) return
  touch = { id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dragging:false,vertical:false,sampleX:event.clientX,sampleTime:performance.now(),velocity:0 }
})
$('viewport').addEventListener('pointermove', event => {
  if (!touch || touch.id !== event.pointerId || turning || touch.vertical) return
  const dx = event.clientX - touch.x, dy = event.clientY - touch.y
  if (!touch.dragging) {
    if (Math.max(Math.abs(dx),Math.abs(dy)) < 8) return
    if (Math.abs(dy) >= Math.abs(dx)) { touch.vertical = true; return }
    touch.dragging = true; $('viewport').classList.add('dragging'); $('viewport').setPointerCapture(event.pointerId)
  }
  event.preventDefault()
  const now = performance.now(); touch.velocity = (event.clientX - touch.sampleX)/Math.max(1,now - touch.sampleTime); touch.sampleX = event.clientX; touch.sampleTime = now
  const direction = dx < 0 ? 1 : -1, atEdge = state.page + direction < 0 || state.page + direction >= state.count
  touch.dx = Math.max(-state.stride,Math.min(state.stride,dx)) * (atEdge && !adjacent(direction) ? .25 : 1)
  cancelAnimationFrame(dragFrame); dragFrame = requestAnimationFrame(() => { dragFrame = 0; if (touch) dragTo(touch.dx) })
  if (atEdge && adjacent(direction) && (!preview || preview.direction !== direction)) void preparePreview(direction, touch.dx).then(() => { if (touch) dragTo(touch.dx) }).catch(() => {})
}, { passive:false })
$('viewport').addEventListener('pointercancel', () => { cancelAnimationFrame(dragFrame); dragFrame = 0; touch = null; swipedAt = Date.now(); $('viewport').classList.remove('dragging'); void rebound() })
$('viewport').addEventListener('pointerup', event => {
  if (!touch || touch.id !== event.pointerId) return
  cancelAnimationFrame(dragFrame); dragFrame = 0
  const gesture = touch
  if (gesture.dragging) {
    swipedAt = Date.now(); dragTo(gesture.dx); $('viewport').classList.remove('dragging')
    const velocity = performance.now() - gesture.sampleTime < 100 ? gesture.velocity : 0
    const commit = Math.abs(gesture.dx) >= Math.min(96,$('viewport').clientWidth * .22) || (Math.abs(gesture.dx) > 16 && Math.abs(velocity) > .45 && Math.sign(velocity) === Math.sign(gesture.dx))
    if (commit) void turn(gesture.dx < 0 ? 1 : -1).catch(e => message(e.message))
    else void rebound()
  } else if (gesture.vertical) swipedAt = Date.now()
  touch = null
})
$('viewport').onclick = event => {
  if (turning || Date.now() - swipedAt < 400 || String(window.getSelection()).trim()) return
  const rect = $('viewport').getBoundingClientRect(), ratio = (event.clientX - rect.left) / rect.width
  if (ratio > .3 && ratio < .7) $('reading-menu').hidden = !$('reading-menu').hidden
  else void turn(ratio <= .3 ? -1 : 1).catch(e => message(e.message))
}
$('viewport').onkeydown = event => { if (['ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); void turn(event.key === 'ArrowRight' ? 1 : -1).catch(e => message(e.message)) } if (event.key === 'Escape') $('reading-menu').hidden = !$('reading-menu').hidden }
let resizeTimer
function resized() {
  if (window.visualViewport) $('reader').style.height = `${window.visualViewport.height}px`
  const size = `${$('viewport').clientWidth}:${$('viewport').clientHeight}`
  if (size === layoutSize) return
  cancelMotion(); const saved = state.chapter ? position() : null
  clearTimeout(resizeTimer); resizeTimer = setTimeout(() => paginate(saved), 100)
}
reducedMotion.addEventListener('change', cancelMotion)
new ResizeObserver(resized).observe($('viewport'))
window.visualViewport?.addEventListener('resize', resized)
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelMotion(); savePosition() } else void checkUpdate() })
window.addEventListener('pagehide', () => { cancelMotion(); savePosition() })
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
