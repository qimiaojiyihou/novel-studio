// Only synthetic sites and verified temporary SQLite; never production data.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import {sampleSource} from '../tests/fixtures/network-source.js'
const {chromium}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT||'playwright')
const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-completion-smoke-'))),databasePath=path.join(dir,'reader.sqlite')
assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(databasePath)),dir)
const raw={...sampleSource,searchUrl:'/search',ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{tocUrl:'a.toc@href'},ruleToc:{chapterList:'.chapters a',chapterName:'text',chapterUrl:'href',nextTocUrl:'a.next@href'}}
const requests=[];let delay=50,failPage=0
const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async url=>{
  const p=new URL(url).pathname;requests.push(p)
  if(p==='/search')return {url,text:'<li><a href=/book>长目录模拟书</a></li>'}
  if(p==='/book')return {url,text:'<a class=toc href=/toc/1>目录</a>'}
  if(p.startsWith('/toc/')){const n=Number(p.split('/').pop());await new Promise(r=>setTimeout(r,delay));if(n===failPage)throw Object.assign(Error('fixture disconnect'),{status:502});return {url,text:`<div class=chapters><a href=/chapter/${n}>第${n}章 模拟目录</a></div>${n<13?`<a class=next href=/toc/${n+1}>下一页</a>`:''}`}}
  return {url,text:'<div id=content>模拟正文。目录任务不会改变阅读位置。</div>'}
}})
let browser
try{
  await service.store.saveAccount({username:'fixture',password:'fixture-only-password'})
  browser=await chromium.launch({headless:true,executablePath:process.env.NOVEL_STUDIO_BROWSER||undefined})
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
  await page.goto(service.origin);await page.locator('input[name=username]').fill('fixture');await page.locator('input[name=password]').fill('fixture-only-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click()
  await page.locator('#network-library').click();await page.locator('#shelf').waitFor({state:'visible'});assert.equal(await page.locator('#network-tools').isVisible(),false)
  await page.locator('#manage-sources').click();await page.locator('#discovery').waitFor({state:'visible'});assert.equal(await page.locator('#shelf').isVisible(),false);assert.equal(await page.locator('#network-search-page').isVisible(),false)
  await page.locator('#source-json').fill(JSON.stringify(raw));await page.locator('#source-import').click();await page.locator('#source-import-status').filter({hasText:'成功 1 个'}).waitFor()
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(dir,'sources-320.png')})
  await page.locator('#discovery-search').click();await page.waitForURL('**/#find');assert.equal(await page.locator('#source-manager').isVisible(),false)
  await page.locator('#network-key').fill('模拟书');await page.locator('#network-search-submit').click();await page.locator('#network-results').getByRole('button',{name:'加入书架',exact:true}).click()
  await page.locator('.network-add-feedback').filter({hasText:'已加入'}).waitFor();assert.equal(await page.locator('#discovery').isVisible(),true)
  await page.screenshot({path:path.join(dir,'search-320.png')});await page.locator('#discovery-back').click();await page.locator('#books .book').waitFor();assert.match(await page.locator('.book-count').textContent(),/已加载 5 章.*补全目录/)
  let lost=false
  await page.route('**/api/network/books/*/refresh',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed')}else await route.continue()})
  await page.getByRole('button',{name:'一键补全目录',exact:true}).click();await page.getByRole('button',{name:'重试补全目录',exact:true}).waitFor()
  assert.equal(JSON.parse(service.store.db.prepare('SELECT chapters FROM network_books').get().chapters).length,10,'lost response already persisted one complete batch')
  await page.screenshot({path:path.join(dir,'resumable-error-320.png')})
  await page.getByRole('button',{name:'重试补全目录',exact:true}).click();await page.locator('#find-books').click();await page.locator('#discovery').waitFor({state:'visible'})
  await page.locator('.directory-job [role=status]').filter({hasText:'目录已补全'}).waitFor({state:'attached'});assert.equal(await page.locator('#discovery').isVisible(),true)
  await page.goBack();await page.locator('#shelf').waitFor({state:'visible'});assert.match(await page.locator('.book-count').textContent(),/13 章/)
  assert.equal(requests.filter(p=>p.startsWith('/chapter/')).length,0,'completing directory never downloads chapter text')
  // Pause an in-flight full refresh; a reload reconstructs the server cursor.
  delay=180;await page.locator('.directory-job [data-complete]').click();await page.locator('.directory-job [data-pause]').waitFor();await page.locator('.directory-job [data-pause]').click()
  await page.locator('.directory-job [role=status]').filter({hasText:'已暂停'}).waitFor();await page.waitForTimeout(1300)
  await page.reload();await page.locator('#network-library').click();await page.locator('#books .book').waitFor()
  const incomplete=JSON.parse(service.store.db.prepare('SELECT chapters FROM network_books').get().chapters).length
  assert.equal(incomplete,13,'pause never discards chapters that were already loaded')
  await page.locator('.directory-job [data-complete]').click();await page.locator('.directory-job [role=status]').filter({hasText:'目录已补全'}).waitFor()
  await page.locator('#books .book').getByRole('button',{name:'开始阅读',exact:true}).click();await page.locator('#reader').waitFor({state:'visible'})
  await page.locator('#viewport').press('Escape');await page.locator('#directory').click();await page.locator('#toc-number').fill('7');await page.locator('#toc-go').click();await page.locator('#chapter-label').filter({hasText:'第7章'}).waitFor()
  await page.locator('#viewport').press('Escape');await page.locator('#back').click();await page.locator('.directory-job [data-complete]').click()
  let revisionConflict=false
  await page.route('**/api/network/books/*/chapters/*',async route=>{if(!revisionConflict){revisionConflict=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'目录已变化，请重试'})})}else await route.continue()})
  await page.locator('#books .book').getByRole('button',{name:'继续阅读',exact:true}).click();await page.locator('#chapter-label').filter({hasText:'第7章'}).waitFor()
  await page.locator('#viewport').press('Escape');await page.locator('#directory').click();await page.locator('#toc-load-status').filter({hasText:'目录已补全'}).waitFor()
  assert.match(await page.locator('#chapter-label').textContent(),/第7章/);assert.equal(await page.locator('#toc-list button').count(),13)
  await page.screenshot({path:path.join(dir,'completion-reading-320.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(revisionConflict,true);assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,directory:dir,firstBatch:5,complete:13,lostResponseResume:true,pageNavigationDuringCompletion:true,pauseAndReload:true,readingPositionPreserved:true,revisionConflictRetry:true,metadataOnly:true,mobile320:true},null,2))
}finally{await browser?.close();await service.close()}
