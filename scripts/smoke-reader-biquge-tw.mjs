// Explicit live opt-in; only an isolated temporary account/database is written.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import raw from '../reader-service/biquge-tw-source.json' with {type:'json'}
import {normalizeSource} from '../reader-service/source-rules.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore} from '../reader-service/store.js'

assert.ok(process.argv.includes('--live'),'Pass --live to test public searches and only chapters 11, 12 and 20; no whole-book download.')
const root=await fs.realpath(os.tmpdir()),directory=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-biquge-tw-live-')))
const database=path.join(directory,'reader.sqlite')
assert.ok(directory.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(database)),directory)
const store=openReaderStore(database),source=normalizeSource(raw)
const report={ok:false,checkedAt:new Date().toISOString(),directory,sourceId:source.id,sourceVersion:source.version,productionChanged:false,wholeBookDownloaded:false,searches:[],chapters:[]}
try{
  await store.saveAccount({username:'fixture',password:randomBytes(24).toString('hex')})
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:randomBytes(32).toString('hex')})
  assert.equal((await library.handle('fixture','/sources/import','POST',{sources:raw})).rejected.length,0)
  let target
  for(const key of ['老板摆摊库库跑','凡人修仙传','冰咖半糖不加冰']){
    const found=await library.handle('fixture','/search','POST',{sourceId:source.id,key})
    report.searches.push({key,count:found.results.length,errors:found.errors,matches:found.results.slice(0,5).map(({title,author,url})=>({title,author,url}))})
    assert.deepEqual(found.errors,[])
    assert.ok(found.results.length>0,'Search must return real results: '+key)
    if(key==='老板摆摊库库跑')target=found.results.find(b=>b.url==='https://www.biquge.tw/book/7866077.html'&&b.author==='冰咖半糖不加冰')
    if(key==='凡人修仙传')assert.ok(found.results.some(b=>b.url!=='https://www.biquge.tw/book/7866077.html'),'Generic source must search another book')
    if(key==='冰咖半糖不加冰')assert.ok(found.results.some(b=>b.author==='冰咖半糖不加冰'),'Author search must include matching author')
  }
  assert.ok(target,'Require the verified title and author, not a same-name book')
  const book=await library.handle('fixture','/books','POST',{ticket:target.ticket})
  assert.equal(book.title,'老板摆摊库库跑，食客干饭猛猛追');assert.equal(book.author,'冰咖半糖不加冰')
  assert.equal(book.chapterCount,827);assert.equal(book.tocIncomplete,false)
  assert.equal((await library.handle('fixture','/books','POST',{ticket:target.ticket})).id,book.id)
  report.book={title:book.title,author:book.author,chapterCount:book.chapterCount,tocIncomplete:book.tocIncomplete}
  for(const [chapter,title] of [[11,'传说中的烤翅先天圣体'],[12,'这么会说做什么医生'],[20,'蒜泥白肉']]){
    const entry=book.chapters[chapter-1];assert.ok(entry.title.includes(title))
    const read=await library.handle('fixture',`/books/${book.id}/chapters/${entry.id}`,'GET',{})
    assert.ok(read.body.replace(/\s/g,'').length>=900)
    assert.doesNotMatch(read.body,/扫码下载APP|SVIP网页|登录后阅读|Ads by logly|<script|<iframe/)
    report.chapters.push({chapter,title:entry.title,characters:read.body.replace(/\s/g,'').length,sha256:createHash('sha256').update(read.body.replace(/\s/g,'')).digest('hex'),paragraphs:read.body.split(/\n+/).filter(Boolean).length})
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_books').get().n,1)
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
  report.ok=true
}catch(error){report.error={message:error.message,code:error.code,status:error.status};process.exitCode=1}
finally{store.close();await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
