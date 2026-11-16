import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runMigrations } from '../electron/database-migrations.js'
import { createReferenceNovelRepository, REFERENCE_BOOK_LIMIT } from '../electron/reference-novels.js'
import { readReferenceNovel } from '../electron/reference-import.js'
import { createDocxManuscript } from '../electron/manuscript-formats.js'
import { compilePrompt } from '../electron/prompt-compiler.js'
import { createPromptRepository } from '../electron/prompt-repository.js'
import { createProjectBackup, restoreProjectBackup, validateProjectBackup } from '../electron/project-portability.js'
import { normalizeInlineCreativeAction } from '../electron/inline-creative.js'

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
  assert.equal(runMigrations(db), 40)
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
