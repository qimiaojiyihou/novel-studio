import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runMigrations, LATEST_SCHEMA_VERSION } from '../electron/database-migrations.js'
import { createReferenceNovelRepository, REFERENCE_BOOK_LIMIT } from '../electron/reference-novels.js'
import { readReferenceNovel } from '../electron/reference-import.js'
import { createDocxManuscript } from '../electron/manuscript-formats.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { createPromptRepository } from '../electron/prompt-repository.js'
import { createProjectBackup, restoreProjectBackup, validateProjectBackup } from '../electron/project-portability.js'
import { indexReferenceChapters } from '../electron/reference-chapters.js'
import { normalizeInlineCreativeAction } from '../electron/inline-creative.js'
import { buildCreativeContext } from '../electron/creative-context.js'
import { createCodexProjectMirror, readMirrorText } from '../electron/codex-project-mirror.js'

function fixture(t, version) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  runMigrations(db, { targetVersion: version })
  for (const id of ['a', 'b']) {
    db.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES(?,?,'都市','测试',?,?,?)").run(id, id, '原有文风：轻松具体。', 'now', 'now')
    db.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at) VALUES(?,?,?,?,'draft','{}','','',?)").run(`chapter-${id}`, id, 1, '初见', 'now')
  }
  return { db, repo: () => createReferenceNovelRepository(db) }
}

const input = (title, text = `${title}对白与动作。`.repeat(2500)) => ({ title, filename: `${title}.txt`, text })

test('migration preserves existing author data; import is bounded, atomic, deduplicated and project scoped', t => {
  const { db, repo } = fixture(t, 39)
  const before = db.prepare('SELECT * FROM projects').all()
  assert.equal(runMigrations(db), LATEST_SCHEMA_VERSION)
  assert.deepEqual(db.prepare('SELECT * FROM projects').all(), before)
  const r = repo()
  const imported = r.importBooks('a', [input('甲'), input('甲副本', input('甲').text)])
  assert.equal(imported.added, 1)
  assert.equal(imported.skipped.length, 1)
  assert.equal(imported.books[0].content, undefined)
  assert.equal(r.state('b').books.length, 0)
  assert.equal(r.updateBook({ projectId: 'a', ...imported.books[0], focus: '对白自然', enabled: true }).books[0].focus, '对白自然')
  assert.throws(() => r.updateBook({ projectId: 'b', ...imported.books[0], enabled: true }), /已更新/)
  assert.throws(() => r.updateBook({ projectId: 'a', ...imported.books[0], enabled: true }), /已更新/)
  assert.throws(() => r.importBooks('a', Array.from({ length: REFERENCE_BOOK_LIMIT }, (_, i) => input(`上限${i}`))), /最多/)
  assert.equal(r.state('a').books.length, 1)
  assert.throws(() => r.importBooks('a', [input('太大', '字'.repeat(10 * 1024 * 1024 + 1))]), /超过/)
})

test('analysis samples multiple positions and books with natural-language focus, while disabled books and full text stay out', t => {
  const { repo } = fixture(t)
  const r = repo()
  const state = r.importBooks('a', [input('对白'), input('描写'), input('停用')])
  const excluded = state.books.find(book => book.title === '停用')
  r.updateBook({ projectId: 'a', ...excluded, enabled: false })
  const packet = r.analysisPacket({ projectId: 'a', preference: '句子有点别扭' })
  assert.equal(packet.books.length, 2)
  assert.equal(packet.books[0].excerpts.length, 4)
  assert.ok(packet.instruction.includes('动词与名词'))
  assert.ok(packet.instruction.includes('句子有点别扭'))
  assert.ok(packet.instruction.includes('衔接'))
  assert.ok(!packet.instruction.includes('《停用》'))
  assert.ok(packet.instruction.length < 20000)
  assert.notEqual(packet.books[0].excerpts[0].position, packet.books[0].excerpts[3].position)
  assert.equal(r.state('a').guide, null)
})

