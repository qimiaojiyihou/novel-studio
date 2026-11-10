import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { runMigrations } from '../electron/database-migrations.js'
import { createContextRepository } from '../electron/context-repository.js'
import { createModelGateway } from '../electron/model-gateway.js'
import { inlineRevisionMessages } from '../electron/manuscript-patches.js'
import { buildContextDelta } from '../electron/context-reuse.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { dependencyDigest } from '../electron/creative-context.js'

function setup(targetVersion) {
  const database = new DatabaseSync(':memory:')
  let tick = 0
  const now = () => `2026-08-22T10:${String(tick++).padStart(2, '0')}:00.000Z`
  runMigrations(database, { now, targetVersion })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('project-1', '钥匙与旧车站', '都市悬疑', '主角寻找蓝色钥匙背后的原作者', '克制、具体', now(), now())
  const insertChapter = database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, 'project-1', ?, ?, 'draft', ?, ?, ?, ?)
  `)
  insertChapter.run('chapter-1', 1, '蓝色钥匙', JSON.stringify({ goal: '主角在储物柜拿到蓝色钥匙', ending: '钥匙刻着旧车站编号' }), '储物柜开启', '他把蓝色钥匙藏进外套内袋。', now())
  insertChapter.run('chapter-2', 2, '雨夜采访', JSON.stringify({ goal: '完成一场采访' }), '雨棚下谈判', '雨一直下，采访对象提前离开。', now())
  insertChapter.run('chapter-3', 3, '合同陷阱', JSON.stringify({ goal: '识破合同条款' }), '办公室审阅', '他没有签字。', now())
  insertChapter.run('chapter-4', 4, '车站来信', JSON.stringify({ goal: '收到匿名来信' }), '信件改变路线', '来信要求他午夜去旧车站。', now())
  insertChapter.run('chapter-5', 5, '午夜门锁', JSON.stringify({ goal: '用蓝色钥匙打开旧车站的门' }), '门外有人阻拦', '他站在门前，摸到外套里的钥匙。', now())
  database.prepare(`
    INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
    VALUES ('project-1', 'foundation', ?, ?, ?)
  `).run(JSON.stringify({ premise: '一把蓝色钥匙连接作者失踪案' }), now(), now())
  database.prepare(`
    INSERT INTO knowledge_items (id, project_id, kind, title, content_json, source_type, source_id, status, position, created_at, updated_at)
    VALUES (?, 'project-1', 'fact', ?, ?, 'manual', '', 'open', 1, ?, ?)
  `).run('knowledge-key', '钥匙规则', JSON.stringify({ statement: '蓝色钥匙只能在午夜使用' }), now(), now())
  database.prepare(`
    INSERT INTO continuity_checks (id, project_id, chapter_id, kind, severity, title, detail, source_json, origin, status, created_at, updated_at, resolved_at)
    VALUES (?, 'project-1', 'chapter-5', 'key-conflict', 'warning', ?, ?, '{}', 'system', 'open', ?, ?, '')
  `).run('check-key', '钥匙去向待核对', '确认蓝色钥匙是否仍在主角外套内袋。', now(), now())
  const repository = createContextRepository(database, { now })
  return { database, repository, now }
}

test('context manager builds and incrementally refreshes deterministic chapter memories', () => {
  const { database, repository, now } = setup()
  const initial = repository.loadContextManager('project-1')
  assert.equal(initial.profile.maxContextChars, 32000)
  assert.equal(initial.stats.memoryCount, 5)
  assert.match(initial.memories[0].summary, /蓝色钥匙/)
  const firstUpdatedAt = initial.memories[0].updatedAt

  const unchanged = repository.loadContextManager('project-1')
  assert.equal(unchanged.memories[0].updatedAt, firstUpdatedAt)
  database.prepare('UPDATE chapters SET manuscript = ?, updated_at = ? WHERE id = ?').run('钥匙被交给了周岚。', now(), 'chapter-1')
  const refreshed = repository.loadContextManager('project-1')
  assert.notEqual(refreshed.memories[0].updatedAt, firstUpdatedAt)
  assert.match(refreshed.memories[0].summary, /交给了周岚/)
  database.close()
})

test('generation context keeps recent chapters and recalls relevant older chapters and knowledge', () => {
  const { database, repository } = setup()
  repository.updateContextProfile({
    projectId: 'project-1',
    maxContextChars: 12000,
    recentChapterCount: 1,
    relevantChapterCount: 2,
    knowledgeLimit: 4,
    chapterSummaryChars: 700,
  })
  const context = repository.buildGenerationContext({
    projectId: 'project-1',
    chapterId: 'chapter-5',
    instruction: '延续蓝色钥匙在午夜才能使用的规则',
  })
  assert.ok(context.text.length <= 12000)
  assert.deepEqual(context.diagnostics.recentChapterIds, ['chapter-4'])
  assert.ok(context.diagnostics.relevantChapterIds.includes('chapter-1'))
  assert.ok(context.diagnostics.knowledgeItemIds.includes('knowledge-key'))
  assert.ok(context.diagnostics.knowledgeItemIds.includes('check-key'))
  assert.match(context.text, /最近章节记忆/)
  assert.match(context.text, /相关旧章召回/)
  assert.match(context.text, /蓝色钥匙只能在午夜使用/)
  assert.match(context.text, /钥匙去向待核对/)
  database.close()
})

test('accepted chapter state snapshots enter later chapter context', () => {
  const { database, repository, now } = setup()
  database.prepare(`
    INSERT INTO knowledge_candidates (id, project_id, chapter_id, task, payload_json, model_json, status, created_at, resolved_at)
    VALUES ('state-1', 'project-1', 'chapter-1', 'chapter_state_extract', ?, '{}', 'accepted', ?, ?)
  `).run(JSON.stringify({ summary: '主角把蓝色钥匙藏进外套内袋。', facts: [], characterStates: [], relationshipChanges: [], timelineEvents: [], foreshadow: { setups: [], payoffs: [] }, openThreads: ['钥匙来源'] }), now(), now())
  const context = repository.buildGenerationContext({ projectId: 'project-1', chapterId: 'chapter-5' })
  assert.match(context.text, /已确认章后状态/)
  assert.match(context.text, /钥匙来源/)
  assert.deepEqual(context.diagnostics.stateCandidateIds, ['state-1'])
  database.close()
})

test('context budget is enforced and project deletion cascades profiles and memories', () => {
  const { database, repository } = setup()
  database.prepare(`
    INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
    VALUES ('project-1', 'world', ?, '2026-08-22', '2026-08-22')
  `).run(JSON.stringify({ hardRules: '规则'.repeat(9000) }))
  repository.updateContextProfile({ projectId: 'project-1', maxContextChars: 8000 })
  const context = repository.buildGenerationContext({ projectId: 'project-1', chapterId: 'chapter-5' })
  assert.ok(context.text.length <= 8000)
  assert.equal(context.diagnostics.truncated, true)
  assert.equal(context.diagnostics.budgetChars, 8000)
  assert.match(context.text, /最近章节记忆/)

  database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM context_profiles').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chapter_memories').get().count, 0)
  database.close()
})

test('upgrading v38 preserves the current context profile, chapters, planning, knowledge and memories', (t) => {
  const { database, repository, now } = setup(38)
  t.after(() => database.close())
  repository.loadContextManager('project-1')
  database.exec("UPDATE context_profiles SET max_context_chars=180000, recent_chapter_count=5, knowledge_limit=22")
  const readRows = (table) => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))
  const originalProfiles = readRows('context_profiles')
  const tables = ['projects', 'chapters', 'planning_documents', 'knowledge_items', 'chapter_memories']
  const existing = tables.map(readRows)

  assert.equal(runMigrations(database, { now }), 39)
  assert.deepEqual(readRows('context_profiles'), originalProfiles.map((profile) => ({ ...profile, context_budget_unlimited: 0 })))
  assert.deepEqual(tables.map(readRows), existing)

  let updated = repository.updateContextProfile({ projectId: 'project-1', maxContextChars: 260000, contextBudgetUnlimited: true })
  assert.equal(updated.profile.contextBudgetUnlimited, true)
  updated = repository.updateContextProfile({ projectId: 'project-1', contextBudgetUnlimited: false })
  assert.equal(updated.profile.maxContextChars, 260000)
  assert.equal(updated.profile.contextBudgetUnlimited, false)
  assert.equal(updated.profile.knowledgeLimit, 22)
  assert.deepEqual(tables.map(readRows), existing)
})

test('unlimited context reaches generation intact and model capacity errors still surface', async (t) => {
  const { database, repository } = setup()
  t.after(() => database.close())
  const foundation = '星'.repeat(720000) + '完整资料末尾'
  database.prepare("UPDATE planning_documents SET content_json = ? WHERE kind = 'foundation'").run(JSON.stringify({ premise: foundation }))
  const input = { projectId: 'project-1', chapterId: 'chapter-5', instruction: '蓝色钥匙', creativePackVersion: '1.3.0' }
  repository.updateContextProfile({ projectId: input.projectId, maxContextChars: 260000 })
  assert.throws(() => repository.buildGenerationContext(input), /必需事实超出上下文预算（260000字符）/)
  repository.updateContextProfile({ projectId: input.projectId, contextBudgetUnlimited: true })
  for (const creativePackVersion of ['1.2.0', '1.3.0']) {
    const context = repository.buildGenerationContext({ ...input, creativePackVersion })
    assert.ok(context.text.includes(foundation))
    assert.equal(context.diagnostics.budgetChars, null)
    assert.equal(context.diagnostics.usedChars, context.text.length)
    assert.equal(context.diagnostics.truncated, false)
  }

  const received = []
  let exceeded = false
  const provider = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) })
    response.writeHead(exceeded ? 400 : 200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(exceeded
      ? { error: { code: 'context_length_exceeded', message: 'Maximum model context exceeded' } }
      : { choices: [{ message: { content: '主角收起了蓝色钥匙。' } }] }))
  }).listen(0, '127.0.0.1')
  t.after(() => new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve())))
  await once(provider, 'listening')
  const baseUrl = `http://127.0.0.1:${provider.address().port}`
  const gateway = createModelGateway({
    getGoRuntime: () => ({ status: 'ready', baseUrl, authToken: 'test-local-service' }),
    onGoUnavailable: () => assert.fail('large requests should not mark the Go service unavailable'),
  })
  const generate = (taskId) => gateway.generate({
    task: 'chapter',
    project: { title: '钥匙与旧车站', genre: '悬疑' },
    chapter: { title: '午夜门锁', chapter_no: 5, card: {} },
    modelProfile: { provider: 'local', model: 'fixture-model', baseUrl },
    longContext: repository.buildGenerationContext(input),
  }, { taskId })
  const result = await generate('unlimited-ok')
  assert.equal(result.manuscript, '主角收起了蓝色钥匙。')
  assert.equal(result.execution, 'remote')
  exceeded = true
  await assert.rejects(generate('unlimited-over-capacity'), /context_length_exceeded/)
  assert.equal(received.length, 2)
  for (const { path, body } of received) {
    assert.equal(path, '/chat/completions')
    assert.ok(body.messages.some(({ content }) => content.includes(foundation)))
  }
})

