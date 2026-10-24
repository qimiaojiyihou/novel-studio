import {parse} from 'acorn'
import {RE2JS} from 're2js'

export function unsupported(message, capability='rule') {
  return Object.assign(new Error(`应用暂未支持：${message}`),{status:400,code:'RULE_UNSUPPORTED',capability,phase:'parse'})
}
const cache=new Map(), maxLength=2*1024*1024
const methods=new Set(['replace','replaceAll','match','test','slice','substring','trim','includes','startsWith','endsWith','toLowerCase','toUpperCase','join'])
const forbidden=new Set(['__proto__','prototype','constructor'])
function program(code) {
  if(cache.has(code))return cache.get(code)
  if(code.length>3000)throw unsupported('脚本超过 3000 字符','script')
  let tree;try{tree=parse(code,{ecmaVersion:2022})}catch{throw unsupported('JavaScript 语法','script')}
  const names=new Set(['result','baseUrl','book','key','page','String','Number','parseInt','Math','undefined']),allowed=new Set(['Program','ExpressionStatement','VariableDeclaration','VariableDeclarator','Identifier','Literal','TemplateLiteral','TemplateElement','BinaryExpression','LogicalExpression','UnaryExpression','ConditionalExpression','MemberExpression','CallExpression','AssignmentExpression','EmptyStatement','IfStatement','BlockStatement','ArrayExpression'])
  let count=0
  function visit(n,depth=0) {
    if(!n)return
    if(++count>250||depth>30||!allowed.has(n.type))throw unsupported('脚本仅支持有界的文本提取、替换和条件表达式','script')
    if(n.type==='VariableDeclarator') {if(n.id.type!=='Identifier')throw unsupported('脚本解构赋值','script');names.add(n.id.name)}
    if(n.type==='Identifier'&&!names.has(n.name))throw unsupported(`脚本标识符 ${n.name.slice(0,40)}`,'script')
    if(n.type==='Literal'&&n.regex){try{RE2JS.compile(n.regex.pattern,regexFlags(n.regex.flags))}catch{throw unsupported('脚本正则仅支持 RE2 语法','script')}}
    if(n.type==='MemberExpression') {
      if(!n.computed&&forbidden.has(n.property.name))throw unsupported('脚本对象访问','script')
    }
    if(n.type==='AssignmentExpression'){
      if(n.operator!=='='||n.left.type!=='Identifier'||['baseUrl','book','key','page','Math','String','Number','parseInt','undefined'].includes(n.left.name))throw unsupported('脚本仅允许局部变量赋值','script')
      names.add(n.left.name)
    }
    if(names.size>45)throw unsupported('脚本局部变量过多','script')
    if(n.type==='CallExpression') {
      const f=n.callee
      if(f.type==='Identifier'&&!['String','Number','parseInt'].includes(f.name))throw unsupported('脚本函数调用','script')
      if(f.type==='MemberExpression'&&(f.computed||!(methods.has(f.property.name)||(f.object.name==='Math'&&['round','floor','ceil','min','max','abs'].includes(f.property.name)))))throw unsupported('脚本方法调用','script')
      if(!['Identifier','MemberExpression'].includes(f.type))throw unsupported('脚本函数调用','script')
    }
  }
  // Explicit traversal avoids host evaluation, including validation of dead branches.
  function walk(n,depth=0){
    if(!n)return
    visit(n,depth)
    for(const [k,v] of Object.entries(n)){if(k==='property'&&n.type==='MemberExpression'&&!n.computed)continue;if(v?.type)walk(v,depth+1);else if(Array.isArray(v))for(const child of v)if(child?.type)walk(child,depth+1)}
  }
  walk(tree)
  if(cache.size>=500)cache.delete(cache.keys().next().value)
  cache.set(code,tree);return tree
}
function regexFlags(flags){if(/[^gimsu]/.test(flags))throw unsupported('正则标记','script');return (flags.includes('i')?RE2JS.CASE_INSENSITIVE:0)|(flags.includes('m')?RE2JS.MULTILINE:0)|(flags.includes('s')?RE2JS.DOTALL:0)}
export function checkExpression(code){program(code)}
export function textExpression(code,variables={}) {
  const env=Object.assign(Object.create(null),{result:'',baseUrl:'',book:Object.create(null),undefined},variables),tree=program(code)
  if(Object.values(env).some(v=>typeof v==='string'&&v.length>maxLength))throw unsupported('脚本输入超过限制','script')
  let steps=0
  function bounded(v){if(typeof v==='string'&&v.length>maxLength||Array.isArray(v)&&(v.length>5001||v.reduce((sum,item)=>sum+String(item??'').length,0)>maxLength))throw unsupported('脚本输出超过限制','script');return v}
  function run(n){
    if(!n)return undefined
    if(++steps>1000)throw unsupported('脚本运算超过限制','script')
    switch(n.type){
      case 'Program':case 'BlockStatement':{let v;for(const s of n.body){const x=run(s);if(x!==undefined)v=x}return v}
      case 'EmptyStatement':return undefined
      case 'ExpressionStatement':return run(n.expression)
      case 'VariableDeclaration':for(const d of n.declarations)env[d.id.name]=run(d.init);return undefined
      case 'Identifier':return env[n.name]
      case 'Literal':return n.regex?{pattern:n.regex.pattern,flags:n.regex.flags}:n.value
      case 'ArrayExpression':return bounded(n.elements.map(run))
      case 'TemplateLiteral':{let value='';for(let i=0;i<n.quasis.length;i++)value=bounded(value+n.quasis[i].value.cooked+(i<n.expressions.length?String(run(n.expressions[i])):''));return value}
      case 'AssignmentExpression':return env[n.left.name]=run(n.right)
      case 'IfStatement':return run(run(n.test)?n.consequent:n.alternate)
      case 'ConditionalExpression':return run(run(n.test)?n.consequent:n.alternate)
      case 'LogicalExpression':{const a=run(n.left);return n.operator==='&&'?(a&&run(n.right)):n.operator==='||'?(a||run(n.right)):(a??run(n.right))}
      case 'UnaryExpression':{const a=run(n.argument);if(n.operator==='!')return !a;if(n.operator==='-')return -a;if(n.operator==='+')return +a;if(n.operator==='typeof')return typeof a;throw unsupported('一元运算','script')}
      case 'BinaryExpression':{const a=run(n.left),b=run(n.right);switch(n.operator){case '+':return bounded(a+b);case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '===':return a===b;case '!==':return a!==b;case '==':return a==b;case '!=':return a!=b;case '>':return a>b;case '<':return a<b;case '>=':return a>=b;case '<=':return a<=b;default:throw unsupported('二元运算','script')}}
      case 'MemberExpression':{const obj=run(n.object),key=n.computed?run(n.property):n.property.name;if(forbidden.has(key))throw unsupported('对象访问','script');if(key==='length'&&(typeof obj==='string'||Array.isArray(obj)))return obj.length;if((typeof obj==='string'||Array.isArray(obj))&&/^\d+$/.test(String(key)))return obj[Number(key)];if(obj&&obj===env.book&&Object.hasOwn(obj,key))return obj[key];return undefined}
      case 'CallExpression':{
        const args=n.arguments.map(run),f=n.callee
        if(f.type==='Identifier'){if(f.name==='String')return bounded(String(args[0]??''));if(f.name==='Number')return Number(args[0]);return parseInt(args[0],args[1])}
        const method=f.property.name
        if(f.object.name==='Math')return Math[method](...args)
        const obj=run(f.object)
        if(method==='test'&&obj?.pattern!==undefined)return RE2JS.compile(obj.pattern,regexFlags(obj.flags)).matcher(String(args[0])).find()
        if(method==='join'&&Array.isArray(obj)){const separator=String(args[0]??',');if(obj.reduce((sum,v)=>sum+String(v).length+separator.length,0)>maxLength)throw unsupported('脚本输出超过限制','script');return obj.join(separator)}
        if(typeof obj!=='string')throw unsupported('脚本方法要求文本输入','script')
        if(['replace','replaceAll','match'].includes(method)){
          const pattern=args[0]
          if(pattern?.pattern!==undefined){
            const re=RE2JS.compile(pattern.pattern,regexFlags(pattern.flags)),m=re.matcher(obj)
            if(method==='match'){
              if(!m.find())return null
              if(!pattern.flags.includes('g'))return Array.from({length:m.groupCount()+1},(_,i)=>m.group(i))
              const out=[m.group()];while(m.find()){if(out.length>=5001)throw unsupported('正则匹配数量超限','script');out.push(m.group())}return out
            }
            const replacement=String(args[1]??'');if(replacement.length>4096||/\$[`'&]/.test(replacement))throw unsupported('替换输出超过限制','script')
            // Preflight the expansion before the regex engine allocates it.
            let size=obj.length
            while(m.find()) {size+=replacement.replace(/\$(\d+)/g,(_,n)=>m.group(Number(n))||'').length-(m.end()-m.start());if(size>maxLength)throw unsupported('替换输出超过限制','script');if(method==='replace'&&!pattern.flags.includes('g'))break}
            const matcher=re.matcher(obj)
            return bounded(method==='replaceAll'||pattern.flags.includes('g')?matcher.replaceAll(replacement):matcher.replaceFirst(replacement))
          }
          if(method==='match')throw unsupported('match 要求静态正则','script')
          const from=String(pattern??''),to=String(args[1]??'');if(to.length>4096||/\$[`'&]/.test(to)||method==='replaceAll'&&!from)throw unsupported('替换输出超过限制','script')
          if(method==='replaceAll'&&to.length>from.length&&obj.split(from).length*to.length>maxLength)throw unsupported('替换输出超过限制','script')
          return bounded(obj[method](from,to))
        }
        if(method==='join'||method==='test')throw unsupported('脚本方法输入类型','script')
        return bounded(String.prototype[method].apply(obj,args))
      }
      default:throw unsupported('脚本节点','script')
    }
  }
  try{return bounded(run(tree))}catch(error){if(error.code)throw error;throw Object.assign(new Error('文本脚本执行失败，请核对规则与页面内容'),{status:422,code:'RULE_PARSE_FAILED',phase:'parse',capability:'script'})}
}