test('confirmed guide flows through writing and review prompts, preserves existing styles, detects concurrent changes and can be disabled', t => {
  const { db, repo } = fixture(t)
  const r = repo()
  r.importBooks('a', [input('甲')])
  const packet = r.analysisPacket({ projectId: 'a' })
  let state = r.saveGuide({ projectId: 'a', text: '多用具体动词，对白按人物的目的和关系自然展开。', sourceDigest: packet.sourceDigest, revision: 0 })
  assert.equal(state.applied, false)
  assert.throws(() => r.saveGuide({ projectId: 'a', text: '冲突', sourceDigest: packet.sourceDigest, revision: 0 }), /已更新/)
  const prompts = createPromptRepository(db)
  prompts.saveStyleProfile({ projectId: 'a', scopeType: 'project', scopeId: 'a', text: state.projectStyle, style: { pointOfView: '第三人称限知' } })
  assert.throws(() => r.applyGuide({ projectId: 'a', revision: state.guide.revision, expectedStyle: '过期文风' }), /其他位置修改/)
  state = r.applyGuide({ projectId: 'a', revision: state.guide.revision, expectedStyle: state.projectStyle })
  assert.ok(state.projectStyle.startsWith('原有文风：轻松具体。'))
  assert.equal(state.applied, true)
  for (const task of ['chapter', 'rewrite', 'quality_review', 'chapter_card', 'planning_field']) {
    const promptContext = prompts.resolvePromptContext({ projectId: 'a', chapterId: 'chapter-a', task })
    const compiled = compilePrompt({ task, project: { id: 'a' }, chapter: { id: 'chapter-a', card: {} }, promptContext })
    assert.ok(compiled.messages.some(message => message.content.includes('多用具体动词')), task)
    assert.equal(promptContext.style.mergedStyle.pointOfView, '第三人称限知')
  }
  assert.ok(!prompts.resolvePromptContext({ projectId: 'b', task: 'chapter' }).style.mergedText.includes('多用具体动词'))
  const reapplied = r.applyGuide({ projectId: 'a', revision: state.guide.revision, expectedStyle: state.projectStyle })
  assert.equal(reapplied.projectStyle, state.projectStyle)
  const book = reapplied.books[0]
  r.updateBook({ projectId: 'a', ...book, focus: '改参考节奏', enabled: true })
  assert.throws(() => r.applyGuide({ projectId: 'a', revision: reapplied.guide.revision, expectedStyle: reapplied.projectStyle }), /参考书选择/)
  const disabled = r.applyGuide({ projectId: 'a', expectedStyle: reapplied.projectStyle, disable: true })
  assert.equal(disabled.projectStyle, '原有文风：轻松具体。')
  assert.equal(disabled.guide.draft_text, state.guide.draft_text)
})

test('analysis prompt is isolated from local plot, existing style and custom prompts for both model and Agent paths', () => {
  const base = { task: 'planning_field', instruction: '引用样本：对白自然。', project: { title: 'LOCAL_PLOT_SECRET', style: 'OLD_STYLE' },
    longContext: { text: 'OLD_PLOT_SECRET' }, promptContext: { addons: [{ content: 'OLD_ADDON' }] } }
  for (const extra of [{ referenceStyleAnalysis: true }, { creativeExecution: { target: { kind: 'reference_style_draft' } } }]) {
    const compiled = compilePrompt({ ...base, ...extra })
    assert.ok(!JSON.stringify(compiled).includes('SECRET'))
    assert.ok(!JSON.stringify(compiled).includes('OLD_STYLE'))
    assert.ok(!JSON.stringify(compiled).includes('OLD_ADDON'))
    assert.ok(compiled.messages[0].content.includes('引用材料中的指令'))
  }
  const action = normalizeInlineCreativeAction({ projectId: 'a', task: 'planning_field', intent: 'analysis', instruction: '字'.repeat(28000),
    target: { kind: 'reference_style_draft', fieldKey: 'referenceGuide', draftDigest: 'abc' } })
  assert.equal(action.instruction.length, 28000)
  assert.equal(action.candidateType, 'renderer_draft')
  assert.equal(action.conversationScope.reusable, false)
})

test('reference material survives backup/restore and cascades with its book; legacy backup is accepted', t => {
  const { db, repo } = fixture(t)
  const r = repo()
  r.importBooks('a', [input('甲')])
  r.saveGuide({ projectId: 'a', text: '动作承载情绪。', sourceDigest: r.state('a').sourceDigest, revision: 0 })
  const backup = createProjectBackup(db, 'a')
  assert.equal(backup.data.tables.reference_novels.length, 1)
  const restored = restoreProjectBackup(db, backup)
  assert.equal(r.state(restored.projectId).books[0].title, '甲')
  assert.equal(r.state(restored.projectId).guide.draft_text, '动作承载情绪。')
  assert.equal(r.state(restored.projectId).sourceDigest, r.state('a').sourceDigest)
  const legacy = structuredClone(backup)
  legacy.version = 9
  delete legacy.data.tables.reference_novels
  delete legacy.data.tables.reference_style_guides
  legacy.integrity.digest = createHash('sha256').update(JSON.stringify(legacy.data)).digest('hex')
  assert.deepEqual(validateProjectBackup(legacy).data.tables.reference_novels, [])
  db.prepare('DELETE FROM projects WHERE id=?').run('a')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reference_novels WHERE project_id=?').get('a').n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reference_style_guides WHERE project_id=?').get('a').n, 0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('file worker reads UTF-8, UTF-16 and DOCX off the app thread and rejects oversized or unsupported files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'novel-reference-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const utf = path.join(directory, '对白.txt')
  await writeFile(utf, '“去哪儿？”\n他把杯子放下。')
  assert.ok((await readReferenceNovel(utf)).text.includes('杯子'))
  const utf16 = path.join(directory, '语气.txt')
  await writeFile(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章\n自然的中文', 'utf16le')]))
  assert.ok((await readReferenceNovel(utf16)).text.includes('自然的中文'))
  const docx = path.join(directory, '参考.docx')
  await writeFile(docx, createDocxManuscript({ project: { title: '参考' }, chapters: [{ chapter_no: 1, title: '风声', manuscript: '窗边有风。' }] }))
  assert.ok((await readReferenceNovel(docx)).text.includes('窗边有风'))
  const bad = path.join(directory, 'bad.json')
  await writeFile(bad, '{}')
  await assert.rejects(readReferenceNovel(bad), /TXT/)
  const large = path.join(directory, 'large.txt')
  await writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1))
  await assert.rejects(readReferenceNovel(large), /10 MB/)
})

