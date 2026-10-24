import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import iconv from 'iconv-lite'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
import { fail } from './store.js'
import {literalPageRedirect} from './source-redirect.js'

export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}
export function sourceURL(value, base) {
  let url
  try { url = new URL(value, base) } catch { fail(400, '书源地址格式错误') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2048) fail(400, '书源仅支持标准端口的 HTTP/HTTPS 地址')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host) || (ipaddr.isValid(host) && !publicAddress(host))) fail(400, '书源地址应为公网地址')
  url.hash = ''; return url
}
// A source key is not a request origin. Legado uses paths/fragments to identify
// multiple rule variants on one host; fragments are never sent over the wire.
export function sourceIdentity(value){
  const url=sourceURL(value),raw=new URL(value)
  url.hash=raw.hash
  return url.pathname==='/'&&!url.search&&!url.hash?url.origin:url.href
}

export function privateSourceHeaders(value={}){
  const headers={}
  for(const [name,raw]of Object.entries(value)){
    const key=name.toLowerCase()
    if(!['cookie','authorization','x-api-key'].includes(key)||typeof raw!=='string'||raw.length>16384||/[\r\n\x00]/.test(raw))fail(400,'书源私有请求头格式错误')
    headers[key]=raw
  }
  return headers
}

// A small non-credential allowlist; never forward cookies, authorization, Host
// or user-supplied transport headers. Revalidated by the fetcher on every hop.
export function sourceHeaders(value = {}, base, allowedOrigins = []) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length>16) fail(400,'请求头应为静态 JSON 对象（最多 16 项）')
  const headers={}
  for(const [name,raw] of Object.entries(value)) {
    const key=name.toLowerCase()
    // The transport owns connection lifetime; legacy hop-by-hop hints are ignored.
    if(key==='connection'&&typeof raw==='string'&&/^(close|keep-alive)$/i.test(raw))continue
    if(!['user-agent','accept','accept-language','referer','content-type','sdk-version','x-requested-with','version-code','version-name','channel','appid','app_name','language','vn','ts','vc','cache-control','app-version','platform','reg','application-id','net-env','qm-params','sign'].includes(key)) fail(400,`请求头 ${key.slice(0,40)} 暂未支持`)
    if(['version-code','appid','vc','ts'].includes(key)&&(typeof raw!=='string'||!/^[-\w.]{1,64}$/.test(raw)))fail(400,'版本或应用标识请求头格式错误')
    if(key==='sdk-version'&&(typeof raw!=='string'||!/^[-\w.]{1,30}$/.test(raw)))fail(400,'SDK 版本请求头格式错误')
    if(typeof raw!=='string'||raw.length>1024||/[\r\n\x00]/.test(raw)||/<js>|@js:/i.test(raw)) fail(400,'请求头内容应为单行静态文本')
    const text=key==='referer'?raw.replaceAll('{{baseUrl}}',base||''):raw
    if(text.includes('{{')) fail(400,'请求头动态表达式暂未支持')
    if(key==='referer'){
      if(!base)fail(400,'Referer 应与书源同域')
      const referer=sourceURL(text,base),origin=sourceURL(base)
      if(referer.origin!==origin.origin&&!allowedOrigins.includes(referer.origin))fail(400,'Referer 应与书源同域或位于书源明确声明的来源')
      if(origin.protocol==='https:'&&referer.protocol!=='https:')fail(400,'Referer 应保持 HTTPS')
    }
    if(key==='content-type' && !['application/x-www-form-urlencoded','application/json'].includes(text)) fail(400,'仅支持表单或 JSON 请求类型')
    headers[key]=key==='referer'?sourceURL(text,base).href:text
  }
  return headers
}

