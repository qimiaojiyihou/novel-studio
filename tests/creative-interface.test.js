import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { request as httpRequest } from 'node:http'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createPlanningRepository } from '../electron/planning-repository.js'
import { createKnowledgeRepository } from '../electron/knowledge-repository.js'
import { createContextRepository } from '../electron/context-repository.js'
import { createPromptRepository } from '../electron/prompt-repository.js'
import { createAuthoringRepository } from '../electron/authoring-repository.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { AgentRuntime } from '../electron/agent-runtime.js'
import { ChapterFinalizer, contentDigest, createFinalizationRepository } from '../electron/chapter-finalization.js'
import { CreativeInterface, creativeDigest } from '../electron/creative-interface.js'
import { createZhuqueDetectionService } from '../electron/zhuque-detection.js'
import { readCreativeSnapshot } from '../electron/creative-snapshot.js'
import { startCreativeServer } from '../electron/creative-server.js'
import { bindCreative, callCreative } from '../scripts/creative-client.mjs'
import { assertIsolatedRuntime } from '../scripts/smoke-isolation.mjs'

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'novel-dual-book-test-'))
  const file = path.join(directory,'novel-studio.sqlite'), db=new DatabaseSync(file)
  // Query SQLite itself before the first fixture/schema mutation.
  assertIsolatedRuntime({ database:{ path:db.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file } },directory)
  runMigrations(db)
  const workspace=createWorkspaceRepository(db), planning=createPlanningRepository(db), knowledge=createKnowledgeRepository(db)
  const context=createContextRepository(db), prompts=createPromptRepository(db), authoring=createAuthoringRepository(db), repository=createCodexRepository(db)
  const a=workspace.createProject({ title:'隔离悬疑书',genre:'悬疑',idea:'仅工程测试 A' })
  const b=workspace.createProject({ title:'隔离文娱书',genre:'文娱',idea:'仅工程测试 B' })
  for (const book of [a,b]) planning.loadPlanningCenter(book.project.id)
  const calls=[], gates=new Map(), cancelled=[]
  const runtime=new AgentRuntime({ repository,createMirror:async run=>({ root:directory,workspaceRoot:directory,sourceDigest:readCreativeSnapshot(db,run.projectId).sourceDigest }),
    currentSourceDigest:async run=>readCreativeSnapshot(db,run.projectId).sourceDigest,
    prepareCodexPrompt:async ({ run })=>({ messages:[{role:'user',content:run.projectId}],model:run.modelRoutes.codexModel,reasoningEffort:run.modelRoutes.codexReasoningEffort }),
    codexGateway:{ prompt:async request=>{
      calls.push(request)
      return new Promise((resolve,reject)=>{
        gates.set(request.agentRunId,()=>resolve({ structuredOutput:{ manuscript:`只属于 ${request.settings.projectId} 的候选正文。` },backend:'mock' }))
        request.signal.addEventListener('abort',()=>reject(new Error('fixture cancelled')),{ once:true })
      })
    },closeSession:async id=>{cancelled.push(id)},cancelTurn:async id=>{cancelled.push(id)} },
    applyCandidate:async ({run,candidate})=>workspace.updateChapter({id:run.chapterId,manuscript:candidate.payload.manuscript}),
    runPreflight:async()=>({blocked:false}),runAppModel:async()=>{throw new Error('unexpected model fallback')},
  })
  const finalizer = new ChapterFinalizer({repository:createFinalizationRepository(db),execute:async (task,record)=>task==='quality_review'
    ? {summary:'工程审稿',issues:[]}: {summary:'交接',facts:[{text:'本章文本',evidence:record.manuscript}],characterStates:[],relationshipChanges:[],timelineEvents:[],openThreads:[],foreshadow:{setups:[],payoffs:[]}} })
  const invoke=async(channel,p)=>{
    const routes={
      'agent:start-inline':()=>runtime.startInline({...p,modelRoutes:{creativeRequestId:p._creativeRequestId,codexModel:p.codexModel,codexReasoningEffort:p.codexReasoningEffort}}),
      'agent:get':()=>repository.getRun(p),'agent:list':()=>repository.listRuns(p),'agent:events':()=>repository.listEvents(p.agentRunId,p),
      'agent:cancel':()=>runtime.cancel(p),'agent:pause':()=>runtime.pause(p),'agent:resume':()=>runtime.resume(p),'agent:retry-step':()=>runtime.retryStep(p),
      'agent:finish-inline':()=>runtime.finishInline(p),'agent:continue-inline':()=>runtime.continueInline(p),
      'agent:confirm-candidate':()=>runtime.confirmCandidate({...p,accept:true}),'agent:reject-candidate':()=>runtime.confirmCandidate({...p,accept:false}),
      'approvals:list':()=>repository.listApprovals(p),'approvals:resolve':()=>repository.resolveApproval(p),
      'project:update':()=>workspace.updateProject(p),'chapter:create':()=>workspace.createChapter(p),'chapter:update':()=>workspace.updateChapter(p),
      'chapters:reorder':()=>workspace.reorderChapters(p),'revisions:list':()=>workspace.listRevisions(p),
      'planning:document-save':()=>planning.saveDocument(p),'planning:entity-create':()=>planning.createEntity(p),'planning:entity-update':()=>planning.updateEntity(p),
      'planning:entities-reorder':()=>planning.reorderEntities(p),'planning:relationship-create':()=>planning.createRelationship(p),
      'planning:relationship-update':()=>planning.updateRelationship(p),'planning:arc-create':()=>planning.createStoryArc(p),'planning:arc-update':()=>planning.updateStoryArc(p),
      'planning:arc-beat-create':()=>planning.createStoryArcBeat(p),'planning:arc-beat-update':()=>planning.updateStoryArcBeat(p),
      'knowledge:item-create':()=>knowledge.createItem(p),'knowledge:item-update':()=>knowledge.updateItem(p),'knowledge:items-reorder':()=>knowledge.reorderItems(p),
      'knowledge:check-resolve':()=>knowledge.resolveCheck(p),'context:update':()=>context.updateContextProfile(p),'prompts:style-save':()=>prompts.saveStyleProfile(p),
      'authoring:save-sample':()=>authoring.saveSample(p),'authoring:protect':()=>authoring.protect(p),
      'chapter:finalize-start':()=>finalizer.start(p),'chapter:finalize-get':()=>p.id?finalizer.repository.get(p.id):finalizer.repository.latest(p.chapterId),
      'chapter:finalize-confirm':()=>p.action==='accept-state'?finalizer.repository.confirm(p.id):p.action==='cancel'?finalizer.repository.patch(p.id,{status:'cancelled'}):finalizer.advance(p.id,{acceptReview:p.action==='accept-review',reason:p.reason}),
    }
    assert.ok(routes[channel],channel)
    return routes[channel]()
  }
  const createApi=()=>new CreativeInterface({database:db,invoke,snapshot:id=>readCreativeSnapshot(db,id),stageCandidate:input=>runtime.stageExternalCandidate(input),buildId:'fixture'})
  const api=createApi(), tokens=['a'.repeat(64),'b'.repeat(64)]
  for (const [index,book] of [a,b].entries()) api.bind({clientId:`author-${index}`,projectId:book.project.id,expectedTitle:book.project.title,token:tokens[index]})
  const call=(index,operation,input={},requestId='')=>api.call(tokens[index],{operation,input,requestId})
  const start=(index,key='start-0001')=>call(index,'run.start-inline',{task:'chapter',chapterId:[a,b][index].chapters[0].id,target:{kind:'manuscript',targetId:[a,b][index].chapters[0].id},codexModel:'gpt-6-astra',codexReasoningEffort:'xhigh'},key)
  t.after(async()=>{for(const release of gates.values())release(); await Promise.allSettled([...runtime.active.values()]); db.close()})
  return {directory,file,db,workspace,planning,knowledge,context,prompts,authoring,repository,runtime,finalizer,api,createApi,a,b,tokens,call,start,calls,gates,cancelled}
}
const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('fixture timeout')}

