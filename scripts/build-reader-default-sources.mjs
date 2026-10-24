// Build a credential-free global catalog. Unsupported entries retain only
// public identity + diagnostics, never executable raw rules or login secrets.
import fs from 'node:fs'
import JSON5 from '../reader-service/node_modules/json5/lib/index.js'
import {normalizeSource} from '../reader-service/source-rules.js'
import {sourceURL,sourceIdentity} from '../reader-service/source-fetch.js'
import {digest} from '../reader-service/store.js'
import previousHealth from '../docs/reader-source-health-2026-10-15.json' with {type:'json'}
import {parse} from '../reader-service/node_modules/acorn/dist/acorn.mjs'

export function hasEmbeddedCredentials(raw){
  const secret=/^(?:cookie|authorization|proxy-authorization|api[_-]?key|access[_-]?token|password|sign_key)$/i
  const literal=node=>node?.type==='Literal'&&typeof node.value==='string'&&node.value.trim().length>0||node?.type==='TemplateLiteral'&&!node.expressions.length&&node.quasis.some(q=>q.value.cooked?.trim())
  const inspectCode=code=>{
    let ast;try{ast=parse(code,{ecmaVersion:2022})}catch{return false}
    const pending=[ast]
    while(pending.length){const n=pending.pop()
      if(n.type==='Property'&&secret.test(n.key.name??n.key.value)&&literal(n.value))return true
      if(n.type==='AssignmentExpression'&&secret.test(n.left.name??n.left.property?.name??'')&&literal(n.right))return true
      if(n.type==='VariableDeclarator'&&secret.test(n.id.name||'')&&literal(n.init))return true
      if(n.type==='CallExpression'&&n.callee.object?.name==='cookie'&&n.callee.property?.name==='setCookie'&&literal(n.arguments[1]))return true
      for(const value of Object.values(n)){if(Array.isArray(value))pending.push(...value.filter(v=>v?.type));else if(value?.type)pending.push(value)}
    }
    return false
  }
  const walk=value=>{
    if(typeof value==='string'){
      const scripts=[...value.matchAll(/<js>([\s\S]*?)<\/js>/g)].map(m=>m[1]);if(value.trim().startsWith('@js:'))scripts.push(value.trim().slice(4))
      if(!scripts.length&&/\b(?:java|cookie|source)\./.test(value))scripts.push(value)
      return scripts.some(inspectCode)
    }
    if(!value||typeof value!=='object')return false
    return Object.entries(value).some(([k,v])=>secret.test(k)&&typeof v==='string'&&v.trim()||walk(v))
  }
  return !!walk({header:raw.header,searchUrl:raw.searchUrl,ruleSearch:raw.ruleSearch,ruleBookInfo:raw.ruleBookInfo,ruleToc:raw.ruleToc,ruleContent:raw.ruleContent,loginUrl:raw.loginUrl,jsLib:raw.jsLib,loginCheckJs:raw.loginCheckJs,comment:raw.bookSourceComment})
}

// Default catalogs never distribute shared signing/decryption keys. Convert
// literal key assignments into per-account fields, without keeping the values.
export function credentialTemplate(raw){
  const result=structuredClone(raw),fields=new Set()
  const adapt=code=>{
    let ast;const validation=code.replace(/\{\{[\s\S]*?\}\}/g,m=>'0'.padEnd(m.length,' '))
    try{ast=parse(validation,{ecmaVersion:2022})}catch{return code}
    const changes=[],nodes=[ast]
    while(nodes.length){const n=nodes.pop()
      let name,node
      if(n.type==='AssignmentExpression'&&n.left.type==='Identifier'){name=n.left.name;node=n.right}
      if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'){name=n.id.name;node=n.init}
      if(name==='sign_key'&&node?.type==='Literal'&&typeof node.value==='string'&&node.value){fields.add(name);changes.push([node.start,node.end,`source.getLoginInfoMap().${name}`])}
      if(n.type==='CallExpression'&&n.callee.name==='SecretKeySpec'){
        const expr=n.arguments[0],string=expr?.callee?.object,argument=string?.arguments?.[0]
        if(expr?.callee?.property?.name==='getBytes'&&string?.callee?.name==='String'&&argument?.type==='Literal'&&typeof argument.value==='string'){fields.add('content_key');changes.push([argument.start,argument.end,'source.getLoginInfoMap().content_key'])}
      }
      for(const value of Object.values(n)){if(Array.isArray(value))nodes.push(...value.filter(v=>v?.type));else if(value?.type)nodes.push(value)}
    }
    for(const [start,end,value]of changes.sort((a,b)=>b[0]-a[0]))code=code.slice(0,start)+value+code.slice(end)
    return code
  }
  const visit=value=>{
    if(typeof value==='string'){
      if(value.trim().startsWith('@js:'))return value.replace(/(@js:)([\s\S]*)/,(_,prefix,code)=>prefix+adapt(code))
      return value.replace(/<js>([\s\S]*?)<\/js>/g,(_,code)=>'<js>'+adapt(code)+'</js>')
    }
    if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=visit(value[key])
    return value
  }
  visit(result)
  if(fields.size){let ui=[];try{ui=typeof result.loginUi==='string'?JSON.parse(result.loginUi):result.loginUi||[]}catch{}
    result.loginUi=[...ui,...[...fields].filter(name=>!ui.some(f=>f.name===name)).map(name=>({name,type:'password'}))];result.novelStudioLoginRequired=true
  }
  return result
}

