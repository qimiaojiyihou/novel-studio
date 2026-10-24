import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {normalizeSource,putDirective,document,ruleList,ruleText} from '../reader-service/source-rules.js'
import {sourceHeaders} from '../reader-service/source-fetch.js'
import {createSourceRuntime} from '../reader-service/source-runtime.js'
import {createSourceAuth} from '../reader-service/source-auth.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore} from '../reader-service/store.js'
import {buildDefaultCatalog} from '../scripts/build-reader-default-sources.mjs'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'

async function fixture(t){
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-catalog-refresh-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close())
  for(const username of ['alpha','beta'])await store.saveAccount({username,password:'temporary-refresh-password'})
  return store
}

test('unquoted Legado put values stay data and mix with quoted selectors without evaluating code',async t=>{
  assert.deepEqual({...putDirective('Name@put:{id:$.Id, bid:"$.id",other:$.data[0]}').entries},{id:'$.Id',bid:'$.id',other:'$.data[0]'})
  for(const rule of ['@put:{constructor:$.Id}','@put:{id:$.Id,id:$.Other}','@put:{id:"unterminated}','@put:{id:process.exit()}'])assert.throws(()=>normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,name:rule}}))
  const store=await fixture(t),s=normalizeSource(sampleSource)
  createNetworkLibrary(store.db,{defaultSources:null})
  store.db.prepare('INSERT INTO network_sources VALUES(?,?,?,?,?,1)').run('alpha',s.id,s.name,JSON.stringify(s),s.version)
  const runtime=createSourceRuntime(s,{profile:createSourceAuth(store.db,'test-key').profile('alpha',s,()=>{}),fetchPage:mockSourceFetcher(),signal:AbortSignal.timeout(10000),active:()=>{}})
  const ctx=document('{"Name":"fixture","Id":"A","id":"B"}',{baseUrl:s.url})
  assert.equal(await runtime.text(ctx,'Name@put:{id:$.Id,bid:"$.id"}'),'fixture')
  assert.equal(await runtime.text(ctx,'@get:{id}'),'A');assert.equal(await runtime.text(ctx,'@get:{bid}'),'B')
})

test('referer accepts only explicitly declared public origins, not arbitrary siblings or HTTPS downgrade',()=>{
  const base='https://www.example.org',allowed=['https://m.example.org']
  assert.equal(sourceHeaders({Referer:'https://m.example.org/search'},base,allowed).referer,'https://m.example.org/search')
  for(const ref of ['https://evil.example.org/','https://attacker.org/','http://m.example.org/','http://127.0.0.1/'])assert.throws(()=>sourceHeaders({Referer:ref},base,allowed))
  assert.throws(()=>sourceHeaders({Cookie:'secret'},base,allowed))
})

test('unprefixed JSONPath wildcard lists validate consistently with JSON runtime selection',()=>{
  const rule='data.list[*].list[*]',s=normalizeSource({...sampleSource,ruleToc:{...sampleSource.ruleToc,chapterList:rule}})
  const ctx=document(JSON.stringify({data:{list:[{list:[{name:'one'}]},{list:[{name:'two'}]}]}}))
  assert.deepEqual(ruleList(ctx,s.rules.ruleToc.chapterList).map(row=>ruleText(row,'name')),['one','two'])
})

test('lookaround replacement is adapted to isolated script, keeping Node RE2 matching unchanged',async t=>{
  const store=await fixture(t),s=normalizeSource({...sampleSource,ruleBookInfo:{intro:'$.text##(?<=one)two(?=three)##!'}})
  assert.ok(s.rules.ruleBookInfo.intro.includes('<js>'))
  createNetworkLibrary(store.db,{defaultSources:null})
  store.db.prepare('INSERT INTO network_sources VALUES(?,?,?,?,?,1)').run('alpha',s.id,s.name,JSON.stringify(s),s.version)
  const runtime=createSourceRuntime(s,{profile:createSourceAuth(store.db,'test-key').profile('alpha',s,()=>{}),fetchPage:mockSourceFetcher(),signal:AbortSignal.timeout(10000),active:()=>{}})
  assert.equal(await runtime.text(document('{"text":"onetwothree"}'),s.rules.ruleBookInfo.intro),'one!three')
})

