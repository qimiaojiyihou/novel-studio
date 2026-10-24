import {parentPort} from 'node:worker_threads'
import {newQuickJSAsyncWASMModule,RELEASE_ASYNC} from 'quickjs-emscripten'

const module=await newQuickJSAsyncWASMModule(RELEASE_ASYNC)
const runtime=module.newRuntime()
runtime.setMemoryLimit(32*1024*1024);runtime.setMaxStackSize(512*1024)
let sequence=0
const pending=new Map()
// Only these fixed application messages cross the sandbox boundary. Never
// forward arbitrary thrown values: source scripts may contain private tokens.
const publicFailures=new Map([
  ['本章为付费或锁定章节，请在番茄官方客户端阅读',['SOURCE_CHAPTER_LOCKED','原站未开放本章完整网页正文，仅返回预览。请到原站或官方客户端查看；这不是脚本资源超限，也不代表登录后一定可读。']],
  ['番茄字体映射已变化，已停止展示乱码正文',['SOURCE_GLYPH_CHANGED','原站字体映射发生变化，已停止展示乱码正文，请等待书源规则更新。']],
  ['番茄章节身份不匹配或正文缺失',['SOURCE_CHAPTER_MISMATCH','原站返回的章节身份不匹配或正文缺失，本次未更新阅读内容。']],
  ['番茄正文为空，可能需要登录、验证或已下架',['SOURCE_CONTENT_MISSING','原站没有返回公开正文，可能需要验证或章节已下架。']],
  ['番茄正文解析为空',['SOURCE_CONTENT_MISSING','原站正文解析为空，本次未更新阅读内容。']],
  ['番茄页面缺少章节状态，可能需要验证或网页结构已变化',['SOURCE_STATE_INVALID','原站页面缺少章节状态，可能需要验证或网页结构已经变化。']],
  ['番茄章节状态不完整',['SOURCE_STATE_INVALID','原站章节状态不完整，请稍后重试。']],
])
parentPort.on('message',async message=>{
  if(message.type==='reply'){const item=pending.get(message.id);if(item){pending.delete(message.id);item(message)}return}
  if(message.type!=='run')return
  const {job,code,variables,source,library}=message
  const vm=runtime.newContext()
  let deadline=Date.now()+350,ioError=null,steps=0
  runtime.setInterruptHandler(()=>Date.now()>deadline||++steps>15000)
  const bridge=vm.newAsyncifiedFunction('__bridge',async(methodHandle,argsHandle)=>{
    const method=vm.getString(methodHandle),args=JSON.parse(vm.getString(argsHandle)),start=Date.now(),id=++sequence
    const response=await new Promise(resolve=>{pending.set(id,resolve);parentPort.postMessage({type:'bridge',job,id,method,args})})
    deadline+=Date.now()-start
    if(response.error){ioError=response.error;return vm.newString(JSON.stringify({error:response.error.message}))}
    return vm.newString(JSON.stringify({value:response.value??null}))
  })
  vm.setProp(vm.global,'__bridge',bridge);bridge.dispose()
  try{
    const bootstrap=`
      function rpc(method,...args){const r=JSON.parse(__bridge(method,JSON.stringify(args)));if(r.error)throw Error(r.error);return r.value}
      function response(value){return {body:()=>value.text,header:name=>{const v=value.headers?.[String(name).toLowerCase()];return Array.isArray(v)?v.join('; '):v||''},cookie:name=>value.cookies?.[String(name)]||''}}
      function elements(values){const a=values.map(html=>({html,textContent:rpc('element.text',html),toString(){return this.html},toJSON(){return {__element:this.html}},text(){return rpc('element.text',this.html)},attr(name){return rpc('element.attr',this.html,name)},select(rule){return elements(rpc('element.select',this.html,rule))}}));a.toArray=()=>a;return a}
      globalThis.java={
        ajax:(url)=>rpc('java.ajax',String(url)),
        post:(url,body,headers)=>response(rpc('java.request',String(url),'POST',String(body),headers||{})),
        put:(key,value)=>rpc('java.put',String(key),value),get:(...args)=>args.length===1&&!/^https?:|^\\//.test(String(args[0]))?rpc('java.get',String(args[0])):response(rpc('java.request',String(args[0]),'GET','',args[1]||{})),
        getCookie:(url,name)=>rpc('java.getCookie',String(url),String(name||'')),getVerificationCode:url=>rpc('java.getVerificationCode',String(url)),
        getElement:rule=>elements(rpc('java.getElement',String(rule))),getString:rule=>rpc('java.getString',String(rule)),
        setContent:value=>rpc('java.setContent',String(value)),
        toast:value=>rpc('java.toast',String(value)),longToast:value=>rpc('java.toast',String(value)),
        log:value=>rpc('java.log',String(value)),md5Encode:value=>rpc('java.md5Encode',String(value)),
        aesDecryptToString:(value,key)=>rpc('java.aesDecryptToString',String(value),String(key)),
        startBrowserAwait:(url,label)=>rpc('java.startBrowserAwait',String(url),String(label||'')),
        androidId:()=>'',base64Encode:value=>rpc('java.base64Encode',String(value)),base64Decode:value=>rpc('java.base64Decode',String(value)),
        hexDecodeToString:value=>rpc('java.hexDecodeToString',String(value)),encodeURI:(value,charset)=>rpc('java.encodeURI',String(value),String(charset||'utf-8')),
        timeFormat:value=>rpc('java.timeFormat',Number(value))
      };
      globalThis.cookie={getCookie:url=>rpc('cookie.getCookie',String(url)),setCookie:(url,value)=>rpc('cookie.setCookie',String(url),String(value)),removeCookie:url=>rpc('cookie.removeCookie',String(url))};
      globalThis.source=Object.assign(${JSON.stringify(source)}, {getKey(){return this.bookSourceUrl},getLoginInfoMap:()=>rpc('source.getLoginInfoMap'),getVariable:()=>rpc('source.getVariable'),setVariable:value=>rpc('source.setVariable',value)});
      Object.assign(globalThis,${JSON.stringify(variables)});
    `
    vm.unwrapResult(await vm.evalCodeAsync(bootstrap)).dispose()
    if(library)vm.unwrapResult(await vm.evalCodeAsync(library)).dispose()
    const result=await vm.evalCodeAsync(code)
    if(result.error){const error=vm.dump(result.error);result.error.dispose();throw Error(error.message||'脚本执行失败')}
    vm.setProp(vm.global,'__output',result.value);result.value.dispose()
    const serialized=vm.unwrapResult(await vm.evalCodeAsync('JSON.stringify(__output === undefined ? null : __output)'))
    const dumped=JSON.parse(vm.getString(serialized));serialized.dispose()
    if(JSON.stringify(dumped??null).length>2*1024*1024)throw Error('脚本输出超过限制')
    parentPort.postMessage({type:'done',job,value:dumped})
  }catch(error){
    const known=publicFailures.get(error.message),limited=/interrupt|memory|alloc/i.test(error.message)||error.message==='脚本输出超过限制'
    parentPort.postMessage({type:'done',job,error:ioError||{status:422,code:known?.[0]||(limited?'SCRIPT_LIMIT':'SCRIPT_ERROR'),message:known?.[1]||(limited?'书源脚本超过执行或内存限制，已停止本次操作。':'书源规则执行出错，请检查规则与原站响应。'),phase:known?'content':'script'}})
  }
  finally{vm.dispose()}
})
