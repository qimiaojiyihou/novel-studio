// Translate Java's inline i/m/s flags at their lexical scope, rather than
// stripping flags or applying them to earlier alternatives. Matching still runs
// only in the resource-limited QuickJS worker. Unsupported flag families fail.
export function portableSourceRegex(input){
  let out='',state={i:false,m:false,s:false},stack=[]
  const horizontal='\\t \\u00a0\\u1680\\u180e\\u2000-\\u200a\\u202f\\u205f\\u3000'
  const insensitive=c=>{const lower=c.toLowerCase(),upper=c.toUpperCase();if(lower===upper)return c;if(!/^[a-z]$/i.test(c))throw Error('Unicode case flags need Java semantics');return '['+lower+upper+']'}
  const flags=(on,off)=>{const value={...state};for(const c of on)value[c]=true;for(const c of off||'')value[c]=false;return value}
  for(let i=0;i<input.length;i++){
    const c=input[i]
    if(c==='\\'){
      const next=input[++i];if(!next)throw Error('trailing escape')
      if(next==='h'||next==='H')out+='['+(next==='H'?'^':'')+horizontal+']'
      else if(next.charCodeAt(0)>127)out+=next
      else {out+='\\'+next;if(next==='u'){out+=input.slice(i+1,i+5);i+=4}else if(next==='x'){out+=input.slice(i+1,i+3);i+=2}}
      continue
    }
    if(c==='['){
      let body='',closed=false
      for(i++;i<input.length;i++){
        const v=input[i]
        if(v==='\\'){const n=input[++i];if(!n)throw Error('class escape');body+=n==='h'?horizontal:n==='H'?(()=>{throw Error('negated horizontal class')})():n.charCodeAt(0)>127?n:'\\'+n;if(n==='u'){body+=input.slice(i+1,i+5);i+=4}else if(n==='x'){body+=input.slice(i+1,i+3);i+=2}continue}
        if(v===']'){closed=true;break}
        if(state.i&&/^[a-z]$/i.test(v)){
          if(input[i+1]==='-'&&/^[a-z]$/i.test(input[i+2]||'')){const end=input[i+2];body+=v+'-'+end+v.toLowerCase()+'-'+end.toLowerCase()+v.toUpperCase()+'-'+end.toUpperCase();i+=2}
          else body+=v.toLowerCase()+v.toUpperCase()
        }else body+=v
      }
      if(!closed)throw Error('unclosed class');out+='['+body+']';continue
    }
    if(c==='('){
      const flag=input.slice(i).match(/^\(\?([ims]*)(?:-([ims]+))?([:)])/)
      if(flag&&(flag[1]||flag[2])){const previous=state;state=flags(flag[1],flag[2]);if(flag[3]===':'){stack.push(previous);out+='(?:'}i+=flag[0].length-1;continue}
      stack.push({...state});out+='(';continue
    }
    if(c===')'){if(!stack.length)throw Error('unbalanced group');state=stack.pop();out+=c;continue}
    if(c==='^'&&state.m)out+='(?:^|(?<=[\\r\\n\\u0085\\u2028\\u2029]))'
    else if(c==='$'&&state.m)out+='(?=[\\r\\n\\u0085\\u2028\\u2029]|$)'
    else if(c==='.'&&state.s)out+='[\\s\\S]'
    else out+=state.i&&/\p{L}/u.test(c)?insensitive(c):c
  }
  if(stack.length||out.length>30000)throw Error('regex scope or expansion limit')
  new RegExp(out,'g');return out
}
