import {parseAuthorizationReceipt} from './source-auth-receipt.js'

// Metadata only. The server owns durable pagination cursors; this queue never
// requests chapter bodies and can be recreated after a reload or lost response.
export function createDirectoryCompletion({read,load,account,onChange=()=>{},onBook=()=>{},wait=()=>new Promise(resolve=>setTimeout(resolve,1500))}){
  let epoch=0,tail=Promise.resolve()
  const jobs=new Map(),active=job=>job.epoch===epoch&&job.owner===account()&&jobs.get(job.id)===job
  const notify=job=>{if(active(job))onChange({...job,promise:undefined})}
  function get(id){const job=jobs.get(id);return job&&active(job)?{...job,promise:undefined}:null}
  function pause(id){const job=jobs.get(id);if(job&&active(job)&&['queued','running'].includes(job.status)){job.paused=true;job.status='paused';notify(job)}}
  function reset(){epoch++;for(const job of jobs.values())job.paused=true;jobs.clear()}
  function start(book){
    if(!account())return Promise.resolve()
    const previous=jobs.get(book.id)
    if(previous&&active(previous)&&previous.promise){if(previous.paused){previous.paused=false;previous.status=previous.started?'running':'queued';notify(previous)}return previous.promise}
    if(jobs.size>=32&&!previous){const old=[...jobs.values()].find(j=>!j.promise);if(old)jobs.delete(old.id);else throw Error('目录任务较多，请先暂停或等待已有任务完成')}
    const job={id:book.id,title:book.title,owner:account(),epoch,status:'queued',paused:false,loaded:book.chapterCount,batches:0,error:'',...previous,promise:null}
    Object.assign(job,{epoch,owner:account(),status:'queued',paused:false,started:false,error:''})
    jobs.set(book.id,job)
    const run=async()=>{
      if(!active(job)||job.paused){job.promise=null;return}
      job.started=true;job.status='running';notify(job)
      try{
        let current=await read(job.id),force=!book.tocIncomplete
        if(!active(job))return
        if(current.id!==job.id)throw Error('目录响应与当前书籍不一致')
        job.loaded=current.chapterCount;onBook(current);notify(job)
        let batches=0
        while(active(job)&&!job.paused&&(force||current.tocIncomplete)){
          force=false
          if(batches++>=40)throw Error('目录批次较多，已保存断点，请继续补全')
          const updated=await load(job.id)
          if(!active(job))return
          if(updated.id!==job.id)throw Error('目录响应与当前书籍不一致')
          const advanced=updated.chapterCount>current.chapterCount||(updated.tocPagesLoaded||0)>(current.tocPagesLoaded||0)
          current=updated;job.loaded=current.chapterCount;job.batches++;onBook(current);notify(job)
          if(!current.tocIncomplete)break
          if(!advanced)throw Error('本批目录没有推进，已保存断点，请稍后重试')
          if(!job.paused)await wait()
        }
        if(active(job)){job.status=current.tocIncomplete?'paused':'complete';notify(job)}
      }catch(error){if(active(job)){job.status='error';job.error=error.message||'连接中断，请重试续接';notify(job)}}
      finally{job.promise=null;if(active(job)&&job.status==='paused')notify(job)}
    }
    job.promise=tail.then(run);tail=job.promise.catch(()=>{});notify(job)
    return job.promise
  }
  return {start,pause,get,reset}
}

export function filterSearchSources(sources,query=''){
  const fold=value=>String(value||'').normalize('NFKC').toLocaleLowerCase(),terms=fold(query).trim().split(/\s+/).filter(Boolean)
  return sources.filter(s=>s.enabled&&terms.every(term=>fold(s.name+' '+s.url).includes(term)))
}
export function resolveSearchSources(sources,ids=null){
  const selected=ids===null?null:new Set(ids)
  return sources.filter(s=>s.enabled&&(selected===null||selected.has(s.id)))
}

