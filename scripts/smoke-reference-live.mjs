// Opt-in real model test. Reuses one explicitly selected project in an isolated library.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomInt } from 'node:crypto'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'
const { NOVEL_STUDIO_REFERENCE_FIXTURES: fixtures, NOVEL_STUDIO_REFERENCE_TEST_DIRECTORY: selectedDirectory,
  NOVEL_STUDIO_REFERENCE_PROJECT_ID: projectId } = process.env
if (!fixtures || !selectedDirectory || !projectId) throw new Error('Specify reviewed fixtures, an existing isolated library, and one existing test project ID')
const directory = await fs.realpath(selectedDirectory)
assert.ok(path.basename(directory).startsWith('novel-reference-real-'))
const model = process.env.NOVEL_STUDIO_REFERENCE_MODEL || 'gpt-6.2-astra'
const reasoningEffort = process.env.NOVEL_STUDIO_REFERENCE_EFFORT || 'medium'
const outputLabel = process.env.NOVEL_STUDIO_REFERENCE_OUTPUT || 'single-project-v2'
assert.match(outputLabel, /^[a-z0-9-]+$/)
const output = path.join(directory, outputLabel)
const baselineDirectory = process.env.NOVEL_STUDIO_REFERENCE_BASELINE
const previousGroups = baselineDirectory ? JSON.parse(await fs.readFile(path.join(baselineDirectory, 'results.json'), 'utf8')) : null
await fs.mkdir(output, { recursive: true })
const groups = await fs.readFile(path.join(output, 'results.json'), 'utf8').then(JSON.parse).catch(() => [])
for (const group of groups) for (const result of group.results) {
  assert.equal(result.evidence.modelSnapshot.model, model, 'resume directory belongs to another model')
  assert.equal(result.evidence.modelSnapshot.reasoningEffort, reasoningEffort, 'resume directory belongs to another reasoning setting')
}
const require = createRequire(import.meta.url)
const { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const env = { ...process.env, NOVEL_STUDIO_TEST_USER_DATA: directory, NOVEL_STUDIO_NO_GO: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
const app = await _electron.launch({ executablePath: require('electron'), args: ['.'], cwd: path.resolve(import.meta.dirname, '..'), env, timeout: 60000 })
console.log(JSON.stringify({ directory, output, projectId, model, reasoningEffort }))
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.novelStudio))
  assertIsolatedRuntime(await page.evaluate(() => window.novelStudio.getRuntimeInfo()), directory)
  const before = await page.evaluate(() => window.novelStudio.listProjects())
  assert.ok(before.some(p => p.id === projectId))
  const workspace = await page.evaluate(id => window.novelStudio.loadWorkspace(id), projectId)
  const chapterId = workspace.chapters[0].id
  assert.ok(!workspace.chapters[0].manuscript, 'Use an empty existing test chapter')
  const state = () => page.evaluate(projectId => window.novelStudio.loadReferenceNovels({ projectId }), projectId)
  const saveSettings = async changes => {
    const current = await state()
    return page.evaluate(payload => window.novelStudio.saveReferenceSettings(payload), {
      ...current.settings, ...changes, projectId, revision: current.guide?.settings_revision || 0,
    })
  }
  const waitRun = async id => {
    const deadline = Date.now() + 12 * 60 * 1000
    while (Date.now() < deadline) {
      const run = await page.evaluate(id => window.novelStudio.getAgentRun(id), id)
      if (run.status === 'waiting_confirmation') return run
      if (['failed', 'cancelled', 'waiting_approval'].includes(run.status)) throw new Error(JSON.stringify({ status: run.status, error: run.error, steps: run.steps.map(s => ({ status: s.status, error: s.error })) }))
      await new Promise(r => setTimeout(r, 2000))
    }
    await page.evaluate(id => window.novelStudio.cancelAgentRun(id), id)
    throw new Error('Timed out waiting for candidate')
  }
  const start = async request => page.evaluate(payload => window.novelStudio.startInlineAgent(payload), {
    projectId, chapterId, executionMode: 'codex', agentProvider: 'codex', freshStart: true,
    codexModel: model, codexReasoningEffort: reasoningEffort, ...request,
  })
  const baseline = async () => {
    let current = await state()
    if (current.guide?.applied_text) await page.evaluate(payload => window.novelStudio.applyReferenceGuide(payload), {
      projectId, disable: true, expectedStyle: current.projectStyle,
    })
    await saveSettings({ voiceBook: '', voicePurpose: 'base' })
    await page.evaluate(payload => window.novelStudio.saveStyleProfile(payload), {
      projectId, scopeType: 'project', scopeId: projectId, text: '第三人称跟随主角，遵守本次场景事实。', style: {},
    })
  }
  await page.evaluate(settings => window.novelStudio.saveCodexSettings(settings), { model, reasoningEffort, agentProvider: 'codex' })
  await page.evaluate(projectId => window.novelStudio.setSessionModelApproval({ projectId, enabled: true }), projectId)
  await page.evaluate(payload => window.novelStudio.updateChapter(payload), { id: chapterId, title: '值班', card: { goal: '完成本次任务中指定的事件' } })
  const cases = [
    { key: 'life', scene: '日常', brief: '社区旧书摊。林沅第一次值摊，定价两元一本。熟人阿庆来帮忙，发现旁边三箱需要搬上三楼，又想拿走那本厚词典。天黑前必须收好。写完两人商量分工并完成一件具体事情的过程。第三人称跟随林沅。约900—1200字。' },
    { key: 'star', scene: '陌生场景', brief: '山地气象站。新人林沅与值班员阿庆发现风速仪的数据异常。林沅怀疑仪器坏了，阿庆担心延误晚间报告。站长在山下，二人只能按现有条件查清原因。最后确认是结冰卡住支架，处理后恢复测量。第三人称跟随林沅。约900—1200字。' },
  ]
  for (const item of cases) {
    const { key, scene, brief } = item
    const reference = JSON.parse(await fs.readFile(path.join(fixtures, key + '.json'), 'utf8'))
    const training = reference.samples.slice(0, 2)
    const filename = path.join(output, key + '.txt')
    await fs.writeFile(filename, training.map(s => s.text).join('\n\n'))
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); return true }, filename)
    await page.evaluate(projectId => window.novelStudio.importReferenceNovels({ projectId }), projectId)
    const body = training[1].text.slice(training[1].text.indexOf('\n') + 1).trim()
    const boundary = body.lastIndexOf('\n', 580)
    const base = body.slice(0, boundary > 100 ? boundary : 580).trim()
    let current = await state()
    const selected = current.books.find(b => b.filename === key + '.txt')
    assert.ok(selected)
    await baseline()
    current = await state()
    for (const book of current.books) await page.evaluate(payload => window.novelStudio.updateReferenceNovel(payload), {
      ...book, projectId, enabled: book.id === selected.id,
      ...(book.id === selected.id ? { title: reference.title, excerpts: [{ label: '原著连续选段', text: base, use: '底色', primary: true }] } : {}),
    })
    const analysisFile = path.join(output, key + '-analysis.json')
    let analysis = baselineDirectory
      ? JSON.parse(await fs.readFile(path.join(baselineDirectory, key + '-analysis.json'), 'utf8'))
      : await fs.readFile(analysisFile, 'utf8').then(JSON.parse).catch(() => null)
    if (!analysis) {
      const packet = await page.evaluate(projectId => window.novelStudio.referenceAnalysisPacket({ projectId }), projectId)
      const started = await start({ task: 'planning_field', intent: 'analysis', instruction: packet.instruction,
        target: { kind: 'reference_style_draft', targetId: projectId, fieldKey: 'referenceGuide', fieldLabel: '参考小说文风规范', draftDigest: 'isolated-analysis-' + key } })
      console.log(JSON.stringify({ startingAnalysis: started.id, projectId, key }))
      const run = await waitRun(started.id)
      const candidate = run.candidates.find(c => c.payload?.text)
      assert.ok(candidate?.payload.text)
      assert.equal(candidate.evidence.modelSnapshot.model, model)
      analysis = { text: candidate.payload.text, evidence: candidate.evidence, snapshot: run.steps.find(s => s.promptSnapshot?.messages)?.promptSnapshot }
      await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2))
      console.log(JSON.stringify({ completedAnalysis: started.id, key }))
    }
    await fs.writeFile(path.join(output, key + '-reference.json'), JSON.stringify({ ...reference, training, base, rules: analysis.text }, null, 2))
    let group = groups.find(g => g.key === key)
    if (!group) {
      const order = ['普通', '规则', '规则和选段']
      for (let i = 2; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]] }
      group = { reference: reference.title, key, scene, brief, projectId, chapterId, order, results: [] }; groups.push(group)
    }
    for (const arm of group.order) {
      if (group.results.some(r => r.arm === arm)) continue
      await baseline()
      current = await state()
      if (arm !== '普通') {
        if (arm === '规则和选段') current = await saveSettings({ voiceBook: selected.content_digest })
        const saved = await page.evaluate(payload => window.novelStudio.saveReferenceGuide(payload), {
          projectId, text: analysis.text, sourceDigest: current.sourceDigest, revision: current.guide?.revision || 0,
        })
        await page.evaluate(payload => window.novelStudio.applyReferenceGuide(payload), {
          projectId, revision: saved.guide.revision, expectedStyle: saved.projectStyle,
        })
      }
      const started = await start({ task: 'chapter', intent: 'draft', targetLength: 1000,
        target: { kind: 'manuscript', targetId: chapterId }, instruction: brief })
      console.log(JSON.stringify({ starting: started.id, projectId, key, scene, arm }))
      const run = await waitRun(started.id)
      const candidate = run.candidates.find(c => c.payload?.manuscript)
      assert.ok(candidate?.payload.manuscript.length > 400)
      const snapshot = run.steps.find(s => s.promptSnapshot?.messages)?.promptSnapshot
      assert.ok(snapshot)
      await fs.writeFile(path.join(output, started.id + '.json'), JSON.stringify({ key, arm, text: candidate.payload.manuscript, evidence: candidate.evidence, snapshot }, null, 2))
      const promptText = snapshot.messages.map(m => m.content).join('\n')
      assert.ok(!promptText.includes('\\n【参考小说文风规范】'))
      assert.equal(promptText.includes(JSON.stringify(base).slice(1, -1)), arm === '规则和选段')
      assert.equal(candidate.evidence.modelSnapshot.model, model)
      assert.equal(candidate.evidence.modelSnapshot.reasoningEffort, reasoningEffort)
      assert.equal(candidate.evidence.modelSnapshot.verified, true)
      if (previousGroups) {
        const previous = previousGroups.find(g => g.key === key)?.results.find(r => r.arm === arm)
        assert.ok(previous, 'matching baseline exists')
        assert.deepEqual(snapshot.messages, previous.snapshot.messages, 'same formal writing prompt across model configurations')
      }
      const result = { arm, runId: started.id, text: candidate.payload.manuscript, evidence: candidate.evidence, snapshot }
      group.results.push(result)
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(groups, null, 2))
      await fs.writeFile(path.join(output, key + '-blind.json'), JSON.stringify({ reference: reference.title, brief, texts: group.results.map(r => r.text) }, null, 2))
      assert.deepEqual((await page.evaluate(() => window.novelStudio.listProjects())).map(p => p.id).sort(), before.map(p => p.id).sort())
      console.log(JSON.stringify({ completed: started.id, projectId, key, arm, chars: result.text.length, model: candidate.evidence.modelSnapshot.model }))
    }
  }
} finally { await app.close() }
