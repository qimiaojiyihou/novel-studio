import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {Readable,PassThrough} from 'node:stream'
import {gzipSync,brotliCompressSync} from 'node:zlib'
import {createSourceFetcher,retryDelay,sourceOrigins,sourceHeaders} from '../reader-service/source-fetch.js'
import {checkedDocument,normalizeSource,searchRequest} from '../reader-service/source-rules.js'
import {sampleSource} from './fixtures/network-source.js'
import {literalPageRedirect} from '../reader-service/source-redirect.js'

const resolve=async()=>[{address:'93.184.216.34',family:4}]
function transport(handler){return (url,options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>handler(url,options,callback,req));return req}}
function respond(callback,{body='hello',status=200,headers={}}={}){const res=Readable.from([Buffer.isBuffer(body)?body:Buffer.from(body)]);res.statusCode=status;res.headers=headers;callback(res)}
const factory=handler=>createSourceFetcher({resolve,requestHTTPS:transport(handler),intervalMs:0})

test('empty loading pages follow only literal navigation under existing origin/DNS/HTTPS limits',async()=>{
  const loading=url=>'<title>Loading...</title><script>window.location.replace('+JSON.stringify(url)+');</script>'
  assert.equal(literalPageRedirect(loading('/json')),'/json')
  for(const html of ['<p>正文</p>'+loading('/json'),'<title>Loading...</title><script>location.href=computeUrl()</script>','<title>Just a moment...</title><script>location.href="/verify"</script>'])assert.equal(literalPageRedirect(html),null)
  const seen=[],fetchPage=factory((url,options,cb)=>{seen.push({url:url.href,method:options.method});respond(cb,{body:url.pathname==='/start'?loading('/json'):'{"data":[]}'})})
  assert.equal((await fetchPage('https://books.example.org/start',{scope:'https://books.example.org',method:'POST',body:'key=fixture'})).text,'{"data":[]}')
  assert.equal(seen[1].method,'GET')
  await assert.rejects(factory((_u,_o,cb)=>respond(cb,{body:loading('http://books.example.org/plain')}))('https://books.example.org',{scope:'https://books.example.org'}),e=>e.code==='HTTPS_DOWNGRADE')
  await assert.rejects(factory((_u,_o,cb)=>respond(cb,{body:loading('https://other.example.org')}))('https://books.example.org',{scope:'https://books.example.org'}),e=>e.code==='ORIGIN_BLOCKED')
  await assert.rejects(factory((_u,_o,cb)=>respond(cb,{body:loading('/loop')}))('https://books.example.org',{scope:'https://books.example.org'}),/重定向次数/)
})

test('204 header-only API responses remain available to script response.header instead of becoming failures',async()=>{
  const result=await factory((_u,_o,cb)=>respond(cb,{status:204,body:'',headers:{token:'fixture-ordering-token'}}))('https://books.example.org/order.json')
  assert.equal(result.text,'');assert.equal(result.headers.token,'fixture-ordering-token')
})

test('JSON API error envelopes are not reported as empty search results and never echo private messages',()=>{
  assert.throws(()=>checkedDocument('{"code":100103,"message":"PARAM_INVALID private-token","data":null}'),e=>e.code==='SOURCE_API_ERROR'&&e.message.includes('100103')&&!e.message.includes('private-token'))
  assert.doesNotThrow(()=>checkedDocument('{"code":0,"message":"ok","data":[]}'))
  assert.doesNotThrow(()=>checkedDocument('{"code":1,"message":"ok","data":[]}'))
  assert.doesNotThrow(()=>checkedDocument('{"code":7,"message":"novel field","data":{"content":"正文"}}'))
})

test('version headers are bounded non-credentials and dual-stack sockets use only verified addresses',async()=>{
  assert.equal(sourceHeaders({'version-code':'123','x-requested-with':'XMLHttpRequest','channel':'reader'},'https://example.org')['version-code'],'123')
  for(const headers of [{'version-code':'1\r\nHost: bad'},{Cookie:'private'},{Host:'other.example.org'},{Authorization:'private'}])assert.throws(()=>sourceHeaders(headers,'https://example.org'))
  const answers=[{address:'2606:4700:4700::1111',family:6},{address:'93.184.216.34',family:4}]
  const fetchPage=createSourceFetcher({resolve:async()=>answers,intervalMs:0,requestHTTPS:transport((url,options,callback)=>{
    assert.equal(options.autoSelectFamily,true)
    options.lookup(url.hostname,{all:true},(error,pinned)=>{assert.equal(error,null);assert.deepEqual(pinned,[answers[1],answers[0]])})
    respond(callback)
  })})
  assert.equal((await fetchPage('https://books.example.org')).text,'hello')
  const blocked=createSourceFetcher({resolve:async()=>[...answers,{address:'127.0.0.1',family:4}],intervalMs:0,requestHTTPS:()=>assert.fail('private answer must block before socket')})
  await assert.rejects(blocked('https://books.example.org'),e=>e.code==='DNS_PRIVATE')
})

