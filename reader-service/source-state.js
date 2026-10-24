import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {fail} from './store.js'

const blocked=new Set(['__proto__','constructor','prototype'])
export function putSourceValue(values,key,value){
  if(typeof key!=='string'||!key||key.length>100||blocked.has(key)||!Object.hasOwn(values,key)&&Object.keys(values).length>=100||JSON.stringify(value??null).length>65536)fail(413,'书源变量名称、数量或长度超过限制')
  values[key]=value??null
  return value
}
export function createSourceState(db,key){
  const secret=createHash('sha256').update(key||randomBytes(32)).update('reader-book-state-v1').digest()
  db.exec(`CREATE TABLE IF NOT EXISTS network_book_state(owner TEXT NOT NULL,book_id TEXT NOT NULL,source_version TEXT NOT NULL,sealed TEXT NOT NULL,PRIMARY KEY(owner,book_id),FOREIGN KEY(owner,book_id) REFERENCES network_books(owner,id) ON DELETE CASCADE)`)
  const empty=()=>({book:{},chapters:{},toc:null}),aad=(owner,id,version)=>Buffer.from(JSON.stringify([owner,id,version]))
  const isStale=(owner,id,version)=>{const row=db.prepare('SELECT source_version FROM network_book_state WHERE owner=? AND book_id=?').get(owner,id);return !!row&&row.source_version!==version}
  function read(owner,id,version){
    const row=db.prepare('SELECT * FROM network_book_state WHERE owner=? AND book_id=?').get(owner,id)
    if(!row||row.source_version!==version)return empty()
    try{const bytes=Buffer.from(row.sealed,'base64'),cipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(0,12));cipher.setAAD(aad(owner,id,version));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]))}
    catch{fail(409,'书籍规则变量需要重新读取（服务密钥变化或状态损坏）')}
  }
  function save(owner,id,version,base,next){
    // Called synchronously inside the caller's transaction after ownership,
    // source version and book revision checks. Merge disjoint chapter updates;
    // reject conflicting writes instead of overwriting another request's state.
    if(JSON.stringify(base)===JSON.stringify(next)&&!isStale(owner,id,version))return
    const current=read(owner,id,version)
    if(JSON.stringify(base.toc||null)!==JSON.stringify(next.toc||null)){
      if(JSON.stringify(current.toc||null)!==JSON.stringify(base.toc||null)&&JSON.stringify(current.toc||null)!==JSON.stringify(next.toc||null))fail(409,'目录分页已变化，请刷新后继续加载')
      if(next.toc&&(next.toc.pending?.length>100||next.toc.seen?.length>200||next.toc.pages>100||JSON.stringify(next.toc).length>512*1024))fail(413,'目录分页状态超过限制')
      current.toc=structuredClone(next.toc||null)
    }
    for(const scope of new Set(['book',...Object.keys(base.chapters),...Object.keys(next.chapters)])){
      if(blocked.has(scope))fail(400,'书源变量范围错误')
      const before=scope==='book'?base.book:base.chapters[scope]||{},after=scope==='book'?next.book:next.chapters[scope]||{}
      const target=scope==='book'?current.book:(current.chapters[scope]||={})
      for(const name of new Set([...Object.keys(before),...Object.keys(after)])){
        if(JSON.stringify(before[name])===JSON.stringify(after[name]))continue
        if(JSON.stringify(target[name])!==JSON.stringify(before[name])&&JSON.stringify(target[name])!==JSON.stringify(after[name]))fail(409,'书籍规则变量发生并发冲突，请重试')
        if(Object.hasOwn(after,name))putSourceValue(target,name,after[name]);else delete target[name]
      }
      if(scope!=='book'&&!Object.keys(target).length)delete current.chapters[scope]
    }
    const plain=JSON.stringify(current)
    if(Buffer.byteLength(plain)>1024*1024||Object.keys(current.chapters).length>5000)fail(413,'书籍规则变量超过存储限制')
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad(owner,id,version))
    const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]),sealed=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64')
    db.prepare('INSERT INTO network_book_state VALUES(?,?,?,?) ON CONFLICT(owner,book_id) DO UPDATE SET source_version=excluded.source_version,sealed=excluded.sealed').run(owner,id,version,sealed)
  }
  return {read,save,empty,isStale}
}