test('bound author reads only its own Zhuque result and sees source staleness after editing', async t => {
  const f=setup(t)
  const chapterId=f.a.chapters[0].id
  f.workspace.updateChapter({id:chapterId,manuscript:'甲书测试正文。'})
  const detector=createZhuqueDetectionService(f.db,{getApiKey:()=> 'fixture-key',fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'success',ratio_confidence:.2,segment_labels:[{text:'甲书测试正文。',label:2,conf:.6}]})})})
  const result=await detector.detect({projectId:f.a.project.id,chapterId})
  f.workspace.loadWorkspace(f.b.project.id)
  assert.equal((await f.call(0,'zhuque.get',{chapterId})).manuscriptDigest,result.manuscriptDigest)
  assert.equal(await f.call(1,'zhuque.get',{chapterId:f.b.chapters[0].id}),null)
  await assert.rejects(f.call(1,'zhuque.get',{chapterId}),{code:'PROJECT_MISMATCH'})
  f.workspace.updateChapter({id:chapterId,manuscript:'甲书更新后的正文。'})
  assert.equal((await f.call(0,'zhuque.get',{chapterId})).stale,true)
})

test('two book clients interleave model turns, keep fixed identities across UI switching, and isolate events and approvals',async t=>{
  const f=setup(t), before=creativeDigest(readCreativeSnapshot(f.db,f.a.project.id))
  await f.call(0,'snapshot')
  assert.equal(creativeDigest(readCreativeSnapshot(f.db,f.a.project.id)),before,'snapshot has no writes')
  const [ra,rb]=await Promise.all([f.start(0),f.start(1)])
  await waitFor(()=>f.calls.length===2)
  f.workspace.loadWorkspace(f.b.project.id)
  assert.equal((await f.call(0,'identity')).projectId,f.a.project.id)
  assert.equal((await f.call(0,'snapshot')).chapters[0].project_id,f.a.project.id)
  assert.equal(f.calls[0].settings.model,'gpt-6-astra')
  assert.equal(f.calls[1].settings.reasoningEffort,'xhigh')
  f.gates.get(rb.id)();f.gates.get(ra.id)()
  await Promise.all([...f.runtime.active.values()])
  assert.equal((await f.call(0,'run.get',{runId:ra.id})).candidates[0].projectId,f.a.project.id)
  assert.ok((await f.call(0,'run.events',{runId:ra.id})).every(event=>event.agentRunId===ra.id))
  const events=await f.call(0,'run.events',{runId:ra.id})
  assert.deepEqual(await f.call(0,'run.events',{runId:ra.id,afterSequence:events.at(-1).sequence}),[])
  const approval=f.repository.createApproval({projectId:f.b.project.id,agentRunId:rb.id,actionType:'file',permission:'B fixture'})
  await assert.rejects(f.call(0,'approval.resolve',{id:approval.id,approved:true,confirm:true,reason:'用户确认'},'approve-0001'),{code:'PROJECT_MISMATCH'})
  assert.equal((await f.call(0,'approvals.list')).length,0)
  assert.equal((await f.call(1,'approvals.list')).length,1)
})