function problem(code, message, details = {}) { return Object.assign(new Error(message), {status:502,code,...details}) }
export function checkSourceOrigin(url, scope, allowedOrigins = []) {
  const origin=scope?sourceURL(scope):null
  const upgraded=origin?.protocol==='http:'&&url.protocol==='https:'&&url.hostname===origin.hostname
  if (scope && url.origin !== origin.origin && !upgraded && !allowedOrigins.includes(url.origin)) throw problem('ORIGIN_BLOCKED','链接或重定向超出书源域名，请核实目标站点后配置允许域名',{status:400,phase:'redirect',targetOrigin:url.origin})
}
export function sourceOrigins(value = []) {
  if (!Array.isArray(value) || value.length > 6) fail(400,'允许域名应为最多 6 个完整 HTTP/HTTPS 来源地址')
  return [...new Set(value.map(raw => {
    if(typeof raw !== 'string') fail(400,'允许域名格式错误')
    const url=sourceURL(raw)
    if(url.pathname !== '/' || url.search || raw.includes('#') || url.hostname.includes('*')) fail(400,'允许域名只填写协议和域名，不含路径、查询或通配符')
    return url.origin
  }))]
}
export function retryDelay(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 100) return 0
  const ms=/^\d+$/.test(value.trim())?Number(value)*1000:Date.parse(value)-now
  return Number.isFinite(ms) && ms>0 ? Math.min(ms,Number.MAX_SAFE_INTEGER-now) : 0
}
function interrupted(signal, phase) { return problem(signal?.reason?.name==='TimeoutError'?'REQUEST_TIMEOUT':'CANCELLED',signal?.reason?.name==='TimeoutError'?'书源操作总时限已到，请稍后重试':'书源请求已取消',{phase}) }
function bounded(promise, signal, ms, phase) {
  return new Promise((accept,reject)=>{
    const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value)}
    const abort=()=>finish(reject,interrupted(signal,phase))
    const timer=setTimeout(()=>finish(reject,problem(`${phase.toUpperCase()}_TIMEOUT`,`${({dns:'域名解析',queue:'同域排队'})[phase]||phase}超时`,{phase})),ms)
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    Promise.resolve(promise).then(value=>finish(accept,value),error=>finish(reject,error))
  })
}

