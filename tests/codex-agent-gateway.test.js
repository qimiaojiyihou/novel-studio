import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CodexAgentGateway, safeToolLocations } from '../electron/codex-agent-gateway.js'

function createFakeGateway({ promptBehavior, repository, onGlobalEvent, shouldAutoApprove, onNewSession, sessionOptions = [], archiveSupported = false } = {}) {
  let handlers
  let newSessionCount = 0
  const newSessionRequests = []
  const promptRequests = []
  const connection = {
    initialize: async () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, ...(archiveSupported ? { delete: {} } : {}) } },
      authMethods: [{ id: 'chat-gpt' }, { id: 'api-key' }],
    }),
    authenticate: async () => ({}),
    newSession: async (request) => {
      onNewSession?.(request)
      newSessionRequests.push(request)
      return { sessionId: `session-${++newSessionCount}`, configOptions: structuredClone(sessionOptions) }
    },
    resumeSession: async () => ({}),
    loadSession: async () => ({}),
    closeSession: async () => ({}),
    deleteSession: async () => ({}),
    cancel: async () => ({}),
    prompt: async (request) => {
      promptRequests.push(request)
      if (promptBehavior) return promptBehavior({ request, handlers })
      await handlers.sessionUpdate({
        sessionId: request.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"goal":"进入医院"}' } },
      })
      return { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
  const gateway = new CodexAgentGateway({
    appPath: process.cwd(), resourcesPath: '/missing',
    repository,
    onGlobalEvent,
    shouldAutoApprove,
    spawnProcess: () => ({
      once: (event, callback) => {
        if (event === 'spawn') queueMicrotask(callback)
        if (event === 'exit') queueMicrotask(() => callback(0))
      },
      unref: () => {},
    }),
    connectionFactory: async (input) => { handlers = input.handlers; return connection },
  })
  return {
    gateway,
    connection,
    getNewSessionCount: () => newSessionCount,
    getNewSessionRequests: () => newSessionRequests,
    getPromptRequests: () => promptRequests,
  }
}

test('model diagnostics read GPT6.1 capabilities and release the session without a creative prompt', async () => {
  const options = [{ id: 'model', type: 'select', currentValue: 'old', options: [{ value: 'old' }, { value: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }] },
    { id: 'reasoning_effort', type: 'select', currentValue: 'high', options: [{ value: 'high' }, { value: 'xhigh' }] },
    { id: 'fast-mode', type: 'select', currentValue: 'off', options: [{ value: 'off' }, { value: 'on' }] }]
  const { gateway, connection, getPromptRequests } = createFakeGateway({ sessionOptions: options })
  let closed = 0
  connection.closeSession = async () => { closed++ }
  connection.setSessionConfigOption = async ({ configId, value }) => {
    options.find(item => item.id === configId).currentValue = value
    return { configOptions: structuredClone(options) }
  }
  try {
    const result = await gateway.testConnection({ cwd: os.tmpdir(), model: 'gpt-6.1-sol', reasoningEffort: 'xhigh', fastMode: false })
    assert.equal(result.selected.model, 'gpt-6.1-sol')
    assert.equal(result.selected.reasoningEffort, 'xhigh')
    assert.equal(result.selected.fastMode, false)
    assert.equal(result.models.find(model => model.value === 'gpt-6.1-sol').status, 'available')
    assert.equal(closed, 1)
    assert.equal(getPromptRequests().length, 0)
  } finally { await gateway.shutdown() }
})

test('requested model readback mismatch stops before prompt and never falls back', async () => {
  const options = [{ id: 'model', type: 'select', currentValue: 'old', options: [{ value: 'old' }, { value: 'gpt-6-astra' }] }]
  const { gateway, connection, getPromptRequests } = createFakeGateway({ sessionOptions: options })
  connection.setSessionConfigOption = async () => ({ configOptions: options })
  let fallbacks = 0
  gateway.runExecFallback = async () => { fallbacks++; throw new Error('unexpected fallback') }
  try {
    await assert.rejects(gateway.prompt({ agentRunId: 'model-test', agentStepId: 'step', messages: [], settings: { mirrorRoot: os.tmpdir(), model: 'gpt-6-astra' } }), /回读不匹配/)
    assert.equal(getPromptRequests().length, 0)
    assert.equal(fallbacks, 0)
  } finally { await gateway.shutdown() }
})