test('complete scenes preserve source text, priority and settings change provenance, and foreign samples are rejected', t => {
  const { repo } = fixture(t)
  const r = repo()
  const scene = '第一章 来客\n他看了看空着的椅子。“坐这儿吧。”\n对方把袋子放在桌上，手却没有松开。'
  let current = r.importBooks('a', [input('主书', scene + '\n第二章 天亮\n他去找人。'), input('辅书')])
  const book = current.books.find(book => book.title === '主书')
  assert.throws(() => r.updateBook({ projectId: 'a', ...book, sample_mode: 'scenes', excerpts: [{ label: '非法', text: '不属于任何参考小说的原文' }] }), /连续原文/)
  current = r.updateBook({ projectId: 'a', ...book, priority: 2, sample_mode: 'scenes', excerpts: [{ label: '来客的停顿', text: scene }], enabled: true })
  const before = current.sourceDigest
  const packet = r.analysisPacket({ projectId: 'a' })
  assert.equal(packet.books[0].title, '主书')
  assert.equal(packet.books[0].excerpts[0].text, scene)
  assert.equal(packet.books[0].excerpts.length, 1)
  current = r.saveSettings({ projectId: 'a', preference: '保留停顿', conflictPolicy: '主书对白优先，辅助书补充环境', revision: 0 })
  assert.notEqual(current.sourceDigest, before)
  assert.ok(r.taskPacket({ projectId: 'a' }).instruction.includes('主书对白优先'))
  assert.throws(() => r.saveSettings({ projectId: 'a', preference: '过期修改', revision: 0 }), /其他位置更新/)
  assert.equal(r.state('b').settings.preference, '')
})

test('trial calibration pins the saved guide, requires author feedback and rejects stale results and feedback revisions', t => {
  const { db, repo } = fixture(t)
  const r = repo()
  let current = r.importBooks('a', [input('甲')])
  current = r.saveGuide({ projectId: 'a', text: '具体动作，自然对白，关键选择写细。', sourceDigest: current.sourceDigest, revision: 0 })
  const packet = r.taskPacket({ projectId: 'a', mode: 'trial', kind: 'daily', brief: '两个人约饭，各有打算。' })
  assert.ok(packet.instruction.includes(current.guide.draft_text))
  assert.throws(() => r.taskPacket({ projectId: 'a', mode: 'refine' }), /反馈/)
  assert.throws(() => r.saveTrial({ projectId: 'a', kind: 'daily', brief: '约饭', text: '他伸手拉开椅子。', guideDigest: '旧规范', sourceDigest: current.sourceDigest, revision: 0 }), /规范已变化/)
  current = r.saveTrial({ projectId: 'a', kind: 'daily', brief: '约饭', text: '他把椅子拉开一点。“就这儿？”', guideDigest: packet.guideDigest, sourceDigest: packet.sourceDigest, revision: 0 })
  current = r.saveTrial({ projectId: 'a', kind: 'daily', feedbackOnly: true, feedback: '对白停顿保留，动作可以少一点。', revision: current.trials[0].revision })
  const refinement = r.taskPacket({ projectId: 'a', mode: 'refine' })
  assert.ok(refinement.instruction.includes('对白停顿保留'))
  const backup = createProjectBackup(db, 'a')
  const restored = restoreProjectBackup(db, backup)
  assert.equal(r.state(restored.projectId).trials[0].author_feedback, current.trials[0].author_feedback)
  assert.equal(r.state(restored.projectId).guideDigest, current.guideDigest)
  current = r.saveTrial({ projectId: 'a', kind: 'daily', feedbackOnly: true, feedback: '补充意见，省略重复动作。', revision: current.trials[0].revision })
  assert.throws(() => r.saveTrial({ projectId: 'a', kind: 'daily', feedbackOnly: true, feedback: '旧反馈', revision: 1 }), /记录已更新/)
  assert.throws(() => r.saveGuide({ projectId: 'a', mode: 'refine', inputDigest: refinement.inputDigest, text: '旧反馈生成的新规范', sourceDigest: current.sourceDigest, revision: current.guide.revision }), /反馈已变化/)
  const latest = r.taskPacket({ projectId: 'a', mode: 'refine' })
  current = r.saveGuide({ projectId: 'a', mode: 'refine', inputDigest: latest.inputDigest, text: '保留停顿，省略重复动作。', sourceDigest: current.sourceDigest, revision: current.guide.revision })
  assert.notEqual(current.trials[0].guide_digest, current.guideDigest)
  assert.throws(() => r.taskPacket({ projectId: 'a', mode: 'refine' }), /当前规范/)
  assert.throws(() => r.saveTrial({ projectId: 'a', kind: 'daily', feedbackOnly: true, feedback: '旧片段反馈', revision: current.trials[0].revision }), /规范已变化/)
})

