import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {catalogBeforePhonePagination,catalogBeforeBiqugeTW} from './fixtures/reader-catalog-history.js'
import {document,ruleText} from '../reader-service/source-rules.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'

const catalog=catalogBeforeBiqugeTW(),target='8992ef30eefdcd511519a0780f9d8bcd',prior=catalogBeforePhonePagination(),phone=catalog.sources.find(s=>s.id===target)
async function fixture(t){
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-phone-default-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file);t.after(()=>store.close());return store
}

test('phone default changes only directory pagination and retains historical upgrade paths',()=>{
  assert.equal(prior.version,'global-all-sources-'+digest(JSON.stringify(prior.sources)).slice(0,16))
  assert.equal(catalog.previousVersion,prior.version)
  assert.equal(catalog.version,'global-all-sources-'+digest(JSON.stringify(catalog.sources)).slice(0,16))
  assert.equal(phone.version,digest(JSON.stringify({...phone,version:undefined})))
  assert.equal(phone.rules.ruleToc.nextTocUrl,'a:contains(下一页).0@href')
  const old=prior.sources.find(s=>s.id===target),restored=structuredClone(phone)
  delete restored.rules.ruleToc.nextTocUrl;restored.version=old.version
  assert.deepEqual(restored,old)
  assert.deepEqual(catalog.sources.filter(s=>s.id!==target),prior.sources.filter(s=>s.id!==target))
  assert.deepEqual(catalog.addedSourceIds,[]);assert.deepEqual(catalog.upgradeFrom[prior.version],[])
  for(const [version,ids]of Object.entries(prior.upgradeFrom))assert.deepEqual(catalog.upgradeFrom[version],ids)
  assert.ok(catalog.managedSourceVersions[target].includes(old.version))
  assert.equal(catalog.restoreMissing,false);assert.equal(catalog.applyToExisting,true)
  const page=document('<a href="/book_2/">下一页</a><a href="/next-chapter">下一章</a>')
  assert.equal(ruleText(page,old.rules.ruleToc.nextTocUrl),'','old rule reproduces the first-page-only bug')
  assert.equal(ruleText(page,phone.rules.ruleToc.nextTocUrl),'/book_2/')
  assert.equal(ruleText(document('<a href="/next-chapter">下一章</a>'),phone.rules.ruleToc.nextTocUrl),'')
})

test('phone defaults upgrade every account once preserving custom/deleted/disabled sources, auth and collections',async t=>{
  const store=await fixture(t),noFetch=()=>{throw Error('default updates must not fetch upstream')}
  for(const owner of ['alpha','beta','custom','deleted'])await store.saveAccount({username:owner,password:'fixture-phone-password'})
  let lib=createNetworkLibrary(store.db,{defaultSources:prior,authKey:'fixture-key',fetchPage:noFetch})
  await lib.handle('beta',`/sources/${target}`,'PUT',{enabled:false})
  await lib.handle('beta',`/sources/${target}/auth`,'PUT',{cookie:'fixture=phone-private'})
  const custom={...phone,name:'用户规则',version:'fixture-custom'}
  store.db.prepare('UPDATE network_sources SET name=?,version=?,config=? WHERE owner=? AND id=?').run(custom.name,custom.version,JSON.stringify(custom),'custom',target)
  await lib.handle('deleted',`/sources/${target}`,'DELETE',{})
  store.db.prepare('INSERT INTO network_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('alpha','fixture-book',target,'模拟收藏','模拟作者','模拟简介',phone.url+'/book/',phone.url+'/book/','[]','rev','2026-10-17')
  const tables=store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('network_sources','network_source_initializations') ORDER BY name").all().map(r=>r.name)
  const snapshot=()=>tables.map(name=>[name,store.db.prepare('SELECT * FROM '+name).all()])
  const before=snapshot(),sources=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all()
  lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key',fetchPage:noFetch})
  for(const row of sources){
    const current=store.db.prepare('SELECT * FROM network_sources WHERE owner=? AND id=?').get(row.owner,row.id)
    assert.deepEqual({...current},row.id===target&&row.owner!=='custom'?{...row,name:phone.name,version:phone.version,config:JSON.stringify(phone)}:{...row})
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_sources WHERE owner=? AND id=?').get('deleted',target).n,0)
  assert.deepEqual(snapshot(),before)
  assert.equal((await lib.handle('beta',`/sources/${target}/auth`,'GET',{})).hasCookie,true)
  const rows=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all()
  lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key',fetchPage:noFetch})
  assert.deepEqual(store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all(),rows)
  await store.saveAccount({username:'future',password:'fixture-phone-password'});lib.initializeAccount('future')
  assert.equal(store.db.prepare('SELECT version FROM network_sources WHERE owner=? AND id=?').get('future',target).version,phone.version)
  assert.equal((await lib.handle('future',`/sources/${target}/auth`,'GET',{})).hasCookie,false)
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('bundled phone rule resumes beyond 80 chapters, deduplicates latest links and joins body pages',async t=>{
  const store=await fixture(t),title='模拟长目录分页书籍'
  await store.saveAccount({username:'alpha',password:'fixture-phone-password'})
  const fetchPage=async url=>{
    const p=new URL(url).pathname
    if(p==='/search/')return {url,text:`<li><span class=s2><a href=/book/>${title}</a></span><span class=s4>模拟作者</span></li>`}
    if(p.startsWith('/chapter/'))return {url,text:p.endsWith('_2')?'<div id=content>第二页模拟正文。</div><a href=/chapter/12>下一章</a>':'<div id=content>第一页模拟正文。</div><a href=/chapter/11_2>下一页</a>'}
    const page=Number(p.match(/^\/book_(\d+)\/$/)?.[1]||1),start=(page-1)*80
    assert.ok(page>=1&&page<=6)
    return {url,text:`<div id=info><h1>${title}</h1><p>模拟作者</p></div><div id=list><dl><dt>最新</dt><dd><a href=/chapter/480>第480章</a></dd><dt>正文</dt>${Array.from({length:80},(_,i)=>`<dd><a href=/chapter/${start+i+1}>第${start+i+1}章</a></dd>`).join('')}</dl></div>${page<6?`<a href=/book_${page+1}/>下一页</a>`:''}`}
  }
  let lib=createNetworkLibrary(store.db,{defaultSources:catalog,fetchPage,authKey:'fixture-key'})
  const item=(await lib.handle('alpha','/search','POST',{sourceId:target,key:title})).results[0]
  const first=await lib.handle('alpha','/books','POST',{ticket:item.ticket})
  assert.equal(first.chapterCount,400);assert.equal(first.tocIncomplete,true)
  lib=createNetworkLibrary(store.db,{defaultSources:catalog,fetchPage,authKey:'fixture-key'})
  const complete=await lib.handle('alpha',`/books/${first.id}/refresh`,'POST',{})
  assert.equal(complete.chapterCount,480);assert.equal(complete.tocIncomplete,false)
  assert.equal(new Set(complete.chapters.map(c=>c.id)).size,480)
  const read=await lib.handle('alpha',`/books/${first.id}/chapters/${complete.chapters[10].id}`,'GET',{})
  assert.equal(read.body,'第一页模拟正文。\n\n第二页模拟正文。')
})
