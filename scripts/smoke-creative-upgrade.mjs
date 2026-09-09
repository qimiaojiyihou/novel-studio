import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { CREATIVE_BUILD_ID } from '../electron/build-info.js'
import { assertIsolatedRuntime } from './smoke-isolation.mjs'

// Isolated desktop smoke test. Only its loopback fixture server receives requests.
// No user database, Codex session, credential or remote model is used.
const require = createRequire(import.meta.url)
const { _electron } = await import(process.env.NOVEL_STUDIO_PLAYWRIGHT || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'novel-creative-smoke-'))
const prose = '周砚付了摊位租金。\n\n' + Array.from({ length: 45 }, (_, index) => `第${index + 1}桌的客人正在等饭。周砚把锅端下来，问她要不要辣。`).join('\n\n')
const review = { scores: { causality: 2 }, issues: [], summary: '这是本地工程测试桩，不评定创作能力。' }
const state = { summary: '周砚已付摊位租金。', facts: [{ text: '租金已付', evidence: '周砚付了摊位租金。' }], characterStates: [], relationshipChanges: [], timelineEvents: [], openThreads: [], foreshadow: { setups: [], payoffs: [] } }
const calls = [], errors = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  // The finalizer issues exactly one independent review then one state extraction.
  const result = calls.length === 0 ? review : process.argv.includes('--handoff-repair')
    ? { ...state, facts: [{ text: '租金已付', evidence: '“周砚付了摊位租金。”' }] } : state
  calls.push({ model: input.model, stream: input.stream, messages: input.messages.length, promptChars: input.messages.reduce((n, item) => n + item.content.length, 0) })
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const env = { ...process.env, NOVEL_STUDIO_TEST_USER_DATA: fixtureDirectory, NOVEL_STUDIO_NO_GO: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app, vite
try {
  if (process.argv.includes('--development')) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true } })
    await vite.listen()
    env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${vite.httpServer.address().port}`
  } else delete env.VITE_DEV_SERVER_URL
  app = await _electron.launch({ executablePath: process.env.NOVEL_STUDIO_TEST_APP || require('electron'),
    args: process.env.NOVEL_STUDIO_TEST_APP ? [] : ['.'], cwd: root, env, timeout: 30000 })
  app.process().stderr.on('data', data => { if (/Error|constraint|Unhandled/.test(String(data))) console.error(String(data)) })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.novelStudio))
  const runtime = await page.evaluate(() => window.novelStudio.getRuntimeInfo())
  // Fail before the first mutation, even when an older packaged app ignores env.
  assertIsolatedRuntime(runtime, fixtureDirectory)
  assert.equal(runtime.buildId, CREATIVE_BUILD_ID)
  const workspace = await page.evaluate(() => window.novelStudio.createProject({ title: '隔离测试·章节定稿', genre: '文娱', idea: '周砚在夜市开摊' }))
  const projectId = workspace.project.id, chapterId = workspace.chapters[0].id
  await page.evaluate(async ({ projectId, chapterId, prose, port }) => {
    await window.novelStudio.updateProject({ id: projectId, default_execution_mode: 'codex' })
    await window.novelStudio.updateChapter({ id: chapterId, manuscript: prose })
    await window.novelStudio.saveModelProfile({ id: 'fixture-review', name: '仅本地工程测试', provider: 'local', model: 'fixture-not-a-model', baseUrl: `http://127.0.0.1:${port}/v1`, settings: { requestConfig: { stream: false } } })
    await window.novelStudio.updateTaskRoute({ task: 'quality_review', modelProfileId: 'fixture-review' })
  }, { projectId, chapterId, prose, port: server.address().port })
  await page.reload()
  // Workspace controls at wide and compact desktop widths.
  for (const width of [1440, 1080]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('tab', { name: '正文', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}`)
    await page.getByRole('button', { name: '专注写作', exact: true }).click()
    assert.equal(await page.locator('#workspace-sidebar').isVisible(), false)
    assert.equal(await page.locator('#writing-lens').isVisible(), false)
    await page.getByRole('button', { name: '退出专注', exact: true }).click()
    assert.equal(await page.locator('#workspace-sidebar').isVisible(), true)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const trigger = page.locator('.editor-generation-actions').getByRole('button', { name: '选择本次执行方式' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: '本次创作执行方式' })
  await menu.waitFor()
  assert.equal(await menu.getByRole('menuitem').first().evaluate(element => element === document.activeElement), true)
  await page.keyboard.press('End')
  assert.equal(await menu.getByRole('menuitem').last().evaluate(element => element === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await menu.count(), 0)
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true)
  await trigger.click()
  await page.locator('.chapter-title-input').click()
  assert.equal(await menu.count(), 0)
  await page.getByRole('tab', { name: '正文', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '章节卡', exact: true }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('Home')
  await page.screenshot({ path: path.join(fixtureDirectory, 'workspace.png') })
  const layoutAudit = []
  for (const width of [1440, 1080]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of ['故事基础', '人物与关系', '世界观', '结构规划', '知识与连续性', '提示词与文风', '创作助手']) {
      await page.getByRole('navigation', { name: '项目导航' }).getByRole('button', { name, exact: true }).click()
      await page.locator('.editor-panel').waitFor({ state: 'hidden' })
      // Allow Vue to finish rendering the selected center before measuring controls.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const overflow = await page.locator('#workspace-main').evaluate(element => [...element.querySelectorAll('button,input,select,textarea')].filter(node => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.bottom > 70 && rect.top < innerHeight && (rect.right > innerWidth + 2 || rect.left < -2)
      }).slice(0, 8).map(node => ({ label: node.getAttribute('aria-label') || node.textContent.slice(0, 30), className: node.className, x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })))
      layoutAudit.push({ width, name, overflow })
      assert.deepEqual(overflow, [], `${name} controls stay inside viewport at ${width}`)
      if (name === '故事基础') {
        await page.locator('.planning-header h1').filter({ hasText: '故事基础' }).waitFor()
        assert.equal(await page.getByRole('button', { name: '创作方式 · Codex', exact: true }).isVisible(), true)
        if (width === 1080) {
          const regions = await page.locator('.planning-layout').evaluate(element => ({
            bottom: element.querySelector('.planning-canvas').getBoundingClientRect().bottom,
            top: element.querySelector('.candidate-rail').getBoundingClientRect().top,
          }))
          assert.ok(regions.top >= regions.bottom - 1, 'Stacked candidates must not overlap the planning form')
          await page.getByRole('button', { name: /^查看候选/ }).click()
          assert.equal(await page.getByRole('complementary', { name: '规划候选签批' }).evaluate(element => document.activeElement === element), true)
          await page.locator('.planning-layout').evaluate(element => { element.scrollTop = 0 })
        }
        await page.screenshot({ path: path.join(fixtureDirectory, `planning-${width}.png`) })
      }
    }
  }
  console.log('Layout audit:', JSON.stringify(layoutAudit))
  await page.getByRole('button', { name: '正在创作', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '模型与项目设置', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索 Codex 模型' }).fill('gpt-6')
  assert.match(await page.locator('.codex-agent-block').innerText(), /GPT-6 Astra/)
  assert.match(await page.locator('.codex-agent-block option').allTextContents().then(items => items.join(' ')), /GPT-6 Astra/)
  const authHeight = await page.locator('.codex-settings-grid select').first().evaluate(element => element.getBoundingClientRect().height)
  assert.ok(authHeight >= 30 && authHeight <= 60, 'Authentication control should not stretch to the model picker height')
  await page.screenshot({ path: path.join(fixtureDirectory, 'models.png') })
  await page.getByTitle('关闭设置', { exact: true }).click()
  await page.getByRole('tab', { name: '章节卡', exact: true }).click()
  await page.getByText('手动编辑章节卡', { exact: true }).click()
  await page.locator('.formal-card-edit textarea').first().fill('本章变化：付租金，开始接待顾客。')
  await page.getByRole('button', { name: '保存章节卡', exact: true }).click()
  await page.waitForFunction(async ({ projectId, chapterId }) => (await window.novelStudio.loadWorkspace(projectId)).chapters.find(chapter => chapter.id === chapterId).card.goal === '本章变化：付租金，开始接待顾客。', { projectId, chapterId })
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  assert.match(await page.locator('.manuscript-local-checks').innerText(), /本地检查/)
  await page.getByRole('button', { name: '完成本章', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '完成本章', exact: true })
  await dialog.getByRole('button', { name: '关闭定稿面板' }).focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.getByRole('button', { name: '稍后定稿' }).evaluate(element => element === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0)
  await page.getByRole('button', { name: '完成本章', exact: true }).click()
  await dialog.getByRole('button', { name: '先做本地检查 · 不调用模型' }).click()
  await dialog.getByRole('button', { name: '集中修改已完成，开始独立审稿' }).waitFor()
  assert.equal(calls.length, 0, 'Local checks do not start a model call')
  await dialog.getByRole('button', { name: '集中修改已完成，开始独立审稿' }).click()
  await page.waitForFunction(async chapterId => (await window.novelStudio.getChapterFinalization({ chapterId }))?.status === 'waiting_review_confirmation', chapterId, { timeout: 20000 })
  const first = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
  const duplicate = await page.evaluate(({ projectId, chapterId }) => window.novelStudio.startChapterFinalization({ projectId, chapterId }), { projectId, chapterId })
  assert.equal(duplicate.id, first.id)
  assert.equal(calls.length, 1)
  await dialog.getByRole('button', { name: '接受审稿判断，提取章后交接' }).click()
  if (process.argv.includes('--handoff-repair')) {
    await page.waitForFunction(async chapterId => (await window.novelStudio.getChapterFinalization({ chapterId }))?.status === 'waiting_state_correction', chapterId, { timeout: 20000 })
    await dialog.getByRole('button', { name: '保存修正并本地重验' }).waitFor()
    // Even an unchanged recheck must visibly explain why completion is blocked.
    await dialog.getByRole('button', { name: '保存修正并本地重验' }).click()
    await dialog.locator('.evidence-save-feedback').waitFor({ timeout: 5000 })
    assert.match(await dialog.locator('.evidence-save-feedback').innerText(), /仍有 1 处来源待核对/)
    assert.equal(calls.length, 2, 'Unchanged recheck is local, never a new generation')
    const unmodified = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
    assert.equal(unmodified.handoff.authorCorrections.length, 0)
    await dialog.getByLabel('第 1 项 · 证据原句', { exact: true }).fill('周砚付了摊位租金。')
    await dialog.getByRole('button', { name: '保存修正并本地重验' }).click()
    await dialog.locator('.evidence-save-error').waitFor({ timeout: 5000 })
    assert.match(await dialog.locator('.evidence-save-error').innerText(), /请填写本次核对说明/)
    assert.equal(await dialog.getByLabel('本次核对说明（修正时必填）').evaluate(element => element === document.activeElement), true)
    assert.equal(await dialog.getByLabel('第 1 项 · 证据原句', { exact: true }).inputValue(), '周砚付了摊位租金。')
    await dialog.getByLabel('本次核对说明（修正时必填）').fill('逐字核对正文，去掉模型额外添加的引号。')
    // Let a normal status refresh run: it must preserve the author's form edits.
    await page.waitForTimeout(1700)
    assert.equal(await dialog.getByLabel('第 1 项 · 证据原句', { exact: true }).inputValue(), '周砚付了摊位租金。')
    await page.screenshot({ path: path.join(fixtureDirectory, 'handoff-correction.png') })
    await dialog.getByRole('button', { name: '保存修正并本地重验' }).click()
    await page.waitForFunction(() => document.querySelector('.evidence-save-feedback')?.textContent.includes('已保存 1 项修正'))
    assert.match(await dialog.locator('.evidence-save-feedback').innerText(), /本地重验已通过/)
  }
  await page.waitForFunction(async chapterId => (await window.novelStudio.getChapterFinalization({ chapterId }))?.status === 'waiting_confirmation', chapterId, { timeout: 20000 })
  await dialog.getByRole('button', { name: '确认交接，完成本章' }).waitFor()
  assert.equal(await dialog.getByText('租金已付', { exact: true }).isVisible(), true)
  // Ensure the content scrolls all the way while the final action remains visible.
  const scroll = await dialog.locator('main').evaluate(element => {
    element.scrollTop = element.scrollHeight
    return { top: element.scrollTop, end: element.scrollHeight - element.clientHeight, height: element.clientHeight }
  })
  assert.ok(scroll.height > 250)
  assert.ok(Math.abs(scroll.end - scroll.top) < 2)
  assert.equal(await dialog.getByRole('button', { name: '确认交接，完成本章' }).isVisible(), true)
  await page.screenshot({ path: path.join(fixtureDirectory, 'finalization.png') })
  await dialog.getByRole('button', { name: '确认交接，完成本章' }).click()
  const finished = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
  assert.equal(finished.status, 'completed')
  assert.equal(calls.length, 2, 'Evidence correction adds no third model call')
  if (process.argv.includes('--handoff-repair')) assert.equal(finished.handoff.authorCorrections.length, 1)
  assert.notEqual(finished.review_run_id, finished.state_run_id)
  assert.equal(calls.length, 2)
  if (process.argv.includes('--proofreading')) {
    await dialog.getByRole('button', { name: '关闭定稿面板' }).click()
    // Real editor autosave, not only an IPC fixture write: punctuation affects
    // the finalized evidence quote. The same two mock calls must remain enough.
    const editor = page.locator('.cm-content[contenteditable="true"]')
    await editor.click()
    await page.keyboard.press('Meta+Home')
    await page.keyboard.press('Meta+A')
    await page.keyboard.insertText(prose.replace('周砚付了摊位租金。', '周砚付了摊位租金！'))
    await page.getByRole('button', { name: '定稿后校正', exact: true }).click()
    const correction = page.getByRole('region', { name: '定稿后校正' })
    await correction.getByText('仅核对受影响的交接引句 · 1 处', { exact: true }).waitFor()
    await correction.getByRole('button', { name: '确认文字校正，恢复定稿' }).click()
    await correction.getByRole('alert').waitFor()
    assert.match(await correction.getByRole('alert').innerText(), /校正说明/)
    await correction.getByLabel('新的证据原句', { exact: true }).fill('周砚付了摊位租金！')
    await correction.getByLabel('校正说明', { exact: true }).fill('仅调整句末标点，情节事实和交接含义未变。')
    await correction.getByRole('checkbox').check()
    await page.screenshot({ path: path.join(fixtureDirectory, 'proofreading-before-confirm.png') })
    await correction.getByRole('button', { name: '确认文字校正，恢复定稿' }).click()
    await correction.getByRole('status').waitFor()
    assert.equal(await correction.getByRole('status').evaluate(element => document.activeElement === element), true)
    assert.match(await correction.innerText(), /没有调用模型/)
    assert.equal(calls.length, 2)
    const amended = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
    assert.equal(amended.status, 'completed')
    assert.equal(amended.checks.authorAmendment.reviewedFinalizationId, finished.id)
    assert.equal(amended.state.facts[0].evidence, '周砚付了摊位租金！')
    await page.screenshot({ path: path.join(fixtureDirectory, 'proofreading-completed.png') })
    await dialog.getByRole('button', { name: '关闭定稿面板' }).click()
    await page.reload()
    await page.getByRole('button', { name: '已定稿·已校正', exact: true }).waitFor()
    await page.getByRole('button', { name: '保存版本', exact: true }).click()
    await page.getByRole('button', { name: '已定稿·已校正', exact: true }).waitFor()
    // Another saved typo: cumulative differences still include earlier correction.
    await page.evaluate(({ chapterId, prose }) => window.novelStudio.updateChapter({ id: chapterId, manuscript: prose.replace('周砚付了摊位租金。', '周砚已付了摊位租金！') }), { chapterId, prose })
    await page.reload()
    await page.getByRole('button', { name: '定稿后校正', exact: true }).click()
    await correction.getByText(/与原审稿正文的累计差异/).waitFor()
    assert.equal(calls.length, 2)
    await dialog.getByRole('button', { name: '关闭定稿面板' }).click()
  }
  await page.evaluate(({ chapterId, prose }) => window.novelStudio.updateChapter({ id: chapterId, manuscript: prose + '\n作者的新修改。' }), { chapterId, prose })
  const stale = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
  assert.equal(stale.status, 'stale')
  if (process.argv.includes('--manual-finalization')) {
    await page.reload()
    await page.getByRole('button', { name: '完成本章', exact: true }).click()
    await dialog.getByLabel('本次定稿方式', { exact: true }).selectOption('manual')
    const manual = page.getByRole('region', { name: '人工直接定稿', exact: true })
    await manual.getByRole('button', { name: '确认直接定稿', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('list', { name: '定稿进度' }).count(), 0)
    const changed = '周砚没有付租金，决定当天离开夜市。\n\n这是人工实质改写后的正文。'
    // A competing saved version makes the visible preview stale, never silently accepted.
    await page.evaluate(({ chapterId, changed }) => window.novelStudio.updateChapter({ id: chapterId, manuscript: changed }), { chapterId, changed })
    await manual.getByRole('button', { name: '确认直接定稿', exact: true }).click()
    await manual.getByRole('alert').waitFor()
    assert.match(await manual.getByRole('alert').innerText(), /已变化/)
    await manual.getByRole('button', { name: '刷新当前保存稿', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.manual-finalization .primary-button')?.disabled)
    // No note or semantic-unchanged checkbox is necessary for an author decision.
    await manual.getByRole('button', { name: '确认直接定稿', exact: true }).click()
    await manual.getByRole('status').waitFor()
    assert.equal(await manual.getByRole('status').evaluate(element => document.activeElement === element), true)
    assert.equal(calls.length, 2)
    const direct = await page.evaluate(chapterId => window.novelStudio.getChapterFinalization({ chapterId }), chapterId)
    assert.equal(direct.status, 'completed'); assert.equal(direct.checks.manualFinalization.handoffSkipped, true)
    assert.deepEqual(direct.review, {}); assert.deepEqual(direct.state, {})
    await page.screenshot({ path: path.join(fixtureDirectory, 'manual-finalization-completed.png') })
    await dialog.getByRole('button', { name: '关闭定稿面板' }).click()
    await page.reload()
    await page.getByRole('button', { name: '已定稿·人工', exact: true }).waitFor()
    await page.getByRole('button', { name: '保存版本', exact: true }).click()
    await page.getByRole('button', { name: '已定稿·人工', exact: true }).waitFor()
    await page.locator('.novel-editor .cm-content').click()
    await page.keyboard.press('Meta+A')
    await page.keyboard.insertText(changed + '\n\n他没有再回头。')
    await page.getByRole('button', { name: '完成本章', exact: true }).click()
    await manual.getByRole('button', { name: '确认直接定稿', exact: true }).click()
    await manual.getByRole('status').waitFor()
    await dialog.getByLabel('本次定稿方式', { exact: true }).selectOption('review')
    assert.equal(await dialog.locator('.finalize-progress').count(), 0, 'Manual completion must not masquerade as reviewed steps')
    await dialog.getByRole('button', { name: /准备新检查/ }).click()
    await dialog.getByRole('button', { name: '集中修改已完成，开始独立审稿', exact: true }).waitFor()
    assert.equal(calls.length, 2, 'Manual completion and preparing later review add zero model calls')
    await dialog.getByRole('button', { name: '取消本次定稿', exact: true }).click()
    await dialog.getByRole('button', { name: '关闭定稿面板' }).click()
  }
  if (vite) {
    // Actual production components with in-memory fixture responses for panel layout.
    await page.goto(`${env.VITE_DEV_SERVER_URL}/tests/ui-fixture.html`)
    const panel = page.getByRole('complementary', { name: 'AI 就地创作' })
    await panel.getByRole('button', { name: '接受候选', exact: true }).waitFor()
    const contrast = await panel.getByRole('button', { name: '接受候选', exact: true }).evaluate(element => {
      const style = getComputedStyle(element)
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const fg = luminance(style.color), bg = luminance(style.backgroundColor)
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)
    })
    assert.ok(contrast >= 4.5, `Acceptance button contrast: ${contrast}`)
    await panel.getByRole('button', { name: '手动编辑', exact: true }).click()
    await panel.locator('.candidate-author-editor textarea').first().fill('只在编辑器里的手动修订。')
    await panel.getByRole('button', { name: '对照原候选', exact: true }).click()
    assert.match(await panel.locator('.candidate-decision-dock').innerText(), /手动修改尚未确认/)
    assert.match(await panel.locator('.inline-manuscript-reading').innerText(), /正文末尾·滚动验收/)
    await panel.getByRole('button', { name: '撤销手动修改', exact: true }).click()
    assert.equal(await panel.getByRole('button', { name: '撤销手动修改', exact: true }).count(), 0)
    await panel.getByRole('button', { name: '展开对话', exact: true }).click()
    const bounds = await panel.evaluate(element => {
      const preview = element.querySelector('.inline-candidate-preview'), chat = element.querySelector('.inline-conversation')
      preview.scrollTop = preview.scrollHeight
      return { height: preview.clientHeight, end: preview.scrollHeight - preview.clientHeight, top: preview.scrollTop, previewRight: preview.getBoundingClientRect().right, chatLeft: chat.getBoundingClientRect().left }
    })
    assert.ok(bounds.height >= 400, 'Long content retains an ample reading area')
    assert.ok(Math.abs(bounds.end - bounds.top) < 2)
    assert.ok(bounds.chatLeft >= bounds.previewRight, 'Conversation appears beside candidate on wide desktops')
    await panel.getByRole('button', { name: '差异对比', exact: true }).click()
    await panel.locator('.inline-manuscript-diff .monaco-diff-editor').waitFor()
    await panel.getByRole('button', { name: '阅读', exact: true }).click()
    await page.screenshot({ path: path.join(fixtureDirectory, 'inline-wide.png') })
    await page.setViewportSize({ width: 900, height: 800 })
    await panel.locator('.inline-mobile-tabs').getByRole('button', { name: '创作对话' }).click()
    assert.equal(await panel.locator('.conversation-input textarea').isVisible(), true)
    await panel.locator('.inline-mobile-tabs').getByRole('button', { name: '候选内容' }).click()
    assert.equal(await panel.locator('.inline-candidate-preview').isVisible(), true)
    const acceptBounds = await panel.getByRole('button', { name: '接受候选', exact: true }).boundingBox()
    assert.ok(acceptBounds.y + acceptBounds.height < 800, 'Candidate acceptance stays onscreen')
    await page.screenshot({ path: path.join(fixtureDirectory, 'inline-compact.png') })
    await panel.getByRole('button', { name: '关闭 AI 候选窗口' }).click()
    await page.getByRole('button', { name: '重新打开候选' }).click()
    assert.equal(await panel.getByRole('button', { name: '接受候选', exact: true }).isVisible(), true)
  }
  assert.deepEqual(errors, [])
  const report = { result: 'engineering-only-pass', runtime, calls, scroll, layoutAudit, isolatedDirectory: fixtureDirectory, noRemoteModels: true, humanReview: 'not-run' }
  await writeFile(path.join(fixtureDirectory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: path.join(fixtureDirectory, 'failure.png') }).catch(() => {})
    console.error((await page.locator('body').innerText()).slice(-5000))
  }
  console.error('Smoke artifacts:', fixtureDirectory)
  throw error
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await vite?.close()
  await new Promise(resolve => server.close(resolve))
}
