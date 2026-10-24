import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createCipheriv,randomBytes} from 'node:crypto'
import {normalizeSource,document,ruleText} from '../reader-service/source-rules.js'
import {sourceRequest} from '../reader-service/source-request.js'
import {portableSourceRegex} from '../reader-service/source-regex.js'
import {renderSourcePage} from '../reader-service/source-browser.js'
import {createSourceRuntime} from '../reader-service/source-runtime.js'
import {createSourceAuth} from '../reader-service/source-auth.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {credentialTemplate,hasEmbeddedCredentials,buildDefaultCatalog} from '../scripts/build-reader-default-sources.mjs'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'
import {searchRequest} from '../reader-service/source-rules.js'
import catalog from '../reader-service/default-sources.json' with {type:'json'}

async function fixture(t,raw=sampleSource){
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-remaining-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close());for(const username of ['alpha','beta'])await store.saveAccount({username,password:'fixture-only-password'})
  const library=createNetworkLibrary(store.db,{defaultSources:null}),s=normalizeSource(raw)
  await library.handle('alpha','/sources/import','POST',{sources:raw})
  const profile=createSourceAuth(store.db,'fixture-key').profile('alpha',s,()=>{})
  return {store,s,profile,runtime:createSourceRuntime(s,{profile,fetchPage:mockSourceFetcher(),signal:AbortSignal.timeout(15000),active:()=>{}})}
}

test('request options survive canonical links, validate every option and never turn into URL query data',()=>{
  const s=normalizeSource(sampleSource),r=sourceRequest('/chapter/1,{"webView":true}',s)
  assert.equal(r.url,s.url+'/chapter/1');assert.equal(r.options.webView,true);assert.equal(sourceRequest(r.link,s).link,r.link)
  for(const value of ['/c,{webView:"yes"}','/c,{proxy:"http://localhost"}','/c,{headers:{Host:"bad"}}','http://127.0.0.1/c,{webView:true}','https://other.example.org/c,{webView:true}'])assert.throws(()=>sourceRequest(value,s))
  assert.throws(()=>sourceRequest('/c,{method:"GET",body:"secret"}',s))
  assert.throws(()=>sourceRequest('https://cdn.example.org/c,{headers:{Cookie:"private"}}',{...s,allowedOrigins:['https://cdn.example.org']}))
})

test('plain source aliases use explicit absolute search origins while retaining their pending catalog ID',()=>{
  const s=normalizeSource({...sampleSource,bookSourceUrl:'API-2#',searchUrl:'https://api.example.org/search?key={{key}}'})
  assert.equal(s.url,'https://api.example.org');assert.equal(s.identity,'API-2#');assert.equal(s.id,digest('invalid-source:API-2#').slice(0,32))
  for(const value of ['https://127.0.0.1/search','file:///secret','/relative'])assert.throws(()=>normalizeSource({...sampleSource,bookSourceUrl:'API-2#',searchUrl:value}))
})

test('verified site migrations use the exact current search origin without losing POST or changing source identity',()=>{
  for(const [oldOrigin,newOrigin]of [['https://www.sudugu.co','https://www.sudugu.cc'],['https://m.aitbooks.com','https://m.aitbooks.cc']]){
    const s=normalizeSource({...sampleSource,bookSourceUrl:oldOrigin}),request=searchRequest(s,'测试',1)
    assert.equal(s.id,digest(oldOrigin).slice(0,32));assert.equal(new URL(request.url).origin,newOrigin)
    assert.equal(request.method,'POST');assert.ok(request.body.includes('searchkey='));assert.deepEqual(s.allowedOrigins,[newOrigin])
  }
})

