import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import raw from '../reader-service/biquge-tw-source.json' with {type:'json'}
import catalog from '../reader-service/default-sources.json' with {type:'json'}
import {catalogBeforeBiqugeTW} from './fixtures/reader-catalog-history.js'
import {normalizeSource,document,ruleList,ruleText,contentText,searchRequest} from '../reader-service/source-rules.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'

const source=normalizeSource(raw)
test('Biquge TW default is additive with exact prior catalog digest and cumulative upgrades',()=>{
  const prior=catalogBeforeBiqugeTW()
  assert.equal(prior.version,'global-all-sources-'+digest(JSON.stringify(prior.sources)).slice(0,16))
  assert.equal(catalog.previousVersion,prior.version)
  assert.equal(catalog.version,'global-all-sources-'+digest(JSON.stringify(catalog.sources)).slice(0,16))
  assert.equal(catalog.total,48);assert.equal(prior.sources.length,47)
  assert.deepEqual(catalog.sources.slice(0,-1),prior.sources);assert.deepEqual(catalog.sources.at(-1),source)
  assert.equal(catalog.applyToExisting,true);assert.equal(catalog.restoreMissing,false)
  assert.deepEqual(catalog.addedSourceIds,[source.id]);assert.deepEqual(catalog.upgradeFrom[prior.version],[source.id])
  for(const [version,ids]of Object.entries(prior.upgradeFrom))assert.deepEqual(catalog.upgradeFrom[version],[...ids,source.id])
  assert.equal(source.headers,undefined);assert.equal(source.login,undefined);assert.equal(source.allowedOrigins,undefined)
})

test('Biquge TW uses generic book/author search and scopes rows to real result cards',()=>{
  for(const [key,page] of [['模拟甲书',1],['模拟作者',2],['其他书名',3]]){
    const request=searchRequest(source,key,page),url=new URL(request.url,source.url)
    assert.equal(url.pathname,'/search/');assert.equal(url.searchParams.get('searchkey'),key);assert.equal(url.searchParams.get('page'),String(page))
  }
  const {bookSourceComment,...executable}=raw
  assert.doesNotMatch(JSON.stringify(executable),/7866077|81969427|<js>|@js:|webView|Cookie|password/i)
  const doc=document('<nav><a href=/book/9.html>推荐小说</a></nav><div class=result-card><a class=book-title href=/book/1.html>模拟甲书</a><span class=author>模拟甲作者</span><div class=book-intro>原创模拟简介。</div></div><div class=result-card><a class=book-title href=/book/2.html>模拟乙书</a><span class=author>模拟乙作者</span></div>')
  const rows=ruleList(doc,source.rules.ruleSearch.bookList)
  assert.equal(rows.length,2);assert.equal(ruleText(rows[1],source.rules.ruleSearch.bookUrl),'/book/2.html');assert.equal(ruleText(rows[0],source.rules.ruleSearch.author),'模拟甲作者')
  assert.equal(ruleList(document('<main>没有找到相关小说</main>'),source.rules.ruleSearch.bookList).length,0)
})

test('Biquge TW follows full directory and never mistakes next chapter for next content page',()=>{
  const doc=document('<meta property="og:novel:book_name" content="模拟甲书"><meta property="og:novel:author" content="模拟作者"><div class=intro><p>原创简介。</p></div><a href=/book/1/>查看全部章节列表</a><dd class=intro>其他书的简介</dd>')
  assert.equal(ruleText(doc,source.rules.ruleBookInfo.name),'模拟甲书');assert.equal(ruleText(doc,source.rules.ruleBookInfo.author),'模拟作者')
  assert.equal(ruleText(doc,source.rules.ruleBookInfo.intro),'原创简介。');assert.equal(ruleText(doc,source.rules.ruleBookInfo.tocUrl),'/book/1/')
  assert.equal(ruleText(document('<a href=/book/1/>查看全部章節列表</a>'),source.rules.ruleBookInfo.tocUrl),'/book/1/')
  const toc=document('<div class=booklist><ul><li><a href=/book/1/11.html>第11章 原创标题</a></li></ul></div><a href=/book/2/1.html>推荐书</a>')
  assert.equal(ruleList(toc,source.rules.ruleToc.chapterList).length,1)
  const content=document('<div id=chaptercontent>天亮后，他走上台阶。<br>楼上有人招手。<script>evil()</script><iframe src=/ad>广告</iframe></div><a href=/book/1/12.html>下一章</a>')
  assert.equal(contentText(content,source.rules.ruleContent),'天亮后，他走上台阶。\n楼上有人招手。')
  assert.equal(ruleText(content,source.rules.ruleContent.nextContentUrl),'')
  assert.equal(ruleText(document('<a href=/book/1/11_2.html>下一页</a><a href=/book/1/12.html>下一章</a>'),source.rules.ruleContent.nextContentUrl),'/book/1/11_2.html')
  assert.equal(ruleText(document('<a href=/book/1/11_2.html>下一頁</a>'),source.rules.ruleContent.nextContentUrl),'/book/1/11_2.html')
})