// Per-host serialization is shared across accounts for this service instance.
// No automatic retry: cooldown rejects promptly, instead of occupying sockets.
export function createSourceFetcher({ resolve = lookup, requestHTTP = http.request, requestHTTPS = https.request,
  now = Date.now, intervalMs = 750, timeouts = {} } = {}) {
  const budget={dns:5000,connect:8000,headers:12000,read:12000,total:25000,...timeouts},hosts=new Map()
  async function acquire(host,signal) {
    for(const [key,state] of hosts)if(!state.busy&&!state.waiters.length&&state.next<=now()&&state.until<=now()&&state.touched<now()-600000)hosts.delete(key)
    let state=hosts.get(host)
    if(!state){if(hosts.size>=1000)throw problem('QUEUE_FULL','书源调度繁忙，请稍后重试',{status:429,phase:'queue'});state={busy:false,waiters:[],next:0,until:0,failures:0,touched:now()};hosts.set(host,state)}
    const cooldown=()=>{if(state.until>now())throw problem('RATE_COOLDOWN',`此域名限流等待中，约 ${Math.ceil((state.until-now())/1000)} 秒后重试`,{phase:'queue',httpStatus:429,retryAfterSeconds:Math.ceil((state.until-now())/1000)})}
    cooldown()
    if(signal.aborted)throw interrupted(signal,'queue')
    if(state.busy){
      if(state.waiters.length>=8)throw problem('QUEUE_FULL','此域名排队请求过多，请稍后重试',{status:429,phase:'queue'})
      await new Promise((accept,reject)=>{
        const entry={accept:()=>{signal.removeEventListener('abort',abort);accept()}}
        const abort=()=>{state.waiters=state.waiters.filter(item=>item!==entry);reject(interrupted(signal,'queue'))}
        signal.addEventListener('abort',abort,{once:true});state.waiters.push(entry)
      })
    }else state.busy=true
    const release=()=>{state.touched=now();state.next=now()+intervalMs;const next=state.waiters.shift();if(next)next.accept();else state.busy=false}
    try {
      cooldown()
      if(signal.aborted)throw interrupted(signal,'queue')
      const delay=Math.max(0,state.next-now())
      if(delay)await new Promise((accept,reject)=>{const abort=()=>{clearTimeout(timer);reject(interrupted(signal,'queue'))};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);accept()},delay);signal.addEventListener('abort',abort,{once:true})})
      return {state,release}
    }catch(error){release();throw error}
  }
  // Resolve, validate every answer, then pin the actual socket lookup. Every
  // redirect repeats validation; never use imported cookies or proxy settings.
  return async function fetchSource(value, { method = 'GET', body = '', charset = '', scope, allowedOrigins = [], headers = {}, credentialHeaders={}, cookieJar, signal: parentSignal, maxBytes = 2 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10 * 1024 * 1024) fail(400, '响应大小限制无效')
    const deadline = AbortSignal.timeout(budget.total)
    const signal = parentSignal ? AbortSignal.any([deadline, parentSignal]) : deadline
    let url = sourceURL(value)
    allowedOrigins=sourceOrigins(allowedOrigins)
    const customHeaders=sourceHeaders(headers,scope||url.origin,allowedOrigins)
    const privateHeaders=privateSourceHeaders(credentialHeaders),credentialOrigin=sourceURL(scope||value).origin
    for (let redirects = 0; redirects <= 3; redirects++) {
      checkSourceOrigin(url,scope,allowedOrigins)
      // Origin-specific Referer must never leak to a redirected host.
      const hopHeaders={...customHeaders}
      if(customHeaders.referer&&url.origin!==sourceURL(customHeaders.referer).origin)delete hopHeaders.referer
      if(url.origin!==sourceURL(value).origin){delete hopHeaders.sign;delete hopHeaders['qm-params']}
      sourceHeaders(hopHeaders,url.origin,allowedOrigins)
      const cookie=cookieJar?.getCookieString(url.href)
      if(cookie){if(typeof cookie!=='string'||cookie.length>16384||/[\r\n\x00]/.test(cookie))fail(400,'Cookie 格式错误');hopHeaders.cookie=cookie}
      // An allowlisted redirect permits fetching a public page, not disclosing
      // this source's login credential. Recompute credentials on every hop.
      if(url.origin===credentialOrigin){
        const savedCookie=hopHeaders.cookie
        Object.assign(hopHeaders,privateHeaders)
        if(savedCookie&&privateHeaders.cookie){
          const pairs=new Map()
          for(const pair of (savedCookie+';'+privateHeaders.cookie).split(';').map(v=>v.trim()).filter(Boolean)){const at=pair.indexOf('=');if(at<=0)fail(400,'Cookie 格式错误');pairs.set(pair.slice(0,at),pair)}
          hopHeaders.cookie=[...pairs.values()].join('; ')
          if(hopHeaders.cookie.length>16384)fail(413,'合并 Cookie 超过限制')
        }
      }
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const {state,release}=await acquire(host,signal)
      let result
      try {
      const answers = await bounded(Promise.resolve().then(()=>resolve(host,{all:true,verbatim:true})),signal,budget.dns,'dns').catch(error=>{
        if(error.status)throw error
        throw problem(['ENOTFOUND','ENODATA'].includes(error.code)?'DNS_NOT_FOUND':'DNS_FAILED',`书源域名解析失败（${['ENOTFOUND','ENODATA','EAI_AGAIN'].includes(error.code)?error.code:'DNS'}）`,{phase:'dns'})
      })
      if (!answers.length || answers.some(a => !publicAddress(a.address))) throw problem('DNS_PRIVATE','书源 DNS 指向非公网地址',{status:400,phase:'dns'})
      const selected = answers.find(a=>a.family===4)||answers[0]
      result = await new Promise((accept, reject) => {
        let req,res,decoded,timer,done=false,phase='connect'
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error){decoded?.destroy();res?.destroy();req?.destroy?.();reject(error)}else accept(value)}
        const abort=()=>finish(interrupted(signal,phase))
        const arm=(next,ms)=>{phase=next;clearTimeout(timer);timer=setTimeout(()=>finish(problem(`${next.toUpperCase()}_TIMEOUT`,`${({connect:'连接',tls:'TLS 握手',headers:'等待响应头',read:'读取正文'})[next]}超时`,{phase:next})),ms)}
        signal.addEventListener('abort',abort,{once:true})
        if(signal.aborted){abort();return}
        arm('connect',budget.connect)
        try {req = (url.protocol === 'https:' ? requestHTTPS : requestHTTP)(url, {
          method, signal, agent: false, autoSelectFamily: true, autoSelectFamilyAttemptTimeout:250,
          // Every candidate was validated above. Let Node race IPv4/IPv6 so a
          // broken route to the first DNS answer does not stall the whole source.
          lookup: (_host, options, callback) => options.all ? callback(null, [selected,...answers.filter(a=>a!==selected)]) : callback(null, selected.address, selected.family),
          headers: { 'user-agent': 'NovelStudioReader/1.0', accept: 'text/html,application/json,text/plain', ...hopHeaders, 'accept-encoding': 'identity', ...(method === 'POST' ? { 'content-type': hopHeaders['content-type']||'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}) },
        }, response => {
          res=response
          if(done){res.destroy();return}
          try{if(cookieJar&&res.headers['set-cookie'])cookieJar.setCookies(url.href,res.headers['set-cookie'])}catch(error){finish(error);return}
          if ([301,302,303,307,308].includes(res.statusCode)) { finish(null,{ redirect: res.headers.location, status: res.statusCode });res.destroy();return }
          if (![200,204].includes(res.statusCode)) {
            const delay=retryDelay(res.headers['retry-after'],now())
            if(res.statusCode===429 || (res.statusCode===503&&delay)) {
              state.failures=Math.min(6,state.failures+1);state.until=Math.max(state.until,now()+(delay||Math.min(300000,10000*2**(state.failures-1))))
            }
            finish(problem(`HTTP_${res.statusCode}`,`书源返回 HTTP ${res.statusCode}${state.until>now()?`，约 ${Math.ceil((state.until-now())/1000)} 秒后重试`:res.statusCode===403?'，站点拒绝访问，请核对站点要求':''}`,{phase:'headers',httpStatus:res.statusCode,...(state.until>now()?{retryAfterSeconds:Math.ceil((state.until-now())/1000)}:{})}));return
          }
          arm('read',budget.read)
          const encoding=(res.headers['content-encoding']||'identity').toLowerCase()
          const factory={gzip:createGunzip,deflate:createInflate,br:createBrotliDecompress}[encoding]
          if(encoding!=='identity'&&!factory){finish(problem('ENCODING_UNSUPPORTED','书源响应压缩格式暂未支持',{phase:'read'}));return}
          decoded=factory?factory():res
          let compressed=0
          res.on('data',chunk=>{compressed+=chunk.length;if(compressed>maxBytes)finish(problem('RESPONSE_TOO_LARGE',`书源响应超过 ${maxBytes/1024/1024} MiB`,{status:413,phase:'read'}))})
          res.on('error',()=>finish(problem('READ_FAILED','书源响应读取中断',{phase:'read'})))
          res.on('aborted',()=>finish(problem('READ_ABORTED','书源提前中断响应',{phase:'read'})))
          let size = 0; const chunks = []
          decoded.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)finish(problem('RESPONSE_TOO_LARGE',`书源响应超过 ${maxBytes/1024/1024} MiB`,{status:413,phase:'read'}));else chunks.push(chunk)})
          decoded.on('error',()=>finish(problem('DECODE_FAILED','书源响应解压或读取失败',{phase:'read'})))
          decoded.on('end',()=>{state.failures=0;finish(null,{bytes:Buffer.concat(chunks),type:res.headers['content-type']||'',headers:res.headers})})
          if(factory)res.pipe(decoded)
        })
        req.on('socket',socket=>{
          if(done)return
          socket.once('connect',()=>{if(!done)arm(url.protocol==='https:'?'tls':'headers',url.protocol==='https:'?budget.connect:budget.headers)})
          socket.once('secureConnect',()=>{if(!done)arm('headers',budget.headers)})
        })
        req.on('error',error=>{const tls=phase==='tls'||/CERT|TLS|SSL/.test(error.code||'');finish(signal.aborted?interrupted(signal,phase):problem(tls?'TLS_FAILED':'CONNECTION_FAILED',tls?'TLS 握手或证书校验失败':'书源连接失败或连接被重置',{phase:tls?'tls':phase}))})
        req.end(method === 'POST' ? body : undefined)
        }catch{finish(problem('CONNECTION_FAILED','书源连接初始化失败',{phase}))}
      })
      }finally{release()}
      if (result.redirect) {
        const target = sourceURL(result.redirect, url)
        if(url.protocol==='https:'&&target.protocol==='http:')throw problem('HTTPS_DOWNGRADE','书源尝试从 HTTPS 降级到 HTTP',{status:400,phase:'redirect',targetOrigin:target.origin})
        url = target
        if (result.status === 303 || ([301,302].includes(result.status) && method === 'POST')) { method = 'GET'; body = '' }
        continue
      }
      if (!result.bytes) fail(502, '书源重定向缺少目标')
      const prefix = result.bytes.subarray(0, 4096).toString('ascii')
      const encoding = charset || result.type.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || prefix.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8'
      if (!iconv.encodingExists(encoding)) fail(400, '书源字符编码暂未支持')
      const text=iconv.decode(result.bytes,encoding),navigation=literalPageRedirect(text)
      if(navigation){const target=sourceURL(navigation,url);if(url.protocol==='https:'&&target.protocol==='http:')throw problem('HTTPS_DOWNGRADE','书源页面尝试从 HTTPS 降级到 HTTP',{status:400,phase:'redirect',targetOrigin:target.origin});checkSourceOrigin(target,scope,allowedOrigins);url=target;method='GET';body='';continue}
      return { text, url: url.href, type:result.type, headers:result.headers }
    }
    fail(502, '书源重定向次数过多')
  }
}