test('exact-search redirects to a detail page require both book identity and a real TOC before creating a result',async t=>{
  const {store}=await fixture(t),raw={...sampleSource,novelStudioDirectBookResult:true,searchUrl:'/search',ruleSearch:{bookList:'.search-result',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{name:'h1@text',author:'.author@text'},ruleToc:{chapterList:'#list a',chapterName:'text',chapterUrl:'href'}}
  let bookPage=true
  const library=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>({url:'https://books.example.org/book/1',text:bookPage?'<h1>精确搜索书</h1><p class=author>作者</p><div id=list><a href=/chapter/1>第一章</a></div>':'<h1>网站导航</h1><a href=/other>推荐内容</a>'})})
  await library.handle('alpha','/sources/import','POST',{sources:raw});const source=normalizeSource(raw)
  const first=await library.handle('alpha','/search','POST',{sourceId:source.id,key:'精确搜索书'});assert.equal(first.results.length,1);assert.equal(first.results[0].title,'精确搜索书');assert.equal(first.results[0].url,'https://books.example.org/book/1')
  bookPage=false;assert.equal((await library.handle('alpha','/search','POST',{sourceId:source.id,key:'不存在'})).results.length,0)
})

test('verified Sudugu duplicate placeholders keep the first chapter ID but read the newer nonempty record',async t=>{
  const {store}=await fixture(t),raw={...sampleSource,bookSourceUrl:'https://www.sudugu.co',searchUrl:'/search',ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{name:'h1@text'},ruleToc:{chapterList:'#list a',chapterName:'text',chapterUrl:'href'}},requested=[]
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-key',fetchPage:async url=>{const p=new URL(url).pathname;requested.push(p)
    return {url,text:p==='/search'?'<li><a href=/book>测试书</a></li>':p==='/book'?'<h1>测试书</h1><div id=list><a href=/book/100.html>第1章 标题</a><a href=/book/101.html>第1章 标题</a><a href="javascript:void(0);">敬请期待</a></div>':p.endsWith('/101.html')?'<div id=content>完整模拟正文</div>':'<div id=content></div>'}
  }})
  await library.handle('alpha','/sources/import','POST',{sources:raw});const item=(await library.handle('alpha','/search','POST',{key:'测试'})).results[0],book=await library.handle('alpha','/books','POST',{ticket:item.ticket})
  assert.equal(book.chapterCount,1);assert.ok(book.chapters[0].url.endsWith('/101.html'))
  const body=await library.handle('alpha',`/books/${book.id}/chapters/${book.chapters[0].id}`,'GET',{});assert.equal(body.body,'完整模拟正文');assert.ok(!requested.includes('/book/100.html'))
  const refreshed=await library.handle('alpha',`/books/${book.id}/refresh`,'POST',{});assert.equal(refreshed.chapters[0].id,book.chapters[0].id);assert.equal(refreshed.chapters[0].url,book.chapters[0].url)
  const health=await library.handle('alpha','/sources/check','POST',{ids:[normalizeSource(raw).id],key:'测试'});assert.equal(health.results[0].status,'healthy');assert.ok(!requested.includes('/book/100.html'))
})

test('Java inline flags retain lexical scope, groups, captures and long replacements stay isolated',async t=>{
  const pattern=portableSourceRegex('before|(?mi)^ad[A-Z]+$|(?-i:XyZ)')
  const re=new RegExp(pattern,'g');assert.deepEqual('before\nADxyz\nxyz\nXyZ\nBEFORE'.match(re),['before','ADxyz','XyZ'])
  assert.equal(new RegExp(portableSourceRegex('x(?s:.+)z')).test('x\ny\nz'),true)
  const long='(?mi)^广告(?<=告)(?:'+Array.from({length:100},(_,i)=>'词'+i).join('|')+')$'
  const {s,runtime}=await fixture(t,{...sampleSource,ruleContent:{content:'#content@text',replaceRegex:'##'+long}})
  assert.match(s.rules.ruleContent.replaceRegex,/<js>/)
  assert.equal(await runtime.content(document('<div id=content>正文\n广告词99\n结尾</div>'),s.rules.ruleContent),'正文\n\n结尾')
})

