import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { GrokAgentGateway, inspectGrokRuntime } from '../electron/grok-agent-gateway.js'
import { AgentGatewayRouter, agentRunSettings } from '../electron/agent-gateway-router.js'
import { createCodexBookWorkspace, createCodexProjectMirror } from '../electron/codex-project-mirror.js'
import { runMigrations } from '../electron/database-migrations.js'
import { createCodexRepository } from '../electron/codex-repository.js'

const config = () => [
  { id: 'model', type: 'select', name: 'Model', currentValue: 'grok-a', options: [{ value: 'grok-a', name: 'Grok A' }, { value: 'grok-b', name: 'Grok B' }] },
  { id: 'reasoning_effort', type: 'select', name: 'Effort', currentValue: 'medium', options: ['low','medium','high'].map(value => ({ value, name: value })) },
]
function fixture(t, { authenticated = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-gateway-'))
  const executablePath = path.join(root, 'grok')
  fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n'); fs.chmodSync(executablePath, 0o700)
  const mirrorRoot = path.join(root, 'mirror'), workspaceRoot = path.join(root, 'book')
  fs.mkdirSync(mirrorRoot); fs.mkdirSync(workspaceRoot)
  const calls = [], records = []
  let handlers, sequence = 0
  const sessions = new Map()
  const connection = {
    initialize: async () => ({ protocolVersion: 1, agentInfo: { name: 'grok', version: '1.fixture' }, authMethods: [{ id: authenticated ? 'cached_token' : 'grok.com' }], agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } } }),
    authenticate: async input => { calls.push(['authenticate', input]); return {} },
    newSession: async input => { const sessionId = `session-${++sequence}`; calls.push(['new', input]); sessions.set(sessionId, config()); return { sessionId, configOptions: structuredClone(sessions.get(sessionId)) } },
    loadSession: async input => { calls.push(['load', input]); return { configOptions: config() } },
    setSessionConfigOption: async input => {
      calls.push(['config', input]); const options = sessions.get(input.sessionId)
      const selected = options.find(o => o.id === input.configId); selected.currentValue = input.value
      if (input.value === 'grok-b') options.find(o => o.id === 'reasoning_effort').options = [{ value: 'low', name: 'Low' }]
      return { configOptions: structuredClone(options) }
    },
    prompt: async ({ sessionId }) => { calls.push(['prompt', sessionId]); await handlers.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"text":"Grok 候选"}' } } }); return { stopReason: 'end_turn' } },
    closeSession: async input => { calls.push(['close', input]); return {} }, cancel: async input => { calls.push(['cancel', input]); return {} },
  }
  const gateway = new GrokAgentGateway({ settingsProvider: () => ({ grokCliPath: executablePath }), repository: { upsertSession: input => records.push(input) },
    connectionFactory: async input => { handlers = input.handlers; return connection }, shouldAutoApprove: () => true })
  const prompt = (extra = {}) => gateway.prompt({ agentRunId: 'run', agentStepId: 'step', messages: [{ role: 'user', content: '虚构验证' }], settings: { mirrorRoot, workspaceRoot, model: 'grok-a', reasoningEffort: 'high' }, ...extra })
  t.after(async () => { await gateway.shutdown(); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, executablePath, mirrorRoot, workspaceRoot, calls, records, connection, gateway, prompt }
}

test('detects official Grok installation and honors explicit missing paths instead of changing executors', t => {
  const f = fixture(t)
  assert.equal(inspectGrokRuntime({ configuredPath: f.executablePath }).available, true)
  assert.equal(inspectGrokRuntime({ configuredPath: path.join(f.root, 'missing'), env: { PATH: f.root } }).available, false)
  const directory = path.join(f.root, '.grok/bin'); fs.mkdirSync(directory, { recursive: true }); fs.copyFileSync(f.executablePath, path.join(directory, 'grok'))
  assert.equal(inspectGrokRuntime({ env: { HOME: f.root, PATH: '' } }).executablePath, path.join(directory, 'grok'))
  assert.equal(inspectGrokRuntime({ configuredPath: '~/.grok/bin/grok', env: { HOME: f.root } }).available, true)
})