test('explicit mobile-origin Referer reaches its own origin but is stripped on a different-origin redirect',async()=>{
  const seen=[],fetchPage=factory((url,options,callback)=>{seen.push(options.headers);respond(callback,url.hostname==='m.example.org'?{status:302,headers:{location:'https://cdn.example.org/book'}}:{})})
  await fetchPage('https://m.example.org/search',{scope:'https://www.example.org',allowedOrigins:['https://m.example.org','https://cdn.example.org'],headers:{Referer:'https://m.example.org/'},credentialHeaders:{Authorization:'private-www-only'}})
  assert.equal(seen[0].referer,'https://m.example.org/');assert.equal(seen[0].authorization,undefined)
  assert.equal(seen[1].referer,undefined);assert.equal(seen[1].authorization,undefined)
})

test('HTTP to same-host HTTPS upgrades validate both hops, while downgrade and private targets stay blocked',async()=>{
  const seen=[],http=transport((url,_options,callback)=>{seen.push(url.href);respond(callback,{status:301,headers:{location:'https://books.example.org/secure'}})}),https=transport((url,_options,callback)=>{seen.push(url.href);respond(callback)})
  const fetchPage=createSourceFetcher({resolve,requestHTTP:http,requestHTTPS:https,intervalMs:0})
  assert.equal((await fetchPage('http://books.example.org',{scope:'http://books.example.org'})).url,'https://books.example.org/secure')
  assert.equal(seen.length,2)
  const down=createSourceFetcher({resolve,requestHTTP:http,requestHTTPS:transport((_u,_o,cb)=>respond(cb,{status:302,headers:{location:'http://books.example.org/plain'}})),intervalMs:0})
  await assert.rejects(down('http://books.example.org',{scope:'http://books.example.org'}),e=>e.code==='HTTPS_DOWNGRADE')
  let calls=0
  const privateUpgrade=createSourceFetcher({resolve:async()=>++calls===1?[{address:'93.184.216.34',family:4}]:[{address:'127.0.0.1',family:4}],requestHTTP:http,requestHTTPS:https,intervalMs:0})
  await assert.rejects(privateUpgrade('http://books.example.org',{scope:'http://books.example.org'}),e=>e.code==='DNS_PRIVATE')
})

test('redirect allowlist is exact, bounded, validates DNS per hop and strips origin referer',async()=>{
  const seen=[]
  const fetchPage=factory((url,options,callback)=>{seen.push({url:url.href,headers:options.headers});respond(callback,url.hostname==='books.example.org'?{status:302,headers:{location:'https://cdn.example.org/book'}}:{})})
  await assert.rejects(fetchPage('https://books.example.org',{scope:'https://books.example.org'}),e=>e.code==='ORIGIN_BLOCKED'&&e.targetOrigin==='https://cdn.example.org')
  assert.equal(seen.length,1)
  await fetchPage('https://books.example.org',{scope:'https://books.example.org',allowedOrigins:['https://cdn.example.org'],headers:{Referer:'https://books.example.org/?private=1'}})
  assert.equal(seen.at(-1).headers.referer,undefined)
  for(const origins of [['https://127.0.0.1'],['https://*.example.org'],['https://cdn.example.org/path'],['https://cdn.example.org?token=x'],Array(7).fill('https://cdn.example.org')])assert.throws(()=>sourceOrigins(origins))
  const unsafe=createSourceFetcher({resolve:async host=>[{address:host==='cdn.example.org'?'127.0.0.1':'93.184.216.34',family:4}],requestHTTPS:transport((_u,_o,cb)=>respond(cb,{status:302,headers:{location:'https://cdn.example.org/'}})),intervalMs:0})
  await assert.rejects(unsafe('https://books.example.org',{scope:'https://books.example.org',allowedOrigins:['https://cdn.example.org']}),e=>e.code==='DNS_PRIVATE')
  const normalized=normalizeSource({...sampleSource,novelStudioAllowedOrigins:['https://cdn.example.org'],searchUrl:'https://cdn.example.org/search?key={{key}}'})
  assert.deepEqual(searchRequest(normalized,'小说',1).allowedOrigins,['https://cdn.example.org'])
  let referer
  await factory((_u,options,cb)=>{referer=options.headers.referer;respond(cb)})('https://books.example.org/engine/search',{scope:'https://books.example.org/engine/',headers:{Referer:'https://books.example.org/engine/'}})
  assert.equal(referer,'https://books.example.org/engine/','path-based source identity does not strip same-origin Referer')
})

