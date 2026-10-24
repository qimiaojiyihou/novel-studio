import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {CookieJar} from 'tough-cookie'
import {fail} from './store.js'
import {sourceURL} from './source-fetch.js'

// Credentials never enter public source config, import reports or logs.
export function createSourceAuth(db,key=randomBytes(32)) {
  const secret=createHash('sha256').update(key).update('reader-source-auth-v1').digest()
  db.exec(`CREATE TABLE IF NOT EXISTS network_source_auth(owner TEXT NOT NULL,id TEXT NOT NULL,sealed TEXT NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,id) REFERENCES network_sources(owner,id) ON DELETE CASCADE)`)
  function read(owner,id){
    const row=db.prepare('SELECT sealed FROM network_source_auth WHERE owner=? AND id=?').get(owner,id)
    if(!row)return {params:{},values:{},variable:''}
    try{const bytes=Buffer.from(row.sealed,'base64'),cipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));cipher.setAAD(Buffer.from(JSON.stringify([owner,id])));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]))}
    catch{fail(409,'书源登录配置需要重新保存（服务密钥已变化或配置损坏）')}
  }
  function mutate(owner,id,active,fn){
    active();const value=read(owner,id);fn(value)
    const plain=JSON.stringify(value);if(Buffer.byteLength(plain)>256*1024)fail(413,'书源登录状态或变量超过限制')
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(JSON.stringify([owner,id])))
    const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]),sealed=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')
    db.prepare('INSERT INTO network_source_auth VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET sealed=excluded.sealed').run(owner,id,sealed)
  }
  function profile(owner,s,active){
    const valid=url=>{const u=sourceURL(url,s.url),base=sourceURL(s.url);if(u.hostname!==base.hostname||base.protocol==='https:'&&u.protocol!=='https:')fail(400,'Cookie 仅限当前书源域名');return u.href}
    const jar=state=>state.jar?CookieJar.deserializeSync(state.jar):new CookieJar()
    const saveCookies=(url,values)=>{valid(url);mutate(owner,s.id,active,state=>{const j=jar(state);for(const value of values){if(typeof value!=='string'||value.length>8192||/[\r\n\x00]/.test(value))fail(400,'Cookie 格式错误');try{j.setCookieSync(value,url,{ignoreError:false})}catch{fail(400,'Cookie 域名或格式错误')}}const data=j.serializeSync();if(data.cookies.length>100)fail(413,'书源 Cookie 数量超过限制');state.jar=data})}
    return {
      read:()=>read(owner,s.id),
      mutate:fn=>mutate(owner,s.id,active,fn),
      save({params={},cookie,clearCookie=false,method='manual',savedAt=Date.now()}){
        if(typeof clearCookie!=='boolean')fail(400,'清除 Cookie 选项无效')
        if(typeof params!=='object'||Array.isArray(params))fail(400,'登录参数应为对象')
        const fields=new Set((s.login?.ui||[]).filter(f=>f.type!=='button').map(f=>f.name))
        for(const [key,value]of Object.entries(params))if(['__proto__','prototype','constructor'].includes(key)||!fields.has(key)||typeof value!=='string'||value.length>8192)fail(400,'登录参数字段或长度错误')
        // Validate the entire input before committing either parameters or cookies.
        if(cookie!==undefined&&(typeof cookie!=='string'||cookie.length>16384))fail(400,'Cookie 过长或格式错误')
        mutate(owner,s.id,active,state=>{
          const j=clearCookie?new CookieJar():jar(state)
          if(cookie)for(const pair of cookie.split(';').map(v=>v.trim()).filter(Boolean)){
            if(/[\r\n\x00]/.test(pair)||!pair.includes('='))fail(400,'Cookie 格式错误')
            try{j.setCookieSync(`${pair}; Path=/; ${s.url.startsWith('https:')?'Secure; ':''}HttpOnly`,new URL('/',s.url).href)}catch{fail(400,'Cookie 格式错误')}
          }
          const data=j.serializeSync();if(data.cookies.length>100)fail(413,'书源 Cookie 数量超过限制')
          state.jar=data;state.params||={};for(const [key,value]of Object.entries(params))if(value)state.params[key]=value
          state.authorization={status:'saved',method,savedAt}
        })
      },
      cookieJar:{
        getCookieString(url){const u=sourceURL(url),base=sourceURL(s.url);if(u.hostname!==base.hostname||base.protocol==='https:'&&u.protocol!=='https:')return '';return jar(read(owner,s.id)).getCookieStringSync(url)},
        browserCookies(url){const u=sourceURL(url),base=sourceURL(s.url);if(u.hostname!==base.hostname||base.protocol==='https:'&&u.protocol!=='https:')return [];return jar(read(owner,s.id)).getCookiesSync(url).map(c=>({name:c.key,value:c.value,domain:base.hostname,path:c.path||'/',httpOnly:!!c.httpOnly,secure:!!c.secure,sameSite:({strict:'Strict',lax:'Lax',none:'None'})[c.sameSite]||'Lax',...(c.expires instanceof Date?{expires:c.expires.getTime()/1000}:{})}))},
        setCookies(url,values){const u=sourceURL(url);if(u.hostname===sourceURL(s.url).hostname)saveCookies(url,values)},
      },
      setCookies:saveCookies,
      clearCookies(){mutate(owner,s.id,active,state=>{delete state.jar})},
      reset(){active();db.prepare('DELETE FROM network_source_auth WHERE owner=? AND id=?').run(owner,s.id)},
      importCookie(value){if(typeof value!=='string'||value.length>16384)fail(400,'Cookie 过长');saveCookies(new URL('/',s.url).href,value.split(';').map(pair=>pair.trim()).filter(Boolean).map(pair=>`${pair}; Path=/; ${s.url.startsWith('https:')?'Secure; ':''}HttpOnly`))},
    }
  }
  return {profile}
}
