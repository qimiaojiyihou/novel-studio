import {networkShelf,sourcePage,searchPage,returnShelf} from './reader-smoke-navigation.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import {sampleSource} from '../tests/fixtures/network-source.js'
const {chromium}=await import(process.env.NOVEL_STUDIO_PLAYWRIGHT||'playwright')
const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-authorization-smoke-'))),databasePath=path.join(directory,'reader.sqlite')
assert.ok(directory.startsWith(await fs.realpath(os.tmpdir())+path.sep));assert.equal(await fs.realpath(path.dirname(databasePath)),directory)
const service=await startReaderServer({databasePath,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async()=>{throw Error('no external requests')}})
let browser
try{
  await service.store.saveAccount({username:'fixture',password:'temporary-auth-password'})
  browser=await chromium.launch({headless:true,executablePath:process.env.NOVEL_STUDIO_BROWSER||undefined})
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.goto(service.origin)
  await page.locator('input[name=username]').fill('fixture');await page.locator('input[name=password]').fill('temporary-auth-password');await page.getByRole('button',{name:'登录阅读',exact:true}).click();await page.locator('#shelf').waitFor({state:'visible'});await networkShelf(page)
  const source={...sampleSource,loginUi:[{name:'密钥',type:'password'}],loginCheckJs:'source.getLoginInfoMap()["密钥"] === "mock-auto-token"',novelStudioAuth:{protocol:'fragment-v1',authorizeUrl:'https://books.example.org/login',parameters:{token:'密钥'}}}
  await sourcePage(page);await page.locator('#source-json').fill(JSON.stringify(source));await page.locator('#source-import').click();await page.locator('#source-import-status').filter({hasText:'成功 1 个'}).waitFor();await page.getByRole('button',{name:'登录授权',exact:true}).click();await page.locator('#source-auth[open]').waitFor()
  await page.getByRole('button',{name:'准备自动授权',exact:true}).click();await page.locator('#source-auth-status').filter({hasText:'专属授权地址已准备'}).waitFor()
  const address=await page.locator('#source-auth-address').inputValue(),url=new URL(address),count=context.pages().length
  await page.getByRole('button',{name:'准备自动授权',exact:true}).click();await page.locator('#source-auth-status').filter({hasText:'专属授权地址已准备'}).waitFor();assert.equal(await page.locator('#source-auth-address').inputValue(),address);assert.equal(context.pages().length,count)
  const receipt={sourceId:url.searchParams.get('novel_source'),flowId:url.searchParams.get('novel_flow'),state:url.searchParams.get('state'),params:{token:'mock-auto-token'}}
  // Simulate only the provider's documented callback. No real provider / login.
  const callback=await context.newPage();await callback.goto(url.searchParams.get('redirect_uri')+'#'+new URLSearchParams({...receipt,params:JSON.stringify(receipt.params)}));await callback.locator('#callback-status').filter({hasText:'授权验证通过'}).waitFor();assert.equal(new URL(callback.url()).hash,'');assert.ok(!(await callback.locator('body').innerText()).includes('mock-auto-token'));await callback.close()
  await page.locator('#source-auth-state').filter({hasText:'上次验证通过'}).waitFor();assert.equal(await page.locator('#source-auth-fields input').inputValue(),'');assert.match(await page.locator('#source-auth-fields input').getAttribute('placeholder'),/已保存/)
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(directory,'automatic-authorization-320.png')})
  // Separate/partitioned contexts have no reader cookie: never save anonymously.
  await page.getByRole('button',{name:'准备自动授权',exact:true}).click();await page.locator('#source-auth-status').filter({hasText:'专属授权地址已准备'}).waitFor();const next=new URL(await page.locator('#source-auth-address').inputValue()),other=await browser.newContext(),noSession=await other.newPage()
  const nextReceipt={...receipt,flowId:next.searchParams.get('novel_flow'),state:next.searchParams.get('state')}
  await noSession.goto(next.searchParams.get('redirect_uri')+'#'+new URLSearchParams({...nextReceipt,params:JSON.stringify(nextReceipt.params)}));await noSession.locator('#callback-status').filter({hasText:'没有原阅读页的登录状态'}).waitFor();assert.equal(await noSession.locator('#callback-copy').isVisible(),true);await other.close()
  await page.locator('#source-auth-automatic summary').click();await page.locator('#source-auth-receipt').fill(JSON.stringify(nextReceipt));await page.getByRole('button',{name:'接收授权回执',exact:true}).click();await page.locator('#source-auth-status').filter({hasText:'授权验证通过'}).waitFor();assert.equal(await page.locator('#source-auth-receipt').inputValue(),'')
  await page.keyboard.press('Escape');await page.locator('#source-auth').waitFor({state:'hidden'});assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,directory,automaticSave:true,verified:true,emptyCredentialFields:true,singleFlow:true,noAutoTabs:true,fragmentRemoved:true,noAnonymousSave:true,partitionFallback:true,mobile320:true}))
}finally{await browser?.close();await service.close()}
