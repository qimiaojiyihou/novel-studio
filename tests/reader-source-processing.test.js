import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {normalizeSource,document,ruleList,ruleText} from '../reader-service/source-rules.js'
import {sourceIdentity,sourceURL} from '../reader-service/source-fetch.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {createSourceState,putSourceValue} from '../reader-service/source-state.js'
import {createSourceRuntime} from '../reader-service/source-runtime.js'
import {createSourceAuth} from '../reader-service/source-auth.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {buildDefaultCatalog} from '../scripts/build-reader-default-sources.mjs'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'

async function fixture(t){
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-processing-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close())
  for(const username of ['alpha','beta'])await store.saveAccount({username,password:'temporary-processing-password'})
  return {store,file}
}
const variableSource={...sampleSource,searchUrl:'/search',
  ruleSearch:{bookList:'$.books[*]',name:'@put:{bookId:"$.id"}$.name',author:'$.author',bookUrl:'https://books.example.org/book/@get:{bookId}'},
  ruleBookInfo:{name:'@put:{detail:"$.detail"}$.name',tocUrl:'$.toc'},
  ruleToc:{chapterList:'$.chapters[*]',chapterName:'@put:{chapterKey:"$.key"}$.name',chapterUrl:'$.url'},
  ruleContent:{content:'<js>var text=java.get("bookId")+":"+java.get("detail")+":"+java.get("chapterKey")+":"+java.get("bookName")+":"+java.get("title");java.put("seen",title);JSON.stringify({text:text})</js>$.text'}}
