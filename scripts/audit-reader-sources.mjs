// Run against the bundled catalogue, never a production account or database.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {pathToFileURL} from 'node:url'

const args=process.argv.slice(2),ids=[];let packPath=new URL('../reader-service/default-sources.json',import.meta.url),keyword='斗破苍穹',serviceDir=new URL('../reader-service/',import.meta.url),exerciseAdd=false,allResults=false,diagnose=false,fallbackKeys=[],maxResults=50
for(let i=0;i<args.length;i++){
  if(args[i]==='--pack')packPath=path.resolve(args[++i])
  else if(args[i]==='--key')keyword=args[++i]
  else if(args[i]==='--service-dir')serviceDir=pathToFileURL(path.resolve(args[++i])+path.sep)
  else if(args[i]==='--exercise-add')exerciseAdd=true
  else if(args[i]==='--all-results')allResults=true
  else if(args[i]==='--diagnose')diagnose=true
  else if(args[i]==='--fallback-keys')fallbackKeys=args[++i].split(',').filter(Boolean)
  else if(args[i]==='--max-results')maxResults=Number(args[++i])
  else if(args[i].startsWith('--'))throw Error('Unknown option: '+args[i])
  else ids.push(args[i])
}
const pack=JSON.parse(await fs.readFile(packPath,'utf8'))
assert.ok(Number.isInteger(maxResults)&&maxResults>=1&&maxResults<=50&&fallbackKeys.length<=4)
const {openReaderStore}=await import(new URL('store.js',serviceDir)),{createNetworkLibrary}=await import(new URL('network-library.js',serviceDir))
const {createSourceFetcher}=await import(new URL('source-fetch.js',serviceDir))
const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-source-audit-')))
const databasePath=path.join(directory,'audit.sqlite')
assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
assert.ok(directory.startsWith(await fs.realpath(os.tmpdir())+path.sep))
const store=openReaderStore(databasePath),fetchSource=createSourceFetcher();let traces=[],traceIndex=0
const fetchPage=async(url,options)=>{
  const u=new URL(url),trace={origin:u.origin,path:u.pathname,queryKeys:[...new Set(u.searchParams.keys())]};traces.push(trace)
  try{const loaded=await fetchSource(url,options);trace.finalOrigin=new URL(loaded.url).origin;trace.characters=loaded.text.length;trace.title=loaded.text.match(/<title[^>]*>([^<]*)/i)?.[1]?.slice(0,140)
    if(diagnose){const file='response-'+(++traceIndex)+'.txt';await fs.writeFile(path.join(directory,file),loaded.text,{mode:0o600});trace.fixture=file}
    return loaded
  }catch(error){for(const field of ['code','httpStatus','phase','targetOrigin'])if(error[field]!==undefined)trace[field]=error[field];throw error}
}
const library=createNetworkLibrary(store.db,{defaultSources:pack,fetchPage})
const report={startedAt:new Date().toISOString(),version:pack.version,keyword,exerciseAdd,allResults,scope:'specified catalogue / isolated temporary database / system DNS',results:[]}
const sources=ids.length?pack.sources.filter(s=>ids.includes(s.id)):pack.sources
assert.ok(!ids.length||sources.length===new Set(ids).size,'audit IDs must match bundled sources exactly')
let lastCall=0
const call=async(route,method,input)=>{await delay(Math.max(0,lastCall+1100-Date.now()));lastCall=Date.now();return library.handle('audit',route,method,input)}
const titleKey=value=>value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'')
async function addAndRead(s){
  const row={id:s.id,name:s.name,url:s.url,stage:'search',matches:{},addTests:[],attempts:[]},started=Date.now()
  try{
    let search,usedKey
    for(const key of [...new Set([keyword,...fallbackKeys])]){
      usedKey=key;search=await call('/search','POST',{sourceId:s.id,key});row.matches.search=search.results.length;row.attempts.push({key,results:search.results.length,code:search.errors[0]?.code})
      if(search.errors.length){const issue=search.errors[0];if(issue.code==='SEARCH_TERM_TOO_SHORT'&&key!==[...new Set([keyword,...fallbackKeys])].at(-1))continue;return {...row,status:issue.code==='RULE_UNSUPPORTED'?'unsupported':'review',...issue}}
      if(search.results.length)break
    }
    const matching=search.results.filter(item=>titleKey(item.title)===titleKey(usedKey));row.matches.targetResults=matching.length
    if(!matching.length&&(!allResults||!search.results.length))return {...row,status:'empty',code:search.results.length?'SEARCH_TITLE_NOT_FOUND':'SEARCH_EMPTY',message:'没有搜到指定书名，未拿其他书替代加入测试',returnedTitles:search.results.slice(0,5).map(item=>item.title)}
    row.targetFound=matching.length>0;row.matches.testedResults=allResults?search.results.length:matching.length
    for(const item of (allResults?search.results:matching).slice(0,maxResults)){
      const check={title:item.title,add:false,idempotent:false,read:false};row.addTests.push(check);let added
      try{
        row.stage='add';added=await call('/books','POST',{ticket:item.ticket});check.add=true;check.chapterCount=added.chapterCount
        const count=store.db.prepare('SELECT COUNT(*) AS n FROM network_books WHERE owner=?').get('audit').n
        const duplicate=await call('/books','POST',{ticket:item.ticket})
        assert.equal(duplicate.id,added.id);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_books WHERE owner=?').get('audit').n,count)
        check.idempotent=true;assert.ok(added.chapters.length)
        check.directoryComplete=!added.tocIncomplete;check.tocBatches=1
        row.stage='read';const chapter=await call(`/books/${added.id}/chapters/${added.chapters[0].id}`,'GET',{})
        assert.ok(chapter.body.trim());check.read=true;check.contentCharacters=chapter.body.length
        try{while(added.tocIncomplete&&check.tocBatches<25){row.stage='toc';added=await call(`/books/${added.id}/refresh`,'POST',{});check.tocBatches++;check.chapterCount=added.chapterCount}check.directoryComplete=!added.tocIncomplete}
        catch(error){check.directoryError={code:error.code||'TOC_INCOMPLETE',message:error.status?error.message:'目录续载未完成'}}
      }catch(error){check.code=error.code||'ADD_READ_FAILED';check.message=error.status?error.message:'加入/目录/正文或幂等校验未通过';for(const field of ['httpStatus','phase','targetOrigin'])if(error[field]!==undefined)check[field]=error[field]}
      finally{if(added)await library.handle('audit',`/books/${added.id}`,'DELETE',{})}
    }
    return {...row,status:row.addTests.every(t=>t.add&&t.idempotent&&t.read)?row.addTests.every(t=>t.directoryComplete)?'healthy':'partial':'review',message:'已执行真实搜索 → 加入书架 → 重复提交 → 目录续载 → 首章读取接口（临时账号）'}
  }catch(error){return {...row,status:'review',code:error.code||'AUDIT_FAILED',message:error.status?error.message:'测试未完成'}}
  finally{row.durationMs=Date.now()-started}
}
try{
  await store.saveAccount({username:'audit',password:randomBytes(24).toString('hex')})
  console.log(JSON.stringify({started:true,directory,sourceCount:sources.length,keyword}))
  if(exerciseAdd)for(const source of sources){
    traces=[];const started=Date.now(),row=await addAndRead(source)
    if(diagnose&&row.status!=='healthy'&&!source.unsupported){try{await delay(1100);await fetchPage(source.url,{scope:source.url,allowedOrigins:source.allowedOrigins,headers:source.headers,signal:AbortSignal.timeout(15000)})}catch{/* The trace records homepage failures separately. */}}
    row.trace=traces;row.durationMs=Date.now()-started;row.checkedAt=new Date().toISOString();report.results.push(row);console.log(JSON.stringify(row))
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))
  }
  else for(let offset=0;offset<sources.length;offset+=2){
    const batch=sources.slice(offset,offset+2),started=Date.now()
    const {results}=await library.handle('audit','/sources/check','POST',{ids:batch.map(s=>s.id),key:keyword,exactTitle:true})
    for(const item of results){const source=batch.find(s=>s.id===item.id),row={...item,name:source.name,url:source.url};report.results.push(row);console.log(JSON.stringify(row))}
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))
    if(offset+2<sources.length)await delay(Math.max(0,1500-(Date.now()-started)))
  }
  report.finishedAt=new Date().toISOString()
  report.summary=Object.fromEntries([...new Set(report.results.map(r=>r.status))].map(status=>[status,report.results.filter(r=>r.status===status).length]))
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({finished:true,directory,summary:report.summary}))
}finally{store.close()}
