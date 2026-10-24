import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ClaudeAgentGateway, inspectClaudeRuntime, validateClaudeTool, claudeQueryEnvironment, normalizeClaudeEffort, claudeResultError, claudeSdkLaunchOptions } from '../electron/claude-agent-gateway.js'
import { AgentGatewayRouter, normalizeAgentProvider, agentProviderLabel, agentProviderModel, agentProviderReasoningEffort } from '../electron/agent-gateway-router.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { AgentRuntime } from '../electron/agent-runtime.js'
import { runMigrations } from '../electron/database-migrations.js'
import { creativeAgentLabel, creativeBackendLabel } from '../src/utils/agent-provider.js'
import { creativeRoutePresentation } from '../src/utils/inline-creative.js'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-claude-'))
  const executablePath = path.join(root, process.platform === 'win32' ? 'claude.exe' : 'claude')
  fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const mirror = path.join(root, 'mirror'); fs.mkdirSync(mirror)
  const records = [], events = [], approvals = []
  const repository = {
    getRun: () => ({ projectId: 'book', modelRoutes: { agentProvider: 'claude' }, session: records.at(-1) }),
    upsertSession: input => { records.push({ ...records.at(-1), ...input }) },
    appendEvent: input => events.push(input),
    updateRun: () => {},
    completeApproval: (id, result) => approvals.push({ id, ...result }),
  }
  return { root, mirror, executablePath, repository, records, events, approvals,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function fakeQuery(messages, extras = {}) {
  return { async *[Symbol.asyncIterator]() { for (const message of messages) yield message }, close() {}, ...extras }
}
const init = { type: 'system', subtype: 'init', session_id: 'claude-session', model: 'test-model', claude_code_version: '2.1.92' }
const success = { type: 'result', subtype: 'success', session_id: 'claude-session', is_error: false,
  structured_output: { text: '候选' }, usage: { input_tokens: 10, output_tokens: 5 } }
const input = f => ({ agentRunId: 'run', agentStepId: 'step', messages: [{ role: 'user', content: '完整快照' }], outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  settings: { mirrorRoot: f.mirror, workspaceRoot: f.root, projectId: 'book', model: 'test-model' } })

test('Claude CLI discovery respects explicit paths and GUI known install directories', () => {
  const f = fixture()
  try {
    assert.equal(inspectClaudeRuntime({ configuredPath: f.executablePath, env: {} }).executablePath, f.executablePath)
    assert.equal(inspectClaudeRuntime({ configuredPath: path.join(f.root, 'missing'), env: { PATH: f.root } }).available, false)
    assert.equal(inspectClaudeRuntime({ env: { PATH: f.root, HOME: f.root } }).executablePath, f.executablePath)
    const bin = path.join(f.root, '.bun/bin'); fs.mkdirSync(bin, { recursive: true }); fs.copyFileSync(f.executablePath, path.join(bin, 'claude'))
    assert.equal(inspectClaudeRuntime({ env: { PATH: '', HOME: f.root } }).executablePath, path.join(bin, 'claude'))
  } finally { f.cleanup() }
})

test('Claude npm/bun symlinks use the current Node runtime instead of relying on a GUI PATH', () => {
  const f = fixture()
  try {
    const cli = path.join(f.root, 'cli.js')
    fs.writeFileSync(cli, '// synthetic CLI')
    const selected = path.join(f.root, 'selected-claude')
    fs.symlinkSync(cli, selected)
    const launch = claudeSdkLaunchOptions(selected, { execPath: '/synthetic/Novel Studio', electron: true })
    assert.equal(launch.pathToClaudeCodeExecutable, fs.realpathSync(cli))
    assert.equal(launch.executable, '/synthetic/Novel Studio')
    assert.deepEqual(launch.nodeEnvironment, { ELECTRON_RUN_AS_NODE: '1' })
    assert.deepEqual(claudeSdkLaunchOptions(f.executablePath, { electron: true }).nodeEnvironment, {})
    assert.deepEqual(claudeSdkLaunchOptions(selected, { electron: false }).nodeEnvironment, {})
  } finally { f.cleanup() }
})

test('Claude mirror boundary covers absolute/traversal/symlink reads and unknown tools', () => {
  const f = fixture()
  try {
    fs.writeFileSync(path.join(f.mirror, 'snapshot.json'), '{}')
    assert.equal(validateClaudeTool(f.mirror, 'Read', { file_path: 'snapshot.json' }), path.join(f.mirror, 'snapshot.json'))
    assert.throws(() => validateClaudeTool(f.mirror, 'Read', { file_path: '../secret' }))
    assert.throws(() => validateClaudeTool(f.mirror, 'Bash', { command: 'pwd' }))
    assert.throws(() => validateClaudeTool(f.mirror, 'Glob', { pattern: '../**/*' }))
    if (process.platform !== 'win32') {
      fs.symlinkSync(f.root, path.join(f.mirror, 'outside'))
      assert.throws(() => validateClaudeTool(f.mirror, 'Write', { file_path: 'outside/private.txt' }))
    }
  } finally { f.cleanup() }
})

test('Claude SDK streams once, returns schema output and resumes in the stable book workspace', async () => {
  const f = fixture(), requests = []
  const gateway = new ClaudeAgentGateway({ repository: f.repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }),
    queryFactory: async request => {
      requests.push(request)
      return fakeQuery([init,
        { type: 'stream_event', event: { delta: { type: 'text_delta', text: '{"text":"候选"}' } } },
        { type: 'assistant', message: { content: [{ type: 'text', text: '{"text":"候选"}' }] } }, success])
    } })
  try {
    const result = await gateway.prompt({ ...input(f), settings: { ...input(f).settings, reasoningEffort: 'high' } })
    assert.equal(result.backend, 'claude_sdk')
    assert.equal(result.content, '{"text":"候选"}')
    assert.deepEqual(result.structuredOutput, { text: '候选' })
    assert.equal(result.modelSnapshot.provider, 'claude')
    assert.equal(result.modelSnapshot.model, 'test-model')
    assert.equal(f.records[0].backend, 'claude_sdk')
    assert.equal(requests[0].options.cwd, fs.realpathSync(f.root))
    assert.deepEqual(requests[0].options.additionalDirectories, [fs.realpathSync(f.mirror)])
    assert.equal(requests[0].options.effort, 'high')
    assert.equal(result.modelSnapshot.reasoningEffort, 'high')
    assert.deepEqual(requests[0].options.settingSources, [])
    assert.deepEqual(requests[0].options.mcpServers, {})
    assert.equal(requests[0].options.permissionMode, 'default')
    assert.ok(!requests[0].options.tools.includes('Bash'))
    const next = await gateway.prompt({ ...input(f), continuationMessages: [{ role: 'user', content: '只发送修改要求' }] })
    assert.equal(next.contextReuse, 'delta')
    assert.equal(requests[1].options.resume, 'claude-session')
    assert.equal(requests[1].options.effort, 'high')
    let prompt = ''; for await (const message of requests[1].prompt) prompt += message.message.content
    assert.ok(prompt.includes('只发送修改要求')); assert.ok(!prompt.includes('完整快照'))
    assert.ok(f.events.some(event => event.type === 'text_delta'))
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('CLI authentication imports only allowlisted connection fields without loading user permissions', () => {
  const env = { HOME: '/synthetic', ANTHROPIC_API_KEY: 'inherited-api', ANTHROPIC_AUTH_TOKEN: 'inherited-token', CLAUDE_CODE_EFFORT_LEVEL: 'max' }
  const readFile = () => JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'fixture-login', ANTHROPIC_BASE_URL: 'https://gateway.example.invalid', NODE_OPTIONS: '--import malicious', PATH: '/untrusted' }, hooks: { PreToolUse: 'malicious' }, permissions: { defaultMode: 'bypassPermissions' } })
  const result = claudeQueryEnvironment({ env, readFile })
  assert.equal(result.ANTHROPIC_AUTH_TOKEN, 'fixture-login')
  assert.equal(result.ANTHROPIC_API_KEY, undefined)
  assert.equal(result.NODE_OPTIONS, undefined)
  assert.equal(result.PATH, undefined)
  assert.equal(result.DISABLE_PROMPT_CACHING, '1')
  assert.equal(result.CLAUDE_CODE_EFFORT_LEVEL, undefined)
  const official = claudeQueryEnvironment({ env: {}, readFile: () => JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } }) })
  assert.equal(official.DISABLE_PROMPT_CACHING, undefined)
  const api = claudeQueryEnvironment({ env, authMethod: 'environment', readFile: () => assert.fail('API mode must not read user settings') })
  assert.equal(api.ANTHROPIC_API_KEY, 'inherited-api')
  assert.equal(api.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'inherited-token')
  assert.equal(normalizeClaudeEffort('xhigh'), 'xhigh')
  assert.throws(() => normalizeClaudeEffort('ultra'))
})

