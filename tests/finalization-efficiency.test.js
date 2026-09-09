import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { ChapterFinalizer, contentDigest, createFinalizationRepository } from '../electron/chapter-finalization.js'
import { COMPACT_HANDOFF_MODE, correctStateEvidence, stateEvidenceIssues, handoffItemText } from '../electron/chapter-handoff.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { buildCreativeContext, recordCreativeDependencies, invalidateCreativeDependencies } from '../electron/creative-context.js'
import { createProjectBackup, restoreProjectBackup } from '../electron/project-portability.js'

const manuscript = '林溪收好雨伞，把门上的纸条撕下来。\n\n“我明天再来。”\n\n她发现纸条背面还有字。'
const reviewer = { executionMode: 'codex', model: 'gpt-6-astra', reasoningEffort: 'xhigh', label: '工程测试，无真实调用' }
const now = '2026-09-07T08:00:00.000Z'
const emptyState = () => ({ summary: '林溪发现纸条背面有字。', facts: [], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } })
const badState = () => ({ ...emptyState(), facts: [{ text: '纸条背面有字', evidence: '“她发现纸条背面还有字。”' }],
  characterStates: [{ character: '旧章人物', possessions: ['未在本章出现的物品'], evidence: '' }] })
function setup() {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  db.prepare('INSERT INTO projects (id,title,genre,idea,style,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('p','工程测试','悬疑','林溪查纸条','',now,now)
  for (let index = 1; index <= 5; index++) db.prepare('INSERT INTO chapters (id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`c${index}`,'p',index,`第${index}章`,'draft','{}','',manuscript,now)
  db.prepare('INSERT INTO project_pack_bindings (id,project_id,pack_id,pack_version,bound_at,updated_at) VALUES (?,?,?,?,?,?)').run('b','p','official.general-longform.zh-CN','1.3.0',now,now)
  return db
}

test('local-first finalization makes zero calls until the author starts review; keeps the requested model', async () => {
  const db=setup(), repository=createFinalizationRepository(db), calls=[]
  const finalizer=new ChapterFinalizer({ repository, execute:async task => { calls.push(task); return { scores: {}, issues: [] } } })
  const record=finalizer.start({ projectId:'p',chapterId:'c1',reviewer,deferReview:true })
  assert.equal(record.status,'ready_for_review'); assert.deepEqual(calls,[])
  assert.deepEqual(record.reviewer,reviewer)
  assert.equal(record.checks.chapterStateMode,COMPACT_HANDOFF_MODE)
  assert.equal(finalizer.start({projectId:'p',chapterId:'c1',reviewer,deferReview:true}).id,record.id)
  await Promise.all([finalizer.advance(record.id),finalizer.advance(record.id)])
  assert.deepEqual(calls,['quality_review'])
  assert.equal(repository.get(record.id).status,'waiting_review_confirmation')
  db.close()
})

test('compact handoff uses only current prose and an explicit host snapshot; legacy templates stay intact', () => {
  const input={task:'chapter_state_extract',chapter:{id:'c1',chapter_no:3,manuscript},
    knowledgeCenter:{stateSnapshots:[{chapterNo:2,payload:{characterStates:[{character:'历史人物',possessions:['历史道具'.repeat(8000)]}]}}]},
    promptContext:{creativePack:{id:'official.general-longform.zh-CN',version:'1.3.0',digest:'pinned-digest',prompt:{system:'历史任务要求',request:'照搬所有旧物品',outputContract:'必须全量继承'}}}}
  const legacy=compilePrompt(input), compact=compilePrompt({...input,chapterStateMode:COMPACT_HANDOFF_MODE})
  const text=compact.messages.map(item=>item.content).join('\n')
  assert.ok(text.includes(manuscript));assert.ok(text.length < 2200 + manuscript.length)
  assert.doesNotMatch(text,/历史人物|历史道具|必须全量继承|照搬所有旧物品/)
  assert.match(legacy.messages.map(item=>item.content).join('\n'),/章末完整持有物清单/)
  assert.equal(compact.snapshot.chapterStateMode,'delta-v1')
  assert.equal(compact.snapshot.creativePack.digest,'pinned-digest')
  assert.match(compact.snapshot.effectiveTemplate.system,/本章改变的状态/)
  assert.deepEqual(compact.snapshot.contextSources.map(source=>source.targetKey),['chapter:c1:manuscript'])
})

test('invalid handoff is retained across restart and corrected locally, with an immutable raw candidate', async () => {
  const db=setup(), repository=createFinalizationRepository(db), agents=createCodexRepository(db), calls=[]
  let rawCandidate, stateRun
  const finalizer=new ChapterFinalizer({repository,execute:async(task,record)=>{
    calls.push(task)
    if(task==='quality_review') return {issues:[]}
    stateRun=agents.createInlineRun({projectId:'p',chapterId:'c1',task,executionMode:'codex',target:{kind:'chapter_state',targetId:'c1',fieldKey:record.id}})
    repository.patch(record.id,{state_run_id:stateRun.id})
    rawCandidate=agents.createCandidate({projectId:'p',runId:stateRun.id,stepId:stateRun.steps[0].id,artifactType:'chapter_state',sourceDigest:record.source_digest,payload:badState()})
    return badState()
  }})
  const record=finalizer.start({projectId:'p',chapterId:'c1',reviewer})
  await finalizer.advance(record.id)
  await finalizer.advance(record.id,{acceptReview:true})
  let pending=repository.get(record.id)
  assert.equal(pending.status,'waiting_state_correction',pending.error);assert.equal(pending.stateIssues.length,2)
  assert.deepEqual(pending.state,badState());assert.equal(pending.stateIssues[0].path,'facts.0')
  const restarted=new ChapterFinalizer({repository:createFinalizationRepository(db),execute:async()=>{throw new Error('No repeated model call allowed')}})
  await restarted.advance(record.id,{acceptReview:true})
  pending=repository.get(record.id)
  const request={sourceDigest:pending.source_digest,stateDigest:pending.stateDigest,
    corrections:[{key:'facts',index:0,quote:'她发现纸条背面还有字。'},{key:'characterStates',index:0,remove:true}],reason:'核对引句，旧章状态保留在原来源'}
  assert.throws(()=>repository.correctState(record.id,{...request,reason:''}),/原因/)
  const corrected=repository.correctState(record.id,request)
  assert.equal(corrected.status,'waiting_confirmation');assert.equal(corrected.handoff.authorCorrections.length,1)
  assert.deepEqual(calls,['quality_review','chapter_state_extract'])
  assert.throws(()=>repository.correctState(record.id,request),/已变化/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapter_memories').get().n,0)
  repository.confirm(record.id);repository.confirm(record.id)
  const candidates=agents.getRun(stateRun.id).candidates
  assert.deepEqual(candidates.find(item=>item.id===rawCandidate.id).payload,badState())
  assert.equal(candidates.find(item=>item.id===rawCandidate.id).status,'rejected')
  const accepted=candidates.find(item=>item.status==='accepted')
  assert.equal(accepted.evidence.parentCandidateId,rawCandidate.id)
  assert.equal(accepted.evidence.authorEdited,true);assert.equal(accepted.payload.characterStates.length,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_candidates').get().n,1)
  const restored=restoreProjectBackup(db,createProjectBackup(db,'p'))
  const backupRecord=db.prepare('SELECT handoff_json FROM chapter_finalizations WHERE project_id=?').get(restored.projectId)
  assert.equal(JSON.parse(backupRecord.handoff_json).authorCorrections.length,1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.close()
})

test('evidence corrections preserve other fields; malformed paths, duplicates, and fabricated quotes stay rejected', () => {
  const original=badState()
  const next=correctStateEvidence(original,[{key:'facts',index:0,quote:'原文里没有这一句'}]).state
  assert.deepEqual(original,badState());assert.equal(next.facts[0].text,original.facts[0].text)
  assert.equal(stateEvidenceIssues(next,manuscript).length,2)
  for(const corrections of [[{key:'__proto__',index:0,quote:''}],[{key:'facts',index:-1,remove:true}],
    [{key:'facts',index:0,quote:'a'},{key:'facts',index:0,remove:true}]]) assert.throws(()=>correctStateEvidence(original,corrections),/定位/)
  assert.match(handoffItemText({character:'林溪',possessions:[{item:'雨伞',state:'已收好'}]}),/雨伞：已收好/)
  assert.equal(handoffItemText({thread:'纸条背面写了什么？'}),'纸条背面写了什么？')
})

test('draft edits or cancellation block late state writes and source corrections', async () => {
  const db=setup(),repository=createFinalizationRepository(db)
  const record=repository.start({projectId:'p',chapterId:'c1',reviewer})
  const pending=repository.storeState(record.id,badState())
  const request={sourceDigest:record.source_digest,stateDigest:pending.stateDigest,corrections:[]}
  repository.patch(record.id,{status:'cancelled'})
  assert.throws(()=>repository.correctState(record.id,request),/状态/)
  assert.throws(()=>repository.storeState(record.id,emptyState()),/结束/)
  const fresh=repository.start({projectId:'p',chapterId:'c1',reviewer})
  repository.storeState(fresh.id,badState())
  db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('作者已经修改正文','c1')
  assert.throws(()=>repository.correctState(fresh.id,request),/状态|变化|过期/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_candidates').get().n,0)
  let release
  const finalizer=new ChapterFinalizer({repository,execute:()=>new Promise(resolve=>{release=resolve})})
  const another=finalizer.start({projectId:'p',chapterId:'c2',reviewer})
  const waiting=finalizer.advance(another.id)
  repository.patch(another.id,{status:'cancelled'});release({issues:[]})
  await waiting;assert.equal(repository.get(another.id).status,'cancelled')
  db.close()
})

test('delta retrieval keeps relevant earlier sources, excludes stale/future facts and editing audit noise', () => {
  const db=setup(), repository=createFinalizationRepository(db)
  for(const [index,summary] of [[1,'林溪记下旧章关键线索'],[2,'林溪遇到前章异常'],[4,'林溪未来章秘密']]) {
    const record=repository.start({projectId:'p',chapterId:`c${index}`,reviewer})
    repository.storeState(record.id,{...emptyState(),summary});repository.confirm(record.id)
  }
  db.prepare("UPDATE chapter_memories SET handoff_json=json_set(handoff_json,'$.authorCorrections',json(?)) WHERE chapter_id='c1'").run(JSON.stringify([{before:'已移除的错误道具'.repeat(6000)}]))
  const context=buildCreativeContext(db,{projectId:'p',chapterId:'c3',instruction:'林溪',budget:5000})
  assert.match(context.text,/旧章关键线索/);assert.match(context.text,/前章异常/)
  assert.doesNotMatch(context.text,/未来章秘密|已移除的错误道具/)
  assert.ok(context.sources.some(source=>source.targetKey==='chapter_memory:c1:handoff'))
  recordCreativeDependencies(db,{projectId:'p',artifactKind:'fixture',artifactId:'fixture',sources:context.sources})
  assert.deepEqual(invalidateCreativeDependencies(db,'p'),[])
  db.prepare("UPDATE chapter_memories SET needs_review=1 WHERE chapter_id='c1'").run()
  assert.doesNotMatch(buildCreativeContext(db,{projectId:'p',chapterId:'c3',instruction:'林溪'}).text,/旧章关键线索/)
  const stateContext=buildCreativeContext(db,{projectId:'p',chapterId:'c3',task:'chapter_state_extract',chapterStateMode:COMPACT_HANDOFF_MODE,budget:2000})
  assert.deepEqual(stateContext.sources.map(source=>source.targetKey),['chapter:c3:manuscript'])
  assert.equal(stateContext.text,'');assert.equal(contentDigest(manuscript).length,64)
  db.close()
})
