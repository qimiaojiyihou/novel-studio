import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-candidate-history-ui-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.disableHardwareAcceleration()
const fixture = {
  project: { id: 'fixture-book', title: '候选入口回归测试', genre: '测试', default_execution_mode: 'codex' },
  chapter: { id: 'fixture-chapter', project_id: 'fixture-book', chapter_no: 1, title: '第一章', status: 'draft', manuscript: '原正文保持不变。', card: {}, scenePlan: {}, detailLoaded: true },
  run: { id: 'fixture-run', projectId: 'fixture-book', chapterId: 'fixture-chapter', workflowId: 'inline-action', status: 'completed', executionMode: 'codex', actualBackend: 'codex_acp', currentStepId: 'fixture-step', modelRoutes: {}, updatedAt: '2026-11-01T00:00:00.000Z',
    steps: [{ id: 'fixture-step', status: 'completed', task: 'chapter', input: { task: 'chapter', intent: 'draft', target: { kind: 'manuscript', targetId: 'fixture-chapter', fieldLabel: '正文' } } }],
    candidates: [{ id: 'fixture-candidate', stepId: 'fixture-step', artifactType: 'manuscript', status: 'accepted', sourceDigest: 'fixture-source', payload: { manuscript: '已经保存的历史候选稿。' }, evidence: {} }], events: [], approvals: [], messages: [] },
}
const bootstrap = `
  const fixture = ${JSON.stringify(fixture)};
  const handlers = new Map();
  window.__candidateTest = { loads: 0, writes: 0, emitChange() { for (const fn of handlers.get('onCreativeChange') || []) fn({projectId: fixture.project.id}) } };
  const api = {
    loadWorkspaceCatalog: async () => { window.__candidateTest.loads++; return { project: fixture.project, projects: [fixture.project], chapters: [fixture.chapter] } },
    getWorkspaceChapter: async () => fixture.chapter,
    getRuntimeInfo: async () => ({agentProvider:'codex',goServiceStatus:'ready'}),
    loadModelSettings: async () => ({profiles:[],routes:{}}),
    listAgentRuns: async () => [{...fixture.run, inlineTargetKind:'manuscript',candidateCount:1,pendingCandidateCount:0}],
    getAgentRun: async () => JSON.parse(JSON.stringify(fixture.run)),
    getSessionModelApproval: async () => ({enabled:false}),
  };
  window.novelStudio = new Proxy(api, {get(target,key) {
    if (key in target) return target[key];
    if (String(key).startsWith('on')) return fn => { if (!handlers.has(key)) handlers.set(key,[]); handlers.get(key).push(fn); return () => {} };
    if (/^(save|update|create|accept|resolve|start|delete|finish)/.test(String(key))) return async () => { window.__candidateTest.writes++; throw new Error('预览期间触发写入：'+String(key)) };
    return async () => String(key).startsWith('list') ? [] : {};
  }});
`
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8').replace('<head>', `<head><base href="${pathToFileURL(`${path.join(root, 'dist')}${path.sep}`).href}"><script>${bootstrap}</script>`)
fs.writeFileSync(path.join(temporary, 'index.html'), html)
async function main() {
await app.whenReady()
const window = new BrowserWindow({ show: false, width: 1480, height: 920, webPreferences: { contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
const read = script => window.webContents.executeJavaScript(script)
async function waitFor(script, message) {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (await read(script)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}
try {
  await window.loadFile(path.join(temporary, 'index.html'))
  await waitFor(`document.querySelector('.inline-run-top-button')`, '重启后没有恢复历史候选入口')
  await read(`document.querySelector('.inline-run-top-button').click()`)
  await waitFor(`document.querySelector('.inline-codex-panel')?.textContent.includes('已经保存的历史候选稿。')`, '历史候选没有显示')
  await read(`window.__candidateTest.emitChange()`)
  await waitFor(`[...document.querySelectorAll('.topbar-tool')].some(button => button.textContent === '本书任务有更新')`, '更新入口没有出现')
  await read(`[...document.querySelectorAll('.topbar-tool')].find(button => button.textContent === '本书任务有更新').click()`)
  await waitFor(`window.__candidateTest.loads >= 2 && ![...document.querySelectorAll('.topbar-tool')].some(button => button.textContent === '本书任务有更新')`, '工作区刷新没有完成')
  assert.equal(await read(`document.querySelector('.inline-codex-panel')?.textContent.includes('已经保存的历史候选稿。')`), true)
  await read(`document.querySelector('[aria-label="关闭 AI 候选窗口"]').click(); [...document.querySelectorAll('.topbar-tool')].find(button => button.textContent === '候选稿').click()`)
  await waitFor(`document.querySelector('.candidate-history-list button')`, '固定候选入口没有加载历史列表')
  assert.equal(await read(`getComputedStyle(document.querySelector('.candidate-history-backdrop')).position`), 'fixed')
  if (process.env.NOVEL_UI_SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 150))
    fs.writeFileSync(process.env.NOVEL_UI_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
  }
  await read(`document.querySelector('.candidate-history-list button').click()`)
  await waitFor(`!document.querySelector('.candidate-history-backdrop') && document.querySelector('.inline-codex-panel')?.textContent.includes('已经保存的历史候选稿。')`, '从列表重新打开候选失败')
  assert.equal(await read(`document.querySelector('.cm-content')?.textContent.trim()`), fixture.chapter.manuscript)
  assert.equal(await read(`window.__candidateTest.writes`), 0)
  console.log('PASS：历史入口恢复、工作区刷新保留候选、固定入口重新打开候选；正文未变，零写入。')
  window.destroy()
  app.exit(0)
} catch (error) {
  console.error(error)
  console.error((await read('document.body.innerText')).slice(0, 5000))
  window.destroy()
  app.exit(1)
}
}
void main().catch(error => { console.error(error); app.exit(1) })
