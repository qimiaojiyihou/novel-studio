// Exercise the actual imported rules without contacting their websites or
// persisting any imported credentials. All writes use a verified temp database.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {openReaderStore} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
const raw=JSON.parse(await fs.readFile(process.argv[2],'utf8')),wanted=new Set(['起点中文','番茄小说2','69书吧.com','69书吧','手机小说','铅笔小说'])
const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-six-rules-'))),dbPath=path.join(dir,'reader.sqlite')
assert.ok(dir.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(dbPath)),dir)
const store=openReaderStore(dbPath),report=[]
try{
  await store.saveAccount({username:'fixture',password:'temporary-test-password'})
  for(const input of raw.filter(s=>wanted.has(s.bookSourceName))){
    const s=structuredClone(input);delete s.header // Never test the file's real Cookie.
    if(s.bookSourceName==='手机小说')s.header={Cookie:'fixture=mock-only'}
    const fq=s.bookSourceName==='番茄小说2',qd=s.bookSourceName==='起点中文',base=s.bookSourceUrl
    const lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-only',fetchPage:async(url)=>{
      const u=new URL(url),p=u.pathname
      if(fq){
        const data=p.includes('/search/')?{data:[{book_data:[{book_id:'123',book_name:'测试书',author:'作者'}]}]}:p.includes('multi-detail')?{data:[{book_id:'123',genre:'0'}]}:p.includes('/reader/directory/')?{data:{allItemIds:['456']}}:p.includes('/directory/detail/')?{data:[{item_id:'456',title:'第一章',volume_name:'0',first_pass_time:1700000000,chapter_word_number:3000}]}:{data:{content:'正文第一段。\n正文第二段。'}}
        return {url,text:JSON.stringify(data)}
      }
      if(/search|\/so\//.test(p))return {url,text:`<div class="res-book-item"><div class="book-info-title"><a href="/book/123.htm" data-bid="123">测试书</a></div><div class=author><a class=name>作者</a></div></div><div class=newbox><ul><li><h3><a href="/book/123.htm">封面</a><a href="/book/123.htm">测试书</a></h3><label>作者</label><label>悬疑</label></li></ul></div><div class=novel-item><a href="/book/123.htm"><img alt="测试书"></a><span class=novel-author>作者</span></div><div class=module-search-item><a title="测试书" href="/book/123.htm">测试书</a></div>`}
      if(/chapter/.test(p))return {url,text:'<div class=read-content>正文第一段。<p>正文第二段。</p></div><div class=txtnav>正文第一段。<br>正文第二段。</div><div id=zjny>正文第一段。<br>正文第二段。</div><div id=content>正文第一段。</div><div class=article-content>正文第一段。<br>正文第二段。</div>'}
      const meta='<meta property="og:novel:book_name" content="测试书"><meta property="og:novel:author" content="作者"><meta property="og:description" content="简介">'
      return {url,text:`${meta}<a id=details-menu href="/catalog/123">目录</a><a class=catalog-more href="/catalog/123">目录</a><div id=catalog><ul><li><a href="/chapter/1">第一章</a></li></ul></div><div id=lbks><dl><dt>正文</dt><dd><a href="/chapter/1">第一章</a></dd></dl></div><a class=module-row-text href="/chapter/1"><span>第一章</span></a>${qd?'"sS":0,"cN":"第一章","id":22,"uT":"2026"':''}`}
    }})
    const call=(route,method='GET',input={})=>lib.handle('fixture',route,method,input)
    try{
      const imported=await call('/sources/import','POST',{sources:s});assert.equal(imported.accepted.length,1,JSON.stringify(imported.rejected))
      if(fq)await call(`/sources/${imported.accepted[0].id}/auth`,'PUT',{params:{密钥:'mock-key'}})
      const search=await call('/search','POST',{key:'测试',sourceId:imported.accepted[0].id});assert.ok(search.results.length,JSON.stringify(search.errors))
      const saved=await call('/books','POST',{ticket:search.results[0].ticket}),book=await call(`/books/${saved.id}`)
      const chapter=await call(`/books/${saved.id}/chapters/${book.chapters[0].id}`);assert.match(chapter.body,/正文/)
      report.push({name:s.bookSourceName,import:true,search:search.results.length,chapters:saved.chapterCount,contentCharacters:chapter.body.length})
    }catch(error){report.push({name:s.bookSourceName,error:error.message});process.exitCode=1}
  }
  assert.equal(report.length,6)
  console.log(JSON.stringify({mode:'mock-actual-rules',database:dbPath,results:report},null,2))
}finally{store.close()}
