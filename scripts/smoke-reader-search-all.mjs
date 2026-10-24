import {networkShelf,sourcePage,searchPage,returnShelf} from './reader-smoke-navigation.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import {sampleSource,mockSourceFetcher} from '../tests/fixtures/network-source.js'
const {chromium}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT||'playwright')
const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-search-all-smoke-'))),databasePath=path.join(directory,'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
const requests=[],fixture=mockSourceFetcher(requests)
let delay=0,active=0,peak=0
const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async(url,options)=>{
  active++;peak=Math.max(peak,active)
  try{if(delay)await new Promise(r=>setTimeout(r,delay));if(new URL(url).hostname==='all2.example.org')throw new Error('fixture offline');return fixture(url,options)}finally{active--}
}})
let browser
try{
  await service.store.saveAccount({username:'fixture',password:'test-reader-password'})
  await service.store.saveAccount({username:'other',password:'test-other-password'})
  browser=await chromium.launch({headless:true,executablePath:process.env.NOVEL_STUDIO_BROWSER||undefined})
  const page=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true}),errors=[]
  if(process.env.NOVEL_STUDIO_READER_PUBLIC_FIXTURE){
    const fixture=await fs.realpath(process.env.NOVEL_STUDIO_READER_PUBLIC_FIXTURE)
    assert.ok(fixture.startsWith(await fs.realpath(os.tmpdir())+path.sep)||fixture.startsWith(await fs.realpath('/tmp')+path.sep),'deployment assets must be staged in a temporary directory')
    const assets={'/':'index.html','/network.js':'network.js','/reader.css':'reader.css','/reader.js':'reader.js'}
    await page.route(service.origin+'/**',async route=>{
      const file=assets[new URL(route.request().url()).pathname]
      if(!file)return route.continue()
      await route.fulfill({body:await fs.readFile(path.join(fixture,file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'})
    })
  }
  page.on('pageerror',e=>errors.push(e.message));await page.goto(service.origin)
  await page.locator('input[name=username]').fill('fixture');await page.locator('input[name=password]').fill('test-reader-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click()
  await networkShelf(page);await sourcePage(page)
  const sources=Array.from({length:8},(_,i)=>({...sampleSource,bookSourceName:`模拟 ${i}`,bookSourceUrl:`https://all${i}.example.org`}))
  await sourcePage(page);await page.locator('#source-json').fill(JSON.stringify(sources));await page.locator('#source-import').click();await page.locator('#source-import-status').filter({hasText:'成功 8 个'}).waitFor()
  await page.locator('.source-row').last().getByRole('button',{name:'停用',exact:true}).click();await searchPage(page);await page.locator('#network-source-summary').filter({hasText:'全部已启用书源（7 个）'}).waitFor()
  await sourcePage(page);await searchPage(page);await page.locator('#network-key').fill('测试作者');await searchPage(page);await page.locator('#network-search-submit').click()
  await page.locator('#network-status').filter({hasText:'搜索完成：7 / 7'}).waitFor();assert.equal(await page.locator('.network-result').count(),6)
  assert.match(await page.locator('#network-results').textContent(),/模拟 6/);assert.match(await page.locator('#network-status').textContent(),/异常 1 个/)
  assert.ok(requests.every(r=>new URL(r.url).hostname!=='all7.example.org'));assert.ok(peak<=2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.locator('#network-search-form').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'search-all-320.png')})
  await page.locator('#network-more').click();await page.waitForFunction(()=>document.querySelectorAll('.network-result').length===12);await page.locator('#network-status').filter({hasText:'搜索完成：7 / 7'}).waitFor()
  // Repeated submit does not start overlapping queues; stop retains the current batch.
  delay=250;await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('#network-search-stop').waitFor();assert.equal(await page.locator('#network-search-submit').isDisabled(),true)
  await page.locator('#network-status').filter({hasText:'正在搜索 0 / 7'}).waitFor();await page.locator('#network-search-stop').click();await page.locator('#network-status').filter({hasText:'已停止：2 / 7'}).waitFor()
  assert.equal(await page.locator('.network-result').count(),2);assert.equal(await page.locator('#network-more').isVisible(),false)
  await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('#network-status').filter({hasText:'正在搜索 0 / 7'}).waitFor();await page.locator('#network-results-close').click()
  await page.waitForTimeout(800);assert.equal(await page.locator('.network-result').count(),0);assert.equal(await page.locator('#network-status').textContent(),'')
  delay=0
  await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-source-clear').click()
  await page.locator('#network-source-filter').fill('模拟 6');await page.locator('#network-source-select-filtered').click();await page.locator('#network-source-done').click()
  await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('#network-status').filter({hasText:'搜索完成：1 / 1'}).waitFor();assert.equal(await page.locator('.network-result').count(),1)
  // Filtering is local and never loses checked sources hidden by the filter.
  await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-source-clear').click()
  await page.locator('#network-source-filter').fill('ALL0');await page.getByRole('checkbox',{name:'模拟 0',exact:true}).check()
  await page.locator('#network-source-filter').fill('all6');await page.getByRole('checkbox',{name:'模拟 6',exact:true}).check()
  await page.locator('#network-source-filter').fill('all2');await page.getByRole('checkbox',{name:'模拟 2',exact:true}).check()
  await page.locator('#network-source-filter').fill('不存在');assert.equal(await page.locator('#network-source-list input').count(),0)
  assert.match(await page.locator('#network-source-count').textContent(),/已选 3 个/)
  const beforeEnter=requests.length;await page.locator('#network-source-filter').press('Enter');assert.equal(requests.length,beforeEnter)
  await page.locator('#network-source-filter').fill('模拟');assert.equal(await page.locator('#network-source-list input:checked').count(),3)
  assert.equal(await page.locator('#network-source-list input').count(),7)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(directory,'source-picker-320.png')})
  await page.locator('#network-source-filter').press('Escape');assert.equal(await page.locator('#network-source-picker').getAttribute('open'),null)
  await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-key').click();assert.equal(await page.locator('#network-source-picker').getAttribute('open'),null)
  const from=requests.length;delay=250;await searchPage(page);await page.locator('#network-search-submit').click()
  await page.locator('#network-status').filter({hasText:'正在搜索 0 / 3'}).waitFor()
  await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-source-clear').click();await page.locator('#network-source-done').click()
  await page.locator('#network-status').filter({hasText:'搜索完成：3 / 3'}).waitFor()
  assert.equal(await page.locator('.network-result').count(),2);assert.match(await page.locator('#network-status').textContent(),/异常 1 个/)
  assert.ok(requests.slice(from).every(r=>['all0.example.org','all6.example.org'].includes(new URL(r.url).hostname)))
  // Next page keeps the last query's multi-source snapshot, not the edited UI.
  delay=0;await page.locator('#network-more').click();await page.waitForFunction(()=>document.querySelectorAll('.network-result').length===4)
  await page.locator('#network-status').filter({hasText:'搜索完成：3 / 3'}).waitFor()
  const beforeEmpty=requests.length;await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('#network-status').filter({hasText:'请选择至少一个书源'}).waitFor();assert.equal(requests.length,beforeEmpty)
  // A disabled selection is pruned; an empty explicit set must not become all.
  await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-source-filter').fill('模拟 6');await page.locator('#network-source-select-filtered').click();await page.locator('#network-source-done').click()
  await sourcePage(page);await sourcePage(page);await page.locator('#source-filter').fill('模拟 6');await page.locator('.source-row').getByRole('button',{name:'停用',exact:true}).click()
  await searchPage(page);await page.locator('#network-source-summary').filter({hasText:'已选 0 个'}).waitFor()
  const beforeDisabled=requests.length;await searchPage(page);await page.locator('#network-search-submit').click();assert.equal(requests.length,beforeDisabled)
  await sourcePage(page);await searchPage(page);await page.locator('#network-source-summary').click();await page.locator('#network-source-all').click();await page.locator('#network-source-done').click()
  assert.match(await page.locator('#network-source-summary').textContent(),/全部已启用书源（6 个）/)
  await returnShelf(page);await page.locator('#logout').click();await page.locator('input[name=username]').fill('other');await page.locator('input[name=password]').fill('test-other-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click()
  await networkShelf(page);await searchPage(page);await page.locator('#network-source-summary').filter({hasText:'全部已启用书源（0 个）'}).waitFor()
  assert.equal(await page.locator('#network-source-filter').inputValue(),'');assert.equal(await page.locator('#network-source-list input').count(),0)
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,directory,allEnabled:7,disabledExcluded:true,afterFifth:true,nextPage:true,sourceFailureIsolated:true,stop:true,staleResultsDiscarded:true,singleSource:true,fuzzySourceFilter:true,multiSelect:true,querySnapshot:true,explicitEmptyRejected:true,disabledPruned:true,accountReset:true,peak},null,2))
}finally{await browser?.close();await service.close()}
