import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { startReaderServer } from '../reader-service/server.js'
import { publicAddress,sourceURL,sourceHeaders,createSourceFetcher } from '../reader-service/source-fetch.js'
import { normalizeSource,searchRequest,document,ruleText,ruleList,contentText,infoContext } from '../reader-service/source-rules.js'
import { sampleSource,mockSourceFetcher } from './fixtures/network-source.js'
import { openReaderStore,fail } from '../reader-service/store.js'
import { createNetworkLibrary } from '../reader-service/network-library.js'
import {sourceIssue} from '../reader-service/public/network.js'

test('source diagnostic categories distinguish remote failures from parser gaps',()=>{
  assert.equal(sourceIssue({code:'ORIGIN_BLOCKED'}).key,'origin')
  assert.equal(sourceIssue({code:'TLS_FAILED'}).key,'tls')
  assert.equal(sourceIssue({code:'HTTP_ERROR',httpStatus:403}).key,'access')
  assert.equal(sourceIssue({httpStatus:404}).key,'address')
  assert.equal(sourceIssue({httpStatus:504}).key,'network')
  assert.equal(sourceIssue({code:'RULE_UNSUPPORTED'}).key,'rule')
})

test('redirect approval is account-local, exact, based on fresh current-version health and preserves credentials',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-origin-approval-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  const store=openReaderStore(databasePath);let now=Date.now()
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture',now:()=>now,fetchPage:async()=>{throw Object.assign(Error('redirect fixture'),{status:400,code:'ORIGIN_BLOCKED',targetOrigin:'https://new.example.org',phase:'redirect'})}})
  const s=normalizeSource(sampleSource),call=(owner,route,method='GET',input={})=>library.handle(owner,route,method,input)
  try{
    for(const username of ['alpha','beta']){await store.saveAccount({username,password:'temporary-approval-password'});await call(username,'/sources/import','POST',{sources:sampleSource})}
    const route=`/sources/${s.id}/origins`
    await assert.rejects(call('alpha',route,'PUT',{origin:'https://new.example.org'}),/过期/)
    await call('alpha','/sources/check','POST',{ids:[s.id],key:'测试'})
    await assert.rejects(call('beta',route,'PUT',{origin:'https://new.example.org'}),/过期/)
    await assert.rejects(call('alpha',route,'PUT',{origin:'https://other.example.org'}),/匹配/)
    await assert.rejects(call('alpha',route,'PUT',{origin:'https://127.0.0.1'}),/公网/)
    now+=24*60*60*1000+1
    await assert.rejects(call('alpha',route,'PUT',{origin:'https://new.example.org'}),/一天/)
    await call('alpha','/sources/check','POST',{ids:[s.id],key:'测试'})
    await call('alpha',`/sources/${s.id}/auth`,'PUT',{cookie:'sid=fixture-private'})
    await call('alpha',route,'PUT',{origin:'https://new.example.org'})
    assert.equal((await call('alpha',`/sources/${s.id}/auth`)).hasCookie,true)
    assert.ok((await call('alpha','/sources'))[0].health.stale)
    const config=owner=>JSON.parse(store.db.prepare('SELECT config FROM network_sources WHERE owner=? AND id=?').get(owner,s.id).config)
    assert.deepEqual(config('alpha').allowedOrigins,['https://new.example.org']);assert.equal(config('beta').allowedOrigins,undefined)
    await assert.rejects(call('alpha',route,'PUT',{origin:'https://new.example.org'}),/过期/)
  }finally{store.close()}
})