test('local revision sends only scoped reference text once, even with no project budget', (t) => {
  const { database, repository, now } = setup()
  t.after(() => database.close())
  const insert = database.prepare('INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run('volume', 'project-1', 'volume', '蓝色钥匙全卷规划', 1, JSON.stringify({ summary: '无关卷纲'.repeat(60000) }), now(), now())
  insert.run('hero', 'project-1', 'character', '周宁（主角）', 2, JSON.stringify({ voice: '说话简短', repairRevision: '旧修订历史'.repeat(20000) }), now(), now())
  database.prepare("INSERT INTO planning_documents (project_id,kind,content_json,created_at,updated_at) VALUES ('project-1','world',?,?,?)")
    .run(JSON.stringify({ hardRules: '蓝色钥匙只能在午夜使用' }), now(), now())
  database.prepare("UPDATE knowledge_items SET knowledge_scope_json=? WHERE id='knowledge-key'").run('{"author":true}')
  repository.updateContextProfile({ projectId: 'project-1', contextBudgetUnlimited: true })

  const manuscript = '周宁摸到外套里的蓝色钥匙。'
  const input = { projectId: 'project-1', chapterId: 'chapter-5', instruction: '修顺周宁这句话，蓝色钥匙，保留原有规则。' }
  const normal = repository.buildGenerationContext({ ...input, creativePackVersion: '1.3.0' })
  assert.ok(normal.text.length > 200000)
  const scope = { kind: 'selection', from: 0, to: manuscript.length }
  const scoped = repository.buildGenerationContext({ ...input, localRevision: { scope, text: manuscript } })
  const action = { instruction: input.instruction, modificationScope: scope,
    patchSource: { text: manuscript, digest: 'original-digest', protections: [{ start_offset: 2, end_offset: 4, text: '保护正文' }] } }
  const [, message] = inlineRevisionMessages({ action, context: scoped })
  assert.equal(scoped.diagnostics.retrieval, 'local-revision')
  assert.ok(message.content.length < 12000)
  assert.equal(message.content.split('蓝色钥匙只能在午夜使用').length, 2)
  assert.equal(message.content.split(manuscript).length, 2)
  assert.match(message.content, /说话简短/u)
  assert.match(message.content, /前一章结尾/u)
  assert.match(message.content, /sourceDigest：original-digest/u)
  assert.match(message.content, /保护范围：\[\{"from":2,"to":4\}\]/u)
  assert.doesNotMatch(message.content, /无关卷纲|旧修订历史|保护正文|"items"|"targetKey"/u)
  const delta = buildContextDelta({ currentContext: scoped, conversationScopeKey: 'same',
    previousSnapshot: { conversationScopeKey: 'same', contextSources: normal.sources } })
  assert.match(inlineRevisionMessages({ action, context: delta, isDelta: true })[1].content, /世界硬规则摘录/u)
  assert.equal(database.prepare("SELECT length(data_json) AS size FROM planning_entities WHERE id='volume'").get().size > 150000, true)
})

test('new chapter drafts deduplicate exact planning facts without losing scope or source tracking', (t) => {
  const { database, repository, now } = setup()
  t.after(() => database.close())
  database.exec("UPDATE chapters SET manuscript='' WHERE id='chapter-5'")
  const rule = '蓝色钥匙只能在午夜使用'
  const character = '周宁专门修理旧车站的机械钟'
  const stationRule = '旧车站的北门只在钟响后开启'
  const originalPlan = JSON.stringify({ hardRules: rule, costs: '开门后只能停留三分钟' })
  database.prepare("INSERT INTO planning_documents (project_id,kind,content_json,created_at,updated_at) VALUES ('project-1','world',?,?,?)").run(originalPlan, now(), now())
  database.prepare("INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES ('person','project-1','character','周宁',1,?,?,?)")
    .run(JSON.stringify({ role: character, voice: '短句为主' }), now(), now())
  database.prepare("INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES ('station','project-1','world','旧车站',2,?,?,?)")
    .run(JSON.stringify({ rules: stationRule, summary: '北门上有一面机械钟' }), now(), now())
  const insert = database.prepare(`INSERT INTO knowledge_items (id,project_id,kind,title,content_json,source_type,source_id,status,
    position,created_at,updated_at,knowledge_scope_json,effective_from_chapter) VALUES (?,'project-1','fact',?,?,?,?,'open',2,?,?,?,?)`)
  const add = (id, title, content, type = 'manual', sourceId = '', scope = { author: true }, from = null) => {
    insert.run(id, title, JSON.stringify(content), type, sourceId, now(), now(), JSON.stringify(scope), from)
  }
  add('world-copy', '蓝色钥匙规划投影', { statement: rule, category: 'world', scope: '全书已确认规划' }, 'planning', 'document:world:hardRules')
  add('character-copy', '人物：周宁', { statement: character, category: 'character', scope: '规划卡片' }, 'planning', 'entity:person')
  add('station-copy', '旧车站北门', { statement: stationRule, category: '规则' })
  add('scoped', '蓝色钥匙知情限制', { statement: rule }, 'manual', '', { author: true, characters: ['周宁'] })
  add('timed', '蓝色钥匙时效限制', { statement: rule }, 'manual', '', { author: true }, 5)
  add('hypothesis', '蓝色钥匙待核实内容', { statement: rule, certainty: '待核实' })
  add('qualified-projection', '蓝色钥匙引用但限制知情',
    { statement: rule, category: 'world', scope: '仅周宁知道', designVersion: '作者补充版本' }, 'manual', 'document:world:hardRules',
    { author: true, characters: ['周宁'] }, 5)
  add('different', '蓝色钥匙例外', { statement: '蓝色钥匙在日出前可以紧急使用' })
  const stored = database.prepare('SELECT id,content_json,knowledge_scope_json FROM knowledge_items ORDER BY id').all()
  repository.updateContextProfile({ projectId: 'project-1', contextBudgetUnlimited: true })
  const draft = { task: 'chapter', intent: 'draft', projectId: 'project-1', chapterId: 'chapter-5', instruction: '蓝色钥匙。钥匙规则。周宁。旧车站。' }
  const modern = repository.buildGenerationContext({ ...draft, creativePackVersion: '1.3.0' })
  const legacy = repository.buildGenerationContext({ ...draft, creativePackVersion: '1.2.0' })
  repository.updateContextProfile({ projectId: 'project-1', contextBudgetUnlimited: false, maxContextChars: 24000 })
  const bounded = repository.buildGenerationContext({ ...draft, creativePackVersion: '1.3.0' })
  for (const context of [modern, legacy, bounded]) {
    const prompt = compilePrompt({ ...draft, project: { id: 'project-1' }, chapter: { id: 'chapter-5' }, longContext: context })
      .messages.map(({ content }) => content).join('\n')
    assert.equal(prompt.split(rule).length - 1, 4, 'world rule plus scoped, timed and uncertain copies')
    assert.equal(prompt.split(character).length - 1, 1)
    assert.equal(prompt.split(stationRule).length - 1, 1)
    assert.match(prompt, /北门上有一面机械钟/u)
    assert.match(prompt, /短句为主/u)
    assert.match(prompt, /待核实/u)
    assert.match(prompt, /"characters":\["周宁"\]/u)
    assert.match(prompt, /world\.hardRules/u)
    assert.match(prompt, /作者补充版本/u)
    assert.match(prompt, /仅周宁知道/u)
    assert.match(prompt, /蓝色钥匙在日出前可以紧急使用/u)
    assert.ok(context.diagnostics.deduplicated.includes('knowledge_item:world-copy:content'))
    assert.ok(context.diagnostics.deduplicated.includes('knowledge_item:knowledge-key:content'))
    assert.equal(context.diagnostics.truncated, false)
  }
  const alias = modern.sources.find(({ targetKey }) => targetKey === 'knowledge_item:world-copy:content')
  assert.equal(alias.digest, dependencyDigest(database, alias.targetKey))
  assert.ok(!modern.items.some(item => item.targetKey === alias.targetKey))
  const rewrite = repository.buildGenerationContext({ ...draft, intent: 'rewrite', creativePackVersion: '1.3.0' })
  assert.equal(rewrite.diagnostics.deduplicated, undefined)
  assert.ok(rewrite.text.split(rule).length > modern.text.split(rule).length)
  assert.equal(database.prepare("SELECT content_json FROM planning_documents WHERE kind='world'").get().content_json, originalPlan)
  assert.deepEqual(database.prepare('SELECT id,content_json,knowledge_scope_json FROM knowledge_items ORDER BY id').all(), stored)
})

test('legacy drafts use the same focused retrieval before applying a finite budget', (t) => {
  const { database, repository } = setup()
  t.after(() => database.close())
  database.prepare("UPDATE planning_documents SET content_json=? WHERE kind='foundation'").run(JSON.stringify({ premise: '开门验证钥匙', designReviewHistory: '历史审校记录'.repeat(6000) }))
  database.prepare("INSERT INTO planning_documents (project_id,kind,content_json,created_at,updated_at) VALUES ('project-1','world',?,'a','a')")
    .run(JSON.stringify({ hardRules: '蓝色钥匙只能在午夜使用', history: '历史'.repeat(6000) }))
  repository.updateContextProfile({ projectId: 'project-1', maxContextChars: 12000 })
  const context = repository.buildGenerationContext({ task: 'chapter', intent: 'draft', projectId: 'project-1', chapterId: 'chapter-5', creativePackVersion: '1.2.0' })
  assert.equal(context.diagnostics.retrieval, 'chapter-first-draft')
  assert.equal(context.diagnostics.truncated, false)
  assert.ok(context.text.length < 12000)
  assert.match(context.text, /蓝色钥匙只能在午夜使用/u)
  assert.doesNotMatch(context.text, /历史审校记录/u)
})

test('first draft prioritizes explicit scene links, current facts and real continuity over unrelated archives', (t) => {
  const { database, repository, now } = setup()
  t.after(() => database.close())
  const card = { goal: '穿过北门', ending: '停在钟楼下', volumeId: 'active-volume', characterEntityRefs: ['linked-hero'] }
  const scenes = { schemaVersion: 1, scenes: [{ title: '北门试探', actionBeats: ['听见钟声才伸手'], worldEntityRefs: ['linked-rule'] }] }
  database.prepare("UPDATE chapters SET card_json=?,scene_plan_json=?,manuscript='' WHERE id='chapter-5'").run(JSON.stringify(card), JSON.stringify(scenes))
  database.prepare("UPDATE chapters SET manuscript='',card_json=? WHERE id='chapter-4'").run(JSON.stringify({ goal: '前章规划待写', ending: '取到蓝色钥匙' }))
  database.prepare("UPDATE chapters SET manuscript=? WHERE id='chapter-3'").run('不需要的早段。\n\n最后确认门后没有人。')
  const entities = database.prepare('INSERT INTO planning_entities (id,project_id,kind,title,position,data_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  let position = 0
  const entity = (id, kind, title, data) => entities.run(id, 'project-1', kind, title, ++position, JSON.stringify(data), now(), now())
  entity('linked-hero', 'character', '从未写在标题里的角色', { role: '锁匠有听力障碍', designReview: '淘汰稿记录'.repeat(40000) })
  entity('linked-rule', 'world', '隐藏规则卡', { triggerAndTarget: '钟声响起后北门可开', authority: '作者已确认' })
  entity('active-volume', 'volume', '当前卷', { goal: '调查钟楼', chapterOutline: '本卷所有远章安排'.repeat(50000) })
  entity('old-volume', 'volume', '过往卷北门', { goal: '别发送过往卷目标', summary: '历史卷纲'.repeat(60000) })
  const insert = database.prepare(`INSERT INTO knowledge_items (id,project_id,kind,title,content_json,source_type,source_id,status,
    position,created_at,updated_at,effective_from_chapter) VALUES (?,'project-1',?,?,?,'manual',?,'open',2,?,?,?)`)
  const knowledge = (id, kind, title, content, from = null) => insert.run(id, kind, title, JSON.stringify(content), `manual:${id}`, now(), now(), from)
  knowledge('current-fact', 'fact', '标题不匹配的必需约束', { chapterId: 'chapter-5', statement: '北门只有锁匠可以碰', historicalSources: '过期佐证记录'.repeat(10000) })
  knowledge('due-payoff', 'foreshadow', '不通过词面匹配的伏笔', { payoffChapterNo: 5, payoff: '归还工牌时发现号码被调换' })
  knowledge('distant', 'timeline', '远章北门事件', { chapterNo: 1, event: '远章不相关的取证材料'.repeat(10000) })
  knowledge('future', 'fact', '北门未来情报', { statement: '未来事实勿泄露' }, 6)
  repository.updateContextProfile({ projectId: 'project-1', contextBudgetUnlimited: true, knowledgeLimit: 0 })
  const context = repository.buildGenerationContext({ task: 'chapter', intent: 'draft', projectId: 'project-1', chapterId: 'chapter-5', creativePackVersion: '1.3.0' })
  assert.equal(context.diagnostics.budgetChars, null)
  assert.equal(context.diagnostics.truncated, false)
  assert.ok(context.text.length < 12000)
  for (const required of ['停在钟楼下', '听见钟声才伸手', '锁匠有听力障碍', '钟声响起后北门可开', '调查钟楼',
    '北门只有锁匠可以碰', '归还工牌时发现号码被调换', '尚无正文，不是已发生事实', '前章规划待写', '最后确认门后没有人。']) {
    assert.ok(context.text.includes(required), `missing ${required}`)
  }
  assert.doesNotMatch(context.text, /淘汰稿记录|本卷所有远章安排|别发送过往卷目标|过期佐证记录|远章不相关的取证材料|未来事实勿泄露/u)
  for (const item of context.sources) assert.equal(dependencyDigest(database, item.targetKey), item.digest)
  assert.ok(database.prepare("SELECT length(data_json) AS size FROM planning_entities WHERE id='active-volume'").get().size > 300000)
  assert.equal(database.prepare("SELECT manuscript FROM chapters WHERE id='chapter-5'").get().manuscript, '')
})
