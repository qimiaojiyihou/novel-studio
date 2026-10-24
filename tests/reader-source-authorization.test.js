import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startReaderServer} from '../reader-service/server.js'
import {openReaderStore} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {normalizeSource} from '../reader-service/source-rules.js'
import {createSourceAuth} from '../reader-service/source-auth.js'
import {parseAuthorizationReceipt} from '../reader-service/public/source-auth-receipt.js'
import {sampleSource,mockSourceFetcher} from './fixtures/network-source.js'

const raw={...sampleSource,loginUi:[{name:'密钥',type:'password'}],novelStudioAuth:{protocol:'fragment-v1',authorizeUrl:'https://books.example.org/login',parameters:{token:'密钥'}},loginCheckJs:'source.getLoginInfoMap()["密钥"] === "fixture-private-token"'}

test('authorization metadata distinguishes public access, declared manual credentials and real callbacks without changing source versions',async t=>{
  const {file}=await temporary(),store=openReaderStore(file);t.after(()=>store.close())
  await store.saveAccount({username:'alpha',password:'fixture-only-password'})
  const lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-key'})
  const variants=[{...sampleSource,jsLib:'function helper(){return 1}'},{...raw,bookSourceUrl:'https://manual.example.org',novelStudioAuth:undefined},{...raw,bookSourceUrl:sampleSource.bookSourceUrl+'#callback'}]
  for(const [i,source]of variants.entries()){
    const s=normalizeSource(source);await lib.handle('alpha','/sources/import','POST',{sources:source})
    const summary=await lib.handle('alpha',`/sources/${s.id}/auth`,'GET')
    assert.equal(summary.authorization.mode,['public','manual','callback'][i])
    assert.equal(summary.authorization.status,i===0?'not-required':'empty')
    assert.equal(store.db.prepare('SELECT version FROM network_sources WHERE owner=? AND id=?').get('alpha',s.id).version,s.version)
    assert.ok(!JSON.stringify(summary).includes('fixture-private-token'))
  }
  const list=await lib.handle('alpha','/sources','GET',{})
  assert.deepEqual(new Set(list.map(s=>s.authorization.mode)),new Set(['public','manual','callback']))
})
async function temporary(){
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-source-authorization-'))),file=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(file)),dir);assert.ok(dir.startsWith(await fs.realpath(os.tmpdir())+path.sep))
  return {dir,file}
}
async function fixture(t){
  const {file}=await temporary(),store=openReaderStore(file);t.after(()=>store.close())
  for(const username of ['alpha','beta'])await store.saveAccount({username,password:'temporary-auth-test-password'})
  let time=1000
  const lib=createNetworkLibrary(store.db,{defaultSources:null,authKey:'fixture-key',readerOrigin:()=> 'https://reader.example.org',now:()=>time,fetchPage:async()=>{throw Error('no real sites')}})
  for(const owner of ['alpha','beta'])await lib.handle(owner,'/sources/import','POST',{sources:raw})
  const s=normalizeSource(raw),call=(r,m='GET',input={},active)=>lib.handle('alpha',`/sources/${s.id}/auth${r}`,m,input,active)
  const begin=()=>call('/begin','POST',{}),receipt=flow=>({flowId:flow.id,state:new URL(flow.url).searchParams.get('state'),params:{token:'fixture-private-token'}})
  return {store,lib,s,call,begin,receipt,advance:()=>{time+=11*60_000}}
}
test('source callbacks opt in explicitly, constrain origins/fields and parse fragment receipts without guessing tokens',()=>{
  const s=normalizeSource(raw);assert.equal(s.login.authorization.protocol,'fragment-v1')
  assert.throws(()=>normalizeSource({...raw,novelStudioAuth:{...raw.novelStudioAuth,authorizeUrl:'https://unlisted.example.org/login'}}))
  assert.throws(()=>normalizeSource({...raw,novelStudioAuth:{...raw.novelStudioAuth,authorizeUrl:'http://books.example.org/login'}}))
  assert.throws(()=>normalizeSource({...raw,novelStudioAuth:{...raw.novelStudioAuth,parameters:{token:'not-declared'}}}))
  const data={sourceId:s.id,flowId:'a'.repeat(32),state:'b'.repeat(64),params:{token:'a&b+c'}}
  const hash=new URLSearchParams({...data,params:JSON.stringify(data.params)}).toString()
  assert.deepEqual(parseAuthorizationReceipt('#'+hash),data)
  assert.deepEqual(parseAuthorizationReceipt(JSON.stringify(data)),data)
  assert.throws(()=>parseAuthorizationReceipt('#'+hash+'&state='+'c'.repeat(64)))
  assert.throws(()=>parseAuthorizationReceipt('ordinary-token-only'))
})
test('callback saves once, verifies automatically, is encrypted and preserves account/source isolation',async t=>{
  const f=await fixture(t),flow=await f.begin(),data=f.receipt(flow)
  assert.equal((await f.begin()).id,flow.id,'repeat begin reuses one pending flow')
  assert.equal(new URL(flow.url).searchParams.get('redirect_uri'),'https://reader.example.org/source-auth-callback')
  assert.equal(new URL(flow.url).searchParams.get('novel_flow'),flow.id)
  await assert.rejects(f.lib.handle('beta',`/sources/${f.s.id}/auth/callback`,'POST',data),e=>e.status===410)
  await assert.rejects(f.call('/callback','POST',{...data,state:'0'.repeat(64)}),e=>e.status===403)
  const result=await f.call('/callback','POST',data);assert.equal(result.status,'verified')
  const stored=f.store.db.prepare('SELECT sealed FROM network_source_auth WHERE owner=?').get('alpha').sealed
  assert.ok(!stored.includes('fixture-private-token'))
  assert.equal((await f.call('/callback','POST',data)).replayed,true)
  assert.equal(f.store.db.prepare('SELECT sealed FROM network_source_auth WHERE owner=?').get('alpha').sealed,stored)
  await assert.rejects(f.call('/callback','POST',{...data,params:{token:'changed'}}),e=>e.status===409)
  const meta=await f.call('');assert.equal(meta.authorization.status,'verified');assert.ok(!JSON.stringify(meta).includes('fixture-private-token'))
  assert.equal((await f.lib.handle('beta',`/sources/${f.s.id}/auth`,'GET')).authorization.status,'empty')
  assert.equal((await f.call('/flow','POST',{flowId:flow.id})).status,'saved')
  assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length,0)
})
test('expired/cancelled/restarted flows, disabled sources, source changes and revoked sessions reject late callbacks',async t=>{
  const f=await fixture(t)
  let flow=await f.begin();f.advance();await assert.rejects(f.call('/callback','POST',f.receipt(flow)),e=>e.status===410)
  flow=await f.begin();await f.call('/flow','DELETE',{flowId:flow.id});await assert.rejects(f.call('/callback','POST',f.receipt(flow)),e=>e.status===410)
  const next=await f.begin();await f.call('/flow','DELETE',{flowId:flow.id});assert.equal((await f.call('/flow','POST',{flowId:next.id})).status,'waiting','late cancellation never cancels the replacement')
  const restarted=createNetworkLibrary(f.store.db,{defaultSources:null,authKey:'fixture-key'});await assert.rejects(restarted.handle('alpha',`/sources/${f.s.id}/auth/callback`,'POST',f.receipt(next)),e=>e.status===410)
  await f.lib.handle('alpha',`/sources/${f.s.id}`,'PUT',{enabled:false});await assert.rejects(f.call('/callback','POST',f.receipt(next)),e=>e.status===409)
  await f.lib.handle('alpha',`/sources/${f.s.id}`,'PUT',{enabled:true});await f.lib.handle('alpha','/sources/import','POST',{sources:{...raw,bookSourceName:'Changed rules'}});await assert.rejects(f.call('/callback','POST',f.receipt(next)),e=>e.status===409)
  await f.lib.handle('alpha','/sources/import','POST',{sources:raw});await f.call('/flow','DELETE',{flowId:next.id})
  let active=true;flow=await f.call('/begin','POST',{},()=>{if(!active)throw Object.assign(Error('revoked'),{status:401})});active=false
  await assert.rejects(f.call('/callback','POST',f.receipt(flow)),e=>e.status===401)
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM network_source_auth').get().n,0)
})
test('manual save is atomic, preserves blank secrets, detects expiry and never labels unverified sources as logged in',async t=>{
  const f=await fixture(t)
  await f.call('','PUT',{params:{密钥:'fixture-private-token'},cookie:'session=fixture'})
  assert.equal((await f.call('')).authorization.status,'verified')
  const before=f.store.db.prepare('SELECT sealed FROM network_source_auth').get().sealed
  await assert.rejects(f.call('','PUT',{params:{unexpected:'x'},cookie:'changed=x'}))
  await assert.rejects(f.call('','PUT',{params:{密钥:'changed'},cookie:'bad\n=value'}))
  await assert.rejects(f.call('','PUT',{clearCookie:'true'}))
  assert.equal(f.store.db.prepare('SELECT sealed FROM network_source_auth').get().sealed,before,'bad params never partially change Cookie')
  await f.call('','PUT',{params:{密钥:''},cookie:''});assert.equal((await f.call('')).authorization.status,'verified')
  await f.call('','PUT',{params:{密钥:'expired'}});assert.equal((await f.call('')).authorization.status,'expired')
  const manual={...raw,loginCheckJs:undefined,novelStudioAuth:undefined};await f.lib.handle('alpha','/sources/import','POST',{sources:manual})
  assert.equal((await f.call('/verify','POST',{})).status,'saved');assert.equal((await f.call('')).authorization.mode,'manual')
  await assert.rejects(f.begin(),e=>e.status===409)
  const profile=createSourceAuth(f.store.db,'fixture-key').profile('alpha',normalizeSource(manual),()=>{});assert.equal(profile.read().params['密钥'],'expired')
})
test('credential changes invalidate prior verification and verification errors never echo private values',async t=>{
  const f=await fixture(t);await f.call('','PUT',{params:{密钥:'fixture-private-token'}})
  const profile=createSourceAuth(f.store.db,'fixture-key').profile('alpha',f.s,()=>{})
  profile.importCookie('newSession=changed');assert.equal((await f.call('')).authorization.status,'saved')
  const changed={...raw,loginCheckJs:'throw new Error(source.getLoginInfoMap()["密钥"])'}
  await f.lib.handle('alpha','/sources/import','POST',{sources:changed})
  const response=await f.call('/verify','POST',{});assert.equal(response.status,'unverified');assert.ok(!JSON.stringify(response).includes('fixture-private-token'));assert.equal((await f.call('')).authorization.status,'saved')
})
test('a delayed verification never replaces newer credentials',async t=>{
  const f=await fixture(t);let release,entered
  const gate=new Promise(r=>{release=r}),started=new Promise(r=>{entered=r})
  const changed={...raw,loginCheckJs:'JSON.parse(java.ajax(source.bookSourceUrl+"/auth-check")).ok === true'},s=normalizeSource(changed)
  const lib=createNetworkLibrary(f.store.db,{defaultSources:null,authKey:'fixture-key',fetchPage:async url=>{entered();await gate;return {url,text:'{"ok":true}'}}})
  await lib.handle('alpha','/sources/import','POST',{sources:changed})
  const pending=lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{params:{密钥:'old'}})
  await started
  const profile=createSourceAuth(f.store.db,'fixture-key').profile('alpha',s,()=>{})
  profile.save({params:{密钥:'new'}});release()
  await assert.rejects(pending,e=>e.status===409)
  assert.equal(profile.read().params['密钥'],'new');assert.equal((await lib.handle('alpha',`/sources/${s.id}/auth`,'GET')).authorization.status,'saved')
})
test('HTTP callback requires a reader session and same-origin JSON; static callback rejects query credentials',async t=>{
  const {file}=await temporary(),service=await startReaderServer({databasePath:file,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null})
  t.after(()=>service.close());await service.store.saveAccount({username:'alpha',password:'temporary-http-auth-password'})
  const request=(route,method='GET',input,cookie='',origin=service.origin)=>fetch(service.origin+route,{method,headers:{...(input?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},...(input?{body:JSON.stringify(input)}:{})})
  const login=await request('/api/login','POST',{username:'alpha',password:'temporary-http-auth-password'}),cookie=login.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/api/network/sources/import','POST',{sources:raw},cookie)).status,200)
  const s=normalizeSource(raw),base=`/api/network/sources/${s.id}/auth`,response=await request(base+'/begin','POST',{},cookie),flow=await response.json()
  const receipt={sourceId:s.id,flowId:flow.id,state:new URL(flow.url).searchParams.get('state'),params:{token:'fixture-private-token'}}
  assert.equal((await request(base+'/callback','POST',receipt)).status,401)
  assert.equal((await request(base+'/callback','POST',receipt,cookie,'https://wrong.example.org')).status,403)
  assert.equal((await request('/source-auth-callback?token=fixture')).status,400)
  const page=await request('/source-auth-callback');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/)
  assert.equal((await request(base+'/callback','POST',receipt,cookie)).status,200)
  await request('/api/logout','POST',{},cookie)
  assert.equal((await request(base+'/callback','POST',receipt,cookie)).status,401)
})