test('same host serializes, other hosts proceed, canceled queue entries never issue requests',async()=>{
  let release,entered;const started=new Promise(r=>{entered=r}),seen=[]
  const fetchPage=factory((url,_options,callback)=>{seen.push(url.href);if(url.pathname==='/hold'){release=()=>respond(callback);entered()}else respond(callback)})
  const first=fetchPage('https://a.example.org/hold');await started
  const controller=new AbortController(),canceled=fetchPage('https://a.example.org/cancel',{signal:controller.signal})
  const check=assert.rejects(canceled,e=>e.code==='CANCELLED');controller.abort();await check
  const queued=fetchPage('https://a.example.org/next')
  assert.equal((await fetchPage('https://b.example.org/')).text,'hello');assert.equal(seen.length,2)
  release();await Promise.all([first,queued]);assert.equal(seen.length,3);assert.ok(!seen.some(u=>u.includes('/cancel')))
})

test('Cookie jar receives Set-Cookie on redirects, recomputes each hop and never forwards a source cookie to another origin',async()=>{
  const seen=[],saved=[]
  const cookieJar={getCookieString:url=>new URL(url).hostname==='books.example.org'?'sid=fixture':'',setCookies:(url,values)=>saved.push({url,values})}
  const fetchPage=factory((url,options,callback)=>{seen.push(options.headers);respond(callback,url.pathname==='/'?{status:302,headers:{location:'https://cdn.example.org/book','set-cookie':['new=fixture; Path=/; Secure']}}:{})})
  await fetchPage('https://books.example.org/',{scope:'https://books.example.org',allowedOrigins:['https://cdn.example.org'],cookieJar})
  assert.equal(seen[0].cookie,'sid=fixture');assert.equal(seen[1].cookie,undefined);assert.equal(saved.length,1)
  await assert.rejects(fetchPage('https://books.example.org/',{cookieJar:{getCookieString:()=> 'bad\r\nheader'}}),/Cookie/)
})

test('dynamic credential headers stay on the source exact origin, including on allowed redirects',async()=>{
  const seen=[],fetchPage=factory((url,options,callback)=>{seen.push(options.headers);respond(callback,url.hostname==='books.example.org'?{status:302,headers:{location:'https://cdn.example.org/book'}}:{})})
  await fetchPage('https://books.example.org/',{scope:'https://books.example.org',allowedOrigins:['https://cdn.example.org'],cookieJar:{getCookieString:url=>new URL(url).hostname==='books.example.org'?'sid=old; server=value':''},credentialHeaders:{Authorization:'Bearer fixture',Cookie:'sid=fixture','X-Api-Key':'fixture'}})
  assert.equal(seen[0].authorization,'Bearer fixture');assert.equal(seen[0].cookie,'sid=fixture; server=value')
  for(const key of ['authorization','cookie','x-api-key'])assert.equal(seen[1][key],undefined)
  await assert.rejects(fetchPage('https://books.example.org/',{credentialHeaders:{Authorization:'bad\r\nInjected: yes'}}))
})

test('429 Retry-After is honored across requests; no retry storms; cooldown expires',async()=>{
  let now=1_700_000_000_000,count=0
  const fetchPage=createSourceFetcher({resolve,now:()=>now,intervalMs:0,requestHTTPS:transport((_u,_o,cb)=>{count++;respond(cb,count===1?{status:429,headers:{'retry-after':'120'}}:{})})})
  await assert.rejects(fetchPage('https://limited.example.org'),e=>e.httpStatus===429&&e.retryAfterSeconds===120)
  await assert.rejects(fetchPage('https://limited.example.org'),e=>e.code==='RATE_COOLDOWN');assert.equal(count,1)
  now+=120001;assert.equal((await fetchPage('https://limited.example.org')).text,'hello');assert.equal(count,2)
  assert.equal(retryDelay(new Date(now+60000).toUTCString(),now),59999)
  assert.equal(retryDelay('-10',now),0);assert.equal(retryDelay('bad',now),0)
})

