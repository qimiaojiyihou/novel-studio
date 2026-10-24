import {networkShelf,sourcePage,searchPage,returnShelf} from './reader-smoke-navigation.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
const {startReaderServer}=await import(process.env.READER_SERVICE_ROOT?`${process.env.READER_SERVICE_ROOT}/server.js`:'../reader-service/server.js')
import {sampleSource} from '../tests/fixtures/network-source.js'
const {chromium}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT||'playwright')
const root=await fs.realpath(os.tmpdir()),directory=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-toc-smoke-'))),databasePath=path.join(directory,'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(databasePath)),directory);assert.ok(directory.startsWith(root+path.sep))
const raw={...sampleSource,searchUrl:'/search',ruleSearch:{bookList:'li',name:'a@text',bookUrl:'a@href'},ruleBookInfo:{tocUrl:'a.toc@href'},ruleToc:{chapterList:'.chapters a',chapterName:'text',chapterUrl:'href',nextTocUrl:'a.next@href'}}
const requests=[],service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,allowEmbedding:true,defaultSources:null,sourceFetcher:async url=>{
  const pathname=new URL(url).pathname;requests.push(pathname)
  if(pathname==='/search')return {url,text:'<li><a href=/book>长目录模拟书</a></li>'}
  if(pathname==='/book')return {url,text:'<a class=toc href=/toc/1>目录</a>'}
  if(pathname.startsWith('/toc/')){const n=Number(pathname.split('/').pop());return {url,text:`<div class=chapters>${Array.from({length:80},(_,i)=>{const chapter=(n-1)*80+i+1;return `<a href=/chapter/${chapter}>第${chapter}章 模拟章节</a>`}).join('')}</div>${n<13?`<a class=next href=/toc/${n+1}>下一页</a>`:''}`}}
  return {url,text:'<div id=content>模拟正文。阅读不会等待全部目录。</div>'}
}})
let browser
try{
  await service.store.saveAccount({username:'fixture',password:'fixture-only-password'})
  browser=await chromium.launch({headless:true,executablePath:process.env.NOVEL_STUDIO_BROWSER||undefined})
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.goto(service.origin)
  await page.locator('input[name=username]').fill('fixture');await page.locator('input[name=password]').fill('fixture-only-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click();await page.locator('#shelf').waitFor({state:'visible'})
  await networkShelf(page);await sourcePage(page);await page.locator('#source-json').fill(JSON.stringify(raw));await page.locator('#source-import').click();await page.locator('#source-import-status').filter({hasText:'成功 1 个'}).waitFor()
  await searchPage(page);await page.locator('#network-key').fill('模拟书');await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('#network-results').getByRole('button',{name:'加入书架',exact:true}).click()
  await page.locator('#books .book').waitFor({state:'attached'});assert.match(await page.locator('#books .book').textContent(),/已加载 400 章/)
  await returnShelf(page);await page.locator('#books .book').getByRole('button',{name:'开始阅读',exact:true}).click();await page.locator('#reader').waitFor({state:'visible'})
  await page.locator('#pages').filter({hasText:'模拟正文'}).waitFor();await page.locator('#viewport').focus();await page.keyboard.press('Escape');await page.locator('#reading-menu').waitFor({state:'visible'});await page.locator('#directory').click();await page.locator('#toc').waitFor({state:'visible'})
  assert.match(await page.locator('#toc-total').textContent(),/400 章.*待续载/);assert.equal(await page.locator('#toc-load-more').isVisible(),true)
  const layouts=[]
  async function checkLayout(target,label,minimum){
    const layout=await target.locator('#toc').evaluate(el=>{const list=el.querySelector('#toc-list'),bounds=list.getBoundingClientRect(),footer=el.querySelector('.toc-pagination').getBoundingClientRect();return {width:innerWidth,height:innerHeight,listHeight:bounds.height,visibleChapters:[...list.querySelectorAll('button')].filter(button=>{const r=button.getBoundingClientRect();return r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1}).length,footerBottom:footer.bottom,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:el.scrollHeight>el.clientHeight}})
    assert.ok(layout.visibleChapters>=minimum,`${label}: ${JSON.stringify(layout)}`);assert.ok(layout.footerBottom<=layout.height,`${label}: footer clipped`);assert.equal(layout.horizontalOverflow,false);assert.equal(layout.dialogOverflow,false);assert.equal(await target.locator('#toc-list button').count(),25)
    layouts.push({label,...layout});return layout
  }
  await checkLayout(page,'mobile-390x844',11)
  await page.screenshot({path:path.join(directory,'toc-pending-390.png')})
  await page.setViewportSize({width:440,height:530});await checkLayout(page,'short-440x530',5)
  await page.locator('#toc-load-hint summary').click();assert.equal(await page.locator('#toc-load-hint p').isVisible(),true);await checkLayout(page,'help-open-440x530',5);await page.locator('#toc-load-hint summary').click()
  await page.screenshot({path:path.join(directory,'toc-pending-440x530.png')})
  await page.setViewportSize({width:320,height:600});await checkLayout(page,'narrow-320x600',6)
  await page.locator('#toc-range').selectOption('15');assert.match(await page.locator('#toc-list button').first().textContent(),/第376章/);await page.locator('#toc-current').click();assert.match(await page.locator('#toc-list button').first().textContent(),/第1章/)
  const host=await context.newPage();await host.setViewportSize({width:1000,height:900});await host.goto(service.origin);await host.setContent(`<iframe title="目录布局测试" src="${service.origin}" width="440" height="530"></iframe>`)
  const frame=host.frameLocator('iframe');await frame.locator('#shelf').waitFor({state:'visible'});await networkShelf(frame);await frame.locator('#books .book').getByRole('button',{name:/^(开始|继续)阅读$/}).click();await frame.locator('#pages').filter({hasText:'模拟正文'}).waitFor();await frame.locator('#viewport').press('Escape');await frame.locator('#directory').click();await checkLayout(frame,'embedded-440x530',5);await host.screenshot({path:path.join(directory,'toc-iframe-440x530.png')});await host.close()
  await page.setViewportSize({width:390,height:844});await page.locator('#toc-load-more').click();await page.locator('#toc-total').filter({hasText:'1040 章'}).waitFor();assert.equal(await page.locator('#toc-load-more').isVisible(),false)
  assert.equal(await page.locator('#toc-list button').count(),25);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(directory,'toc-complete-390.png')});assert.deepEqual(errors,[])
  if(process.env.READER_TOC_QA_OUTPUT)for(const name of ['toc-pending-390.png','toc-pending-440x530.png','toc-iframe-440x530.png','toc-complete-390.png'])await fs.copyFile(path.join(directory,name),path.join(process.env.READER_TOC_QA_OUTPUT,name))
  console.log(JSON.stringify({ok:true,directory,firstBatch:400,complete:1040,layouts,requests:requests.length,liveSources:false},null,2))
}finally{await browser?.close();await service.close()}
