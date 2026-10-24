// The callback credential lives only in a URL fragment / temporary form memory.
// Never put it in query strings, localStorage, logs or postMessage broadcasts.
export function parseAuthorizationReceipt(value){
  if(typeof value!=='string'||value.length>65536)throw Error('授权回执过长或格式错误')
  let result
  if(value.trim().startsWith('{'))result=JSON.parse(value)
  else{
    const fragment=value.includes('#')?value.slice(value.indexOf('#')+1):value.replace(/^#/,'')
    const p=new URLSearchParams(fragment)
    for(const key of p.keys())if(!['state','sourceId','flowId','params','cookie'].includes(key)||p.getAll(key).length!==1)throw Error('授权回执字段无效')
    result={state:p.get('state'),sourceId:p.get('sourceId'),flowId:p.get('flowId'),params:JSON.parse(p.get('params')||'{}'),...(p.has('cookie')?{cookie:p.get('cookie')}:{})}
  }
  if(!result||typeof result!=='object'||Array.isArray(result)||!/^[a-f0-9]{64}$/.test(result.state)||!/^[a-f0-9]{32}$/.test(result.flowId)||!/^[\w-]{1,100}$/.test(result.sourceId)||!result.params||typeof result.params!=='object'||Array.isArray(result.params))throw Error('授权回执不完整，请重新登录')
  return result
}
