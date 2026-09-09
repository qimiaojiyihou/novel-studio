import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { installOperator } from '../scripts/install-operator-skill.mjs'
import { operate, summarize, READ_OPERATIONS, WRITE_OPERATIONS } from '../skills/novel-studio-operator/scripts/operate.mjs'
import { READ_OPERATIONS as HOST_READ, WRITE_OPERATIONS as HOST_WRITE } from '../electron/creative-interface.js'
import { createCodexBookWorkspace, createCodexProjectMirror } from '../electron/codex-project-mirror.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-operator-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const workspace = path.join(root, 'book'), clientFile = path.join(root, 'client.json')
  fs.mkdirSync(workspace)
  fs.writeFileSync(path.join(workspace, '.novel-studio-project.json'), JSON.stringify({ projectId: 'book-a' }))
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '作者自己的指令')
  fs.writeFileSync(path.join(workspace, 'chapter.txt'), '原书稿应保持逐字相同')
  fs.writeFileSync(clientFile, JSON.stringify({ token: 'fixture-private-token' }))
  const calls = [], identity = { projectId: 'book-a', clientId: 'client-a', buildId: 'fixture' }
  const call = async (file, operation, input, requestId) => {
    calls.push({ file, operation, input, requestId })
    if (operation === 'identity') return identity
    if (operation === 'snapshot') return { project: { id: 'book-a', title: '书名' }, chapters: [{ id: 'chapter-a', manuscript: '他说：“好。”' }], runs: [], candidates: [] }
    return { runId: 'run-a' }
  }
  const options = { workspace, clientFile, projectId: 'book-a', call }
  return { root, workspace, clientFile, calls, identity, call, options }
}

test('operator operation allowlist stays aligned with the host, with no management binding', () => {
  assert.deepEqual(READ_OPERATIONS, HOST_READ)
  assert.deepEqual(WRITE_OPERATIONS, HOST_WRITE)
  assert.equal(WRITE_OPERATIONS.has('bind'), false)
})

test('status projection omits raw routes, capability catalogs and reviewer settings', () => {
  const result = summarize({}, { runs: [{ id: 'r', status: 'running', modelRoutes: { codexModel: 'gpt-6-astra', raw: 'private-detail', codexCapabilitySnapshot: { options: [] } } }], finalizations: [{ id: 'f', status: 'reviewing', reviewer: { settings: 'private-detail' } }] })
  assert.equal(result.activeRuns[0].model, 'gpt-6-astra')
  assert.doesNotMatch(JSON.stringify(result), /private-detail|codexCapabilitySnapshot|reviewer/)
})

test('manual completion operator requires explicit skips but not a compulsory note', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  const input = { chapterId: 'chapter-a', confirm: true, skipReview: true, skipHandoff: true }
  for (const field of ['confirm', 'skipReview', 'skipHandoff']) {
    f.calls.length = 0
    await assert.rejects(operate({ workspace: f.workspace, operation: 'finalization.manual', input: { ...input, [field]: false }, requestId: 'manual-decision-1', call: f.call }), /明确选择/)
    assert.equal(f.calls.length, 0)
  }
  await operate({ workspace: f.workspace, operation: 'finalization.manual', input, requestId: 'manual-decision-1', call: f.call })
  assert.equal(f.calls.at(-1).operation, 'finalization.manual')
  const summary = summarize({}, { finalizations: [{ id: 'f', manualFinalization: { requestDigest: 'not-for-summary' } }] })
  assert.equal(summary.finalizations[0].handoffSkipped, true)
  assert.doesNotMatch(JSON.stringify(summary), /not-for-summary/)
})

test('proofreading operator requires explicit author semantic confirmation before sending', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  f.calls.length = 0
  const input = { chapterId: 'chapter-a', confirm: true, reason: '作者核对仅标点变化' }
  const args = { workspace: f.workspace, operation: 'finalization.correct', input, requestId: 'proofread-0001', call: f.call }
  await assert.rejects(operate(args), { code: 'CONFIRMATION_REQUIRED' })
  assert.equal(f.calls.length, 0)
  await operate({ ...args, input: { ...input, meaningUnchanged: true } })
  assert.equal(f.calls.at(-1).operation, 'finalization.correct')
})

test('installation is read-only to the app, preserves manuscripts and custom AGENTS, and is idempotent', async t => {
  const f = fixture(t)
  const first = await installOperator(f.options)
  assert.ok(first.changedFiles > 0)
  assert.equal((await installOperator(f.options)).changedFiles, 0)
  assert.deepEqual(f.calls.map(c => c.operation), ['identity', 'identity'])
  assert.equal(fs.readFileSync(path.join(f.workspace, 'chapter.txt'), 'utf8'), '原书稿应保持逐字相同')
  assert.equal(fs.readFileSync(path.join(f.workspace, 'AGENTS.md'), 'utf8'), '作者自己的指令')
  const config = fs.readFileSync(path.join(f.workspace, '.novel-studio-operator.json'), 'utf8')
  assert.doesNotMatch(config, /fixture-private-token/)
  assert.ok(fs.existsSync(path.join(f.workspace, '.agents/skills/novel-studio-operator/scripts/creative-client.mjs')))
})