test('Codex rejects oversized final input before approval, session creation or exec fallback', async () => {
  const { gateway, getNewSessionCount, getPromptRequests } = createFakeGateway()
  let approvals = 0
  gateway._requestApproval = async () => { approvals++; throw new Error('unexpected approval') }
  gateway.runExecFallback = async () => assert.fail('oversized input should not fall back')
  const messages = [{ role: 'user', content: '文'.repeat(1_048_576) }]
  try {
    await assert.rejects(gateway.prompt({
      agentRunId: 'oversized', agentStepId: 'step', messages, outputSchema: { type: 'object' },
      settings: { displayTitle: '局部修订', mirrorRoot: os.tmpdir() },
    }), /超过接口上限 1,048,576 字符/)
    assert.equal(approvals, 0)
    assert.equal(getNewSessionCount(), 0)
    assert.equal(getPromptRequests().length, 0)
    assert.equal(gateway._canFallback(new Error('Input exceeds the maximum length of 1048576 characters'), false), false)
  } finally { await gateway.shutdown() }
})

test('ACP gateway reuses one session for all steps in an AgentRun', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-test-'))
  const { gateway, getNewSessionCount } = createFakeGateway()
  try {
    const first = await gateway.prompt({
      agentRunId: 'run-1', agentStepId: 'step-card', messages: [{ role: 'user', content: '生成章节卡' }],
      outputSchema: { type: 'object' }, settings: { mirrorRoot: root },
    })
    const second = await gateway.prompt({
      agentRunId: 'run-1', agentStepId: 'step-scenes', messages: [{ role: 'user', content: '生成场景计划' }],
      settings: { mirrorRoot: root },
    })
    await gateway.prompt({
      agentRunId: 'run-2', agentStepId: 'step-card-2', messages: [{ role: 'user', content: '另一个运行' }],
      settings: { mirrorRoot: root },
    })
    assert.equal(first.backend, 'codex_acp')
    assert.deepEqual(first.structuredOutput, { goal: '进入医院' })
    assert.equal(second.sessionId, first.sessionId)
    assert.equal(getNewSessionCount(), 2)
  } finally {
    await gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('completed automatic Codex turns are archived while candidates remain available for a full-context resume', async () => {
  let persisted
  const updates = [], archived = [], notices = []
  const { gateway, connection, getPromptRequests } = createFakeGateway({
    archiveSupported: true,
    repository: {
      getRun: () => ({ session: persisted }),
      upsertSession: patch => { persisted = { ...persisted, ...patch }; updates.push(patch) },
    },
    onGlobalEvent: event => notices.push(event),
  })
  connection.deleteSession = async ({ sessionId }) => {
    assert.equal(gateway.sessions.get('automatic-book-run').activeStepId, '')
    archived.push(sessionId)
  }
  const input = { agentRunId: 'automatic-book-run', agentStepId: 'first',
    messages: [{ role: 'user', content: '完整上下文和当前候选' }], settings: { mirrorRoot: os.tmpdir() } }
  try {
    const first = await gateway.prompt(input)
    assert.deepEqual(first.structuredOutput, { goal: '进入医院' })
    assert.deepEqual(archived, [first.sessionId])
    assert.equal(gateway.sessions.size, 0)
    assert.equal(gateway.sessionToRun.size, 0)
    assert.equal(persisted.status, 'closed')
    let resumed
    connection.resumeSession = async params => { resumed = params.sessionId; return {} }
    const next = await gateway.prompt({ ...input, agentStepId: 'next',
      continuationMessages: [{ role: 'user', content: '只有本轮增量' }] })
    assert.equal(resumed, first.sessionId)
    assert.equal(next.contextReuse, 'full')
    assert.match(getPromptRequests()[1].prompt[0].text, /完整上下文和当前候选/)
    assert.doesNotMatch(getPromptRequests()[1].prompt[0].text, /只有本轮增量/)
    assert.equal(archived.length, 2)
    assert.equal(notices.filter(event => event.type === 'session_archived').length, 2)
  } finally { await gateway.shutdown() }
})

test('archive failure never fails generation and closing the idle session retries it', async () => {
  const events = []
  const { gateway, connection } = createFakeGateway({ archiveSupported: true, onGlobalEvent: event => events.push(event) })
  let attempts = 0
  connection.deleteSession = async () => { if (++attempts === 1) throw new Error('writer temporarily busy') }
  try {
    const result = await gateway.prompt({ agentRunId: 'retry-archive', agentStepId: 'step',
      messages: '生成候选', settings: { mirrorRoot: os.tmpdir() } })
    assert.deepEqual(result.structuredOutput, { goal: '进入医院' })
    assert.equal(gateway.sessions.size, 1)
    assert.ok(events.some(event => event.type === 'session_archive_failed'))
    await gateway.closeSession('retry-archive')
    assert.equal(attempts, 2)
    assert.equal(gateway.sessions.size, 0)
  } finally { await gateway.shutdown() }
})

test('automatic archival ignores active, unknown and non-Codex sessions', async () => {
  const { gateway, connection } = createFakeGateway({ archiveSupported: true })
  await gateway.startAdapter()
  let archived = 0
  connection.deleteSession = async () => { archived++ }
  try {
    gateway.sessions.set('active', { sessionId: 'owned-active', activeStepId: 'writing' })
    assert.equal(await gateway.archiveAutomaticSession('active'), false)
    assert.equal(await gateway.archiveAutomaticSession('user-created-thread'), false)
    gateway.sessions.delete('active')
    gateway.acpBackend = 'qoder_acp'
    const result = await gateway.prompt({ agentRunId: 'other-provider', agentStepId: 'step',
      messages: '候选', settings: { mirrorRoot: os.tmpdir() } })
    assert.equal(result.backend, 'qoder_acp')
    assert.equal(archived, 0)
    assert.equal(gateway.sessions.size, 1)
  } finally { await gateway.shutdown() }
})

test('ACP groups book tasks by a stable workspace while isolating each AgentRun mirror', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-book-'))
  const workspaceRoot = path.join(base, '明星手艺人')
  const mirrorRoot = path.join(base, 'runs', 'run-1')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(mirrorRoot, { recursive: true })
  const { gateway, getNewSessionRequests, getPromptRequests } = createFakeGateway({
    onNewSession: () => {
      assert.equal(fs.existsSync(path.join(workspaceRoot, '.novel-studio-codex-registered')), true)
    },
  })
  try {
    await gateway.prompt({
      agentRunId: 'run-book',
      agentStepId: 'step-audience',
      messages: [{ role: 'system', content: '生成目标读者候选' }],
      settings: {
        mirrorRoot,
        workspaceRoot,
        displayTitle: '目标读者',
      },
    })
    assert.deepEqual(getNewSessionRequests()[0], {
      cwd: workspaceRoot,
      additionalDirectories: [mirrorRoot],
      mcpServers: [],
    })
    assert.equal(fs.existsSync(path.join(workspaceRoot, '.novel-studio-codex-registered')), true)
    assert.match(getPromptRequests()[0].prompt[0].text, /^system:\n生成目标读者候选\n\n目标读者\n\n/)
    assert.doesNotMatch(getPromptRequests()[0].prompt[0].text, /Novel Studio 任务：/)
    assert.match(getPromptRequests()[0].prompt[0].text, new RegExp(mirrorRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await gateway.shutdown()
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('ACP uses compact continuation messages only for an already-live AgentRun session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-context-reuse-'))
  const firstGateway = createFakeGateway()
  try {
    const first = await firstGateway.gateway.prompt({
      agentRunId: 'run-compact', agentStepId: 'step-1',
      messages: [{ role: 'user', content: '完整上下文第一轮' }],
      continuationMessages: [{ role: 'user', content: '不应使用的增量' }],
      settings: { mirrorRoot: root },
    })
    const second = await firstGateway.gateway.prompt({
      agentRunId: 'run-compact', agentStepId: 'step-2',
      messages: [{ role: 'user', content: '完整上下文第二轮' }],
      continuationMessages: [{ role: 'user', content: '只发送变化内容' }],
      settings: { mirrorRoot: root },
    })
    assert.match(firstGateway.getPromptRequests()[0].prompt[0].text, /完整上下文第一轮/)
    assert.doesNotMatch(firstGateway.getPromptRequests()[0].prompt[0].text, /不应使用的增量/)
    assert.match(firstGateway.getPromptRequests()[1].prompt[0].text, /只发送变化内容/)
    assert.doesNotMatch(firstGateway.getPromptRequests()[1].prompt[0].text, /完整上下文第二轮/)
    assert.equal(first.contextReuse, 'full')
    assert.equal(second.contextReuse, 'delta')
  } finally {
    await firstGateway.gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resumed sessions and exec fallback receive the full prompt instead of a context delta', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-context-safe-'))
  const persisted = createFakeGateway({
    repository: { getRun: () => ({ session: { sessionId: 'persisted-session', status: 'active' } }) },
  })
  try {
    const resumed = await persisted.gateway.prompt({
      agentRunId: 'run-persisted', agentStepId: 'step-2',
      messages: [{ role: 'user', content: '恢复时完整上下文' }],
      continuationMessages: [{ role: 'user', content: '恢复时不应只发增量' }],
      settings: { mirrorRoot: root },
    })
    assert.match(persisted.getPromptRequests()[0].prompt[0].text, /恢复时完整上下文/)
    assert.doesNotMatch(persisted.getPromptRequests()[0].prompt[0].text, /恢复时不应只发增量/)
    assert.equal(resumed.contextReuse, 'full')
  } finally { await persisted.gateway.shutdown() }

  let promptRound = 0
  const fallback = createFakeGateway({
    promptBehavior: async ({ handlers, request }) => {
      promptRound += 1
      if (promptRound === 1) {
        await handlers.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"goal":"第一轮"}' } },
        })
        return { stopReason: 'end_turn' }
      }
      throw new Error('transport closed')
    },
  })
  let fallbackPrompt = ''
  fallback.gateway.runExecFallback = async (request) => {
    fallbackPrompt = request.prompt
    return { backend: 'codex_exec', fallbackReason: request.fallbackReason, outputStarted: true }
  }
  try {
    await fallback.gateway.prompt({
      agentRunId: 'run-fallback-full', agentStepId: 'step-1', messages: [{ role: 'user', content: '第一轮完整' }],
      settings: { mirrorRoot: root },
    })
    const result = await fallback.gateway.prompt({
      agentRunId: 'run-fallback-full', agentStepId: 'step-2',
      messages: [{ role: 'user', content: '回退必须使用完整上下文' }],
      continuationMessages: [{ role: 'user', content: 'ACP 本可使用增量' }],
      settings: { mirrorRoot: root },
    })
    assert.match(fallbackPrompt, /回退必须使用完整上下文/)
    assert.doesNotMatch(fallbackPrompt, /ACP 本可使用增量/)
    assert.equal(result.contextReuse, 'full')
  } finally {
    await fallback.gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex desktop workspace launcher opens the stable book root', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-codex-open-'))
  const calls = []
  let unrefCalled = false
  const gateway = new CodexAgentGateway({
    appPath: process.cwd(),
    resourcesPath: '/missing',
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options })
      return {
        once: (event, callback) => { if (event === 'spawn') queueMicrotask(callback) },
        unref: () => { unrefCalled = true },
      }
    },
  })
  gateway.runtime = { cliAvailable: true, paths: { codexPath: '/runtime/codex' } }
  try {
    const result = await gateway.openDesktopWorkspace({ workspaceRoot })
    assert.deepEqual(calls[0].args, ['app', workspaceRoot])
    assert.equal(calls[0].options.cwd, workspaceRoot)
    assert.equal(calls[0].options.detached, true)
    assert.equal(unrefCalled, true)
    assert.equal(result.workspaceName, path.basename(workspaceRoot))
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('ACP failure falls back to exec only before observable output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-fallback-'))
  const before = createFakeGateway({ promptBehavior: async () => { throw new Error('transport closed') } })
  let fallbackCalls = 0
  before.gateway.runExecFallback = async (request) => {
    fallbackCalls += 1
    return { backend: 'codex_exec', fallbackReason: request.fallbackReason, outputStarted: true }
  }
  try {
    const result = await before.gateway.prompt({
      agentRunId: 'run-before', agentStepId: 'step', messages: '生成', settings: { mirrorRoot: root },
    })
    assert.equal(result.backend, 'codex_exec')
    assert.equal(fallbackCalls, 1)
  } finally {
    await before.gateway.shutdown()
  }

  const after = createFakeGateway({
    promptBehavior: async ({ request, handlers }) => {
      await handlers.sessionUpdate({
        sessionId: request.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '部分输出' } },
      })
      throw new Error('transport closed')
    },
  })
  after.gateway.runExecFallback = async () => { fallbackCalls += 1; return { backend: 'codex_exec' } }
  try {
    await assert.rejects(after.gateway.prompt({
      agentRunId: 'run-after', agentStepId: 'step', messages: '生成', settings: { mirrorRoot: root },
    }), /transport closed/)
    assert.equal(fallbackCalls, 1)
  } finally {
    await after.gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejecting the model-call approval starts neither ACP session nor exec fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-approval-'))
  let pendingApproval
  const repository = {
    createApproval: (input) => ({ ...input, id: 'approval-1', status: 'pending' }),
    resolveApproval: (input) => ({ ...input, status: input.approved ? 'approved' : 'rejected' }),
    completeApproval: () => {},
  }
  const { gateway, getNewSessionCount } = createFakeGateway({
    repository,
    onGlobalEvent: (event) => { if (event.type === 'permission') pendingApproval = event.approval },
  })
  let fallbackCalls = 0
  gateway.runExecFallback = async () => { fallbackCalls += 1; return { backend: 'codex_exec' } }
  try {
    const operation = gateway.prompt({
      agentRunId: 'run-rejected', agentStepId: 'step', messages: '生成章节卡',
      settings: { mirrorRoot: root, projectId: 'project-1' },
    })
    while (!pendingApproval) await new Promise((resolve) => setImmediate(resolve))
    gateway.resolveApproval({ id: pendingApproval.id, approved: false, reason: '用户拒绝本次模型调用' })
    await assert.rejects(operation, { name: 'CodexApprovalRejectedError' })
    assert.equal(getNewSessionCount(), 0)
    assert.equal(fallbackCalls, 0)
  } finally {
    await gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('project session approval automatically approves model calls but keeps an audit record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-session-approval-'))
  const created = []
  const resolved = []
  const completed = []
  const events = []
  const repository = {
    createApproval: (input) => {
      const approval = { ...input, id: `approval-${created.length + 1}`, status: 'pending' }
      created.push(approval)
      return approval
    },
    resolveApproval: (input) => {
      const approval = { ...created.find((item) => item.id === input.id), ...input, status: input.approved ? 'approved' : 'rejected' }
      resolved.push(approval)
      return approval
    },
    completeApproval: (id, result) => completed.push({ id, result }),
  }
  const { gateway } = createFakeGateway({
    repository,
    shouldAutoApprove: ({ actionType, projectId }) => actionType === 'model_call' && projectId === 'project-1',
    onGlobalEvent: (event) => events.push(event),
  })
  try {
    const result = await gateway.prompt({
      agentRunId: 'run-auto', agentStepId: 'step-auto', messages: '生成目标读者',
      settings: { mirrorRoot: root, projectId: 'project-1' },
    })
    assert.equal(result.backend, 'codex_acp')
    assert.equal(created.length, 1)
    assert.equal(resolved[0].status, 'approved')
    assert.match(resolved[0].note, /本次应用会话/)
    assert.equal(completed.length, 1)
    assert.equal(events.some((event) => event.type === 'permission'), false)
    assert.equal(events.some((event) => event.type === 'permission_auto_approved'), true)
  } finally {
    await gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ACP session configuration only changes declared values and tags booleans', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-config-'))
  let handlers
  const configRequests = []
  const initialOptions = [
    { id: 'model', type: 'select', currentValue: 'gpt-5.6-sol', options: [{ value: 'gpt-5.6-sol' }] },
    { id: 'reasoning_effort', type: 'select', currentValue: 'high', options: [{ value: 'high' }] },
    { id: 'fast-mode', type: 'boolean', currentValue: false },
    { id: 'secret-token', type: 'text', currentValue: 'hidden' },
  ]
  const connection = {
    initialize: async () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } }),
    newSession: async () => ({ sessionId: 'session-config', configOptions: initialOptions }),
    setSessionConfigOption: async (request) => {
      configRequests.push(request)
      return { configOptions: initialOptions.map((option) => option.id === request.configId ? { ...option, currentValue: request.value } : option) }
    },
    prompt: async () => ({ stopReason: 'end_turn' }),
    cancel: async () => {},
    closeSession: async () => {},
  }
  const gateway = new CodexAgentGateway({
    appPath: process.cwd(), resourcesPath: '/missing',
    connectionFactory: async (input) => { handlers = input.handlers; return connection },
  })
  try {
    await gateway.prompt({
      agentRunId: 'run-config-default', agentStepId: 'step-1', messages: '生成章节卡',
      settings: { mirrorRoot: root, reasoningEffort: 'high', fastMode: false },
    })
    assert.equal(configRequests.length, 0)
    const publicOptions = gateway.inspectRuntime().configOptions
    assert.equal(publicOptions.find((option) => option.id === 'model').currentValue, 'gpt-5.6-sol')
    assert.equal(publicOptions.some((option) => option.id === 'secret-token'), false)
    await gateway.prompt({
      agentRunId: 'run-config-fast', agentStepId: 'step-2', messages: '生成章节卡',
      settings: { mirrorRoot: root, reasoningEffort: 'high', fastMode: true },
    })
    assert.deepEqual(configRequests, [{ sessionId: 'session-config', configId: 'fast-mode', value: true, type: 'boolean' }])
    assert.ok(handlers)
  } finally {
    await gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ACP resume follows resume then load then recreate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-resume-'))
  let handlers
  let created = 0
  const calls = []
  const gateway = new CodexAgentGateway({
    appPath: process.cwd(), resourcesPath: '/missing',
    connectionFactory: async (input) => {
      handlers = input.handlers
      return {
        initialize: async () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} } } }),
        resumeSession: async () => { calls.push('resume'); throw new Error('resume failed') },
        loadSession: async () => { calls.push('load'); throw new Error('load failed') },
        newSession: async () => ({ sessionId: `new-${++created}` }),
        cancel: async () => {}, closeSession: async () => {}, prompt: async () => ({ stopReason: 'end_turn' }),
      }
    },
  })
  try {
    const session = await gateway.resumeSession({
      agentRunId: 'run-resume', mirrorRoot: root, persistedSession: { sessionId: 'old-session', backend: 'codex_acp' },
    })
    assert.deepEqual(calls, ['resume', 'load'])
    assert.equal(session.sessionId, 'new-1')
    assert.ok(handlers)
  } finally {
    await gateway.shutdown()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ACP command permissions reject paths outside the AgentRun mirror before approval', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-studio-acp-paths-'))
  try {
    assert.doesNotThrow(() => safeToolLocations(root, { rawInput: { command: 'rg 关键词 project/foundation.md' } }))
    assert.doesNotThrow(() => safeToolLocations(root, { rawInput: { command: 'curl https://example.com/context' } }))
    assert.throws(() => safeToolLocations(root, { rawInput: { command: 'cat /private/tmp/other-project.txt' } }), /越出/)
    assert.throws(() => safeToolLocations(root, { rawInput: { command: 'cat ../../other-project.txt' } }), /越出/)
    assert.throws(() => safeToolLocations(root, { rawInput: { command: 'cat ~/Library/Application\\ Support/Novel\\ Studio/data' } }), /越出/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('scene calls use separate empty working directories and never resume a previous transcript', async () => {
  const { gateway, getNewSessionRequests, getPromptRequests } = createFakeGateway({
    repository: { getRun: () => ({ session: { sessionId: 'old-session' } }) },
  })
  try {
    for (const text of ['甲场独有样本', '乙场前文']) {
      const result = await gateway.prompt({ agentRunId: 'run', agentStepId: 'chapter', messages: [{ role: 'user', content: text }],
        continuationMessages: [{ role: 'user', content: '旧会话' }], settings: { isolatedScene: true, mirrorRoot: '/unused' } })
      assert.equal(result.contextReuse, 'full')
      assert.equal(result.sentPromptHash.length, 64)
    }
    const sessions = getNewSessionRequests()
    assert.equal(sessions.length, 2)
    assert.notEqual(sessions[0].cwd, sessions[1].cwd)
    assert.ok(sessions.every(s => !fs.existsSync(s.cwd) && s.additionalDirectories.length === 0))
    const requests = getPromptRequests()
    assert.notEqual(requests[0].sessionId, requests[1].sessionId)
    assert.match(requests[1].prompt[0].text, /乙场前文/)
    assert.doesNotMatch(requests[1].prompt[0].text, /甲场独有样本|旧会话|受控创作目录/)
  } finally { await gateway.shutdown() }
})
