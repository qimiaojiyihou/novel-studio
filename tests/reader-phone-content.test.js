import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import catalog from '../reader-service/default-sources.json' with {type:'json'}
import {document,contentText} from '../reader-service/source-rules.js'
import {openReaderStore} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'

const phone=catalog.sources.find(s=>s.id==='8992ef30eefdcd511519a0780f9d8bcd')

test('phone HTML extraction preserves literal and entity-encoded 上 without executing scripts',()=>{
  const raw='<div id="content"><p>桌上的书，楼上的人，向上看。</p><p>书架&#19978;和台阶&#x4e0a;。</p><script>throw Error("must not run")</script></div>'
  const parsed=contentText(document(raw),phone.rules.ruleContent)
  assert.equal(parsed,'桌上的书，楼上的人，向上看。\n\n书架上和台阶上。')
  assert.equal((parsed.match(/上/g)||[]).length,5)
  assert.equal(parsed.includes('must not run'),false)
  assert.equal(contentText(document('<div id="zjny"><p>上下楼，上课，晚上。</p></div>'),phone.rules.ruleContent),'上下楼，上课，晚上。')
})

test('phone parsing faithfully preserves damaged upstream text rather than inventing missing words',()=>{
  const raw='桌的书，楼的人，向看。'
  assert.equal(contentText(document(`<div id="content"><p>${raw}</p></div>`),phone.rules.ruleContent),raw)
})

test('phone chapters 11, 12 and 20 retain every 上 through both body pages and the reader API',async t=>{
  const root=await fs.realpath(os.tmpdir()),directory=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-phone-content-')))
  const file=path.join(directory,'reader.sqlite')
  assert.ok(directory.startsWith(root+path.sep))
  assert.equal(await fs.realpath(path.dirname(file)),directory,'verify actual fixture database path before opening/writing')
  const store=openReaderStore(file);t.after(()=>store.close())
  await store.saveAccount({username:'fixture',password:'fixture-phone-content-password'})
  const title='模拟手机小说上字分页验证书',requests=[]
  const fetchPage=async url=>{
    const p=new URL(url).pathname;requests.push(p)
    if(p==='/search/')return{url,text:`<li><span class="s2"><a href="/fixture/">${title}</a></span><span class="s4">模拟作者</span></li>`}
    if(p==='/fixture/')return{url,text:`<div id="info"><h1>${title}</h1><p>作者：模拟作者</p></div><div id="list"><dl><dt>正文</dt>${Array.from({length:20},(_,i)=>`<dd><a href="/chapter/${i+1}.html">第${i+1}章 上下楼</a></dd>`).join('')}</dl></div>`}
    const match=p.match(/^\/chapter\/(11|12|20)(_2)?\.html$/);assert.ok(match,'only three explicitly requested fixture chapters are fetched')
    const no=Number(match[1])
    return{url,text:match[2]?`<div id="content"><p>第${no}章第二页，晚上回到楼上。</p></div><a href="/chapter/${no+1}.html">下一章</a>`:`<div id="content"><p>第${no}章第一页，向上看桌上的书。</p></div><a href="/chapter/${no}_2.html">下一页</a>`}
  }
  const library=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-phone-key',fetchPage})
  const item=(await library.handle('fixture','/search','POST',{sourceId:phone.id,key:title})).results[0]
  const book=await library.handle('fixture','/books','POST',{ticket:item.ticket})
  assert.equal(book.chapterCount,20)
  for(const no of [11,12,20]){
    const chapter=book.chapters[no-1]
    const read=await library.handle('fixture',`/books/${book.id}/chapters/${chapter.id}`,'GET',{})
    assert.equal(read.body,`第${no}章第一页，向上看桌上的书。\n\n第${no}章第二页，晚上回到楼上。`)
    assert.equal((read.body.match(/上/g)||[]).length,4)
    assert.equal(JSON.parse(JSON.stringify(read)).body,read.body,'API JSON serialization never drops 上')
  }
  assert.deepEqual(requests.filter(p=>p.startsWith('/chapter/')),['/chapter/11.html','/chapter/11_2.html','/chapter/12.html','/chapter/12_2.html','/chapter/20.html','/chapter/20_2.html'])
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
})