test('wrong project identity prevents installation and operation', async t => {
  const f = fixture(t)
  f.identity.projectId = 'book-b'
  await assert.rejects(installOperator(f.options), /不属于同一项目/)
  assert.equal(fs.existsSync(path.join(f.workspace, '.agents')), false)
  f.identity.projectId = 'book-a'
  await installOperator(f.options)
  f.identity.projectId = 'book-b'
  f.calls.length = 0
  await assert.rejects(operate({ workspace: f.workspace, operation: 'run.pause', input: { runId: 'run-a' }, requestId: 'pause-0001', call: f.call }), { code: 'BINDING_MISMATCH' })
  assert.deepEqual(f.calls.map(c => c.operation), ['identity'])
})

test('status performs identity and snapshot only and does not print credentials or manuscript', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  f.calls.length = 0
  const result = await operate({ workspace: f.workspace, call: f.call })
  assert.deepEqual(f.calls.map(c => c.operation), ['identity', 'snapshot'])
  assert.equal(result.chapters[0].chineseCharacters, 3)
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-token|他说/)
})

test('requests retain stable IDs, confirmations and no implicit retry', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  f.calls.length = 0
  const base = { workspace: f.workspace, operation: 'candidate.resolve', call: f.call }
  await assert.rejects(operate({ ...base, input: {} }), { code: 'REQUEST_ID_REQUIRED' })
  await assert.rejects(operate({ ...base, requestId: 'decision-0001', input: {} }), { code: 'CONFIRMATION_REQUIRED' })
  assert.equal(f.calls.length, 0)
  const input = { runId: 'run-a', candidateId: 'candidate-a', accept: true, confirm: true, reason: '作者已确认本候选' }
  await operate({ ...base, requestId: 'decision-0001', input })
  assert.deepEqual(f.calls.at(-1), { file: fs.realpathSync(f.clientFile), operation: 'candidate.resolve', input, requestId: 'decision-0001' })
  let writes = 0
  await assert.rejects(operate({ ...base, requestId: 'decision-0002', input,
    call: async (...args) => { if (args[1] === 'identity') return f.identity; writes++; throw Object.assign(new Error('receipt lost'), { code: 'REQUEST_INTERRUPTED' }) } }), { code: 'REQUEST_INTERRUPTED' })
  assert.equal(writes, 1)
})

test('unknown operations, cross-book requests and internal mirrors stop before transport', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  f.calls.length = 0
  await assert.rejects(operate({ workspace: f.workspace, operation: 'bind', call: f.call }), { code: 'UNKNOWN_OPERATION' })
  await assert.rejects(operate({ workspace: f.workspace, operation: 'snapshot', input: { projectId: 'book-b' }, call: f.call }), { code: 'BINDING_MISMATCH' })
  fs.writeFileSync(path.join(f.workspace, '.nscollab.json'), '{}')
  await assert.rejects(operate({ workspace: f.workspace, call: f.call }), { code: 'INTERNAL_MIRROR' })
  assert.equal(f.calls.length, 0)
})

test('installer preserves customized skill files and rejects symlink destinations', async t => {
  const f = fixture(t)
  await installOperator(f.options)
  const guide = path.join(f.workspace, '.agents/skills/novel-studio-operator/SKILL.md')
  fs.writeFileSync(guide, '作者定制版')
  await assert.rejects(installOperator(f.options), /保留已有自定义文件/)
  assert.equal(fs.readFileSync(guide, 'utf8'), '作者定制版')
  const other = path.join(f.root, 'book-symlink')
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, '.novel-studio-project.json'), JSON.stringify({ projectId: 'book-a' }))
  fs.symlinkSync(path.join(f.workspace, '.agents'), path.join(other, '.agents'))
  await assert.rejects(installOperator({ ...f.options, workspace: other }), /符号链接/)
})

test('packaged resources install a self-contained operator without a development checkout', async t => {
  const f = fixture(t), resources = path.join(f.root, 'resources')
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
  for (const item of pkg.build.extraResources.filter(item => /operator|creative-client/.test(item.from))) {
    fs.mkdirSync(path.dirname(path.join(resources, item.to)), { recursive: true })
    fs.cpSync(path.join(repo, item.from), path.join(resources, item.to), { recursive: true })
  }
  const packaged = await import(pathToFileURL(path.join(resources, 'scripts/install-operator-skill.mjs')))
  await packaged.installOperator(f.options)
  const installed = path.join(f.workspace, '.agents/skills/novel-studio-operator/scripts')
  const transport = await import(pathToFileURL(path.join(installed, 'creative-client.mjs')))
  assert.equal(typeof transport.callCreative, 'function')
  const operator = await import(pathToFileURL(path.join(installed, 'operate.mjs')))
  assert.equal((await operator.operate({ workspace: f.workspace, call: f.call })).identity.projectId, 'book-a')
})

test('book guidance separates outer operator and inner candidate roles; mirror has no operator credentials', t => {
  const f = fixture(t), project = { id: 'book-a', title: '更名后的书', genre: '悬疑' }
  const book = createCodexBookWorkspace({ baseDirectory: f.root, project })
  const guide = fs.readFileSync(path.join(book.root, 'AGENTS.md'), 'utf8')
  assert.match(guide, /内部 ACP 候选会话/)
  assert.match(guide, /外部专属作家任务/)
  assert.match(guide, /不要调用外部作家操作入口/)
  const mirror = createCodexProjectMirror({ baseDirectory: f.root, agentRun: { id: 'run-a', creativePack: {} }, workspace: { project, chapters: [] }, creativePack: {} })
  assert.equal(fs.existsSync(path.join(mirror.root, '.novel-studio-operator.json')), false)
  assert.equal(fs.existsSync(path.join(mirror.root, '.agents/skills/novel-studio-operator')), false)
})
