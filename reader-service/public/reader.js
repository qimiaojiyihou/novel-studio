import { setupNetwork, createDirectoryCompletion } from './network.js'
const $ = id => document.getElementById(id)
const routePage=()=>location.hash==='#find'?'search':location.hash==='#sources'?'sources':'shelf'
let workspacePage=routePage(),workspaceSerial=0,libraryMode=workspacePage==='shelf'?'author':'network',readerId=''
const bookAPI = id => `/api/${libraryMode === 'network' ? 'network/' : ''}books${id ? `/${id}` : ''}`
const positionKey = id => libraryMode === 'network' ? `reader:network-position:${readerId}:${id}` : `reader:position:${id}`
const state = { book: null, chapter: null, page: 0, count: 1, stride: 0, serial: 0, tocPage: 0, tocDescending: false, pending: null }
let shelfBooks = []
const directoryJobs=createDirectoryCompletion({
  account:()=>readerId,
  read:id=>directoryRequest(id),load:id=>directoryRequest(id,true),
  onBook:book=>{
    if(libraryMode!=='network')return
    const {chapters,...summary}=book
    shelfBooks=shelfBooks.map(b=>b.id===book.id?summary:b)
    if(state.book?.id===book.id){state.book=book;if(state.chapter?.revision===book.revision){state.pending=null;$('update').hidden=true}if($('toc').open)directory()}
    const card=[...$('books').children].find(el=>el.dataset.bookId===book.id)
    if(card){card.querySelector('.book-count').textContent=bookCount(book);paintDirectoryJob(card.querySelector('.directory-job'),book)}
  },
  onChange:job=>{
    if(libraryMode!=='network')return
    const book=shelfBooks.find(b=>b.id===job.id),card=[...$('books').children].find(el=>el.dataset.bookId===job.id)
    if(book&&card)paintDirectoryJob(card.querySelector('.directory-job'),book)
    if(state.book?.id===job.id)paintTocJob()
  }
})
async function directoryRequest(id,load=false){
  const owner=readerId,verify=async()=>{const session=await api('/api/session');if(!owner||!session.authenticated||session.readerId!==owner){lock();throw Error('阅读账号已变化，请重新登录后继续补全')}}
  await verify();const book=await api(`/api/network/books/${id}${load?'/refresh':''}`,load?{}:undefined);await verify();return book
}
function bookCount(book){return `${book.network?'已加载 ':''}${book.chapterCount} 章${book.tocIncomplete?' · 目录待补全':book.network&&book.tocIncomplete===undefined?' · 可检查并补全目录':''} · ${new Date(book.updated_at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} 更新`}
function jobText(job){return job?`${{queued:'排队等待补全',running:'正在补全目录',paused:'已暂停，断点已保存',error:'补全中断，断点已保存',complete:'目录已补全'}[job.status]} · 已加载 ${job.loaded} 章${job.batches?` · 本次完成 ${job.batches} 批`:''}${job.error?`。${job.error}`:''}`:''}
function paintDirectoryJob(container,book){
  if(!container)return
  const job=directoryJobs.get(book.id),running=job&&['queued','running'].includes(job.status)
  container.querySelector('[role=status]').textContent=jobText(job)
  const control=container.querySelector('[data-complete]'),pause=container.querySelector('[data-pause]')
  control.textContent=running?'正在补全…':job?.status==='error'?'重试补全目录':job?.status==='paused'?'继续补全目录':book.tocIncomplete!==false?'一键补全目录':'刷新目录'
  control.disabled=!!running;pause.hidden=!running
}
function paintTocJob(){
  const book=state.book,job=book&&libraryMode==='network'?directoryJobs.get(book.id):null,running=job&&['queued','running'].includes(job.status)
  $('toc-completion').hidden=libraryMode!=='network'||(!book?.tocIncomplete&&!job)
  $('toc-load-status').textContent=jobText(job);$('toc-load-status').title=jobText(job);$('toc-load-status').hidden=!job
  $('toc-load-hint').hidden=libraryMode!=='network'
  $('toc-load-more').hidden=libraryMode!=='network'||(!book?.tocIncomplete&&!running&&!['paused','error'].includes(job?.status))
  $('toc-load-more').textContent=running?'正在补全…':job?.status==='error'?'重试补全目录':job?.status==='paused'?'继续补全目录':'一键补全目录'
  $('toc-load-more').disabled=!!running;$('toc-load-pause').hidden=!running
}
async function workspace(page,push=true){
  const serial=++workspaceSerial
  workspacePage=libraryMode==='network'?page:'shelf'
  $('shelf').hidden=workspacePage!=='shelf';$('discovery').hidden=workspacePage==='shelf'
  $('network-entry').hidden=libraryMode!=='network';$('network-tools').hidden=workspacePage==='shelf'
  $('source-manager').hidden=workspacePage!=='sources';$('network-search-page').hidden=workspacePage!=='search'
  if(workspacePage==='sources')$('source-manager').open=true
  $('discovery-search').setAttribute('aria-pressed',String(workspacePage==='search'));$('discovery-sources').setAttribute('aria-pressed',String(workspacePage==='sources'))
  if(push){history.pushState(null,'',workspacePage==='shelf'?location.pathname+location.search:workspacePage==='search'?'#find':'#sources');window.scrollTo(0,0)}
  if(workspacePage!=='shelf'){
    $('network-tools').setAttribute('aria-busy','true')
    try{await networkUI.loadSources()}finally{if(serial===workspaceSerial)$('network-tools').removeAttribute('aria-busy')}
  }else $('network-tools').removeAttribute('aria-busy')
}
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* reading works without storage */ } }
const defaultPreferences = { size: 20, line: '1.85', font: 'serif', theme: 'light', effect: 'slide' }
const preferences = readLocal('reader:preferences', { ...defaultPreferences })
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
    const owner=readerId,url=`${bookAPI(book.id)}/chapters/${id}`
    const promise = api(url).catch(error=>{
      // A completed metadata batch can change revision while a chapter is in
      // flight. Retry once, under the same reader and book, never replay writes.
      if(error.status===409&&libraryMode==='network'&&readerId===owner&&state.book?.id===book.id&&directoryJobs.get(book.id))return api(url)
      throw error
    }).catch(error => { if (generation === cacheGeneration) chapterCache.delete(key); throw error })
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
async function api(url, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  let result
  try { result = await response.json() } catch {
    throw new Error(response.status === 413 ? '服务器上传限制不足；书源文件上限为 10 MiB，请检查反向代理上传限制' : `阅读服务响应格式异常（HTTP ${response.status}），请稍后重试`)
  }
  if (!response.ok) {
    if (response.status === 401) lock()
    const error=Object.assign(new Error(result.error || '连接失败'),{status:response.status},result.code==='SOURCE_LOGIN_REQUIRED'?{code:result.code,sourceId:result.sourceId,loginRequired:true}:result.code==='SOURCE_CHAPTER_LOCKED'?{code:result.code,openUrl:result.openUrl}:{})
    // Only foreground reading opens login configuration. Speculative prefetch
    // must not summon dialogs while the user is reading another chapter.
    throw error
  }
  return result
}
function lock() {
  directoryJobs.reset();$('discovery').hidden=true;workspacePage='shelf';history.replaceState(null,'',location.pathname+location.search)
  cancelMotion(); savePosition(); clearChapterCache(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  shelfBooks = []; $('pages').replaceChildren(); $('books').replaceChildren(); $('toc-list').replaceChildren(); $('toc').close()
  $('toc-book').textContent = ''; $('toc-total').textContent = ''; $('toc-range').replaceChildren(); $('shelf-summary').textContent = ''
  $('toc-search').value = ''; $('toc-number').value = ''; $('toc-error').textContent = ''; $('toc-error').hidden = true; $('book-search').value = ''
  $('reading-menu').close(); $('chapter-access').close(); $('chapter-access-address').value = ''; $('reader').hidden = true; $('shelf').hidden = true; $('login').hidden = false
  readerId = ''; networkUI.reset()
}
function readingError(error){
  if(error.code==='SOURCE_CHAPTER_LOCKED'&&readerId&&libraryMode==='network'){
    const url=/^https:\/\/fanqienovel\.com\/reader\/\d+$/.test(error.openUrl)?error.openUrl:''
    $('chapter-access-address').value=url; $('chapter-access-link').hidden=!url; $('chapter-access-copy').hidden=!url
    $('chapter-access-status').textContent=''
    if(!$('chapter-access').open)$('chapter-access').showModal()
    return
  }
  message(error.message);if(error.loginRequired&&readerId&&libraryMode==='network')void networkUI.loginRequired(error).catch(e=>message(e.message))
}
function button(label, fn) { const element = document.createElement('button'); element.textContent = label; element.onclick = () => Promise.resolve(fn()).catch(readingError); return element }
function chapterLabel(chapter) {
  const title = chapter.title.replace(/^第\s*[\d一二三四五六七八九十百千万零两]+\s*章\s*/u, '').trim()
  return `第${chapter.no}章${title ? ` ${title}` : ''}`
}
async function shelf() {
  cancelMotion(); savePosition(); clearChapterCache(); state.serial++; state.book = null; state.chapter = null; state.pending = null
  const serial = state.serial
  $('pages').replaceChildren(); $('reading-menu').close(); $('reader').hidden = true
  shelfBooks = []; $('books').replaceChildren(); $('shelf-summary').textContent = '正在读取书架…'
  const session = await api('/api/session')
  if (serial !== state.serial) return
  $('login-author').hidden = session.requireLogin || libraryMode !== 'network'
  if (session.requireLogin && !session.authenticated) { lock(); return }
  if (libraryMode === 'network' && !session.authenticated) { lock(); return }
  if(readerId&&readerId!==session.readerId){directoryJobs.reset();networkUI.reset()}
  readerId = session.readerId || ''
  $('login').hidden = true; $('shelf').hidden = false; $('logout').hidden = !session.authenticated
  $('network-entry').hidden = libraryMode !== 'network'
  $('author-library').setAttribute('aria-pressed',String(libraryMode === 'author')); $('network-library').setAttribute('aria-pressed',String(libraryMode === 'network'))
  $('book-search').placeholder = libraryMode === 'network' ? '筛选收藏书名或作者' : '搜索书名或题材'
  const books = await api(bookAPI()); if (serial !== state.serial) return
  shelfBooks = books; renderShelf()
  await workspace(workspacePage,false)
}
function renderShelf() {
  const search = $('book-search').value.trim().toLocaleLowerCase()
  const books = shelfBooks.filter(b => !search || `${b.title} ${b.genre}`.toLocaleLowerCase().includes(search)).sort((a,b) => $('book-sort').value === 'title' ? a.title.localeCompare(b.title,'zh-CN') : b.updated_at.localeCompare(a.updated_at))
  $('books').replaceChildren()
  $('shelf-summary').textContent = search ? `找到 ${books.length} 本书` : `${books.length} 本书 · ${libraryMode === 'network' ? '我的网络收藏' : '稿件随作者发布更新'}`
  if (!books.length) { const p = document.createElement('p'); p.className = 'shelf-empty'; p.textContent = search ? '没有找到这本书，试试其他关键词。' : libraryMode === 'network' ? '网络书架还空着，在上方搜索并加入书籍。' : '书架还空着，作者发布后会显示在这里。'; $('books').append(p) }
  for (const book of books) {
    const item = document.createElement('article'); item.className = book.network ? 'book network-book' : 'book';item.dataset.bookId=book.id
    const saved = readLocal(positionKey(book.id), null)
    const spine = document.createElement('div'); spine.className = 'book-spine'; spine.setAttribute('aria-hidden','true')
    let hue = 0; for (const char of book.id) hue = (hue * 31 + char.charCodeAt(0)) >>> 0
    spine.dataset.palette = hue % 4
    const coverName = document.createElement('span'); coverName.textContent = book.title
    const coverMark = document.createElement('small'); coverMark.textContent = 'NOVEL / NS'; spine.append(coverName,coverMark)
    const copy = document.createElement('div'), title = document.createElement('h2'), info = document.createElement('small'), description = document.createElement('p')
    copy.className = 'book-copy'
    title.textContent = book.title; description.textContent = book.description
    const genre = document.createElement('span'); genre.className = 'book-genre'; genre.textContent = book.network ? `${book.author || '作者未提供'} · ${book.sourceName}` : book.genre || '小说'
    info.className='book-count';info.textContent=bookCount(book)
    const resume = document.createElement('span'); resume.className = 'book-resume'
    resume.textContent = saved ? (saved.chapterNo ? `上次读到第${saved.chapterNo}章` : '已保存上次阅读位置') : '从第一章开始'
    const actions = document.createElement('div'); actions.className = 'book-actions'; actions.append(resume,button(saved ? '继续阅读' : '开始阅读', () => openBook(book.id)))
    if (book.network){
      const task=document.createElement('div'),status=document.createElement('p'),complete=button('一键补全目录',()=>directoryJobs.start(shelfBooks.find(b=>b.id===book.id)||book)),pause=button('暂停补全',()=>directoryJobs.pause(book.id))
      task.className='directory-job';status.setAttribute('role','status');status.setAttribute('aria-live','polite');complete.dataset.complete='';pause.dataset.pause='';task.append(status,complete,pause);actions.append(task)
      actions.append(button('移出书架',async()=>{if(!confirm(`将「${book.title}」移出网络书架？`))return;directoryJobs.pause(book.id);await api(bookAPI(book.id),{},'DELETE');await shelf()}));paintDirectoryJob(task,book)
    }
    copy.append(genre, title, info); if (book.description.trim()) copy.append(description); copy.append(actions)
    item.append(spine, copy); $('books').append(item)
  }
}
async function openBook(id) {
  workspacePage='shelf';$('discovery').hidden=true
  cancelMotion(); clearChapterCache()
  const serial = ++state.serial, book = await api(bookAPI(id))
  if (serial !== state.serial) return
  if (!book.chapters.length) { message('此书还没有可读章节'); return }
  state.book = book; state.pending = null; $('update').hidden = true
  const position = readLocal(positionKey(id), null)
  await openChapter(book.chapters.find(c => c.id === position?.chapterId)?.id || book.chapters[0].id, position)
}
async function openChapter(id, position = null, lastPage = false, prepared = null) {
  if (!state.book) return
  cancelMotion(); savePosition()
  const serial = ++state.serial, bookId = state.book.id
  const chapter = prepared || await loadChapter(id)
  if (serial !== state.serial || state.book?.id !== bookId) return
  state.chapter = chapter; state.page = 0
  $('shelf').hidden = true; $('login').hidden = true; $('reader').hidden = false; $('reading-menu').close()
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
  preferences.theme = ['light', 'white', 'paper', 'dark'].includes(preferences.theme) ? preferences.theme : 'light'
  preferences.effect = preferences.effect === 'none' ? 'none' : 'slide'
  document.documentElement.style.setProperty('--font-size', `${preferences.size}px`)
  document.documentElement.style.setProperty('--line-height', preferences.line)
  document.documentElement.style.setProperty('--prose', preferences.font === 'serif' ? '"Songti SC","Noto Serif CJK SC","SimSun",serif' : '"PingFang SC","Microsoft YaHei",sans-serif')
  document.body.dataset.theme = preferences.theme
  $('font-size').value = preferences.size; $('line-height').value = preferences.line; $('font-family').value = preferences.font; $('theme').value = preferences.theme
  $('page-effect').value = preferences.effect
  $('font-value').value = preferences.size
  $('font-smaller').disabled = preferences.size <= 16; $('font-larger').disabled = preferences.size >= 30
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
function savePosition() { if (state.book && state.chapter) saveLocal(positionKey(state.book.id), position()) }
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
  $('chapter-progress').max = state.count - 1; $('chapter-progress').value = state.page; $('chapter-progress').disabled = state.count <= 1
  $('chapter-progress-value').value = `${state.page + 1} / ${state.count} 页`
  $('previous').disabled = chapterIndex <= 0; $('next').disabled = chapterIndex >= state.book.chapters.length - 1
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
      if (serial === state.serial) message(direction < 0 ? '已经是第一章' : state.book?.tocIncomplete?'目录尚未加载完整，请打开目录继续加载':'已读到最新发布章节')
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
  $('toc-book').textContent = state.book?.title || ''; $('toc-total').textContent = `${state.book?.chapters.length || 0} 章${state.book?.tocIncomplete?' · 目录待续载':''}`
  paintTocJob()
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
  if (!chapter) { $('toc-error').textContent = state.book?.tocIncomplete?'请输入已加载的章号，或先继续加载目录':'请输入已发布的章号'; $('toc-error').hidden = false; $('toc-number').focus(); return }
  $('toc').close(); await openChapter(chapter.id)
}
function bind(id, fn) { $(id).onclick = () => Promise.resolve(fn()).catch(readingError) }
bind('back', shelf); bind('logout', async () => { await api('/api/logout', {}); lock(); await shelf() })
function closeMenu() { $('reading-menu').close(); if (!$('reader').hidden) $('viewport').focus({ preventScroll:true }) }
function openMenu() { if (!state.chapter) return; cancelMotion(); $('reading-menu').showModal() }
bind('menu-close', closeMenu)
bind('directory', () => { closeMenu(); $('toc-number').value = ''; $('toc-error').hidden = true; $('toc-load-hint').open = false; locateCurrentChapter(); $('toc').showModal(); $('toc-list').querySelector('.current')?.scrollIntoView({block:'nearest'}) })
// Require both ends of the gesture outside: releasing a slider off-panel must
// not dismiss it, and dismissal must not turn the page underneath the dialog.
for (const id of ['reading-menu', 'toc', 'chapter-access']) {
  const dialog = $(id)
  let startedOutside = false
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom }
  dialog.addEventListener('pointerdown', event => { startedOutside = event.target === dialog && outside(event) })
  dialog.addEventListener('pointercancel', () => { startedOutside = false })
  dialog.addEventListener('click', event => { if (startedOutside && event.target === dialog && outside(event)) { event.preventDefault(); event.stopPropagation(); dialog.close() } startedOutside = false })
  dialog.addEventListener('close', () => { if (!$('reader').hidden) $('viewport').focus({ preventScroll:true }) })
}
bind('chapter-access-close',()=> $('chapter-access').close())
bind('chapter-access-copy',async()=>{
  try { await navigator.clipboard.writeText($('chapter-access-address').value); $('chapter-access-status').textContent='已复制本章原站地址，请手动打开查看。' }
  catch { $('chapter-access-address').focus(); $('chapter-access-address').select(); $('chapter-access-status').textContent='请选中上方地址手动复制。' }
})
bind('toc-close', () => $('toc').close()); bind('toc-prev', () => { state.tocPage--; directory() }); bind('toc-next', () => { state.tocPage++; directory() })
bind('toc-current', locateCurrentChapter); bind('toc-order', () => { state.tocDescending = !state.tocDescending; state.tocPage = 0; directory() }); bind('toc-go', jumpChapter)
bind('toc-load-more',()=>{if(libraryMode==='network'&&state.book)return directoryJobs.start(state.book)})
bind('toc-load-pause',()=>{if(state.book)directoryJobs.pause(state.book.id)})
$('toc-number').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void jumpChapter().catch(readingError) } }
$('toc-number').oninput = () => { $('toc-error').hidden = true }
$('toc-range').onchange = () => { state.tocPage = Number($('toc-range').value); directory() }
$('toc-search').oninput = () => { state.tocPage = 0; directory() }
$('book-search').oninput = renderShelf; $('book-sort').onchange = renderShelf
function changePreferences(values) { cancelMotion(); const saved = position(); Object.assign(preferences, values); applyPreferences(); saveLocal('reader:preferences', preferences); paginate(saved) }
for (const [control, field] of [['font-size', 'size'], ['line-height', 'line'], ['font-family', 'font'], ['theme', 'theme'], ['page-effect','effect']]) $(control).oninput = () => changePreferences({ [field]:$(control).value })
bind('font-smaller', () => changePreferences({ size:preferences.size - 1 })); bind('font-larger', () => changePreferences({ size:preferences.size + 1 }))
bind('settings-reset', () => { changePreferences(defaultPreferences); message('已恢复默认阅读设置') })
$('chapter-progress').oninput = () => { $('chapter-progress-value').value = `${Number($('chapter-progress').value) + 1} / ${state.count} 页` }
$('chapter-progress').onchange = () => { if (!state.chapter) return; cancelMotion(); state.page = Math.max(0, Math.min(state.count - 1, Number($('chapter-progress').value))); renderPage() }
for (const [control, direction] of [['previous', -1], ['next', 1]]) bind(control, () => { const index = state.book.chapters.findIndex(c => c.id === state.chapter.id) + direction; return state.book.chapters[index] ? openChapter(state.book.chapters[index].id) : message('没有更多章节') })
bind('update', async () => {
  cancelMotion(); clearChapterCache()
  const saved = position(), bookId = state.book.id, serial = ++state.serial, book = await api(bookAPI(bookId))
  if (serial !== state.serial) return
  state.book = book; state.pending = null; $('update').hidden = true
  if (book.chapters.some(c => c.id === saved.chapterId)) await openChapter(saved.chapterId, saved)
  else if (book.chapters.length) { message('原章节已下架，已进入第一章'); await openChapter(book.chapters[0].id) }
  else await shelf()
})
$('login-form').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('button'); submit.disabled = true; $('login-error').textContent = ''
  try {
    const data = new FormData(form)
    await api('/api/login', { username: data.get('username'), password: data.get('password') })
    const session = await api('/api/session')
    if (!session.authenticated) throw new Error('账号验证成功，但浏览器未保留登录状态。请在新标签页打开阅读站后登录。')
    form.reset(); await shelf()
  } catch (error) { $('login-error').textContent = error.message } finally { submit.disabled = false }
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
  if (!event.isPrimary || event.button !== 0 || turning || $('reading-menu').open || String(window.getSelection()).trim()) return
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
    if (commit) void turn(gesture.dx < 0 ? 1 : -1).catch(readingError)
    else void rebound()
  } else if (gesture.vertical) swipedAt = Date.now()
  touch = null
})
$('viewport').onclick = event => {
  if (turning || Date.now() - swipedAt < 400 || String(window.getSelection()).trim()) return
  const rect = $('viewport').getBoundingClientRect(), ratio = (event.clientX - rect.left) / rect.width
  if (ratio > .3 && ratio < .7) openMenu()
  else void turn(ratio <= .3 ? -1 : 1).catch(readingError)
}
$('viewport').onkeydown = event => { if (['ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); void turn(event.key === 'ArrowRight' ? 1 : -1).catch(readingError) } if (event.key === 'Escape') { event.preventDefault(); openMenu() } }
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
    if (libraryMode === 'network') {
      const session=await api('/api/session')
      if (serial===state.serial && (!session.authenticated || session.readerId!==readerId)) lock()
      return
    }
    const book = await api(bookAPI(bookId))
    if (state.book?.id === bookId && serial === state.serial && book.revision !== state.book.revision) { state.pending = true; $('update').hidden = false }
  } catch (error) { message(error.message); if (!state.book) return; if (/下架/.test(error.message)) await shelf().catch(e => message(e.message)) }
  finally { checking = false }
}
setInterval(() => void checkUpdate(), 30_000)
const networkUI = setupNetwork({ api, refresh:shelf, openBook, isNetwork:()=>libraryMode === 'network' })
for(const [id,page]of [['find-books','search'],['manage-sources','sources'],['discovery-search','search'],['discovery-sources','sources'],['discovery-back','shelf']])bind(id,()=>workspace(page))
window.addEventListener('popstate',()=>{workspacePage=routePage();if(workspacePage!=='shelf')libraryMode='network';void shelf().catch(readingError)})
bind('login-author',async()=>{libraryMode='author';workspacePage='shelf';networkUI.reset();await shelf()})
for (const [control,mode] of [['author-library','author'],['network-library','network']]) bind(control,async()=>{savePosition();state.book=null;state.chapter=null;workspacePage='shelf';history.replaceState(null,'',location.pathname+location.search);networkUI.reset();$('book-search').value='';libraryMode=mode;await shelf()})
applyPreferences(); void shelf().catch(error => message(error.message))