test('chapter index keeps contiguous UTF-16 ranges and fallback content, and trial targets use the isolated writing prompt', () => {
  const text = '序言\n😀开篇\n第一章 起风\n手上的水干了。\n第二章 来客\n他开门。'
  const index = indexReferenceChapters(text)
  assert.equal(index.length, 3)
  assert.ok(text.slice(index[1].start, index[1].end).startsWith('第一章'))
  assert.ok(text.slice(index[2].start, index[2].end).endsWith('他开门。'))
  assert.deepEqual(indexReferenceChapters('# 开篇\n风声。\n# 来客\n敲门。').map(chapter => chapter.title), ['开篇', '来客'])
  assert.deepEqual(indexReferenceChapters('没有标题的原文'), [{ title: '全文（按段查看）', start: 0, end: '没有标题的原文'.length }])
  const compiled = compilePrompt({ task: 'planning_field', referenceStyleAnalysis: true, referenceMode: 'trial', instruction: '写一次约饭。', longContext: { text: 'PRIVATE_PLOT' } })
  assert.ok(compiled.messages[0].content.includes('试写'))
  assert.ok(!JSON.stringify(compiled).includes('PRIVATE_PLOT'))
  const target = normalizeInlineCreativeAction({ task: 'planning_field', target: { kind: 'reference_trial_draft', fieldKey: 'daily', draftDigest: 'a' }, instruction: '字'.repeat(80000) })
  assert.equal(target.candidateType, 'renderer_draft')
  assert.equal(target.instruction.length, 80000)
})

test('v40 reference books and an already confirmed guide keep their provenance after the scene-selection upgrade', t => {
  const { db, repo } = fixture(t, 40)
  const content = '旧参考原文。'
  const contentDigest = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  const sourceDigest = createHash('sha256').update(JSON.stringify([['旧参考', contentDigest, '对白']])).digest('hex')
  db.prepare(`INSERT INTO reference_novels (id,project_id,title,filename,content,content_digest,char_count,focus,created_at,updated_at)
    VALUES ('old-reference','a','旧参考','old.txt',?,?,?,'对白','now','now')`).run(content, contentDigest, content.length)
  db.prepare(`INSERT INTO reference_style_guides (id,project_id,draft_text,source_digest,created_at,updated_at)
    VALUES ('old-guide','a','保留自然的对白。',?,'now','now')`).run(sourceDigest)
  runMigrations(db)
  const current = repo().state('a')
  assert.equal(current.sourceDigest, sourceDigest)
  assert.equal(current.guide.draft_text, '保留自然的对白。')
  assert.equal(current.books[0].sample_mode, 'auto')
  assert.deepEqual(current.books[0].excerpts, [])
  assert.ok(repo().taskPacket({ projectId: 'a', mode: 'trial', kind: 'daily', brief: '约饭。' }).instruction.includes('保留自然的对白'))
})

test('writing and rewriting select applicable approved rules and record the actual prompt', () => {
  const style = '作者自己的口气。\n【参考小说文风规范】\n参考观察只用于分析。\n【通用】使用具体动词。\n【详略】关键动作放慢。\n【对白】说行内人的话。\n【改稿】保留范围外的句子。\n【参考小说文风规范结束】'
  for (const [task, instruction, expected] of [['chapter','写师徒对白','【对白】说行内人的话。'], ['rewrite','换个自然的措辞','【改稿】保留范围外的句子。']]) {
    const { messages, snapshot } = compilePrompt({ task, instruction, project: { style }, chapter: { title: '开工' } })
    assert.deepEqual(snapshot.referenceRules, ['【通用】使用具体动词。', expected])
    assert.ok(messages[1].content.includes('作者自己的口气'))
    assert.ok(!messages[1].content.includes('参考观察只用于分析') && !messages[1].content.includes('关键动作放慢'))
  }
})

test('both voice foundation rules survive selection alongside scene-specific rules', () => {
  const style = '【参考小说文风规范】\n【通用】旁白可直接评说人物的小算盘。\n【通用】口语长句承接解释，短句落评价。\n【对白】对白规则。\n【详略】详略规则。\n【冲突】冲突规则。\n【参考小说文风规范结束】'
  const { snapshot } = compilePrompt({ task: 'chapter', instruction: '对白冲突，动作详略', project: { style } })
  assert.deepEqual(snapshot.referenceRules.slice(0, 2), ['【通用】旁白可直接评说人物的小算盘。', '【通用】口语长句承接解释，短句落评价。'])
  assert.equal(snapshot.referenceRules.length, 4)
})

