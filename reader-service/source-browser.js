import {chromium} from 'playwright-core'
import {sourceURL,checkSourceOrigin} from './source-fetch.js'
import {checkedDocument} from './source-rules.js'
import {fail} from './store.js'

let busy=0
// Every HTTP byte is fetched by our DNS-pinned, credential-scoped transport.
// Chromium has no direct network access through this context, persistent profile,
// service worker, downloads, popups or websocket channel.
export async function renderSourcePage({initial,source,fetchResource,cookieJar,signal,webJs='',executablePath=process.env.READER_CHROMIUM_PATH||'/usr/bin/chromium'}){
  signal=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)
  if(busy>=1)fail(429,'浏览器书源正在处理，请稍后重试')
  busy++;let browser,context,page,routeError,resourceError,requests=0,bytes=0
  const stop=()=>{context?.close().catch(()=>{})}
  try{
    signal?.throwIfAborted()
    checkedDocument(initial.text)
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--disable-sync','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic','--renderer-process-limit=2','--js-flags=--max-old-space-size=64'],timeout:12000})
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,userAgent:source.headers?.['user-agent'],viewport:{width:412,height:860}})
    signal?.addEventListener('abort',stop,{once:true})
    await context.routeWebSocket('**/*',socket=>socket.close())
    const seedCookies=cookieJar?.browserCookies?.(initial.url)||[]
    if(seedCookies.length)await context.addCookies(seedCookies)
    let seeded=false
    await context.route('**/*',async route=>{
      try{
        signal?.throwIfAborted();const request=route.request(),url=sourceURL(request.url())
        checkSourceOrigin(url,source.url,source.allowedOrigins)
        if(++requests>40)fail(422,'浏览器书源请求超过 40 次限制')
        if(!['document','script','xhr','fetch','stylesheet'].includes(request.resourceType()))return route.abort('blockedbyclient')
        if(url.origin===sourceURL(source.url).origin){const cookies=await context.cookies(url.href);if(cookies.length)cookieJar?.setCookies(url.href,cookies.map(c=>`${c.name}=${c.value}; Path=${c.path}; ${c.httpOnly?'HttpOnly; ':''}${c.secure?'Secure; ':''}SameSite=${c.sameSite}${c.expires>0?'; Expires='+new Date(c.expires*1000).toUTCString():''}`))}
        const result=!seeded&&request.isNavigationRequest()&&url.href===initial.url?(seeded=true,initial):await fetchResource(url.href,{method:request.method(),body:request.postData()||''},signal)
        const responseCookies=cookieJar?.browserCookies?.(url.href)||[];if(responseCookies.length)await context.addCookies(responseCookies)
        if(result.url!==url.href){checkSourceOrigin(sourceURL(result.url),source.url,source.allowedOrigins);return route.fulfill({status:302,headers:{location:result.url}})}
        bytes+=Buffer.byteLength(result.text);if(bytes>6*1024*1024)fail(413,'浏览器书源总响应超过 6 MiB')
        const type=result.type||({'script':'application/javascript','stylesheet':'text/css','xhr':'application/json','fetch':'application/json'}[request.resourceType()]||'text/html')
        await route.fulfill({status:200,body:result.text,contentType:type.split(';')[0]+'; charset=utf-8',headers:{...(result.headers?.['content-security-policy']?{'content-security-policy':result.headers['content-security-policy']}:{})}})
      }catch(error){if(route.request().isNavigationRequest()&&route.request().frame()===page?.mainFrame())routeError=error;else resourceError||=error;await route.abort('blockedbyclient').catch(()=>{})}
    })
    page=await context.newPage();context.on('page',popup=>{if(popup!==page)popup.close().catch(()=>{})})
    await page.goto(initial.url,{waitUntil:'domcontentloaded',timeout:12000})
    // Wait for finite application work, not third-party long-polling. The whole
    // context is also terminated on the owning operation's cancellation/deadline.
    await page.waitForLoadState('networkidle',{timeout:2500}).catch(()=>{})
    if(routeError)throw routeError
    signal?.throwIfAborted()
    checkedDocument(await page.content())
    let webJsOutput
    if(webJs){
      let result;try{result=await page.evaluate(code=>(0,eval)(code),webJs)}catch(error){if(resourceError)throw resourceError;throw error}
      if(result!==null&&result!==undefined){webJsOutput=typeof result==='string'?result:JSON.stringify(result);if(Buffer.byteLength(webJsOutput)>2*1024*1024)fail(413,'网页脚本输出超过 2 MiB')}
      if(webJsOutput===''&&resourceError)throw resourceError
    }
    if(routeError)throw routeError
    const text=await page.content();if(Buffer.byteLength(text)>2*1024*1024)fail(413,'渲染页面超过 2 MiB')
    if(resourceError&&!(await page.locator('body').innerText()).trim())throw resourceError
    const finalURL=sourceURL(page.url());checkSourceOrigin(finalURL,source.url,source.allowedOrigins)
    if(finalURL.origin===sourceURL(source.url).origin){const cookies=await context.cookies(finalURL.href);if(cookies.length)cookieJar?.setCookies(finalURL.href,cookies.map(c=>`${c.name}=${c.value}; Path=${c.path}; ${c.httpOnly?'HttpOnly; ':''}${c.secure?'Secure; ':''}SameSite=${c.sameSite}`))}
    return {text,url:page.url(),type:'text/html',rendered:true,...(resourceError?{resourceError}:{}),...(webJsOutput!==undefined?{webJsOutput}:{})}
  }catch(error){if(error.status)throw error;signal?.throwIfAborted();throw Object.assign(new Error('网页渲染未完成，请检查浏览器组件、站点脚本或登录状态'),{status:422,code:'BROWSER_RENDER_FAILED',phase:'browser'})}
  finally{signal?.removeEventListener('abort',stop);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});busy--}
}