test('same-host queue is bounded and canceled requests release capacity',async()=>{
  let release,entered;const started=new Promise(r=>{entered=r})
  const fetchPage=factory((_u,_o,cb)=>{release=()=>respond(cb);entered()})
  const first=fetchPage('https://queue.example.org');await started
  const controllers=Array.from({length:8},()=>new AbortController())
  const pending=controllers.map(c=>assert.rejects(fetchPage('https://queue.example.org',{signal:c.signal}),e=>e.code==='CANCELLED'))
  await assert.rejects(fetchPage('https://queue.example.org'),e=>e.code==='QUEUE_FULL')
  controllers.forEach(c=>c.abort());await Promise.all(pending);release();await first
})

test('403 is not automatically retried and 503 Retry-After uses cooldown',async()=>{
  for(const status of [403,503]){
    let calls=0
    const fetchPage=factory((_u,_o,cb)=>{calls++;respond(cb,{status,headers:{'retry-after':'15'}})})
    await assert.rejects(fetchPage('https://limited.example.org'),e=>e.httpStatus===status)
    assert.equal(calls,1)
    if(status===503){await assert.rejects(fetchPage('https://limited.example.org'),e=>e.code==='RATE_COOLDOWN');assert.equal(calls,1)}
  }
})

test('DNS, connection, TLS, header and body timeout diagnostics remain distinct',async()=>{
  const budgets={dns:15,connect:15,headers:15,read:15,total:200}
  const make=(handler,resolver=resolve)=>createSourceFetcher({resolve:resolver,requestHTTPS:transport(handler),intervalMs:0,timeouts:budgets})
  await assert.rejects(make(()=>{},()=>new Promise(()=>{}))('https://example.org'),e=>e.code==='DNS_TIMEOUT')
  await assert.rejects(make(()=>{},()=>{throw Object.assign(new Error(),{code:'ENOTFOUND'})})('https://example.org'),e=>e.code==='DNS_NOT_FOUND')
  await assert.rejects(make(()=>{})('https://example.org'),e=>e.code==='CONNECT_TIMEOUT')
  await assert.rejects(make((_u,_o,_cb,req)=>{const socket=new EventEmitter();req.emit('socket',socket);socket.emit('connect')})('https://example.org'),e=>e.code==='TLS_TIMEOUT')
  await assert.rejects(make((_u,_o,_cb,req)=>{const socket=new EventEmitter();req.emit('socket',socket);socket.emit('connect');socket.emit('secureConnect')})('https://example.org'),e=>e.code==='HEADERS_TIMEOUT')
  await assert.rejects(make((_u,_o,cb)=>{const res=new PassThrough();res.statusCode=200;res.headers={};cb(res);res.write('partial')})('https://example.org'),e=>e.code==='READ_TIMEOUT')
  await assert.rejects(make((_u,_o,_cb,req)=>req.emit('error',Object.assign(new Error(),{code:'CERT_HAS_EXPIRED'})))('https://example.org'),e=>e.code==='TLS_FAILED')
})

test('gzip and brotli decode with independent decompressed byte limits',async()=>{
  for(const [encoding,compress] of [['gzip',gzipSync],['br',brotliCompressSync]]){
    const fetchPage=factory((_u,_o,cb)=>respond(cb,{body:compress(Buffer.from('正文'.repeat(100))),headers:{'content-encoding':encoding}}))
    assert.equal((await fetchPage('https://example.org')).text,'正文'.repeat(100))
    await assert.rejects(fetchPage('https://example.org',{maxBytes:100}),e=>e.status===413)
  }
})

test('verification/login page detection does not classify ordinary chapter prose as a challenge',()=>{
  assert.throws(()=>checkedDocument('<title>Just a moment...</title><p>Wait</p>'),e=>e.code==='VERIFICATION_PAGE')
  assert.throws(()=>checkedDocument('<title>用户登录</title><input type=password>'),e=>e.code==='LOGIN_PAGE')
  assert.doesNotThrow(()=>checkedDocument('<title>第一章 安全验证</title><div id=content>他输入验证码并登录。</div>'))
  assert.doesNotThrow(()=>checkedDocument('<div>访问验证与登录</div>'))
})