test('foundation and agent mirror do not reintroduce excluded reference rules', async t => {
  const { db } = fixture(t)
  const style = '作者原有语气。\n【参考小说文风规范】\n【通用】平实措辞。\n【对白】说行内人的话。\n【冲突】争执时省去铺陈。\n【参考小说文风规范结束】'
  db.prepare('UPDATE projects SET style=? WHERE id=?').run(style, 'a')
  const foundation = { premise: '原有设定', tone: style }
  db.prepare("INSERT INTO planning_documents(project_id,kind,content_json,created_at,updated_at) VALUES('a','foundation',?,'now','now')").run(JSON.stringify(foundation))
  const input = { projectId: 'a', chapterId: 'chapter-a', task: 'chapter', instruction: '写师徒对白' }
  const context = buildCreativeContext(db, input)
  assert.ok(!context.text.includes('争执时省去铺陈'))
  assert.equal(context.text.split('【参考小说文风规范】').length - 1, 1)
  const baseDirectory = await mkdtemp(path.join(tmpdir(), 'novel-reference-mirror-'))
  t.after(() => rm(baseDirectory, { recursive: true, force: true }))
  const mirror = createCodexProjectMirror({ baseDirectory,
    agentRun: { id: 'run-test', chapterId: 'chapter-a', steps: [{ task: input.task, input, status: 'running' }] },
    workspace: { project: { id: 'a', title: '测试', style }, chapters: [{ id: 'chapter-a', title: '初见' }] },
    planningCenter: { documents: { foundation: { content: foundation } } } })
  const text = readMirrorText(mirror.root, 'project/foundation.md')
  assert.ok(text.includes('说行内人的话') && text.includes('原有设定'))
  assert.ok(!text.includes('争执时省去铺陈'))
  assert.equal(text.split('【参考小说文风规范】').length - 1, 1)
})

test('blind pair shares the baseline, hides assignment until a project-scoped one-time vote and informs refinement', async t => {
  const { generateComparison } = await import('../electron/reference-comparison.js')
  const { repo, db } = fixture(t)
  const r = repo(), book = r.importBooks('a', [input('参考')])
  const text = '【对白】把书面措辞换成师徒口语。'
  const guide = r.saveGuide({projectId:'a',text,sourceDigest:book.sourceDigest})
  r.applyGuide({projectId:'a',revision:guide.guide.revision,expectedStyle:guide.projectStyle})
  const args = {projectId:'a',task:'rewrite',brief:'只修对白',sourceText:'他点头。',rule:text}
  const locked = r.comparisonInput(args)
  assert.throws(() => r.comparisonInput({...args,rule:'额外规则'}),/当前已保存/)
  const prompts = []
  const pair = await generateComparison(locked, async messages => {
    prompts.push(messages)
    return messages[1].content.includes(text) ? '处理组正文。' : '对照组正文。'
  })
  assert.deepEqual(prompts[pair.guidedSlot][0],prompts[1-pair.guidedSlot][0])
  assert.equal(prompts[pair.guidedSlot][1].content, prompts[1-pair.guidedSlot][1].content + '\n本次参考规则：\n' + text)
  assert.ok(prompts[0][1].content.includes('原有文风') && prompts[1][1].content.includes('原有文风'))
  const saved = r.storeComparison(locked,{model:'fixture'},pair)
  assert.equal(saved.guidedSlot,null)
  assert.equal(saved.guided_slot,undefined)
  assert.throws(()=>r.comparison('b',saved.id))
  assert.throws(()=>r.judgeComparison({projectId:'b',id:saved.id,verdict:'A'}))
  assert.equal(r.state('a').comparisons.length,1)
  await assert.rejects(generateComparison(locked,async()=>''),/为空/)
  const voted = r.judgeComparison({projectId:'a',id:saved.id,verdict:'tie',feedback:'两稿都保留原意'})
  assert.equal(voted.guidedSlot,pair.guidedSlot)
  assert.throws(()=>r.judgeComparison({projectId:'a',id:saved.id,verdict:'B'}))
  assert.ok(r.taskPacket({projectId:'a',mode:'refine'}).instruction.includes('两稿都保留原意'))
  assert.equal(createProjectBackup(db, 'a').data.tables.reference_comparisons.length,1)
})

