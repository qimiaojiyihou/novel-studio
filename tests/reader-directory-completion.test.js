import test from 'node:test'
import assert from 'node:assert/strict'
import {createDirectoryCompletion} from '../reader-service/public/network.js'

const book=(n=400,incomplete=true,id='book')=>({id,title:'模拟长目录',chapterCount:n,tocIncomplete:incomplete,tocPagesLoaded:n/80})
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const tick=()=>new Promise(r=>setImmediate(r))

test('one click completes every metadata batch; repeated click shares one request chain',async()=>{
  const gate=deferred(),changes=[],seen=[];let n=400,loads=0,active=0,peak=0
  const loader=createDirectoryCompletion({account:()=> 'alpha',read:async()=>book(n),wait:async()=>{},onChange:j=>changes.push(j),onBook:b=>seen.push(b.chapterCount),load:async()=>{loads++;active++;peak=Math.max(peak,active);if(loads===1)await gate.promise;n+=400;active--;return book(n,n<1600)}})
  const first=loader.start(book());assert.equal(loader.start(book()),first)
  await tick();assert.equal(loads,1);gate.resolve();await first
  assert.equal(loads,3);assert.equal(peak,1);assert.deepEqual(seen,[400,800,1200,1600])
  assert.equal(loader.get('book').status,'complete');assert.equal(changes.at(-1).loaded,1600)
})

test('lost response retains server cursor, reports error and retry reads durable progress before continuing',async()=>{
  let n=400,loads=0,reads=0
  const loader=createDirectoryCompletion({account:()=> 'alpha',read:async()=>{reads++;return book(n,n<1600)},wait:async()=>{},load:async()=>{loads++;n+=400;if(n===1200)throw Error('丢失响应');return book(n,n<1600)}})
  await loader.start(book());assert.equal(loader.get('book').status,'error');assert.equal(loader.get('book').loaded,800)
  await loader.start(book(800));assert.equal(reads,2);assert.equal(loads,3);assert.equal(loader.get('book').loaded,1600);assert.equal(loader.get('book').status,'complete')
})

test('pause finishes only the in-flight metadata batch; resume is sequential with a fresh server read',async()=>{
  const gate=deferred();let n=400,loads=0
  const loader=createDirectoryCompletion({account:()=> 'alpha',read:async()=>book(n,n<1200),wait:async()=>{},load:async()=>{loads++;if(loads===1)await gate.promise;n+=400;return book(n,n<1200)}})
  const pending=loader.start(book());await tick();loader.pause('book');gate.resolve();await pending
  assert.equal(loads,1);assert.equal(loader.get('book').status,'paused');assert.equal(loader.get('book').loaded,800)
  await loader.start(book(800));assert.equal(loads,2);assert.equal(loader.get('book').status,'complete')
})

test('book jobs are queued once, paused queue can resume and requests never overlap',async()=>{
  const gate=deferred(),loaded=[];let active=0,peak=0
  const loader=createDirectoryCompletion({account:()=> 'alpha',read:async id=>book(400,true,id),wait:async()=>{},load:async id=>{active++;peak=Math.max(peak,active);if(id==='a')await gate.promise;loaded.push(id);active--;return book(800,false,id)}})
  const a=loader.start(book(400,true,'a')),b=loader.start(book(400,true,'b'));loader.pause('b');gate.resolve();await Promise.all([a,b])
  assert.deepEqual(loaded,['a']);await loader.start(book(400,true,'b'));assert.deepEqual(loaded,['a','b']);assert.equal(peak,1)
})

test('account reset discards old responses and scheduled batches, including the same book ID',async()=>{
  let owner='alpha';const gate=deferred(),seen=[],loads=[]
  const loader=createDirectoryCompletion({account:()=>owner,read:async id=>book(400,true,id),wait:async()=>{},onBook:b=>seen.push([owner,b.chapterCount]),load:async id=>{const who=owner;loads.push(who);if(who==='alpha')await gate.promise;return book(who==='alpha'?800:1200,false,id)}})
  const old=loader.start(book());await tick();loader.reset();owner='beta';const fresh=loader.start(book());gate.resolve();await Promise.all([old,fresh])
  assert.deepEqual(loads,['alpha','beta']);assert.ok(!seen.some(([who,n])=>who==='beta'&&n===800));assert.equal(loader.get('book').loaded,1200)
})

test('no-progress loop stops with resumable error, while directory-page progress without new chapters is accepted',async()=>{
  let loads=0
  const stopped=createDirectoryCompletion({account:()=> 'alpha',read:async()=>book(),wait:async()=>{},load:async()=>{loads++;return book()}})
  await stopped.start(book());assert.equal(loads,1);assert.equal(stopped.get('book').status,'error');assert.match(stopped.get('book').error,/没有推进/)
  const advancing=createDirectoryCompletion({account:()=> 'alpha',read:async()=>book(),wait:async()=>{},load:async()=>({ ...book(400,loads<3),tocPagesLoaded:++loads*5})})
  await advancing.start(book());assert.equal(advancing.get('book').status,'complete')
})
