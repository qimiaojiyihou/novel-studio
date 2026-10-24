import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {runSourceScript} from '../reader-service/source-script.js'
import {normalizeSource,document} from '../reader-service/source-rules.js'
import {createSourceRuntime,virtualPayload} from '../reader-service/source-runtime.js'
import {createSourceAuth} from '../reader-service/source-auth.js'
import {openReaderStore} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'

async function fixture(t){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-script-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close())
  await store.saveAccount({username:'alpha',password:'script-test-password'});await store.saveAccount({username:'beta',password:'script-test-password'})
  return {store,file}
}
test('isolated QuickJS supports array assignment, functions, templates and async host calls, without host globals',async()=>{
  const run=code=>runSourceScript({code,variables:{result:['.作者.书名.悬疑','完结'],book:{author:'作者',name:'书名'}},source:{}},async(method)=>method==='java.ajax'?'fixture':null)
  assert.deepEqual(await run('result[0]=result[0].replace(`.${book.author}` , "").replace(`.${book.name}`, ""); result'),['.悬疑','完结'])
  assert.equal(await run('function read(){return java.ajax("https://example.org")};read()'),'fixture')
  assert.equal(await run('[typeof process,typeof require,typeof fetch].join(",")'),'undefined,undefined,undefined')
  await assert.rejects(run('while(true){}'),e=>e.code==='SCRIPT_LIMIT')
  assert.equal(await run('2+3'),5)
  await run('globalThis.fixtureOnly=7');assert.equal(await run('typeof fixtureOnly'),'undefined')
  assert.throws(()=>run('const broken = ;'),e=>e.code==='SCRIPT_INVALID')
})
test('queued cancellation removes work promptly, host-call floods terminate, and the pool recovers',async()=>{
  let entered=0,ready,release;const started=new Promise(r=>{ready=r}),gate=new Promise(r=>{release=r})
  const input={code:'java.ajax("https://example.org")',variables:{},source:{}}
  const bridge=async()=>{if(++entered===2)ready();await gate;return 'ok'}
  const jobs=[runSourceScript(input,bridge),runSourceScript(input,bridge)];await started
  const controller=new AbortController(),queued=runSourceScript(input,bridge,controller.signal);controller.abort()
  await assert.rejects(queued,e=>e.code==='CANCELLED');release();assert.deepEqual(await Promise.all(jobs),['ok','ok'])
  await assert.rejects(runSourceScript({...input,code:'for(var i=0;i<1000;i++)java.get("key");'},async()=>''),e=>e.code==='SCRIPT_LIMIT')
  assert.equal(await runSourceScript({...input,code:'1+1'},async()=>null),2)
})