export function sourceIssue(issue){
  const code=issue.code||'',http=issue.httpStatus
  if(code==='SOURCE_CHAPTER_LOCKED')return {key:'chapter-access',title:'原站未开放完整章节',hint:'网页只返回预览；保留当前阅读位置。登录或放宽脚本资源限制并不保证取得完整正文，请到原站或官方客户端查看。'}
  if(code==='SOURCE_LOGIN_REQUIRED'||issue.loginRequired)return {key:'login',title:'需要登录 / 授权已过期',hint:'登录配置仅用于当前账号的对应书源。保存后可继续搜索或重试阅读，不影响阅读站登录。'}
  if(code==='ORIGIN_BLOCKED')return {key:'origin',title:'跳转域名待核实',hint:'先检测该书源，核实新域名仍属于同一站点后再确认允许。不会自动放行陌生域名。'}
  if(code==='HTTPS_DOWNGRADE'||code.startsWith('TLS_'))return {key:'tls',title:'HTTPS / 证书异常',hint:'保留证书验证。站点证书或 HTTPS 入口恢复后重测；不会自动降级为明文连接。'}
  if([401,403,429].includes(http)||['LOGIN_PAGE','VERIFICATION_PAGE','BROWSER_VERIFICATION_REQUIRED','RATE_COOLDOWN'].includes(code))return {key:'access',title:'登录、验证或限流',hint:'检查本站登录配置及原站要求；限流时按提示等待，避免连续重试。'}
  if([404,410].includes(http))return {key:'address',title:'入口不存在',hint:'需要核对书源地址或重新导入维护者的新版规则；这不等于整站永久失效。'}
  if(/TIMEOUT|CONNECT|DNS_|NETWORK/.test(code)||http>=500)return {key:'network',title:'连接异常 / 暂时不可达',hint:'可能与站点、服务器网络或 DNS 有关。稍后重测，不会据此自动删除书源。'}
  if(/RULE|SCRIPT|SOURCE_|CREDENTIAL|BROWSER/.test(code))return {key:'rule',title:'规则或配置待处理',hint:'详情保留具体字段与执行阶段。需要本人凭据的书源请单独配置；浏览器规则在隔离渲染环境执行，登录或验证码仍按原站要求处理。'}
  return {key:'other',title:'其他待核查',hint:'查看具体原因，并在书源管理中按名称定位。'}
}