test('all enabled sources can be searched beyond five using bounded batches, with isolation and continuation',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-search-all-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  const store=openReaderStore(databasePath),requests=[],fixture=mockSourceFetcher(requests)
  const lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async(url,options)=>{if(new URL(url).hostname==='all2.example.org')throw new Error('fixture offline');return fixture(url,options)}})
  const call=(owner,input)=>lib.handle(owner,'/search','POST',input)
  try{
    for(const username of ['alpha','beta'])await store.saveAccount({username,password:'test-search-password'})
    const sources=Array.from({length:8},(_,i)=>({...sampleSource,bookSourceName:`源 ${i}`,bookSourceUrl:`https://all${i}.example.org`}))
    const imported=await lib.handle('alpha','/sources/import','POST',{sources}),ids=imported.accepted.map(s=>s.id)
    await lib.handle('alpha',`/sources/${ids[7]}`,'PUT',{enabled:false})
    let offset=0,checked=0;const results=[],errors=[]
    do{const batch=await call('alpha',{key:'作者',sourceOffset:offset});assert.ok(batch.checkedSources<=2);assert.equal(batch.totalSources,7);checked+=batch.checkedSources;results.push(...batch.results);errors.push(...batch.errors);offset=batch.nextSourceOffset}while(offset!==null)
    assert.equal(checked,7);assert.equal(results.length,6);assert.equal(errors.length,1);assert.ok(results.some(r=>r.sourceId===ids[6]))
    assert.ok(requests.every(r=>new URL(r.url).hostname!=='all7.example.org'))
    const explicit=await call('alpha',{key:'作者',page:2,sourceIds:[ids[5],ids[6]]});assert.equal(explicit.results.length,2);assert.equal(explicit.page,2)
    await assert.rejects(call('alpha',{key:'作者',sourceIds:ids.slice(0,3)}),/1–2/)
    assert.equal((await call('beta',{key:'作者',sourceIds:[ids[6]]})).results.length,0)
    assert.equal((await call('alpha',{key:'作者',sourceIds:[ids[7]]})).results.length,0)
    await assert.rejects(call('alpha',{key:'作者',sourceOffset:-1}),/进度/)
  }finally{store.close()}
})

test('search tickets remain usable for one hour and expire exactly at the boundary',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-ticket-hour-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.ok(directory.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
  const store=openReaderStore(databasePath);let time=1000
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'ticket-fixture',now:()=>time,fetchPage:mockSourceFetcher()})
  const call=(route,method='GET',input={})=>library.handle('alpha',route,method,input)
  try{
    await store.saveAccount({username:'alpha',password:'temporary-ticket-password'});await store.saveAccount({username:'beta',password:'temporary-ticket-password'})
    await call('/sources/import','POST',{sources:sampleSource})
    const first=(await call('/search','POST',{key:'测试'})).results[0]
    time+=11*60_000
    assert.equal((await call('/books','POST',{ticket:first.ticket})).title,'测试小说','eleven minutes must not expire the ticket')
    time=1000+60*60_000-1
    assert.equal((await call('/books','POST',{ticket:first.ticket})).title,'测试小说','valid immediately before one hour')
    await assert.rejects(library.handle('beta','/books','POST',{ticket:first.ticket}),e=>e.status===409)
    time++
    await assert.rejects(call('/books','POST',{ticket:first.ticket}),e=>e.status===409&&/已失效/.test(e.message))
  }finally{store.close()}
})

test('the shared search ticket cache retains 10000 entries and evicts the oldest only when exceeded',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-ticket-limit-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.ok(directory.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
  const store=openReaderStore(databasePath),normal=mockSourceFetcher();let time=1000
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'ticket-fixture',now:()=>time,fetchPage:async(url,options)=>new URL(url).pathname==='/modules/article/search.php'?{url,text:'<ul class=l>'+Array.from({length:50},(_,n)=>`<li><a href="/book/1?item=${n}">测试小说</a></li>`).join('')+'</ul>'}:normal(url,options)})
  try{
    for(const username of ['alpha','beta']){await store.saveAccount({username,password:'temporary-ticket-password'});await library.handle(username,'/sources/import','POST',{sources:sampleSource})}
    let first,last
    for(let batch=0;batch<200;batch++){
      const owner=batch%2?'beta':'alpha',result=await library.handle(owner,'/search','POST',{key:'测试'})
      assert.equal(result.results.length,50)
      if(!batch)first=result.results[0].ticket
      if(batch===199)last=result.results.at(-1).ticket
      time+=1001 // Stay below request-rate limits and the one-hour TTL.
    }
    assert.equal((await library.handle('alpha','/books','POST',{ticket:first})).title,'测试小说')
    assert.equal((await library.handle('beta','/books','POST',{ticket:last})).title,'测试小说')
    await library.handle('beta','/search','POST',{key:'测试'})
    await assert.rejects(library.handle('alpha','/books','POST',{ticket:first}),e=>e.status===409)
    assert.equal((await library.handle('beta','/books','POST',{ticket:last})).title,'测试小说')
  }finally{store.close()}
})

