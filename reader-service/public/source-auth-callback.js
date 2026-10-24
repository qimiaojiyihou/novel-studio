import {parseAuthorizationReceipt} from './source-auth-receipt.js'
let receipt
const fragment=location.hash
history.replaceState(null,'',location.pathname)
const status=document.getElementById('callback-status'),copy=document.getElementById('callback-copy')
try{
  receipt=parseAuthorizationReceipt(fragment)
  const response=await fetch(`/api/network/sources/${encodeURIComponent(receipt.sourceId)}/auth/callback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(receipt)})
  const result=await response.json()
  if(!response.ok)throw Error(response.status===401?'当前窗口没有原阅读页的登录状态。请复制授权回执，返回原阅读页粘贴；不用重新填写 Token。':result.error||'授权回执尚未保存')
  status.textContent=result.message||'授权已加密保存。返回原阅读页面即可继续。'
  receipt=null
}catch(error){status.textContent=error instanceof SyntaxError?'授权回执格式错误，请重新登录':error.message;copy.hidden=!receipt}
copy.onclick=async()=>{
  if(!receipt)return
  try{await navigator.clipboard.writeText(JSON.stringify(receipt));status.textContent='回执已复制，请仅粘贴到原阅读页当前书源的“授权回执”中。'}catch{status.textContent='浏览器未允许复制。请回原阅读页重新发起授权。'}
}
addEventListener('pagehide',()=>{receipt=null})