export function setupNetwork({api,refresh,openBook,isNetwork}) {
  const $=id=>document.getElementById(id)
  let generation=0,searchPage=1,lastSearch=null,searchRun=null,resultRows=[],shownResults=0
  let sourceRows=[],checkRun=null,sourceGeneration=0
  let searchSourceMode='all'
  const searchChosen=new Set(),searchPicker=$('network-source-picker')
  function renderSearchSources(resetScroll=false){
    const list=$('network-source-list'),scroll=resetScroll?0:list.scrollTop,focused=document.activeElement?.dataset.searchSourceId
    const enabled=filterSearchSources(sourceRows),visible=filterSearchSources(sourceRows,$('network-source-filter').value)
    const selected=resolveSearchSources(sourceRows,searchSourceMode==='all'?null:[...searchChosen])
    $('network-source-summary').textContent=searchSourceMode==='all'?`全部已启用书源（${enabled.length} 个）`:`已选 ${selected.length} 个书源`
    $('network-source-count').textContent=`筛选 ${visible.length} / ${enabled.length} 个 · 已选 ${selected.length} 个`
    $('network-source-select-filtered').disabled=!visible.length
    list.replaceChildren()
    for(const source of visible){
      const label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span'),name=document.createElement('strong'),address=document.createElement('small')
      label.className='search-source-choice';input.type='checkbox';input.checked=searchSourceMode==='all'||searchChosen.has(source.id);input.dataset.searchSourceId=source.id;input.setAttribute('aria-label',source.name)
      input.onchange=()=>{if(searchSourceMode==='all'){for(const s of enabled)searchChosen.add(s.id);searchSourceMode='selected'}input.checked?searchChosen.add(source.id):searchChosen.delete(source.id);renderSearchSources()}
      name.textContent=source.name;address.textContent=source.url;copy.append(name,address);label.append(input,copy);list.append(label)
    }
    if(!visible.length){const empty=document.createElement('p');empty.className='search-source-empty';empty.textContent=enabled.length?'没有匹配的书源，试试其他名称或域名。':'暂无启用的书源，请先在管理书源中导入或启用。';list.append(empty)}
    list.scrollTop=scroll
    if(focused)list.querySelector(`input[data-search-source-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true})
  }
  $('network-source-filter').oninput=()=>renderSearchSources(true)
  $('network-source-filter').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation()}}
  $('network-source-all').onclick=()=>{searchSourceMode='all';searchChosen.clear();renderSearchSources()}
  $('network-source-clear').onclick=()=>{searchSourceMode='selected';searchChosen.clear();renderSearchSources()}
  $('network-source-select-filtered').onclick=()=>{searchSourceMode='selected';for(const s of filterSearchSources(sourceRows,$('network-source-filter').value))searchChosen.add(s.id);renderSearchSources()}
  $('network-source-done').onclick=()=>{searchPicker.open=false;$('network-source-summary').focus()}
  document.addEventListener('click',event=>{if(!searchPicker.contains(event.target))searchPicker.open=false})
  searchPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();searchPicker.open=false;$('network-source-summary').focus()}})
  searchPicker.addEventListener('toggle',()=>{if(searchPicker.open)$('network-source-filter').focus()})
  const chosen=new Set(),healthLabels={healthy:'抽样通过',empty:'无搜索结果',review:'规则或页面待核查',unsupported:'应用暂未兼容',restricted:'访问受限 / 限流',suspect:'疑似失效',unreachable:'连接失败 / 超时'}
  let authSource=null,authSerial=0,authFlow=null,authTimer=null
  const authDialog=$('source-auth')
  function setAuthAddress(value){let address='';try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)address=url.href}catch{}$('source-auth-address').value=address;$('source-auth-link').disabled=!address}
  function stopAuthWait(){clearTimeout(authTimer);authTimer=null;const source=authSource,flow=authFlow;authFlow=null;if(source&&flow)void api(`/api/network/sources/${source.id}/auth/flow`,{flowId:flow.id},'DELETE').catch(()=>{})}
  function clearAuth(){stopAuthWait();authSerial++;authSource=null;$('source-auth-fields').replaceChildren();$('source-auth-actions').replaceChildren();$('source-auth-cookie').value='';$('source-auth-receipt').value='';$('source-auth-clear').checked=false;$('source-auth-status').textContent='';$('source-auth-state').textContent='';$('source-auth-automatic').hidden=true;$('source-auth-verify').hidden=true;setAuthAddress('')}
  function paintAuth(data){
    const a=data.authorization||{mode:'manual',status:'empty'}
    $('source-auth-state').textContent=({'not-required':'公开访问 · 无需预先授权',empty:'尚未保存授权',saved:'已保存 · 尚未验证',verified:'上次验证通过',expired:'授权未通过 / 已过期','reset-required':'登录配置需要重新保存'})[a.status]||'待验证'
    if(a.verifiedAt&&a.status==='verified')$('source-auth-state').textContent+=' · '+new Date(a.verifiedAt).toLocaleString()
    $('source-auth-mode').textContent=a.mode==='public'?'此书源可直接尝试搜索和阅读，无需先填写 Cookie。下方仅为可选的高级配置；原站仍可能限制个别章节或要求验证。':a.mode==='callback'?'此书源支持授权回传，登录成功后自动保存并验证；无需自己挑选 Cookie。':'此书源仅支持手动配置，没有自动回传。请按原站说明填写明确要求的密钥等字段；在其他浏览器登录不会自动同步。'
    $('source-auth-automatic').hidden=a.mode!=='callback';$('source-auth-verify').hidden=!a.canVerify
    $('source-auth-cookie').placeholder=data.hasCookie?'已保存 Cookie；留空不修改':'仅在原站允许使用 Cookie 登录时填写'
    for(const field of data.ui){const input=[...$('source-auth-fields').querySelectorAll('input')].find(i=>i.name===field.name);if(input)input.placeholder=field.hasValue?'已保存；留空保留':'填写原站要求的参数'}
  }
  async function refreshAuth(serial){const source=authSource;if(!source)return;const data=await api(`/api/network/sources/${source.id}/auth`);if(serial===authSerial)paintAuth(data)}
  async function pollAuth(serial){
    const source=authSource,flow=authFlow;if(!source||!flow||serial!==authSerial)return
    try{
      const data=await api(`/api/network/sources/${source.id}/auth/flow`,{flowId:flow.id})
      if(serial!==authSerial||authFlow!==flow)return
      if(data.status==='saved'){authFlow=null;$('source-auth-cancel').hidden=true;$('source-auth-status').textContent='授权已自动接收并加密保存。';setAuthAddress(source.url);await refreshAuth(serial);return}
      if(Date.now()>=data.expiresAt)throw Error('授权等待已过期，请重新准备')
      if(!document.hidden)authTimer=setTimeout(()=>void pollAuth(serial),2000)
    }catch(error){if(serial!==authSerial)return;authFlow=null;$('source-auth-cancel').hidden=true;$('source-auth-status').textContent=error.message+'。已有配置保留。'}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authFlow){clearTimeout(authTimer);void pollAuth(authSerial)}})
  $('source-auth-begin').onclick=()=>busy($('source-auth-begin'),async()=>{const source=authSource,serial=authSerial;if(!source)return;const flow=await api(`/api/network/sources/${source.id}/auth/begin`,{});if(serial!==authSerial)return;authFlow=flow;setAuthAddress(flow.url);$('source-auth-cancel').hidden=false;$('source-auth-status').textContent='专属授权地址已准备，请复制访问。登录完成后自动接收，不会自动打开新标签。';clearTimeout(authTimer);void pollAuth(serial)})
  $('source-auth-cancel').onclick=()=>{stopAuthWait();$('source-auth-cancel').hidden=true;if(authSource)setAuthAddress(authSource.url);$('source-auth-status').textContent='已取消等待，原有授权配置保留。'}
  $('source-auth-receive').onclick=()=>busy($('source-auth-receive'),async()=>{const source=authSource,serial=authSerial;if(!source)return;const receipt=parseAuthorizationReceipt($('source-auth-receipt').value);if(receipt.sourceId!==source.id||receipt.flowId!==authFlow?.id)throw Error('回执与当前书源或授权任务不匹配');const result=await api(`/api/network/sources/${source.id}/auth/callback`,receipt);if(serial!==authSerial)return;clearTimeout(authTimer);authFlow=null;$('source-auth-cancel').hidden=true;$('source-auth-receipt').value='';setAuthAddress(source.url);$('source-auth-status').textContent=result.message||'授权已加密保存';await refreshAuth(serial)})
  $('source-auth-verify').onclick=()=>busy($('source-auth-verify'),async()=>{const source=authSource,serial=authSerial;if(!source)return;const result=await api(`/api/network/sources/${source.id}/auth/verify`,{});if(serial!==authSerial)return;$('source-auth-status').textContent=result.message;await refreshAuth(serial)})
  $('source-auth-link').onclick=()=>busy($('source-auth-link'),async()=>{const address=$('source-auth-address').value;if(!address)return;try{await navigator.clipboard.writeText(address);$('source-auth-status').textContent='原站地址已复制。请手动粘贴到浏览器访问；本页没有打开新标签。'}catch{$('source-auth-address').focus();$('source-auth-address').select();$('source-auth-status').textContent='请复制上方已选中的原站地址。'}})
  authDialog.addEventListener('close',clearAuth)
  $('source-auth-close').onclick=()=>authDialog.close()
  authDialog.addEventListener('click',event=>{const r=authDialog.getBoundingClientRect();if(event.target===authDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))authDialog.close()})
  async function openAuth(source){
    clearAuth();const serial=authSerial,gen=generation,data=await api(`/api/network/sources/${source.id}/auth`);if(serial!==authSerial||gen!==generation)return
    authSource=source;$('source-auth-title').textContent=`${data.name} · ${{public:'高级配置（可选）',callback:'登录授权',manual:'手动配置'}[data.authorization?.mode]||'手动配置'}`;setAuthAddress(data.url)
    data.ui.forEach((field,index)=>{
      if(field.type==='button'){
        if(field.action)$('source-auth-actions').append(action(field.name,async()=>{const value=await api(`/api/network/sources/${source.id}/auth/action`,{index});if(serial!==authSerial)return;$('source-auth-status').textContent=value.message||'已完成';if(value.openUrl){setAuthAddress(value.openUrl);$('source-auth-status').textContent+='。地址已显示在上方，请复制后手动访问；不会自动打开新标签。'}await refreshAuth(serial)}))
      }else{const label=document.createElement('label'),input=document.createElement('input');label.textContent=({sign_key:'签名密钥（sign_key）',content_key:'内容解码密钥（content_key）'})[field.name]||field.name;input.type='password';input.name=field.name;input.maxLength=8192;input.autocomplete='off';input.placeholder=field.hasValue?'已保存；留空保留':'填写原站要求的参数';label.append(input);$('source-auth-fields').append(label)}
    })
    $('source-auth-actions').append(action('清除本书源登录配置',async()=>{if(!confirm('清除当前账号在此书源保存的 Cookie、密钥和脚本变量？书源和收藏保留。'))return;await api(`/api/network/sources/${source.id}/auth`,{},'DELETE');if(serial!==authSerial)return;authDialog.close();await openAuth(source)}))
    if(data.resetRequired)$('source-auth-status').textContent='服务密钥已变化或配置损坏。请先清除本书源登录配置，再重新保存。'
    paintAuth(data);$('source-auth-cancel').hidden=true;$('source-auth-manual').open=false
    authDialog.showModal()
  }
  $('source-auth-form').onsubmit=event=>{event.preventDefault();busy($('source-auth-save'),async()=>{const source=authSource,serial=authSerial;if(!source)return;const params=Object.fromEntries([...$('source-auth-fields').querySelectorAll('input')].map(input=>[input.name,input.value]));const result=await api(`/api/network/sources/${source.id}/auth`,{params,cookie:$('source-auth-cookie').value,clearCookie:$('source-auth-clear').checked},'PUT');if(serial!==authSerial)return;clearTimeout(authTimer);authFlow=null;$('source-auth-cancel').hidden=true;setAuthAddress(source.url);$('source-auth-fields').querySelectorAll('input').forEach(input=>{input.value=''});$('source-auth-cookie').value='';$('source-auth-clear').checked=false;$('source-auth-status').textContent='已加密保存，仅用于此账号的当前书源。'+(result.message||'');await refreshAuth(serial)})}
  const importLimit=10*1024*1024
  function parseImport(value) {
    if(new TextEncoder().encode(value).length>importLimit)throw new Error('导入内容超过 10 MiB，请拆分文件后导入')
    try{return JSON.parse(value.replace(/^\uFEFF/,''))}catch{throw new Error('导入内容不是有效 JSON，请检查文件是否完整或有多余文字')}
  }
  function status(message) { $('network-status').textContent=message }
  function diagnosticGroups(container,issues){
    const expanded=new Set([...container.querySelectorAll('details[open]')].map(e=>e.dataset.group)),groups=new Map()
    for(const issue of issues){const kind=sourceIssue(issue);if(!groups.has(kind.key))groups.set(kind.key,{...kind,issues:[]});groups.get(kind.key).issues.push(issue)}
    container.replaceChildren()
    for(const group of groups.values()){
      const details=document.createElement('details'),summary=document.createElement('summary'),hint=document.createElement('p'),list=document.createElement('ul')
      details.className='source-diagnostic-group';details.dataset.group=group.key;details.open=expanded.has(group.key)
      summary.textContent=`${group.title} · ${group.issues.length} 个`;hint.textContent=group.hint
      for(const issue of group.issues){const li=document.createElement('li'),name=document.createElement('strong'),reason=document.createElement('p');name.textContent=issue.name||'书源';reason.textContent=issue.message||issue.reason||'待核查';li.append(name,reason);if(issue.field){const field=document.createElement('small');field.textContent=issue.field;li.append(field)}if(issue.loginRequired&&issue.sourceId)li.append(action('登录此书源',()=>loginRequired(issue)));list.append(li)}
      details.append(summary,hint,list);container.append(details)
    }
  }
  function action(label,fn) {const b=document.createElement('button');b.textContent=label;b.onclick=()=>busy(b,fn);return b}
  async function busy(button,fn) {button.disabled=true;const serial=generation;try{await fn(serial)}catch(error){if(serial===generation){status(error.message);if(authDialog.open&&authDialog.contains(button))$('source-auth-status').textContent=error.message;if(button.id.startsWith('source-import'))$('source-import-status').textContent=`导入未完成：${error.message}。已导入的条目会保留，重新导入不会重复创建。`}}finally{button.disabled=false;if(['source-check-selected','source-delete-selected'].includes(button.id))updateSelection()}}
  function clearSearch(){if(searchRun)searchRun.cancelled=true;searchRun=null;resultRows=[];shownResults=0;$('network-search-submit').disabled=false;$('network-search-stop').hidden=true;$('network-search-errors').hidden=true;$('network-search-error-list').textContent='';$('network-results-more').hidden=true;$('network-results').replaceChildren();$('network-more').hidden=true;$('network-results-close').hidden=true}
  function reset(){generation++;sourceGeneration++;if(authDialog.open)authDialog.close();clearAuth();lastSearch=null;clearSearch();if(checkRun)checkRun.cancelled=true;checkRun=null;sourceRows=[];chosen.clear();searchChosen.clear();searchSourceMode='all';searchPicker.open=false;$('network-source-filter').value='';renderSearchSources();$('source-filter').value='';$('source-health-filter').value='all';$('source-check-status').textContent='';$('source-check-key').value='小说';updateSelection();$('source-list').replaceChildren();$('source-import-status').textContent='';status('');$('source-json').value='';$('source-url').value='';$('source-file').value='';$('network-key').value=''}
  async function loadSources(){
    const serial=sourceGeneration,sources=await api('/api/network/sources'),defaults=await api('/api/network/sources/defaults');if(serial!==sourceGeneration)return
    $('source-defaults').hidden=!defaults
    $('source-defaults-update').hidden=!defaults?.updateAvailable
    if(defaults){$('source-defaults-summary').textContent=`默认书源包：初始化 ${defaults.imported} 个，保留已有 ${defaults.existing} 个，合并同标识 ${defaults.duplicates.length} 个，待兼容 ${(defaults.unavailable||[]).length} 个，需账号配置 ${(defaults.requiresConfiguration||[]).length} 个，未导入 ${defaults.rejected.length} 个`;diagnosticGroups($('source-defaults-errors'),defaults.rejected.concat(defaults.unavailable||[],(defaults.requiresConfiguration||[]).map(s=>({sourceId:s.id,name:s.name,loginRequired:true,message:'规则已支持；默认包不分发共享密钥，请在此账号的书源登录配置中保存所需参数。'}))))}
    sourceRows=sources;for(const id of chosen)if(!sources.some(s=>s.id===id))chosen.delete(id)
    for(const id of searchChosen)if(!sources.some(s=>s.id===id&&s.enabled))searchChosen.delete(id)
    renderSearchSources()
    renderSources()
    if(!sources.length){$('source-manager').open=true;status('先导入书源，再按书名或作者搜索。')}
  }
  function visibleSources(){const query=$('source-filter').value.trim().toLowerCase(),filter=$('source-health-filter').value;return sourceRows.filter(s=>(s.name+' '+s.url).toLowerCase().includes(query)&&(filter==='all'||filter==='disabled'&&!s.enabled||filter==='unknown'&&!s.compatibility&&(!s.health||s.health.stale)||filter==='healthy'&&s.health?.status==='healthy'&&!s.health.stale||filter==='review'&&(s.compatibility||s.health&&!s.health.stale&&s.health.status!=='healthy')))}
  function updateSelection(){
    $('source-selection').textContent=`共 ${sourceRows.length} 个 · 筛选 ${visibleSources().length} 个 · 已选 ${chosen.size} 个`
    $('source-check-selected').disabled=!!checkRun||!chosen.size;$('source-delete-selected').disabled=!!checkRun||!chosen.size;$('source-check-stop').hidden=!checkRun
  }
  function renderSources(){
    const scroll=$('source-list').scrollTop;$('source-list').replaceChildren()
    for(const source of visibleSources()){
      const row=document.createElement('article'),label=document.createElement('label'),checkbox=document.createElement('input'),name=document.createElement('strong'),info=document.createElement('small'),health=document.createElement('div'),actions=document.createElement('div')
      row.className='source-row';row.dataset.sourceId=source.id;label.className='source-choice';checkbox.type='checkbox';checkbox.checked=chosen.has(source.id);checkbox.onchange=()=>{checkbox.checked?chosen.add(source.id):chosen.delete(source.id);updateSelection()};name.textContent=source.name;label.append(checkbox,name)
      info.textContent=`${source.url} · ${source.enabled?'启用':'停用'}${source.warnings.length?` · ${source.warnings.join('；')}`:''}`
      health.className='source-health';health.dataset.state=source.health?.stale?'stale':source.health?.status||'unknown'
      health.textContent=source.health?`${source.health.stale?'规则已更新，请重测 · ':''}${healthLabels[source.health.status]||'待核查'} · ${new Date(source.health.checkedAt).toLocaleString()}\n${source.health.message}`:'尚未检测'
      if(source.compatibility){health.dataset.state='unsupported';health.textContent=(source.compatibility.code==='SOURCE_CONFIGURATION_REQUIRED'?'待配置':'待兼容')+' · '+source.compatibility.reason}
      if(source.health){const h=source.health,stage={search:'搜索',info:'详情',toc:'目录',content:'正文'}[h.stage]||h.stage;health.textContent+=`\n阶段：${stage||'未知'}${h.phase?' / '+({dns:'DNS',connect:'连接',tls:'TLS',headers:'响应头',read:'读取',redirect:'跳转',queue:'排队',parse:'解析'}[h.phase]||h.phase):''} · ${((h.durationMs||0)/1000).toFixed(1)} 秒${h.code?' · '+h.code:''}`;if(h.targetOrigin)health.textContent+=`\n待核实的跳转来源：${h.targetOrigin}`;if(h.matches)health.textContent+='\n'+Object.entries(h.matches).map(([key,value])=>`${{search:'搜索条目',toc:'目录条目',contentCharacters:'正文字符'}[key]||key} ${value}`).join(' · ')}
      if(!source.compatibility){const mode=source.authorization?.mode||'manual';info.textContent+=' · '+({public:'公开访问，无需预先授权',callback:'支持自动授权',manual:'仅支持手动配置'})[mode];actions.append(action(({public:'高级配置',callback:'登录授权',manual:'手动配置'})[mode],()=>openAuth(source)))}
      if(source.health?.code==='ORIGIN_BLOCKED'&&source.health.targetOrigin&&!source.health.stale)actions.append(action('确认跳转域名',async()=>{
        const origin=source.health.targetOrigin
        if(!confirm(`书源「${source.name}」请求跳转到 ${origin}。\n请先核实该域名仍属于原书源站点。确认后只为当前账号的此书源放行这个域名，证书与公网地址检查仍生效。\n是否确认？`))return
        await api(`/api/network/sources/${source.id}/origins`,{origin},'PUT');await loadSources();status('已保存此书源的允许域名，请重新搜索或检测。')
      }))
      actions.append(action(source.enabled?'停用':'启用',async()=>{await api(`/api/network/sources/${source.id}`,{enabled:!source.enabled},'PUT');await loadSources()}),action('删除书源',async()=>{if(!confirm(`删除书源「${source.name}」？已有收藏时请先移出或停用书源。`))return;await api(`/api/network/sources/${source.id}`,{},'DELETE');await loadSources()}));row.append(label,health,info,actions);$('source-list').append(row)
    }
    $('source-list').scrollTop=scroll;updateSelection()
  }
  $('source-filter').oninput=renderSources;$('source-health-filter').onchange=renderSources
  $('source-select-all').onclick=()=>{for(const s of visibleSources())chosen.add(s.id);renderSources()}
  $('source-select-none').onclick=()=>{chosen.clear();renderSources()}
  $('source-check-stop').onclick=()=>{if(checkRun){checkRun.cancelled=true;$('source-check-status').textContent='正在停止，当前最多 2 个检测结束后停止（最长约 40 秒）；已有结果保留。'}}
  $('source-check-selected').onclick=()=>busy($('source-check-selected'),async()=>{
    const serial=sourceGeneration,ids=[...chosen],key=$('source-check-key').value.trim();if(!key)throw new Error('请填写检测书名或作者')
    const run={cancelled:false};checkRun=run;updateSelection();let completed=0,passed=0
    try{
      for(let i=0;i<ids.length&&!run.cancelled&&serial===sourceGeneration;i+=2){
        const started=Date.now();$('source-check-status').textContent=`正在检测 ${completed} / ${ids.length}，抽样通过 ${passed} 个…`
        const data=await api('/api/network/sources/check',{ids:ids.slice(i,i+2),key});if(serial!==sourceGeneration)return
        for(const result of data.results){completed++;if(result.status==='healthy')passed++;const row=sourceRows.find(s=>s.id===result.id);if(row&&!result.skipped)row.health=result}
        renderSources();$('source-check-status').textContent=`已检测 ${completed} / ${ids.length}，抽样通过 ${passed} 个。`
        if(i+2<ids.length&&!run.cancelled)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1200-(Date.now()-started))))
      }
      if(serial===sourceGeneration)$('source-check-status').textContent=`${run.cancelled?'已停止':'检测完成'}：${completed} / ${ids.length}，抽样通过 ${passed} 个，其余请查看明细；没有删除任何书源。`
    }catch(error){if(serial===sourceGeneration)$('source-check-status').textContent=`检测暂停：${error.message}。已完成 ${completed} / ${ids.length}，结果已保存，可稍后重测。`}
    finally{if(checkRun===run){checkRun=null;updateSelection()}}
  })
  $('source-delete-selected').onclick=()=>busy($('source-delete-selected'),async()=>{
    const serial=sourceGeneration,ids=[...chosen];if(!ids.length||!confirm(`删除已选的 ${ids.length} 个书源？其中已有收藏的书源会保留。删除后可重新导入，检测结果将一并清除。`))return
    const names=new Map(sourceRows.map(s=>[s.id,s.name])),result=await api('/api/network/sources/delete',{ids});if(serial!==sourceGeneration)return
    for(const id of result.removed)chosen.delete(id)
    $('source-check-status').textContent=`已删除 ${result.removed.length} 个，保留 ${result.skipped.length} 个。`+result.skipped.map(s=>`\n${names.get(s.id)||'书源'}：${s.message}`).join('');await loadSources()
  })
  $('source-defaults-update').onclick=()=>busy($('source-defaults-update'),async()=>{const serial=sourceGeneration;await api('/api/network/sources/defaults/update',{});if(serial!==sourceGeneration)return;await loadSources();if(serial===sourceGeneration)$('source-check-status').textContent='已补充本版新增兼容书源；原有停用设置及之前删除的旧书源保持不变。'})
  async function importSources(body,serial){$('source-import-status').textContent='正在校验并分批导入书源，请稍候…';const result=await api('/api/network/sources/import',body);if(serial!==generation)return;$('source-import-status').textContent=`成功 ${result.accepted.length} 个，未导入 ${result.rejected.length} 个。\n`+result.accepted.map(s=>`${s.name}：${s.updated?'已更新（保留启用状态）':'已导入并启用'}${s.warnings.length?'；'+s.warnings.join('；'):''}`).concat(result.rejected.map(s=>`第 ${s.index} 个 ${s.name}：${s.reason}`)).join('\n');await loadSources()}
  $('source-import').onclick=()=>busy($('source-import'),serial=>importSources({sources:parseImport($('source-json').value)},serial))
  $('source-import-url').onclick=()=>busy($('source-import-url'),serial=>importSources({url:$('source-url').value},serial))
  $('source-file').onchange=()=>busy($('source-import'),async serial=>{const file=$('source-file').files[0];if(!file)return;if(file.size>importLimit)throw new Error('文件超过 10 MiB，请拆分文件后导入');const data=await file.text();if(serial!==generation)return;$('source-json').value=data;await importSources({sources:parseImport(data)},serial)})
  function showResults(){
    const serial=generation,end=Math.min(resultRows.length,shownResults+50)
    for(;shownResults<end;shownResults++){
      const result=resultRows[shownResults],card=document.createElement('article'),title=document.createElement('h3'),author=document.createElement('p'),description=document.createElement('p'),actions=document.createElement('div');card.className='network-result';title.textContent=result.title;author.textContent=`${result.author||'作者未提供'} · ${result.sourceName}`;description.textContent=result.description
      const feedback=document.createElement('p');feedback.className='network-add-feedback';feedback.setAttribute('role','status');feedback.hidden=true
      actions.append(action('加入书架',async()=>{
        feedback.hidden=false;feedback.textContent='正在读取详情和目录…'
        try{const added=await api('/api/network/books',{ticket:result.ticket});if(serial!==generation)return;feedback.textContent=`已加入「${added.title}」，已加载 ${added.chapterCount} 章${added.tocIncomplete?'；可在书架一键补全目录':''}`;await refresh();actions.replaceChildren(action('开始阅读',()=>openBook(added.id)))}
        catch(error){if(serial===generation){feedback.textContent=`加入书架未完成：${error.message}`;if(error.loginRequired&&!actions.querySelector('[data-login]')){const login=action('登录此书源',()=>loginRequired(error));login.dataset.login='true';actions.append(login)}}}
      }));card.append(title,author);if(result.description)card.append(description);card.append(actions,feedback);$('network-results').append(card)
    }
    $('network-results-more').hidden=shownResults>=resultRows.length
    $('network-results-more').textContent=`显示更多结果（已显示 ${shownResults} / ${resultRows.length}）`
  }
  async function search(append=false){
    if(searchRun)return
    const query=append?lastSearch:{key:$('network-key').value.trim(),sourceIds:searchSourceMode==='all'?null:[...searchChosen]};if(!query?.key)return
    if(query.sourceIds!==null&&!query.sourceIds.length){status('请选择至少一个书源，或点击“使用全部启用书源”。');return}
    searchPicker.open=false
    if(!append){generation++;clearSearch();searchPage=1;lastSearch=query}
    const page=append?searchPage+1:1,serial=generation,run={cancelled:false};searchRun=run
    let completed=0,found=0;const errors=[]
    $('network-search-submit').disabled=true;$('network-search-stop').hidden=false;$('network-more').hidden=true;$('network-search-errors').hidden=true;$('network-results-close').hidden=false
    try{
      // Snapshot the current enabled list for this run; never use a first-N shortcut.
      const sources=await api('/api/network/sources');if(serial!==generation||!isNetwork())return
      const selected=resolveSearchSources(sources,query.sourceIds),names=new Map(selected.map(s=>[s.id,s.name]))
      if(!selected.length)throw new Error('请先启用至少一个书源，或重新选择搜索书源')
      for(let i=0;i<selected.length&&!run.cancelled&&serial===generation;i+=2){
        const started=Date.now();status(`正在搜索 ${completed} / ${selected.length} 个书源 · 本页找到 ${found} 本…`)
        const data=await api('/api/network/search',{key:query.key,page,sourceIds:selected.slice(i,i+2).map(s=>s.id)})
        if(serial!==generation||!isNetwork())return
        completed+=data.checkedSources;found+=data.results.length;resultRows.push(...data.results);errors.push(...data.errors)
        if(shownResults<50)showResults();else{$('network-results-more').hidden=shownResults>=resultRows.length;$('network-results-more').textContent=`显示更多结果（已显示 ${shownResults} / ${resultRows.length}）`}
        $('network-search-errors').hidden=!errors.length;diagnosticGroups($('network-search-error-list'),errors.map(e=>({...e,name:names.get(e.sourceId)||'书源'})))
        status(`已搜索 ${completed} / ${selected.length} 个书源 · 本页找到 ${found} 本 · 异常 ${errors.length} 个`)
        if(i+2<selected.length&&!run.cancelled)await new Promise(resolve=>setTimeout(resolve,Math.max(0,1500-(Date.now()-started))))
      }
      if(serial!==generation)return
      searchPage=page;status(`${run.cancelled?'已停止':'搜索完成'}：${completed} / ${selected.length} 个书源 · 本页找到 ${found} 本 · 异常 ${errors.length} 个${run.cancelled?'；重新搜索可从头检查全部书源':''}`)
      $('network-more').hidden=run.cancelled||searchPage>=100||!found
    }catch(error){if(serial===generation)status(`搜索暂停：${error.message}。已完成 ${completed} 个书源，已取得的结果保留。`)}
    finally{if(searchRun===run){searchRun=null;$('network-search-submit').disabled=false;$('network-search-stop').hidden=true}}
  }
  $('network-search-stop').onclick=()=>{if(searchRun){searchRun.cancelled=true;status('正在停止，当前最多 2 个书源返回后结束，已有结果保留。')}}
  $('network-results-more').onclick=showResults
  $('network-search-form').onsubmit=event=>{event.preventDefault();void search()}
  $('network-more').onclick=()=>busy($('network-more'),()=>search(true))
  $('network-results-close').onclick=()=>{generation++;clearSearch();status('')}
  async function loginRequired(issue){
    if(!/^[a-f0-9]{32}$/.test(issue.sourceId))return
    if(authDialog.open&&authSource?.id===issue.sourceId)return
    const serial=generation,sources=await api('/api/network/sources');if(serial!==generation)return
    const source=sources.find(s=>s.id===issue.sourceId);if(!source)return
    if(authDialog.open)authDialog.close()
    await openAuth(source)
    if(authSource?.id===source.id)$('source-auth-status').textContent=issue.message||'请更新此书源登录配置，保存后重试原操作。'
  }
  return {reset,loadSources,status,loginRequired}
}