test('Legado sample: GBK POST, a.0, fallback, concatenation, HTML and RE2 replacement; scripts never execute',()=>{
  const source=normalizeSource(sampleSource),request=searchRequest(source,'测试作者',2)
  assert.equal(request.method,'POST');assert.equal(request.body,'searchkey=%B2%E2%CA%D4%D7%F7%D5%DF&page=2')
  assert.ok(source.warnings.some(w=>w.includes('coverUrl')))
  const doc=document('<ul class=l><li><a href=/a>书名</a><a>错误</a><span class=s4>作者</span><span class=s1>[悬疑小说]</span></li></ul>')
  const items=ruleList(doc,source.rules.ruleSearch.bookList);assert.equal(items.length,1)
  assert.equal(ruleText(items[0],source.rules.ruleSearch.name),'书名');assert.equal(ruleText(items[0],source.rules.ruleSearch.bookUrl),'/a')
  assert.equal(ruleText(items[0],source.rules.ruleSearch.kind),'悬疑')
  assert.equal(contentText(document('<div id=content>一秒记住广告免费阅读。<br>第一段<p>第二段</p><script>evil()</script></div>'),source.rules.ruleContent),'第一段\n第二段')
  assert.doesNotThrow(()=>normalizeSource({...sampleSource,ruleContent:{content:'@js:evil()'}})) // Runtime has no host globals; unknown functions fail inside the isolated VM.
  assert.doesNotThrow(()=>normalizeSource({...sampleSource,ruleBookInfo:{init:'@js:evil()'}}))
  assert.throws(()=>normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,bookList:'.l li##x'}}),/列表选择器/)
  assert.equal(normalizeSource({...sampleSource,searchUrl:"/search,{method:'POST',webView:true}"}).search.webView,true)
  assert.throws(()=>normalizeSource({...sampleSource,searchUrl:"/search,{method:'POST',webView:'yes'}"}),/布尔值/)
  assert.equal(ruleText(document('{"name":"JSON书"}'),'$.name'),'JSON书')
  assert.equal(ruleList(document('{"books":[{"name":"甲"},{"name":"乙"}]}'),'$.books[*]').length,2)
})

test('static headers, Java escaped punctuation, textNodes and text selectors are compatible without executing code',()=>{
  const s=normalizeSource({...sampleSource,header:JSON.stringify({'User-Agent':'Fixture/1.0','Referer':'{{baseUrl}}','Accept-Language':'zh-CN'}),ruleContent:{content:'#content@textNodes##\\（.*'}})
  assert.equal(s.headers.referer,s.url+'/');assert.equal(searchRequest(s,'作者',1).headers['user-agent'],'Fixture/1.0')
  const doc=document('<div id=content> 第一段 <br>第二段<span>标签内文本</span>（附注）</div><a href=/next>下一页</a>')
  assert.equal(contentText(doc,s.rules.ruleContent),'第一段\n第二段')
  assert.equal(ruleText(doc,'text.下一页@href'),'/next')
  const indexed=document('<ul><li>A</li><li>B</li><li>C</li></ul><ul><li>D</li><li>E</li></ul>')
  assert.equal(ruleText(indexed,'ul@li.1:0@text'),'B\nA\nE\nD')
  assert.equal(ruleText(indexed,'ul@li!0@text'),'B\nC\nE')
  assert.equal(ruleText(indexed,'ul@li.-1@text'),'C\nE')
  const self=ruleList(document('<div class=item><a href=/x>甲</a></div>'),'.item')[0]
  assert.equal(ruleText(self,'.item@a@href'),'/x')
  for(const header of [{Cookie:'secret'},{Authorization:'secret'},{Host:'127.0.0.1'},{Referer:'https://other.example.org'},{'User-Agent':'a\r\nb'},{'User-Agent':'{{java.ajax()}}'}])assert.throws(()=>sourceHeaders(header,s.url))
  assert.equal(normalizeSource({...sampleSource,header:'@js:java.ajax()'}).headerScript,'java.ajax()') // Evaluated only in the isolated runtime, not during import.
  assert.match(normalizeSource({...sampleSource,ruleContent:{content:'#content@text##(?<=x)y'}}).rules.ruleContent.content,/<js>/)
  assert.doesNotThrow(()=>normalizeSource({...sampleSource,ruleContent:{content:'@js:while(true){}'}})) // CPU budget is enforced at execution.
})