test('known public-chapter restrictions are not mislabeled as script resource failures or leaked errors',async()=>{
  const run=code=>runSourceScript({code,variables:{},source:{}},async()=>null)
  await assert.rejects(run('throw new Error("本章为付费或锁定章节，请在番茄官方客户端阅读")'),e=>e.code==='SOURCE_CHAPTER_LOCKED'&&/未开放.*完整/.test(e.message)&&!e.message.includes('资源限制'))
  await assert.rejects(run('throw new Error("番茄字体映射已变化，已停止展示乱码正文")'),e=>e.code==='SOURCE_GLYPH_CHANGED')
  await assert.rejects(run('throw new Error("fixture-private-token")'),e=>e.code==='SCRIPT_ERROR'&&!e.message.includes('fixture-private-token')&&!e.message.includes('资源限制'))
  await assert.rejects(run('while(true){}'),e=>e.code==='SCRIPT_LIMIT')
  assert.equal(await run('1+1'),2)
})
test('six capabilities normalize; malformed literal wrapper is narrowly repaired; secret headers stay private',()=>{
  const s=normalizeSource({...sampleSource,header:{Cookie:'fixture_cookie=private'},searchUrl:"<js>/search,{'charset':'gbk','body':'q={{key}}','method':'POST'};result='';result;</js>",ruleContent:{content:'#content@text',replaceRegex:'##^{{book.durChapterTitle}}\\n'}})
  assert.equal(s.search.method,'POST');assert.ok(s.warnings.some(v=>v.includes('包装')));assert.equal(s.importCookie,'fixture_cookie=private');assert.ok(!JSON.stringify(s).includes('private'))
  assert.doesNotThrow(()=>normalizeSource({...sampleSource,ruleBookInfo:{kind:'a@text&&b@text@js:result[0]="value";result'}}))
  assert.throws(()=>normalizeSource({...sampleSource,searchUrl:'<js>/malformed;notValid{</js>'}),e=>e.code==='SCRIPT_INVALID')
})
test('FQWeb style object wildcards, middle scripts, runtime templates, sdk header and composed metadata work end to end',async t=>{
  const {store}=await fixture(t),requests=[]
  const raw={...sampleSource,bookSourceUrl:'https://fqweb.example.org',header:{'sdk-version':'1'},searchUrl:'/search?query={{key}}',
    ruleSearch:{bookList:'$.data.ret_data.*||$..book_data[*]',name:'$.book_name||$.title\n<js>java.put("book_id",java.getString("$.book_id"));result</js>\n##<em>|</em>|《|》',bookUrl:'https://details.example.org/book?id={{java.get("book_id")}}',author:'$.author'},
    ruleBookInfo:{init:'$.data[0]',name:'$.book_name',author:'$.author',intro:'开始：{{$.create_time##T.*}}{{"\\n"}}更新：{{java.timeFormat(java.getString("$.updated")*1000)}}@js:result.trim()',tocUrl:'https://directory.example.org/toc?id={{$..book_id}}'},
    ruleToc:{chapterList:'$.data.chapterListWithVolume.*.*',chapterName:'$.title',chapterUrl:'@js:source.bookSourceUrl+`/content?item_id={{$.itemId}}`'},ruleContent:{content:'$..content'}}
  const s=normalizeSource(raw),lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async(url,options)=>{requests.push({url,options});const p=new URL(url).pathname;return {url,text:JSON.stringify(p==='/search'?{data:{ret_data:[{book_id:'123',title:'《测试书》',author:'作者'}]}}:p==='/book'?{data:[{book_id:'123',book_name:'测试书',author:'作者',create_time:'2026-01-01T00:00:00',updated:1700000000}]}:p==='/toc'?{data:{chapterListWithVolume:{volume1:[{title:'第一章',itemId:'456'}]}}}:{data:{content:'正文'}})}}})
  const call=(route,method='GET',input={})=>lib.handle('alpha',route,method,input)
  const imported=await call('/sources/import','POST',{sources:raw});assert.equal(imported.accepted.length,1,JSON.stringify(imported.rejected))
  const results=await call('/search','POST',{key:'测试',sourceId:s.id});assert.equal(results.results[0].title,'测试书')
  const saved=await call('/books','POST',{ticket:results.results[0].ticket}),b=await call(`/books/${saved.id}`),chapter=await call(`/books/${saved.id}/chapters/${b.chapters[0].id}`)
  assert.equal(chapter.body,'正文');assert.match(saved.description,/开始：2026-01-01/);assert.ok(requests.some(r=>r.url.endsWith('item_id=456')));assert.equal(requests[0].options.headers['sdk-version'],'1')
})
test('simultaneous searches in the same account/source keep java.put/get variables request-local',async t=>{
  const {store}=await fixture(t);let arrived=0,release;const gate=new Promise(r=>{release=r})
  const raw={...sampleSource,searchUrl:'@js:java.put("book_id",key);java.ajax(baseUrl+"/hold");baseUrl+"/search?id="+java.get("book_id")',ruleSearch:{bookList:'$.books[*]',name:'$.name',bookUrl:'/book/{{$.name}}'}}
  const s=normalizeSource(raw),lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>{const u=new URL(url);if(u.pathname==='/hold'){if(++arrived===2)release();await gate;return {url,text:'ok'}}return {url,text:JSON.stringify({books:[{name:u.searchParams.get('id')}]})}}})
  await lib.handle('alpha','/sources/import','POST',{sources:raw})
  const [a,b]=await Promise.all(['A','B'].map(key=>lib.handle('alpha','/search','POST',{key,sourceId:s.id})))
  assert.equal(a.results[0].title,'A');assert.equal(b.results[0].title,'B')
  assert.ok(!store.db.prepare('SELECT sealed FROM network_source_auth').get(),'transient IDs never persist in shared source credentials')
})
test('credential storage is encrypted and isolated across accounts/sources, persists with stable key and cascades on deletion',async t=>{
  const {store}=await fixture(t),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-stable-key'}),s=normalizeSource(sampleSource)
  for(const owner of ['alpha','beta'])await lib.handle(owner,'/sources/import','POST',{sources:{...sampleSource,header:{Cookie:`session=${owner}-secret`}}})
  const auth=createSourceAuth(store.db,'fixture-stable-key'),a=auth.profile('alpha',s,()=>{}),b=auth.profile('beta',s,()=>{})
  assert.match(a.cookieJar.getCookieString(s.url),/alpha-secret/);assert.match(b.cookieJar.getCookieString(s.url),/beta-secret/)
  assert.equal(a.cookieJar.getCookieString('https://other.example.org'),'');assert.equal(a.cookieJar.getCookieString(s.url.replace('https:','http:')),'')
  assert.ok(!JSON.stringify(store.db.prepare('SELECT * FROM network_source_auth').all()).includes('alpha-secret'))
  assert.ok(!JSON.stringify(await lib.handle('alpha','/sources','GET')).includes('alpha-secret'))
  const meta=await lib.handle('alpha',`/sources/${s.id}/auth`,'GET');assert.equal(meta.hasCookie,true);assert.ok(!JSON.stringify(meta).includes('secret'))
  assert.match(createSourceAuth(store.db,'fixture-stable-key').profile('alpha',s,()=>{}).cookieJar.getCookieString(s.url),/alpha-secret/)
  a.setCookies(s.url,['expired=value; Max-Age=0; Path=/']);assert.ok(!a.cookieJar.getCookieString(s.url).includes('expired'))
  assert.throws(()=>a.setCookies(s.url,['bad=value; Domain=other.example.org']),/Cookie/)
  await lib.handle('alpha',`/sources/${s.id}`,'DELETE',{});assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_source_auth WHERE owner=?').get('alpha').n,0)
  assert.match(b.cookieJar.getCookieString(s.url),/beta-secret/)
  const rotated=createNetworkLibrary(store.db,{defaultSources:null,authKey:'rotated-key'})
  assert.equal((await rotated.handle('beta',`/sources/${s.id}/auth`,'GET')).resetRequired,true)
  await rotated.handle('beta',`/sources/${s.id}/auth`,'DELETE',{})
  assert.equal((await rotated.handle('beta',`/sources/${s.id}/auth`,'GET')).resetRequired,false)
  const invalid=await lib.handle('alpha','/sources/import','POST',{sources:{...sampleSource,header:{Cookie:'bad\r\nInjected=value'}}})
  assert.equal(invalid.rejected.length,1);assert.equal((await lib.handle('alpha','/sources','GET')).length,0,'invalid credential import rolls back the source too')
})
test('login UI parameters, actions, source variables and browser-required results are account-local and revocable',async t=>{
  const {store}=await fixture(t),raw={...sampleSource,loginUrl:'function getKey(){java.startBrowserAwait(source.bookSourceUrl+"/key","获取密钥")};function set(v){source.setVariable(v)}',loginUi:JSON.stringify([{name:'密钥',type:'text'},{name:'切换',type:'button',action:'set(2)'},{name:'获取密钥',type:'button',action:'getKey()'}])},s=normalizeSource(raw),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key'})
  for(const owner of ['alpha','beta'])await lib.handle(owner,'/sources/import','POST',{sources:raw})
  await lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{密钥:'private-key'},cookie:'sid=private-cookie'})
  await lib.handle('alpha',`/sources/${s.id}/auth/action`,'POST',{index:1})
  const a=await lib.handle('alpha',`/sources/${s.id}/auth`,'GET'),b=await lib.handle('beta',`/sources/${s.id}/auth`,'GET')
  assert.equal(a.hasVariable,true);assert.equal(a.ui[0].hasValue,true);assert.equal(b.hasVariable,false);assert.equal(b.ui[0].hasValue,false);assert.ok(!JSON.stringify(a).includes('private'));assert.equal(a.variable,undefined)
  const browser=await lib.handle('alpha',`/sources/${s.id}/auth/action`,'POST',{index:2});assert.equal(browser.openUrl,s.url+'/key')
  await assert.rejects(lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{密钥:'new'}},()=>{throw Object.assign(Error('revoked'),{status:401})}),/revoked/)
})
test('script DOM lists, preprocessing, capture substitution, indexed assignment and dynamic chapter-title replacement',async t=>{
  const {store}=await fixture(t),lib=createNetworkLibrary(store.db,{defaultSources:null}),s=normalizeSource(sampleSource)
  await lib.handle('alpha','/sources/import','POST',{sources:sampleSource})
  const runtime=createSourceRuntime(s,{fetchPage:mockSourceFetcher(),profile:createSourceAuth(store.db,'key').profile('alpha',s,()=>{}),signal:AbortSignal.timeout(10000),active:()=>{}})
  const doc=document('<ul><li><a href="/book/1">测试</a></li></ul>',{baseUrl:s.url,sourceUrl:s.url})
  const rows=await runtime.list(doc,"@js:java.put('url',baseUrl);java.getElement('li')")
  assert.equal(rows.length,1);assert.equal(await runtime.text(rows[0],'a@href'),'/book/1')
  assert.equal(await runtime.text(doc,'<js>"{\\"data\\":{\\"content\\":\\"正文\\"}}"</js>$.data.content'),'正文')
  assert.equal(await runtime.text({...doc,captures:['','7','标题','88']},"@js:var id='42';'https://example.org/'+id+'/$3/'"),'https://example.org/42/88/')
  runtime.setBook({durChapterTitle:'第1章 [门] (上)'})
  assert.equal(await runtime.content(document('<div id=content>第1章 [门] (上)\n正文</div>',{baseUrl:s.url}),{content:'#content@text',replaceRegex:'##^{{book.durChapterTitle}}\\n'}),'正文')
  assert.equal(await runtime.text(document('<a>.作者.书名.悬疑</a><b>完结</b>',{baseUrl:s.url}),'a@text&&b@text@js:result[0]=result[0].replace(`.${book.author}`,"").replace(`.${book.name}`,"");result'),'.作者.书名.悬疑\n完结')
})
test('JSON recursive search, login script library, async TOC, virtual ID content and secret API parameter work end to end',async t=>{
  const {store}=await fixture(t),requests=[]
  const raw={...sampleSource,bookSourceUrl:'https://library.example.org',searchUrl:'@js:function search(key){return baseUrl+"/search?q={{key}}&p={{(page-1)*50}}"};search(key)',
    loginUrl:'function Map(k){return source.getLoginInfoMap()[k]};var option="";if(!source.getVariable())source.setVariable(1);',loginUi:[{name:'密钥',type:'text'}],
    ruleSearch:{bookList:'$..book_data[0]',name:'$.title',author:'$.author',bookUrl:'https://library.example.org/book/{{$.id}}'},
    ruleBookInfo:{init:'$.data[0]',tocUrl:'$.id@js:java.put("id",result);source.bookSourceUrl+"/toc"'},
    ruleToc:{chapterList:'<js>eval(String(source.loginUrl));var rows=JSON.parse(result).data.allItemIds;rows.map(id=>({name:"第一章",url:`data:;base64,${java.base64Encode(id)},{"type":"pyfqc"}`}))</js>',chapterName:'name',chapterUrl:'url'},
    ruleContent:{content:'<js>eval(String(source.loginUrl));java.get(source.bookSourceUrl+"/content?id="+java.hexDecodeToString(result)+"&key="+Map("密钥"),{"Content-Type":"application/json"}).body()</js>$.data.content'}}
  const s=normalizeSource(raw),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key',fetchPage:async(url,options)=>{
    requests.push({url,options});const u=new URL(url)
    return {url,text:JSON.stringify(u.pathname==='/search'?{data:[{book_data:[{id:'123',title:'测试书',author:'作者'}]}]}:u.pathname==='/book/123'?{data:[{id:'123'}]}:u.pathname==='/toc'?{data:{allItemIds:['456']}}:{data:{content:'真实正文'}})}
  }})
  const call=(route,method='GET',input={})=>lib.handle('alpha',route,method,input)
  const imported=await call('/sources/import','POST',{sources:raw});assert.equal(imported.accepted.length,1)
  await call(`/sources/${s.id}/auth`,'PUT',{params:{密钥:'fixture-key'}})
  const search=await call('/search','POST',{key:'书名',page:2});assert.equal(search.results.length,1,JSON.stringify(search.errors))
  const saved=await call('/books','POST',{ticket:search.results[0].ticket});assert.equal(saved.chapterCount,1)
  const b=await call(`/books/${saved.id}`),body=await call(`/books/${saved.id}/chapters/${b.chapters[0].id}`)
  assert.equal(body.body,'真实正文');assert.ok(requests.some(r=>r.url.includes('p=50')));assert.ok(requests.some(r=>r.url.includes('id=456&key=fixture-key')))
  assert.equal(virtualPayload('data:;base64,PHNjcmlwdD4=,{"type":"pyfqc"}',{virtualChapters:false}),null)
  assert.throws(()=>virtualPayload('data:;base64,PHNjcmlwdD4=,{"type":"pyfqc"}',{virtualChapters:true}),/标识/)
})

