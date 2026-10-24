import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import raw from '../reader-service/fanqie-public-source.json' with {type:'json'}
import {normalizeSource,document} from '../reader-service/source-rules.js'
import {createSourceRuntime} from '../reader-service/source-runtime.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore} from '../reader-service/store.js'
import catalog from '../reader-service/default-sources.json' with {type:'json'}

const bookId='7287479909398613032',chapterId='7287481820193489408',nextId='7287484204554650146'
function page(data,tail='; globalThis.untrustedRan=true;'){
  return '<script>window.__INITIAL_STATE__='+JSON.stringify({reader:{chapterData:data}})+tail+'</script>'
}
const chapter=(id=chapterId)=>({itemId:id,bookId,content:'<p>测试段落。</p><p></p>',needPay:0,isChapterLock:false})

test('catalog adds public Fanqie separately without replacing old sources or restoring deletions',()=>{
  const normalized=normalizeSource(raw),bundled=catalog.sources.find(s=>s.id===normalized.id)
  assert.deepEqual(bundled,normalized)
  assert.equal(catalog.sources.length,48);assert.equal(catalog.restoreMissing,false)
  assert.deepEqual(catalog.upgradeFrom['global-all-sources-3b3f4ab6d7f7ed01'],[normalized.id,'487bc7703870e80ff275fe935370a76e','6cfafad5bc407b7319d093a0cf0e6909','28c9887c04f0431f790d3af9e914a780'])
  assert.equal(catalog.sources.filter(s=>s.id!==normalized.id).length,47)
  assert.ok(catalog.sources.some(s=>s.name==='番茄小说2'),'preserve the prior account-configured source')
})
async function fixture(t,fetchPage){
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-fanqie-public-'))),database=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(database)),dir)
  const store=openReaderStore(database);t.after(()=>store.close())
  for(const username of ['alpha','beta'])await store.saveAccount({username,password:'fixture-only-password'})
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-only-key',fetchPage})
  const result=await library.handle('alpha','/sources/import','POST',{sources:raw})
  assert.equal(result.rejected.length,0)
  return {library,store}
}

test('public Fanqie rules use the existing Node runtime, read JSON data only and decode typography',async()=>{
  const source=normalizeSource(raw),runtime=createSourceRuntime(source,{signal:AbortSignal.timeout(10000),active:()=>{}})
  const value=await runtime.content(document(page(chapter()),{baseUrl:'https://fanqienovel.com/reader/'+chapterId}),source.rules.ruleContent)
  assert.equal(value,'测试段落。\n的你我')
  assert.equal(globalThis.untrustedRan,undefined)
  const tricky=chapter();tricky.content='<p>引号 \"、反斜杠 \\ 和括号 } {，正文。</p>'
  assert.match(await runtime.content(document(page(tricky),{baseUrl:'https://fanqienovel.com/reader/'+chapterId}),source.rules.ruleContent),/正文/)
})

test('public Fanqie rejects paid, locked, missing, wrong-identity and unmapped content',async()=>{
  const source=normalizeSource(raw),runtime=createSourceRuntime(source,{signal:AbortSignal.timeout(10000),active:()=>{}})
  for(const data of [{...chapter(),needPay:true},{...chapter(),needPay:'1'},{...chapter(),isChapterLock:'true'},{...chapter(),itemId:nextId},{...chapter(),content:''},{...chapter(),content:'<p>未知\uE000字符</p>'},{}]){
    await assert.rejects(runtime.content(document(page(data),{baseUrl:'https://fanqienovel.com/reader/'+chapterId}),source.rules.ruleContent))
  }
  await assert.rejects(runtime.content(document('<h1>验证页面</h1>',{baseUrl:'https://fanqienovel.com/reader/'+chapterId}),source.rules.ruleContent))
  await assert.rejects(runtime.content(document('<script>window.__INITIAL_STATE__={"reader":', {baseUrl:'https://fanqienovel.com/reader/'+chapterId}),source.rules.ruleContent))
})