test('capability binding and every referenced chapter, run, step, source and candidate are checked before mutation',async t=>{
  const f=setup(t),[ra,rb]=await Promise.all([f.start(0),f.start(1)])
  await assert.rejects(f.call(0,'snapshot',{projectId:f.b.project.id}),{code:'PROJECT_MISMATCH'})
  await assert.rejects(f.call(0,'chapter.get',{chapterId:f.b.chapters[0].id}),{code:'PROJECT_MISMATCH'})
  await assert.rejects(f.call(0,'run.cancel',{runId:rb.id},'cancel-0001'),{code:'PROJECT_MISMATCH'})
  await assert.rejects(f.call(0,'run.retry',{runId:ra.id,stepId:rb.steps[0].id},'retry-00001'),{code:'PROJECT_MISMATCH'})
  await assert.rejects(f.call(0,'run.start-inline',{chapterId:f.b.chapters[0].id,task:'chapter',target:{kind:'manuscript',targetId:f.a.chapters[0].id}},'start-evil1'),{code:'PROJECT_MISMATCH'})
  assert.throws(()=>f.api.bind({clientId:'author-0',projectId:f.b.project.id,expectedTitle:f.b.project.title,token:f.tokens[0]}),{code:'BINDING_CONFLICT'})
  assert.throws(()=>f.api.bind({clientId:'new-author',projectId:f.b.project.id,expectedTitle:f.a.project.title,token:'c'.repeat(64)}),{code:'IDENTITY_MISMATCH'})
  await waitFor(()=>f.calls.length===2)
  f.gates.get(ra.id)();f.gates.get(rb.id)();await Promise.all([...f.runtime.active.values()])
  const candidate=f.repository.getRun(rb.id).candidates[0]
  await assert.rejects(f.call(0,'candidate.resolve',{runId:ra.id,candidateId:candidate.id,accept:true,confirm:true,reason:'fixture'},'accept-evil'),{code:'PROJECT_MISMATCH'})
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.b.project.id).chapters[0].manuscript,'')
})

