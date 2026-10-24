import {randomBytes} from 'node:crypto'
import {sourceURL,checkSourceOrigin} from './source-fetch.js'
import {digest,fail} from './store.js'

// A shared parsing helper library is not a login requirement. This describes
// declared capabilities, not a promise that an upstream never asks for login.
export function sourceAuthorizationMode(s){
  const login=s.login
  if(login?.authorization)return 'callback'
  return login&&(login.required||login.url||login.script||login.checkScript||login.ui?.length)?'manual':'public'
}

// Explicit opt-in extension, not a claim that an arbitrary login page supports
// OAuth. Providers return fragment-v1 to our fixed, credential-free callback URL.
export function normalizeAuthorization(raw,source,fields,origins){
  if(!raw)return undefined
  if(typeof raw!=='object'||Array.isArray(raw)||raw.protocol!=='fragment-v1')fail(400,'授权回传协议需要 fragment-v1')
  const url=sourceURL(raw.authorizeUrl,source)
  if(url.protocol!=='https:')fail(400,'书源授权入口需要 HTTPS')
  checkSourceOrigin(url,source,origins)
  if(new URL(raw.authorizeUrl,source).hash)fail(400,'授权入口不应含片段')
  const parameters=raw.parameters||{}
  if(typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).length>20)fail(400,'授权参数映射无效')
  const allowed=new Set(fields.filter(f=>f.type!=='button').map(f=>f.name))
  for(const [remote,local]of Object.entries(parameters))if(!/^[\w-]{1,64}$/.test(remote)||['__proto__','prototype','constructor'].includes(local)||!allowed.has(local))fail(400,'授权参数必须映射到已声明的登录字段')
  if(new Set(Object.values(parameters)).size!==Object.keys(parameters).length)fail(400,'授权参数应分别映射到不同登录字段')
  if(!Object.keys(parameters).length&&raw.cookie!==true)fail(400,'授权回传至少声明一个参数或 Cookie')
  const redirectParameter=raw.redirectParameter||'redirect_uri',stateParameter=raw.stateParameter||'state'
  if(!/^[\w-]{1,64}$/.test(redirectParameter)||!/^[\w-]{1,64}$/.test(stateParameter)||redirectParameter===stateParameter||[redirectParameter,stateParameter].some(v=>['novel_source','novel_flow'].includes(v)))fail(400,'授权入口参数名称无效')
  return {protocol:'fragment-v1',authorizeUrl:url.href,parameters,cookie:raw.cookie===true,redirectParameter,stateParameter}
}

export function createSourceAuthorization({resolve,profile,now=Date.now}){
  const flows=new Map(),ttl=10*60_000
  function prune(){for(const [key,flow]of flows)if(flow.expiresAt<=now())flows.delete(key)}
  const key=(owner,id)=>JSON.stringify([owner,id])
  function valid(owner,s,flowId){
    prune();const flow=flows.get(key(owner,s.id))
    if(!flow||flow.id!==flowId)fail(410,'授权已过期或已取消，请重新开始')
    flow.active()
    const current=resolve(owner,s.id)
    if(current.version!==flow.version)fail(409,'书源规则已变化，请重新授权')
    return flow
  }
  return {
    begin(owner,s,origin,active){
      prune();if(!s.login?.authorization)fail(409,'此书源未声明自动回传，请保存一次密钥后复用')
      active();const previous=flows.get(key(owner,s.id))
      if(previous&&['waiting','received'].includes(previous.status)&&previous.version===s.version){try{previous.active();return {id:previous.id,url:previous.url,expiresAt:previous.expiresAt,status:previous.status}}catch{flows.delete(key(owner,s.id))}}
      if(flows.size>=1024)fail(429,'授权任务较多，请稍后重试')
      const state=randomBytes(32).toString('hex'),id=randomBytes(16).toString('hex'),contract=s.login.authorization,url=new URL(contract.authorizeUrl)
      url.searchParams.set(contract.redirectParameter,new URL('/source-auth-callback',origin).href)
      url.searchParams.set(contract.stateParameter,state)
      // The provider also needs the public source identity in its response.
      url.searchParams.set('novel_source',s.id)
      url.searchParams.set('novel_flow',id)
      const flow={id,state:digest(state),url:url.href,owner,version:s.version,status:'waiting',expiresAt:now()+ttl,active}
      flows.set(key(owner,s.id),flow)
      return {id,url:flow.url,expiresAt:flow.expiresAt,status:flow.status}
    },
    status(owner,s,flowId){const flow=valid(owner,s,flowId);return {id:flow.id,status:flow.status,expiresAt:flow.expiresAt}},
    cancel(owner,s,flowId){const flow=flows.get(key(owner,s.id));if(!flowId||flow?.id===flowId)flows.delete(key(owner,s.id));return {cancelled:true}},
    finish(owner,s,flowId){const flow=flows.get(key(owner,s.id));if(flow?.id===flowId)flow.status='saved'},
    complete(owner,s,input,active){
      active();const flow=valid(owner,s,input.flowId),contract=s.login?.authorization
      if(!contract||typeof input.state!=='string'||!/^[a-f0-9]{64}$/.test(input.state)||digest(input.state)!==flow.state)fail(403,'授权回执不匹配，请重新授权')
      const values=input.params||{}
      if(typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(k=>!Object.hasOwn(contract.parameters,k)))fail(400,'回传了未声明的授权参数')
      const params={}
      for(const [remote,local]of Object.entries(contract.parameters)){const value=values[remote];if(typeof value!=='string'||!value.trim()||value.length>8192)fail(400,'授权回执缺少有效参数');params[local]=value}
      if(input.cookie&&!contract.cookie)fail(400,'此书源没有声明 Cookie 回传')
      if(input.cookie!==undefined&&(typeof input.cookie!=='string'||input.cookie.length>16384))fail(400,'授权 Cookie 格式错误')
      if(contract.cookie&&!Object.keys(params).length&&!input.cookie)fail(400,'授权回执缺少 Cookie')
      const fingerprint=digest(JSON.stringify([params,input.cookie||'']))
      if(flow.status==='saved'||flow.status==='received'){if(flow.fingerprint!==fingerprint)fail(409,'该回执已使用，请重新开始授权');return {saved:true,replayed:true}}
      const p=profile(owner,s,()=>{active();flow.active();if(resolve(owner,s.id).version!==flow.version)fail(409,'书源规则已变化，请重新授权')})
      p.save({params,cookie:input.cookie,method:'callback',savedAt:now()})
      flow.status='received';flow.fingerprint=fingerprint
      return {saved:true,replayed:false}
    },
  }
}