test('reference voice crosses settings, stays scoped to writing, and clears when the primary book is disabled', async t => {
  const { db, repo } = fixture(t)
  const r = repo()
  const parts = ['她掀开锅盖，又给他盛了半碗。', '她把账簿转了半圈，让他自己看见。', '“行，还给你颁个奖？”']
  const old = r.importBooks('a', [input('饭桌', parts.join('\n') + '远'.repeat(620))]).books[0]
  const book = { ...old, projectId: 'a', excerpts: parts.map((text, i) => ({ label: '样本' + i, text, use: ['底色','留有余地','轻松打趣'][i] })) }
  assert.throws(() => r.updateBook({ ...book, excerpts: [{ use: '底色', text: '远'.repeat(601) }] }), /600/)
  r.updateBook(book)
  const pr = createPromptRepository(db)
  const resolve = (task, projectId = 'a', chapterId = 'chapter-a') => pr.resolvePromptContext({ projectId, chapterId, task })
  assert.equal(resolve('chapter').voiceLibrary, null)
  r.saveSettings({ projectId: 'a', voiceBook: old.content_digest })
  db.prepare("UPDATE chapters SET manuscript=? WHERE id='chapter-a'").run('前'.repeat(350) + '自己的尾句')
  db.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at) VALUES('next','a',2,'航天站','draft','{}','','','now')").run()
  for (const [task, instruction, expected] of [
    ['chapter','航天站更换氧气泵。',['底色']],
    ['chapter','他在直播中替前一位报时员解围。',['底色','留有余地']],
    ['rewrite','交接遗物，不要开玩笑。',['底色']],
    ['rewrite','师姐妹碰面打趣。',['底色','轻松打趣']],
  ]) {
    const promptContext = resolve(task, 'a', 'next')
    assert.equal(promptContext.voiceLibrary.previousEnding.length, 320)
    const output = compilePrompt({ task, chapter: { chapter_no: 2 }, instruction, promptContext })
    assert.deepEqual(output.snapshot.voiceSamples.map(s => s.use), expected)
    const sent = output.messages[1].content
    assert.ok(sent.includes('自己的尾句') && sent.includes(parts[0]))
    assert.equal(sent.includes(parts[1]), expected.includes('留有余地'))
    assert.equal(sent.includes(parts[2]), expected.includes('轻松打趣'))
  }
  const frozen = resolve('chapter', 'a', 'next')
  const systemOnly = compilePrompt({ task: 'chapter', instruction: '写作约束里偶然提及解围', sceneInstruction: '', promptContext: frozen })
  assert.deepEqual(systemOnly.snapshot.voiceSamples.map(s => s.use), ['底色'])
  const discussing = compilePrompt({ task: 'chapter', intent: 'analysis', promptContext: frozen })
  assert.deepEqual(discussing.snapshot.voiceSamples, [])
  assert.equal(resolve('chapter', 'b', 'chapter-b').voiceLibrary, null)
  assert.equal(resolve('planning_field').voiceLibrary, null)
  const restored = restoreProjectBackup(db, createProjectBackup(db, 'a'))
  assert.ok(resolve('chapter', restored.projectId, '').voiceLibrary)
  const saved = r.updateBook({ ...r.state('a').books[0], projectId: 'a', enabled: false })
  assert.ok(!saved.settings.voiceBook)
  r.updateBook({ ...saved.books[0], projectId: 'a', enabled: true })
  assert.equal(resolve('chapter').voiceLibrary, null)
})

test('three-way blind comparison sends excerpts to only one arm; assignment survives reload and is revealed after voting', async t => {
  const { generateComparison } = await import('../electron/reference-comparison.js')
  const { repo } = fixture(t), r = repo()
  const text = '钟师傅低下头又拢了半把火。'
  const rule = '【通用】用人物熟悉的动作收尾。'
  const original = r.importBooks('a', [input('短文', text)]).books[0]
  r.updateBook({ ...original, projectId: 'a', excerpts: [{ text, use: '底色' }] })
  const current = r.saveSettings({ projectId: 'a', voiceBook: original.content_digest })
  r.saveGuide({ projectId: 'a', text: rule, sourceDigest: current.sourceDigest, revision: current.guide.revision })
  const args = r.comparisonInput({ projectId: 'a', task: 'draft', brief: '在剧院清点失物。', rule, includeSamples: true })
  const sent = []
  const generated = await generateComparison(args, async messages => {
    sent.push(messages[1].content)
    return '候选' + sent.length
  })
  assert.equal(sent.filter(s => s.includes(rule)).length, 2)
  assert.equal(sent.filter(s => s.includes(text)).length, 1)
  const saved = r.storeComparison(args, { model: 'fixture' }, generated)
  const reloaded = repo().comparison('a', saved.id)
  assert.equal(reloaded.output_c, '候选3')
  assert.equal(reloaded.order, undefined)
  assert.equal(reloaded.guidedSlot, null)
  assert.equal(reloaded.sample_trial_json, undefined)
  const voted = r.judgeComparison({ projectId: 'a', id: saved.id, verdict: 'C' })
  assert.deepEqual(voted.order, generated.order)
  assert.equal(voted.verdict, 'C')
})