test('external authors create project-scoped planning entities, relationships, arcs and beats with replay-safe writes',async t=>{
  const f=setup(t), before=(await f.call(0,'snapshot')).sourceDigest
  const create=(operation,input,requestId)=>f.call(0,operation,{...input,confirm:true,reason:'作者要求建立新书规划'},requestId)
  await assert.rejects(f.call(0,'planning.entity.create',{kind:'character',title:'未确认人物'},'plan-no-confirm'),{code:'CONFIRMATION_REQUIRED'})
  const protagonist=await create('planning.entity.create',{kind:'character',title:'程砚',data:{role:'主角',goal:'查清失踪案'}},'plan-character-01')
  const partner=await create('planning.entity.create',{kind:'character',title:'陆微',data:{role:'搭档'}},'plan-character-02')
  const location=await create('planning.entity.create',{kind:'world',title:'旧港站',data:{category:'地点',summary:'封闭货运站'}},'plan-world-001')
  const volume=await create('planning.entity.create',{kind:'volume',title:'第一卷 雾港'},'plan-volume-01')
  const relationship=await create('planning.relationship.create',{fromCharacterId:protagonist.id,toCharacterId:partner.id,label:'临时同盟',tension:'彼此隐瞒线索'},'plan-relation-1')
  const arc=await create('planning.arc.create',{title:'失踪案主线',category:'main',premise:'追查旧港失踪案',destination:'揭开幕后交易'},'plan-arc-0001')
  const beat=await create('planning.arc-beat.create',{arcId:arc.id,volumeId:volume.id,label:'发现货单',changeText:'主角确认案件与旧港有关'},'plan-beat-001')

  assert.equal((await create('planning.entity.create',{kind:'character',title:'程砚',data:{role:'主角',goal:'查清失踪案'}},'plan-character-01')).id,protagonist.id)
  assert.equal(relationship.fromCharacterName,'程砚')
  assert.equal(beat.arcId,arc.id)
  const snapshot=await f.call(0,'snapshot')
  assert.notEqual(snapshot.sourceDigest,before)
  assert.ok(snapshot.planning.entities.some(row=>row.id===location.id && row.project_id===f.a.project.id))
  assert.ok(snapshot.planning.relationships.some(row=>row.id===relationship.id))
  assert.ok(snapshot.planning.arcs.some(row=>row.id===arc.id))
  assert.ok(snapshot.planning.beats.some(row=>row.id===beat.id))
  assert.equal((await f.call(1,'snapshot')).planning.entities.some(row=>row.id===protagonist.id),false)

  const foreign=f.planning.createEntity({projectId:f.b.project.id,kind:'character',title:'另一书人物'})
  await assert.rejects(create('planning.relationship.create',{fromCharacterId:protagonist.id,toCharacterId:foreign.id,label:'越界关系'},'plan-cross-rel'),{code:'PROJECT_MISMATCH'})
  await assert.rejects(create('planning.arc-beat.create',{arcId:arc.id,volumeId:foreign.id,label:'错误分卷'},'plan-cross-beat'),{code:'PROJECT_MISMATCH'})
  await assert.rejects(create('planning.entity.create',{kind:'chapter',title:'错误类型'},'plan-kind-bad'),{code:'INVALID_INPUT'})
})