test('uses cached login, applies and reads back model/effort, and restricts file access to the current mirror', async t => {
  const f = fixture(t)
  const result = await f.prompt()
  assert.equal(result.backend, 'grok_acp'); assert.deepEqual(result.structuredOutput, { text: 'Grok 候选' })
  assert.equal(result.modelSnapshot.model, 'grok-a'); assert.equal(result.modelSnapshot.reasoningEffort, 'high')
  assert.deepEqual(f.calls.find(c => c[0] === 'authenticate')[1], { methodId: 'cached_token', _meta: { headless: true } })
  assert.deepEqual(f.calls.find(c => c[0] === 'new')[1], { cwd: f.workspaceRoot, additionalDirectories: [f.mirrorRoot], mcpServers: [] })
  assert.equal(f.records[0].backend, 'grok_acp')
  await assert.rejects(f.gateway._readTextFile({ sessionId: result.sessionId, path: path.join(f.root, 'other-book.txt') }), /镜像/)
  await f.gateway.cancelTurn('run'); assert.ok(f.calls.some(c => c[0] === 'cancel'))
})

test('missing local login does not start browser auth, use API credentials, or send a prompt', async t => {
  const f = fixture(t, { authenticated: false })
  await assert.rejects(f.prompt(), /grok login/)
  assert.deepEqual(f.calls, [])
})

test('model changes revalidate effort and mismatched readback stops generation with no fallback', async t => {
  const f = fixture(t)
  await assert.rejects(f.prompt({ settings: { mirrorRoot: f.mirrorRoot, workspaceRoot: f.workspaceRoot, model: 'grok-b', reasoningEffort: 'high' } }), /未声明支持/)
  assert.equal(f.calls.some(c => c[0] === 'prompt'), false)
  f.connection.setSessionConfigOption = async () => ({ configOptions: config() })
  await assert.rejects(f.prompt(), /回读不匹配/)
  assert.equal(f.calls.some(c => c[0] === 'prompt'), false)
})

test('diagnostic model/effort discovery closes its disposable session and never sends a model prompt', async t => {
  const f = fixture(t)
  const result = await f.gateway.testConnection({ cwd: f.workspaceRoot, model: 'grok-a', reasoningEffort: 'low' })
  assert.equal(result.selected.reasoningEffort, 'low'); assert.equal(result.runtime.cliVersion, '1.fixture')
  assert.equal(f.calls.some(c => c[0] === 'prompt'), false)
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1)
  assert.equal(f.gateway.sessions.size, 0)
})

test('switching Codex/Grok closes the former executor and cancel targets the current session owner', async () => {
  const calls = [], codex = { sessions: new Map([['run', {}]]), closeSession: async id => { calls.push('close-codex'); codex.sessions.delete(id) }, cancelTurn: async () => calls.push('cancel-codex') }
  const grok = { sessions: new Map(), prompt: async input => { grok.sessions.set(input.agentRunId, {}); calls.push('prompt-grok') }, cancelTurn: async () => calls.push('cancel-grok'), closeSession: async () => calls.push('close-grok') }
  const router = new AgentGatewayRouter({ repository: { agentProviderForRun: () => 'codex' }, codex, grok })
  await router.prompt({ agentRunId: 'run', settings: { agentProvider: 'grok' } }); await router.cancelTurn('run'); await router.closeSession('run')
  assert.deepEqual(calls, ['close-codex','prompt-grok','cancel-grok','close-grok'])
  const locked = agentRunSettings({ agentProvider: 'grok', grokModel: 'grok-future', grokReasoningEffort: 'xhigh', model: 'gpt-old', fastMode: true })
  assert.equal(locked.codexModel, 'grok-future'); assert.equal(locked.codexReasoningEffort, 'xhigh'); assert.equal(locked.codexAuthMethod, 'cached_token'); assert.equal(locked.codexFastMode, false)
})