test('source health samples are scoped, bounded, latest-only; batch deletion protects books and default upgrades preserve deletions',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-source-health-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  let store=openReaderStore(databasePath),mode='healthy',release,entered
  const fixture=mockSourceFetcher(),fetchPage=async(url,options)=>{
    if(mode==='delayed'){entered();await new Promise(resolve=>{release=resolve})}
    if(mode==='limited')throw Object.assign(new Error('书源返回 HTTP 429'),{status:502,httpStatus:429})
    if(mode==='gone')throw Object.assign(new Error('书源返回 HTTP 404'),{status:502,httpStatus:404})
    if(mode==='offline')throw new Error('fixture connection failure')
    if(mode==='empty')return {url,text:'<div>无搜索结果或验证页</div>'}
    if(mode==='no-toc'&&new URL(url).pathname==='/book/1')return {url,text:'<div>无目录</div>'}
    if(mode==='no-body'&&new URL(url).pathname.startsWith('/chapter/'))return {url,text:'<div>无正文</div>'}
    if(mode==='verification')return {url,text:'<title>Just a moment...</title><p>Check browser</p>'}
    if(mode==='dns')throw Object.assign(new Error('域名解析失败'),{status:502,code:'DNS_NOT_FOUND',phase:'dns'})
    if(mode==='cooldown')throw Object.assign(new Error('等待 60 秒后重试'),{status:502,code:'RATE_COOLDOWN',phase:'queue',httpStatus:429,retryAfterSeconds:60})
    return fixture(url,options)
  }
  const options={defaultSources:null,fetchPage};let lib=createNetworkLibrary(store.db,options)
  const call=(owner,route,method='GET',input={},active)=>lib.handle(owner,route,method,input,active)
  try{
    for(const username of ['alpha','beta'])await store.saveAccount({username,password:'test-source-password'})
    const sources=[sampleSource,{...sampleSource,bookSourceName:'另一个源',bookSourceUrl:'https://another.example.org'}]
    const imported=await call('alpha','/sources/import','POST',{sources}),ids=imported.accepted.map(s=>s.id)
    await call('beta','/sources/import','POST',{sources:sampleSource})
    await assert.rejects(call('beta','/sources/check','POST',{ids:[ids[1]],key:'测试'}),/不存在/)
    await assert.rejects(call('alpha','/sources/check','POST',{ids:[...ids,ids[0]],key:'测试'}),/1–2/)
    await call('alpha',`/sources/${ids[0]}`,'PUT',{enabled:false})
    const check=()=>call('alpha','/sources/check','POST',{ids:[ids[0]],key:'测试'})
    assert.equal((await check()).results[0].status,'healthy')
    let list=await call('alpha','/sources');assert.equal(list.find(s=>s.id===ids[0]).enabled,false)
    assert.equal((await call('beta','/sources'))[0].health,null)
    for(const [value,status] of [['limited','restricted'],['gone','suspect'],['offline','unreachable'],['empty','empty'],['no-toc','review'],['no-body','review']]){mode=value;assert.equal((await check()).results[0].status,status)}
    mode='verification';let detail=(await check()).results[0];assert.equal(detail.status,'restricted');assert.equal(detail.code,'VERIFICATION_PAGE');assert.equal(detail.stage,'search')
    mode='dns';detail=(await check()).results[0];assert.equal(detail.code,'DNS_NOT_FOUND');assert.equal(detail.phase,'dns')
    mode='cooldown';detail=(await check()).results[0];assert.equal(detail.retryAfterSeconds,60)
    mode='healthy';detail=(await check()).results[0];assert.equal(detail.matches.search,1);assert.equal(detail.matches.toc,2);assert.ok(detail.matches.contentCharacters>0)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_source_health').get().n,1)
    mode='healthy';await call('alpha','/sources/import','POST',{sources:{...sampleSource,bookSourceName:'规则更新'}})
    assert.equal((await call('alpha','/sources')).find(s=>s.id===ids[0]).health.stale,true)
    await call('alpha',`/sources/${ids[0]}`,'PUT',{enabled:true})
    const search=await call('alpha','/search','POST',{sourceId:ids[0],key:'测试'})
    const saved=await call('alpha','/books','POST',{ticket:search.results[0].ticket})
    const removed=await call('alpha','/sources/delete','POST',{ids:[...ids,ids[1],'not-owned']})
    assert.deepEqual(removed.removed,[ids[1]]);assert.equal(removed.skipped.length,2)
    assert.equal((await call('alpha',`/books/${saved.id}`)).title,'测试小说');assert.equal((await call('beta','/sources')).length,1)
    assert.deepEqual((await call('alpha','/sources/delete','POST',{ids:[ids[1]]})).removed,[],'retry is idempotent')
    // A delayed result must not overwrite new rules, and duplicate checks do not fan out.
    mode='delayed';let reached=new Promise(resolve=>{entered=resolve});const pending=check();await reached
    assert.equal((await check()).results[0].skipped,true)
    await call('alpha','/sources/import','POST',{sources:sampleSource});mode='healthy';release()
    assert.equal((await pending).results[0].skipped,true)
    mode='delayed';reached=new Promise(resolve=>{entered=resolve});let active=true
    const revoked=call('alpha','/sources/check','POST',{ids:[ids[0]],key:'测试'},()=>{if(!active)fail(401,'revoked')});await reached;active=false;mode='healthy';release()
    await assert.rejects(revoked,/revoked/)
    await check();store.close();store=openReaderStore(databasePath);lib=createNetworkLibrary(store.db,options)
    assert.equal((await call('alpha','/sources'))[0].health.status,'healthy')
    await call('alpha',`/books/${saved.id}`,'DELETE')
    await call('alpha','/sources/delete','POST',{ids:[ids[0]]})
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_source_health').get().n,0)
    // Explicit default upgrade adds newly compatible IDs, not previously deleted IDs.
    const old=normalizeSource(sampleSource),extra=normalizeSource(sources[1]),pack={version:'v1',name:'fixture',total:1,sources:[old],rejected:[],duplicates:[]}
    lib=createNetworkLibrary(store.db,{...options,defaultSources:pack})
    await call('alpha','/sources');await call('alpha',`/sources/${old.id}`,'DELETE')
    lib=createNetworkLibrary(store.db,{...options,defaultSources:{...pack,version:'v2',previousVersion:'v1',addedSourceIds:[extra.id],sources:[old,extra]}})
    assert.equal((await call('alpha','/sources/defaults')).updateAvailable,true)
    await call('alpha','/sources/defaults/update','POST',{})
    assert.deepEqual((await call('alpha','/sources')).map(s=>s.id),[extra.id])
    await call('alpha',`/sources/${extra.id}`,'DELETE');await call('alpha','/sources/defaults/update','POST',{})
    assert.equal((await call('alpha','/sources')).length,0,'repeat upgrade never restores deletions')
  }finally{store.close()}
})

