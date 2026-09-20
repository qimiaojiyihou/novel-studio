import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createPlanningRepository } from '../electron/planning-repository.js'
import { createKnowledgeRepository } from '../electron/knowledge-repository.js'
import { readCreativeSnapshot } from '../electron/creative-snapshot.js'
import { WorkDesignSync, parseWorkDesignPackage } from '../electron/work-design-sync.js'

function setup() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database)
  const workspace = createWorkspaceRepository(database)
  const book = workspace.createProject({ title:'现实遗物', genre:'社会派悬疑' })
  createPlanningRepository(database).loadPlanningCenter(book.project.id)
  const sync = new WorkDesignSync({ database, snapshot:id => readCreativeSnapshot(database,id), queue:{ run:(_id,action) => action() } })
  sync.saveBinding({ projectId:book.project.id, threadId:'01a0-work-thread', threadTitle:'《现实遗物》设定' })
  return { database, workspace, book, sync }
}

function packageValue(projectId, overrides = {}) {
  return {
    schemaVersion:1,
    packageVersion:'RW-20260921-001',
    baseVersion:'',
    sourceThreadId:'01a0-work-thread',
    projectId,
    summary:'建立第一版设计基线',
    project:{ genre:'社会派悬疑推理', idea:'九年生存认证留下九张回执。', style:'克制、具体、以动作和对白推进。' },
    documents:{
      foundation:{ premise:'死者连续九年通过养老金生存认证。', coreConflict:'谁在活，而不是谁杀的。' },
      world:{ hardRules:'认证方式按年份依次升级。' },
      outline:{ logline:'经办员从失败认证追查九年身份借用。' },
    },
    entities:[
      { ref:'character.clerk', kind:'character', title:'林知夏', data:{ role:'主角', identity:'社保经办员' } },
      { ref:'character.woman', kind:'character', title:'沈蓉', data:{ role:'过去线视角人物' } },
      { ref:'volume.001', kind:'volume', title:'第一卷', data:{ goal:'发现第一张回执' } },
    ],
    chapters:[{ ref:'chapter.001', title:'第一章', card:{ goal:'发现异常', volumeRef:'volume.001' }, scenePlan:'窗口核对失败认证。' }],
    relationships:[{ ref:'relationship.clerk-woman', fromRef:'character.clerk', toRef:'character.woman', label:'调查与被调查', direction:'mutual', trend:'hostile', status:'active' }],
    arcs:[{ ref:'arc.main', title:'认证调查线', category:'main', premise:'追查九张回执', destination:'两线汇流', status:'planned', colorKey:'copper', beats:[{ ref:'beat.main.001', label:'认证失败', changeText:'第九年认证首次失败', volumeRef:'volume.001', chapterRef:'chapter.001' }] }],
    knowledge:[{ ref:'fact.certification', kind:'fact', title:'认证更替', content:{ statement:'九年间认证方式更换四轮' }, status:'open' }],
    ...overrides,
  }
}

test('ChatGPT Work package parser accepts pure or fenced JSON and rejects prose', () => {
  const value = packageValue('project-1')
  assert.equal(parseWorkDesignPackage(JSON.stringify(value)).packageVersion, value.packageVersion)
  assert.equal(parseWorkDesignPackage(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``).sourceThreadId, value.sourceThreadId)
  assert.throws(() => parseWorkDesignPackage(`这是同步包：${JSON.stringify(value)}`), /不是有效 JSON/)
})

