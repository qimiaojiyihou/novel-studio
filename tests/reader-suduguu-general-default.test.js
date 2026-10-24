import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import rawSources from '../exports/suduguu-general-legado.json' with {type:'json'}
import {catalogBeforePhonePagination} from './fixtures/reader-catalog-history.js'
import {normalizeSource,document,ruleList,ruleText,searchRequest} from '../reader-service/source-rules.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'

const catalog=catalogBeforePhonePagination()
const raw={...rawSources[0],bookSourceUrl:rawSources[0].bookSourceUrl+'/#general'},source=normalizeSource(raw)
const priorSources=catalog.sources.filter(s=>s.id!==source.id)

test('general Suduguu is a separate additive default preserving all previous 46 entries',()=>{
  assert.equal(source.id,'6cfafad5bc407b7319d093a0cf0e6909')
  assert.deepEqual(catalog.sources.at(-1),source)
  assert.equal(catalog.previousVersion,'global-all-sources-10ae2a8ba1ae452d')
  assert.equal('global-all-sources-'+digest(JSON.stringify(priorSources)).slice(0,16),catalog.previousVersion)
  assert.equal(catalog.version,'global-all-sources-'+digest(JSON.stringify(catalog.sources)).slice(0,16))
  assert.equal(catalog.total,47);assert.equal(priorSources.length,46)
  assert.equal(catalog.applyToExisting,true);assert.equal(catalog.restoreMissing,false)
  assert.deepEqual(catalog.addedSourceIds,[source.id])
  assert.deepEqual(catalog.upgradeFrom[catalog.previousVersion],[source.id])
  for(const ids of Object.values(catalog.upgradeFrom))assert.equal(ids.filter(id=>id===source.id).length,1)
  assert.equal(source.url,'https://www.suduguu.com');assert.equal(source.identity,raw.bookSourceUrl)
  assert.equal(source.login,undefined);assert.equal(source.headers,undefined)
  assert.ok(priorSources.some(s=>s.id==='487bc7703870e80ff275fe935370a76e'))
})

test('general search, author metadata and directory/content pagination use standard rules',()=>{
  const request=searchRequest(source,'测试作者',2)
  const url=new URL(request.url,source.url)
  assert.equal(url.pathname,'/i/sor.aspx');assert.equal(url.searchParams.get('key'),'测试作者');assert.equal(url.searchParams.get('p'),'2')
  const doc=document('<html><body><nav><a href="/">首页</a></nav><div class="container"><div class="item"><h3><a href="/128/">模拟甲书</a></h3><a>作者：测试作者</a></div><div class="item"><h3><a href="/51/">模拟乙书</a></h3><a>作者：其他作者</a></div></div></body></html>')
  const rows=ruleList(doc,source.rules.ruleSearch.bookList)
  assert.equal(rows.length,2);assert.equal(ruleText(rows[1],source.rules.ruleSearch.name),'模拟乙书')
  assert.equal(ruleText(rows[0],source.rules.ruleSearch.author),'测试作者')
  assert.equal(ruleText(rows[1],source.rules.ruleSearch.bookUrl),'/51/')
  assert.equal(ruleList(document('<div class="container">无结果</div>'),source.rules.ruleSearch.bookList).length,0)
  const toc=document('<div id="list"><a href="/128/11.html">第11章</a></div><div id="pages"><a class="gl" href="/128/">上一页</a><a class="gr" href="p-3.html#dir">下一页</a></div>')
  assert.equal(ruleList(toc,source.rules.ruleToc.chapterList).length,1)
  assert.equal(ruleText(toc,source.rules.ruleToc.nextTocUrl),'p-3.html#dir')
  assert.equal(ruleText(document('<a href="/next-chapter.html">下一章</a>'),source.rules.ruleContent.nextContentUrl),'')
})

test('existing and future accounts receive general source once without altering books, auth or disabled/custom/deleted sources',async()=>{
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-general-default-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file),prior={...catalog,version:catalog.previousVersion,applyToExisting:false,sources:priorSources}
  const noFetch=()=>{throw Error('default initialization must not request upstream sites')}
  try{
    for(const owner of ['alpha','beta','gamma'])await store.saveAccount({username:owner,password:'fixture-only-general-password'})
    let lib=createNetworkLibrary(store.db,{defaultSources:prior,fetchPage:noFetch,authKey:'fixture-key'})
    for(const owner of ['alpha','beta','gamma'])await lib.handle(owner,'/sources','GET',{})
    await lib.handle('alpha','/sources/import','POST',{sources:raw})
    await lib.handle('alpha',`/sources/${source.id}`,'PUT',{enabled:false})
    await lib.handle('alpha',`/sources/${source.id}/auth`,'PUT',{cookie:'fixture=general-private'})
    await lib.handle('beta',`/sources/${priorSources[0].id}`,'DELETE',{})
    const custom={...priorSources[1],name:'用户通用配置',version:'fixture-custom'}
    store.db.prepare('UPDATE network_sources SET name=?,version=?,config=? WHERE owner=? AND id=?').run(custom.name,custom.version,JSON.stringify(custom),'gamma',custom.id)
    store.db.prepare('INSERT INTO network_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('alpha','fixture-book','487bc7703870e80ff275fe935370a76e','原专用源收藏','模拟作者','模拟简介',source.url+'/5947/',source.url+'/5947/','[]','rev','2026-10-17')
    const before=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all(),books=store.db.prepare('SELECT * FROM network_books').all()
    lib=createNetworkLibrary(store.db,{defaultSources:catalog,fetchPage:noFetch,authKey:'fixture-key'})
    for(const row of before)assert.deepEqual(store.db.prepare('SELECT * FROM network_sources WHERE owner=? AND id=?').get(row.owner,row.id),row)
    for(const owner of ['alpha','beta','gamma'])assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_sources WHERE owner=? AND id=?').get(owner,source.id).n,1)
    assert.equal((await lib.handle('alpha','/sources','GET',{})).find(s=>s.id===source.id).enabled,false)
    assert.equal((await lib.handle('beta','/sources','GET',{})).find(s=>s.id===source.id).enabled,true)
    assert.equal(store.db.prepare('SELECT 1 FROM network_sources WHERE owner=? AND id=?').get('beta',priorSources[0].id),undefined)
    assert.deepEqual(store.db.prepare('SELECT * FROM network_books').all(),books)
    assert.equal((await lib.handle('alpha',`/sources/${source.id}/auth`,'GET',{})).hasCookie,true)
    assert.equal((await lib.handle('beta',`/sources/${source.id}/auth`,'GET',{})).hasCookie,false)
    await store.saveAccount({username:'future',password:'fixture-only-general-password'});lib.initializeAccount('future')
    const fresh=await lib.handle('future','/sources','GET',{})
    assert.equal(fresh.length,47);assert.equal(fresh.find(s=>s.id===source.id).enabled,true)
    await lib.handle('gamma',`/sources/${source.id}`,'DELETE',{})
    lib=createNetworkLibrary(store.db,{defaultSources:catalog,fetchPage:noFetch,authKey:'fixture-key'})
    assert.equal((await lib.handle('gamma','/sources','GET',{})).some(s=>s.id===source.id),false)
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{store.close()}
})
