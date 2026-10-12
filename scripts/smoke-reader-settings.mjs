import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'
const require = createRequire(import.meta.url), { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'novel-reader-settings-'))), root = path.resolve(import.meta.dirname,'..')
const env = { ...process.env,NOVEL_STUDIO_TEST_USER_DATA:directory,NOVEL_STUDIO_NO_GO:'1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let app
const errors = []
try {
  app = await _electron.launch({ executablePath:require('electron'),args:['.'],cwd:root,env,timeout:60000 })
  const page = await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message)); await page.waitForFunction(()=>Boolean(window.novelStudio))
  assertIsolatedRuntime(await page.evaluate(()=>window.novelStudio.getRuntimeInfo()),directory)
  // Only now perform fixture writes. Cloud settings are a mock, never production requests.
  const a = await page.evaluate(()=>window.novelStudio.createProject({title:'阅读设置模拟甲书'})), b = await page.evaluate(()=>window.novelStudio.createProject({title:'阅读设置模拟乙书'}))
  await app.evaluate(({ipcMain},input)=>{
    let state={origin:'https://reader.invalid',configured:false,busy:false,projects:[{id:input.a,title:'阅读设置模拟甲书'},{id:input.b,title:'阅读设置模拟乙书'}]}
    let cloud={protocolVersion:1,requireLogin:true,accounts:[],books:[]}
    const handlers={
      'reader:status':()=>state,
      'reader:save':(_e,v)=>{state={...state,origin:v.origin,configured:true};return state},
      'reader:remote':()=>cloud,
      'reader:access':(_e,v)=>{cloud.requireLogin=v;return cloud},
      'reader:account':(_e,v)=>{cloud.accounts=cloud.accounts.filter(a=>a.username!==v.username);if(!v.remove)cloud.accounts.push({username:v.username,disabled:!!v.disabled});return cloud},
      'reader:book-save':(_e,v)=>{state.projects=state.projects.map(p=>p.id===v.projectId?{...p,...v}:p);return state},
      'reader:publish':(_e,id)=>{state.projects=state.projects.map(p=>p.id===id?{...p,published:true,chapterCount:1,syncedAt:new Date().toISOString()}:p);return{chapterCount:1}},
      'reader:unpublish':(_e,id)=>{state.projects=state.projects.map(p=>p.id===id?{...p,published:false,auto:false}:p);return state},
    }
    for(const [channel,handler]of Object.entries(handlers)){ipcMain.removeHandler(channel);ipcMain.handle(channel,handler)}
    ipcMain.removeHandler('codex:models');ipcMain.handle('codex:models',()=>({message:'模拟目录，未调用模型',status:{configOptions:[]}}))
  },{a:a.project.id,b:b.project.id})
  await page.getByRole('button',{name:'模型与项目设置',exact:true}).click()
  const panel=page.getByRole('region',{name:'手机与云端阅读',exact:true}); await panel.waitFor()
  await panel.getByPlaceholder('https://txt.zhijianku.com').fill('https://reader.invalid')
  await panel.locator('input[type=password]').first().fill('1'.repeat(64))
  await panel.getByRole('button',{name:'保存连接',exact:true}).click()
  await panel.getByRole('button',{name:'检查阅读站',exact:true}).click(); await panel.getByText('阅读站连接正常。',{exact:true}).waitFor()
  await panel.getByPlaceholder('由作者设置，不开放读者注册').fill('模拟读者')
  await panel.getByPlaceholder('至少 10 位；修改已有账号时可留空').fill('fixture-password-123')
  await panel.getByRole('button',{name:'保存阅读账号',exact:true}).click(); await panel.locator('.reader-accounts').getByText('模拟读者 · 可用',{exact:true}).waitFor()
  assert.equal(await panel.getByPlaceholder('至少 10 位；修改已有账号时可留空').inputValue(),'')
  await panel.locator('select').first().selectOption(a.project.id)
  await panel.locator('select').nth(1).selectOption('all')
  await panel.getByRole('button',{name:'发布 / 同步此书',exact:true}).click(); await panel.getByText('已发布 1 章。',{exact:true}).waitFor()
  await panel.getByLabel('此书保存后自动同步').check(); await panel.getByRole('button',{name:'保存此书发布设置',exact:true}).click()
  await panel.locator('select').first().selectOption(b.project.id); assert.equal(await panel.getByLabel('此书保存后自动同步').isChecked(),false)
  await panel.locator('select').first().selectOption(a.project.id); assert.equal(await panel.getByLabel('此书保存后自动同步').isChecked(),true)
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(directory,'desktop-reader-settings.png')})
  await panel.getByRole('button',{name:'下架此书',exact:true}).click(); await panel.getByText('书籍已下架，自动同步已关闭。本机稿件保持不变。',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,fixtureDirectory:directory,cloud:'Mock only; production site not contacted'},null,2))
}finally{await app?.close()}
