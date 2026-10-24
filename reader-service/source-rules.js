import { load } from 'cheerio'
import JSON5 from 'json5'
import iconv from 'iconv-lite'
import { RE2JS } from 're2js'
import { digest, fail, text } from './store.js'
import { sourceURL, sourceIdentity, sourceHeaders, sourceOrigins, checkSourceOrigin } from './source-fetch.js'
import {checkExpression,textExpression,unsupported} from './source-expression.js'
import {isXPath,checkXPath,xpathText,xpathRows} from './source-xpath.js'
import {validateScript} from './source-script.js'
import {normalizeAuthorization} from './source-authorization.js'
import {validateRequestOptions} from './source-request.js'
import {portableSourceRegex} from './source-regex.js'

// Split rule operators only outside selectors, predicates and quoted literals.
export function splitRule(value,separator) {
  const parts=[];let start=0,depth=0,quote=''
  for(let i=0;i<value.length;i++){
    const char=value[i]
    if(quote){if(char==='\\')i++;else if(char===quote)quote='';continue}
    if(char==='"'||char==="'"){quote=char;continue}
    if('([{'.includes(char))depth++
    else if(')]}'.includes(char))depth--
    else if(depth===0&&value.startsWith(separator,i)){parts.push(value.slice(start,i));i+=separator.length-1;start=i+1}
  }
  parts.push(value.slice(start));return parts
}
export function scriptRule(rule){
  const at=rule.indexOf('@js:')
  if(at>=0){const parts=splitRule(rule.slice(at+4),'##');return {before:rule.slice(0,at).trim(),code:parts.shift(),after:parts.length?'##'+parts.join('##'):''}}
  if(rule.startsWith('<js>')&&rule.endsWith('</js>'))return {before:'',code:rule.slice(4,-5)}
  return null
}
function templateParts(rule){return [...rule.matchAll(/\{\{([\s\S]*?)\}\}/g)]}
export function embeddedScript(rule){
  const start=rule.indexOf('<js>');if(start<0)return null
  const end=rule.indexOf('</js>',start+4);if(end<0)throw unsupported('未闭合的脚本块','script')
  return {before:rule.slice(0,start).trim(),code:rule.slice(start+4,end),after:rule.slice(end+5).trim()}
}

