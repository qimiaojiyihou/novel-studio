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
let failAtCall = 0
const guide = '参考观察\n对白通过动作停顿表达犹豫。\n用词规范\n多用具体动词，检查词语搭配。对白按人物目的自然展开，删去重复解释。\n原创示例\n他进行了杯子的放置 → 他把杯子放下。\n审稿检查\n逐句检查书面腔、空泛副词和不顺畅的衔接。'
const dailyText = '他把两只杯子摆好，先把靠窗的椅子往旁边拉了一点。\n“你坐这儿，省得又嫌风大。”'
const conflictText = '“名额只剩一个。”对方按住名单。\n他松开伸到半路的手，换了个问法：“条件是什么？”'
const refinedGuide = guide + '\n根据反馈调整\n保留对白中的停顿，重复动作概述带过，冲突在人物选择处写细。'
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  calls.push(input)
  if (failAtCall && calls.length >= failAtCall) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'fixture interruption' } }))
    return
  }
  const content = JSON.stringify(input.messages).includes('本次场景类型') ? (JSON.stringify(input.messages).includes('日常互动') ? dailyText : conflictText) : JSON.stringify(input.messages).includes('根据作者对试写的具体反馈') ? refinedGuide : guide
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
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
  const base = '吃到一半，老周站起来穿外套。小满伸手给他提了提拉链，把衬衣上那张价签盖住。“门口漏风。”她说。老周嗯了一声，把剩下的半个包子夹给她。'
  const spare = '师父把账念岔了一行。学徒把账簿转过来：“师父，借您的指头给我压着这页。”师父往下一瞥，接着念。谁也没提刚才那个数。'
  await fs.writeFile(files[0], base + '\n' + spare + '\n' + '“还去吗？”他捏着票，等对面的人先开口。\n'.repeat(1200))
  await fs.writeFile(files[1], base + '\n' + spare + '\n' + '风吹进窗缝。他把杯子往里推了一点，桌边留下一圈水。\n'.repeat(1200))
  // Replace only the native file picker, retaining the real file worker, repository and IPC.
  for (let attempt = 0; ; attempt++) {
    try {
      await app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }); return true }, files)
      break
    } catch (error) {
      if (attempt >= 2 || !error.message.includes('promise was garbage collected')) throw error
    }
  }
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
  await first.getByLabel('参考优先级').selectOption('2')
  await first.getByLabel('选样方式').selectOption('scenes')
  await first.getByRole('button', { name: '从章节选择场景' }).click()
  const picker = page.getByRole('region', { name: '完整场景选样', exact: true })
  await picker.getByLabel('章节原文').waitFor()
  await picker.getByLabel('章节原文').evaluate((element, length) => element.setSelectionRange(0, length), base.length)
  await picker.getByRole('button', { name: '使用选中段落', exact: true }).click()
  await picker.getByLabel('写作用途').selectOption('底色')
  await picker.getByLabel('场景名称').fill('开篇互动完整场景')
  await picker.getByRole('button', { name: '加入选样', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await first.getByRole('button', { name: '从章节选择场景' }).click()
  await picker.getByLabel('章节原文').evaluate((element, passage) => {
    const start = element.value.indexOf(passage)
    if (start < 0) throw new Error('missing fixture excerpt')
    element.setSelectionRange(start, start + passage.length)
  }, spare)
  await picker.getByRole('button', { name: '使用选中段落', exact: true }).click()
  await picker.getByLabel('写作用途').selectOption('留有余地')
  await picker.getByLabel('场景名称').fill('给对方留面子')
  await picker.getByRole('button', { name: '加入选样', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await first.getByRole('button', { name: '保存参考重点' }).click()
  await panel.getByLabel('贴近参考文风 · 底色来源').selectOption({ label: await first.getByLabel('书名', {exact:true}).inputValue() })
  await panel.getByLabel('偏好与需要改善的用词').fill('用词别扭，减少翻译腔')
  await panel.getByLabel('参考冲突时如何取舍').fill('以主参考的对白为主，辅助书补充描写')
  await panel.getByRole('button', { name: '保存分析偏好', exact: true }).click()
  await panel.getByText('分析偏好已保存', { exact: true }).waitFor()
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
  assert.ok(preview.messages.some(message => message.content.includes(base)))
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
  const blind = panel.getByRole('region', { name: '同场景盲评', exact: true })
  await blind.getByLabel('盲评模型').selectOption('app')
  await blind.getByLabel('本次测试的规则').selectOption('多用具体动词，检查词语搭配。对白按人物目的自然展开，删去重复解释。')
  await blind.getByLabel('场景与要求').fill('师徒收工后归还道具。')
  const firstCall = calls.length
  await blind.getByRole('button', { name: '生成两稿' }).click()
  await blind.getByRole('button', { name: '差不多' }).waitFor()
  const pair = calls.slice(firstCall)
  assert.equal(pair.length,2)
  assert.equal(pair[0].model,pair[1].model)
  assert.equal(pair.filter(call => call.messages[1].content.includes('本次参考规则')).length,1)
  await blind.getByLabel('具体反馈（可选）').fill('两稿在细节上没有明显差异')
  await blind.getByRole('button', { name: '差不多' }).click()
  await blind.getByText(/稿使用了参考规则/).waitFor()
  await blind.getByLabel('对照方式').selectOption('samples')
  const comparisonStart = calls.length
  failAtCall = calls.length + 3
  await blind.getByRole('button', { name: '生成三稿' }).click()
  await blind.getByRole('button', { name: '补齐剩余稿件' }).waitFor()
  await blind.getByText(/已保存 2 \/ 3 稿/).waitFor()
  const partialCalls = calls.length
  failAtCall = 0
  await blind.getByRole('button', { name: '补齐剩余稿件' }).click()
  await blind.getByRole('button', { name: 'C 稿更好' }).waitFor()
  assert.equal(calls.length - partialCalls, 1)
  const sampleCalls = calls.slice(comparisonStart).filter((_, i) => i !== 2)
  assert.equal(sampleCalls.length, 3)
  assert.equal(sampleCalls.filter(call => call.messages[1].content.includes(base)).length, 1)
  await blind.getByRole('button', { name: 'C 稿更好' }).click()
  await blind.getByText(/稿：规则和选段/).waitFor()
  const calibration = page.getByRole('region', { name: '试写校准', exact: true })
  const daily = calibration.locator('.reference-trial').first()
  await daily.getByRole('button', { name: /生成试写片段/ }).click()
  await panel.getByText('试写片段已保存，可以填写反馈', { exact: true }).waitFor()
  assert.equal(await daily.getByLabel('试写片段', { exact: true }).inputValue(), dailyText)
  await daily.getByLabel('你的反馈').fill('对白停顿自然，保留；重复动作简略带过。')
  await daily.getByRole('button', { name: '保存反馈', exact: true }).click()
  await panel.getByText('试写反馈已保存，可根据反馈校准规范', { exact: true }).waitFor()
  const conflict = calibration.locator('.reference-trial').nth(1)
  await conflict.getByRole('button', { name: /生成试写片段/ }).click()
  await panel.getByText('试写片段已保存，可以填写反馈', { exact: true }).waitFor()
  assert.equal(await conflict.getByLabel('试写片段', { exact: true }).inputValue(), conflictText)
  await conflict.getByLabel('你的反馈').fill('选择的瞬间展开，保留人物试探。')
  await conflict.getByRole('button', { name: '保存反馈', exact: true }).click()
  await panel.getByText('试写反馈已保存，可根据反馈校准规范', { exact: true }).waitFor()
  await calibration.getByRole('button', { name: /根据反馈校准规范/ }).click()
  await panel.getByText('校准后的规范草稿已保存，核对后可确认应用', { exact: true }).waitFor()
  assert.equal(await panel.getByLabel('可直接编辑，确认后用于后续写作').inputValue(), refinedGuide)
  assert.equal(await calibration.getByText('这段试写使用的规范或参考资料已变化，请重新试写后再参与校准。', { exact: true }).count(), 2)
  await calibration.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(directory, 'reference-calibration.png'), fullPage: true })
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
  assert.ok(!JSON.stringify(calls.at(-1)).includes('LOCAL_PLOT_SECRET'))
  await page.evaluate(({ id, chapterId }) => window.novelStudio.updateChapter({ id: chapterId, manuscript: '并行更新的本书正文。' }), { id: a.project.id, chapterId: a.chapters[0].id })
  await page.evaluate(({ runId, candidateId }) => window.novelStudio.confirmAgentCandidate({ runId, candidateId, currentDraftDigest: 'fixture-draft' }), { runId: agentRun.id, candidateId: candidateRun.candidates[0].id })
  await page.reload()
  await page.getByRole('button', { name: '提示词与文风', exact: true }).click()
  await page.getByRole('button', { name: /参考小说.*导入、分析/ }).click()
  await panel.getByLabel('可直接编辑，确认后用于后续写作').waitFor()
  assert.equal(await panel.getByLabel('可直接编辑，确认后用于后续写作').inputValue(), refinedGuide)
  assert.equal(await panel.locator('.reference-book').count(), 2)
  await blind.getByText(/稿：规则和选段/).waitFor()
  const liveModel = process.env.NOVEL_STUDIO_BLIND_CODEX_MODEL
  // Saving settings broadcasts runtime:changed across the Electron context bridge.
  await page.evaluate(model => window.novelStudio.saveCodexSettings({ model, reasoningEffort: 'medium' }), liveModel || 'gpt-6.2-astra')
  if (liveModel) {
    for (const task of ['draft', 'rewrite']) {
      const trial = await page.evaluate(input => window.novelStudio.compareReferences(input), {
        projectId: a.project.id, backend: 'codex', task, includeSamples: true,
        rule: '多用具体动词，检查词语搭配。对白按人物目的自然展开，删去重复解释。',
        brief: task === 'draft' ? '暴雨后的县广播站。上一班的同事口误报反了绕行路线。新人在直播中得纠正消息，还得替站在门边的同事解围。涉及学校接孩子的家长。' : '只改两句对白，用克制的语气写遗物交接，保留其余句子。',
        sourceText: task === 'draft' ? '' : '登记员把袋口撑开。\n“请对物品的完整性进行确认。”登记员说。\n老人用指甲刮了刮表背。\n“我已经对这块手表的归属完成了辨认。”老人说。\n墙上的钟快了两分钟。',
      })
      assert.equal(trial.model.model, liveModel)
      assert.equal(trial.guidedSlot, null)
      assert.ok([trial.output_a, trial.output_b, trial.output_c].every(text => text?.trim()))
      assert.deepEqual(trial.voiceSamples.map(s => s.use), task === 'draft' ? ['底色', '留有余地'] : ['底色'])
      const file = path.join(directory, 'live-blind-' + task + '.json')
      await fs.writeFile(file, JSON.stringify(trial, null, 2), { mode: 0o600 })
      console.log(JSON.stringify({ requestedModel: liveModel, task, lengths: [trial.output_a.length, trial.output_b.length, trial.output_c.length], file }))
    }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ imported: 2, isolatedModelCalls: calls.length, guideAppliedAndDisabled: true, persistenceVerified: true, agentCandidateVerified: true, scenesSelected: true, calibrationVerified: true, blindComparisonVerified: true, screenshot: path.join(directory, 'reference-novels.png') }))
} finally {
  if (app) await app.close()
  await new Promise(resolve => server.close(resolve))
}