test('upstream login expiry returns source-specific 422, not reader-account 401, with no credential disclosure',async t=>{
  const {file}=await temporary();let expired=false
  const normal=mockSourceFetcher(),service=await startReaderServer({databasePath:file,adminToken:randomBytes(32).toString('hex'),origin:'http://127.0.0.1:0',allowHttp:true,defaultSources:null,sourceFetcher:async(url,opts)=>{if(expired)throw Object.assign(Error('private upstream credential'),{status:502,httpStatus:401});return normal(url,opts)}})
  t.after(()=>service.close());await service.store.saveAccount({username:'alpha',password:'temporary-http-auth-password'})
  let cookie=''
  const request=(route,method='GET',input)=>fetch(service.origin+route,{method,headers:{Cookie:cookie,...(input?{'Content-Type':'application/json',Origin:service.origin}:{})},...(input?{body:JSON.stringify(input)}:{})})
  const login=await request('/api/login','POST',{username:'alpha',password:'temporary-http-auth-password'});cookie=login.headers.get('set-cookie').split(';')[0]
  const imported=await request('/api/network/sources/import','POST',{sources:sampleSource}),sourceId=(await imported.json()).accepted[0].id
  await request(`/api/network/sources/${sourceId}/auth`,'PUT',{cookie:'sid=private-fixture'})
  const results=await (await request('/api/network/search','POST',{key:'测试'})).json(),book=await (await request('/api/network/books','POST',{ticket:results.results[0].ticket})).json()
  expired=true
  const response=await request(`/api/network/books/${book.id}/chapters/${book.chapters[0].id}`),data=await response.json()
  assert.equal(response.status,422);assert.equal(data.code,'SOURCE_LOGIN_REQUIRED');assert.equal(data.sourceId,sourceId);assert.equal(data.loginRequired,true)
  assert.ok(!JSON.stringify(data).includes('private'))
  assert.equal((await (await request('/api/session')).json()).authenticated,true)
})
