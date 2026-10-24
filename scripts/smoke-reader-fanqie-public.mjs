// Explicit opt-in live audit. Never uses the desktop library or reader accounts.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import source from '../reader-service/fanqie-public-source.json' with {type:'json'}
import {normalizeSource} from '../reader-service/source-rules.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore} from '../reader-service/store.js'

assert.ok(process.argv.includes('--live'),'Use --live to explicitly request four public-page stages; no whole-book download.')
const root=await fs.realpath(os.tmpdir()),directory=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-fanqie-live-'))),database=path.join(directory,'reader.sqlite')
assert.ok(directory.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(database)),directory)
const store=openReaderStore(database)
try{
  await store.saveAccount({username:'fixture',password:randomBytes(24).toString('hex')})
  const library=createNetworkLibrary(store.db,{defaultSources:null,authKey:randomBytes(32).toString('hex')})
  const imported=await library.handle('fixture','/sources/import','POST',{sources:source});assert.equal(imported.rejected.length,0)
  const search=await library.handle('fixture','/search','POST',{sourceId:normalizeSource(source).id,key:'邪神墨然'})
  assert.deepEqual(search.errors,[])
  const item=search.results.find(book=>book.url==='https://fanqienovel.com/page/7287479909398613032')
  assert.ok(item,'Require the exact previously verified public book ID, never substitute a random result')
  const book=await library.handle('fixture','/books','POST',{ticket:item.ticket})
  assert.ok(book.chapterCount>=2)
  assert.equal((await library.handle('fixture','/books','POST',{ticket:item.ticket})).id,book.id)
  const chapters=[]
  for(const entry of book.chapters.slice(0,2)){
    const result=await library.handle('fixture',`/books/${book.id}/chapters/${entry.id}`,'GET',{})
    assert.ok(result.body.length>500);assert.ok(!/[\uE000-\uF8FF]/.test(result.body))
    chapters.push({title:entry.title,characters:result.body.length,paragraphs:result.body.split('\n').length,unmappedGlyphs:false})
  }
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM network_books').get().n,1)
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
  console.log(JSON.stringify({ok:true,checkedAt:new Date().toISOString(),database,title:book.title,author:book.author,searchResults:search.results.length,chapterCount:book.chapterCount,chapters,productionChanged:false,wholeBookDownloaded:false},null,2))
}finally{
  store.close()
}
