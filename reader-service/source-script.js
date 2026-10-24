import {Worker} from 'node:worker_threads'
import {parse} from 'acorn'
import {unsupported} from './source-expression.js'

const workers=[],queue=[];let sequence=0
export function adaptSourceScript(code){
  // Only the exported AES/CBC helper is mapped, not arbitrary Java packages or
  // host reflection. The key expression remains inside the isolated script.
  if(!/\bJavaImporter\b/.test(code))return code
  const prefix=code.match(/var javaImport\s*=\s*new JavaImporter\(\);[\s\S]*?with\(javaImport\)\s*\{\s*function decode\(content\)\s*\{[\s\S]*?\n\s*\}\s*\n\s*\}/)
  const key=prefix?.[0].match(/SecretKeySpec\(String\(([\s\S]+?)\)\.getBytes\(\),\s*["']AES["']\)/)
  if(!prefix||!key||!prefix[0].includes('AES/CBC/PKCS5Padding')||!/Arrays\.copyOfRange\(ivEncData,\s*0,\s*16\)/.test(prefix[0]))throw unsupported('Java 加解密桥接只支持已识别的 AES/CBC 导出形状','script')
  return code.replace(prefix[0],`function decode(content){return java.aesDecryptToString(content,String(${key[1]}));}`)
}
export function validateScript(code){
  code=adaptSourceScript(code)
  if(code.length>30000)throw unsupported('脚本超过 30000 字符','script')
  let ast
  try{ast=parse(code,{ecmaVersion:2022})}catch{throw Object.assign(new Error('书源 JavaScript 语法错误'),{status:400,code:'SCRIPT_INVALID',phase:'parse'})}
  if(/\bimport\s*\(|\bimport\s|\bexport\s/.test(code))throw unsupported('脚本模块加载','script')
  const methods={java:new Set(['ajax','get','post','put','getCookie','getVerificationCode','getElement','getString','setContent','toast','longToast','log','md5Encode','aesDecryptToString','startBrowserAwait','androidId','base64Encode','base64Decode','hexDecodeToString','encodeURI','timeFormat']),cookie:new Set(['getCookie','setCookie','removeCookie'])},pending=[ast]
  while(pending.length){const node=pending.pop();if(node.type==='MemberExpression'&&!node.computed&&methods[node.object?.name]&&!methods[node.object.name].has(node.property.name))throw unsupported(`脚本接口 ${node.object.name}.${node.property.name}`,'script');for(const value of Object.values(node)){if(Array.isArray(value))pending.push(...value.filter(v=>v&&typeof v==='object'&&v.type));else if(value&&typeof value==='object'&&value.type)pending.push(value)}}
}
function pump(){
  while(queue.length){
    let slot=workers.find(w=>!w.busy)
    if(!slot){if(workers.length>=2)return;slot=createWorker();workers.push(slot)}
    const item=queue.shift();clearTimeout(item.queueTimer);item.signal?.removeEventListener('abort',item.queueAbort);if(item.signal?.aborted){item.reject(Object.assign(new Error('书源请求已取消'),{status:409,code:'CANCELLED'}));continue}
    slot.busy=true;slot.item=item;slot.worker.ref()
    const abort=()=>slot.fail(Object.assign(new Error('书源脚本已取消或超时'),{status:422,code:'SCRIPT_TIMEOUT',phase:'script'}))
    item.abort=abort;item.signal?.addEventListener('abort',abort,{once:true})
    item.timer=setTimeout(abort,40000)
    item.cpuTimer=setTimeout(abort,1500)
    slot.worker.postMessage({...item.input,type:'run',job:item.job})
  }
}
function createWorker(){
  const slot={worker:new Worker(new URL('./source-script-worker.js',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:96},execArgv:[]}),busy:false,item:null}
  slot.worker.unref()
  let completed=0
  function finish(error,value){const item=slot.item;if(!item)return;clearTimeout(item.timer);clearTimeout(item.cpuTimer);item.signal?.removeEventListener('abort',item.abort);slot.item=null;slot.busy=false;slot.worker.unref();if(++completed>=100){workers.splice(workers.indexOf(slot),1);slot.worker.terminate()}error?item.reject(error):item.resolve(value);pump()}
  slot.fail=error=>{const index=workers.indexOf(slot);if(index>=0)workers.splice(index,1);const item=slot.item;slot.item=null;slot.busy=false;slot.worker.terminate();if(item){clearTimeout(item.timer);clearTimeout(item.cpuTimer);item.signal?.removeEventListener('abort',item.abort);item.reject(error)}pump()}
  slot.worker.on('error',()=>slot.fail(Object.assign(new Error('隔离脚本运行失败'),{status:422,code:'SCRIPT_ERROR'})))
  slot.worker.on('exit',()=>{if(workers.includes(slot))slot.fail(Object.assign(new Error('隔离脚本进程已退出'),{status:422,code:'SCRIPT_ERROR'}))})
  slot.worker.on('message',async message=>{
    const item=slot.item;if(!item||message.job!==item.job)return
    if(message.type==='done'){finish(message.error?Object.assign(new Error(message.error.message),message.error):null,message.value);return}
    if(message.type==='bridge'){
      clearTimeout(item.cpuTimer)
      item.calls=(item.calls||0)+1
      if(item.calls>256){slot.fail(Object.assign(new Error('书源脚本接口调用超过限制'),{status:422,code:'SCRIPT_LIMIT',phase:'script'}));return}
      let response
      try{item.signal?.throwIfAborted();response={value:await item.bridge(message.method,message.args)}}catch(error){response={error:{status:error.status||422,code:error.code||'SCRIPT_BRIDGE_ERROR',message:error.status?error.message:'书源脚本接口执行失败',phase:error.phase||'script'}};for(const field of ['openUrl','httpStatus','targetOrigin','retryAfterSeconds'])if(error[field]!==undefined)response.error[field]=error[field]}
      if(slot.item===item){item.cpuTimer=setTimeout(item.abort,1000);slot.worker.postMessage({type:'reply',id:message.id,...response})}
    }
  })
  return slot
}
export function runSourceScript(input,bridge,signal){
  input={...input,code:adaptSourceScript(input.code),library:adaptSourceScript(input.library||'')}
  validateScript(input.code)
  if(queue.length>=12)throw Object.assign(new Error('脚本任务较多，请稍后重试'),{status:429,code:'SCRIPT_QUEUE_FULL'})
  return new Promise((resolve,reject)=>{const item={input,bridge,signal,job:++sequence,resolve,reject};item.queueAbort=()=>{const index=queue.indexOf(item);if(index<0)return;queue.splice(index,1);clearTimeout(item.queueTimer);signal?.removeEventListener('abort',item.queueAbort);reject(Object.assign(new Error('脚本排队已取消或超时'),{status:409,code:'CANCELLED'}))};queue.push(item);item.queueTimer=setTimeout(item.queueAbort,15000);signal?.addEventListener('abort',item.queueAbort,{once:true});if(signal?.aborted)item.queueAbort();pump()})
}
