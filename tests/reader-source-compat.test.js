import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {document,ruleText,ruleList,normalizeSource,infoContext} from '../reader-service/source-rules.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'

test('legacy compound classes, bracket indexes, static info init and capture-list rules',()=>{
  const doc=document('<div id=detail><h1>书名</h1><ul class="list-group list-charts"><li><a href=/1>甲</a></li><li><a href=/2>乙</a></li></ul></div><ul class=list-group><li>丙</li></ul>')
  assert.equal(ruleText(doc,'class.list-group list-charts.0@li@text'),'甲\n乙')
  assert.equal(ruleText(doc,'class.list-group list-charts@li[-1,0]@text'),'乙\n甲')
  const source=normalizeSource({...sampleSource,ruleBookInfo:{init:'id.detail',name:'h1@text'}})
  assert.equal(ruleText(infoContext(doc,source.rules.ruleBookInfo),'h1@text'),'书名')
  assert.throws(()=>infoContext(doc,{init:'#missing'}),/初始化/)
  const rows=ruleList(doc,':<a href=(.*?)>(.*?)</a>')
  assert.equal(rows.length,2);assert.equal(ruleText(rows[0],'$1'),'/1');assert.equal(ruleText(rows[1],'$2'),'乙')
  assert.equal(ruleText(document('分类：悬疑<尾部'),'##分类：([^<]+)<##$1###'),'悬疑')
  assert.equal(ruleText(document('<b>[悬疑]</b>'),'b@text##\\[(.*)\\]##$1##'),'悬疑')
  assert.equal(ruleText(document('<b>║悬疑</b>'),'b@text##\\║'),'悬疑')
  assert.match(normalizeSource({...sampleSource,ruleSearch:{...sampleSource.ruleSearch,bookList:':(?<=x)(y)'}}).rules.ruleSearch.bookList,/<js>/)
})

test('add handles multi-page select TOCs, repeated links, init and detailed 422; retries preserve account isolation',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-add-compat-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  const store=openReaderStore(databasePath),fixture=mockSourceFetcher(),requests=[]
  let mode='ok'
  const library=createNetworkLibrary(store.db,{defaultSources:null,fetchPage:async(url,options)=>{
    requests.push(url)
    const pathname=new URL(url).pathname
    if(pathname==='/book/1')return {url,text:'<div id=info><h1>目录测试书</h1><a class=toc href=/toc/1>目录</a></div>'}
    if(pathname.startsWith('/toc/')){
      const n=Number(pathname.split('/').pop())
      if(mode==='empty')return {url,text:'<h1>请验证后继续</h1>'}
      const pages=mode==='overflow'?Array.from({length:101},(_,i)=>i+1):[1,2,2]
      const href=mode==='private'?'http://127.0.0.1/x':mode==='options'?'/chapter/1,{"unsupportedOption":true}':`/chapter/${n}`
      return {url,text:`<ul class="chapter-list clearfix"><li><a href='${href}'>第${n}章</a></li></ul><select>${pages.map(i=>`<option value=/toc/${i}>${i}</option>`).join('')}</select>`}
    }
    return fixture(url,options)
  }})
  const call=(route,method='GET',input={})=>library.handle('owner',route,method,input)
  try{
    await store.saveAccount({username:'owner',password:'fixture-password'})
    await store.saveAccount({username:'other',password:'fixture-password'})
    const raw={...sampleSource,ruleBookInfo:{init:'id.info',name:'h1@text',tocUrl:'a.toc@href'},ruleToc:{chapterList:'class.chapter-list clearfix@li',chapterName:'a@text',chapterUrl:'a@href',nextTocUrl:'option@value'}}
    await call('/sources/import','POST',{sources:raw})
    const result=(await call('/search','POST',{key:'测试'})).results[0]
    mode='empty';await assert.rejects(call('/books','POST',{ticket:result.ticket}),/解析目录失败.*目录元素 0 个/)
    assert.equal((await call('/books')).length,0)
    mode='options';await assert.rejects(call('/books','POST',{ticket:result.ticket}),/请求选项未支持/)
    mode='private';await assert.rejects(call('/books','POST',{ticket:result.ticket}))
    mode='overflow';await assert.rejects(call('/books','POST',{ticket:result.ticket}),/100 页/)
    assert.equal((await call('/books')).length,0)
    mode='ok';requests.length=0
    const added=await call('/books','POST',{ticket:result.ticket})
    assert.equal(added.title,'目录测试书');assert.equal(added.chapterCount,2)
    assert.equal(requests.filter(url=>new URL(url).pathname==='/toc/1').length,1)
    assert.equal(requests.filter(url=>new URL(url).pathname==='/toc/2').length,1)
    assert.equal((await call('/books','POST',{ticket:result.ticket})).id,added.id)
    assert.equal((await call('/books')).length,1)
    await assert.rejects(library.handle('other','/books','POST',{ticket:result.ticket}),/失效/)
    mode='empty';await assert.rejects(call(`/books/${added.id}/refresh`,'POST'),/未解析出章节/)
    assert.equal((await call(`/books/${added.id}`)).chapterCount,2)
  }finally{store.close()}
})