test('remote fetch denies private addresses, pins DNS, revalidates redirects, limits response bytes',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','0.0.0.0']) assert.equal(publicAddress(ip),false,ip)
  for(const url of ['http://localhost/a','http://2130706433','file:///etc/passwd','http://user:pass@example.org','http://example.org:3080','http://[::1]/'])assert.throws(()=>sourceURL(url))
  let sockets=0
  await assert.rejects(createSourceFetcher({resolve:async()=>[{address:'127.0.0.1',family:4}],requestHTTPS:()=>{sockets++}})('https://example.org'),/非公网/);assert.equal(sockets,0)
  await assert.rejects(createSourceFetcher({resolve:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}],requestHTTPS:()=>{sockets++}})('https://example.org'),/非公网/);assert.equal(sockets,0,'all DNS answers are checked')
  function request(result){return (_url,options,callback)=>{sockets++;const req=new EventEmitter();req.end=()=>{options.lookup('example.org',{all:true},(error,answers)=>{assert.equal(error,null);assert.equal(answers[0].address,'93.184.216.34')});queueMicrotask(()=>{const response=Readable.from([Buffer.from(result.body||'hello')]);response.statusCode=result.status||200;response.headers=result.headers||{};callback(response)})};return req}}
  const resolve=async()=>[{address:'93.184.216.34',family:4}]
  const safe=createSourceFetcher({resolve,requestHTTPS:request({})});assert.equal((await safe('https://example.org')).text,'hello')
  await assert.rejects(createSourceFetcher({resolve,requestHTTPS:request({status:302,headers:{location:'http://127.0.0.1/'}})})('https://example.org'),/公网/)
  await assert.rejects(createSourceFetcher({resolve,requestHTTPS:request({status:302,headers:{location:'https://different.example.org/'}})})('https://example.org',{scope:'https://example.org'}),/超出书源域名/)
  await assert.rejects(createSourceFetcher({resolve,requestHTTPS:request({body:Buffer.alloc(2*1024*1024+1)})})('https://example.org'),/2 MiB/)
  const large=createSourceFetcher({resolve,requestHTTPS:request({body:Buffer.alloc(3*1024*1024,32)})})
  assert.equal((await large('https://example.org',{maxBytes:10*1024*1024})).text.length,3*1024*1024)
  await assert.rejects(createSourceFetcher({resolve,requestHTTPS:request({body:Buffer.alloc(10*1024*1024+1)})})('https://example.org',{maxBytes:10*1024*1024}),/10 MiB/)
})