test('bound Work design package previews and applies every supported design layer without touching manuscript', async t => {
  const f = setup(); t.after(() => f.database.close())
  const originalManuscript = '这段正文必须保留。'
  f.workspace.updateChapter({ id:f.book.chapters[0].id, manuscript:originalManuscript })
  const prompt = f.sync.prompt(f.book.project.id, 'initial')
  assert.match(prompt, /01a0-work-thread/)
  assert.match(prompt, new RegExp(f.book.project.id))
  assert.match(prompt, /首次全量设计基线包/)
  assert.match(prompt, /不要只输出最近一轮变化/)
  assert.throws(() => f.sync.prompt(f.book.project.id, 'incremental'), /先使用首次全量同步/)

  const preview = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id)) })
  assert.equal(preview.status, 'previewed')
  assert.deepEqual(preview.preview.conflicts, [])
  assert.ok(preview.preview.changes.some(item => item.type === 'relationship'))
  assert.ok(preview.preview.changes.some(item => item.type === 'beat'))

  const applied = await f.sync.apply({ projectId:f.book.project.id, packageId:preview.id, previewDigest:preview.previewDigest, confirm:true })
  assert.equal(applied.status, 'applied')
  const state = f.sync.state(f.book.project.id)
  assert.equal(state.binding.lastAppliedVersion, 'RW-20260921-001')
  assert.match(f.sync.prompt(f.book.project.id, 'incremental'), /后续增量设计同步包/)
  assert.throws(() => f.sync.prompt(f.book.project.id, 'initial'), /基线已经建立/)
  const project = f.workspace.loadWorkspaceSnapshot(f.book.project.id)
  assert.equal(project.project.idea, '九年生存认证留下九张回执。')
  assert.equal(project.chapters[0].manuscript, originalManuscript)
  assert.equal(project.chapters[0].card.volumeId.startsWith('volume-'), true)
  const planning = createPlanningRepository(f.database).loadPlanningCenter(f.book.project.id)
  assert.equal(planning.documents.foundation.content.coreConflict, '谁在活，而不是谁杀的。')
  assert.equal(planning.characters.length, 2)
  assert.equal(planning.relationships.length, 1)
  assert.equal(planning.storyArcs[0].beats.length, 1)
  const knowledge = createKnowledgeRepository(f.database).loadKnowledgeCenter(f.book.project.id)
  assert.equal(knowledge.items.some(item => item.title === '认证更替'), true)
  assert.equal((await f.sync.apply({ projectId:f.book.project.id, packageId:preview.id, previewDigest:preview.previewDigest, confirm:true })).status, 'applied')
  const replay = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id)) })
  assert.equal(replay.id, preview.id)
  assert.equal(replay.status, 'applied')
})

test('sync rejects cross-project source, non-contiguous versions and stale previews', async t => {
  const f = setup(); t.after(() => f.database.close())
  await assert.rejects(f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue('another-project')) }), /项目 ID 不一致/)
  await assert.rejects(f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id,{ baseVersion:'missing-version' })) }), /同步基线不连续/)

  const preview = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id)) })
  f.workspace.updateProject({ id:f.book.project.id, style:'前台刚刚修改过的文风' })
  await assert.rejects(f.sync.apply({ projectId:f.book.project.id, packageId:preview.id, previewDigest:preview.previewDigest, confirm:true }), /项目内容已变化/)
})

test('a package cannot reference missing objects or reuse a version for different content', async t => {
  const f = setup(); t.after(() => f.database.close())
  const broken = packageValue(f.book.project.id, { entities:[], relationships:[{ ref:'relationship.missing', fromRef:'character.none', toRef:'character.other', label:'不存在' }] })
  const preview = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(broken) })
  assert.equal(preview.preview.conflicts.length, 3)
  await assert.rejects(f.sync.apply({ projectId:f.book.project.id, packageId:preview.id, previewDigest:preview.previewDigest, confirm:true }), /仍有冲突/)
  const changed = { ...broken, summary:'复用了相同版本但内容不同' }
  await assert.rejects(f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(changed) }), /同一 packageVersion/)
})

test('incremental updates preserve omitted chapter fields and adopt existing objects by identity', async t => {
  const f = setup(); t.after(() => f.database.close())
  const first = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id)) })
  await f.sync.apply({ projectId:f.book.project.id, packageId:first.id, previewDigest:first.previewDigest, confirm:true })
  const nextPackage = packageValue(f.book.project.id, {
    packageVersion:'RW-20260921-002',
    baseVersion:'RW-20260921-001',
    project:{}, documents:{}, entities:[], relationships:[], arcs:[], knowledge:[],
    chapters:[{ ref:'chapter.001', title:'第一章（修订）', card:{ goal:'确认异常来自同一身份证号' } }],
  })
  const next = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(nextPackage) })
  assert.equal(next.preview.changes[0].action, 'update')
  await f.sync.apply({ projectId:f.book.project.id, packageId:next.id, previewDigest:next.previewDigest, confirm:true })
  const chapter = f.workspace.loadWorkspaceSnapshot(f.book.project.id).chapters[0]
  assert.equal(chapter.scenePlan.legacyNotes, '窗口核对失败认证。')
  assert.equal(chapter.card.goal, '确认异常来自同一身份证号')
  assert.equal(chapter.manuscript, '')
})

test('an interrupted applying package is marked resumable on startup', async t => {
  const f = setup(); t.after(() => f.database.close())
  const preview = await f.sync.preview({ projectId:f.book.project.id, packageText:JSON.stringify(packageValue(f.book.project.id)) })
  f.database.prepare("UPDATE work_design_packages SET status='applying' WHERE id=?").run(preview.id)
  const recovered = new WorkDesignSync({ database:f.database, snapshot:id => readCreativeSnapshot(f.database,id), queue:{ run:(_id,action) => action() } })
  const row = recovered.state(f.book.project.id).packages.find(item => item.id === preview.id)
  assert.equal(row.status, 'failed')
  assert.match(row.error.message, /退出/)
})