test('public Fanqie search, add, repeat add, two chapters and account isolation use the existing library flow',async t=>{
  const requests=[]
  const {library,store}=await fixture(t,async (url,options)=>{
    requests.push(url);assert.equal(options.scope,'https://fanqienovel.com')
    const address=new URL(url)
    let text
    if(address.hostname==='novel.snssdk.com')text=JSON.stringify({code:0,data:{ret_data:[{title:'模拟小说',author:'模拟作者',book_id:bookId,abstract:'测试简介'}]}})
    else if(address.pathname.startsWith('/page/'))text='<title>模拟小说</title>'
    else if(address.pathname==='/api/reader/directory/detail')text=JSON.stringify({code:0,data:{chapterListWithVolume:[[{itemId:chapterId,title:'第一章'},{itemId:nextId,title:'第二章'}]]}})
    else text=page(chapter(address.pathname.split('/').pop()))
    return {url,text}
  })
  const search=await library.handle('alpha','/search','POST',{sourceId:normalizeSource(raw).id,key:'模拟小说'})
  assert.deepEqual(search.errors,[]);assert.equal(search.results.length,1)
  await assert.rejects(library.handle('beta','/books','POST',{ticket:search.results[0].ticket}),e=>e.status===409)
  const added=await library.handle('alpha','/books','POST',{ticket:search.results[0].ticket})
  assert.equal(added.chapterCount,2);assert.equal(added.title,'模拟小说')
  assert.equal((await library.handle('alpha','/books','POST',{ticket:search.results[0].ticket})).id,added.id)
  for(const entry of added.chapters){
    const result=await library.handle('alpha',`/books/${added.id}/chapters/${entry.id}`,'GET',{})
    assert.equal(result.body,'测试段落。\n的你我')
  }
  await assert.rejects(library.handle('beta',`/books/${added.id}`,'GET',{}),e=>e.status===404)
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM network_books').get().n,1)
  assert.ok(requests.every(url=>['fanqienovel.com','novel.snssdk.com'].includes(new URL(url).hostname)))
})

test('locked chapter HTTP errors identify the public-access boundary without storing previews or exposing credentials',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-fanqie-locked-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async url=>{
    const address=new URL(url)
    const text=address.hostname==='novel.snssdk.com'?JSON.stringify({data:{ret_data:[{title:'模拟小说',book_id:bookId}]}}):address.pathname==='/api/reader/directory/detail'?JSON.stringify({data:{chapterListWithVolume:[[{itemId:chapterId,title:'第十章'},{itemId:nextId,title:'第十一章'}]]}}):address.pathname.startsWith('/page/')?'<title>模拟小说</title>':page({...chapter(address.pathname.split('/').pop()),isChapterLock:address.pathname.endsWith(nextId)})
    return {url,text}
  }})
  t.after(()=>service.close())
  await service.store.saveAccount({username:'fixture',password:'fixture-only-password'})
  const session=await service.store.login({username:'fixture',password:'fixture-only-password'})
  async function call(route,body){const response=await fetch(service.origin+'/api/network'+route,{method:body?'POST':'GET',headers:{Origin:service.origin,Cookie:'reader_session='+session,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()}}
  await call('/sources/import',{sources:raw})
  const search=await call('/search',{sourceId:normalizeSource(raw).id,key:'模拟小说'})
  const added=await call('/books',{ticket:search.value.results[0].ticket}),book=added.value
  assert.equal((await call(`/books/${book.id}/chapters/${book.chapters[0].id}`)).status,200)
  const before=service.store.db.prepare('SELECT * FROM network_book_state').all()
  const failed=await call(`/books/${book.id}/chapters/${book.chapters[1].id}`)
  assert.equal(failed.status,422);assert.equal(failed.value.code,'SOURCE_CHAPTER_LOCKED')
  assert.equal(failed.value.openUrl,'https://fanqienovel.com/reader/'+nextId)
  assert.match(failed.value.error,/未开放.*完整/);assert.doesNotMatch(JSON.stringify(failed),/fixture-only-password|reader_session/)
  assert.equal(failed.value.loginRequired,undefined,'locked chapters do not prompt credential collection')
  assert.deepEqual(service.store.db.prepare('SELECT * FROM network_book_state').all(),before,'failed reads never persist preview state')
  assert.deepEqual(service.store.db.prepare('PRAGMA foreign_key_check').all(),[])
})
