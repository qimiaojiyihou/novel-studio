import {parse} from 'acorn'
import {load} from 'cheerio'

// Recognize only an otherwise empty loading page with one literal navigation.
// No imported script is evaluated here; every resulting URL goes back through
// the normal origin, HTTPS, redirect-count and DNS-pinning checks.
export function literalPageRedirect(html){
  if(html.length>20000||!/<script/i.test(html))return null
  const $=load(html),title=$('title').text().trim(),scripts=$('script')
  if(!/^(?:Loading\.{0,3}|正在跳转[.。…]*|Redirecting[.。…]*)$/i.test(title)||scripts.length!==1||$('body').clone().find('script,style').remove().end().text().trim())return null
  let ast;try{ast=parse(scripts.text(),{ecmaVersion:2022})}catch{return null}
  if(ast.body.length!==1||ast.body[0].type!=='ExpressionStatement')return null
  const expr=ast.body[0].expression,path=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'&&!node.computed?path(node.object)+'.'+node.property.name:''
  let value
  if(expr.type==='CallExpression'&&/^(?:window\.)?location\.(?:replace|assign)$/.test(path(expr.callee))&&expr.arguments.length===1)value=expr.arguments[0]
  if(expr.type==='AssignmentExpression'&&expr.operator==='='&&/^(?:window\.)?location(?:\.href)?$/.test(path(expr.left)))value=expr.right
  return value?.type==='Literal'&&typeof value.value==='string'&&value.value.length<=2048?value.value:null
}
