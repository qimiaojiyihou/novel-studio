import JSON5 from 'json5'
import {createHash,createDecipheriv} from 'node:crypto'
import iconv from 'iconv-lite'
import {runSourceScript} from './source-script.js'
import {checkExpression,textExpression} from './source-expression.js'
import {sourceURL,sourceHeaders,privateSourceHeaders,checkSourceOrigin} from './source-fetch.js'
import {document,checkedDocument,ruleList,ruleText,contentText,searchRequest,scriptRule,embeddedScript,splitRule,replacement,putDirective} from './source-rules.js'
import {putSourceValue} from './source-state.js'
import {fail} from './store.js'
import {sourceRequest} from './source-request.js'
import {renderSourcePage} from './source-browser.js'

export function virtualPayload(url,s){
  if(!s.virtualChapters||!/^data:;base64,[A-Za-z0-9+/=]{1,512},\s*\{"type":"pyfqc"\}$/.test(url))return null
  const value=Buffer.from(url.slice(13,url.indexOf(',{')),'base64').toString()
  if(!/^\d{1,40}$/.test(value))fail(400,'虚拟章节标识错误')
  return Buffer.from(value).toString('hex')
}
export function createSourceRuntime(s,{fetchPage,profile,signal,active,renderPage=renderSourcePage}){
  let book={origin:s.identity||s.url},requests=0,message='',selectedChapter='',hasBook=false,resolvingHeaders=false
  let values={book:{},chapters:{},toc:null}
  const transientValues={}
  const variablesFor=context=>selectedChapter?(values.chapters[selectedChapter]||={}):context?.sourceValues||(hasBook?values.book:transientValues)
  function getValue(context,key){
    if(['__proto__','constructor','prototype'].includes(key))return ''
    if(key==='bookName')return book.name||''
    if(key==='title')return book.durChapterTitle||''
    const scopes=[variablesFor(context),values.book,context?.sourceValues,transientValues]
    for(const scope of scopes)if(scope&&Object.hasOwn(scope,key))return scope[key]
    return ''
  }
  const credentialVersion=()=>JSON.stringify([profile.read().params||{},profile.cookieJar.getCookieString(s.url),profile.read().variable||''])
  function loginError(error,version){
    if(error.httpStatus!==401&&!['LOGIN_PAGE','BROWSER_VERIFICATION_REQUIRED'].includes(error.code)&&!(error.httpStatus===403&&s.login?.required))return error
    active()
    const state=profile.read(),saved=Object.values(state.params||{}).some(Boolean)||profile.cookieJar.getCookieString(s.url)||!!state.variable
    if(saved&&(!version||version===credentialVersion()))profile.mutate(current=>{current.authorization={...current.authorization,status:'expired',version:s.version}})
    return Object.assign(new Error(saved?'书源登录已过期，请打开此书源的登录配置重新验证':'此书源需要登录，请打开登录配置后继续'),{status:422,code:'SOURCE_LOGIN_REQUIRED',sourceId:s.id,loginRequired:true,phase:'login'})
  }
  const metadata=context=>({baseUrl:context.baseUrl,sourceUrl:s.url,runtimeSource:s,book:{...book,...context.book}})
  const adopt=(value,context)=>Array.isArray(value)?value.map(v=>typeof v?.__regex==='string'&&Array.isArray(v.captures)?{raw:v.__regex,captures:v.captures,...metadata(context)}:v?.__element?document(v.__element,metadata(context)):v&&typeof v==='object'?{json:v,...metadata(context)}:document(String(v??''),metadata(context))):[document(typeof value==='object'?JSON.stringify(value):String(value??''),metadata(context))]
  const address=(value,base=s.url)=>{const u=sourceURL(String(value),base);checkSourceOrigin(u,s.url,s.allowedOrigins);return u.href}
  async function request(value,options={}){
    active();signal.throwIfAborted();if(++requests>30)fail(422,'单次书源操作超过 30 次网页请求')
    const {baseUrl,signal:childSignal,...extra}=options,requestSignal=childSignal?AbortSignal.any([signal,childSignal]):signal,parsed=sourceRequest(value,s,baseUrl||s.url,extra),opts=parsed.options,url=parsed.url
    const method=String(opts.method||'GET').toUpperCase();if(!['GET','POST'].includes(method))fail(400,'仅支持 GET / POST 书源请求')
    let dynamic={}
    if(s.headerScript&&!resolvingHeaders){
      resolvingHeaders=true
      try{dynamic=await script(s.headerScript,document('',{baseUrl:url}),'');if(typeof dynamic==='string')dynamic=JSON5.parse(dynamic);if(!dynamic||typeof dynamic!=='object'||Array.isArray(dynamic)||Object.keys(dynamic).length>16)fail(400,'请求头脚本应返回最多 16 项的对象')}
      catch(error){if(error.code==='SOURCE_LOGIN_REQUIRED')throw error;throw Object.assign(new Error('动态请求头生成失败，请检查书源登录配置'),{status:422,code:'HEADER_SCRIPT_ERROR',sourceId:s.id})}
      finally{resolvingHeaders=false}
    }
    const secret={},publicHeaders={}
    for(const [key,value]of Object.entries(dynamic))(['cookie','authorization','x-api-key'].includes(key.toLowerCase())?secret:publicHeaders)[key]=value
    const headers={...s.headers,...sourceHeaders(publicHeaders,s.url,s.allowedOrigins),...parsed.headers},credentialHeaders=privateSourceHeaders({...secret,...parsed.credentials})
    const version=credentialVersion()
    try{
      let loaded=await fetchPage(url,{scope:s.url,allowedOrigins:s.allowedOrigins,headers,credentialHeaders,method,body:String(opts.body||''),charset:opts.charset||'',cookieJar:profile.cookieJar,signal:requestSignal})
      if(opts.webView||opts.webJs)loaded=await renderPage({initial:loaded,source:s,signal:requestSignal,cookieJar:profile.cookieJar,webJs:opts.webJs||'',fetchResource:(url,options,renderSignal)=>request(url,{...options,signal:renderSignal})})
      return {...loaded,credentialVersion:version}
    }catch(error){throw loginError(error,version)}
  }
  async function script(code,context,result,variables={}){
    let current=context,lastElements=null
    const bridge=async(method,args)=>{
      active();signal.throwIfAborted()
      const [a,b,c,d]=args
      switch(method){
        case 'java.ajax':return (await request(a,{baseUrl:current.baseUrl})).text
        case 'java.request':{const loaded=await request(a,{method:b,body:c,headers:d,baseUrl:current.baseUrl}),cookies=Object.fromEntries(profile.cookieJar.getCookieString(loaded.url).split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const at=p.indexOf('=');return [p.slice(0,at),p.slice(at+1)]}));return {text:loaded.text,headers:loaded.headers||{},cookies}}
        case 'java.getCookie':{const pairs=profile.cookieJar.getCookieString(address(a,current.baseUrl)).split(';').map(p=>p.trim());return b?(pairs.find(p=>p.startsWith(b+'='))||'').slice(b.length+1):pairs.join('; ')}
        case 'java.getVerificationCode':throw Object.assign(new Error('此书源搜索需要人工验证码，请在原站完成验证后保存登录配置'),{status:422,code:'BROWSER_VERIFICATION_REQUIRED',openUrl:address(a,current.baseUrl),phase:'login'})
        case 'java.put':return putSourceValue(variablesFor(current),a,b)
        case 'java.get':return getValue(current,a)
        case 'source.getLoginInfoMap':return profile.read().params
        case 'source.getVariable':return profile.read().variable
        case 'source.setVariable':profile.mutate(state=>{state.variable=a});return a
        case 'java.getElement':lastElements=ruleList(current,a).map(row=>row.$?row.$.html(row.root):row.raw||'');return lastElements
        case 'java.getString':return ruleText(current,a)
        case 'java.setContent':current=document(a,metadata(current));return null
        case 'element.text':return ruleText(document(a),'text')
        case 'element.attr':return document(a).$('body').children().first().attr(b)||''
        case 'element.select':return ruleList(document(a),b).map(row=>row.$.html(row.root))
        case 'java.toast':message=String(a).slice(0,300);return null
        case 'java.log':return null
        case 'java.md5Encode':return createHash('md5').update(String(a)).digest('hex')
        case 'java.aesDecryptToString':{const value=Buffer.from(a,'base64'),key=Buffer.from(b);if(![16,24,32].includes(key.length)||value.length<=16||value.length>2*1024*1024)fail(422,'AES 数据或账号密钥格式错误');try{const cipher=createDecipheriv(`aes-${key.length*8}-cbc`,key,value.subarray(0,16));return Buffer.concat([cipher.update(value.subarray(16)),cipher.final()]).toString('utf8')}catch{fail(422,'AES 解码未通过，请核对账号密钥及源站响应')}}
        case 'java.startBrowserAwait':{const url=new URL(address(a,current.baseUrl));url.search='';throw Object.assign(new Error('此书源需要在原站完成登录或人机验证；完成后保存该书源 Cookie 再重试'),{status:422,code:'BROWSER_VERIFICATION_REQUIRED',openUrl:url.href,phase:'login'})}
        case 'cookie.getCookie':address(a);return profile.cookieJar.getCookieString(address(a))
        case 'cookie.setCookie':profile.setCookies(address(a),[b]);return null
        case 'cookie.removeCookie':if(new URL(address(a)).hostname!==new URL(s.url).hostname)fail(400,'Cookie 域名不匹配');profile.clearCookies();return null
        case 'java.base64Encode':return Buffer.from(a).toString('base64')
        case 'java.base64Decode':return Buffer.from(a,'base64').toString()
        case 'java.hexDecodeToString':return Buffer.from(a,'hex').toString()
        case 'java.encodeURI':if(!['utf-8','utf8','gbk','gb2312','gb18030'].includes(b.toLowerCase()))fail(400,'编码未支持');return [...iconv.encode(a,b)].map(n=>'%'+n.toString(16).padStart(2,'0')).join('')
        case 'java.timeFormat':return Number.isFinite(a)&&Math.abs(a)<8640000000000000?new Date(a).toISOString():''
        default:fail(422,'书源调用了尚未实现的脚本接口')
      }
    }
    const vars={result,baseUrl:context.baseUrl||s.url,book:{...book,...context.book},title:context.book?.durChapterTitle||book.durChapterTitle||'',...variables}
    const value=await runSourceScript({code,library:s.login?.library||'',variables:vars,source:{bookSourceUrl:s.identity||s.url,bookSourceComment:s.comment||'',loginUrl:s.login?.script||s.login?.url||''}},bridge,signal)
    return value??lastElements?.map(html=>({__element:html}))??null
  }
  async function template(value,context,vars={}){
    const parts=[...value.matchAll(/\{\{([\s\S]*?)\}\}/g)];let result=value
    for(const part of parts){let v;if(part[1]==='key')v=encodeURIComponent(vars.key||'');else if(/^(?:\$|@@)/.test(part[1]))v=ruleText(context,part[1].replace(/^@@/,''));else {try{v=textExpression(part[1],{baseUrl:context.baseUrl,result:context.raw||'',...vars,book:{...book,...context.book}})}catch{v=await script(part[1],context,'',vars)}}result=result.replace(part[0],String(v??''))}
    return result
  }
  async function scriptTemplate(code,context){
    let quote='',escaped=false,cursor=0,out=''
    for(const part of code.matchAll(/\{\{([\s\S]*?)\}\}/g)){
      const prefix=code.slice(cursor,part.index);out+=prefix
      for(const char of prefix){if(escaped){escaped=false;continue}if(char==='\\'){escaped=true;continue}if(quote){if(char===quote)quote=''}else if(['"',"'",'`'].includes(char))quote=char}
      const value=/^(?:\$|@@)/.test(part[1])?ruleText(context,part[1].replace(/^@@/,'')):await template(part[0],context)
      const encoded=JSON.stringify(String(value??''))
      out+=quote?encoded.slice(1,-1).replace(/'/g,"\\'").replace(/`/g,'\\`').replace(/\$\{/g,'\\${'):encoded
      cursor=part.index+part[0].length
    }
    return out+code.slice(cursor)
  }
  function expandReplacement(expression,context){
    const values={'book.name':context.book?.name||book.name||'','book.durChapterTitle':context.book?.durChapterTitle||book.durChapterTitle||'',title:context.book?.durChapterTitle||book.durChapterTitle||''}
    return expression.replace(/\{\{(book\.name|book\.durChapterTitle|title)\}\}/g,(_,key)=>String(values[key]).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
  }
  async function transform(context,rule,list=false,depth=0){
    if(depth>32)fail(422,'规则流水线层数超过限制')
    rule=rule.trim().replace(/^@json:/i,'').replace(/(?<!\{)\{(\$[.\[][^{}]+)\}(?!\})/g,'{{$1}}')
    const directive=rule.indexOf('@put:')>=0&&(!/<js>|@js:/.test(rule)||rule.indexOf('@put:')<rule.search(/<js>|@js:/))?putDirective(rule):null
    if(directive){
      const before=directive.before?await transform(context,directive.before,list,depth+1):null
      for(const [key,expression]of Object.entries(directive.entries))putSourceValue(variablesFor(context),key,await runtime.text(context,expression))
      if(directive.after)return transform(context,directive.after,list,depth+1)
      return before||{value:list?[context]:context.raw||'',context,plain:true}
    }
    if(rule.includes('@get:{')&&!/<js>|@js:/.test(rule)){
      const parts=splitRule(rule,'##'),value=parts[0].replace(/@get:\{([\w\u0080-\uffff.-]{1,100})\}/g,(_,key)=>String(getValue(context,key)))
      return {value:parts.length>1?replacement(value,expandReplacement('##'+parts.slice(1).join('##'),context)):value,context}
    }
    const embedded=embeddedScript(rule)
    if(embedded){
      const result=embedded.before?(await transform(context,embedded.before,list)).value:context.raw||context.root?.toString()||JSON.stringify(context.json||'')
      const value=await script(await scriptTemplate(embedded.code,context),context,result)
      if(!embedded.after)return {value,context}
      // A replacement followed by another script is a pipeline, not one regex.
      if(embedded.after.startsWith('##')&&!/<js>|@js:/.test(embedded.after))return {value:replacement(String(value??''),expandReplacement(embedded.after,context)),context}
      if(embedded.after.includes('{{'))return transform({...context,raw:String(value??'')},embedded.after,list)
      return transform(adopt(value,context)[0],embedded.after,list,depth+1)
    }
    const js=scriptRule(rule)
    if(js){
      let result=js.before?(await transform(context,js.before,list)).value:(context.raw||context.root?.toString()||'')
      if(js.before.includes('&&')&&/result\s*\[/.test(js.code))result=splitRule(js.before,'&&').map(r=>ruleText(context,r))
      let value
      const code=await scriptTemplate(js.code,context)
      try{checkExpression(code);value=textExpression(code,{result,baseUrl:context.baseUrl,book:{...book,...context.book}})}catch(error){if(error.code!=='RULE_UNSUPPORTED')throw error;value=await script(code,context,result)}
      if(typeof value==='string'&&context.captures)value=value.replace(/\$(\d+)/g,(_,n)=>context.captures[n]||'')
      if(js.after)value=replacement(String(value??''),expandReplacement(js.after,context))
      return {value,context}
    }
    if(rule.includes('{{')){const segments=splitRule(rule,'##'),value=segments[0].includes('{{')?await template(segments[0],context):await runtime.text(context,segments[0]);return {value:segments.length>1?replacement(value,expandReplacement('##'+segments.slice(1).join('##'),context)):value,context}}
    return {value:list?ruleList(context,rule):ruleText(context,rule),context,plain:true}
  }
  const runtime={
    setBook(value,state){if(!hasBook||value.bookUrl&&book.bookUrl!==value.bookUrl)values={book:{},chapters:{},toc:null};hasBook=true;book={origin:s.identity||s.url,...value};selectedChapter='';if(state)values=structuredClone(state)},
    setChapter(id,title){selectedChapter=id;book.durChapterTitle=title},
    rowValues:context=>structuredClone(context.sourceValues||transientValues),
    state:()=>structuredClone(values),
    tocState:()=>structuredClone(values.toc||null),
    setTocState:value=>{values.toc=structuredClone(value)},
    setChapterValues(id,value){values.chapters[id]={...(values.chapters[id]||{}),...structuredClone(value)}},request,
    async search(key,page){
      if(s.search.minBytes&&iconv.encode(key,s.search.charset).length<s.search.minBytes)throw Object.assign(new Error(`此书源要求搜索词至少 ${s.search.minBytes} 个编码字节，请使用较长书名或作者名`),{status:400,code:'SEARCH_TERM_TOO_SHORT',phase:'search'})
      if(s.login?.required){const state=profile.read();if(!Object.values(state.params||{}).some(Boolean)&&!profile.cookieJar.getCookieString(s.url)&&!state.variable)throw loginError({code:'LOGIN_PAGE'})}
      if(!s.search.script){const req=searchRequest(s,key,page);return {...await request(req.url,{method:req.method,body:req.body,charset:req.charset,headers:req.headers,...(s.search.webView?{webView:true}:{}),...(s.search.webJs?{webJs:s.search.webJs}:{})}),source:s}}
      const ctx=document('',{baseUrl:s.url,sourceUrl:s.url}),value=await script(s.search.script,ctx,'',{key,page}),url=await template(String(value),ctx,{key,page})
      return {...await request(url),source:s}
    },
    async load(url){const payload=virtualPayload(url,s),loaded=selectedChapter&&s.scriptOnlyContent?{text:'',url:sourceRequest(url,s).url}:payload===null?await request(url,selectedChapter&&s.rules.ruleContent.webJs?{webView:true,webJs:s.rules.ruleContent.webJs}:{}):{text:payload,url:s.url};try{return {url:loaded.url,context:checkedDocument(loaded.text,{baseUrl:loaded.url,sourceUrl:s.url,runtimeSource:s,book,...(loaded.resourceError?{renderResourceError:loaded.resourceError}:{}),...(loaded.webJsOutput!==undefined?{webJsOutput:loaded.webJsOutput}:{})})}}catch(error){throw loginError(error,loaded.credentialVersion)}},
    checkDocument(value,context,version){try{return checkedDocument(value,context)}catch(error){throw loginError(error,version)}},
    async list(context,rule){const out=await transform(context,rule,true);return (out.plain?out.value:out.value===null?[]:adopt(out.value,out.context)).map(row=>({...metadata(context),...row,sourceValues:structuredClone(context.sourceValues||(hasBook?{}:transientValues)),runtimeSource:s}))},
    async text(context,rule=''){if(!rule)return '';const out=await transform(context,rule);return Array.isArray(out.value)?out.value.join('\n'):String(out.value??'')},
    async info(context,rules){const row=rules.init?(await runtime.list(context,rules.init))[0]||context:context;delete row.sourceValues;return row},
    async content(context,rules){
      if(context.webJsOutput===undefined&&!/<js>|@js:|\{\{|@get:|@put:/.test(JSON.stringify(rules))){const value=contentText(context,rules);if(!value&&context.renderResourceError)throw context.renderResourceError;return value}
      const expression=expandReplacement(rules.replaceRegex||'',context),value=context.webJsOutput!==undefined?ruleText(document(context.webJsOutput),'html'):await runtime.text(context,rules.content)
      const replaced=expression?await runtime.text(document(value,metadata(context)),expression):value
      const output=replaced.replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();if(!output&&context.renderResourceError)throw context.renderResourceError;return output
    },
    async action(code){const ctx=document('',{baseUrl:s.url,sourceUrl:s.url});await script((s.login?.script||'')+'\n'+code,ctx,'');return {message:message||'操作已完成'}},
    async checkLogin(){
      if(!s.login?.checkScript)return null
      const value=await script((s.login.script||'')+'\n'+s.login.checkScript,document('',{baseUrl:s.url,sourceUrl:s.url}),'')
      if(typeof value!=='boolean')fail(422,'登录检查规则应返回 true 或 false；本次未确认授权有效性')
      return value
    },
  }
  return runtime
}
