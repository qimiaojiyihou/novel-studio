import xpath from 'xpath'
import {DOMImplementation,XMLSerializer} from '@xmldom/xmldom'
import {load} from 'cheerio'
import {unsupported} from './source-expression.js'

const documents=new WeakMap(),serializer=new XMLSerializer()
export const isXPath=rule=>/^(?:@XPath:|\/|\.\/|\(\/|string\(|normalize-space\()/i.test(rule.trim())
export function checkXPath(rule) {
  const expression=rule.trim().replace(/^@XPath:/i,'').replace(/(?:@html|\/html\(\))$/,'')
  const structure=expression.replace(/'[^']*'|"[^"]*"/g,'""')
  // Bound the supported XPath grammar as well as the input DOM. In particular,
  // descendants nested in predicates can turn a single request quadratic.
  if(expression.length>1000||/\$|\[\s*[^\]]*\/\/|\[([^\[\]]*\[){2}/.test(structure))throw unsupported('XPath 动态变量或过深谓词','xpath')
  for(const call of structure.matchAll(/([\w-]+)\s*\(/g))if(!['text','node','last','position','contains','starts-with','normalize-space','string','not'].includes(call[1]))throw unsupported(`XPath 函数 ${call[1]}`,'xpath')
  try{xpath.parse(expression)}catch{throw Object.assign(new Error('XPath 规则语法错误'),{status:400,code:'RULE_INVALID',capability:'xpath',phase:'parse'})}
  return expression
}
function nodeFor(context){
  if(context.xpathNode)return context.xpathNode
  if(documents.has(context))return documents.get(context)
  // Build from the already normalized HTML tree. Reparsing HTML as XML breaks
  // void tags such as meta/br and may change table contexts.
  const doc=new DOMImplementation().createDocument(null,'',null)
  let count=0,ordinal=0
  const positions=new WeakMap()
  // XPath sorts result sets frequently. The generic DOM comparison scans wide
  // sibling lists; immutable preorder intervals make those comparisons O(1).
  const originalCompare=doc.compareDocumentPosition
  function compare(other){
    if(this===other)return 0
    const a=positions.get(this),b=positions.get(other)
    if(!a||!b)return originalCompare.call(this,other)
    if(a.start<b.start)return 4|(b.start<a.end?16:0)
    return 2|(a.start<b.end?8:0)
  }
  function register(node){positions.set(node,{start:ordinal++,end:ordinal});node.compareDocumentPosition=compare}
  register(doc)
  function append(parent,node,depth=0){
    if(++count>30000||depth>150)throw Object.assign(new Error('XPath 页面节点数量或深度超过限制'),{status:422,code:'RULE_LIMIT',phase:'parse'})
    if(node.type==='root'){for(const child of node.children||[])append(parent,child,depth+1);return}
    if(node.type==='text'){const text=doc.createTextNode(node.data);register(text);parent.appendChild(text);return}
    if(node.type!=='tag')return
    const element=doc.createElement(node.name)
    register(element)
    for(const [name,value] of Object.entries(node.attribs||{}))if(/^[A-Za-z_][\w.:-]*$/.test(name)){element.setAttribute(name,value);register(element.getAttributeNode(name))}
    parent.appendChild(element)
    for(const child of node.children||[])append(element,child,depth+1)
    positions.get(element).end=ordinal
  }
  const nodes=context.root.toArray().flatMap(n=>n.type==='root'?n.children:[n]).filter(n=>n.type==='tag')
  if(nodes.length===1)append(doc,nodes[0])
  else {const wrapper=doc.createElement('novel-root');register(wrapper);doc.appendChild(wrapper);for(const node of nodes)append(wrapper,node);positions.get(wrapper).end=ordinal}
  positions.get(doc).end=ordinal
  documents.set(context,doc);return doc
}
export function xpathValues(context,rule){
  const expression=checkXPath(rule)
  if(!context.$&&!context.xpathNode)return []
  let result
  try{result=xpath.select(expression,nodeFor(context))}catch{throw Object.assign(new Error('XPath 规则执行失败'),{status:422,code:'RULE_PARSE_FAILED',phase:'parse'})}
  return (Array.isArray(result)?result:[result]).slice(0,5001)
}
export function xpathText(context,rule){return xpathValues(context,rule).map(n=>{
  if(typeof n!=='object')return String(n)
  if(/(?:@html|\/html\(\))$/.test(rule)&&n.nodeType===1){
    const $=load(serializer.serializeToString(n),{xml:true},false)
    $('script,style,iframe,object').remove();$('br').replaceWith('\n');$('p,div,li').append('\n')
    return $.root().text()
  }
  return n.nodeType===2?n.value:n.textContent
}).filter(v=>v!==null&&v!==undefined).join('\n')}
export function xpathRows(context,rule){return xpathValues(context,rule).map(node=>{
  if(typeof node!=='object'||node.nodeType!==1)return {raw:typeof node==='object'?node.nodeValue:String(node),baseUrl:context.baseUrl,sourceUrl:context.sourceUrl}
  const $=load(serializer.serializeToString(node),{xml:true},false)
  return {$,root:$.root().children(),xpathNode:node,baseUrl:context.baseUrl,sourceUrl:context.sourceUrl}
})}
