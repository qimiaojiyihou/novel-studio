import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AgentGatewayRouter } from '../electron/agent-gateway-router.js'
import { QoderAgentGateway, inspectQoderRuntime, qoderExecutableCandidates } from '../electron/qoder-agent-gateway.js'

function executableFixture(name = process.platform === 'win32' ? 'qoder.exe' : 'qoder') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-qoder-'))
  const executablePath = path.join(root, name)
  fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(executablePath, 0o700)
  return { root, executablePath }
}

test('Qoder runtime prefers an explicit executable and detects PATH installations', () => {
  const fixture = executableFixture()
  try {
    const explicit = inspectQoderRuntime({ configuredPath: fixture.executablePath, env: { PATH: '' } })
    assert.equal(explicit.available, true)
    assert.equal(explicit.source, 'configured')
    assert.equal(explicit.executablePath, fixture.executablePath)

    const detected = inspectQoderRuntime({ env: { PATH: fixture.root, HOME: fixture.root } })
    assert.equal(detected.available, true)
    assert.equal(detected.source, 'detected')
    assert.ok(qoderExecutableCandidates({ env: { PATH: fixture.root, HOME: fixture.root } }).includes(fixture.executablePath))
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Qoder runtime detects the Qoder CLI CN command names and install entry directory', () => {
  const fixture = executableFixture(process.platform === 'win32' ? 'qodercn.cmd' : 'qodercn')
  try {
    const pathDetected = inspectQoderRuntime({ env: { PATH: fixture.root, HOME: fixture.root } })
    assert.equal(pathDetected.executablePath, fixture.executablePath)

    if (process.platform !== 'win32') {
      const cnHome = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-qoder-cn-home-'))
      try {
        const entryDirectory = path.join(cnHome, '.qoder-cn', 'entry')
        fs.mkdirSync(entryDirectory, { recursive: true })
        const entry = path.join(entryDirectory, 'qodercn')
        fs.copyFileSync(fixture.executablePath, entry)
        fs.chmodSync(entry, 0o700)
        const knownDirectoryDetected = inspectQoderRuntime({ env: { PATH: '', HOME: cnHome } })
        assert.equal(knownDirectoryDetected.executablePath, entry)
      } finally {
        fs.rmSync(cnHome, { recursive: true, force: true })
      }
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('Qoder uses the native ACP session, preserves the mirror boundary, and records qoder_acp', async () => {
  const fixture = executableFixture()
  const mirrorRoot = path.join(fixture.root, 'mirror')
  const workspaceRoot = path.join(fixture.root, 'book')
  fs.mkdirSync(mirrorRoot)
  fs.mkdirSync(workspaceRoot)
  let handlers
  let sessionRecord
  const configRequests = []
  const qoderConfigOptions = [{
    type: 'select', id: 'model', name: 'Model', currentValue: 'auto',
    options: [
      { value: 'auto', name: 'Auto' },
      { value: 'qmodel_38max', name: 'Qwen3.8-Max' },
    ],
  }]
  const connection = {
    initialize: async () => ({
      protocolVersion: 1,
      agentInfo: { name: 'qoder', version: '2.3.4' },
      agentCapabilities: { sessionCapabilities: { close: {} } },
      authMethods: [],
    }),
    newSession: async (request) => {
      assert.equal(request.cwd, workspaceRoot)
      assert.deepEqual(request.additionalDirectories, [mirrorRoot])
      return { sessionId: 'qoder-session-1', configOptions: structuredClone(qoderConfigOptions) }
    },
    setSessionConfigOption: async (request) => {
      configRequests.push(request)
      return { configOptions: qoderConfigOptions.map((option) => option.id === request.configId ? { ...option, currentValue: request.value } : option) }
    },
    prompt: async ({ sessionId }) => {
      await handlers.sessionUpdate({
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"text":"Qoder 候选"}' } },
      })
      return { stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } }
    },
    closeSession: async () => ({}),
    cancel: async () => ({}),
  }
  const gateway = new QoderAgentGateway({
    appPath: process.cwd(),
    resourcesPath: process.cwd(),
    settingsProvider: () => ({ qoderCliPath: fixture.executablePath, qoderModel: 'qmodel_38max' }),
    repository: { upsertSession: (input) => { sessionRecord = input } },
    connectionFactory: async (input) => { handlers = input.handlers; return connection },
  })
  gateway.runExecFallback = async () => { throw new Error('Qoder must not use Codex exec fallback') }
  try {
    const result = await gateway.prompt({
      agentRunId: 'run-qoder',
      agentStepId: 'step-qoder',
      messages: [{ role: 'user', content: '生成候选' }],
      settings: { agentProvider: 'qoder', mirrorRoot, workspaceRoot },
    })
    assert.equal(result.backend, 'qoder_acp')
    assert.deepEqual(result.structuredOutput, { text: 'Qoder 候选' })
    assert.equal(result.modelSnapshot.provider, 'qoder')
    assert.equal(result.modelSnapshot.model, 'qmodel_38max')
    assert.equal(result.modelSnapshot.modelName, 'Qwen3.8-Max')
    assert.deepEqual(configRequests, [{ sessionId: 'qoder-session-1', configId: 'model', value: 'qmodel_38max' }])
    assert.equal(sessionRecord.backend, 'qoder_acp')
    assert.equal(fs.existsSync(path.join(workspaceRoot, '.novel-studio-codex-registered')), false)
    assert.equal(gateway.inspectRuntime().cliVersion, '2.3.4')
  } finally {
    await gateway.shutdown()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('agent gateway router locks each run to its selected ACP provider', async () => {
  const calls = []
  const gateway = (name) => ({
    pendingApprovals: new Map(),
    prompt: async (input) => { calls.push([name, input.agentRunId]); return { backend: `${name}_acp` } },
    cancelTurn: async (runId) => calls.push([`${name}:cancel`, runId]),
    closeSession: async (runId) => calls.push([`${name}:close`, runId]),
    shutdown: async () => {},
  })
  const runs = new Map([
    ['qoder-run', { modelRoutes: { agentProvider: 'qoder' } }],
    ['legacy-run', { modelRoutes: {} }],
  ])
  const router = new AgentGatewayRouter({
    repository: { getRun: (id) => runs.get(id) },
    codex: gateway('codex'),
    qoder: gateway('qoder'),
  })
  assert.equal((await router.prompt({ agentRunId: 'qoder-run', settings: {} })).backend, 'qoder_acp')
  assert.equal((await router.prompt({ agentRunId: 'legacy-run', settings: {} })).backend, 'codex_acp')
  await router.cancelTurn('qoder-run')
  await router.closeSession('legacy-run')
  assert.deepEqual(calls, [
    ['qoder', 'qoder-run'],
    ['codex', 'legacy-run'],
    ['qoder:cancel', 'qoder-run'],
    ['codex:close', 'legacy-run'],
  ])
})
