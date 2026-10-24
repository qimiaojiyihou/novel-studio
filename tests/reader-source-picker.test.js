import test from 'node:test'
import assert from 'node:assert/strict'
import {filterSearchSources,resolveSearchSources} from '../reader-service/public/network.js'

const sources=[
  {id:'a',name:'速读谷 · 通用书源',url:'https://www.suduguu.com',enabled:true},
  {id:'b',name:'速读谷 · 挖矿成神专用',url:'https://www.suduguu.com/#miner',enabled:true},
  {id:'c',name:'笔趣阁 A',url:'https://BIQU.example.org',enabled:true},
  {id:'d',name:'停用笔趣阁',url:'https://off.example.org',enabled:false},
]
test('search source filter matches partial name/domain, combined words and full-width case-insensitive input',()=>{
  assert.deepEqual(filterSearchSources(sources,'速读').map(s=>s.id),['a','b'])
  assert.deepEqual(filterSearchSources(sources,'速读 通用').map(s=>s.id),['a'])
  assert.deepEqual(filterSearchSources(sources,'ＳＵＤＵＧＵＵ').map(s=>s.id),['a','b'])
  assert.deepEqual(filterSearchSources(sources,' BIQU ').map(s=>s.id),['c'])
  assert.deepEqual(filterSearchSources(sources,'停用'),[])
  assert.deepEqual(filterSearchSources(sources,'不存在'),[])
  assert.deepEqual(filterSearchSources(sources).map(s=>s.id),['a','b','c'])
})
test('multi-source resolution separates all from explicit empty and excludes disabled/deleted/duplicate IDs',()=>{
  assert.deepEqual(resolveSearchSources(sources).map(s=>s.id),['a','b','c'])
  assert.deepEqual(resolveSearchSources(sources,[]),[])
  const ids=['c','a','c','d','deleted']
  assert.deepEqual(resolveSearchSources(sources,ids).map(s=>s.id),['a','c'])
  assert.deepEqual(ids,['c','a','c','d','deleted'])
  assert.deepEqual(resolveSearchSources(sources.map(s=>({...s,enabled:false})),ids),[])
})