test('voice matching honors prohibitions and current requirements over repeated stale planning; fixed base and explicit purpose persist', async t => {
  const { selectVoiceSamples } = await import('../electron/reference-voice.js')
  const samples = [{ main: true, use: '底色', text: '普通底色' }, { main: true, use: '底色', primary: true, text: '固定底色' }, { use: '轻松打趣', text: '打趣样本' }, { use: '留有余地', text: '解围样本' }]
  const pick = input => selectVoiceSamples({ samples }, { task: 'chapter', ...input })
  assert.deepEqual(pick({ instruction: '这里不要出现任何玩笑，保持严肃。' }).map(s => s.text), ['固定底色'])
  assert.deepEqual(pick({ instruction: '正文只写调侃', chapter: { card: { goal: '解围' }, scenePlan: '解围', title: '解围' } }).map(s => s.use), ['底色', '轻松打趣'])
  assert.deepEqual(pick({ instruction: '按原稿润色', sourceText: '葬礼上他的玩笑令众人怒不可遏。' }).map(s => s.use), ['底色'])
  for (const chapter_no of [1, 2, 3]) assert.equal(pick({ chapter: { chapter_no } })[0].text, '固定底色')
  assert.equal(pick({ voicePurpose: '留有余地', instruction: '他把难听的话咽回去。' })[1].text, '解围样本')
  assert.equal(pick({ voicePurpose: '轻松打趣', instruction: '不要出现任何玩笑。' }).length, 1)
  assert.equal(pick({ voicePurpose: 'base', instruction: '打趣' }).length, 1)
  const { repo, db } = fixture(t), r = repo()
  const original = r.importBooks('a', [input('参考', '原文。'.repeat(400))]).books[0]
  const excerpts = Array.from({ length: 24 }, (_, i) => ({ label: String(i), text: '原文。', use: i ? '对白试探' : '底色', primary: !i }))
  r.updateBook({ ...original, projectId: 'a', excerpts: [...excerpts, ...Array.from({ length: 3 }, () => ({ text: '原文。' }))] })
  const current = r.saveSettings({ projectId: 'a', voiceBook: original.content_digest, voicePurpose: '对白试探' })
  assert.equal(current.settings.voicePurpose, '对白试探')
  const restored = restoreProjectBackup(db, createProjectBackup(db, 'a'))
  assert.equal(r.state(restored.projectId).settings.voicePurpose, '对白试探')
  assert.throws(() => r.updateBook({ ...current.books[0], projectId: 'a', excerpts: [...excerpts, { text: '原文。', use: '底色' }] }), /24/)
})

test('interrupted comparisons retain completed arms, resume after repository reload and pass original texts into calibration', async t => {
  const { generateComparison } = await import('../electron/reference-comparison.js')
  const { repo } = fixture(t), r = repo()
  const book = r.importBooks('a', [input('参考', '测试原文。')]).books[0]
  r.updateBook({ ...book, projectId: 'a', excerpts: [{ text: '测试原文。', use: '底色' }] })
  const current = r.saveSettings({ projectId: 'a', voiceBook: book.content_digest })
  const rule = '【通用】平实口语。'
  r.saveGuide({ projectId: 'a', text: rule, sourceDigest: current.sourceDigest, revision: current.guide.revision })
  const locked = r.comparisonInput({ projectId: 'a', task: 'draft', brief: '新的场景', rule, includeSamples: true })
  let id, count = 0
  const save = async progress => { id = r.storeComparison(locked, { model: 'test' }, progress, id).id }
  await assert.rejects(generateComparison(locked, async () => { if (++count === 3) throw new Error('fixture failure'); return '已保存正文' + count }, { save }), /fixture failure/)
  const partial = repo().comparison('a', id)
  assert.equal(partial.completed, 2)
  assert.equal(partial.expected, 3)
  assert.equal(partial.order, undefined)
  assert.throws(() => r.judgeComparison({ projectId: 'a', id, verdict: 'A' }), /补齐/)
  const resume = repo().resumeComparison('a', id)
  let resumedCalls = 0
  await generateComparison(resume.input, async () => { resumedCalls++; return '续接的第三稿' }, { ...resume, save })
  assert.equal(resumedCalls, 1)
  assert.equal(repo().comparison('a', id).output_a, partial.output_a)
  assert.equal(repo().comparison('a', id).output_b, partial.output_b)
  assert.equal(repo().comparison('a', id).complete, true)
  r.judgeComparison({ projectId: 'a', id, verdict: 'C', feedback: '末句更自然' })
  const packet = r.taskPacket({ projectId: 'a', mode: 'refine' })
  for (const value of ['已保存正文1', '已保存正文2', '续接的第三稿', '测试原文。']) assert.ok(packet.instruction.includes(value))
  assert.throws(() => r.resumeComparison('a', id), /已完成/)
})

