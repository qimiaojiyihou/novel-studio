import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'
const require = createRequire(import.meta.url)
const { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'novel-reference-smoke-')))
const root = path.resolve(import.meta.dirname, '..')
const env = { ...process.env, NOVEL_STUDIO_TEST_USER_DATA: directory, NOVEL_STUDIO_NO_GO: '1' }
delete env.ELECTRON_RUN_AS_NODE
// Use the built renderer and a fixture model to test the entire desktop IPC path.
delete env.VITE_DEV_SERVER_URL
const calls = [], errors = []
const guide = '参考观察\n对白通过动作停顿表达犹豫。\n用词规范\n多用具体动词，检查词语搭配。对白按人物目的自然展开，删去重复解释。\n原创示例\n他进行了杯子的放置 → 他把杯子放下。\n审稿检查\n逐句检查书面腔、空泛副词和不顺畅的衔接。'
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content: guide }, finish_reason: 'stop' }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let app
try {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env, timeout: 60000 })
  app.process().stderr.on('data', data => { if (/Error|Unhandled|constraint/i.test(String(data))) process.stderr.write(data) })
  const page = await app.firstWindow()
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', dialog => { void dialog.accept() })
  await page.waitForFunction(() => Boolean(window.novelStudio))
  assertIsolatedRuntime(await page.evaluate(() => window.novelStudio.getRuntimeInfo()), directory)
  const files = [path.join(directory, '对白样本.txt'), path.join(directory, '描写样本.txt')]
  await fs.writeFile(files[0], '“还去吗？”他捏着票，等对面的人先开口。\n'.repeat(1200))
  await fs.writeFile(files[1], '风吹进窗缝。他把杯子往里推了一点，桌边留下一圈水。\n'.repeat(1200))
  // Replace only the native file picker, retaining the real file worker, repository and IPC.
  await app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths }); return true }, files)
  const a = await page.evaluate(() => window.novelStudio.createProject({ title: '参考小说测试甲', genre: '都市', idea: 'LOCAL_PLOT_SECRET' }))
  const b = await page.evaluate(() => window.novelStudio.createProject({ title: '参考小说测试乙', genre: '都市', idea: '独立测试' }))
  await page.evaluate(async ({ id, port }) => {
    await window.novelStudio.loadWorkspaceCatalog({ projectId: id })
    await window.novelStudio.saveModelProfile({ id: 'reference-fixture', name: '本机模拟分析', provider: 'local', model: 'reference-fixture', baseUrl: `http://127.0.0.1:${port}/v1`, settings: { requestConfig: { stream: false } } })
    await window.novelStudio.updateTaskRoute({ task: 'planning_field', modelProfileId: 'reference-fixture' })
  }, { id: a.project.id, port: server.address().port })
  await page.reload()
  await page.getByRole('button', { name: '提示词与文风', exact: true }).click()
  await page.getByRole('button', { name: /参考小说.*导入、分析/ }).click()
  const panel = page.getByRole('region', { name: '参考小说', exact: true })
  await panel.getByRole('button', { name: '＋ 导入小说', exact: true }).click()
  await panel.getByText('已导入 2 本', { exact: true }).waitFor()
  const first = panel.locator('.reference-book').first()
  await first.getByLabel('想参考什么', { exact: true }).fill('只参考自然对白和用词搭配')
  await first.getByRole('button', { name: '保存参考重点' }).click()
  await panel.getByLabel('偏好与需要改善的用词').fill('用词别扭，减少翻译腔')
  await panel.getByRole('button', { name: /分析并生成规范/ }).click()
  await panel.getByText('分析完成，规范草稿已保存。核对后可应用到本书', { exact: true }).waitFor()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'reference-fixture')
  assert.ok(!JSON.stringify(calls[0]).includes('LOCAL_PLOT_SECRET'))
  assert.ok(JSON.stringify(calls[0]).includes('只参考自然对白和用词搭配'))
  assert.equal(await panel.getByLabel('可直接编辑，确认后用于后续写作').inputValue(), guide)
  const unapplied = await page.evaluate(id => window.novelStudio.loadReferenceNovels({ projectId: id }), a.project.id)
  assert.equal(unapplied.applied, false)
  await panel.getByRole('button', { name: '确认应用到本书', exact: true }).click()
  await panel.getByText('规范已应用，后续写作会使用本书文风', { exact: true }).waitFor()
  const preview = await page.evaluate(({ projectId, chapterId }) => window.novelStudio.previewPrompt({ projectId, chapterId, task: 'chapter' }), { projectId: a.project.id, chapterId: a.chapters[0].id })
  assert.ok(JSON.stringify(preview.messages).includes('检查词语搭配'))
  assert.ok(!JSON.stringify(preview.messages).includes('“还去吗？”'))
  for (const width of [1440, 1080]) {
    await page.setViewportSize({ width, height: 960 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No document overflow at ${width}`)
  }
  await page.screenshot({ path: path.join(directory, 'reference-novels.png'), fullPage: true })
  await panel.getByRole('button', { name: '停用参考规范', exact: true }).click()
  await panel.getByText('参考规范已停用', { exact: true }).waitFor()
  const stopped = await page.evaluate(id => window.novelStudio.loadReferenceNovels({ projectId: id }), a.project.id)
  assert.equal(stopped.applied, false)
  assert.equal(stopped.guide.draft_text, guide)
  assert.equal((await page.evaluate(id => window.novelStudio.loadReferenceNovels({ projectId: id }), b.project.id)).books.length, 0)
  const agentRun = await page.evaluate(async ({ projectId, chapterId }) => {
    const packet = await window.novelStudio.referenceAnalysisPacket({ projectId })
    return window.novelStudio.startInlineAgent({ projectId, chapterId, task: 'planning_field', intent: 'analysis', executionMode: 'app_model', modelProfileId: 'reference-fixture', instruction: packet.instruction,
      target: { kind: 'reference_style_draft', targetId: projectId, fieldKey: 'referenceGuide', fieldLabel: '参考小说文风规范', draftDigest: 'fixture-draft' } })
  }, { projectId: a.project.id, chapterId: a.chapters[0].id })
  await page.waitForFunction(async id => {
    const run = await window.novelStudio.getAgentRun(id)
    if (run.status === 'failed') throw new Error(run.error)
    return run.status === 'waiting_confirmation'
  }, agentRun.id)
  const candidateRun = await page.evaluate(id => window.novelStudio.getAgentRun(id), agentRun.id)
  assert.equal(candidateRun.candidates[0].artifactType, 'renderer_draft')
  assert.equal(candidateRun.candidates[0].payload.text, guide)
  assert.ok(!JSON.stringify(calls[1]).includes('LOCAL_PLOT_SECRET'))
  await page.evaluate(({ id, chapterId }) => window.novelStudio.updateChapter({ id: chapterId, manuscript: '并行更新的本书正文。' }), { id: a.project.id, chapterId: a.chapters[0].id })
  await page.evaluate(({ runId, candidateId }) => window.novelStudio.confirmAgentCandidate({ runId, candidateId, currentDraftDigest: 'fixture-draft' }), { runId: agentRun.id, candidateId: candidateRun.candidates[0].id })
  await page.reload()
  await page.getByRole('button', { name: '提示词与文风', exact: true }).click()
  await page.getByRole('button', { name: /参考小说.*导入、分析/ }).click()
  await panel.getByLabel('可直接编辑，确认后用于后续写作').waitFor()
  assert.equal(await panel.getByLabel('可直接编辑，确认后用于后续写作').inputValue(), guide)
  assert.equal(await panel.locator('.reference-book').count(), 2)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ imported: 2, isolatedModelCalls: calls.length, guideAppliedAndDisabled: true, persistenceVerified: true, agentCandidateVerified: true, screenshot: path.join(directory, 'reference-novels.png') }))
} finally {
  if (app) await app.close()
  await new Promise(resolve => server.close(resolve))
}
