import {networkShelf,sourcePage,searchPage,returnShelf} from './reader-smoke-navigation.mjs'
// Isolated UI regression: never requests a real book or production database.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import source from '../reader-service/fanqie-public-source.json' with {type:'json'}
const {chromium}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT||'playwright')
const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-access-smoke-'))),databasePath=path.join(directory,'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(databasePath)),directory,'verified isolated path before database writes')
const bookId='7287479909398613032',ids=Array.from({length:11},(_,i)=>String(7287481820193489408n+BigInt(i)))
const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async url=>{
  const u=new URL(url),id=u.pathname.split('/').pop()
  const text=u.hostname==='novel.snssdk.com'?JSON.stringify({data:{ret_data:[{title:'模拟章节权限',author:'模拟作者',book_id:bookId}]}}):u.pathname==='/api/reader/directory/detail'?JSON.stringify({data:{chapterListWithVolume:[ids.map((itemId,i)=>({itemId,title:`第${i+1}章 模拟标题`}))]}}):u.pathname.startsWith('/page/')?'<title>模拟章节权限</title>':'<script>window.__INITIAL_STATE__='+JSON.stringify({reader:{chapterData:{itemId:id,bookId,content:'<p>模拟测试正文，仅供工程测试。</p>',needPay:0,isChapterLock:id===ids[10]}}})+'</script>'
  return {url,text}
}})
let browser
try{
  await service.store.saveAccount({username:'fixture',password:'fixture-reader-password'})
  browser=await chromium.launch({headless:true,executablePath:process.env.NOVEL_STUDIO_BROWSER||undefined})
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(service.origin);await page.locator('input[name=username]').fill('fixture');await page.locator('input[name=password]').fill('fixture-reader-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click();await page.locator('#shelf').waitFor({state:'visible'})
  await networkShelf(page);await sourcePage(page);await page.locator('#source-json').fill(JSON.stringify(source));await page.locator('#source-import').click();await page.locator('#source-import-status').filter({hasText:'成功 1 个'}).waitFor()
  await page.getByRole('button',{name:'高级配置',exact:true}).click();await page.locator('#source-auth-state').filter({hasText:'无需预先授权'}).waitFor()
  assert.equal(await page.locator('#source-auth-manual').getAttribute('open'),null)
  assert.equal(await page.locator('#source-auth-begin').isVisible(),false)
  await page.screenshot({path:path.join(directory,'public-source-390.png')});await page.keyboard.press('Escape')
  await sourcePage(page);await searchPage(page);await page.locator('#network-key').fill('模拟章节权限');await searchPage(page);await page.locator('#network-search-submit').click();await page.locator('.network-result').waitFor();await page.getByRole('button',{name:'加入书架',exact:true}).click();await page.locator('#books .book').waitFor({state:'attached'})
  await returnShelf(page);await page.locator('#books').getByRole('button',{name:'开始阅读',exact:true}).click();await page.locator('#reader').waitFor({state:'visible'})
  await page.locator('#viewport').press('Escape');await page.locator('#directory').click();await page.locator('#toc-number').fill('10');await page.locator('#toc-go').click();await page.locator('#chapter-label').filter({hasText:'第10章'}).waitFor()
  await page.locator('#viewport').press('Escape');await page.locator('#directory').click();await page.locator('#toc-number').fill('11');await page.locator('#toc-go').click();await page.locator('#chapter-access[open]').waitFor()
  assert.match(await page.locator('#chapter-label').textContent(),/第10章/,'failed navigation retains the previous chapter')
  assert.match(await page.locator('#chapter-access-address').inputValue(),new RegExp(ids[10]+'$'))
  assert.equal(await page.locator('#source-auth').isVisible(),false,'no credential prompt for chapter access')
  for(let i=0;i<3;i++)await page.locator('#chapter-access-copy').click()
  assert.equal(context.pages().length,1,'copying never auto-opens external tabs')
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:path.join(directory,'chapter-locked-320.png')})
  await page.mouse.click(2,2);await page.locator('#chapter-access').waitFor({state:'hidden'})
  await page.locator('#viewport').press('Escape');await page.locator('#directory').click();await page.locator('#toc-number').fill('11');await page.locator('#toc-go').click();await page.locator('#chapter-access[open]').waitFor();await page.keyboard.press('Escape');await page.locator('#chapter-access').waitFor({state:'hidden'})
  await page.reload();await networkShelf(page);await returnShelf(page);await page.locator('#books').getByRole('button',{name:'继续阅读',exact:true}).click();await page.locator('#chapter-label').filter({hasText:'第10章'}).waitFor()
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,directory,productionChanged:false,sourceMode:'public',lockedChapter:11,retainedChapter:10,noAutomaticTabs:true}))
}finally{await browser?.close();await service.close()}