test('isolated lookaround regex lists preserve capture selectors and zero-width termination',async t=>{
  const store=await fixture(t),s=normalizeSource({...sampleSource,ruleToc:{chapterList:':(?<=prefix)(chapter\\d+)',chapterName:'$1',chapterUrl:'href'}})
  createNetworkLibrary(store.db,{defaultSources:null})
  store.db.prepare('INSERT INTO network_sources VALUES(?,?,?,?,?,1)').run('alpha',s.id,s.name,JSON.stringify(s),s.version)
  const runtime=createSourceRuntime(s,{profile:createSourceAuth(store.db,'test-key').profile('alpha',s,()=>{}),fetchPage:mockSourceFetcher(),signal:AbortSignal.timeout(10000),active:()=>{}})
  const rows=await runtime.list(document('prefixchapter1 prefixchapter2'),s.rules.ruleToc.chapterList)
  assert.deepEqual(await Promise.all(rows.map(row=>runtime.text(row,'$1'))),['chapter1','chapter2'])
})

test('explicit catalogue replacement repopulates cleared accounts once, keeps future deletions and excludes legacy rules',async t=>{
  const store=await fixture(t),s=normalizeSource(sampleSource),old={version:'old',sources:[s],rejected:[]}
  let lib=createNetworkLibrary(store.db,{defaultSources:old})
  for(const owner of ['alpha','beta']){await lib.handle(owner,'/sources','GET',{});await lib.handle(owner,`/sources/${s.id}`,'DELETE',{})}
  const pack=buildDefaultCatalog([[sampleSource]],old,{name:'Explicit new inputs',restoreMissing:true,freshRules:true})
  lib=createNetworkLibrary(store.db,{defaultSources:pack})
  for(const owner of ['alpha','beta'])assert.equal((await lib.handle(owner,'/sources','GET',{})).length,1)
  await lib.handle('alpha',`/sources/${s.id}`,'DELETE',{})
  lib=createNetworkLibrary(store.db,{defaultSources:pack})
  assert.equal((await lib.handle('alpha','/sources','GET',{})).length,0)
  assert.equal((await lib.handle('beta','/sources','GET',{})).length,1)
  const pending=buildDefaultCatalog([[{...sampleSource,ruleContent:{content:'@js:const bad = ;'}}]],old,{freshRules:true})
  assert.equal(pending.sources[0].unsupported.code,'SCRIPT_INVALID','fresh input never falls back to old success')
})

test('exact title audit does not report unrelated search results as healthy',async t=>{
  const store=await fixture(t),s=normalizeSource(sampleSource)
  let requests=0
  const lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>{requests++;return {url,text:'<li><a href="/book">另一本书</a></li>'}}})
  await lib.handle('alpha','/sources/import','POST',{sources:{...sampleSource,ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'}}})
  const result=await lib.handle('alpha','/sources/check','POST',{ids:[s.id],key:'我，吃鬼就变强',exactTitle:true})
  assert.equal(result.results[0].code,'SEARCH_TITLE_NOT_FOUND');assert.equal(requests,1)
})

test('source audit carries search and chapter variables through the same scopes as actual reading',async t=>{
  const store=await fixture(t),title='我，吃鬼就变强',raw={...sampleSource,searchUrl:'/search',
    ruleSearch:{bookList:'$.books[*]',name:'name@put:{bookId:id}',bookUrl:'$.url'},
    ruleBookInfo:{tocUrl:'$.toc'},ruleToc:{chapterList:'$.chapters[*]',chapterName:'name@put:{chapterKey:key}',chapterUrl:'$.url'},
    ruleContent:{content:'<js>java.get("bookId")+":"+java.get("chapterKey")+":"+java.get("bookName")+":"+java.get("title")</js>'}}
  const lib=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async url=>({url,text:JSON.stringify(new URL(url).pathname==='/search'?{books:[{name:title,id:'A',url:'/book'}]}:new URL(url).pathname==='/book'?{toc:'/toc'}:new URL(url).pathname==='/toc'?{chapters:[{name:'第一章',key:'K',url:'/chapter'}]}:{text:'fixture'})})})
  const s=normalizeSource(raw);await lib.handle('alpha','/sources/import','POST',{sources:raw})
  const {results}=await lib.handle('alpha','/sources/check','POST',{ids:[s.id],key:title,exactTitle:true})
  assert.equal(results[0].status,'healthy');assert.equal(results[0].matches.bookTitle,title)
  assert.equal(results[0].matches.contentCharacters,('A:K:'+title+':第一章').length)
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM network_books').get().n,0,'testing never adds a real collection')
})