test('dynamic cookie handling is not a bundled credential; shared literals become empty account fields',()=>{
  assert.equal(hasEmbeddedCredentials({...sampleSource,ruleContent:{content:'<js>cookie.setCookie(baseUrl,java.get("cookie"));result</js>'}}),false)
  assert.equal(hasEmbeddedCredentials({...sampleSource,ruleContent:{content:'<js>cookie.setCookie(baseUrl,"sid=shared-value");result</js>'}}),true)
  const raw={...sampleSource,searchUrl:'@js:var sign_key="fixture-key-never-share"; "/search?sign="+java.md5Encode(sign_key)',ruleContent:{content:'<js>result</js>'}}
  const safe=credentialTemplate(raw);assert.equal(hasEmbeddedCredentials(safe),false);assert.equal(safe.novelStudioLoginRequired,true)
  assert.deepEqual(safe.loginUi,[{name:'sign_key',type:'password'}]);assert.ok(!JSON.stringify(safe).includes('fixture-key-never-share'))
  const pack=buildDefaultCatalog([[raw]],{version:'old',sources:[],rejected:[]},{freshRules:true});assert.equal(pack.unavailable.length,0)
})

test('response header/cookie bridges and AES data are limited to the current account and source',async t=>{
  const {s,profile}=await fixture(t);profile.setCookies(s.url,['sid=alpha; Secure; HttpOnly'])
  const key='fixture-key-1234',iv=randomBytes(16),cipher=createCipheriv('aes-128-cbc',Buffer.from(key),iv),encoded=Buffer.concat([iv,cipher.update('模拟正文'),cipher.final()]).toString('base64')
  const runtime=createSourceRuntime(s,{profile,fetchPage:async url=>({url,text:'response',headers:{token:'fixture-token'}}),signal:AbortSignal.timeout(10000),active:()=>{}})
  assert.equal(await runtime.text(document('',{baseUrl:s.url}),'<js>var r=java.get(baseUrl);r.body()+":"+r.header("TOKEN")+":"+r.cookie("sid")</js>'),'response:fixture-token:alpha')
  assert.equal(await runtime.text(document('',{baseUrl:s.url}),`<js>java.aesDecryptToString(${JSON.stringify(encoded)},${JSON.stringify(key)})</js>`),'模拟正文')
  await assert.rejects(runtime.text(document('',{baseUrl:s.url}),'<js>java.aesDecryptToString("bad","bad")</js>'))
  await assert.rejects(runtime.text(document('',{baseUrl:s.url}),'<js>java.getVerificationCode(baseUrl)</js>'),e=>e.code==='BROWSER_VERIFICATION_REQUIRED')
  const cookies=profile.cookieJar.browserCookies(s.url);assert.equal(cookies[0].httpOnly,true);assert.equal(cookies[0].secure,true)
  assert.equal(profile.cookieJar.browserCookies('https://other.example.org').length,0)
})

test('volume headers are not added as chapters; request options persist through directory and idempotence',async t=>{
  const {store}=await fixture(t),raw={...sampleSource,searchUrl:'/search',ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{},ruleToc:{chapterList:'dl@children',isVolume:'<js>String(result).startsWith("<dt")</js>',chapterName:'text',chapterUrl:'a@href'}}
  const library=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>({url,text:new URL(url).pathname==='/search'?'<li><a href=/book>测试书</a></li>':'<dl><dt>分卷</dt><dd><a href="/c,{&quot;webView&quot;:true}">第一章</a></dd></dl>'})})
  await library.handle('alpha','/sources/import','POST',{sources:raw});const item=(await library.handle('alpha','/search','POST',{key:'测试'})).results[0]
  const book=await library.handle('alpha','/books','POST',{ticket:item.ticket});assert.equal(book.chapterCount,1);assert.match(book.chapters[0].url,/,\{"webView":true\}$/)
  assert.equal((await library.handle('alpha','/books','POST',{ticket:item.ticket})).id,book.id)
})