test('books and runs use separate Grok directories while a renamed book keeps its identity', t => {
  const f = fixture(t), project = { id: 'book-a', title: '同名故事' }
  const a = createCodexBookWorkspace({ baseDirectory: f.root, project, provider: 'grok' })
  const b = createCodexBookWorkspace({ baseDirectory: f.root, project: { ...project, id: 'book-b' }, provider: 'grok' })
  assert.notEqual(a.root, b.root); assert.equal(path.basename(path.dirname(a.root)), 'grok-projects')
  assert.equal(createCodexBookWorkspace({ baseDirectory: f.root, project: { ...project, title: '新书名' }, provider: 'grok' }).root, a.root)
  const make = id => createCodexProjectMirror({ baseDirectory: f.root, agentRun: { id, modelRoutes: { agentProvider: 'grok' } }, workspace: { project, chapters: [] } })
  const one=make('run-one'), two=make('run-two'); assert.equal(one.workspaceRoot,two.workspaceRoot); assert.notEqual(one.root,two.root)
})

test('v37 preserves existing settings and sessions, supports Grok, and is repeatable', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); runMigrations(db, { targetVersion: 36 })
  db.prepare("UPDATE agent_provider_settings SET agent_provider='claude',claude_model='opus',claude_reasoning_effort='max',qoder_model='q-custom' WHERE id='codex'").run()
  db.prepare("INSERT INTO projects(id,title,genre,idea,style,created_at,updated_at) VALUES('legacy','旧书','','','','now','now')").run()
  db.prepare("INSERT INTO agent_runs(id,project_id,workflow_id,execution_mode,status,creative_pack_id,creative_pack_version,creative_pack_digest,created_at,updated_at) SELECT 'old-run','legacy','inline-action','codex','completed',pack_id,version,digest,'now','now' FROM creative_pack_versions LIMIT 1").run()
  db.prepare("INSERT INTO agent_sessions(id,agent_run_id,backend,session_id,status,auth_method,created_at,updated_at) VALUES('old-session','old-run','claude_sdk','retained-session','closed','claude-login','now','now')").run()
  runMigrations(db); const repository = createCodexRepository(db)
  const retained = db.prepare("SELECT session_id,backend,auth_method FROM agent_sessions WHERE id='old-session'").get()
  assert.deepEqual({...retained},{session_id:'retained-session',backend:'claude_sdk',auth_method:'claude-login'})
  db.prepare("UPDATE agent_sessions SET backend='grok_acp' WHERE id='old-session'").run()
  assert.equal(repository.getProviderSettings().claudeReasoningEffort, 'max')
  const saved = repository.updateProviderSettings({ agentProvider: 'grok', grokModel: ' grok-future ', grokReasoningEffort: 'high', grokCliPath: ' /test/grok ' })
  assert.equal(saved.grokModel, 'grok-future'); assert.equal(saved.claudeModel,'opus'); assert.equal(saved.qoderModel,'q-custom'); assert.equal(saved.grokCliPath,'/test/grok')
  runMigrations(db); assert.equal(repository.getProviderSettings().agentProvider,'grok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('a persisted session from a different executor is recreated instead of loading foreign context', async t => {
  const f = fixture(t)
  const session = await f.gateway.resumeSession({ agentRunId: 'run', mirrorRoot: f.mirrorRoot, workspaceRoot: f.workspaceRoot,
    persistedSession: { sessionId: 'codex-context', backend: 'codex_acp' } })
  assert.notEqual(session.sessionId,'codex-context'); assert.equal(f.calls.some(c => c[0] === 'load'), false)
})

test('a different collaborative stage gets fresh defaults instead of inheriting the prior stage model/effort', async t => {
  const f = fixture(t)
  const settings={mirrorRoot:f.mirrorRoot,workspaceRoot:f.workspaceRoot}
  const one=await f.prompt({settings:{...settings,collaborativeStage:'writing',model:'grok-a',reasoningEffort:'high'}})
  const two=await f.prompt({settings:{...settings,collaborativeStage:'repair',model:'',reasoningEffort:''}})
  assert.notEqual(one.sessionId,two.sessionId)
  assert.equal(two.modelSnapshot.reasoningEffort,'medium')
  assert.ok(f.calls.some(c=>c[0]==='close' && c[1].sessionId===one.sessionId))
})