// Variable directives are parsed as data, never evaluated as host JavaScript.
// Stop at the closing object, respecting quoted braces and nested JSON5 maps.
export function putDirective(rule){
  const at=rule.indexOf('@put:');if(at<0)return null
  let start=at+5;while(/\s/.test(rule[start]||'')&&start<rule.length)start++
  if(rule[start]!=='{')fail(400,'@put 应使用变量规则对象')
  let depth=0,quote=''
  for(let i=start;i<rule.length;i++){
    const ch=rule[i]
    if(quote){if(ch==='\\')i++;else if(ch===quote)quote='';continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='{')depth++
    if(ch==='}'&&!--depth){
      let entries;try{entries=JSON5.parse(rule.slice(start,i+1))}catch{
        // Legado also exports unquoted rule values, e.g. {id:$.Id,bid:id}.
        // Parse these as rule strings, never as executable JavaScript.
        entries=Object.create(null)
        for(const pair of splitRule(rule.slice(start+1,i),',')){
          const parts=splitRule(pair,':'),key=parts.shift()?.trim(),value=parts.join(':').trim()
          if(!key||!value)fail(400,'@put 变量规则格式错误')
          let parsed;try{parsed=JSON5.parse('{'+key+':null}')}catch{fail(400,'@put 变量名称错误')}
          const name=Object.keys(parsed)[0];if(Object.hasOwn(entries,name))fail(400,'@put 变量名称重复')
          if(/^["']/.test(value)){try{entries[name]=JSON5.parse(value)}catch{fail(400,'@put 变量规则格式错误')}}
          else {if(!/^[$\w\u0080-\uffff.[\]@]/.test(value))fail(400,'@put 变量规则格式错误');entries[name]=value}
        }
      }
      if(!entries||Array.isArray(entries)||typeof entries!=='object'||Object.keys(entries).length>100)fail(400,'@put 变量规则过多')
      for(const [key,value]of Object.entries(entries))if(!key||key.length>100||['__proto__','constructor','prototype'].includes(key)||typeof value!=='string')fail(400,'@put 变量名称或规则错误')
      return {before:rule.slice(0,at).trim(),entries,after:rule.slice(i+1).trim()}
    }
  }
  fail(400,'@put 变量规则未闭合')
}

export function replacement(value, expression) {
  if (!expression) return value
  expression=expression.replace(/\{\{book\.durChapterTitle\}\}/g,'CHAPTER_TITLE')
  if(expression.includes('{{'))throw unsupported('替换规则中的动态模板','template')
  const parts = expression.split('##')
  const firstOnly = parts.length === 4 && ['', '#'].includes(parts[3])
  if (firstOnly) parts.pop()
  if (parts.length > 3 || !parts[1] || parts[1].length > 4096) fail(400, '替换规则格式或长度不受支持')
  // Java accepts escaped non-ASCII punctuation as literals; RE2 requires the
  // literal character. Consume escape pairs so an escaped backslash stays intact.
  const pattern = parts[1].replace(/\\([\s\S])/g, (pair, char) => char.charCodeAt(0)>127 ? char : pair)
  try {
    const compiled=RE2JS.compile(pattern)
    if(firstOnly) {const match=compiled.matcher(value);if(!match.find())return '';value=match.group()}
    const scan=compiled.matcher(value),output=parts[2]||'';let size=value.length,count=0
    while(scan.find()){
      if(++count>100000)fail(422,'替换匹配数量超过限制')
      size+=output.replace(/\$(\d+)/g,(_,n)=>scan.group(Number(n))||'').length-(scan.end()-scan.start())
      if(size>2*1024*1024)fail(422,'替换输出超过 2 MiB 限制')
    }
    return compiled.matcher(value).replaceAll(parts[2] || '')
  } catch(error) {if(error.status===422)throw error;fail(400, '替换规则暂不兼容（仅支持 RE2 正则）') }
}
function checkScriptTemplates(code){
  const prepared=code.replace(/\{\{([\s\S]*?)\}\}/g,(_,part)=>{if(/^(?:\$|@@)/.test(part))checkRule(part.replace(/^@@/,''));else {try{checkExpression(part)}catch{validateScript(part)}}return 'null'})
  validateScript(prepared)
}
function checkRule(rule, list = false, depth = 0) {
  if(depth>32)fail(400,'规则流水线层数超过限制')
  text(rule, 30000, '解析规则')
  rule=rule.trim().replace(/^@json:/i,'').replace(/(?<!\{)\{(\$[.\[][^{}]+)\}(?!\})/g,'{{$1}}')
  // Handle directives outside script blocks; script strings remain script data.
  const directive=rule.indexOf('@put:')>=0&&(!/<js>|@js:/.test(rule)||rule.indexOf('@put:')<rule.search(/<js>|@js:/))?putDirective(rule):null
  if(directive){if(directive.before)checkRule(directive.before,list,depth+1);for(const value of Object.values(directive.entries))checkRule(value,false,depth+1);if(directive.after)checkRule(directive.after,list,depth+1);return}
  if(rule.includes('@get:{')&&!/<js>|@js:/.test(rule)){const replaced=rule.replace(/@get:\{[\w\u0080-\uffff.-]{1,100}\}/g,'VARIABLE');if(replaced.includes('@get:'))fail(400,'@get 变量名称错误');const parts=splitRule(replaced,'##');if(parts.length>1)checkReplacement('##'+parts.slice(1).join('##'));return}
  const embedded=embeddedScript(rule)
  if(embedded){if(embedded.before)checkRule(embedded.before,list,depth+1);checkScriptTemplates(embedded.code);if(embedded.after){if(embedded.after.startsWith('##'))checkReplacement(embedded.after);else checkRule(embedded.after,list,depth+1)}return}
  const script=scriptRule(rule)
  if(rule.startsWith('<js>')&&rule.includes('</js>')&&!rule.endsWith('</js>')){const end=rule.indexOf('</js>');validateScript(rule.slice(4,end));checkRule(rule.slice(end+5).trim(),list,depth+1);return}
  if(script){if(script.before)checkRule(script.before,false,depth+1);try{checkExpression(script.code)}catch{checkScriptTemplates(script.code)}if(script.after)checkReplacement(script.after);return}
  if (/<js>|javascript:|@get:|@put:/i.test(rule)) throw unsupported('脚本预处理或变量存取语法','script')
  if(rule.includes('{{')){
    const segments=splitRule(rule,'##'),expression=segments[0],parts=templateParts(rule)
    if(!parts.length)throw unsupported('动态模板','template')
    for(const part of parts){if(/^(?:\$|@@)/.test(part[1]))checkRule(part[1].replace(/^@@/,''),false,depth+1);else {try{checkExpression(part[1])}catch{validateScript(part[1])}}}
    if(expression.replace(/\{\{[\s\S]*?\}\}/g,'').includes('{{'))throw unsupported('动态模板','template')
    if(segments.length>1)checkReplacement('##'+segments.slice(1).join('##'))
    return
  }
  const [expression] = rule.split('##')
  if(expression.startsWith(':')) { regexMatches('',expression);return }
  if (list && rule.includes('##')) fail(400, '列表选择器暂未支持替换表达式')
  if (rule.includes('##')) replacement('', rule.slice(rule.indexOf('##')))
  for (let branch of splitRule(expression,'||').flatMap(s=>splitRule(s,'&&')).flatMap(s=>splitRule(s,'%%'))) {
    branch=branch.trim()
    if(isXPath(branch)){checkXPath(branch);continue}
    if(/^\.\w/.test(branch)&&/\[(?:\*|\?)/.test(branch)){jsonTokens('$'+branch);continue}
    if(/^[\w-]+(?:\.[\w-]+|\[[\s\S]*\])+$/.test(branch)&&/\[(?:\*|\?)/.test(branch)){jsonTokens('$.'+branch);continue}
    if (branch.startsWith('$')) {
      if(/^\$\d+(?:[^$]*\$\d+)*$/.test(branch))continue
      jsonTokens(branch)
    } else {
      const atoms = splitRule(branch.replace(/^@css:/i, ''),'@').filter(Boolean)
      if (!list && atoms.length > 1) atoms.pop()
      for (const rawAtom of atoms) {
        const atom=rawAtom.trim()
        if (['text','textNodes','html','all','ownText','href','src','content'].includes(atom)) continue
        try { load('<div/>')(selector(atom).css) } catch { throw unsupported('CSS / JSOUP 选择器语法','selector') }
      }
    }
  }
}
function checkReplacement(expression){
  const script=scriptRule(expression)
  if(script){if(script.before)checkReplacement(script.before);checkScriptTemplates(script.code);if(script.after)checkReplacement(script.after);return}
  for(const part of templateParts(expression)){if(!['book.name','book.durChapterTitle','title'].includes(part[1]))throw unsupported('替换规则中的动态模板','template')}
  replacement('',expression.replace(/\{\{(?:book\.name|book\.durChapterTitle|title)\}\}/g,'PLACEHOLDER'))
}
// RE2 stays the synchronous fast path. Java lookarounds used by some exports
// run only in the existing memory/CPU-limited QuickJS worker, never on Node's
// event loop. Compile here validates syntax; it never matches imported input.
const portableRegex=portableSourceRegex
function sandboxListRule(rule){
  if(!rule.startsWith(':')||rule.length>1000)throw Error('regex list size')
  const pattern=portableRegex(rule.slice(1));new RegExp(pattern,'g')
  return `<js>var re=new RegExp(${JSON.stringify(pattern)},'g'),rows=[],match;while((match=re.exec(String(result)))&&rows.length<5001){rows.push({__regex:match[0],captures:Array.from(match,x=>x||'')});if(!match[0])re.lastIndex++;}rows</js>`
}
function sandboxReplacementRule(rule){
  if(/<js>|@js:|\{\{/.test(rule))throw Error('compound replacement')
  const parts=splitRule(rule,'##'),before=parts.shift(),firstOnly=parts.length===3&&['','#'].includes(parts[2])
  if(firstOnly)parts.pop()
  if(parts.length>2||!parts[0]||parts[0].length>4096)throw Error('replacement size')
  const pattern=portableRegex(parts[0])
  new RegExp(pattern,'g')
  const output=(parts[1]||'').replace(/\$0(?!\d)/g,()=>'$&')
  const code=`var value=String(result);var re=new RegExp(${JSON.stringify(pattern)},'g');${firstOnly?'var match=re.exec(value);value=match?match[0]:"";re.lastIndex=0;':''}value.replace(re,${JSON.stringify(output)})`
  return (before||'')+'<js>'+code+'</js>'
}
function selector(raw) {
  // Legacy colon notation is a list of indexes, not a slice: .5:4 selects
  // indexes 5 then 4; !0:3 excludes indexes 0 and 3. Negative indexes count back.
  const bracket=raw.match(/^(.*?)\[(!?)([\d\s,:-]+)\]$/)
  const ranges=bracket?bracket[3].split(',').map(s=>s.trim().split(':').map(v=>v===''?null:Number(v))):null
  if(ranges?.some(r=>r.length>3||r.some(v=>v!==null&&!Number.isSafeInteger(v))||r.length===1&&r[0]===null||r[2]===0))throw unsupported('无效的索引范围','selector')
  if(bracket)raw=bracket[1]
  const match = raw.match(/^(.*?)([.!])(-?\d+(?::-?\d+)*)$/), indexes = match ? match[3].split(':').map(Number) : null
  let css = match ? match[1].replace(/\.$/,'') : raw
  const ownText=css.startsWith('text.')?css.slice(5):null
  if(ownText!==null)css='*'
  css = css.startsWith('class.') ? '.'+css.slice(6).trim().split(/\s+/).join('.') : css.replace(/^id\./, '#').replace(/^tag\./, '')
  return { css: css==='children'||!css&&ranges?'*':css||'*', children:css==='children'||!css&&ranges, indexes, ranges, exclude:bracket?bracket[2]==='!':match?.[2]==='!', ownText }
}
function selectedIndexes(length,indexes,ranges){
  if(!indexes&&!ranges)return null
  const result=new Set(),index=n=>n<0?length+n:n
  if(!ranges)for(const n of indexes){const i=index(n);if(i>=0&&i<length)result.add(i)}
  else for(const range of ranges){
    if(range.length===1){const i=index(range[0]);if(i>=0&&i<length)result.add(i);continue}
    if(!length)continue
    let a=index(range[0]??0),b=index(range[1]??-1),step=range[2]??1
    if(a<0&&b<0||a>=length&&b>=length)continue
    a=Math.min(length-1,Math.max(0,a));b=Math.min(length-1,Math.max(0,b))
    step=step>0?step:-step<length?step+length:1
    for(let i=a;b>=a?i<=b:i>=b;i+=(b>=a?step:-step))result.add(i)
  }
  return [...result]
}
function jsonTokens(rule){
  rule=rule.replace(/^\$\.\[/,'$[')
  const tokens=rule.slice(1).match(/\.\.(?=\[)|\.{1,2}[\w-]+|\.\*|\[\?\(@(?:\.[\w-]+)+(?:\s*(?:==|!=|<=|>=|<|>)\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|true|false|null))?\s*\)\]|\[-?\d+\]|\[\*\]|\[-?\d*:-?\d*(?::-?\d+)?\]/g)||[]
  if(!rule.startsWith('$')||'$'+tokens.join('')!==rule||tokens.length>100||tokens.some(t=>t.includes(':')&&t.slice(1,-1).split(':').length===3&&Number(t.slice(1,-1).split(':')[2])===0))fail(400,'仅支持属性、递归属性、数组下标、切片和通配符 JSONPath')
  return tokens
}
function filterValue(value,token){
  const match=token.match(/^\[\?\(@((?:\.[\w-]+)+)(?:\s*(==|!=|<=|>=|<|>)\s*([\s\S]+?))?\s*\)\]$/)
  let exists=true
  for(const key of match[1].slice(1).split('.')){if(!value||typeof value!=='object'||!Object.hasOwn(value,key)){exists=false;break}value=value[key]}
  if(!match[2])return exists
  if(!exists)return false
  const expected=JSON5.parse(match[3])
  switch(match[2]){case '==':return value===expected;case '!=':return value!==expected;case '<':return typeof value===typeof expected&&value<expected;case '>':return typeof value===typeof expected&&value>expected;case '<=':return typeof value===typeof expected&&value<=expected;case '>=':return typeof value===typeof expected&&value>=expected}
}
function sliceValues(value,token){
  if(!Array.isArray(value))return []
  const parts=token.slice(1,-1).split(':'),step=parts[2]===undefined?1:Number(parts[2]),length=value.length
  const index=(v,fallback)=>v===''?fallback:Math.max(step>0?0:-1,Math.min(step>0?length:length-1,Number(v)<0?length+Number(v):Number(v)))
  const start=index(parts[0],step>0?0:length-1),end=index(parts[1],step>0?length:-1),result=[]
  for(let i=start;step>0?i<end:i>end;i+=step){result.push(value[i]);if(result.length>5001)fail(422,'JSONPath 切片超过条目上限')}
  return result
}
function jsonValues(root, rule) {
  rule=rule.replace(/^\$\.\[/,'$[').replace(/\.\*(?=\.|\[|$)/g,'[*]')
  let values = [root]
  const tokens = jsonTokens(rule)
  for (const token of tokens) {
    if(token==='..'){const found=[],pending=[...values].reverse();let visited=0;while(pending.length){const value=pending.pop();if(++visited>100000)fail(422,'递归 JSONPath 超过节点限制');if(value&&typeof value==='object'){found.push(value);pending.push(...Object.values(value).filter(v=>v&&typeof v==='object').reverse())}}values=found;continue}
    if(token.startsWith('..')){const found=[],pending=[...values].reverse();let visited=0;while(pending.length){const value=pending.pop();if(++visited>100000)fail(422,'递归 JSONPath 超过节点限制');if(value&&typeof value==='object'){if(Object.hasOwn(value,token.slice(2)))found.push(value[token.slice(2)]);pending.push(...Object.values(value).filter(v=>v&&typeof v==='object').reverse())}}values=found;continue}
    values = values.flatMap(value => token === '[*]' ? (value&&typeof value==='object'?Object.values(value):[]) : token.startsWith('[?(')?(value&&typeof value==='object'?Object.values(value).filter(v=>filterValue(v,token)):[]):token.includes(':')?sliceValues(value,token):[value?.[token.startsWith('.') ? token.slice(1) : Number(token.slice(1,-1))<0&&Array.isArray(value)?value.length+Number(token.slice(1,-1)):Number(token.slice(1,-1))]]).filter(v => v !== undefined && v !== null)
    if(values.length>10000)fail(422,'JSONPath 结果超过条目上限')
  }
  return values
}
export function document(text,metadata={}) {
  if (/^\s*[\[{]/.test(text)) { try { return { json: JSON.parse(text), raw:text,...metadata } } catch { /* HTML with leading punctuation */ } }
  const $ = load(text); $('script,style,iframe,object,noscript').remove(); return { $, root: $.root(), raw:text,...metadata }
}
// Classify only explicit page-level evidence, not words in a novel paragraph.
export function checkedDocument(text,metadata) {
  const context=document(text,metadata)
  if(context.json&&!Array.isArray(context.json)){
    const value=context.json,code=Number(value.code),empty=value.data==null||value.data===false||typeof value.data==='object'&&!Object.keys(value.data).length
    if(Object.hasOwn(value,'code')&&Number.isFinite(code)&&![0,1,200].includes(code)&&empty&&typeof (value.message??value.msg)==='string')throw Object.assign(new Error(`书源接口返回错误（上游代码 ${code}），请核对当前接口参数、版本或登录要求；这不是无搜索结果`),{status:422,code:'SOURCE_API_ERROR',phase:'api'})
  }
  if(context.$){
    const title=context.$('title').text().trim()
    const verification=/^(just a moment|attention required|access denied|security (check|verification)|verify you are human|人机验证|安全验证|访问验证|请完成验证)/i.test(title)
    const login=/^(登录|用户登录|会员登录|sign in|log in|login)(\b|\s|[-_|：:]|$)/i.test(title)&&context.$('input[type=password]').length>0
    if(verification||login)throw Object.assign(new Error(verification?'站点返回人机验证页，需在站点完成验证；本次未判定书源失效':'站点返回登录页，当前书源需要登录访问'),{status:422,code:verification?'VERIFICATION_PAGE':'LOGIN_PAGE',phase:'parse',pageType:verification?'verification':'login'})
    if(/^(?:404(?:\s+not found)?|page not found|页面不存在|网页不存在|找不到页面)(?:\s*[-|_].*)?$/i.test(title))throw Object.assign(new Error('站点返回错误页面（HTTP 成功不代表内容有效）'),{status:422,code:'ERROR_PAGE',phase:'parse',pageType:'error'})
  }
  return context
}
function regexMatches(value,rule) {
  if(rule.length>1000)fail(400,'正则列表规则过长')
  let matcher
  try{matcher=RE2JS.compile(rule.slice(1)).matcher(value)}catch{fail(400,'正则列表暂不兼容（仅支持 RE2 正则）')}
  const rows=[]
  while(matcher.find()){
    if(rows.length>=5001)break
    rows.push({raw:matcher.group(),captures:Array.from({length:matcher.groupCount()+1},(_,i)=>matcher.group(i)||'')})
  }
  return rows
}
export function infoContext(context,rules) {
  if(!rules.init)return context
  const rows=ruleList(context,rules.init)
  if(!rows.length)fail(422,'详情初始化规则未匹配到内容')
  return rows[0]
}
function select(context, rule) {
  let root = context.root
  for (const atom of splitRule(rule.trim().replace(/^@css:/i, ''),'@').map(s=>s.trim()).filter(Boolean)) {
    const {css,indexes,ranges,exclude,ownText,children} = selector(atom),nodes=[]
    for(const parent of root.toArray()) {
      const current=context.$(parent)
      let found=children?current.children():current.filter(css).add(current.find(css))
      if(ownText!==null)found=found.filter((_,el)=>context.$(el).contents().filter((_,n)=>n.type==='text').text().includes(ownText))
      const array=found.toArray(),selected=selectedIndexes(array.length,indexes,ranges)
      nodes.push(...(selected?(exclude?array.filter((_,i)=>!selected.includes(i)):selected.map(i=>array[i])):array))
    }
    root=context.$([...new Set(nodes)])
  }
  return root
}
export function ruleList(context, rule) {
  rule=rule.trim().replace(/^@json:/i,'')
  if(rule.startsWith(':'))return regexMatches(context.raw||context.root?.toString()||'',rule)
  for (const alternative of splitRule(rule,'||')) {
    const metadata={baseUrl:context.baseUrl,sourceUrl:context.sourceUrl,runtimeSource:context.runtimeSource,book:context.book}
    const result = splitRule(alternative,'&&').flatMap(part => {
      const interleaved=splitRule(part,'%%')
      if(interleaved.length>1){const lists=interleaved.map(part=>ruleList(context,part)),out=[];for(let i=0;i<Math.max(...lists.map(v=>v.length));i++)for(const list of lists)if(i<list.length)out.push(list[i]);return out}
      return isXPath(part)?xpathRows(context,part):part.startsWith('$')||context.json&&/^(?:\.|[\w-])/.test(part) ? jsonValues(context.json, part.startsWith('$')?part:part.startsWith('.')?'$'+part:'$.'+part).flatMap(v=>Array.isArray(v)?v:[v]).map(json=>({json,...metadata})) : select(context,part).toArray().map(element=>({$:context.$,root:context.$(element),...metadata}))
    })
    if (result.length) return result
  }
  return []
}
export function ruleText(context, rule = '') {
  if (!rule) return ''
  rule=rule.trim().replace(/^@json:/i,'')
  const script=scriptRule(rule)
  if(script){const value=script.before?ruleText(context,script.before):(context.raw||context.root?.toString()||'');const result=textExpression(script.code,{result:value,baseUrl:context.baseUrl||'',book:{origin:context.sourceUrl||''}}),out=result===null||result===undefined?'':String(result);return script.after?replacement(out,script.after):out}
  if(rule.includes('{{')){checkRule(rule);const expression=rule.split('##')[0],value=expression.replace(/\{\{([\s\S]*?)\}\}/g,(_,part)=>/^(?:\$|@@)/.test(part)?ruleText(context,part.replace(/^@@/,'')):String(textExpression(part,{baseUrl:context.baseUrl||'',book:{origin:context.sourceUrl||''}})??''));return rule.includes('##')?replacement(value,rule.slice(rule.indexOf('##'))):value}
  const [expression] = rule.split('##')
  let value = expression ? '' : (context.raw||context.root?.toString()||'')
  if(!expression)return replacement(value,rule)
  for (const alternative of splitRule(expression,'||')) {
    value = splitRule(alternative,'&&').map(part => {
      part=part.trim()
      const interleaved=splitRule(part,'%%')
      if(interleaved.length>1){const lists=interleaved.map(r=>ruleText(context,r).split('\n').filter(Boolean)),rows=[];for(let i=0;i<Math.max(...lists.map(v=>v.length));i++)for(const list of lists)if(i<list.length)rows.push(list[i]);return rows.join('\n')}
      if(isXPath(part))return xpathText(context,part)
      if(/^\$\d+(?:[^$]*\$\d+)*$/.test(part))return part.replace(/\$(\d+)/g,(_,n)=>context.captures?.[Number(n)]||'')
      if (part.startsWith('$')) return jsonValues(context.json,part).filter(v=>['string','number'].includes(typeof v)).join('\n')
      if(context.json&&part.startsWith('.'))return jsonValues(context.json,'$'+part).filter(v=>['string','number'].includes(typeof v)).join('\n')
      if (!context.$) return context.json&&Object.hasOwn(context.json,part)?String(context.json[part]??''):part==='text'?context.raw||'':''
      const atoms = splitRule(part.trim().replace(/^@css:/i,''),'@'), attr = atoms.length > 1 ? atoms.pop() : (['text','textNodes','html','all','ownText','href','src','content'].includes(part) ? atoms.pop() : 'text')
      const elements = atoms.length ? select(context,atoms.join('@')) : context.root
      return elements.toArray().map(element => {
        const el = context.$(element)
        if (attr === 'html' || attr === 'all') {
          const copy = load(el.html() || ''); copy('script,style,iframe,object').remove(); copy('br').replaceWith('\n'); copy('p,div,li').prepend('\n').append('\n')
          return copy.root().text()
        }
        if (attr === 'ownText') return el.contents().filter((_,n)=>n.type==='text').text()
        if (attr === 'textNodes') return el.contents().filter((_,n)=>n.type==='text').toArray().map(n=>context.$(n).text().trim()).filter(Boolean).join('\n')
        return attr === 'text' ? el.text() : el.attr(attr) || ''
      }).join('\n')
    }).filter(Boolean).join('\n').trim()
    if (value) break
  }
  return rule.includes('##') ? replacement(value,rule.slice(rule.indexOf('##'))) : value
}
export function normalizeSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400,'书源应为 JSON 对象')
  let repairedPhone=false
  if(raw.bookSourceUrl?.replace(/\/$/,'')==='https://www.shoujix.com'&&raw.searchUrl?.startsWith('/modules/article/search.php')&&raw.ruleSearch?.bookList==='class.novel-item'){
    raw=structuredClone(raw);repairedPhone=true
    raw.searchUrl='/search/,{method:"POST",charset:"gbk",body:"searchkey={{key}}"}'
    raw.ruleSearch={...raw.ruleSearch,bookList:'li:has(.s2 a)||class.novel-item',name:'.s2 a@text||img@alt',bookUrl:'.s2 a@href||a.0@href',author:'.s4@text||class.novel-author.0@text'}
    raw.ruleBookInfo={...raw.ruleBookInfo,name:'#info h1@text',author:'#info p.0@text##作\\s*者[：:]\\s*'}
    raw.ruleToc={...raw.ruleToc,chapterList:'//div[@id="list" or @id="lbks"]/dl/dt[last()]/following-sibling::dd/a',nextTocUrl:''}
    raw.ruleContent={...raw.ruleContent,content:'#content@html||#zjny@html',nextContentUrl:'a:contains(下一页).0@href'}
  }
  const verifiedMoves={'https://www.sudugu.co':'https://www.sudugu.cc','https://m.aitbooks.com':'https://m.aitbooks.cc'}
  const movedTo=verifiedMoves[raw.bookSourceUrl?.replace(/\/$/,'')]
  if(movedTo&&raw.searchUrl?.startsWith('/')){raw=structuredClone(raw);raw.searchUrl=movedTo+raw.searchUrl}
  if(movedTo==='https://www.sudugu.cc'){raw=structuredClone(raw);raw.ruleToc={...raw.ruleToc,chapterList:'#list a[href$=".html"]'}}
  let identity,requestURL,alias=false
  try{identity=sourceIdentity(raw.bookSourceUrl);requestURL=sourceURL(raw.bookSourceUrl)}catch(error){
    // Some Legado exports use a plain label as the source key while declaring
    // an absolute HTTP(S) search endpoint. Preserve the old placeholder ID.
    if(typeof raw.bookSourceUrl!=='string'||!/^[-\w]{1,80}#?$/.test(raw.bookSourceUrl)||typeof raw.searchUrl!=='string'||!/^https?:\/\//.test(raw.searchUrl))throw error
    requestURL=sourceURL(raw.searchUrl.split(/,\s*\{/)[0].replace(/\{\{[^}]+\}\}/g,'fixture'));identity=raw.bookSourceUrl;alias=true
  }
  const name = text(raw.bookSourceName,100,'书源名称').trim(),url=alias?requestURL.origin:requestURL.pathname==='/'&&!requestURL.search?requestURL.origin:requestURL.href
  if (raw.bookSourceType && raw.bookSourceType !== 0) fail(400,'当前仅支持文字小说书源')
  const warnings=alias?['已识别非 URL 书源标识，请求来源取明确的搜索接口，未更换原标识']:[]
  if(movedTo)warnings.push('已核验现站入口：'+movedTo+'；直接提交搜索，避免旧域名 301 丢失 POST 正文')
  const login={ui:[]}
  if(raw.loginUrl){let value=raw.loginUrl
    // Some old exporters wrote an empty UI descriptor in the script field.
    // Accept only this inert shape; do not silently discard a real login script.
    if(typeof value==='string'&&/^\s*\{/.test(value)){try{const object=JSON5.parse(value);if(Object.keys(object).length===1&&typeof object.url==='string'){value=['','null'].includes(object.url.trim())?'':object.url;warnings.push('已识别旧导出器的登录地址描述')}}catch{}}
    if(value){if(/^https?:\/\//.test(value)){login.url=sourceURL(value).href;warnings.push('书源有登录入口；需要登录时请配置此账号的 Cookie')}else{validateScript(value);login.script=value}}
  }
  if(raw.jsLib){validateScript(raw.jsLib);login.library=raw.jsLib}
  if(raw.loginCheckJs){validateScript(raw.loginCheckJs);login.checkScript=raw.loginCheckJs}
  if(raw.novelStudioLoginRequired!==undefined){if(typeof raw.novelStudioLoginRequired!=='boolean')fail(400,'登录要求应为布尔值');login.required=raw.novelStudioLoginRequired}
  if(raw.loginUi){let ui;try{ui=typeof raw.loginUi==='string'?JSON.parse(raw.loginUi):raw.loginUi}catch{fail(400,'登录界面应为 JSON 数组')};if(!Array.isArray(ui)||ui.length>40)fail(400,'登录界面字段过多');login.ui=ui.map(item=>{const name=text(item.name,100,'登录字段名称'),type=['text','password','button'].includes(item.type)?item.type:'text';if(item.action)validateScript(item.action);return {name,type,...(item.action?{action:item.action}:{})}})}
  let headers={}
  let headerScript=''
  let importCookie=''
  if(raw.header) {
    let value=raw.header
    const dynamic=typeof value==='string'&&/^(?:@js:|<js>)/.test(value.trim())?scriptRule(value.trim()):null
    if(dynamic){if(dynamic.before||dynamic.after)fail(400,'请求头脚本格式错误');validateScript(dynamic.code);headerScript=dynamic.code;value={}}
    try {if(typeof value==='string') value=JSON5.parse(value)}catch{fail(400,'请求头应为 JSON 对象或隔离脚本')}
    value={...value};for(const key of Object.keys(value))if(key.toLowerCase()==='cookie'){importCookie=text(value[key],16384,'Cookie');delete value[key]}
    try{headers=sourceHeaders(value,url)}catch(error){throw unsupported(error.message,'headers')}
    if(Object.keys(value).some(k=>k.toLowerCase()==='connection'))warnings.push('连接管理由阅读服务处理，已忽略 Connection 请求头')
  }
  let search = text(raw.searchUrl,3000,'搜索地址')
  let searchScript=''
  // A legacy exporter wrapped a literal request as invalid JavaScript. Repair
  // only that exact, unambiguous form; do not relax JavaScript syntax globally.
  const malformed=search.match(/^<js>(\/[^\r\n]*?,\s*\{[\s\S]*\});\s*result\s*=\s*'';\s*result;?\s*<\/js>$/)
  if(malformed){search=malformed[1];warnings.push('已兼容旧版导出器的静态请求脚本包装')}
  if(/^(?:@js:|<js>)/.test(search)){
    const embedded=embeddedScript(search),script=scriptRule(search)||embedded
    if(!script||script.before)throw unsupported('搜索前置脚本','script')
    if(script.after){validateScript(script.code);searchScript=script.code+'\n'+JSON.stringify(script.after);search='/'}
    else {
    try{checkExpression(script.code);search=String(textExpression(script.code,{baseUrl:url,key:'{{key}}',page:'{{page}}'}))}catch{validateScript(script.code);searchScript=script.code;search='/'}
    }
  }
  const split = search.indexOf(',{') >= 0 ? search.indexOf(',{') : search.search(/,\s*\{/)
  let options = {}
  try { if (split >= 0) options = JSON5.parse(search.slice(split+1)) } catch { fail(400,'搜索请求选项格式错误') }
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail(400,'搜索请求选项应为对象')
  validateRequestOptions(options)
  if(options.webJs)validateScript(options.webJs)
  let searchHeaders={}
  if(options.headers){try{searchHeaders=sourceHeaders(options.headers,url)}catch(error){throw unsupported(error.message,'headers')}}
  const method = String(options.method || 'GET').toUpperCase(), charset = String(options.charset || 'utf-8').toLowerCase()
  if (!['GET','POST'].includes(method) || !['utf-8','utf8','gbk','gb2312','gb18030'].includes(charset)) fail(400,'搜索方法或编码暂不兼容')
  const address = split >= 0 ? search.slice(0,split) : search
  const body = String(options.body || '')
  for (const template of [address,body]) {
    if(/<js>|@js:/i.test(template))throw unsupported('搜索地址中的交错脚本','template')
    const expressions=templateParts(template)
    if(template.replace(/\{\{[\s\S]*?\}\}/g,'').includes('{{'))throw unsupported('搜索模板未闭合','template')
    for(const part of expressions)checkExpression(part[1])
  }
  if (method === 'GET' && body) fail(400,'GET 搜索应将参数放在地址中')
  const config = { name,url,...(identity!==url?{identity}:{}),enabled:true,search:{address,method,charset,body,...(options.webView?{webView:true}:{}),...(options.webJs?{webJs:options.webJs}:{}),...(searchScript?{script:searchScript}:{}),...(Object.keys(searchHeaders).length?{headers:searchHeaders}:{})},rules:{},warnings,...(headerScript?{headerScript}:{}),...(Object.keys(headers).length?{headers}:{}),...(Object.keys(login).length>1||login.ui.length?{login}:{}) }
  if(repairedPhone){config.search.minBytes=10;warnings.push('已按现站修复搜索、目录与分页正文；搜索词至少 10 个 GBK 字节')}
  if(movedTo==='https://www.sudugu.cc'||raw.novelStudioDirectBookResult===true)config.search.directBookResult=true
  if(movedTo==='https://www.sudugu.cc'){config.preferNewerDuplicateChapter=true;warnings.push('现站同名编号章节的旧空占位记录采用较新数字 ID，保留阅读章节身份')}
  if(raw.bookSourceComment&&/source\.bookSourceComment/.test(JSON.stringify([raw.ruleSearch,raw.ruleContent,raw.searchUrl])))config.comment=text(raw.bookSourceComment,30000,'书源前置代码')
  const explicitOrigins=[...new Set((JSON.stringify([raw.searchUrl,raw.ruleSearch,raw.ruleBookInfo,raw.ruleToc,raw.ruleContent,raw.loginUrl,raw.jsLib]).match(/https?:\/\/[\w.-]+/g)||[]).filter(s=>s!==requestURL.origin))]
  const allowedOrigins=sourceOrigins([...new Set([...(raw.novelStudioAllowedOrigins||[]),...explicitOrigins])])
  const authorization=normalizeAuthorization(raw.novelStudioAuth,url,login.ui,allowedOrigins)
  if(authorization){login.authorization=authorization;config.login=login}
  if(allowedOrigins.length){config.allowedOrigins=allowedOrigins;warnings.push('规则中声明的外部请求域名：'+allowedOrigins.join('、'))}
  const groups = { ruleSearch:['bookList','name','author','bookUrl','intro','kind'],ruleBookInfo:['init','name','author','intro','kind','tocUrl'],ruleToc:['chapterList','chapterName','chapterUrl','nextTocUrl','isVolume'],ruleContent:['content','nextContentUrl','replaceRegex'] }
  for (const [group,fields] of Object.entries(groups)) {
    const source = raw[group] || {}; config.rules[group] = {}
    for (const [key,val] of Object.entries(source)) if (val && !fields.includes(key)) config.warnings.push(`${group}.${key} 已跳过`)
    for (const field of fields) if (source[field]) {try{ if (field === 'replaceRegex') checkReplacement(source[field]); else checkRule(source[field],['bookList','chapterList'].includes(field)); config.rules[group][field]=source[field]}catch(error){
      if(!['bookList','chapterList'].includes(field)&&error.message==='替换规则暂不兼容（仅支持 RE2 正则）'){
        try{const adapted=sandboxReplacementRule(source[field]);checkRule(adapted);config.rules[group][field]=adapted;warnings.push(`${group}.${field} 复杂正则使用隔离脚本限时执行`);continue}catch{/* Preserve the original diagnostic when adaptation is not exact. */}
      }
      if(['bookList','chapterList'].includes(field)&&error.message==='正则列表暂不兼容（仅支持 RE2 正则）'){
        try{const adapted=sandboxListRule(source[field]);checkRule(adapted,true);config.rules[group][field]=adapted;warnings.push(`${group}.${field} 复杂正则使用隔离脚本限时执行`);continue}catch{/* Keep the original diagnostic. */}
      }
      error.field=group+'.'+field;throw error
    } }
  }
  // Init/webJs affect required semantics: do not silently run a different rule.
  if(raw.ruleContent?.webJs){validateScript(raw.ruleContent.webJs);config.rules.ruleContent.webJs=raw.ruleContent.webJs;warnings.push('正文使用受控浏览器执行网页脚本')}
  const contentScript=scriptRule(raw.ruleContent?.content||'')
  if(contentScript&&!contentScript.before&&!contentScript.after&&!/\bresult\b/.test(contentScript.code)&&/\bjava\.ajax\s*\(/.test(contentScript.code)){config.scriptOnlyContent=true;warnings.push('正文脚本自行请求内容，不预先请求其虚拟章节标识')}
  for (const [group,field] of [['ruleContent','sourceRegex'],['ruleToc','preUpdateJs']]) if (raw[group]?.[field]) throw unsupported(`${group}.${field}`,'script')
  for (const [group,field] of [['ruleSearch','bookList'],['ruleSearch','name'],['ruleSearch','bookUrl'],['ruleToc','chapterList'],['ruleToc','chapterName'],['ruleToc','chapterUrl'],['ruleContent','content']]) if (!config.rules[group][field]) fail(400,`缺少 ${group}.${field}`)
  if (raw.exploreUrl || raw.ruleExplore?.bookList) config.warnings.push('发现/榜单规则暂未启用，使用书名或作者搜索')
  if(/data:;base64/.test(raw.ruleToc?.chapterList||''))config.virtualChapters=true
  config.id = digest(alias?'invalid-source:'+identity:identity).slice(0,32); config.version = digest(JSON.stringify(config)); searchRequest(config,'测试',1)
  if(importCookie)Object.defineProperty(config,'importCookie',{value:importCookie,enumerable:false})
  return config
}
export function searchRequest(source,key,page) {
  const encoded = [...iconv.encode(key,source.search.charset)].map(b=>(b>=48&&b<=57)||(b>=65&&b<=90)||(b>=97&&b<=122)||[45,46,95,126].includes(b)?String.fromCharCode(b):`%${b.toString(16).padStart(2,'0').toUpperCase()}`).join('')
  const substitute = template => template.replace(/\{\{([\s\S]*?)\}\}/g,(_,expression)=>String(textExpression(expression,{key:encoded,page,baseUrl:source.url})??''))
  const url = sourceURL(substitute(source.search.address),source.url)
  checkSourceOrigin(url,source.url,source.allowedOrigins)
  return {url:url.href,method:source.search.method,charset:source.search.charset,body:substitute(source.search.body),scope:source.url,allowedOrigins:source.allowedOrigins,headers:{...source.headers,...source.search.headers}}
}
export function contentText(context, rules) { return replacement(ruleText(context,rules.content),rules.replaceRegex).replace(/\r/g,'').replace(/[\t \u00a0]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim() }