test('Claude rejects cross-book workspace changes and mismatched book descriptors', async () => {
  const f = fixture()
  const gateway = new ClaudeAgentGateway({ settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: () => fakeQuery([init, success]) })
  try {
    fs.writeFileSync(path.join(f.root, '.novel-studio-project.json'), JSON.stringify({ projectId: 'wrong-book' }))
    await assert.rejects(gateway.prompt(input(f)), /与书籍不匹配/)
    fs.writeFileSync(path.join(f.root, '.novel-studio-project.json'), JSON.stringify({ projectId: 'book' }))
    await gateway.prompt(input(f))
    await assert.rejects(gateway.prompt({ ...input(f), settings: { ...input(f).settings, workspaceRoot: f.mirror } }), /书籍项目发生变化/)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude tools always run through mirror hooks and per-write approval', async () => {
  const f = fixture(); let options
  const gateway = new ClaudeAgentGateway({ repository: f.repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: async request => {
    options = request.options
    const hook = options.hooks.PreToolUse[0].hooks[0]
    const denied = await hook({ tool_name: 'Read', tool_input: { file_path: '../private' } })
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
    const allowed = await hook({ tool_name: 'Write', tool_input: { file_path: 'candidate.txt', content: '候选' }, tool_use_id: 'w1' })
    assert.equal(allowed.hookSpecificOutput.permissionDecision, 'allow')
    assert.equal((await options.canUseTool('Bash', {})).behavior, 'deny')
    assert.equal((await options.canUseTool('Read', { file_path: '../private' })).behavior, 'deny')
    assert.equal((await options.canUseTool('StructuredOutput', { text: '候选' })).behavior, 'allow')
    assert.equal((await hook({ tool_name: 'StructuredOutput', tool_input: { text: '候选' } })).hookSpecificOutput.permissionDecision, 'allow')
    return fakeQuery([init, success])
  } })
  const approvals = []
  gateway._requestApproval = async item => { approvals.push(item); return { id: `approval-${approvals.length}` } }
  try {
    await gateway.prompt(input(f))
    assert.deepEqual(approvals.map(a => a.actionType), ['model_call', 'file'])
    assert.equal(fs.existsSync(path.join(f.mirror, 'candidate.txt')), false)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude cancellation settles approvals even before subprocess starts', async () => {
  const f = fixture(), controller = new AbortController()
  let created = false
  const gateway = new ClaudeAgentGateway({ repository: { ...f.repository, createApproval: () => ({ id: 'pending' }), resolveApproval: () => ({}) },
    settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: () => { created = true } })
  try {
    const pending = gateway.prompt({ ...input(f), signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: 'CodexCancelledError' })
    assert.equal(created, false)
    assert.equal(gateway.pendingApprovals.size, 0)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude partial/error results stay on Claude and never fall back to another provider', async () => {
  const f = fixture()
  const gateway = new ClaudeAgentGateway({ repository: f.repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }),
    queryFactory: () => fakeQuery([init, { type: 'stream_event', event: { delta: { type: 'text_delta', text: '部分正文' } } }, { type: 'result', subtype: 'error_max_turns', is_error: true }]) })
  try {
    await assert.rejects(gateway.prompt(input(f)), error => {
      assert.equal(error.codexPartialResult.backend, 'claude_sdk')
      assert.equal(error.codexPartialResult.content, '部分正文')
      assert.equal(error.codexPartialResult.fallbackFrom, '')
      return true
    })
    assert.equal(f.records.at(-1).status, 'failed')
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude distinguishes service balance errors from login errors and creates no successful result', async () => {
  const message = { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Failed to authenticate. API Error: 403 {"error":{"message":"insufficient balance","type":"billing_error"}}' }
  assert.equal(claudeResultError(message).code, 'CLAUDE_BILLING_LIMIT')
  assert.match(claudeResultError(message).message, /余额不足/)
  const f = fixture()
  const gateway = new ClaudeAgentGateway({ settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: () => fakeQuery([init, message]) })
  try {
    await assert.rejects(gateway.prompt(input(f)), error => {
      assert.equal(error.code, 'CLAUDE_BILLING_LIMIT')
      assert.equal(error.codexPartialResult.fallbackFrom, '')
      return true
    })
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude diagnostic reads model/auth metadata without submitting a prompt or persisting identity', async () => {
  const f = fixture(); let request, closed = false
  const gateway = new ClaudeAgentGateway({ repository: f.repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: input => {
    request = input
    return fakeQuery([], { supportedModels: async () => [{ value: 'new-model', displayName: 'New Model' }], accountInfo: async () => ({ email: 'private@example.invalid', subscriptionType: 'max' }), close: () => { closed = true } })
  } })
  try {
    const result = await gateway.testConnection({ cwd: f.mirror })
    assert.equal(result.models[0].value, 'new-model')
    assert.equal(closed, true)
    assert.equal(JSON.stringify(result).includes('private@example.invalid'), false)
    assert.equal(f.records.length, 0)
    for await (const message of request.prompt) assert.fail(`unexpected prompt ${message}`)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude diagnostic rejects the explicit none credential source and releases the subprocess', async () => {
  const f = fixture(); let closed = false
  const gateway = new ClaudeAgentGateway({ settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: () => fakeQuery([], {
    supportedModels: async () => [], accountInfo: async () => ({ apiKeySource: 'none', tokenSource: 'none', apiProvider: 'firstParty' }), close: () => { closed = true },
  }) })
  try {
    await assert.rejects(gateway.testConnection({ cwd: f.mirror }), /尚未登录/)
    assert.equal(closed, true)
    assert.equal(gateway.diagnostics.size, 0)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude diagnostic has a bounded timeout even if a metadata request stalls', async () => {
  const f = fixture(); let closed = false
  const gateway = new ClaudeAgentGateway({ diagnosticTimeoutMs: 20, settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: () => fakeQuery([], {
    supportedModels: () => new Promise(() => {}), accountInfo: async () => ({}), close: () => { closed = true },
  }) })
  try {
    await assert.rejects(gateway.testConnection({ cwd: f.mirror }), /超时/)
    assert.equal(closed, true); assert.equal(gateway.diagnostics.size, 0)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude resumes persisted Claude sessions with full recovery context but rejects foreign session IDs', async () => {
  const f = fixture(); let options
  const repository = { ...f.repository, getRun: () => ({ modelRoutes: { agentProvider: 'claude' }, session: { backend: 'claude_sdk', sessionId: 'persisted-session' } }) }
  const gateway = new ClaudeAgentGateway({ repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: request => { options = request.options; return fakeQuery([init, success]) } })
  try {
    const result = await gateway.prompt({ ...input(f), continuationMessages: [{ role: 'user', content: 'delta' }] })
    assert.equal(options.resume, 'persisted-session')
    assert.equal(result.contextReuse, 'full')
    await gateway.closeSession('run')
    repository.getRun = () => ({ session: { backend: 'codex_acp', sessionId: 'foreign-session' } })
    await assert.rejects(gateway.prompt(input(f)), /提供方不匹配/)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude runtime changes only apply to new runs, never to a resumed active run', async () => {
  const f = fixture(), paths = []
  const gateway = new ClaudeAgentGateway({ repository: f.repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }), queryFactory: request => { paths.push(request.options.pathToClaudeCodeExecutable); return fakeQuery([init, success]) } })
  try {
    await gateway.prompt(input(f))
    gateway.useConfiguredPath('/missing-new-cli')
    await gateway.prompt(input(f))
    assert.deepEqual(paths, [fs.realpathSync(f.executablePath), fs.realpathSync(f.executablePath)])
    await assert.rejects(gateway.prompt({ ...input(f), agentRunId: 'new-run' }), /CLI 未找到/)
  } finally { await gateway.shutdown(); f.cleanup() }
})

test('Claude provider routes, labels and defaults remain distinct from Codex and Qoder', async () => {
  assert.equal(normalizeAgentProvider('claude'), 'claude')
  assert.equal(agentProviderLabel('claude'), 'Claude Code')
  assert.equal(creativeBackendLabel('claude_sdk'), 'Claude Code SDK')
  assert.equal(creativeAgentLabel('qoder'), 'Qoder')
  assert.equal(agentProviderModel({ agentProvider: 'claude', claudeModel: 'claude-test', model: 'codex-test' }), 'claude-test')
  assert.equal(agentProviderReasoningEffort({ agentProvider: 'claude', claudeReasoningEffort: 'medium', reasoningEffort: 'xhigh' }), 'medium')
  assert.equal(agentProviderReasoningEffort({ agentProvider: 'claude', reasoningEffort: 'high' }), '')
  assert.equal(creativeRoutePresentation({ project: { default_execution_mode: 'codex' }, agentProvider: 'claude' }).name, 'Claude Code')
  const calls = []
  const router = new AgentGatewayRouter({ repository: { agentProviderForRun: () => 'claude' },
    claude: { prompt: input => calls.push(['prompt', input.agentRunId]), cancelTurn: id => calls.push(['cancel', id]), closeSession: id => calls.push(['close', id]) } })
  await router.prompt({ agentRunId: 'r', settings: {} }); await router.cancelTurn('r'); await router.closeSession('r')
  assert.deepEqual(calls, [['prompt', 'r'], ['cancel', 'r'], ['close', 'r']])
})

test('v34 upgrades existing Qoder/Codex preferences and sessions without losing data', () => {
  const db = new DatabaseSync(':memory:')
  try {
    runMigrations(db, { targetVersion: 33 })
    db.prepare("UPDATE agent_provider_settings SET agent_provider='qoder', qoder_model='q-custom', model='codex-custom', qoder_cli_path='/qoder' WHERE id='codex'").run()
    db.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES('p','fixture','','','','now','now')").run()
    db.prepare("INSERT INTO agent_runs(id,project_id,workflow_id,execution_mode,status,creative_pack_id,creative_pack_version,creative_pack_digest,created_at,updated_at) SELECT 'r','p','inline-action','codex','completed',pack_id,version,digest,'now','now' FROM creative_pack_versions LIMIT 1").run()
    db.prepare("INSERT INTO agent_sessions(id,agent_run_id,backend,session_id,status,created_at,updated_at) VALUES('s','r','qoder_acp','old-session','active','now','now')").run()
    runMigrations(db)
    const repository = createCodexRepository(db)
    const before = repository.getProviderSettings()
    assert.equal(before.agentProvider, 'qoder'); assert.equal(before.model, 'codex-custom'); assert.equal(before.qoderModel, 'q-custom')
    const after = repository.updateProviderSettings({ agentProvider: 'claude', claudeCliPath: ' /claude ', claudeModel: ' opus ', claudeAuthMethod: 'environment', claudeReasoningEffort: 'max' })
    assert.equal(after.claudeReasoningEffort, 'max')
    assert.equal(repository.updateProviderSettings({ reasoningEffort: 'low' }).claudeReasoningEffort, 'max')
    assert.throws(() => repository.updateProviderSettings({ claudeReasoningEffort: 'ultra' }))
    assert.equal(after.agentProvider, 'claude'); assert.equal(after.claudeModel, 'opus'); assert.equal(after.claudeCliPath, '/claude'); assert.equal(after.claudeAuthMethod, 'environment')
    assert.equal(after.qoderModel, 'q-custom'); assert.equal(after.model, 'codex-custom')
    const session = db.prepare("SELECT * FROM agent_sessions WHERE id='s'").get()
    assert.equal(session.backend, 'qoder_acp'); assert.equal(session.session_id, 'old-session')
    db.prepare("UPDATE agent_sessions SET backend='claude_sdk' WHERE id='s'").run()
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    runMigrations(db)
    assert.equal(repository.getProviderSettings().agentProvider, 'claude')
  } finally { db.close() }
})

test('all inline creative task kinds pass through the real runtime/router/repository to Claude candidates only', async () => {
  const db = new DatabaseSync(':memory:'), f = fixture()
  runMigrations(db)
  db.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES('p','虚构联调样本','悬疑','来信','','now','now')").run()
  db.prepare("INSERT INTO chapters(id,project_id,chapter_no,title,status,card_json,scene_plan,manuscript,updated_at) VALUES('c','p',1,'来信','draft','{}','','原始正文','now')").run()
  db.prepare("INSERT INTO planning_documents(project_id,kind,content_json,created_at,updated_at) VALUES('p','foundation','{}','now','now')").run()
  db.prepare("INSERT INTO generation_records(id,task_id,project_id,chapter_id,task,status,output_text,created_at) VALUES('synthetic-source','synthetic-task','p','c','chapter','completed','原始正文','now')").run()
  db.prepare("INSERT INTO story_change_sets(id,project_id,root_target_key,source_digest,created_at,updated_at) VALUES('synthetic-change','p','foundation:premise','source','now','now')").run()
  db.prepare("INSERT INTO project_pack_bindings(id,project_id,pack_id,pack_version,bound_at,updated_at) SELECT 'b','p',pack_id,version,'now','now' FROM creative_pack_versions WHERE version='1.3.0' LIMIT 1").run()
  const repository = createCodexRepository(db), calls = [], applied = []
  let payload
  const gateway = new ClaudeAgentGateway({ repository, settingsProvider: () => ({ claudeCliPath: f.executablePath }), shouldAutoApprove: () => true,
    queryFactory: request => { calls.push(request); return fakeQuery([{ ...init, session_id: `session-${calls.length}` }, { ...success, structured_output: payload }]) } })
  const router = new AgentGatewayRouter({ repository, claude: gateway })
  const runtime = new AgentRuntime({ repository, codexGateway: router,
    createMirror: async run => { const root = path.join(f.mirror, run.id); fs.mkdirSync(root, { recursive: true }); return { root, sourceDigest: 'source' } },
    prepareCodexPrompt: async ({ run }) => ({ messages: [{ role: 'user', content: '虚构创作任务' }], agentProvider: run.modelRoutes.agentProvider, outputSchema: { type: 'object' } }),
    runPreflight: async () => ({ blocked: false }), currentSourceDigest: async () => 'source', applyCandidate: async input => applied.push(input),
  })
  const card = { goal: '取得来信', protagonistGoal: '查清来历', resistance: '寄件人失联', turningPoint: '发现暗号', payoff: '锁定车站', ending: '抵达车站', cost: '错过约定', requiredScenes: [{ id: 's', title: '取信', goal: '查证', result: '找到暗号' }] }
  const scene = { schemaVersion: 1, summary: '取信查证', legacyNotes: '', scenes: [{ id: 's', title: '取信', pov: '主角', time: '夜', location: '楼下', presentCharacters: ['主角'], entryState: '收到通知', goal: '取信', obstacle: '门禁', actionBeats: ['找到钥匙', '打开信箱'], turn: '信上有暗号', exitState: '前往车站', knowledgeChanges: ['暗号指向车站'], continuityRisks: [] }] }
  const cases = [
    { task: 'planning_field', target: { kind: 'planning_document', targetId: 'foundation', fieldKey: 'premise' }, payload: { text: '来信引出调查' } },
    { task: 'planning_field', target: { kind: 'planning_document_bundle', targetId: 'foundation', fieldKeys: ['premise', 'coreConflict'] }, payload: { fields: { premise: '来信引出调查', coreConflict: '证人失联' } } },
    { task: 'chapter_card', target: { kind: 'chapter_card', targetId: 'c' }, payload: card },
    { task: 'scene_plan', target: { kind: 'scene_plan', targetId: 'c' }, payload: scene },
    { task: 'chapter', target: { kind: 'manuscript', targetId: 'c' }, payload: { manuscript: '主角推开门，去楼下取信。' } },
    { task: 'rewrite', target: { kind: 'manuscript_selection', targetId: 'c', selectionFrom: 0, selectionTo: 2 }, payload: { text: '改写' } },
    { task: 'chapter', intent: 'repair', target: { kind: 'manuscript', targetId: 'c', zhuqueDigest: 'a'.repeat(64) }, payload: { manuscript: '主角把信翻过来，又看了一遍。' } },
    { task: 'chapter_state_extract', target: { kind: 'chapter_state', targetId: 'c' }, payload: { summary: '主角取得来信', facts: [] } },
    { task: 'continuity_audit', target: { kind: 'continuity_audit', targetId: 'c' }, payload: { issues: [], summary: '样本一致' } },
    { task: 'quality_review', target: { kind: 'quality_review', targetId: 'c', sourceGenerationId: 'synthetic-source' }, payload: { scores: {}, issues: [], summary: '样本报告' } },
    { task: 'story_change', intent: 'analysis', target: { kind: 'story_change_set', targetId: 'synthetic-change' }, payload: { summary: '调整前提', items: [{ targetKey: 'foundation:premise', after: '新前提', impactLevel: 'suggested' }] } },
  ]
  try {
    for (const item of cases) {
      payload = item.payload
      const started = await runtime.startInline({ ...item, payload: undefined, projectId: 'p', chapterId: 'c', executionMode: 'codex', freshStart: true, modelRoutes: { agentProvider: 'claude' } })
      await runtime.advance(started.id)
      const run = repository.getRun(started.id)
      assert.equal(run.status, 'waiting_confirmation', `${item.task}: ${run.error}`)
      assert.equal(run.actualBackend, 'claude_sdk')
      assert.equal(run.session.backend, 'claude_sdk')
      assert.equal(run.candidates.length, 1)
      assert.equal(run.candidates[0].status, 'pending')
      assert.equal(run.candidates[0].evidence.executionBackend, 'claude_sdk')
    }
    assert.equal(calls.length, cases.length)
    assert.equal(applied.length, 0)
    assert.equal(db.prepare("SELECT manuscript FROM chapters WHERE id='c'").get().manuscript, '原始正文')
    const last = repository.listRuns({ projectId: 'p' }).find(run => run.workflowId === 'inline-action')
    assert.ok(last)
  } finally { await gateway.shutdown(); db.close(); f.cleanup() }
})
