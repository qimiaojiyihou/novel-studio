// Read-only converter: stdout contains only normalized rules/allowlisted headers,
// never the original scripts, cookies, login configuration or comments.
import fs from 'node:fs'
import {normalizeSource} from '../reader-service/source-rules.js'
import {digest} from '../reader-service/store.js'

const [input,previousFile]=process.argv.slice(2)
if(!input||!previousFile)throw new Error('Usage: node scripts/normalize-reader-sources.mjs input.json previous-pack.json')
const entries=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''))
const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'))
if(!Array.isArray(entries)||entries.length>1000)throw new Error('Expected at most 1000 sources')
const sources=new Map(),rejected=[],duplicates=[]
for(const [index,raw] of entries.entries()){
  try{
    const normalized=normalizeSource(raw)
    if(sources.has(normalized.id))duplicates.push({index:index+1,name:normalized.name,reason:'同域书源合并，采用文件中最后一个兼容配置'})
    sources.set(normalized.id,normalized)
  }catch(error){rejected.push({index:index+1,name:String(raw?.bookSourceName||'未命名').slice(0,100),reason:error.status?error.message:'书源解析失败'})}
}
const addedSourceIds=[...sources.keys()].filter(id=>!previous.sources.some(s=>s.id===id))
const upgradeFrom={}
for(const [version,ids] of Object.entries(previous.upgradeFrom||{}))upgradeFrom[version]=[...new Set([...ids,...addedSourceIds])]
if(previous.previousVersion)upgradeFrom[previous.previousVersion]=[...new Set([...(previous.addedSourceIds||[]),...addedSourceIds])]
upgradeFrom[previous.version]=addedSourceIds
const pack={version:'exportBookSource-compat-'+digest(JSON.stringify([...sources.values()])).slice(0,16),previousVersion:previous.version,addedSourceIds,upgradeFrom,name:'exportBookSource.json',total:entries.length,sources:[...sources.values()],rejected,duplicates}
process.stdout.write(JSON.stringify(pack,null,2)+'\n')