test('bound authors can directly write every project content center without following the foreground project',async t=>{
  const f=setup(t)
  const initialDigest=(await f.call(0,'snapshot')).sourceDigest
  f.context.loadContextManager(f.a.project.id)
  f.knowledge.loadKnowledgeCenter(f.a.project.id)
  assert.equal((await f.call(0,'snapshot')).sourceDigest,initialDigest,'derived default context and system checks are not author content changes')
  let sequence=0
  const write=async(operation,input={})=>{
    const source=await f.call(0,'snapshot')
    sequence+=1
    return f.call(0,operation,{...input,sourceDigest:source.sourceDigest,confirm:true,reason:'作者确认通过外接写入正式项目内容'},`content-${String(sequence).padStart(4,'0')}`)
  }

  const project=await write('project.update',{idea:'外接写入的一句话想法',style:'克制、具体，以动作推进。'})
  assert.equal(project.idea,'外接写入的一句话想法')
  const document=await write('planning.document.save',{kind:'foundation',content:{targetReader:'社会派悬疑读者',premise:'一名死者持续通过生存认证。'}})
  assert.equal(document.content.premise,'一名死者持续通过生存认证。')

  const first=await f.call(0,'planning.entity.create',{kind:'character',title:'林岚',data:{role:'经办员'},confirm:true,reason:'作者建立人物'},'direct-character-01')
  const second=await f.call(0,'planning.entity.create',{kind:'character',title:'沈伯',data:{role:'认证对象'},confirm:true,reason:'作者建立人物'},'direct-character-02')
  const updatedEntity=await write('planning.entity.update',{id:first.id,title:'林岚',data:{goal:'核对九年回执'}})
  assert.equal(updatedEntity.data.goal,'核对九年回执')
  const relationship=await f.call(0,'planning.relationship.create',{fromCharacterId:first.id,toCharacterId:second.id,label:'经办关系',confirm:true,reason:'作者建立关系'},'direct-relation-01')
  assert.equal((await write('planning.relationship.update',{id:relationship.id,label:'调查与被调查',tension:'身份记录相互冲突'})).tension,'身份记录相互冲突')
  const arc=await f.call(0,'planning.arc.create',{title:'九张回执',confirm:true,reason:'作者建立情节弧'},'direct-arc-0001')
  const beat=await f.call(0,'planning.arc-beat.create',{arcId:arc.id,chapterId:f.a.chapters[0].id,label:'首次异常',confirm:true,reason:'作者建立情节节点'},'direct-beat-001')
  assert.equal((await write('planning.arc.update',{id:arc.id,premise:'逐年回查认证痕迹'})).premise,'逐年回查认证痕迹')
  assert.equal((await write('planning.arc-beat.update',{id:beat.id,changeText:'认证失败暴露第二个代办者'})).changeText,'认证失败暴露第二个代办者')
  const reordered=await write('planning.entities.reorder',{kind:'character',entityIds:[second.id,first.id]})
  assert.deepEqual(reordered.map(item=>item.id),[second.id,first.id])

  const manuscript='林岚把第九张回执压在窗口玻璃下。'
  const chapter=await write('chapter.update',{id:f.a.chapters[0].id,title:'第九次认证',expectedManuscript:'',manuscript,card:{goal:'查明失败原因'},scenePlan:{version:1,scenes:[]}})
  assert.equal(chapter.manuscript,manuscript)
  assert.equal(chapter.card.goal,'查明失败原因')
  const added=await f.call(0,'chapter.create',{title:'回执背面',confirm:true,reason:'作者新增章节'},'direct-chapter-02')
  const chapters=await write('chapters.reorder',{chapterIds:[added.id,f.a.chapters[0].id]})
  assert.deepEqual(chapters.map(item=>item.id),[added.id,f.a.chapters[0].id])

  const fact=await write('knowledge.item.create',{kind:'fact',title:'认证周期',content:{fact:'每年夏季完成一次资格认证'}})
  const updatedFact=await write('knowledge.item.update',{id:fact.id,content:{fact:'每年七月完成一次资格认证'},effectiveFromChapter:1,knowledgeScope:{reader:false,characters:[first.id]}})
  assert.equal(updatedFact.content.fact,'每年七月完成一次资格认证')
  const check=f.knowledge.loadKnowledgeCenter(f.a.project.id).checks.find(item=>item.status==='open')
  const resolvedCheck=await write('knowledge.check.resolve',{id:check.id,expectedStatus:'open',status:'dismissed'})
  assert.equal(resolvedCheck.status,'dismissed')
  const profile=await write('context.update',{maxContextChars:48000,recentChapterCount:4})
  assert.equal(profile.profile.maxContextChars,48000)
  const styles=await write('prompt.style.save',{scopeType:'project',scopeId:f.a.project.id,text:'平静叙述惨烈内容。',style:{narrativeDistance:'restrained'}})
  assert.equal(styles.styleScopes.find(item=>item.scopeType==='project').style.narrativeDistance,'restrained')

  await write('authoring.sample.save',{chapterId:f.a.chapters[0].id,manuscriptDigest:contentDigest(manuscript),text:'第九张回执',reason:'作者认可这一处具体物象'})
  await write('authoring.protection.save',{chapterId:f.a.chapters[0].id,manuscriptDigest:contentDigest(manuscript),from:0,to:2})
  const snapshot=await f.call(0,'snapshot')
  assert.equal(snapshot.project.idea,'外接写入的一句话想法')
  assert.equal(snapshot.contextProfile.max_context_chars,48000)
  assert.ok(snapshot.styleSamples.some(item=>item.project_id===f.a.project.id))
  assert.ok(snapshot.protections.some(item=>item.text==='林岚'))
  assert.equal((await f.call(1,'snapshot')).project.idea,'仅工程测试 B')
})