test('default source upgrades accept both earlier releases without restoring deleted IDs or enabling disabled sources',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-pack-upgrade-'))),databasePath=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
  const store=openReaderStore(databasePath)
  const pack=JSON.parse(await fs.readFile(new URL('../reader-service/default-sources.json',import.meta.url),'utf8'))
  pack.applyToExisting=false;pack.restoreMissing=false // Legacy opt-in upgrades keep their original non-restoring semantics.
  try{
    for(const [n,[version,addedIds]] of Object.entries(Object.entries(pack.upgradeFrom))){
      const owner=`owner${n}`;await store.saveAccount({username:owner,password:'fixture-password'})
      const allOld=pack.sources.filter(s=>!addedIds.includes(s.id)),deleted=allOld[0],disabled=allOld[1]
      let lib=createNetworkLibrary(store.db,{defaultSources:{...pack,version,sources:allOld}})
      await lib.handle(owner,'/sources','GET',{})
      await lib.handle(owner,`/sources/${deleted.id}`,'DELETE',{})
      await lib.handle(owner,`/sources/${disabled.id}`,'PUT',{enabled:false})
      lib=createNetworkLibrary(store.db,{defaultSources:pack})
      await lib.handle(owner,'/sources/defaults/update','POST',{})
      const rows=await lib.handle(owner,'/sources','GET',{})
      assert.equal(rows.length,pack.sources.length-1);assert.ok(!rows.some(s=>s.id===deleted.id))
      assert.equal(rows.find(s=>s.id===disabled.id).enabled,false)
      assert.ok(addedIds.every(id=>rows.some(s=>s.id===id&&s.enabled)))
    }
  }finally{store.close()}
})

test('historical health retirement evidence remains recoverable without constraining a user-replaced catalogue',async()=>{
  const pack=JSON.parse(await fs.readFile(new URL('../reader-service/default-sources.json',import.meta.url),'utf8'))
  const audit=JSON.parse(await fs.readFile(new URL('../docs/reader-source-health-2026-10-15.json',import.meta.url),'utf8'))
  assert.equal(audit.tested,115);assert.equal(audit.results.length,115)
  assert.equal(audit.removed.length,3)
  for(const row of audit.removed){
    assert.equal(row.checks.length,2);assert.ok(row.checks.every(c=>c.status===3));assert.equal(row.recheck.status,3)
    assert.ok(audit.removedSourceConfigurations.some(s=>s.id===row.id))
  }
  assert.equal(pack.total,pack.sources.length+pack.rejected.length+pack.duplicates.length)
  assert.equal(new Set(pack.sources.map(s=>s.id)).size,pack.sources.length)
})
