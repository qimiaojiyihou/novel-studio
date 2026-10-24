import JSON5 from 'json5'
import {sourceURL,checkSourceOrigin,sourceHeaders,privateSourceHeaders} from './source-fetch.js'
import {fail} from './store.js'

// A URL with Legado request options is data, not a URL to be sent verbatim.
export function sourceRequest(value,source,base=source.url,extra={}){
  let raw=String(value).trim(),options={},at=raw.search(/,\s*\{/)
  if(at>=0){try{options=JSON5.parse(raw.slice(at+1));raw=raw.slice(0,at)}catch{fail(400,'书源请求选项格式错误')}}
  options={...validateRequestOptions(options),...validateRequestOptions(extra)}
  const url=sourceURL(raw,base);checkSourceOrigin(url,source.url,source.allowedOrigins)
  const method=String(options.method||'GET').toUpperCase()
  if(!['GET','POST'].includes(method))fail(400,'仅支持 GET / POST 书源请求')
  if(method==='GET'&&options.body)fail(400,'GET 请求应将参数放在地址中')
  const headers={},credentials={}
  for(const [key,value]of Object.entries(options.headers||{})){if(['cookie','authorization','x-api-key'].includes(key.toLowerCase())){if(value)credentials[key]=value}else headers[key]=value}
  sourceHeaders(headers,source.url,source.allowedOrigins);privateSourceHeaders(credentials)
  if(Object.keys(credentials).length&&url.origin!==sourceURL(source.url).origin)fail(400,'私有请求头仅用于原书源来源')
  const canonical={...options,...(options.method?{method}:{} )}
  return {url:url.href,options:canonical,headers,credentials,link:url.href+(Object.keys(canonical).length?','+JSON.stringify(canonical):'')}
}
export function validateRequestOptions(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['method','body','charset','headers','webView','webJs'].includes(k)))fail(400,'书源请求选项未支持')
  if(options.webView!==undefined&&typeof options.webView!=='boolean')fail(400,'webView 应为布尔值')
  if(options.webJs!==undefined&&(typeof options.webJs!=='string'||options.webJs.length>30000))fail(400,'webJs 应为至多 30000 字符的脚本')
  if(options.body!==undefined&&(typeof options.body!=='string'||options.body.length>100000))fail(400,'请求正文格式错误或超过限制')
  if(options.charset!==undefined&&!['utf-8','utf8','gbk','gb2312','gb18030'].includes(String(options.charset).toLowerCase()))fail(400,'书源字符编码暂未支持')
  return options
}
