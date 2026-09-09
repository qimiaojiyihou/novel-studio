import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash } from 'node:crypto'

// Administrative read-only audit. Never imports application bootstrap/migrations.
const args=process.argv.slice(2), option=name=>args[args.indexOf(name)+1]
const databaseFile=path.resolve(option('--database') || '')
assert.ok(args.includes('--database') && fs.existsSync(databaseFile),'Specify an existing database')
const db=new DatabaseSync(databaseFile,{readOnly:true})
assert.equal(fs.realpathSync(db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file),fs.realpathSync(databaseFile))
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function audit(database) {
  const tables={}
  for(const {name} of database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    assert.match(name,/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    const rows=database.prepare(`SELECT * FROM "${name}"`).all().map(row=>JSON.stringify(row)).sort()
    tables[name]={count:rows.length,digest:hash(rows)}
  }
  const books=database.prepare("SELECT id,title FROM projects WHERE project_type='user' AND archived_at='' ORDER BY id").all().map(book=>({
    ...book,chapters:database.prepare('SELECT id,chapter_no,title,status,manuscript FROM chapters WHERE project_id=? ORDER BY chapter_no').all(book.id)
      .map(({manuscript,...chapter})=>({...chapter,characters:manuscript.length,digest:hash(manuscript)})),
  }))
  return {databasePath:databaseFile,capturedAt:new Date().toISOString(),integrity:database.prepare('PRAGMA quick_check').all(),tables,books}
}
try {
  if(args.includes('--capture')) {
    const directory=path.resolve(option('--capture'))
    assert.ok(!fs.existsSync(directory),'Capture directory must be new')
    fs.mkdirSync(directory,{recursive:true,mode:0o700})
    const file=path.join(directory,'novel-studio.before.sqlite')
    await backup(db,file);fs.chmodSync(file,0o600)
    const copied=new DatabaseSync(file,{readOnly:true})
    const report=audit(copied);copied.close()
    assert.deepEqual(report.integrity.map(row=>row.quick_check),['ok'])
    fs.writeFileSync(path.join(directory,'before.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'})
    console.log(JSON.stringify({backupDirectory:directory,integrity:report.integrity,books:report.books},null,2))
  } else if(args.includes('--compare')) {
    const beforeFile=path.resolve(option('--compare')),before=JSON.parse(fs.readFileSync(beforeFile,'utf8')),after=audit(db)
    assert.equal(before.databasePath,databaseFile)
    const changedTables=Object.keys(before.tables).filter(name=>before.tables[name].digest!==after.tables[name]?.digest)
    const manuscriptsUnchanged=hash(before.books)===hash(after.books)
    const result={databasePath:databaseFile,integrity:after.integrity,manuscriptsUnchanged,changedTables,
      addedTables:Object.keys(after.tables).filter(name=>!before.tables[name]),books:after.books}
    if(args.includes('--report')) fs.writeFileSync(path.resolve(option('--report')),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'})
    console.log(JSON.stringify(result,null,2))
    assert.equal(manuscriptsUnchanged,true,'Book identities, chapters, status or manuscript changed')
  } else throw new Error('Choose --capture NEW_DIRECTORY or --compare BEFORE_JSON')
} finally {db.close()}
