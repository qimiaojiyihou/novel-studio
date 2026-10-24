import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {document,ruleList,ruleText,normalizeSource,searchRequest,checkedDocument} from '../reader-service/source-rules.js'
import {checkExpression,textExpression} from '../reader-service/source-expression.js'
import {checkSourceOrigin} from '../reader-service/source-fetch.js'
import {openReaderStore} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {sampleSource} from './fixtures/network-source.js'

test('Legado bracket slices include endpoints and preserve explicit order, legacy colons remain index lists',()=>{
  const doc=document('<ul>'+Array.from({length:6},(_,i)=>`<li><a href="/${i}">${i}</a></li>`).join('')+'</ul>')
  assert.equal(ruleText(doc,'li[0:2]@text'),'0\n1\n2')
  assert.equal(ruleText(doc,'li[-1:0]@text'),'5\n4\n3\n2\n1\n0')
  assert.equal(ruleText(doc,'li[1:5:2]@text'),'1\n3\n5')
  assert.equal(ruleText(doc,'li[-1,0:2,1]@text'),'5\n0\n1\n2')
  assert.equal(ruleText(doc,'li[!0:2,-1]@text'),'3\n4')
  assert.equal(ruleText(doc,'li[:2]@text'),'0\n1\n2')
  assert.equal(ruleText(doc,'li[3:]@text'),'3\n4\n5')
  assert.equal(ruleText(doc,'li.0:2@text'),'0\n2')
  assert.equal(ruleText(doc,'ul@children[-1:0]@a@text'),'5\n4\n3\n2\n1\n0')
  assert.equal(ruleText(doc,'li@text'),'0\n1\n2\n3\n4\n5','exclusion must not mutate DOM')
  assert.throws(()=>normalizeSource({...sampleSource,ruleToc:{...sampleSource.ruleToc,chapterList:'li[0:2:0]'}}),e=>e.code==='RULE_UNSUPPORTED')
})

test('XPath metadata, predicates, sibling axes and item contexts work alongside CSS fallback',()=>{
  const doc=document(`<html><head><meta property="og:novel:book_name" content="测试书"><meta property="og:novel:author" content="作者"></head><body><div id="list"><dl><dt>最新</dt><dd><a href="/duplicate">旧入口</a></dd><dt>正文</dt><dd><a href="/1">第一章</a></dd><dd><a href="/2">第二章</a></dd></dl></div><div class="prenext"><span><a href="/3">下一页</a></span></div></body></html>`)
  assert.equal(ruleText(doc,"//meta[@property='og:novel:book_name']/@content"),'测试书')
  assert.equal(ruleText(doc,"@XPath://meta[@property='missing']/@content||//meta[@property='og:novel:author']/@content"),'作者')
  assert.equal(ruleText(doc,"//meta[@property='og:novel:book_name' or @property='og:novel:author']/@content"),'测试书\n作者')
  assert.equal(ruleText(doc,"//div[@class='prenext']/span/a[text()='下一页']/@href"),'/3')
  const rows=ruleList(doc,'//div[@id="list"]/dl/dt[last()]/following-sibling::dd/a')
  assert.equal(rows.length,2);assert.equal(ruleText(rows[0],'text'),'第一章');assert.equal(ruleText(rows[1],'href'),'/2')
  assert.equal(ruleText(rows[1],'./@href'),'/2')
  assert.equal(ruleText(doc,'#missing@text||//meta[@property="og:novel:author"]/@content'),'作者')
  assert.throws(()=>normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,name:'//a[count(//*)>0]'}}),e=>e.code==='RULE_UNSUPPORTED')
})

test('rule splitting respects quoted attributes, XPath predicates and JSON/CSS templates',()=>{
  const doc=document('<a data-email="a@b" data-x="x||y">邮箱</a><p>简介</p>')
  assert.equal(ruleText(doc,'[data-email="a@b"]@text'),'邮箱')
  assert.equal(ruleText(doc,'[data-x="x||y"]@text'),'邮箱')
  assert.equal(ruleText(doc,'正文：{{@@p@text}}'),'正文：简介')
  assert.equal(ruleText(doc,'正文：{{@@p@text}}##简介##介绍'),'正文：介绍')
  assert.equal(ruleText(doc,"{{'第一行'+'\\n'}}{{@@p@text}}"),'第一行\n简介')
  const json=document('{"book_id":123,"chapter_id":456}')
  assert.equal(ruleText(json,'/novels/api/book/{{$.book_id}}/chapters/{{$.chapter_id}}'),'/novels/api/book/123/chapters/456')
  normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,bookUrl:'/book/{{$.id}}'}})
})