test('calibration retains newest complete comparisons within its context budget', t => {
  const { repo } = fixture(t), r = repo()
  const current = r.importBooks('a', [input('参考', '测试原文。')])
  const rule = '【通用】平实口语。'
  r.saveGuide({ projectId: 'a', text: rule, sourceDigest: current.sourceDigest, revision: 0 })
  const locked = r.comparisonInput({ projectId: 'a', task: 'draft', brief: '新的场景', rule })
  for (let i = 0; i < 8; i++) {
    const outputs = ['普通', '规则', '规则和选段'].map((_, j) => `第${i}组第${j}稿开始` + '文'.repeat(11900) + `第${i}组第${j}稿结束`)
    const saved = r.storeComparison(locked, { model: 'test' }, { outputs, order: ['普通', '规则', '规则和选段'], guidedSlot: 1 })
    r.judgeComparison({ projectId: 'a', id: saved.id, verdict: 'C', feedback: '语言更自然' })
  }
  const packet = r.taskPacket({ projectId: 'a', mode: 'refine' })
  assert.ok(packet.instruction.length < 140000)
  for (const j of [0, 1, 2]) assert.ok(packet.instruction.includes(`第7组第${j}稿结束`))
  assert.ok(!packet.instruction.includes('第0组第0稿开始'))
  assert.ok(packet.instruction.includes('未参与本次校准'))
})

test('a different setting can use a functional excerpt and apply its pacing to the writing prompt', () => {
  const samples = [{ main: true, use: '底色', text: '底色原文' },
    { use: '熟人商量', text: '饭桌旁商议报酬的原文' }, { use: '日常过渡', text: '旅途原文' }]
  const input = { task: 'chapter', sceneInstruction: '在旧书摊商量分工', instruction: '生成正文',
    promptContext: { voiceLibrary: { samples } } }
  const result = compilePrompt(input)
  assert.deepEqual(result.snapshot.voiceSamples.map(s => s.use), ['底色', '熟人商量'])
  const sent = result.messages[1].content
  assert.ok(sent.includes(samples[1].text) && !sent.includes(samples[2].text))
  assert.ok(result.snapshot.detailDirection.includes('谈妥后的执行'))
  const veto = compilePrompt({ ...input, sceneInstruction: '不要商量分工', chapter: { title: '商量分工' } })
  assert.equal(veto.snapshot.voiceSamples.length, 1)
  assert.ok(!veto.snapshot.detailDirection.includes('谈妥后的执行'))
  const withGuide = compilePrompt({ task: 'rewrite', instruction: '写清她怎样查清原因',
    project: { style: '【参考小说文风规范】\n【通用】允许一句心里话。\n【参考小说文风规范结束】' } })
  assert.ok(withGuide.messages[1].content.includes('其余例行检查可以概述'))
  assert.equal(withGuide.snapshot.voiceSamples.length, 0)
  const disabled = compilePrompt({ task: 'chapter', instruction: '在旧书摊商量分工' })
  assert.ok(!disabled.messages[1].content.includes('【本场详略】'))
})

test('file import selects continuous passages and immediately uses them in writing without a guide', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reference-selection-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const prose = [
    '第一章 门前', '傍晚的风从巷子里吹过去。她还坐在门口，手里捧着昨天的旧本子，听着墙那头收拾碗筷的声音。',
    '第二章 迟来的车', '他原以为最后一趟车早就开走了，没想到车灯还亮着。走近一看，原来那块写着停运的牌子是挂在对面车上的。',
    '第三章 面摊', '要不咱俩今天换一换？我负责灶头，你负责招呼客人。她递过来那条洗得发白的围裙。就这么定了。',
  ].join('\n')
  const file = path.join(dir, '参考.txt')
  await writeFile(file, prose)
  const imported = await readReferenceNovel(file)
  assert.equal(new Set(imported.excerpts.map(s => s.use)).size, imported.excerpts.length)
  for (const s of imported.excerpts) assert.ok(prose.includes(s.text) && s.text.length <= 600 && !/第.章/.test(s.text))
  const { db, repo } = fixture(t)
  const r = repo()
  const state = r.importBooks('a', [imported])
  assert.equal(state.settings.voiceBook, state.books[0].content_digest)
  assert.equal(state.guide.draft_text, '')
  const prompts = createPromptRepository(db)
  for (const task of ['chapter', 'rewrite']) {
    const promptContext = prompts.resolvePromptContext({ projectId: 'a', chapterId: 'chapter-a', task })
    const result = compilePrompt({ task, instruction: '让人物重新判断眼前的局势。', promptContext })
    assert.deepEqual(result.snapshot.voiceSamples.map(s => s.use), ['底色', '判断修正'])
    assert.ok(result.messages.some(m => m.content.includes(imported.excerpts.find(s => s.use === '判断修正').text)))
  }
  r.saveSettings({ projectId: 'a', revision: state.guide.settings_revision, voiceBook: '' })
  const book = state.books[0]
  r.updateBook({ projectId: 'a', ...book, excerpts: [] })
  assert.equal(r.importBooks('a', [imported]).books[0].excerpts.length, 0)
  const later = r.importBooks('a', [{ ...imported, text: prose + '。' }])
  assert.ok(!later.settings.voiceBook)
})