test('default source pack initializes each account once, preserves custom disabled rules and deletions across restart',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-source-defaults-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
  let store=openReaderStore(databasePath)
  const bundle=JSON.parse(await fs.readFile(new URL('../reader-service/default-sources.json',import.meta.url),'utf8'))
  assert.equal(bundle.total,48);assert.equal(bundle.sources.length,48);assert.equal(bundle.unavailable.length,0);assert.equal(bundle.rejected.length,0);assert.equal(bundle.duplicates.length,0)
  const noNetwork=async()=>{throw new Error('initialization must never fetch source sites')}
  try{
    await store.saveAccount({username:'first',password:'test-default-password'})
    await store.saveAccount({username:'second',password:'test-default-password'})
    createNetworkLibrary(store.db,{defaultSources:null})
    const first=bundle.sources[0],custom={...first,name:'保留我的配置'}
    store.db.prepare('INSERT INTO network_sources VALUES(?,?,?,?,?,0)').run('first',first.id,custom.name,JSON.stringify(custom),custom.version)
    let library=createNetworkLibrary(store.db,{fetchPage:noNetwork})
    const list=await library.handle('first','/sources','GET',{})
    assert.equal(list.length,bundle.sources.length);assert.equal(list.find(s=>s.id===first.id).enabled,false);assert.equal(list.find(s=>s.id===first.id).name,custom.name)
    const report=await library.handle('first','/sources/defaults','GET',{})
    assert.equal(report.imported,bundle.sources.length-1);assert.equal(report.existing,1);assert.equal(report.rejected.length,0)
    const second=await library.handle('second','/sources','GET',{});assert.equal(second.length,bundle.sources.length);assert.ok(second.every(s=>s.enabled))
    await library.handle('first',`/sources/${bundle.sources[1].id}`,'DELETE',{})
    await library.handle('first',`/sources/${bundle.sources[2].id}`,'PUT',{enabled:false})
    store.close();store=openReaderStore(databasePath);library=createNetworkLibrary(store.db,{fetchPage:noNetwork})
    const restarted=await library.handle('first','/sources','GET',{})
    assert.equal(restarted.length,bundle.sources.length-1);assert.equal(restarted.filter(s=>!s.enabled).length,2)
    assert.equal((await library.handle('second','/sources','GET',{})).length,bundle.sources.length)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_source_initializations').get().n,2)
    store.db.prepare('DELETE FROM accounts WHERE username=?').run('first')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_source_initializations').get().n,1)
  }finally{store.close()}
})