test('wide XPath directories preserve all 5000 chapters and stable element/attribute document order',()=>{
  const doc=document('<div id=list>'+Array.from({length:5000},(_,i)=>`<a href="/chapter/${i+1}">第${i+1}章</a>`).join('')+'</div>')
  const rows=ruleList(doc,'//div[@id="list"]/a')
  assert.equal(rows.length,5000)
  assert.equal(ruleText(rows[0],'href'),'/chapter/1');assert.equal(ruleText(rows[2499],'href'),'/chapter/2500');assert.equal(ruleText(rows[4999],'href'),'/chapter/5000')
  assert.equal(ruleText(doc,'//a[position()<=2] | //a[position()<=2]/@href'),'第1章\n/chapter/1\n第2章\n/chapter/2')
})

test('pure script expressions extract links, replace text and use bounded local variables',()=>{
  const doc=document('<li onclick="openBook(\'/book/1\', \'\', \'\')"><b>书名</b></li>',{baseUrl:'https://example.org/list',sourceUrl:'https://example.org'})
  const row=ruleList(doc,'li')[0]
  assert.equal(ruleText(row,"@onclick@js:result.match(/\\('(.*?)', '', ''\\)/)[1]"),'/book/1')
  assert.equal(ruleText(row,"b@text@js:result.replace(/书/g,'新')"),'新名')
  assert.equal(ruleText(row,"@js:baseUrl.replace('/list','/toc')"),'https://example.org/toc')
  assert.equal(textExpression("let id=result.match(/(\\d+)/)[1];book.origin+'/book/'+id;",{result:'/x/123',book:{origin:'https://example.org'}}),'https://example.org/book/123')
  assert.equal(textExpression("/a/.test(result)?result.toUpperCase():''",{result:'abc'}),'ABC')
  assert.equal(textExpression("url=baseUrl+'/toc'; result=url;",{baseUrl:'https://example.org'}),'https://example.org/toc')
  assert.equal(textExpression("result.replace(/(a)/g,'$1$1')",{result:'aba'}),'aabaa')
  for(const code of ['while(true){}','process.exit()','fetch(baseUrl)','java.ajax(baseUrl)',"result.constructor('return process')()",'if(false){java.ajax(baseUrl)}','eval(result)'])assert.throws(()=>checkExpression(code),e=>e.code==='RULE_UNSUPPORTED',code)
  assert.throws(()=>textExpression("result['con'+'structor']",{result:'x'}),e=>e.code==='RULE_UNSUPPORTED')
  assert.throws(()=>textExpression("result.replace(/x/g,'y'.replace(/y/,'z'))",{result:'x'.repeat(2*1024*1024+1)}),e=>e.code==='RULE_UNSUPPORTED')
})

test('static request headers and pure URL expressions preserve encoding and classify unsupported operations',()=>{
  const s=normalizeSource({...sampleSource,header:{Connection:'Close'},searchUrl:"/search, {method:'post',charset:'gbk',body:'q={{key}}&p={{page}}',headers:{'User-Agent':'Fixture/1','Referer':'https://books.example.org/'}}"})
  const request=searchRequest(s,'测试',2)
  assert.equal(request.headers['user-agent'],'Fixture/1');assert.equal(request.method,'POST');assert.equal(request.body,'q=%B2%E2%CA%D4&p=2');assert.ok(!('connection' in request.headers))
  const pure=normalizeSource({...sampleSource,searchUrl:"@js:baseUrl+'/search?q={{key}}&p={{page}}'"})
  assert.equal(searchRequest(pure,'测试',3).url,'https://books.example.org/search?q=%E6%B5%8B%E8%AF%95&p=3')
  const login=normalizeSource({...sampleSource,loginUrl:'https://books.example.org/login'})
  assert.ok(login.warnings.some(w=>w.includes('登录入口')))
  assert.ok(!JSON.stringify(normalizeSource({...sampleSource,header:{Cookie:'sensitive'}})).includes('sensitive'))
  assert.ok(normalizeSource({...sampleSource,searchUrl:"@js:java.ajax(baseUrl)"}).search.script)
})

test('origin policy permits only same-host HTTPS upgrade and still rejects cross-host and downgrade',()=>{
  assert.doesNotThrow(()=>checkSourceOrigin(new URL('https://example.org/x'),'http://example.org'))
  assert.throws(()=>checkSourceOrigin(new URL('http://example.org/x'),'https://example.org'),e=>e.code==='ORIGIN_BLOCKED')
  assert.throws(()=>checkSourceOrigin(new URL('https://example.org.evil.test/x'),'http://example.org'),e=>e.code==='ORIGIN_BLOCKED')
  assert.throws(()=>checkedDocument('<title>404 Not Found</title><p>error</p>'),e=>e.code==='ERROR_PAGE')
  assert.doesNotThrow(()=>checkedDocument('<title>第404章 页面不存在</title><p>正文</p>'))
})