test('Biquge TW search -> add -> chapters 11/12/20 uses the normal isolated library pipeline',async t=>{
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-biquge-test-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close())
  await store.saveAccount({username:'fixture',password:'fixture-biquge-password'})
  const requests=[],fetchPage=async url=>{
    const u=new URL(url);requests.push(u.pathname)
    if(u.pathname==='/search/')return {url,text:'<div class=result-card><a class=book-title href=/book/1.html>原创模拟书</a><span class=author>模拟作者</span></div>'}
    if(u.pathname==='/book/1.html')return {url,text:'<meta property="og:novel:book_name" content="原创模拟书"><meta property="og:novel:author" content="模拟作者"><a href=/book/1/>查看全部章节列表</a>'}
    if(u.pathname==='/book/1/')return {url,text:'<div class=booklist><ul>'+Array.from({length:25},(_,i)=>`<li><a href=/book/1/${i+1}.html>第${i+1}章 原创模拟标题</a></li>`).join('')+'</ul></div>'}
    return {url,text:`<div id=chaptercontent>这是第${u.pathname.split('/').pop().split('.')[0]}章的原创模拟正文。<br>他走上台阶。</div><a href=/book/1/99.html>下一章</a>`}
  }
  const lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage,authKey:'fixture-key'})
  assert.equal((await lib.handle('fixture','/sources/import','POST',{sources:raw})).rejected.length,0)
  const item=(await lib.handle('fixture','/search','POST',{sourceId:source.id,key:'原创模拟书'})).results[0]
  const book=await lib.handle('fixture','/books','POST',{ticket:item.ticket})
  assert.equal(book.chapterCount,25);assert.equal(book.title,'原创模拟书')
  assert.equal((await lib.handle('fixture','/books','POST',{ticket:item.ticket})).id,book.id)
  for(const n of [11,12,20]){
    const read=await lib.handle('fixture',`/books/${book.id}/chapters/${book.chapters[n-1].id}`,'GET',{})
    assert.equal(read.body,`这是第${n}章的原创模拟正文。\n他走上台阶。`)
  }
  assert.ok(requests.includes('/book/1/'));assert.ok(!requests.includes('/book/1/99.html'))
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_books').get().n,1)
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Biquge TW initializes all existing and new accounts, preserving books, private state, custom rules and deletions',async t=>{
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-biquge-default-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close())
  const noFetch=()=>{throw Error('default initialization must not contact upstream')},prior=catalogBeforeBiqugeTW()
  for(const owner of ['alpha','beta','custom'])await store.saveAccount({username:owner,password:'fixture-biquge-password'})
  let lib=createNetworkLibrary(store.db,{defaultSources:prior,authKey:'fixture-key',fetchPage:noFetch})
  await lib.handle('alpha','/sources/import','POST',{sources:raw})
  await lib.handle('alpha',`/sources/${source.id}`,'PUT',{enabled:false})
  await lib.handle('alpha',`/sources/${source.id}/auth`,'PUT',{cookie:'fixture=private'})
  await lib.handle('beta',`/sources/${prior.sources[0].id}`,'DELETE',{})
  const custom={...prior.sources[1],name:'用户规则',version:'fixture-custom'}
  store.db.prepare('UPDATE network_sources SET name=?,version=?,config=? WHERE owner=? AND id=?').run(custom.name,custom.version,JSON.stringify(custom),'custom',custom.id)
  store.db.prepare('INSERT INTO network_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('alpha','fixture-book',source.id,'模拟旧收藏','模拟作者','原创简介',source.url+'/book/1.html',source.url+'/book/1/','[]','rev','2026-10-21')
  const protectedTables=store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('network_sources','network_source_initializations') ORDER BY name").all().map(r=>r.name)
  const snapshot=()=>protectedTables.map(name=>[name,store.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])
  const before=snapshot(),oldSources=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all()
  lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key',fetchPage:noFetch})
  for(const row of oldSources)assert.deepEqual(store.db.prepare('SELECT * FROM network_sources WHERE owner=? AND id=?').get(row.owner,row.id),row)
  for(const owner of ['alpha','beta','custom'])assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_sources WHERE owner=? AND id=?').get(owner,source.id).n,1)
  assert.deepEqual(snapshot(),before)
  assert.equal((await lib.handle('alpha','/sources','GET',{})).find(s=>s.id===source.id).enabled,false)
  assert.equal((await lib.handle('beta','/sources','GET',{})).find(s=>s.id===source.id).enabled,true)
  assert.equal(store.db.prepare('SELECT 1 FROM network_sources WHERE owner=? AND id=?').get('beta',prior.sources[0].id),undefined)
  assert.equal((await lib.handle('alpha',`/sources/${source.id}/auth`,'GET',{})).hasCookie,true)
  await store.saveAccount({username:'future',password:'fixture-biquge-password'});lib.initializeAccount('future')
  assert.equal((await lib.handle('future','/sources','GET',{})).length,48)
  await lib.handle('beta',`/sources/${source.id}`,'DELETE',{})
  const rows=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all()
  lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key',fetchPage:noFetch})
  assert.deepEqual(store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all(),rows)
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
})