test('configured API source executes search/detail/toc/AES content without fetching dummy chapter IDs or sharing keys',async t=>{
  const {store}=await fixture(t),s=catalog.sources.find(s=>s.name.includes('七猫')),seen=[]
  assert.ok(s.scriptOnlyContent)
  const key='fixture-key-1234',iv=randomBytes(16),cipher=createCipheriv('aes-128-cbc',Buffer.from(key),iv),encoded=Buffer.concat([iv,cipher.update('模拟首章正文'),cipher.final()]).toString('base64')
  const library=createNetworkLibrary(store.db,{authKey:'fixture-key',defaultSources:{version:'api-fixture',name:'api-fixture',sources:[s],rejected:[]},fetchPage:async(url,options)=>{
    const path=new URL(url).pathname;seen.push({path,options})
    let data
    if(path==='/api/v5/search/words')data={books:[{id:1,original_title:'模拟书',original_author:'作者'}]}
    else if(path==='/api/v4/book/detail')data={book:{id:1,title:'模拟书',author:'作者',intro:'简介'}}
    else if(path==='/api/v1/chapter/chapter-list')data={chapter_lists:[{id:100,title:'第一章'}]}
    else if(path==='/api/v1/chapter/content')data={content:encoded}
    else assert.fail('dummy chapter or unrelated URL fetched: '+path)
    return {url,text:JSON.stringify({data})}
  }})
  const call=(owner,route,method='GET',input={})=>library.handle(owner,route,method,input)
  assert.equal((await call('alpha','/search','POST',{sourceId:s.id,key:'模拟书'})).errors[0].code,'SOURCE_LOGIN_REQUIRED')
  await call('alpha',`/sources/${s.id}/auth`,'PUT',{params:{sign_key:'fixture-sign',content_key:key}})
  const search=await call('alpha','/search','POST',{sourceId:s.id,key:'模拟书'});assert.deepEqual(search.errors,[])
  const book=await call('alpha','/books','POST',{ticket:search.results[0].ticket});assert.equal(book.chapterCount,1)
  const chapter=await call('alpha',`/books/${book.id}/chapters/${book.chapters[0].id}`);assert.equal(chapter.body,'模拟首章正文')
  assert.equal(seen.length,4);assert.equal((await call('beta','/search','POST',{sourceId:s.id,key:'模拟书'})).errors[0].code,'SOURCE_LOGIN_REQUIRED')
  assert.ok(!JSON.stringify(catalog).includes('fixture-sign'))
})

test('phone source repairs stale entry/list/toc/content and checks the real encoded search minimum',async t=>{
  const raw={...sampleSource,bookSourceName:'手机小说',bookSourceUrl:'https://www.shoujix.com',searchUrl:'/modules/article/search.php,{method:"POST",charset:"gbk",body:"searchkey={{key}}"}',ruleSearch:{bookList:'class.novel-item',name:'img@alt',bookUrl:'a@href'},ruleToc:{chapterList:'//div[@id="lbks"]/dl/dt[last()]/following-sibling::dd/a',chapterName:'text',chapterUrl:'href'},ruleContent:{content:'id.zjny@html'}}
  const {store,s}=await fixture(t,raw),title='模拟长书名测试'
  const library=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async(url,options)=>{
    const path=new URL(url).pathname
    if(path==='/search/'){assert.equal(options.method,'POST');return {url,text:`<li><span class=s2><a href=/book>${title}</a></span><span class=s4>作者</span></li>`}}
    if(path==='/book')return {url,text:`<div id=info><h1>${title}</h1><p>作 者：作者</p></div><div id=list><dl><dt>最新</dt><dd><a href=/chapter/9>最新章</a></dd><dt>正文</dt><dd><a href=/chapter/1>第一章</a></dd></dl></div>`}
    return {url,text:'<article id=content>模拟正文</article>'}
  }})
  const call=(route,method='GET',input={})=>library.handle('alpha',route,method,input)
  const short=await call('/search','POST',{sourceId:s.id,key:'系统'});assert.equal(short.errors[0].code,'SEARCH_TERM_TOO_SHORT')
  const search=await call('/search','POST',{sourceId:s.id,key:title});assert.deepEqual(search.errors,[])
  const book=await call('/books','POST',{ticket:search.results[0].ticket});assert.equal(book.chapterCount,1);assert.equal(book.chapters[0].title,'第一章')
  assert.equal((await call(`/books/${book.id}/chapters/${book.chapters[0].id}`)).body,'模拟正文')
})