test('10 MiB imports handle 273 entries, default enabled, stable toggles and distinct size/JSON/compatibility errors',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-source-large-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
  const sources=Array.from({length:273},(_,i)=>({...sampleSource,bookSourceUrl:`https://fixture${i}.example.org`,bookSourceName:`模拟书源 ${i}`,enabled:false,bookSourceComment:'x'.repeat(9000)}))
  assert.ok(Buffer.byteLength(JSON.stringify(sources))>2*1024*1024)
  let remoteText=JSON.stringify(sources),limit
  const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async(url,options)=>{limit=options.maxBytes;return {url,text:remoteText}}})
  try{
    await service.store.saveAccount({username:'bulk',password:'test-bulk-password'})
    const token=await service.store.login({username:'bulk',password:'test-bulk-password'})
    const call=async(body,authenticated=true)=>{const response=await fetch(service.origin+'/api/network/sources/import',{method:'POST',headers:{Origin:service.origin,'Content-Type':'application/json',...(authenticated?{Cookie:`reader_session=${token}`}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}}
    assert.equal((await call({sources},false)).status,401)
    const imported=await call({sources});assert.equal(imported.status,200);assert.equal(imported.data.accepted.length,273);assert.equal(imported.data.rejected.length,0)
    assert.equal(service.store.db.prepare('SELECT COUNT(*) AS n FROM network_sources WHERE enabled=1').get().n,273)
    const sourceId=imported.data.accepted[0].id
    service.store.db.prepare('UPDATE network_sources SET enabled=0 WHERE id=?').run(sourceId)
    const urlResult=await call({url:'https://fixture.example.org/sources.json'});assert.equal(urlResult.data.accepted.length,273);assert.equal(limit,10*1024*1024)
    assert.equal(service.store.db.prepare('SELECT enabled FROM network_sources WHERE id=?').get(sourceId).enabled,0)
    assert.equal(service.store.db.prepare('SELECT COUNT(*) AS n FROM network_sources').get().n,273)
    const invalid=await call({sources:'[{'});assert.equal(invalid.status,400);assert.match(invalid.data.error,/有效 JSON/)
    const incompatible=await call({sources:{...sampleSource,ruleContent:{content:'@js:const invalid = ;'}}});assert.equal(incompatible.status,200);assert.equal(incompatible.data.rejected.length,1)
    const tooLarge=await call({sources:' '.repeat(10*1024*1024+1)});assert.equal(tooLarge.status,413);assert.match(tooLarge.data.error,/10 MiB/)
    remoteText=' '.repeat(10*1024*1024+1);assert.equal((await call({url:'https://fixture.example.org/sources.json'})).status,413)
    const sourceJSON=JSON.stringify(sampleSource)
    const exact=await call({sources:sourceJSON+' '.repeat(10*1024*1024-Buffer.byteLength(sourceJSON))});assert.equal(exact.status,200)
    assert.equal((await call({sources:Array(1001).fill(sampleSource)})).status,400)
    assert.equal(service.store.db.prepare('SELECT COUNT(*) AS n FROM network_sources').get().n,274)
  }finally{await service.close()}
})

test('network operations preserve old directory on failure and reject changed sources or revoked sessions in flight',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-network-conflicts-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),directory,'actual temporary database directory verified before writes')
  const store=openReaderStore(databasePath),fixture=mockSourceFetcher()
  let intercept=null
  const network=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async(url,options)=>intercept?intercept(url,options):fixture(url,options)})
  try{
    await store.saveAccount({username:'owner',password:'test-password-owner'})
    const token=await store.login({username:'owner',password:'test-password-owner'})
    const active=()=>{if(store.readerAccount(token)!=='owner')fail(401,'session revoked')}
    const call=(route,method='GET',input={})=>network.handle('owner',route,method,input,active)
    await call('/sources/import','POST',{sources:sampleSource})
    let search=await call('/search','POST',{key:'测试'})
    await call('/sources/import','POST',{sources:{...sampleSource,bookSourceName:'修改后的书源'}})
    await assert.rejects(call('/books','POST',{ticket:search.results[0].ticket}),/书源已变化/)
    search=await call('/search','POST',{key:'测试'})
    const book=await call('/books','POST',{ticket:search.results[0].ticket})
    intercept=async url=>({url,text:'<div>目录暂时不可用</div>'})
    await assert.rejects(call(`/books/${book.id}/refresh`,'POST'),/未解析出章节/)
    assert.deepEqual((await call(`/books/${book.id}`)).chapters,book.chapters)
    assert.equal((await call(`/books/${book.id}`)).revision,book.revision)
    let release,started
    const reached=new Promise(resolve=>{started=resolve})
    intercept=async(url,options)=>{started();await new Promise(resolve=>{release=resolve});return fixture(url,options)}
    const pending=call(`/books/${book.id}/refresh`,'POST')
    await reached
    await call('/sources/import','POST',{sources:{...sampleSource,bookSourceName:'再次更新书源'}})
    release();await assert.rejects(pending,/书源已变化/)
    assert.equal((await call(`/books/${book.id}`)).revision,book.revision)
    const sourceCount=store.db.prepare('SELECT COUNT(*) AS n FROM network_sources').get().n
    const importReached=new Promise(resolve=>{started=resolve})
    intercept=async url=>{started();await new Promise(resolve=>{release=resolve});return {url,text:JSON.stringify({...sampleSource,bookSourceUrl:'https://second.example.org'})}}
    const importing=call('/sources/import','POST',{url:'https://books.example.org/sources.json'})
    await importReached;store.logout(token);release()
    await assert.rejects(importing,/session revoked/)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_sources').get().n,sourceCount,'revoked requests never write')
  }finally{store.close()}
})

