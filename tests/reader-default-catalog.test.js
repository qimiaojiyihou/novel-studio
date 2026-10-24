import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {buildDefaultCatalog} from '../scripts/build-reader-default-sources.mjs'
import {normalizeSource} from '../reader-service/source-rules.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {sampleSource} from './fixtures/network-source.js'

test('global catalog fills every existing/new account once, preserves custom rules, disabled state, credentials and books',async()=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'reader-global-defaults-'))),file=path.join(dir,'reader.sqlite')
  assert.equal(await fs.realpath(path.dirname(file)),dir);assert.ok(dir.startsWith(await fs.realpath(os.tmpdir())+path.sep))
  const store=openReaderStore(file)
  try{
    for(const username of ['alpha','beta','gamma'])await store.saveAccount({username,password:'temporary-global-password'})
    const first=normalizeSource(sampleSource),otherRaw={...sampleSource,bookSourceName:'另一书源',bookSourceUrl:'https://other.example.org'},second=normalizeSource(otherRaw)
    const old={version:'legacy',name:'fixture',total:2,sources:[first,second],rejected:[],duplicates:[]}
    let lib=createNetworkLibrary(store.db,{defaultSources:old,authKey:'same-key'})
    for(const owner of ['alpha','beta','gamma'])await lib.handle(owner,'/sources','GET',{})
    await lib.handle('alpha',`/sources/${first.id}`,'PUT',{enabled:false})
    await lib.handle('alpha',`/sources/${first.id}/auth`,'PUT',{cookie:'fixture=private-alpha'})
    await lib.handle('gamma',`/sources/${second.id}`,'DELETE',{})
    const custom={...first,name:'我的自定义配置',version:'custom-version'}
    store.db.prepare('UPDATE network_sources SET name=?,config=?,version=? WHERE owner=? AND id=?').run(custom.name,JSON.stringify(custom),custom.version,'beta',first.id)
    store.db.prepare('INSERT INTO network_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('alpha','fixture-book',first.id,'收藏书','作者','简介',first.url+'/book',first.url+'/toc','[]','rev','2026-10-15')
    const before=JSON.stringify(store.db.prepare('SELECT * FROM network_books').all()),accountsBefore=JSON.stringify(store.db.prepare('SELECT * FROM accounts').all())
    const raw=[{...sampleSource,bookSourceName:'新版规则',ruleContent:{content:'#newcontent@text'},header:{Cookie:'never-share-this-secret'}},otherRaw,{...sampleSource,bookSourceName:'需兼容',bookSourceUrl:'https://pending.example.org',ruleContent:{content:'@js:java.readFile("private")'}},{...sampleSource,bookSourceName:'FQWeb模板',bookSourceUrl:'在此填写你的服务器地址'}]
    const pack=buildDefaultCatalog([raw],old)
    assert.equal(pack.restoreMissing,false,'routine compatibility upgrades preserve prior user deletions')
    pack.restoreMissing=true // This fixture explicitly exercises the initial full-catalog rollout.
    assert.equal(pack.sources.length,4);assert.equal(pack.unavailable.length,2);assert.ok(!JSON.stringify(pack).includes('never-share-this-secret'));assert.ok(!JSON.stringify(pack).includes('readFile(\\"private\\")'))
    lib=createNetworkLibrary(store.db,{defaultSources:pack,authKey:'same-key',fetchPage:async()=>{throw Error('must not fetch defaults')}})
    for(const owner of ['alpha','beta','gamma'])assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_sources WHERE owner=?').get(owner).n,4,'startup upgrades even accounts that have not logged in')
    const a=await lib.handle('alpha','/sources','GET',{}),b=await lib.handle('beta','/sources','GET',{})
    assert.equal(a.find(s=>s.id===first.id).enabled,false);assert.equal(a.find(s=>s.id===first.id).name,'新版规则');assert.equal(b.find(s=>s.id===first.id).name,custom.name)
    assert.equal((await lib.handle('alpha',`/sources/${first.id}/auth`,'GET')).hasCookie,true)
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM network_books').all()),before);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM accounts').all()),accountsBefore)
    const pending=a.find(s=>s.compatibility?.code==='RULE_UNSUPPORTED');assert.ok(pending)
    const result=await lib.handle('alpha','/search','POST',{key:'测试',sourceId:pending.id});assert.equal(result.errors[0].code,'RULE_UNSUPPORTED')
    await lib.handle('alpha',`/sources/${pending.id}`,'DELETE',{})
    lib=createNetworkLibrary(store.db,{defaultSources:pack,authKey:'same-key'});assert.equal((await lib.handle('alpha','/sources','GET',{})).length,3,'same-version restart never restores a user deletion')
    await store.saveAccount({username:'newaccount',password:'temporary-global-password'})
    lib.initializeAccount('newaccount');assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM network_sources WHERE owner=?').get('newaccount').n,4)
    assert.equal((await lib.handle('newaccount','/sources','GET',{})).length,4)
    assert.equal((await lib.handle('newaccount',`/sources/${first.id}/auth`,'GET')).hasCookie,false,'credentials never enter the shared catalog')
    assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{store.close()}
})

test('catalog refreshes stale unsupported reasons and never silently restores a deleted source',()=>{
  const source=normalizeSource(sampleSource),pending={...source,rules:{},unsupported:{code:'OLD',reason:'旧错误'},version:'old-pending'}
  const old={version:'old',sources:[pending],rejected:[],duplicates:[]}
  const pack=buildDefaultCatalog([[{...sampleSource,ruleContent:{content:'@js:const broken = ;'}}]],old)
  assert.equal(pack.restoreMissing,false);assert.equal(pack.unavailable[0].code,'SCRIPT_INVALID');assert.notEqual(pack.unavailable[0].reason,'旧错误')
  assert.ok(pack.managedSourceVersions[source.id].includes('old-pending'))
})