function variableFetcher(){return async url=>{
  const parts=new URL(url).pathname.split('/'),id=parts[2]
  const data=parts[1]==='search'?{books:['A','B'].map(id=>({id,name:id,author:'作者'}))}:parts[1]==='book'?{name:id,detail:'private-detail-'+id,toc:'/toc/'+id}:parts[1]==='toc'?{chapters:[1,2].map(n=>({name:'章'+n,key:'private-key-'+id+n,url:'/chapter/'+id+'/'+n}))}:{body:'mock'}
  return {url,text:JSON.stringify(data)}
}}
test('full source keys retain path and fragment variants, while root IDs stay backward compatible',async t=>{
  const {store}=await fixture(t),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key'})
  assert.equal(sourceIdentity(sampleSource.bookSourceUrl+'/'),sampleSource.bookSourceUrl)
  const raws=[sampleSource,{...sampleSource,bookSourceUrl:sampleSource.bookSourceUrl+'#variant'},{...sampleSource,bookSourceUrl:sampleSource.bookSourceUrl+'/engine/'}],sources=raws.map(normalizeSource)
  assert.equal(new Set(sources.map(s=>s.id)).size,3);assert.equal(sources[0].id,digest(sampleSource.bookSourceUrl).slice(0,32))
  assert.equal(sources[1].identity,sampleSource.bookSourceUrl+'/#variant');assert.equal(sourceURL(sources[1].identity).hash,'')
  assert.equal(new URL('search',sources[2].url).pathname,'/engine/search')
  const imported=await lib.handle('alpha','/sources/import','POST',{sources:raws});assert.equal(imported.accepted.length,3)
  await lib.handle('alpha',`/sources/${sources[0].id}/auth`,'PUT',{cookie:'session=private-root'})
  assert.equal((await lib.handle('alpha',`/sources/${sources[1].id}/auth`,'GET')).hasCookie,false)
  const catalog=buildDefaultCatalog([raws],{version:'legacy',sources:[],managedSourceVersions:{}})
  assert.equal(catalog.sources.length,3);assert.equal(catalog.duplicates.length,0)
})
test('put/get scopes survive search → detail → TOC → restart → parallel chapters without mixing books or accounts',async t=>{
  const {store}=await fixture(t),fetchPage=variableFetcher(),source=normalizeSource(variableSource)
  let lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'persistent-key',fetchPage})
  const call=(r,m='GET',input={})=>lib.handle('alpha',r,m,input)
  assert.equal((await call('/sources/import','POST',{sources:variableSource})).accepted.length,1)
  const results=await call('/search','POST',{key:'测试',sourceId:source.id});assert.equal(results.results.length,2,JSON.stringify(results.errors))
  assert.ok(!JSON.stringify(results).includes('sourceValues'))
  const a=await call('/books','POST',{ticket:results.results[0].ticket}),b=await call('/books','POST',{ticket:results.results[1].ticket})
  assert.ok(!JSON.stringify(a).includes('private-'));assert.ok(!JSON.stringify(b).includes('private-'))
  lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'persistent-key',fetchPage})
  const chapters=await Promise.all(a.chapters.map(c=>call(`/books/${a.id}/chapters/${c.id}`)))
  assert.deepEqual(chapters.map(c=>c.body),['A:private-detail-A:private-key-A1:A:章1','A:private-detail-A:private-key-A2:A:章2'])
  assert.equal((await call(`/books/${b.id}/chapters/${b.chapters[0].id}`)).body,'B:private-detail-B:private-key-B1:B:章1')
  const state=createSourceState(store.db,'persistent-key').read('alpha',a.id,source.version)
  assert.equal(state.chapters[a.chapters[0].id].seen,'章1');assert.equal(state.chapters[a.chapters[1].id].seen,'章2')
  const sealed=JSON.stringify(store.db.prepare('SELECT * FROM network_book_state').all());assert.ok(!sealed.includes('private-'))
  await assert.rejects(lib.handle('beta',`/books/${a.id}/chapters/${a.chapters[0].id}`,'GET',{}),e=>e.status===404)
  await call('/sources/import','POST',{sources:{...variableSource,bookSourceName:'新版变量规则'}})
  await assert.rejects(call(`/books/${a.id}/chapters/${a.chapters[0].id}`),e=>e.status===409&&/重新搜索/.test(e.message))
  const newer=await call('/search','POST',{key:'测试',sourceId:source.id}),rebuilt=await call('/books','POST',{ticket:newer.results[0].ticket})
  assert.equal(rebuilt.id,a.id);assert.equal((await call(`/books/${a.id}/chapters/${a.chapters[0].id}`)).body,'A:private-detail-A:private-key-A1:A:章1')
  await call(`/books/${a.id}`,'DELETE',{});assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_book_state WHERE book_id=?').get(a.id).n,0)
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('encrypted book state merges disjoint writes, rejects conflicts and invalidates on rule changes or key rotation',async t=>{
  const {store}=await fixture(t),s=normalizeSource(sampleSource),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key',fetchPage:mockSourceFetcher()})
  await lib.handle('alpha','/sources/import','POST',{sources:sampleSource})
  const result=await lib.handle('alpha','/search','POST',{key:'测试'}),b=await lib.handle('alpha','/books','POST',{ticket:result.results[0].ticket}),state=createSourceState(store.db,'key'),base=state.read('alpha',b.id,s.version)
  state.save('alpha',b.id,s.version,base,{book:{token:'one'},chapters:{}})
  state.save('alpha',b.id,s.version,base,{book:{},chapters:{abc:{value:'two'}}})
  assert.equal(state.read('alpha',b.id,s.version).book.token,'one')
  assert.throws(()=>state.save('alpha',b.id,s.version,base,{book:{token:'conflict'},chapters:{}}),e=>e.status===409)
  assert.deepEqual(state.read('alpha',b.id,'changed-rules'),state.empty())
  assert.throws(()=>createSourceState(store.db,'rotated-key').read('alpha',b.id,s.version),e=>e.status===409)
  assert.throws(()=>putSourceValue({},'__proto__','x'));assert.throws(()=>putSourceValue({},'value','x'.repeat(65537)))
})
test('in-flight chapter reads never resurrect removed books or overwrite a changed directory',async t=>{
  const {store}=await fixture(t);let wait=false,entered,release
  const started=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r}),normal=mockSourceFetcher()
  const lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key',fetchPage:async(url,opts)=>{if(wait&&url.includes('/chapter/')){entered();await gate}return normal(url,opts)}})
  await lib.handle('alpha','/sources/import','POST',{sources:sampleSource})
  const result=await lib.handle('alpha','/search','POST',{key:'测试'}),b=await lib.handle('alpha','/books','POST',{ticket:result.results[0].ticket})
  wait=true;const pending=lib.handle('alpha',`/books/${b.id}/chapters/${b.chapters[0].id}`,'GET',{})
  await started;await lib.handle('alpha',`/books/${b.id}`,'DELETE',{});release();await assert.rejects(pending,e=>e.status===409)
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_book_state').get().n,0)
})
test('interleaving retains uneven tails; ordered script/replacement stages preserve the previous result',async t=>{
  const doc=document('<i>A1</i><i>A2</i><b>B1</b>')
  assert.deepEqual(ruleList(doc,'i%%b').map(row=>ruleText(row,'text')),['A1','B1','A2'])
  const {store}=await fixture(t),s=normalizeSource({...sampleSource,ruleToc:{...sampleSource.ruleToc,chapterList:'i%%b'}}),lib=createNetworkLibrary(store.db,{defaultSources:null})
  await lib.handle('alpha','/sources/import','POST',{sources:sampleSource})
  const runtime=createSourceRuntime(s,{fetchPage:mockSourceFetcher(),profile:createSourceAuth(store.db,'key').profile('alpha',s,()=>{}),signal:AbortSignal.timeout(10000),active:()=>{}})
  assert.equal(await runtime.text(doc,'<js>"one"</js>##one##two<js>result+"!"</js>'),'two!')
  await assert.rejects(runtime.text(doc,'@put:{"constructor":"text"}text'))
})
test('dynamic headers reuse only this account/source credentials; login expiry is actionable and does not log out readers',async t=>{
  const {store}=await fixture(t),requests=[];let expired=false
  const raw={...sampleSource,loginUi:[{name:'token',type:'password'}],novelStudioLoginRequired:true,
    header:'@js:JSON.stringify({Authorization:"Bearer "+source.getLoginInfoMap().token,"User-Agent":"Fixture/1","ts":java.md5Encode("fixture")})',loginCheckJs:'source.getLoginInfoMap().token === "private-token"'}
  const s=normalizeSource(raw),normal=mockSourceFetcher(),lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key',fetchPage:async(url,opts)=>{requests.push(opts);if(expired)throw Object.assign(Error('private upstream error'),{httpStatus:401,status:502});return normal(url,opts)}})
  for(const owner of ['alpha','beta'])await lib.handle(owner,'/sources/import','POST',{sources:raw})
  const missing=await lib.handle('alpha','/search','POST',{key:'测试'});assert.equal(missing.errors[0].code,'SOURCE_LOGIN_REQUIRED');assert.equal(requests.length,0)
  await lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{token:'private-token'}})
  const result=await lib.handle('alpha','/search','POST',{key:'测试'});assert.equal(result.results.length,1)
  assert.equal(requests[0].credentialHeaders.authorization,'Bearer private-token');assert.equal(requests[0].headers['user-agent'],'Fixture/1');assert.match(requests[0].headers.ts,/^[a-f0-9]{32}$/)
  assert.ok(!JSON.stringify(await lib.handle('alpha',`/sources/${s.id}/auth`,'GET')).includes('private-token'))
  expired=true;const failed=await lib.handle('alpha','/search','POST',{key:'测试'});assert.equal(failed.errors[0].loginRequired,true);assert.equal(failed.errors[0].sourceId,s.id)
  assert.equal((await lib.handle('alpha',`/sources/${s.id}/auth`,'GET')).authorization.status,'expired')
  assert.equal((await lib.handle('beta',`/sources/${s.id}/auth`,'GET')).authorization.status,'empty')
})
test('stale failed requests do not mark newly saved credentials expired',async t=>{
  const {store}=await fixture(t);let entered,release
  const started=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r}),raw={...sampleSource,loginUi:[{name:'token',type:'password'}]},s=normalizeSource(raw)
  const lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'key',fetchPage:async()=>{entered();await gate;throw Object.assign(Error('unauthorized'),{status:502,httpStatus:401})}})
  await lib.handle('alpha','/sources/import','POST',{sources:raw});await lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{token:'old'}})
  const pending=lib.handle('alpha','/search','POST',{key:'测试'});await started
  await lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{token:'new'}});release();await pending
  assert.equal((await lib.handle('alpha',`/sources/${s.id}/auth`,'GET')).authorization.status,'saved')
})