test('network library: account isolation, import single/batch/URL, search, idempotent add, read, refresh, revocation and restart',async()=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-network-test-'))),databasePath=path.join(directory,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),directory,'verify actual test database directory before writes')
  const adminToken=randomBytes(32).toString('hex'),requests=[],sourceFetcher=mockSourceFetcher(requests)
  let service=await startReaderServer({databasePath,adminToken,origin:'http://127.0.0.1:0',allowHttp:true,sourceFetcher,defaultSources:null})
  try{
    await service.store.saveAccount({username:'one',password:'test-password-one'});await service.store.saveAccount({username:'two',password:'test-password-two'})
    let one=await service.store.login({username:'one',password:'test-password-one'}),two=await service.store.login({username:'two',password:'test-password-two'})
    const call=async(route,body,token=one,method=body?'POST':'GET')=>{const res=await fetch(service.origin+'/api/network'+route,{method,headers:{Origin:service.origin,...(token?{Cookie:`reader_session=${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
    assert.equal((await call('/sources',undefined,'')).status,401)
    assert.equal((await call('/sources/import',{sources:sampleSource})).data.accepted.length,1)
    const imported=await call('/sources/import',{url:'https://books.example.org/sources.json'});assert.equal(imported.data.accepted.length,1);assert.equal(imported.data.rejected.length,1)
    const sources=(await call('/sources')).data;assert.equal(sources.length,1);assert.deepEqual((await call('/sources',undefined,two)).data,[])
    const batch=await call('/sources/import',{sources:[sampleSource,{...sampleSource,bookSourceName:'另一模拟书源',bookSourceUrl:'https://other.example.org'}]},two)
    assert.equal(batch.data.accepted.length,2);assert.equal((await call('/sources',undefined,two)).data.length,2);assert.equal((await call('/sources')).data.length,1)
    const search=(await call('/search',{key:'测试作者'})).data;assert.equal(search.results[0].author,'测试作者')
    assert.equal((await call('/books',{ticket:search.results[0].ticket},two)).status,409)
    const added=(await call('/books',{ticket:search.results[0].ticket})).data;assert.equal(added.chapterCount,2)
    const duplicate=(await call('/books',{ticket:search.results[0].ticket})).data;assert.equal(duplicate.id,added.id);assert.equal((await call('/books')).data.length,1)
    assert.equal((await call(`/books/${added.id}`,undefined,two)).status,404)
    assert.equal((await call(`/books/${added.id}/chapters/${added.chapters[0].id}`,undefined,two)).status,404)
    const chapter=(await call(`/books/${added.id}/chapters/${added.chapters[0].id}`)).data;assert.match(chapter.body,/测试正文/);assert.doesNotMatch(chapter.body,/广告|window.bad/)
    assert.equal((await call(`/books/${added.id}/refresh`,{})).status,200)
    assert.equal((await call(`/sources/${sources[0].id}`,{},one,'DELETE')).status,409)
    await call(`/sources/${sources[0].id}`,{enabled:false},one,'PUT');assert.equal((await call(`/books/${added.id}/chapters/${added.chapters[0].id}`)).status,409)
    await call(`/sources/${sources[0].id}`,{enabled:true},one,'PUT')
    await service.close();service=await startReaderServer({databasePath,adminToken,origin:'http://127.0.0.1:0',allowHttp:true,sourceFetcher,defaultSources:null})
    assert.equal((await call('/books')).data[0].id,added.id)
    service.store.logout(one);assert.equal((await call('/books')).status,401)
    service.store.setAccess(false);assert.equal((await call('/books',undefined,'')).status,401,'public author shelf never opens private network data')
  }finally{await service.close()}
})