test('JSON prefixes, shorthand, slices and restricted filters preserve values and reject executable predicates',()=>{
  const doc=document(JSON.stringify({data:[{id:0,hasContent:false,source:'a'},{id:1,hasContent:true,source:'b'},{id:2,source:'a'}]}))
  assert.equal(ruleText(doc,'@JSON:$.data[:2].id'),'0\n1')
  assert.equal(ruleText(doc,'.data[-1].id'),'2')
  assert.equal(ruleText(doc,'$.data[::-1].id'),'2\n1\n0')
  assert.equal(ruleText(doc,'$.data[0:0].id'),'')
  assert.equal(ruleText(doc,"$.data[?(@.source == 'a')].id"),'0\n2')
  assert.equal(ruleText(doc,'$.data[?(@.hasContent)].id'),'0\n1','existence tests include false values')
  const list=ruleList(document('[{"id":1},{"id":2}]'),"@JSON:$.[?(@.id >= 2)]")
  assert.equal(list.length,1);assert.equal(ruleText(list[0],'$.id'),'2')
  assert.equal(ruleList(doc,'.data[*]').length,3)
  assert.equal(ruleText(document('{"books":[{"id":1},{"id":2}]}'),'$..id'),'1\n2','recursive JSON traversal keeps source order')
  for(const rule of ['$.data[::0]','$.data[?(@.id.constructor())]','$.data[?(@.id == process.exit())]'])assert.throws(()=>normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,bookList:rule}}))
})

test('search arithmetic is bounded and keeps legacy charset encoding; inert login descriptors do not become scripts',()=>{
  const s=normalizeSource({...sampleSource,loginUrl:'{"url":"null"}',searchUrl:"/search,{method:'POST',charset:'gbk',body:'q={{key}}&offset={{(page-1)*10}}&last={{Math.max(0,page-2)}}'}"})
  assert.equal(searchRequest(s,'测试',3).body,'q=%B2%E2%CA%D4&offset=20&last=1')
  assert.ok(!s.login?.script)
  assert.throws(()=>normalizeSource({...sampleSource,searchUrl:'/search?q={{process.exit()}}'}))
  assert.throws(()=>normalizeSource({...sampleSource,loginUrl:'{"url":"null","code":"real"}'}))
})

test('XPath html terminals retain paragraph and br boundaries without active HTML',()=>{
  const doc=document('<div id=content><p>第一段<br>下一行</p><p>第二段</p><script>bad()</script></div>')
  for(const rule of ['//div[@id="content"]@html','//div[@id="content"]/html()']){
    const value=ruleText(doc,rule);assert.match(value,/第一段\n下一行\n第二段/);assert.ok(!value.includes('bad()'))
    normalizeSource({...sampleSource,ruleContent:{content:rule}})
  }
})

test('XPath and transformed links complete isolated search, add, read and health; unsupported imports are distinct',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-rule-engine-'))),dbPath=path.join(dir,'audit.sqlite')
  assert.ok(dir.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(dbPath)),dir)
  const store=openReaderStore(dbPath),requests=[]
  const source={...sampleSource,searchUrl:'/search?q={{key}}',ruleSearch:{bookList:'.result',name:'a@text',bookUrl:"@onclick@js:result.match(/\\('(.*?)'\\)/)[1]"},ruleBookInfo:{name:'//h1/text()',author:'//meta[@property="og:novel:author"]/@content',tocUrl:'//a[@class="toc"]/@href'},ruleToc:{chapterList:'//div[@id="chapters"]/a',chapterName:'text',chapterUrl:'href'},ruleContent:{content:'#content@text'}}
  const library=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>{
    requests.push(url)
    const pathname=new URL(url).pathname
    if(pathname==='/search')return {url,text:'<li class=result onclick="go(\'/book/1\')"><a>测试书</a></li>'}
    if(pathname==='/book/1')return {url,text:'<h1>测试书</h1><meta property="og:novel:author" content="作者"><a class=toc href=/toc>目录</a>'}
    if(pathname==='/toc')return {url,text:'<div id=chapters><a href=/chapter/1>第一章</a></div>'}
    return {url,text:'<div id=content>第一段。第二段。</div>'}
  }})
  const call=(route,method='GET',input={})=>library.handle('audit',route,method,input)
  try{
    await store.saveAccount({username:'audit',password:'temporary-test-password'})
    const imported=await call('/sources/import','POST',{sources:[source,{...source,bookSourceName:'错误脚本',ruleContent:{content:'@js:const value = ;'}}]})
    assert.equal(imported.accepted.length,1);assert.equal(imported.rejected[0].code,'SCRIPT_INVALID');assert.equal(imported.rejected[0].field,'ruleContent.content')
    const search=await call('/search','POST',{key:'测试'});assert.equal(search.results.length,1)
    const saved=await call('/books','POST',{ticket:search.results[0].ticket});assert.equal(saved.title,'测试书');assert.equal(saved.author,'作者');assert.equal(saved.chapterCount,1)
    const chapter=await call(`/books/${saved.id}/chapters/${(await call(`/books/${saved.id}`)).chapters[0].id}`)
    assert.ok(JSON.stringify(chapter).includes('第一段。第二段。'))
    const health=await call('/sources/check','POST',{ids:[imported.accepted[0].id],key:'测试'});assert.equal(health.results[0].status,'healthy');assert.equal(health.results[0].matches.toc,1)
    assert.ok(requests.length>=8)
  }finally{store.close()}
})
