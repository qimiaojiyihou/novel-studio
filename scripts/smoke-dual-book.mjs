import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'
import { bindCreative, callCreative } from './creative-client.mjs'
import { CREATIVE_BUILD_ID } from '../electron/build-info.js'

const require=createRequire(import.meta.url),{_electron}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const root=path.resolve(import.meta.dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'novel-dual-desktop-'))
const env={...process.env,NOVEL_STUDIO_TEST_USER_DATA:directory,NOVEL_STUDIO_NO_GO:'1'}
delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
const pending=[],calls=[],errors=[]
let app,page
const closeApp=async()=>{
  if(!app)return
  const current=app;app=null
  const timer=setTimeout(()=>current.process().kill('SIGKILL'),5000)
  try {await current.close()} finally {clearTimeout(timer)}
}
const model=createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));calls.push(input.model)
  const finish=()=>{if(!response.destroyed){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:`${input.model} 的模拟正文。周砚把收据放在桌上。`}}]}))}}
  pending.push({model:input.model,finish})
})
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve))
const startApp=async()=>{
  app=await _electron.launch({executablePath:process.env.NOVEL_STUDIO_TEST_APP || require('electron'),args:process.env.NOVEL_STUDIO_TEST_APP?[]:['.'],cwd:root,env,timeout:30000})
  app.process().stderr.on('data',data=>{if(/Error|Unhandled|constraint/i.test(String(data))) process.stderr.write(data)})
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))
  await page.waitForFunction(()=>Boolean(window.novelStudio))
  const info=await page.evaluate(()=>window.novelStudio.getRuntimeInfo())
  assertIsolatedRuntime(info,directory)
  assert.equal(fs.realpathSync(info.creativeInterface.serverFile),fs.realpathSync(path.join(directory,'creative-interface/server.json')))
  assert.equal(info.buildId,CREATIVE_BUILD_ID)
  console.log('Isolated runtime ready:',info.buildId)
  return info
}
const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30))}assert.fail('desktop condition timed out')}
try {
  await startApp()
  // Above runtime path check precedes every fixture write and every restart.
  const books=[]
  for (const [index,title] of ['隔离测试悬疑书','隔离测试文娱书'].entries()) {
    books.push(await page.evaluate(input=>window.novelStudio.createProject(input),{title,genre:index?'文娱':'悬疑',idea:`fixture-book-${index}`}))
  }
  const bindings=[]
  for(const [index,book] of books.entries()){
    bindings.push(await bindCreative(path.join(directory,'creative-interface'),{clientId:`fixture-${index}`,projectId:book.project.id,expectedTitle:book.project.title}))
    await page.evaluate(async({projectId,index,port})=>{
      await window.novelStudio.loadPlanningCenter(projectId)
      await window.novelStudio.saveModelProfile({id:`fixture-${index}`,name:`本机模拟 ${index}`,provider:'local',model:`fixture-${index}`,baseUrl:`http://127.0.0.1:${port}/v1`,settings:{requestConfig:{stream:false}}})
    },{projectId:book.project.id,index,port:model.address().port})
  }
  const call=(index,op,input={},id='')=>callCreative(bindings[index].clientFile,op,input,id)
  await page.reload();await page.getByRole('button',{name:'创作助手',exact:true}).click()
  const startInput=index=>({projectId:books[index].project.id,chapterId:books[index].chapters[0].id,task:'chapter',target:{kind:'manuscript',targetId:books[index].chapters[0].id},executionMode:'app_model',modelProfileId:`fixture-${index}`})
  const [a,b]=await Promise.all([call(0,'run.start-inline',startInput(0),'generate-0001'),call(1,'run.start-inline',startInput(1),'generate-0001')])
  console.log('Two external runs started')
  await wait(()=>calls.length===2)
  await assert.rejects(call(0,'run.get',{runId:b.id}),{code:'PROJECT_MISMATCH'})
  assert.equal((await call(0,'run.start-inline',startInput(0),'generate-0001')).id,a.id)
  await assert.rejects(call(0,'run.start-inline',startInput(0),'generate-0002'),{code:'TARGET_BUSY'})
  assert.equal((await call(0,'identity')).projectId,books[0].project.id)
  pending.find(item=>item.model==='fixture-0').finish()
  await wait(async()=>Boolean((await call(0,'run.get',{runId:a.id})).candidates.length))
  assert.equal(await page.locator('.topbar-project strong').innerText(),books[1].project.title)
  assert.doesNotMatch(await page.locator('.assistant-layout').innerText(),new RegExp(a.id))
  pending.find(item=>item.model==='fixture-1').finish()
  await wait(async()=>Boolean((await call(1,'run.get',{runId:b.id})).candidates.length))
  const ra=await call(0,'run.get',{runId:a.id}),rb=await call(1,'run.get',{runId:b.id})
  await assert.rejects(call(0,'candidate.resolve',{runId:a.id,candidateId:rb.candidates[0].id,accept:true,confirm:true,reason:'工程确认'},'bad-crossbook'),{code:'PROJECT_MISMATCH'})
  await Promise.all([call(0,'candidate.resolve',{runId:a.id,candidateId:ra.candidates[0].id,accept:true,confirm:true,reason:'工程确认 A'},'accept-0001'),call(1,'candidate.resolve',{runId:b.id,candidateId:rb.candidates[0].id,accept:true,confirm:true,reason:'工程确认 B'},'accept-0001')])
  await page.getByRole('button',{name:'本书任务有更新',exact:true}).click()
  await page.getByRole('button',{name:'正在创作',exact:true}).click()
  assert.equal(await page.locator('.cm-content').innerText(),'fixture-1 的模拟正文。周砚把收据放在桌上。')
  // Actual frontend project switch never changes the bound client.
  await page.locator('.project-switch-trigger').click()
  await page.locator('.project-select').filter({hasText:books[0].project.title}).click()
  assert.equal(await page.locator('.cm-content').innerText(),'fixture-0 的模拟正文。周砚把收据放在桌上。')
  assert.equal((await call(1,'snapshot')).project.id,books[1].project.id)
  await page.screenshot({path:path.join(directory,'dual-book.png')})
  await call(0,'run.finish',{runId:a.id},'finish-0001')
  const source=await call(0,'snapshot')
  const proposal=await call(0,'candidate.propose',{task:'chapter',chapterId:books[0].chapters[0].id,target:{kind:'manuscript',targetId:books[0].chapters[0].id},sourceDigest:source.sourceDigest,payload:{manuscript:'外部作者的待确认候选。'}},'proposal-0001')
  assert.equal(calls.length,2,'external proposal does not call a model')
  await call(0,'candidate.resolve',{runId:proposal.id,candidateId:proposal.candidates[0].id,accept:true,confirm:true,reason:'工程测试候选确认'},'proposal-accept')
  assert.equal((await call(0,'chapter.get',{chapterId:books[0].chapters[0].id})).manuscript,'外部作者的待确认候选。')
  // A stale editor buffer must never silently overwrite an external acceptance.
  await assert.rejects(page.evaluate(({id})=>window.novelStudio.updateChapter({id,expectedManuscript:'旧稿',manuscript:'覆盖外部结果'}),{id:books[0].chapters[0].id}),/另一创作任务更新/)
  const finalization=await call(0,'finalization.start',{chapterId:books[0].chapters[0].id,reviewer:{executionMode:'codex',model:'gpt-6-astra',reasoningEffort:'xhigh'}},'finalization-01')
  assert.equal(finalization.status,'ready_for_review')
  assert.equal(finalization.reviewer.model,'gpt-6-astra')
  assert.equal(finalization.reviewer.reasoningEffort,'xhigh')
  assert.equal(calls.length,2)
  await call(0,'finalization.act',{id:finalization.id,action:'cancel'},'finalization-cancel')
  // Disconnecting HTTP does not cancel a run; after process restart, the same
  // credential discovers the new endpoint and no model starts automatically.
  await closeApp()
  await startApp()
  assert.equal((await call(0,'identity')).projectId,books[0].project.id)
  assert.equal((await call(1,'identity')).projectId,books[1].project.id)
  assert.equal((await call(0,'run.start-inline',startInput(0),'generate-0001')).id,a.id)
  assert.equal(calls.length,2)
  assert.equal((await call(1,'chapter.get',{chapterId:books[1].chapters[0].id})).manuscript,rb.candidates[0].payload.manuscript)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({status:'engineering-only-pass',buildId:CREATIVE_BUILD_ID,directory,mockModelCalls:calls.length,projects:books.map(book=>book.project.id)},null,2))
} catch(error) {
  console.error(error)
  throw error
} finally {
  for(const item of pending)item.finish()
  await closeApp()
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve))
}