test('direct content writes require confirmation and a fresh project snapshot; queued stale writers do not overwrite',async t=>{
  const f=setup(t), source=await f.call(0,'snapshot')
  const base={sourceDigest:source.sourceDigest,confirm:true,reason:'作者确认修改设定'}
  await assert.rejects(f.call(0,'project.update',{...base,confirm:false,idea:'未确认'},'direct-denied-01'),{code:'CONFIRMATION_REQUIRED'})
  await assert.rejects(f.call(0,'project.update',{confirm:true,reason:'缺少来源',idea:'未确认'},'direct-denied-02'),{code:'SOURCE_STALE'})
  await assert.rejects(f.call(0,'chapter.update',{...base,id:f.b.chapters[0].id,manuscript:'越界'},'direct-cross-01'),{code:'PROJECT_MISMATCH'})
  const [first,second]=await Promise.allSettled([
    f.call(0,'project.update',{...base,idea:'第一个外接任务写入'},'direct-race-01'),
    f.call(0,'project.update',{...base,style:'第二个外接任务的过期写入'},'direct-race-02'),
  ])
  assert.equal(first.status,'fulfilled')
  assert.equal(second.status,'rejected')
  assert.equal(second.reason.code,'SOURCE_STALE')
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.a.project.id).project.idea,'第一个外接任务写入')
  assert.notEqual(f.workspace.loadWorkspaceSnapshot(f.a.project.id).project.style,'第二个外接任务的过期写入')
})

test('same-target competition is rejected; concurrent duplicates and lost responses reuse one run and one formal write',async t=>{
  const f=setup(t)
  const [first,duplicate]=await Promise.all([f.start(0),f.start(0)])
  assert.equal(first.id,duplicate.id)
  await assert.rejects(f.start(0,'start-0002'),{code:'TARGET_BUSY'})
  const secondToken='c'.repeat(64)
  f.api.bind({clientId:'second-author',projectId:f.a.project.id,expectedTitle:f.a.project.title,token:secondToken})
  await assert.rejects(f.api.call(secondToken,{operation:'run.start-inline',requestId:'second-0001',input:{task:'chapter',chapterId:f.a.chapters[0].id,target:{kind:'manuscript',targetId:f.a.chapters[0].id}}}),{code:'TARGET_BUSY'})
  await assert.rejects(f.call(0,'run.start-inline',{task:'chapter'},'start-0001'),{code:'IDEMPOTENCY_CONFLICT'})
  assert.equal((await f.start(0)).id,first.id,'dropped response replay')
  await waitFor(()=>f.calls.length===1); f.gates.get(first.id)();await Promise.all([...f.runtime.active.values()])
  const candidate=f.repository.getRun(first.id).candidates[0]
  const input={runId:first.id,candidateId:candidate.id,accept:true,confirm:true,reason:'工程测试作者确认'}
  await assert.rejects(f.call(0,'candidate.resolve',{...input,confirm:false},'accept-no-confirm'),{code:'CONFIRMATION_REQUIRED'})
  const results=await Promise.all([f.call(0,'candidate.resolve',input,'accept-0001'),f.call(0,'candidate.resolve',input,'accept-0001')])
  assert.equal(results[0].id,results[1].id)
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM bridge_action_requests WHERE action_type='project_write'").get().n,1)
  assert.match(f.workspace.loadWorkspaceSnapshot(f.a.project.id).chapters[0].manuscript,/候选正文/)
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.b.project.id).chapters[0].manuscript,'')
})

test('source changes keep external proposals and generated candidates out of formal manuscripts',async t=>{
  const f=setup(t), source=await f.call(0,'snapshot')
  const input={task:'chapter',chapterId:f.a.chapters[0].id,target:{kind:'manuscript',targetId:f.a.chapters[0].id},sourceDigest:source.sourceDigest,payload:{manuscript:'作者外部候选'}}
  const proposed=await f.call(0,'candidate.propose',input,'propose-001')
  assert.equal(f.calls.length,0)
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.a.project.id).chapters[0].manuscript,'')
  f.workspace.updateChapter({id:f.a.chapters[0].id,manuscript:'前台新修改'})
  await assert.rejects(f.call(0,'candidate.resolve',{runId:proposed.id,candidateId:proposed.candidates[0].id,accept:true,confirm:true,reason:'fixture'},'accept-stale'),/过期/)
  assert.equal(f.repository.getRun(proposed.id).candidates[0].status,'stale')
  await f.call(0,'run.cancel',{runId:proposed.id},'cancel-stale')
  await assert.rejects(f.call(0,'candidate.propose',input,'propose-002'),{code:'SOURCE_STALE'})
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.a.project.id).chapters[0].manuscript,'前台新修改')
})

