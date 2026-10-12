import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { startReaderServer } from '../reader-service/server.js'
import { digest } from '../reader-service/store.js'

const { chromium } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'novel-reader-smoke-'))), file = path.join(directory,'reader.sqlite')
assert.equal(await fs.realpath(path.dirname(file)),directory, 'actual cloud fixture directory verified before writes')
const service = await startReaderServer({ databasePath:file,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true })
const body = Array.from({ length:100 },(_,i)=>`第${i+1}段。风穿过窗边，纸页轻轻动了一下。他把杯子放稳，等对面的人说完。😀「这一句要保持完整，不在页边丢字。」`).join('\n\n')
function publish(revision, baseRevision='', content=body, chapterCount=500) {
  const input = { publicationId:revision,bookId:'fixture-book',baseRevision,title:'分页阅读模拟书',description:'此内容只用于隔离测试。',genre:'模拟',chapters:Array.from({ length:chapterCount },(_,i)=>({ id:`fixture-chapter-${i+1}`,no:i+1,title:`测试章节 ${i+1}`,hash:digest(i===0?content:'其他章节正文。') })) }
  const result = service.store.stage(input)
  for (const id of result.missing) service.store.upload(revision,id,id==='fixture-chapter-1'?content:'其他章节正文。')
  service.store.commit(revision)
}
let browser
const errors = []
try {
  publish('fixture-release-1'); service.store.setAccess(false)
  browser = await chromium.launch({ headless:true, executablePath:process.env.NOVEL_STUDIO_BROWSER || undefined })
  const context = await browser.newContext({ viewport:{ width:390,height:844 },deviceScaleFactor:2,isMobile:true,hasTouch:true })
  const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message))
  await page.goto(service.origin)
  await page.getByRole('button',{ name:'开始阅读',exact:true }).click()
  await page.waitForFunction(()=>document.getElementById('progress').textContent.includes(' / '))
  const count = Number((await page.locator('#progress').innerText()).match(/\/ (\d+) 页/)[1]); assert.ok(count>5)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=window.innerHeight+1),true,'reader never becomes a long scrolling document')
  const viewport = await page.locator('#viewport').boundingBox()
  await page.mouse.click(viewport.x+viewport.width-10,viewport.y+viewport.height/2)
  await page.waitForFunction(()=>document.getElementById('progress').textContent.startsWith('2 /'))
  assert.match(await page.locator('#pages').getAttribute('style'),/translateX\(-/)
  await page.mouse.click(viewport.x+viewport.width/2,viewport.y+viewport.height/2)
  await page.locator('#font-size').fill('26'); await page.locator('#font-size').dispatchEvent('input')
  assert.ok(Number((await page.locator('#progress').innerText()).match(/\/ (\d+) 页/)[1])>count)
  await page.locator('#theme').selectOption('dark'); assert.equal(await page.locator('body').getAttribute('data-theme'),'dark')
  await page.getByRole('button',{ name:'目录',exact:true }).click()
  assert.equal(await page.locator('#toc-list button').count(),25)
  await page.locator('#toc-search').fill('测试章节 499')
  assert.equal(await page.locator('#toc-list button').count(),1)
  await page.locator('#toc-list button').click(); await page.locator('#chapter-label').filter({ hasText:'第499章' }).waitFor()
  await page.mouse.click(viewport.x+viewport.width/2,viewport.y+viewport.height/2)
  await page.getByRole('button',{ name:'目录',exact:true }).click(); await page.locator('#toc-search').fill('测试章节 1')
  await page.locator('#toc-list button').filter({ hasText:/^第1章 / }).click()
  await page.locator('#chapter-label').filter({ hasText:'第1章' }).waitFor()
  // Every character must be laid out in a page rather than clipped outside its height.
  const coverage = await page.evaluate(()=>{
    const container=document.getElementById('viewport'), pages=document.getElementById('pages'), box=container.getBoundingClientRect(),walker=document.createTreeWalker(pages,NodeFilter.SHOW_TEXT)
    let below=0,above=0,maxColumn=0,characters=0
    while(walker.nextNode()) {
      const node=walker.currentNode
      for(let i=0;i<node.length;i++) {
        if(/\s/.test(node.data[i])) continue
        const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const rect=range.getBoundingClientRect()
        if(rect.bottom>box.bottom+1) below++;if(rect.top<box.top-1)above++
        maxColumn=Math.max(maxColumn,Math.floor((rect.left-box.left+1)/(container.clientWidth+36)));characters++
      }
    }
    return { below,above,maxColumn,characters,progress:document.getElementById('progress').textContent }
  })
  assert.equal(coverage.below,0,'no text falls below a fixed-height page'); assert.equal(coverage.above,0)
  assert.equal(coverage.maxColumn+1,Number(coverage.progress.match(/\/ (\d+) 页/)[1]))
  // Bookmark survives reload and geometry changes.
  for(let i=0;i<3;i++) await page.mouse.click(viewport.x+viewport.width-10,viewport.y+viewport.height/2)
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('reader:position:fixture-book')))
  assert.ok(saved.offset>100)
  await page.reload(); await page.getByRole('button',{name:'继续阅读',exact:true}).click(); await page.waitForFunction(()=>document.getElementById('progress').textContent.includes(' / '))
  const restored = await page.evaluate(()=>JSON.parse(localStorage.getItem('reader:position:fixture-book')))
  assert.equal(restored.chapterId,saved.chapterId); assert.ok(Math.abs(restored.offset-saved.offset)<150)
  await page.setViewportSize({width:844,height:390}); await page.waitForTimeout(350)
  const landscape = await page.evaluate(()=>JSON.parse(localStorage.getItem('reader:position:fixture-book')))
  assert.ok(Math.abs(landscape.offset-restored.offset)<1500,'rotation preserves the vicinity of the text anchor')
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(350)
  // Update is opt-in; a new cloud edition must not replace reading content automatically.
  publish('fixture-release-2','fixture-release-1','新版首段。\n'+body)
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await page.locator('#update').waitFor({state:'visible'})
  assert.equal(await page.locator('#pages').innerText().then(v=>v.includes('新版首段。')),false)
  await page.locator('#update').click(); await page.waitForFunction(()=>document.getElementById('pages').textContent.includes('新版首段。'))
  await page.screenshot({path:path.join(directory,'phone-reader.png')})
  // Session protection actually guards body APIs and clears already displayed DOM on the next check.
  await service.store.saveAccount({ username:'reader',password:'fixture-password-123' }); service.store.setAccess(true)
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
  await page.locator('#login').waitFor({state:'visible'}); assert.equal(await page.locator('#pages').textContent(),'')
  await page.locator('[name=username]').fill('reader'); await page.locator('[name=password]').fill('fixture-password-123')
  await page.getByRole('button',{name:'登录阅读',exact:true}).click(); await page.getByRole('button',{name:'继续阅读',exact:true}).waitFor()
  await page.getByRole('button',{name:'继续阅读',exact:true}).click(); await page.locator('#reader').waitFor({state:'visible'})
  await service.store.saveAccount({ username:'reader',password:'fixture-new-password' })
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await page.locator('#login').waitFor({state:'visible'})
  assert.equal(await page.locator('#pages').textContent(),'')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ ok:true,fixtureDirectory:directory,pagesAt20px:count,chapters:500,coverage,browser:'Chromium mobile simulation; not physical iOS/Android' },null,2))
} finally { await browser?.close(); await service.close() }