export function buildDefaultCatalog(inputs,previous,{name='原书源文件 + 71e56d4f.json + FQWeb 模板',restoreMissing=false,freshRules=false}={}){
  const sources=new Map(),duplicates=[],unavailable=[],managedSourceVersions={...previous.managedSourceVersions}
  const old=new Map(previous.sources.map(s=>[s.id,s]))
  const retired=new Set(previousHealth.removed.map(s=>s.id))
  for(const s of previous.sources)managedSourceVersions[s.id]=[...new Set([...(managedSourceVersions[s.id]||[]),s.version])]
  let index=0
  for(const input of inputs)for(const raw of input){
    index++;let normalized
    const safe=credentialTemplate(raw)
    if(safe?.header){try{const headers=typeof safe.header==='string'?JSON5.parse(safe.header):safe.header;for(const key of Object.keys(headers))if(['cookie','authorization','proxy-authorization'].includes(key.toLowerCase()))delete headers[key];safe.header=JSON.stringify(headers)}catch{/* An invalid dynamic header becomes an unavailable entry below. */}}
    try{
      if(hasEmbeddedCredentials(safe))throw Object.assign(Error('规则含内置登录凭据，请使用本人登录配置后单独导入'),{status:400,code:'CREDENTIAL_CONFIGURATION_REQUIRED'})
      normalized=normalizeSource(safe)
    }catch(error){
      const name=String(raw?.bookSourceName||'未命名').slice(0,100);let url='',identity=''
      try{identity=sourceIdentity(raw?.bookSourceUrl);const request=sourceURL(raw.bookSourceUrl);url=request.pathname==='/'&&!request.search?request.origin:request.href}catch{/* Keep a visible metadata-only placeholder for malformed addresses. */}
      const id=digest(identity||'invalid-source:'+String(raw?.bookSourceUrl||name)).slice(0,32)
      const unsupported={reason:error.status?error.message:'书源规则需要修复',code:error.code||'SOURCE_INVALID',...(error.field?{field:error.field}:{})}
      if(!url&&/FQWeb/i.test(name)){unsupported.reason='待配置 FQWeb 服务地址：此文件是模板，尚未提供实际服务端地址';unsupported.code='SOURCE_CONFIGURATION_REQUIRED'}
      const existing=old.get(id)
      normalized=!freshRules&&existing&&!existing.unsupported?existing:{id,name,url,...(identity&&identity!==url?{identity}:{}),enabled:true,rules:{},warnings:['待兼容条目，仅登记信息，未运行原始规则'],unsupported}
      if(!normalized.version)normalized.version=digest(JSON.stringify(normalized))
    }
    if(!freshRules&&normalized.url&&retired.has(digest(new URL(normalized.url).origin).slice(0,32))){normalized={id:normalized.id,name:normalized.name,url:normalized.url,...(normalized.identity?{identity:normalized.identity}:{}),enabled:true,rules:{},warnings:['历史检测异常，保留登记信息'],unsupported:{code:'SOURCE_PREVIOUSLY_UNREACHABLE',reason:'此前多次域名解析失败，需核实站点并重新导入规则'}};normalized.version=digest(JSON.stringify(normalized))}
    const existing=sources.get(normalized.id)
    if(existing){duplicates.push({index,name:normalized.name,reason:existing.unsupported||!normalized.unsupported?'同地址合并，采用最后一份兼容配置':'同地址合并，保留已有兼容配置'});if(!existing.unsupported&&normalized.unsupported)continue}
    sources.set(normalized.id,normalized)
  }
  for(const s of sources.values())if(s.unsupported)unavailable.push({id:s.id,name:s.name,...s.unsupported})
  const addedSourceIds=[...sources.keys()].filter(id=>!old.has(id)),upgradeFrom={}
  // Every supported upgrade path must include additions from intermediate
  // releases too, but never re-add an ID that belonged to that old catalog.
  for(const [version,ids]of Object.entries(previous.upgradeFrom||{}))upgradeFrom[version]=[...new Set([...ids,...addedSourceIds])].filter(id=>sources.has(id))
  upgradeFrom[previous.version]=addedSourceIds
  return {version:'global-all-sources-'+digest(JSON.stringify([...sources.values()])).slice(0,16),previousVersion:previous.version,applyToExisting:true,restoreMissing,managedSourceVersions,addedSourceIds,upgradeFrom,name,total:index,sources:[...sources.values()],rejected:[],unavailable,duplicates}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const args=process.argv.slice(2),options={},positional=[];let output
  for(let i=0;i<args.length;i++){
    if(args[i]==='--restore-missing')options.restoreMissing=true
    else if(args[i]==='--fresh-rules')options.freshRules=true
    else if(args[i]==='--name')options.name=args[++i]
    else if(args[i]==='--output')output=args[++i]
    else if(args[i].startsWith('--'))throw Error('Unknown option: '+args[i])
    else positional.push(args[i])
  }
  const [oldFile,previousFile,...files]=positional
  if(!oldFile||!previousFile||!files.length)throw Error('Usage: node build-reader-default-sources.mjs original.json previous-pack.json additional.json')
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))
  const content=JSON.stringify(buildDefaultCatalog([read(oldFile),...files.map(read)],read(previousFile),options),null,2)+'\n'
  if(output)fs.writeFileSync(output,content);else process.stdout.write(content)
}