test('one book cancellation and explicit restart recovery preserve the other book and original model locks',async t=>{
  const f=setup(t),[ra,rb]=await Promise.all([f.start(0),f.start(1)])
  await waitFor(()=>f.calls.length===2)
  await f.call(0,'run.cancel',{runId:ra.id},'cancel-0001')
  await waitFor(()=>!f.runtime.active.has(ra.id))
  assert.equal(f.repository.getRun(rb.id).status,'running')
  assert.deepEqual(f.cancelled,[ra.id])
  // Simulate process loss after side effect but before the response is durable.
  f.db.prepare("UPDATE creative_requests SET status='processing' WHERE project_id=?").run(f.b.project.id)
  f.gates.get(rb.id)();await Promise.all([...f.runtime.active.values()])
  f.repository.updateRun(rb.id,{status:'running'})
  f.repository.updateStep(rb.steps[0].id,{status:'running'})
  f.db.prepare(`INSERT INTO agent_steps(id,run_id,step_key,position,action,task,candidate_type,status,depends_on_json,input_json,created_at,updated_at)
    SELECT 'pending-after-restart',run_id,'later',2,action,task,candidate_type,'pending',depends_on_json,input_json,created_at,updated_at FROM agent_steps WHERE id=?`).run(rb.steps[0].id)
  const restarted=f.createApi()
  assert.equal(f.repository.getRun(ra.id).status,'cancelled')
  assert.equal(f.repository.getRun(rb.id).status,'paused')
  assert.equal(f.repository.getRun(rb.id).steps[1].status,'pending','future steps are not interrupted')
  const result=await restarted.call(f.tokens[1],{operation:'request.get',input:{requestId:'start-0001'}})
  assert.equal(result.status,'interrupted')
  assert.equal(result.error.details.runId,rb.id)
  await assert.rejects(restarted.call(f.tokens[1],{operation:'run.start-inline',input:JSON.parse(f.db.prepare('SELECT payload_json FROM creative_requests WHERE project_id=?').get(f.b.project.id).payload_json),requestId:'start-0001'}),{code:'REQUEST_INTERRUPTED'})
  assert.equal(f.calls.length,2)
  assert.equal(f.repository.getRun(rb.id).modelRoutes.codexModel,'gpt-6-astra')
})

test('local finalization stays local-first and cross-book handoff confirmation is rejected',async t=>{
  const f=setup(t)
  f.workspace.updateChapter({id:f.a.chapters[0].id,manuscript:'周砚付了租金。'})
  const record=await f.call(0,'finalization.start',{chapterId:f.a.chapters[0].id,reviewer:{executionMode:'codex',model:'gpt-6-astra',reasoningEffort:'xhigh'}},'finalize-01')
  assert.equal(record.status,'ready_for_review');assert.equal(f.calls.length,0)
  await assert.rejects(f.call(1,'finalization.get',{id:record.id}),{code:'PROJECT_MISMATCH'})
  await assert.rejects(f.call(1,'finalization.act',{id:record.id,action:'accept-state',confirm:true,reason:'fixture'},'handoff-bad'),{code:'PROJECT_MISMATCH'})
  await f.call(0,'finalization.act',{id:record.id,action:'start-review'},'review-0001')
  await f.call(0,'finalization.act',{id:record.id,action:'accept-review',confirm:true,reason:'fixture'},'review-0002')
  await f.call(0,'finalization.act',{id:record.id,action:'accept-state',confirm:true,reason:'fixture'},'handoff-001')
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.a.project.id).chapters[0].status,'completed')
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.b.project.id).chapters[0].status,'draft')
})

