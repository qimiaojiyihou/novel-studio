import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createFinalizationRepository, ChapterFinalizer, contentDigest, validateStateEvidence } from '../electron/chapter-finalization.js'
import { checkManuscript } from '../electron/manuscript-checks.js'
import { applyTextPatches } from '../electron/manuscript-patches.js'
import { modelDirectory, sessionModelSnapshot, execModelArgs } from '../electron/codex-models.js'
import { createAuthoringRepository } from '../electron/authoring-repository.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { AgentRuntime } from '../electron/agent-runtime.js'
import { buildCreativeContext, contextDependencyDigest, recordCreativeDependencies, invalidateCreativeDependencies } from '../electron/creative-context.js'
import { createContextRepository } from '../electron/context-repository.js'
import { createProjectBackup, restoreProjectBackup } from '../electron/project-portability.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { deterministicQualityChecks } from '../electron/creative-quality.js'
import { normalizeChapterStateSnapshot } from '../electron/model-adapter.js'

const now = '2026-09-06T10:00:00.000Z'
const prose = '周砚付了摊位租金。\n\n女生伸手来接，周砚还攥着袋子，正想问她要不要辣。\n\n锅里的饭已经盛好了。'
function setup() {
  const db = new DatabaseSync(':memory:')
  runMigrations(db)
  db.prepare('INSERT INTO projects (id,title,genre,idea,style,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('p','职业体验','文娱','周砚在夜市开摊','口语自然',now,now)
  db.prepare('INSERT INTO chapters (id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('c','p',1,'开摊','draft','{}','',prose,now)
  for (const kind of ['foundation','world','outline']) db.prepare('INSERT INTO planning_documents (project_id,kind,content_json,created_at,updated_at) VALUES (?,?,?,?,?)').run('p',kind,'{}',now,now)
  db.prepare('INSERT INTO project_pack_bindings (id,project_id,pack_id,pack_version,bound_at,updated_at) VALUES (?,?,?,?,?,?)').run('b','p','official.general-longform.zh-CN','1.3.0',now,now)
  return db
}
const reviewer = { executionMode: 'app_model', profileId: 'review-model', model: 'fixture', label: '独立上下文' }
function state() { return { summary: '周砚付租金并开摊。', facts: [{ text: '租金已付', evidence: '周砚付了摊位租金。' }], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } } }

test('v21→v29 preserves pinned historical packs, runs sequentially and cascades new data', () => {
  const db = new DatabaseSync(':memory:')
  runMigrations(db, { targetVersion: 21 })
  const before = db.prepare('SELECT version,digest FROM creative_pack_versions ORDER BY version').all()
  runMigrations(db)
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations WHERE version>=22 ORDER BY version').all().map(r=>r.version), [22,23,24,25,26,27,28,29])
  assert.deepEqual(db.prepare("SELECT version,digest FROM creative_pack_versions WHERE version!='1.3.0' ORDER BY version").all(), before)
  runMigrations(db)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.close()
})

test('GPT6 family hints are not capabilities, grouped catalog works, exec keeps explicit parameters', () => {
  assert.deepEqual(modelDirectory().map(item=>[item.value,item.status]),[
    ['gpt-6-astra','pending'],
    ['gpt-6-sol','pending'],
    ['gpt-6-luna','pending'],
  ])
  assert.ok(modelDirectory([],true).every(item=>item.status==='unsupported'))
  const options = [{ id:'model', currentValue:'gpt-6-astra', options:[{ name:'Models',options:[{ value:'gpt-6-astra',name:'GPT-6 Astra' },{ value:'gpt-6-sol',name:'GPT-6 Sol' }] }] }, { id:'reasoning_effort',currentValue:'high',options:[{ value:'high' }] }]
  assert.deepEqual(modelDirectory(options,true).map(item=>[item.value,item.status]),[
    ['gpt-6-astra','available'],
    ['gpt-6-sol','available'],
    ['gpt-6-luna','unsupported'],
  ])
  assert.equal(sessionModelSnapshot(options).fastModeSupported,false)
  assert.equal(sessionModelSnapshot(options).verified,true)
  assert.deepEqual(execModelArgs({ model:'gpt-6-astra',reasoningEffort:'high',fastMode:true }),['--model','gpt-6-astra','-c','model_reasoning_effort="high"','-c','service_tier="fast"'])
})

test('local checks preserve short human prose and locate leaked directives without rewriting', () => {
  const local = checkManuscript(prose,{targetLength:2000})
  assert.equal(local.blocked,false)
  assert.deepEqual(local.findings.map(f=>f.id),['length'])
  const polluted = prose+'\n本章停在顾客下单。下一章必须交付。'
  assert.equal(checkManuscript(polluted).findings.filter(f=>f.id==='instruction-or-envelope').length,2)
  assert.equal(checkManuscript('').blocked,true)
  assert.equal(validateStateEvidence(state(),prose).length,0)
  assert.ok(validateStateEvidence({ ...state(),facts:[{text:'不存在的事',evidence:'没有这个原句'}] },prose).length)
})

test('semantic ending tolerates different wording; exact ending retains verification', () => {
  const card = { ending:'顾客当场下了第一单',boundaryMode:'semantic' }
  assert.equal(deterministicQualityChecks({ task:'chapter',output:prose,chapter:{card} }).some(item=>item.id==='output-ending-match'),false)
  assert.equal(deterministicQualityChecks({ task:'chapter',output:prose,chapter:{card:{...card,boundaryMode:'exact'}} }).find(item=>item.id==='output-ending-match').passed,false)
})

test('Pack1.3 planning prompt is neutral and frozen snapshot7 contains compiled content', () => {
  const db=setup()
  const pack=JSON.parse(db.prepare("SELECT content_json FROM creative_pack_versions WHERE version='1.3.0'").get().content_json)
  const compiled=compilePrompt({ task:'chapter_card',project:{title:'职业体验',genre:'文娱',idea:'夜市开摊'},chapter:{card:{}},promptContext:{creativePack:{id:pack.manifest.id,version:'1.3.0',digest:pack.manifest.integrity.sha256,prompt:pack.prompts.chapter_card},style:{}} })
  assert.equal(compiled.snapshot.schemaVersion,7)
  assert.equal(compiled.snapshot.boundaryMode,'semantic')
  assert.doesNotMatch(compiled.messages.map(m=>m.content).join('\n'),/特殊钥匙|门后声音|证物版本/)
  assert.ok(compiled.snapshot.effectiveTemplate)
  db.close()
})

test('finalization deduplicates calls, independently reviews, confirms sourced handoff once', async () => {
  const db=setup(), repository=createFinalizationRepository(db), calls=[]
  const finalizer=new ChapterFinalizer({ repository,execute:async(task)=>{calls.push(task);return task==='quality_review'?{scores:{naturalness:8},issues:[]}:state()} })
  const first=finalizer.start({projectId:'p',chapterId:'c',reviewer})
  const duplicate=finalizer.start({projectId:'p',chapterId:'c',reviewer})
  assert.equal(first.id,duplicate.id)
  await finalizer.advance(first.id)
  assert.equal(repository.get(first.id).status,'waiting_review_confirmation')
  assert.deepEqual(calls,['quality_review'])
  await finalizer.advance(first.id,{acceptReview:true})
  assert.equal(repository.get(first.id).status,'waiting_confirmation')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapter_memories').get().n,0)
  repository.confirm(first.id);repository.confirm(first.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_candidates').get().n,1)
  const memory=db.prepare('SELECT * FROM chapter_memories').get()
  assert.equal(memory.confirmed,1);assert.equal(memory.source_digest,contentDigest(prose))
  createContextRepository(db).rebuildChapterMemories('p')
  assert.equal(db.prepare('SELECT summary FROM chapter_memories').get().summary,state().summary)
  db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run(prose+'\n新段落','c')
  assert.equal(repository.get(first.id).status,'stale')
  assert.equal(db.prepare('SELECT needs_review FROM chapter_memories').get().needs_review,1)
  db.close()
})

test('finalization can explicitly start a fresh task after switching reviewer selection', () => {
  const db=setup(), repository=createFinalizationRepository(db)
  const codexReviewer={ executionMode:'codex', model:'gpt-6-astra', reasoningEffort:'high', label:'Codex 独立审稿' }
  const first=repository.start({projectId:'p',chapterId:'c',reviewer:codexReviewer})
  const reused=repository.start({projectId:'p',chapterId:'c',reviewer:codexReviewer})
  const fresh=repository.start({projectId:'p',chapterId:'c',reviewer:codexReviewer,freshStart:true})
  assert.equal(reused.id,first.id)
  assert.notEqual(fresh.id,first.id)
  assert.equal(fresh.reviewer.executionMode,'codex')
  assert.equal(repository.latest('c').id,fresh.id)
  db.close()
})

test('finalization rejects concurrent edits and resumes failure without repeating a successful review', async () => {
  const db=setup(), repository=createFinalizationRepository(db)
  let stateCalls=0,reviewCalls=0
  const finalizer=new ChapterFinalizer({repository,execute:async task=>{ if(task==='quality_review'){reviewCalls++;return {issues:[{severity:'high',reason:'校验原文'}]}} if(++stateCalls===1)throw new Error('mock network error');return state() }})
  const record=finalizer.start({projectId:'p',chapterId:'c',reviewer})
  await finalizer.advance(record.id)
  await finalizer.advance(record.id,{acceptReview:true})
  assert.match(repository.get(record.id).error,/原因/)
  await finalizer.advance(record.id,{acceptReview:true,reason:'作者保留表达'})
  assert.equal(repository.get(record.id).status,'failed')
  await finalizer.advance(record.id,{acceptReview:true})
  assert.equal(reviewCalls,1);assert.equal(repository.get(record.id).status,'waiting_confirmation')
  db.prepare('UPDATE chapters SET manuscript=? WHERE id=?').run('新稿','c')
  assert.throws(()=>repository.confirm(record.id),/先完成|过期/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_candidates').get().n,0)
  db.close()
})

test('strict patches preserve outside text, reject overlap, stale source and protected edits', () => {
  const source='甲段。乙段。丙段。',digest=contentDigest(source)
  const result={sourceDigest:digest,patches:[{from:3,to:6,before:'乙段。',after:'新乙段。'}]}
  assert.equal(applyTextPatches(source,result,{digest,scope:{kind:'selection',from:3,to:6}}).manuscript,'甲段。新乙段。丙段。')
  assert.throws(()=>applyTextPatches(source,result,{digest,protections:[{start_offset:3,end_offset:6,active:1}]}),/保护/)
  assert.throws(()=>applyTextPatches(source,result,{digest,scope:{kind:'selection'}}),/有效范围/)
  assert.throws(()=>applyTextPatches(source+'变',result,{digest}),/过期/)
  assert.throws(()=>applyTextPatches(source,{...result,patches:[...result.patches,...result.patches]},{digest}),/重叠/)
})

test('discussion persists messages without replacing or staling the pending candidate', async () => {
  const db=setup(),repository=createCodexRepository(db)
  let calls=0
  const runtime=new AgentRuntime({repository,codexGateway:{prompt:async()=>({backend:'codex_acp',structuredOutput:{text:++calls===1?'首版':'讨论方案'},outputStarted:true})},createMirror:async()=>({root:'/tmp/mock'}),refreshMirror:async()=>({root:'/tmp/mock'}),prepareCodexPrompt:async()=>({}),currentSourceDigest:async()=> 'same-source',applyCandidate:async()=>{throw new Error('discussion must not apply')} })
  const started=await runtime.startInline({projectId:'p',task:'planning_field',target:{kind:'planning_document',targetId:'foundation',fieldKey:'premise'}})
  await runtime.advance(started.id)
  const candidate=repository.getRun(started.id).candidates[0]
  await runtime.continueInline({runId:started.id,parentCandidateId:candidate.id,mode:'discuss',instruction:'为什么这样写？'})
  await runtime.advance(started.id)
  const run=repository.getRun(started.id)
  assert.equal(run.candidates.length,1);assert.equal(run.candidates[0].status,'pending')
  assert.equal(run.messages.filter(item=>item.role==='assistant')[0].content,'讨论方案')
  assert.equal(run.frozenContext.schemaVersion,7)
  db.close()
})

test('style samples stay distinct from facts, protections use authoritative sources, backup8 roundtrips', async () => {
  const db=setup(),author=createAuthoringRepository(db)
  author.saveSample({projectId:'p',chapterId:'c',text:'周砚付了摊位租金。',reason:'干脆的动作'})
  assert.throws(()=>author.saveSample({projectId:'p',chapterId:'c',text:'编造的原文'}),/当前原文/)
  author.protect({projectId:'p',chapterId:'c',from:0,to:3})
  assert.equal(author.protections({projectId:'p',chapterId:'c'})[0].text,'周砚付')
  const context=buildCreativeContext(db,{projectId:'p',chapterId:'c'})
  assert.match(context.text,/只参考表达与取舍/)
  assert.equal(context.sources.filter(item=>item.targetKey.startsWith('style_sample')).length,1)
  const finalRepo=createFinalizationRepository(db)
  finalRepo.start({projectId:'p',chapterId:'c',reviewer})
  const backup=createProjectBackup(db,'p')
  assert.equal(backup.version,8)
  const restored=restoreProjectBackup(db,backup)
  assert.equal(author.listSamples({projectId:restored.projectId}).length,1)
  assert.equal(db.prepare('SELECT status FROM chapter_finalizations WHERE project_id=?').get(restored.projectId).status,'paused')
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  db.prepare('DELETE FROM projects WHERE id=?').run(restored.projectId)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM author_style_samples WHERE project_id=?').get(restored.projectId).n,0)
  db.close()
})

test('retrieval budget protects hard facts and unrelated entity edits do not invalidate context', () => {
  const db=setup(),request={projectId:'p',chapterId:'c'}
  db.prepare('INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('unused','p','character','遥远太空人',1,'{"identity":"外星飞船"}',now,now)
  const before=contextDependencyDigest(buildCreativeContext(db,request))
  db.prepare('UPDATE planning_entities SET data_json=? WHERE id=?').run('{"identity":"北极探险"}','unused')
  assert.equal(contextDependencyDigest(buildCreativeContext(db,request)),before)
  db.prepare("UPDATE planning_documents SET content_json=? WHERE kind='foundation'").run(JSON.stringify({hardFact:'长'.repeat(4000)}))
  assert.throws(()=>buildCreativeContext(db,{...request,budget:2000}),/必需事实超出/)
  db.close()
})

test('normalized state preserves quoted evidence from every category', () => {
  const evidence = '周砚付了摊位租金。'
  const result = normalizeChapterStateSnapshot({ ...state(),
    characterStates: [{ character: '周砚', emotional: '忐忑', evidence }],
    relationshipChanges: [{ text: '建立租赁关系', evidence }],
    timelineEvents: [{ text: '支付租金', evidence: { quote: evidence } }],
    openThreads: [{ text: '还需营业', evidence }],
    foreshadow: { setups: [{ text: '摊位之约', evidence }], payoffs: [] },
  })
  assert.deepEqual(validateStateEvidence(result, prose), [])
  assert.equal(result.facts[0].object, '租金已付')
  assert.equal(result.relationshipChanges[0].text, '建立租赁关系')
  assert.equal(result.openThreads[0].evidence, evidence)
  const legacy = normalizeChapterStateSnapshot({ ...state(), foreshadow: [{ description: '摊位之约', evidence }, { text: '已经履约', status: 'resolved', evidence: { quote: evidence } }] })
  assert.equal(legacy.foreshadow.setups[0].evidence, evidence)
  assert.equal(legacy.foreshadow.payoffs[0].text, '已经履约')
  assert.deepEqual(validateStateEvidence(legacy, prose), [])
  assert.equal(checkManuscript('他说：“下一章必须交付。”周砚笑了。').findings.length, 0)
})

test('a character card shares one run across fields and bundle; new characters remain isolated', () => {
  const db=setup(), repo=createCodexRepository(db)
  for (const [index, id] of ['person-a','person-b'].entries()) db.prepare('INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,'p','character',id,index+1,'{}',now,now)
  const first=repo.createInlineRun({projectId:'p',executionMode:'codex',task:'planning_field',target:{kind:'planning_entity',targetId:'person-a',fieldKey:'role'}})
  repo.updateStep(first.steps[0].id,{status:'confirmed'})
  repo.updateRun(first.id,{status:'completed',connectionReleasedAt:now})
  const bundle=repo.createInlineRun({projectId:'p',executionMode:'codex',task:'planning_field',target:{kind:'planning_entity_bundle',targetId:'person-a'}})
  assert.equal(bundle.id,first.id)
  assert.equal(bundle.steps.length,2)
  assert.equal(bundle.connectionReleasedAt,'')
  const other=repo.createInlineRun({projectId:'p',executionMode:'codex',task:'planning_field',target:{kind:'planning_entity',targetId:'person-b',fieldKey:'role'}})
  assert.notEqual(other.id,first.id)
  const fresh=repo.createInlineRun({projectId:'p',executionMode:'codex',task:'planning_field',freshStart:true,target:{kind:'planning_entity',targetId:'person-a',fieldKey:'role'}})
  assert.notEqual(fresh.id,first.id)
  db.close()
})

test('recorded dependencies invalidate only their real inputs and revoke completed handoffs', () => {
  const db=setup(), repo=createCodexRepository(db), finals=createFinalizationRepository(db)
  const run=repo.createInlineRun({projectId:'p',task:'planning_field',target:{kind:'planning_document',targetId:'foundation',fieldKey:'premise'}})
  const candidate=repo.createCandidate({projectId:'p',runId:run.id,stepId:run.steps[0].id,artifactType:'planning_field',sourceDigest:'fixture',payload:{text:'候选'}})
  const context=buildCreativeContext(db,{projectId:'p',chapterId:'c'})
  recordCreativeDependencies(db,{projectId:'p',artifactKind:'candidate',artifactId:candidate.id,sources:context.sources})
  const final=finals.start({projectId:'p',chapterId:'c',reviewer})
  recordCreativeDependencies(db,{projectId:'p',artifactKind:'finalization',artifactId:final.id,sources:context.sources})
  finals.patch(final.id,{status:'waiting_confirmation',state_json:JSON.stringify(state())});finals.confirm(final.id)
  db.prepare("UPDATE planning_documents SET content_json=? WHERE kind='outline'").run('{"note":"无关内容"}')
  assert.deepEqual(invalidateCreativeDependencies(db,'p'),[])
  db.prepare("UPDATE planning_documents SET content_json=? WHERE kind='foundation'").run('{"premise":"新的硬事实"}')
  assert.ok(invalidateCreativeDependencies(db,'p').length)
  assert.equal(repo.getRun(run.id).candidates[0].status,'stale')
  assert.equal(finals.get(final.id).status,'stale')
  assert.equal(db.prepare('SELECT status FROM chapters WHERE id=?').get('c').status,'draft')
  db.close()
})

test('accepted manual revisions preserve candidate history and legacy resume requires a decision', async () => {
  const db=setup(), repo=createCodexRepository(db)
  const run=repo.createInlineRun({projectId:'p',executionMode:'app_model',task:'planning_field',target:{kind:'planning_document',targetId:'foundation',fieldKey:'premise'}})
  const runtime=new AgentRuntime({repository:repo,currentSourceDigest:async()=> 'source',applyCandidate:async()=>{},refreshMirror:async()=>({root:'/tmp/fixture'})})
  repo.updateStep(run.steps[0].id,{status:'completed'})
  const candidate=repo.createCandidate({projectId:'p',runId:run.id,stepId:run.steps[0].id,artifactType:'planning_field',sourceDigest:'source',payload:{text:'原候选'}})
  await runtime.confirmCandidate({runId:run.id,candidateId:candidate.id,accept:true})
  await runtime.advance(run.id)
  await runtime.confirmCandidate({runId:run.id,candidateId:candidate.id,accept:true,editedPayload:{text:'作者修订'}})
  await runtime.advance(run.id)
  const revised=repo.getRun(run.id).candidates
  assert.equal(revised.length,2)
  assert.equal(revised[0].payload.text,'原候选')
  assert.equal(revised[1].payload.text,'作者修订')
  assert.equal(revised[1].evidence.parentCandidateId,candidate.id)
  db.prepare("UPDATE agent_runs SET frozen_context_json='{}', status='paused' WHERE id=?").run(run.id)
  await assert.rejects(runtime.resume(run.id),/旧运行/)
  await runtime.resume({runId:run.id,legacyRuleChoice:'continue'});await runtime.advance(run.id)
  assert.equal(repo.getRun(run.id).modelRoutes.legacyRuleChoice,'continue')
  db.close()
})

test('full workflow review delegates to an independent run without replacing the writer backend', async () => {
  const db=setup(), repo=createCodexRepository(db)
  let delegated=0
  const run=repo.createRun({projectId:'p',chapterId:'c',workflowId:'chapter-creation',executionMode:'codex'})
  repo.updateRun(run.id,{actualBackend:'codex_acp'})
  const sourceStep=run.steps.find(step=>step.task==='chapter'),reviewStep=run.steps.find(step=>step.task==='quality_review')
  repo.createCandidate({projectId:'p',chapterId:'c',runId:run.id,stepId:sourceStep.id,artifactType:'manuscript',sourceDigest:'s',payload:{manuscript:prose}})
  const runtime=new AgentRuntime({repository:repo,runIndependentReview:async()=>{ delegated++;return {result:{reviewRunId:'separate-context',qualityReportId:'',backend:'remote'},payload:{summary:'仅测试',scores:{},issues:[]}} },persistQualityReview:async()=>''})
  await runtime._executeQualityStep({run:repo.getRun(run.id),step:reviewStep,mirror:null})
  assert.equal(delegated,1)
  const result=repo.getRun(run.id)
  assert.equal(result.actualBackend,'codex_acp')
  assert.equal(result.steps.find(step=>step.id===reviewStep.id).output.reviewRunId,'separate-context')
  db.close()
})