test('long TOCs join promptly, resume after restart, retain loaded chapters on failure, and isolate accounts',async t=>{
  const {store}=await fixture(t);let failPage=0
  const raw={...sampleSource,searchUrl:'/search',ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{tocUrl:'a.toc@href'},ruleToc:{chapterList:'.chapters a',chapterName:'text',chapterUrl:'href',nextTocUrl:'a.next@href'}}
  const fetchPage=async url=>{const path=new URL(url).pathname
    if(path==='/search')return {url,text:'<li><a href=/book>长目录测试</a></li>'}
    if(path==='/book')return {url,text:'<a class=toc href=/toc/1>目录</a>'}
    if(path.startsWith('/toc/')){const n=Number(path.split('/').pop());if(n===failPage)throw Object.assign(Error('temporary fixture failure'),{status:502,code:'READ_FAILED'});return {url,text:`<div class=chapters><a href=/chapter/${n}>第${n}章</a></div>${n<13?`<a class=next href=/toc/${n+1}>下一页</a>`:''}`}}
    return {url,text:'<div id=content>模拟正文。</div>'}
  }
  let library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'persistent-fixture-key',fetchPage})
  const call=(route,method='GET',input={})=>library.handle('alpha',route,method,input)
  await call('/sources/import','POST',{sources:raw});const item=(await call('/search','POST',{key:'测试'})).results[0]
  const first=await call('/books','POST',{ticket:item.ticket});assert.equal(first.chapterCount,5);assert.equal(first.tocIncomplete,true)
  assert.equal((await call('/books','POST',{ticket:item.ticket})).id,first.id)
  library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'persistent-fixture-key',fetchPage})
  const restored=await call('/books/'+first.id);assert.equal(restored.tocPagesLoaded,5);assert.equal(restored.tocIncomplete,true)
  const second=await call('/books/'+first.id+'/refresh','POST');assert.equal(second.chapterCount,10);assert.equal(second.tocIncomplete,true)
  failPage=11;await assert.rejects(call('/books/'+first.id+'/refresh','POST'),e=>e.code==='READ_FAILED')
  const preserved=await call('/books/'+first.id);assert.equal(preserved.chapterCount,10);assert.equal(preserved.revision,second.revision)
  failPage=0;const complete=await call('/books/'+first.id+'/refresh','POST');assert.equal(complete.chapterCount,13);assert.equal(complete.tocIncomplete,false)
  assert.equal(new Set(complete.chapters.map(c=>c.id)).size,13)
  assert.match((await call(`/books/${first.id}/chapters/${first.chapters[0].id}`)).body,/模拟正文/)
  await assert.rejects(library.handle('beta','/books/'+first.id,'GET',{}),e=>e.status===404)
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM network_books').get().n,1)
})

const browserPath=process.env.READER_CHROMIUM_PATH
test('real browser renders inline/external JS through checked transport and never fetches private or undeclared origins',{skip:!browserPath},async()=>{
  const source=normalizeSource(sampleSource),seen=[],initial={url:source.url+'/chapter',text:'<div id=content>原文</div><script src="/app.js"></script>'}
  const loaded=await renderSourcePage({initial,source,executablePath:browserPath,signal:AbortSignal.timeout(15000),webJs:'document.querySelector("#content").innerHTML',fetchResource:async url=>{seen.push(url);return {url,type:'application/javascript',text:'document.querySelector("#content").textContent="渲染正文"'}}})
  assert.equal(loaded.webJsOutput,'渲染正文');assert.equal(ruleText(document(loaded.text),'#content@text'),'渲染正文');assert.equal(seen.length,1)
  const withoutAd=await renderSourcePage({initial:{...initial,text:'<div id=content>有效正文</div><script src="https://ads.example.net/tracker.js"></script>'},source,executablePath:browserPath,signal:AbortSignal.timeout(15000),webJs:'document.querySelector("#content").textContent',fetchResource:()=>assert.fail('undeclared ad must remain blocked')})
  assert.equal(withoutAd.webJsOutput,'有效正文');assert.equal(withoutAd.resourceError.code,'ORIGIN_BLOCKED')
  await assert.rejects(renderSourcePage({initial:{...initial,text:'<script src="http://127.0.0.1/private"></script>'},source,executablePath:browserPath,signal:AbortSignal.timeout(15000),fetchResource:()=>assert.fail('private resource must not reach transport')}),/公网/)
  await assert.rejects(renderSourcePage({initial:{...initial,text:'<title>Just a moment...</title>'},source,executablePath:browserPath,signal:AbortSignal.timeout(15000),fetchResource:()=>assert.fail()}),e=>e.code==='VERIFICATION_PAGE')
})