test('loopback transport has separate project capabilities, no browser binding, and survives reconnect',async t=>{
  const f=setup(t), directory=path.join(f.directory,'creative-interface')
  const server=await startCreativeServer({api:f.api,directory,databasePath:f.file,buildId:'fixture'})
  t.after(()=>server.close())
  const binding=await bindCreative(directory,{clientId:'http-author',projectId:f.a.project.id,expectedTitle:f.a.project.title})
  const first=await callCreative(binding.clientFile,'identity')
  assert.equal(first.projectId,f.a.project.id)
  const input={title:'仅 A 新章',confirm:true,reason:'工程确认'}
  const once=await callCreative(binding.clientFile,'chapter.create',input,'create-0001')
  const replay=await callCreative(binding.clientFile,'chapter.create',input,'create-0001')
  assert.equal(once.id,replay.id)
  const freshServer=JSON.parse(fs.readFileSync(server.serverFile,'utf8'))
  const bad=await fetch(`${freshServer.url}/v1/call`,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:'{}'})
  assert.equal((await bad.json()).ok,false)
  assert.equal(fs.statSync(binding.clientFile).mode & 0o777,0o600)
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.b.project.id).chapters.length,1)
  const client=JSON.parse(fs.readFileSync(binding.clientFile,'utf8'))
  let release
  const held=f.api.queue.run(f.a.project.id,()=>new Promise(resolve=>{release=resolve}))
  await waitFor(()=>Boolean(release))
  const lostInput={title:'丢失响应的新章',confirm:true,reason:'工程确认'}
  const request=httpRequest(`${freshServer.url}/v1/call`,{method:'POST',headers:{authorization:`Bearer ${client.token}`,'content-type':'application/json'}})
  request.on('error',()=>{})
  request.end(JSON.stringify({operation:'chapter.create',input:lostInput,requestId:'lost-response-01'}))
  await waitFor(()=>Boolean(f.db.prepare("SELECT id FROM creative_requests WHERE request_key='lost-response-01'").get()))
  request.destroy();release();await held
  await waitFor(()=>f.db.prepare("SELECT status FROM creative_requests WHERE request_key='lost-response-01'").get()?.status==='completed')
  const recovered=await callCreative(binding.clientFile,'chapter.create',lostInput,'lost-response-01')
  assert.equal(f.workspace.loadWorkspaceSnapshot(f.a.project.id).chapters.filter(row=>row.title===lostInput.title).length,1)
  await server.close()
  const restarted=await startCreativeServer({api:f.createApi(),directory,databasePath:f.file,buildId:'fixture'})
  t.after(()=>restarted.close())
  assert.notEqual(restarted.instanceId,server.instanceId)
  assert.equal((await callCreative(binding.clientFile,'identity')).projectId,f.a.project.id)
  assert.equal((await callCreative(binding.clientFile,'chapter.create',lostInput,'lost-response-01')).id,recovered.id)
})

test('restart marks only externally bound active finalizations recoverable and retains request association',async t=>{
  const f=setup(t)
  for(const book of [f.a,f.b]) f.workspace.updateChapter({id:book.chapters[0].id,manuscript:'已保存的测试正文。'})
  const a=await f.call(0,'finalization.start',{chapterId:f.a.chapters[0].id,reviewer:{executionMode:'codex'}},'finalize-restart')
  const b=await f.call(1,'finalization.start',{chapterId:f.b.chapters[0].id,reviewer:{executionMode:'codex'}},'finalize-stable1')
  const journal=f.db.prepare("SELECT id FROM creative_requests WHERE request_key='finalize-restart'").get()
  f.finalizer.repository.patch(a.id,{status:'extracting',checks_json:JSON.stringify({...a.checks,creativeRequestId:journal.id})})
  f.db.prepare("UPDATE creative_requests SET status='processing' WHERE id=?").run(journal.id)
  const restarted=f.createApi()
  assert.equal(f.finalizer.repository.get(a.id).status,'failed')
  assert.equal(f.finalizer.repository.get(b.id).status,'ready_for_review')
  const receipt=await restarted.call(f.tokens[0],{operation:'request.get',input:{requestId:'finalize-restart'}})
  assert.equal(receipt.error.details.finalizationId,a.id)
  assert.equal(f.calls.length,0)
})

test('external progress reads are pure and expiring an approval never touches the other book',async t=>{
  const f=setup(t)
  const a=f.repository.createApproval({projectId:f.a.project.id,actionType:'file',permission:'A',expiresAt:'2020-01-01T00:00:00Z'})
  const b=f.repository.createApproval({projectId:f.b.project.id,actionType:'file',permission:'B',expiresAt:'2020-01-01T00:00:00Z'})
  const changes=()=>f.db.prepare('SELECT total_changes() AS n').get().n
  const before=changes()
  await f.call(0,'snapshot');assert.deepEqual(await f.call(0,'approvals.list'),[]);await f.call(0,'runs.list')
  await f.call(0,'finalization.get',{chapterId:f.a.chapters[0].id})
  await assert.rejects(f.call(0,'approval.resolve',{approved:true,confirm:true,reason:'fixture'},'missing-approval'),{code:'PROJECT_MISMATCH'})
  assert.equal(changes(),before)
  assert.equal(f.repository.getApproval(a.id).status,'expired')
  assert.equal(f.db.prepare('SELECT status FROM bridge_action_requests WHERE id=?').get(b.id).status,'pending')
})
