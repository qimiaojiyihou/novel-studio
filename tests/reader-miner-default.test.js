import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import raw from '../reader-service/suduguu-miner-source.json' with {type:'json'}
import {catalogBeforePhonePagination} from './fixtures/reader-catalog-history.js'
import {normalizeSource} from '../reader-service/source-rules.js'
import {openReaderStore,digest} from '../reader-service/store.js'
import {createNetworkLibrary} from '../reader-service/network-library.js'

const catalog=catalogBeforePhonePagination()
const s=normalizeSource(raw),generalId='6cfafad5bc407b7319d093a0cf0e6909',oldSources=catalog.sources.filter(x=>x.id!==s.id&&x.id!==generalId)
test('miner is an additive public default, retaining all 45 prior rules and upgrade paths',()=>{
  assert.deepEqual(catalog.sources.find(x=>x.id===s.id),s)
  assert.equal(s.version,'7bdd68935ac241654804892ea36ed96bc0b9bcb763109079bcd4c79acd877b44')
  assert.equal(catalog.version,'global-all-sources-'+digest(JSON.stringify(catalog.sources)).slice(0,16))
  assert.equal('global-all-sources-'+digest(JSON.stringify(oldSources)).slice(0,16),'global-all-sources-6a973045261560c6')
  assert.equal(oldSources.length,45);assert.equal(catalog.total,47)
  assert.equal(catalog.applyToExisting,true);assert.equal(catalog.restoreMissing,false)
  assert.deepEqual(catalog.addedSourceIds,[generalId]);assert.deepEqual(catalog.upgradeFrom[catalog.previousVersion],[generalId])
  for(const [version,ids]of Object.entries(catalog.upgradeFrom))if(version!==catalog.previousVersion)assert.equal(ids.filter(id=>id===s.id).length,1)
  assert.equal(s.login,undefined);assert.equal(s.headers,undefined)
  assert.equal(s.search.address,'/5947/','a one-book entry, not a generic search source')
})

test('miner initializes existing and future accounts once, preserving existing data and user deletions',async()=>{
  const root=await fs.realpath(os.tmpdir()),dir=await fs.realpath(await fs.mkdtemp(path.join(root,'reader-miner-default-'))),file=path.join(dir,'reader.sqlite')
  assert.ok(dir.startsWith(root+path.sep));assert.equal(await fs.realpath(path.dirname(file)),dir)
  const store=openReaderStore(file),prior={...catalog,version:'global-all-sources-6a973045261560c6',applyToExisting:false,sources:oldSources}
  try{
    for(const owner of ['alpha','beta','gamma'])await store.saveAccount({username:owner,password:'fixture-only-miner-password'})
    let lib=createNetworkLibrary(store.db,{defaultSources:prior,authKey:'fixture-key'})
    for(const owner of ['alpha','beta','gamma'])await lib.handle(owner,'/sources','GET',{})
    await lib.handle('alpha','/sources/import','POST',{sources:raw})
    await lib.handle('alpha',`/sources/${s.id}`,'PUT',{enabled:false})
    await lib.handle('alpha',`/sources/${s.id}/auth`,'PUT',{cookie:'fixture=private-miner'})
    await lib.handle('beta',`/sources/${oldSources[0].id}`,'DELETE',{})
    const custom={...oldSources[1],name:'用户自定义',version:'custom-version'}
    store.db.prepare('UPDATE network_sources SET name=?,version=?,config=? WHERE owner=? AND id=?').run(custom.name,custom.version,JSON.stringify(custom),'gamma',custom.id)
    store.db.prepare('INSERT INTO network_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('alpha','fixture-book',s.id,'模拟收藏','模拟作者','模拟简介',s.url+'/5947/',s.url+'/5947/','[]','rev','2026-10-17')
    const before=store.db.prepare('SELECT * FROM network_sources ORDER BY owner,id').all(),books=store.db.prepare('SELECT * FROM network_books').all()
    const cookieBefore=(await lib.handle('alpha',`/sources/${s.id}/auth`,'GET',{})).hasCookie
    lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key'})
    for(const row of before)assert.deepEqual(store.db.prepare('SELECT * FROM network_sources WHERE owner=? AND id=?').get(row.owner,row.id),row)
    for(const owner of ['alpha','beta','gamma'])assert.equal(store.db.prepare('SELECT COUNT(*) n FROM network_sources WHERE owner=? AND id=?').get(owner,s.id).n,1)
    assert.equal((await lib.handle('alpha','/sources','GET',{})).find(x=>x.id===s.id).enabled,false)
    assert.equal((await lib.handle('beta','/sources','GET',{})).find(x=>x.id===s.id).enabled,true)
    assert.equal(store.db.prepare('SELECT 1 FROM network_sources WHERE owner=? AND id=?').get('beta',oldSources[0].id),undefined)
    assert.deepEqual(store.db.prepare('SELECT * FROM network_books').all(),books)
    assert.equal(cookieBefore,true);assert.equal((await lib.handle('alpha',`/sources/${s.id}/auth`,'GET',{})).hasCookie,true)
    await store.saveAccount({username:'new',password:'fixture-only-miner-password'});lib.initializeAccount('new')
    assert.equal((await lib.handle('new','/sources','GET',{})).length,47)
    assert.equal((await lib.handle('new',`/sources/${s.id}/auth`,'GET',{})).hasCookie,false)
    await lib.handle('gamma',`/sources/${s.id}`,'DELETE',{})
    lib=createNetworkLibrary(store.db,{defaultSources:catalog,authKey:'fixture-key'})
    assert.equal((await lib.handle('gamma','/sources','GET',{})).some(x=>x.id===s.id),false)
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{store.close()}
})