test('selector interpolation remains data in scripts; outer replacements and content pipelines execute in order',async t=>{
  const {store}=await fixture(t),s=normalizeSource(sampleSource)
  const runtime=createSourceRuntime(s,{fetchPage:mockSourceFetcher(),profile:createSourceAuth(store.db,'key').profile('alpha',s,()=>{}),signal:AbortSignal.timeout(10000),active:()=>{}})
  const doc=document(JSON.stringify({Id:1234,evil:"'; throw Error('injected'); //"}),{baseUrl:s.url})
  assert.equal(await runtime.text(doc,"<js>Math.floor({{$.Id}}/1000)</js>/book/{{result}}/{{$.Id}}"),'/book/1/1234')
  assert.equal(await runtime.text(doc,"@js:'{{$.evil}}'"),"'; throw Error('injected'); //")
  assert.equal(await runtime.text(document('<p>简介：内容</p>'),'p@text##简介：@js:result+"。"##。##！'),'内容！')
  runtime.setBook({name:'a.*(b)',durChapterTitle:'标题[一]'})
  const body=await runtime.content(document('<div id=content>a.*(b)\n标题[一]\n正文。</div>'),{content:'#content@text',replaceRegex:'##{{book.name}}|{{title}}@js:result.trim()+"末尾"##末尾##结束'})
  assert.equal(body,'正文。结束')
  normalizeSource({...sampleSource,ruleContent:{content:'#content@text',replaceRegex:'##{{book.name}}|{{title}}@js:result.trim()+"末尾"##末尾##结束'}})
})
