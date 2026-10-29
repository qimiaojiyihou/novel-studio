import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createZhuqueDetectionService, manuscriptDigest } from '../electron/zhuque-detection.js'
import { prepareZhuqueExport, exportZhuqueReport } from '../electron/zhuque-export.js'

function fixture(t) {
  const database = new DatabaseSync(':memory:'); runMigrations(database); t.after(() => database.close())
  database.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES('book','《测试》/短篇','','','','now','now'),('other','另一作品','','','','now','now')").run()
  database.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,manuscript,updated_at) VALUES('chapter','book',11,'夜路','draft','当前正文','now')").run()
  const checkedAt='2026-10-29T01:02:03.000Z'
  const result={ ratioConfidence:0,softmaxConfidence:0.82,labelsRatio:{human:0.5,ai:0.25,suspected:0.25},billedTokens:0,
    segments:[{order:2,label:2,confidence:0.9,text:'  第一行\n\n第二行。'},{order:1,label:0,confidence:0,text:'人类片段。'},{order:3,label:null,confidence:null,text:''}],
    apiKey:'must-not-export',authToken:'must-not-export',headers:{Authorization:'must-not-export'} }
  database.prepare('INSERT INTO zhuque_chapter_detections(chapter_id,project_id,manuscript_digest,result_json,checked_at) VALUES(?,?,?,?,?)')
    .run('chapter','book',manuscriptDigest('当前正文'),JSON.stringify(result),checkedAt)
  const service=createZhuqueDetectionService(database,{getApiKey:()=>{throw new Error('导出不应访问密钥')},fetchImpl:()=>{throw new Error('导出不应请求检测接口')}})
  const target={projectId:'book',chapterId:'chapter'}
  const getResult=input=>service.getResult(input), now=()=> '2026-10-29T02:00:00.000Z'
  return {database,service,target,getResult,now,checkedAt}
}

test('TXT report exports saved metrics and every complete segment without requesting the provider or exporting credentials', t => {
  const f=fixture(t), prepared=prepareZhuqueExport(f.database,f.getResult,{...f.target,format:'txt'},{now:f.now})
  assert.match(prepared.content,/书名：《测试》\/短篇/);assert.match(prepared.content,/第11章 夜路/)
  assert.match(prepared.content,/整体风险比例：0\.0%/);assert.match(prepared.content,/整体风险置信度：82\.0%/)
  assert.match(prepared.content,/本次计费 Token：0/);assert.match(prepared.content,/3 段/)
  assert.ok(prepared.content.includes('  第一行\n\n第二行。'));assert.match(prepared.content,/未标注 · 置信度 未返回/)
  assert.ok(prepared.content.indexOf('第一行')<prepared.content.indexOf('人类片段。'))
  assert.doesNotMatch(prepared.fileName,/[<>:"/\\|?*\u0000-\u001F]/);assert.ok(prepared.fileName.endsWith('.txt'))
  assert.equal(prepared.fileName,'《测试》-短篇-第11章.txt')
  assert.doesNotMatch(prepared.content,/must-not-export|Authorization/)
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM zhuque_chapter_detections').get().n,1)
})

test('JSON is structured and lossless for numeric values, labels, original segment order/text and detection identity', t => {
  const f=fixture(t), prepared=prepareZhuqueExport(f.database,f.getResult,{...f.target,format:'json'},{now:f.now}), json=JSON.parse(prepared.content)
  assert.equal(prepared.fileName,'《测试》-短篇-第11章.json')
  assert.equal(json.schemaVersion,1);assert.equal(json.artifactType,'novel-studio-zhuque-detection')
  assert.equal(json.project.id,'book');assert.equal(json.chapter.number,11);assert.equal(json.checkedAt,f.checkedAt)
  assert.equal(json.ratioConfidence,0);assert.equal(json.segments[0].order,2);assert.equal(json.segments[0].labelText,'疑似 AI')
  assert.equal(json.segments[0].text,'  第一行\n\n第二行。');assert.equal(json.segments[1].confidence,0)
  assert.equal(json.stale,false);assert.equal(json.manuscriptDigest,manuscriptDigest('当前正文'))
  assert.equal(json.apiKey,undefined);assert.equal(json.headers,undefined);assert.equal(json.authToken,undefined)
})

test('stale exports explicitly retain the old detection, never substitute the current manuscript', t => {
  const f=fixture(t)
  f.database.prepare("UPDATE chapters SET manuscript='新的正文不应当作送检稿导出' WHERE id='chapter'").run()
  const report=prepareZhuqueExport(f.database,f.getResult,f.target,{now:f.now})
  assert.equal(report.report.stale,true);assert.match(report.content,/旧稿结果/)
  assert.equal(report.report.manuscriptDigest,manuscriptDigest('当前正文'))
  assert.doesNotMatch(report.content,/新的正文不应当作送检稿导出/)
})

test('foreign/missing chapters, missing reports, obsolete result identity and unknown formats fail before showing a dialog', async t => {
  const f=fixture(t)
  assert.throws(()=>prepareZhuqueExport(f.database,f.getResult,{...f.target,projectId:'other'}),/不属于/)
  assert.throws(()=>prepareZhuqueExport(f.database,f.getResult,{...f.target,format:'html'}),/格式/)
  assert.throws(()=>prepareZhuqueExport(f.database,f.getResult,{...f.target,expectedDigest:'obsolete'}),/已更新/)
  assert.throws(()=>prepareZhuqueExport(f.database,f.getResult,{...f.target,expectedCheckedAt:'old'}),/已更新/)
  f.database.prepare('DELETE FROM zhuque_chapter_detections').run()
  await assert.rejects(exportZhuqueReport({...f,showSaveDialog:()=>{throw new Error('不应打开对话框')}},f.target),/尚无/)
})

test('cancelling the save dialog writes nothing and does not modify saved detection results', async t => {
  const f=fixture(t), writes=[]
  const result=await exportZhuqueReport({...f,showSaveDialog:async()=>({canceled:true}),writeFile:(...args)=>writes.push(args)},f.target)
  assert.deepEqual(result,{cancelled:true});assert.deepEqual(writes,[])
  assert.equal(f.service.getResult(f.target).checkedAt,f.checkedAt)
})

test('report snapshot is pinned across a save dialog, adds the chosen extension and propagates write errors', async t => {
  const f=fixture(t), writes=[]
  const result=await exportZhuqueReport({...f,showSaveDialog:async options=>{
    assert.deepEqual(options.filters[0].extensions,['json'])
    f.database.prepare("UPDATE zhuque_chapter_detections SET result_json='{}',checked_at='later' WHERE chapter_id='chapter'").run()
    return {filePath:'/temporary/朱雀检测',canceled:false}
  },writeFile:async(...args)=>writes.push(args)}, {...f.target,format:'json'})
  assert.equal(result.filePath,'/temporary/朱雀检测.json');assert.equal(result.checkedAt,f.checkedAt)
  assert.equal(JSON.parse(writes[0][1]).checkedAt,f.checkedAt);assert.equal(writes[0][2],'utf8')
  await assert.rejects(exportZhuqueReport({...f,showSaveDialog:async()=>({filePath:'/readonly/report.txt'}),writeFile:async()=>{throw new Error('无写入权限')}},f.target),/无写入权限/)
})
