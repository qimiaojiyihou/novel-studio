import { randomBytes } from 'node:crypto'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import {AsyncLocalStorage} from 'node:async_hooks'
import bundledSources from './default-sources.json' with { type: 'json' }
import { digest, fail, id, text } from './store.js'
import { createSourceFetcher, sourceURL, checkSourceOrigin,sourceOrigins } from './source-fetch.js'
import { normalizeSource, checkedDocument } from './source-rules.js'
import {createSourceAuth} from './source-auth.js'
import {createSourceAuthorization,sourceAuthorizationMode} from './source-authorization.js'
import {createSourceRuntime,virtualPayload} from './source-runtime.js'
import {createSourceState} from './source-state.js'
import {sourceRequest} from './source-request.js'

const importBytes = 10 * 1024 * 1024, sourceLimit = 1000
const searchTicketTtlMs = 60 * 60_000, searchTicketLimit = 10_000
export function createNetworkLibrary(db, { fetchPage = createSourceFetcher(), now = Date.now, defaultSources = bundledSources,authKey,readerOrigin=()=>'' } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS network_sources(owner TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,id TEXT NOT NULL,name TEXT NOT NULL,config TEXT NOT NULL,version TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS network_books(owner TEXT NOT NULL,id TEXT NOT NULL,source_id TEXT NOT NULL,title TEXT NOT NULL,author TEXT NOT NULL,description TEXT NOT NULL,url TEXT NOT NULL,toc_url TEXT NOT NULL,chapters TEXT NOT NULL DEFAULT '[]',revision TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,source_id) REFERENCES network_sources(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS network_source_initializations(owner TEXT PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,version TEXT NOT NULL,report TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS network_source_health(owner TEXT NOT NULL,id TEXT NOT NULL,version TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,id) REFERENCES network_sources(owner,id) ON DELETE CASCADE);`)
  const get = (sql,...args)=>db.prepare(sql).get(...args), all=(sql,...args)=>db.prepare(sql).all(...args), run=(sql,...args)=>db.prepare(sql).run(...args)
  const storageKey=authKey||randomBytes(32),auth=createSourceAuth(db,storageKey),bookState=createSourceState(db,storageKey),scope=new AsyncLocalStorage()
  const authorization=createSourceAuthorization({resolve:(owner,id)=>source(owner,id),profile:auth.profile,now})
  function authSummary(s,profile){
    let state,resetRequired=false
    try{state=profile.read()}catch(error){if(error.status!==409)throw error;state={params:{},variable:''};resetRequired=true}
    const hasCookie=resetRequired?false:!!profile.cookieJar.getCookieString(s.url),hasParams=Object.values(state.params||{}).some(Boolean)
    const saved=hasCookie||hasParams||!!state.variable,record=state.authorization||{},currentFingerprint=resetRequired?'':digest(JSON.stringify([state.params||{},profile.cookieJar.getCookieString(s.url),state.variable||'']))
    return {name:s.name,url:s.login?.url||s.url,ui:(s.login?.ui||[]).map(({action,...field})=>({...field,hasValue:!!state.params[field.name],action:!!action})),hasCookie,hasVariable:!!state.variable,resetRequired,
      authorization:{mode:sourceAuthorizationMode(s),canVerify:!!s.login?.checkScript,status:resetRequired?'reset-required':!saved?(sourceAuthorizationMode(s)==='public'?'not-required':'empty'):record.version===s.version&&record.fingerprint===currentFingerprint&&record.status==='verified'?'verified':record.version===s.version&&record.status==='expired'?'expired':'saved',savedAt:record.savedAt||null,verifiedAt:record.verifiedAt||null}}
  }
  async function verifyAuth(owner,s,profile,active){
    if(!s.login?.checkScript)return {status:'saved',message:'配置已保存；此书源没有授权检查规则，尚未确认有效性。可返回搜索并尝试读取章节。'}
    const verificationId=randomBytes(16).toString('hex')
    profile.mutate(state=>{state.authorization={...state.authorization,status:'saved',verificationId}})
    let passed
    try{passed=await guarded(owner,()=>session(s).checkLogin(),30000,active)}catch(error){
      // Never echo script/HTTP errors: a provider may include a private token.
      return {status:'unverified',message:error.status===401||error.status===403?'原站拒绝授权，请重新登录或领取密钥。':'本次验证未完成，已存配置保留。请稍后重试。'}
    }
    active();profile.mutate(state=>{if(state.authorization?.verificationId!==verificationId)fail(409,'登录配置已变化，请重新验证');state.authorization={...state.authorization,status:passed?'verified':'expired',version:s.version,verifiedAt:now(),fingerprint:digest(JSON.stringify([state.params||{},profile.cookieJar.getCookieString(s.url),state.variable||'']))}})
    return {status:passed?'verified':'expired',message:passed?'授权验证通过，已自动保存，可继续搜索阅读。':'授权未通过或已过期，请重新登录或领取密钥。'}
  }
  function session(s){const state=scope.getStore();if(!state)fail(500,'书源运行上下文缺失');if(!state.sessions.has(s.id)){const active=()=>{state.active();state.signal.throwIfAborted();if(source(state.owner,s.id,true).version!==s.version)fail(409,'书源已变化，请重试')};state.sessions.set(s.id,createSourceRuntime(s,{fetchPage,profile:auth.profile(state.owner,s,active),signal:state.signal,active}))}return state.sessions.get(s.id)}
  const ruleText=(ctx,rule)=>session(ctx.runtimeSource).text(ctx,rule),ruleList=(ctx,rule)=>session(ctx.runtimeSource).list(ctx,rule),contentText=(ctx,rules)=>session(ctx.runtimeSource).content(ctx,rules),infoContext=(ctx,rules)=>session(ctx.runtimeSource).info(ctx,rules)
  const tickets = new Map(), inFlight = new Map(), limits = new Map(), checking = new Set(); let total = 0
  function initializeDefaults(owner, upgrade=false) {
    const previous=get('SELECT version FROM network_source_initializations WHERE owner=?',owner)
    if (!defaultSources || previous&&(previous.version===defaultSources.version||!upgrade&&!defaultSources.applyToExisting)) return
    const addedIds=previous?(defaultSources.restoreMissing?defaultSources.sources.map(s=>s.id):defaultSources.upgradeFrom?.[previous.version]||(previous.version===defaultSources.previousVersion?defaultSources.addedSourceIds:null)):null
    if(previous && !addedIds) fail(409,'默认包版本不匹配，请通过 JSON 导入更新')
    // Only normalized rules and allowlisted non-credential headers are bundled.
    // One transaction includes the marker: refresh/restart never restores deletions.
    db.exec('BEGIN IMMEDIATE')
    try {
      let imported=0,existing=0,updated=0,count=get('SELECT COUNT(*) AS n FROM network_sources WHERE owner=?',owner).n
      const rejected=[...defaultSources.rejected]
      for (const s of defaultSources.sources) {
        const row=get('SELECT version FROM network_sources WHERE owner=? AND id=?',owner,s.id)
        if(row){existing++;if(row.version!==s.version&&defaultSources.managedSourceVersions?.[s.id]?.includes(row.version)){run('UPDATE network_sources SET name=?,config=?,version=? WHERE owner=? AND id=?',s.name,JSON.stringify(s),s.version,owner,s.id);updated++}continue}
        // An explicit upgrade adds newly supported IDs only, never old deletions.
        if(previous && !addedIds.includes(s.id)) continue
        if(count>=sourceLimit) {rejected.push({name:s.name,reason:'账号书源数量已达 1000 个'});continue}
        run('INSERT INTO network_sources VALUES(?,?,?,?,?,1)',owner,s.id,s.name,JSON.stringify(s),s.version);imported++;count++
      }
      run('INSERT INTO network_source_initializations VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET version=excluded.version,report=excluded.report',owner,defaultSources.version,JSON.stringify({name:defaultSources.name,total:defaultSources.total,imported,existing,updated,rejected,unavailable:defaultSources.unavailable||[],requiresConfiguration:defaultSources.sources.filter(s=>s.login?.required).map(s=>({id:s.id,name:s.name})),duplicates:defaultSources.duplicates||[]}))
      db.exec('COMMIT')
    } catch(error) {db.exec('ROLLBACK');throw error}
  }
  function source(owner,sourceId,allowDisabled=false) {
    const row = get('SELECT * FROM network_sources WHERE owner=? AND id=?',owner,id(sourceId))
    if (!row) fail(404,'书源不存在'); if (!row.enabled && !allowDisabled) fail(409,'此书源已停用')
    const config=JSON.parse(row.config)
    if(config.unsupported&&!allowDisabled)throw Object.assign(new Error('此书源已登记，规则待兼容：'+config.unsupported.reason),{status:422,code:'RULE_UNSUPPORTED',capability:'catalog',phase:'compatibility'})
    return config
  }
  function book(owner,bookId) {
    const row=get('SELECT b.*,s.name AS sourceName FROM network_books b JOIN network_sources s ON s.owner=b.owner AND s.id=b.source_id WHERE b.owner=? AND b.id=?',owner,id(bookId))
    if(!row) fail(404,'网络书籍不存在')
    return {...row,chapters:JSON.parse(row.chapters)}
  }
  function present(row) { const {owner,url,toc_url,source_id,...rest}=row,s=source(owner,source_id,true),toc=bookState.read(owner,row.id,s.version).toc;return {...rest,genre:row.author || '网络小说',chapterCount:row.chapters.length,network:true,tocIncomplete:!!toc?.pending?.length,tocPagesLoaded:toc?.pages||0} }
  function link(value,base,source) {
    value=String(value).trim()
    if(virtualPayload(value,source)!==null)return value
    if(/[\r\n]/.test(value))fail(422,'链接规则返回多个地址，请核对列表及链接选择器')
    const parsed=sourceRequest(value,source,base)
    if(Object.keys(parsed.credentials).length)throw Object.assign(new Error('章节链接含私有请求头，请将登录信息放入账号登录配置或动态请求头，不存入收藏链接'),{status:422,code:'SOURCE_CREDENTIAL_LINK',phase:'parse'})
    return parsed.link
  }
  async function page(url,source,signal) { return session(source).load(url) }
  async function searchRows(loaded,s){
    const context=session(s).checkDocument(loaded.text,{baseUrl:loaded.url,sourceUrl:s.url,runtimeSource:s},loaded.credentialVersion),rows=await ruleList(context,s.rules.ruleSearch.bookList)
    if(!rows.length&&loaded.resourceError)throw loaded.resourceError
    if(rows.length||!s.search.directBookResult)return {rows,rules:s.rules.ruleSearch}
    // Exact-match search on some sites redirects straight to a detail page.
    // Require both a real book name and a chapter list before accepting it.
    const detail=await infoContext(context,s.rules.ruleBookInfo)
    if(await ruleText(detail,s.rules.ruleBookInfo.name)&&(await ruleList(detail,s.rules.ruleToc.chapterList)).length)return {rows:[{...detail,directBookURL:loaded.url}],rules:s.rules.ruleBookInfo}
    return {rows:[],rules:s.rules.ruleSearch}
  }
  function selectedIds(input,max=sourceLimit) {
    if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>max) fail(400,`请选择 1–${max} 个书源`)
    return [...new Set(input.ids.map(value=>id(value)))]
  }
  async function checkSource(owner,s,key,signal,active,exactTitle=false) {
    const lock=`${owner}:${s.id}`
    if(checking.has(lock)) return {id:s.id,skipped:true,message:'此书源正在检测'}
    checking.add(lock)
    const started=now(),matches={};let stage='search',result
    try {
      if(s.unsupported)throw Object.assign(new Error(s.unsupported.reason),{status:422,code:'RULE_UNSUPPORTED',phase:'compatibility'})
      const loaded=await session(s).search(key,1),parsed=await searchRows(loaded,s),rules=parsed.rules,items=parsed.rows.slice(0,50);matches.search=items.length
      let bookURL
      const titleKey=value=>value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'')
      for(const item of items){const name=await ruleText(item,rules.name),href=item.directBookURL||await ruleText(item,rules.bookUrl);if(name&&href&&(!exactTitle||titleKey(name)===titleKey(key))){bookURL=link(href,loaded.url,s);matches.bookTitle=name.slice(0,200);session(s).setBook({bookUrl:bookURL,name,author:await ruleText(item,rules.author)},{book:session(s).rowValues(item),chapters:{}});break}}
      if(!bookURL) result=exactTitle&&items.length?{status:'empty',code:'SEARCH_TITLE_NOT_FOUND',message:'搜索返回条目中未找到指定书名；不代表书源失效，未用其他书籍代替检测'}:{status:items.length?'review':'empty',code:items.length?'SEARCH_FIELDS_EMPTY':'SEARCH_EMPTY',message:items.length?'搜索列表有条目，但书名或链接为空；请核对字段规则':'搜索未匹配条目：可换书名重测，也可能是规则变化；本次未判定书源失效'}
      else {
        active();stage='info'
        const info=await page(bookURL,s,signal),ctx=await infoContext(info.context,s.rules.ruleBookInfo),tocURL=link((await ruleText(ctx,s.rules.ruleBookInfo.tocUrl)).split('\n').find(s=>s.trim())||info.url,info.url,s)
        stage='toc'
        const toc=tocURL===info.url?info:await page(tocURL,s,signal)
        let chapterURL
        const chapters=(await ruleList(toc.context,s.rules.ruleToc.chapterList)).slice(0,5000);matches.toc=chapters.length
        let sample=chapters
        if(s.preferNewerDuplicateChapter&&chapters.length){const title=await ruleText(chapters[0],s.rules.ruleToc.chapterName);let selected=chapters[0];for(const item of chapters.slice(1,10)){if(await ruleText(item,s.rules.ruleToc.chapterName)!==title)break;selected=item}sample=[selected]}
        for(const item of sample) {if(await ruleText(item,s.rules.ruleToc.isVolume)==='true')continue;const name=await ruleText(item,s.rules.ruleToc.chapterName),href=await ruleText(item,s.rules.ruleToc.chapterUrl);if(name&&href){chapterURL=link(href,toc.url,s);const chapterId=digest(chapterURL).slice(0,32);session(s).setChapterValues(chapterId,session(s).rowValues(item));session(s).setChapter(chapterId,name);break}}
        if(!chapterURL) result={status:'review',code:chapters.length?'TOC_FIELDS_EMPTY':'TOC_EMPTY',message:'已找到书籍，但未解析出目录；请核对目录规则或网站状态'}
        else {
          active();stage='content'
          const chapter=await page(chapterURL,s,signal),body=await contentText(chapter.context,s.rules.ruleContent)
          matches.contentCharacters=body.length
          result=body?{status:'healthy',message:'搜索、目录及首章正文抽样通过（不代表全站所有章节）'}:{status:'review',code:'CONTENT_EMPTY',message:'已解析目录，但首章正文为空；请核对正文规则或网站状态'}
        }
      }
    } catch(error) {
      if(error.status===401) throw error
      const code=error.httpStatus
      result={status:error.code==='RULE_UNSUPPORTED'?'unsupported':[401,403,429].includes(code)||['VERIFICATION_PAGE','LOGIN_PAGE','SOURCE_LOGIN_REQUIRED','BROWSER_VERIFICATION_REQUIRED','RATE_COOLDOWN'].includes(error.code)?'restricted':[404,410].includes(code)?'suspect':[400,422].includes(error.status)?'review':'unreachable',message:error.status?error.message.slice(0,240):'连接失败或超时，请稍后重测',...(code?{httpStatus:code}:{})}
      for(const field of ['code','phase','pageType','targetOrigin','retryAfterSeconds','capability'])if(error[field]!==undefined)result[field]=error[field]
    } finally {checking.delete(lock)}
    active()
    // Do not resurrect deleted sources or attach an old result to reimported rules.
    if(get('SELECT version FROM network_sources WHERE owner=? AND id=?',owner,s.id)?.version!==s.version) return {id:s.id,skipped:true,message:'书源已删除或规则已变化，本次结果已丢弃'}
    result={...result,stage,matches,checkedAt:new Date(now()).toISOString(),durationMs:Math.max(0,now()-started)}
    run('INSERT INTO network_source_health VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET version=excluded.version,result=excluded.result',owner,s.id,s.version,JSON.stringify(result))
    return {id:s.id,...result}
  }
  async function directory(row,s,signal) {
    session(s).setBook({bookUrl:row.url||row.toc_url,name:row.title||'',author:row.author||''})
    const prior=session(s).tocState(),chapters=(row.chapters||[]).map(c=>({...c})),seenPages=new Set(prior?.seen||[]),seenChapters=new Map(chapters.map((c,i)=>[c.url,i])),numberedTitles=new Map(chapters.map((c,i)=>[c.title,i])),pending=prior?.pending?.length?[...prior.pending]:[row.toc_url],queued=new Set([...seenPages,...pending]);let matched=0,loadedPages=0,totalPages=prior?.pending?.length?prior.pages:0
    while(pending.length&&loadedPages<5) {
      const url=pending.shift()
      if(seenPages.has(url))continue
      if(totalPages>=100) fail(422,'目录超过 100 页，已加载目录保持不变')
      signal.throwIfAborted()
      seenPages.add(url); const loaded=await page(url,s,signal), rules=s.rules.ruleToc;loadedPages++;totalPages++
      seenPages.add(loaded.url)
      for(const item of await ruleList(loaded.context,rules.chapterList)) {
        matched++
        if(await ruleText(item,rules.isVolume)==='true')continue
        const title=await ruleText(item,rules.chapterName), href=await ruleText(item,rules.chapterUrl)
        if(!title || !href) continue
        const chapterUrl=link(href,loaded.url,s)
        if(seenChapters.has(chapterUrl)){chapters[seenChapters.get(chapterUrl)].title=title.slice(0,300);continue}
        if(s.preferNewerDuplicateChapter&&/^第\s*\d+\s*章/.test(title)&&numberedTitles.has(title)){
          const index=numberedTitles.get(title),previous=chapters[index],a=new URL(previous.url),b=new URL(chapterUrl),oldId=a.pathname.match(/\/([0-9]{1,18})\.html$/),newId=b.pathname.match(/\/([0-9]{1,18})\.html$/)
          if(oldId&&newId&&a.origin===b.origin&&a.pathname.slice(0,-oldId[0].length)===b.pathname.slice(0,-newId[0].length)){
            if(BigInt(newId[1])>BigInt(oldId[1]))previous.url=chapterUrl
            seenChapters.set(chapterUrl,index);continue
          }
        }
        const chapterId=digest(chapterUrl).slice(0,32)
        session(s).setChapterValues(chapterId,session(s).rowValues(item))
        seenChapters.set(chapterUrl,chapters.length);numberedTitles.set(title,chapters.length); chapters.push({id:chapterId,no:chapters.length+1,title:title.slice(0,300),url:chapterUrl,hash:''})
        if(chapters.length>5000) fail(422,'目录超过 5000 章，旧目录保持不变')
      }
      // Select elements may return every page, including the current/previous one.
      // Visit each URL once instead of treating joined URLs as a single address.
      for(const next of (await ruleText(loaded.context,rules.nextTocUrl)).split('\n').map(s=>s.trim()).filter(Boolean)) {
        const target=link(next,loaded.url,s)
        if(!queued.has(target)&&!seenPages.has(target)){queued.add(target);pending.push(target)}
        if(totalPages+pending.length>100||queued.size>200)fail(422,'目录超过 100 页或分页别名过多，旧目录保持不变')
      }
    }
    if(!chapters.length||!matched) fail(422,`书源未解析出章节（目录元素 ${matched} 个）；请检查目录、章节名和链接规则，或网站是否返回验证页`)
    session(s).setTocState(pending.length?{pending,seen:[...seenPages],pages:totalPages}:null)
    return chapters
  }
  function assertSource(owner,s) { if(source(owner,s.id).version!==s.version) fail(409,'书源已变化，请重新操作') }
  function assertFreshState(owner,b,s){if(bookState.isStale(owner,b.id,s.version))fail(409,'书源规则已变化，请在该书源重新搜索此书并加入书架，以重建规则变量；原收藏和阅读进度保留')}
  function saveState(owner,b,s,base,write=()=>{}){
    db.exec('BEGIN IMMEDIATE')
    try{assertSource(owner,s);const current=get('SELECT revision,source_id FROM network_books WHERE owner=? AND id=?',owner,b.id);if(!current||current.source_id!==s.id||current.revision!==b.revision)fail(409,'书籍已移除或目录已变化，请重新打开');write();bookState.save(owner,b.id,s.version,base,session(s).state());db.exec('COMMIT')}
    catch(error){db.exec('ROLLBACK');throw error}
  }
  async function guarded(owner,fn,timeoutMs=30_000,active=()=>{}) {
    const time=now(); for(const [key,value] of limits) if(value.until<=time) limits.delete(key)
    for(const key of ['global',`owner:${owner}`]) { const limit=limits.get(key)||{count:0,until:time+60_000}; if(++limit.count>(key==='global'?240:60)) fail(429,'网络书架请求频繁，请稍后重试'); limits.set(key,limit) }
    if(total>=8 || (inFlight.get(owner)||0)>=3) fail(429,'书源请求进行中，请稍后再试')
    total++;inFlight.set(owner,(inFlight.get(owner)||0)+1)
    const signal=AbortSignal.timeout(timeoutMs)
    try { return await scope.run({owner,signal,active,sessions:new Map()},()=>fn(signal)) } finally {total--;const count=inFlight.get(owner)-1;if(count) inFlight.set(owner,count);else inFlight.delete(owner)}
  }
  async function handle(owner,route,method,input,active=()=>{}) {
    active()
    initializeDefaults(owner)
    if(route==='/sources/defaults' && method==='GET') {
      const row=get('SELECT report FROM network_source_initializations WHERE owner=?',owner)
      return row?{...JSON.parse(row.report),updateAvailable:!!defaultSources&&get('SELECT version FROM network_source_initializations WHERE owner=?',owner).version!==defaultSources.version}:null
    }
    if(route==='/sources/defaults/update' && method==='POST') {initializeDefaults(owner,true);return {saved:true}}
    if(route==='/sources' && method==='GET') return all('SELECT s.*,h.result,h.version AS health_version FROM network_sources s LEFT JOIN network_source_health h ON h.owner=s.owner AND h.id=s.id WHERE s.owner=? ORDER BY s.name',owner).map(s=>{const config=JSON.parse(s.config);return {id:s.id,name:s.name,enabled:!!s.enabled,url:config.url,warnings:config.warnings,compatibility:config.unsupported||null,authorization:{mode:sourceAuthorizationMode(config),required:config.login?.required===true},health:s.result?{...JSON.parse(s.result),stale:s.health_version!==s.version}:null}})
    if(route==='/sources/delete' && method==='POST') {
      const ids=selectedIds(input),removed=[],skipped=[]
      db.exec('BEGIN IMMEDIATE')
      try {
        for(const sourceId of ids) {
          if(!get('SELECT id FROM network_sources WHERE owner=? AND id=?',owner,sourceId)) {skipped.push({id:sourceId,message:'书源不存在或已删除'});continue}
          if(get('SELECT id FROM network_books WHERE owner=? AND source_id=?',owner,sourceId)) {skipped.push({id:sourceId,message:'已有收藏，已保护；可先停用书源'});continue}
          run('DELETE FROM network_sources WHERE owner=? AND id=?',owner,sourceId);removed.push(sourceId)
        }
        db.exec('COMMIT')
      }catch(error){db.exec('ROLLBACK');throw error}
      return {removed,skipped}
    }
    if(route==='/books' && method==='GET') return all('SELECT b.id,b.title,b.author,b.description,b.author AS genre,b.revision,b.updated_at,s.name AS sourceName,json_array_length(b.chapters) AS chapterCount FROM network_books b JOIN network_sources s ON s.owner=b.owner AND s.id=b.source_id WHERE b.owner=? ORDER BY b.updated_at DESC',owner).map(b=>({...b,network:true}))
    const originMatch=route.match(/^\/sources\/([a-f0-9]{32})\/origins$/)
    if(originMatch&&method==='PUT'){
      const s=source(owner,originMatch[1],true),health=get('SELECT result,version FROM network_source_health WHERE owner=? AND id=?',owner,s.id),origin=sourceOrigins([input.origin])[0]
      const diagnostic=health?JSON.parse(health.result):null
      if(s.unsupported||health?.version!==s.version||diagnostic?.code!=='ORIGIN_BLOCKED'||diagnostic.targetOrigin!==origin)fail(409,'跳转检测已过期或与此域名不匹配，请重新检测书源')
      if(!Number.isFinite(Date.parse(diagnostic.checkedAt))||now()-Date.parse(diagnostic.checkedAt)>24*60*60*1000)fail(409,'跳转检测已超过一天，请重新检测书源')
      if(s.url.startsWith('https:')&&!origin.startsWith('https:'))fail(400,'HTTPS 书源保持加密连接，请使用原站 HTTPS 入口')
      s.allowedOrigins=sourceOrigins([...new Set([...(s.allowedOrigins||[]),origin])]);s.version=digest(JSON.stringify({...s,version:undefined}))
      active();run('UPDATE network_sources SET config=?,version=? WHERE owner=? AND id=?',JSON.stringify(s),s.version,owner,s.id)
      return {saved:true,origin}
    }
    let match=route.match(/^\/sources\/([\w-]+)\/auth(?:\/(action|begin|flow|callback|verify))?$/)
    if(match){
      const s=source(owner,match[1],true),profile=auth.profile(owner,s,()=>{active();if(source(owner,s.id,true).version!==s.version)fail(409,'书源已变化，请重试')})
      if(method==='GET'&&!match[2])return authSummary(s,profile)
      if(method==='DELETE'&&!match[2]){authorization.cancel(owner,s);profile.reset();return {removed:true}}
      if(method==='PUT'&&!match[2]){authorization.cancel(owner,s);profile.save({params:input.params,cookie:input.cookie,clearCookie:input.clearCookie,savedAt:now()});return {saved:true,...await verifyAuth(owner,s,profile,active)}}
      if(method==='POST'&&match[2]==='begin')return authorization.begin(owner,source(owner,s.id),readerOrigin(),active)
      if(method==='POST'&&match[2]==='flow')return authorization.status(owner,s,input.flowId)
      if(method==='DELETE'&&match[2]==='flow'){id(input.flowId);return authorization.cancel(owner,s,input.flowId)}
      if(method==='POST'&&match[2]==='callback'){const result=authorization.complete(owner,s,input,active);try{return {...result,...(!result.replayed?await verifyAuth(owner,s,profile,active):{})}}finally{if(!result.replayed)authorization.finish(owner,s,input.flowId)}}
      if(method==='POST'&&match[2]==='verify')return verifyAuth(owner,s,profile,active)
      if(method==='POST'&&match[2]==='action'){const action=s.login?.ui?.[Number(input.index)];if(!action?.action)fail(400,'登录操作不存在');return guarded(owner,async()=>{try{return {saved:true,...await session(s).action(action.action)}}catch(error){if(error.code==='BROWSER_VERIFICATION_REQUIRED')return {openUrl:error.openUrl,message:'请在原站完成操作。此书源尚未声明自动回传，取得密钥后只需保存一次。'};throw error}},30000,active)}
      fail(405,'登录配置操作不匹配')
    }
    match=route.match(/^\/sources\/([\w-]+)$/)
    if(match && method==='PUT') { if(typeof input.enabled!=='boolean') fail(400,'启用状态无效');if(!get('SELECT id FROM network_sources WHERE owner=? AND id=?',owner,match[1])) fail(404,'书源不存在');run('UPDATE network_sources SET enabled=? WHERE owner=? AND id=?',+input.enabled,owner,match[1]);return {saved:true} }
    if(match && method==='DELETE') { if(get('SELECT id FROM network_books WHERE owner=? AND source_id=?',owner,match[1])) fail(409,'请先移除此书源下的收藏，或选择停用书源');run('DELETE FROM network_sources WHERE owner=? AND id=?',owner,match[1]);return {removed:true} }
    match=route.match(/^\/books\/([\w-]+)$/)
    if(match && method==='DELETE') {run('DELETE FROM network_books WHERE owner=? AND id=?',owner,match[1]);return {removed:true}}
    return guarded(owner,async signal=>{
      if(route==='/sources/check' && method==='POST') {
        const sources=selectedIds(input,2).map(sourceId=>source(owner,sourceId,true)),key=text(input.key,100,'检测书名或作者').trim()
        if(!key) fail(400,'请填写检测书名或作者')
        // Two sources per request, existing account/global rate and concurrency
        // limits, independent DNS/connect/read budgets per request, and a
        // 40-second total sample cap below the reverse proxy's 45-second limit.
        if(input.exactTitle!==undefined&&typeof input.exactTitle!=='boolean')fail(400,'精确书名选项应为布尔值')
        const results=await Promise.all(sources.map(s=>checkSource(owner,s,key,signal,active,input.exactTitle===true)))
        active();return {results}
      }
      if(route==='/sources/import' && method==='POST') {
        let data=input.sources
        if(input.url) data=(await fetchPage(sourceURL(text(input.url,2048,'导入地址')).href,{signal,maxBytes:importBytes})).text
        if(Buffer.byteLength(typeof data==='string'?data:JSON.stringify(data) || '')>importBytes) fail(413,'书源导入内容超过 10 MiB，请拆分文件后导入')
        try {if(typeof data==='string') data=JSON.parse(data.replace(/^\uFEFF/,''))} catch {fail(400,'导入内容不是有效 JSON')}
        const entries=Array.isArray(data)?data:[data]
        if(!entries.length || entries.length>sourceLimit) fail(400,'每次导入 1–1000 个书源；大文件请分成多个书源包')
        const accepted=[],rejected=[]; active()
        for(let index=0;index<entries.length;index++) {
          if(index%50===0) {await yieldTurn();active();signal.throwIfAborted()}
          try {
            const s=normalizeSource(entries[index]),previous=get('SELECT id FROM network_sources WHERE owner=? AND id=?',owner,s.id)
            if(!previous && get('SELECT COUNT(*) AS n FROM network_sources WHERE owner=?',owner).n>=sourceLimit) fail(400,'每个账号最多保存 1000 个书源')
            // Reimport updates rules, not the user's enable/disable preference.
            db.exec('BEGIN IMMEDIATE')
            try{run('INSERT INTO network_sources VALUES(?,?,?,?,?,1) ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,config=excluded.config,version=excluded.version',owner,s.id,s.name,JSON.stringify(s),s.version)
              if(s.importCookie)auth.profile(owner,s,active).importCookie(s.importCookie)
              db.exec('COMMIT')
            }catch(error){db.exec('ROLLBACK');throw error}
            accepted.push({name:s.name,id:s.id,updated:!!previous,warnings:s.warnings})
          } catch(error) {rejected.push({index:index+1,name:String(entries[index]?.bookSourceName||'未命名').slice(0,100),reason:error.status?error.message:'书源解析失败',code:error.code||'SOURCE_INVALID',...(error.capability?{capability:error.capability}:{}),...(error.field?{field:error.field}:{})})}
        }
        return {accepted,rejected}
      }
      if(route==='/search' && method==='POST') {
        const key=text(input.key,100,'书名或作者').trim(),pageNo=Number(input.page||1)
        if(!Number.isSafeInteger(pageNo)||pageNo<1||pageNo>100) fail(400,'搜索页码无效')
        const offset=Number(input.sourceOffset||0)
        if(!Number.isSafeInteger(offset)||offset<0||offset>sourceLimit) fail(400,'书源进度无效')
        const enabled=all('SELECT id FROM network_sources WHERE owner=? AND enabled=1 ORDER BY name,id',owner).map(s=>s.id)
        const explicit=!!input.sourceId||input.sourceIds!==undefined
        const ids=input.sourceId?[input.sourceId]:input.sourceIds!==undefined?selectedIds({ids:input.sourceIds},2):enabled.slice(offset,offset+2)
        if(!ids.length) fail(400,'请先导入并启用书源')
        for(const [key,ticket] of tickets) if(ticket.expires<=now()) tickets.delete(key)
        const results=[],errors=[]
        // Sequential per query and globally bounded; a bad source cannot fan out.
        for(const sourceId of ids) {
          try {
            const s=source(owner,sourceId),loaded=await session(s).search(key,pageNo),parsed=await searchRows(loaded,s),rules=parsed.rules
            const seen=new Set()
            for(const item of parsed.rows.slice(0,50)) {
              const title=await ruleText(item,rules.name),href=item.directBookURL||await ruleText(item,rules.bookUrl);if(!title||!href) continue
              const url=link(href,loaded.url,s);if(seen.has(url)) continue;seen.add(url)
              const result={title:title.slice(0,200),author:(await ruleText(item,rules.author)).slice(0,200),description:(await ruleText(item,rules.intro)).slice(0,3000),sourceName:s.name,sourceId:s.id,url}
              const token=randomBytes(20).toString('hex');tickets.set(token,{owner,s,result,values:session(s).rowValues(item),expires:now()+searchTicketTtlMs});while(tickets.size>searchTicketLimit) tickets.delete(tickets.keys().next().value)
              results.push({...result,ticket:token})
            }
          } catch(error) {const issue={sourceId,message:error.status?error.message:'书源请求失败'};for(const field of ['code','capability','httpStatus','targetOrigin','retryAfterSeconds','phase','loginRequired'])if(error[field]!==undefined)issue[field]=error[field];errors.push(issue)}
        }
        active();return {results,errors,page:pageNo,checkedSources:ids.length,totalSources:explicit?ids.length:enabled.length,nextSourceOffset:!explicit&&offset+ids.length<enabled.length?offset+ids.length:null}
      }
      if(route==='/books' && method==='POST') {
        const ticket=tickets.get(text(input.ticket,100,'搜索结果'))
        if(!ticket||ticket.owner!==owner||ticket.expires<=now()) fail(409,'搜索结果已失效，请重新搜索')
        const {s,result}=ticket;assertSource(owner,s)
        const bookId=`net-${digest(`${owner}\0${s.id}\0${result.url}`).slice(0,32)}`
        const existing=get('SELECT revision FROM network_books WHERE owner=? AND id=?',owner,bookId)
        if(existing&&!bookState.isStale(owner,bookId,s.version)) return present(book(owner,bookId))
        if(!existing&&get('SELECT COUNT(*) AS n FROM network_books WHERE owner=?',owner).n>=300) fail(400,'网络书架最多收藏 300 本')
        let stage='读取详情'
        try {
        session(s).setBook({bookUrl:result.url,name:result.title,author:result.author},{book:ticket.values||{},chapters:{}})
        const info=await page(result.url,s,signal),rules=s.rules.ruleBookInfo,ctx=await infoContext(info.context,rules)
        const title=((await ruleText(ctx,rules.name))||result.title).slice(0,200),author=((await ruleText(ctx,rules.author))||result.author).slice(0,200),description=((await ruleText(ctx,rules.intro))||result.description).slice(0,5000)
        stage='解析目录'
        const tocURL=link((await ruleText(ctx,rules.tocUrl)).split('\n').find(s=>s.trim())||info.url,info.url,s),chapters=await directory({toc_url:tocURL,url:result.url,title,author},s,signal)
        active();assertSource(owner,s)
        if(!get('SELECT id FROM network_books WHERE owner=? AND id=?',owner,bookId) && get('SELECT COUNT(*) AS n FROM network_books WHERE owner=?',owner).n>=300) fail(400,'网络书架最多收藏 300 本')
        db.exec('BEGIN IMMEDIATE')
        try{
          let changed
          if(existing){changed=run('UPDATE network_books SET title=?,author=?,description=?,toc_url=?,chapters=?,revision=?,updated_at=? WHERE owner=? AND id=? AND revision=?',title,author,description,tocURL,JSON.stringify(chapters),digest(JSON.stringify(chapters)),new Date(now()).toISOString(),owner,bookId,existing.revision).changes;if(!changed)fail(409,'收藏或目录已变化，请重试')}
          else changed=run('INSERT OR IGNORE INTO network_books(owner,id,source_id,title,author,description,url,toc_url,chapters,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',owner,bookId,s.id,title,author,description,result.url,tocURL,JSON.stringify(chapters),digest(JSON.stringify(chapters)),new Date(now()).toISOString()).changes
          if(changed)bookState.save(owner,bookId,s.version,bookState.empty(),session(s).state());db.exec('COMMIT')
        }catch(error){db.exec('ROLLBACK');throw error}
        return present(book(owner,bookId))
        }catch(error){
          if([401,403,409].includes(error.status))throw error
          throw Object.assign(new Error(`「${s.name}」${stage}失败：${error.status?error.message:'请求超时或连接中断，请稍后重试'}`),{status:error.status||502,...Object.fromEntries(['code','httpStatus','phase','targetOrigin','retryAfterSeconds'].filter(k=>error[k]!==undefined).map(k=>[k,error[k]])),...(error.loginRequired?{loginRequired:true,sourceId:s.id}:{})})
        }
      }
      match=route.match(/^\/books\/([\w-]+)(\/refresh)?$/)
      if(match && (method==='GET'||(method==='POST'&&match[2]))) {
        const b=book(owner,match[1])
        if(match[2]) { const s=source(owner,b.source_id);assertFreshState(owner,b,s);const base=bookState.read(owner,b.id,s.version);session(s).setBook({bookUrl:b.url,name:b.title,author:b.author},base);const chapters=await directory(b,s,signal);active();saveState(owner,b,s,base,()=>run('UPDATE network_books SET chapters=?,revision=?,updated_at=? WHERE owner=? AND id=?',JSON.stringify(chapters),digest(JSON.stringify(chapters)),new Date(now()).toISOString(),owner,b.id)) }
        return present(book(owner,b.id))
      }
      match=route.match(/^\/books\/([\w-]+)\/chapters\/([\w-]+)$/)
      if(match&&method==='GET') {
        const b=book(owner,match[1]),s=source(owner,b.source_id),chapter=b.chapters.find(c=>c.id===match[2]);if(!chapter) fail(404,'章节不属于此书')
        assertFreshState(owner,b,s)
        const base=bookState.read(owner,b.id,s.version)
        session(s).setBook({bookUrl:b.url,name:b.title,author:b.author},base);session(s).setChapter(chapter.id,chapter.title)
        const parts=[],seen=new Set();let url=chapter.url
        for(let n=0;url;n++) {
          if(n>=5||seen.has(url)) fail(422,'正文分页超限或循环')
          seen.add(url);const loaded=await page(url,s,signal)
          let body
          try{body=await contentText(loaded.context,s.rules.ruleContent)}catch(error){
            // A credential-free official chapter URL only; never expose imported
            // request options, private query parameters or arbitrary error URLs.
            if(error.code==='SOURCE_CHAPTER_LOCKED'&&/^https:\/\/fanqienovel\.com\/reader\/\d+$/.test(url))error.openUrl=url
            throw error
          }
          if(!body) fail(422,'书源未返回正文，请检查规则或网站状态')
          parts.push(body);if(parts.join('\n').length>200_000) fail(413,'章节内容过长')
          const next=await ruleText(loaded.context,s.rules.ruleContent.nextContentUrl);url=next?link(next,loaded.url,s):''
          if(url&&b.chapters.some(c=>c.id!==chapter.id&&c.url===url)) url=''
        }
        active();saveState(owner,b,s,base);const body=parts.join('\n\n');return {id:chapter.id,no:chapter.no,title:chapter.title,body,hash:digest(body),revision:b.revision}
      }
      fail(404,'网络书架接口不存在')
    },route==='/sources/check'?40_000:30_000,active)
  }
  // This release is explicitly a global catalog upgrade. Future logins/new
  // accounts follow the same idempotent marker; deletions stay deleted after it.
  if(defaultSources?.applyToExisting)for(const account of all('SELECT username FROM accounts'))initializeDefaults(account.username)
  return {handle,initializeAccount:initializeDefaults}
}
