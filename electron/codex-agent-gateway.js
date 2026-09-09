import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { readMirrorText, resolveMirrorPath, writeMirrorText } from './codex-project-mirror.js'
import { modelDirectory, sessionModelSnapshot, execModelArgs } from './codex-models.js'

const ADAPTER_VERSION = '1.6.2'
const MAX_EXEC_OUTPUT = 8 * 1024 * 1024
const DESKTOP_PROJECT_MARKER = '.novel-studio-codex-registered'
const FALLBACK_BLOCKED = /(auth|login|permission|approval|cancel|reject|denied|schema|invalid request|provider|rate.?limit|quota|认证|登录|审批|权限|拒绝|取消|凭据|密钥)/i
const PUBLIC_CONFIG_OPTION_IDS = new Set(['model', 'reasoning_effort', 'fast-mode', 'mode'])

function publicConfigOptions(options = []) {
  return options.filter((option) => PUBLIC_CONFIG_OPTION_IDS.has(option?.id)).map((option) => ({
    id: option.id,
    name: String(option.name || option.id),
    type: option.type,
    currentValue: option.currentValue,
    options: Array.isArray(option.options) ? option.options.flatMap(item => item.options || [item]).map((item) => ({
      name: String(item.name || item.value || ''),
      value: String(item.value || ''),
    })) : undefined,
  }))
}

export class CodexCancelledError extends Error {
  constructor(message = 'Codex 运行已取消') {
    super(message)
    this.name = 'CodexCancelledError'
  }
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function packageJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function platformTarget() {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'darwin' && arch === 'arm64') return { packageName: 'codex-darwin-arm64', triple: 'aarch64-apple-darwin' }
  if (platform === 'darwin' && arch === 'x64') return { packageName: 'codex-darwin-x64', triple: 'x86_64-apple-darwin' }
  if (platform === 'linux' && arch === 'arm64') return { packageName: 'codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' }
  if (platform === 'linux' && arch === 'x64') return { packageName: 'codex-linux-x64', triple: 'x86_64-unknown-linux-musl' }
  if (platform === 'win32' && arch === 'arm64') return { packageName: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
  if (platform === 'win32' && arch === 'x64') return { packageName: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
  return null
}

function runtimeCandidates({ appPath, resourcesPath }) {
  const target = platformTarget()
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const packagedRoot = target ? path.join(resourcesPath, 'codex-runtime', `${process.platform}-${process.arch}`) : ''
  const developmentRoot = appPath
  return [
    process.env.NOVEL_STUDIO_CODEX_RUNTIME
      ? {
          source: 'environment',
          root: process.env.NOVEL_STUDIO_CODEX_RUNTIME,
          adapterPath: path.join(process.env.NOVEL_STUDIO_CODEX_RUNTIME, 'codex-acp', 'dist', 'index.js'),
          adapterPackagePath: path.join(process.env.NOVEL_STUDIO_CODEX_RUNTIME, 'codex-acp', 'package.json'),
          cliPackagePath: path.join(process.env.NOVEL_STUDIO_CODEX_RUNTIME, 'codex', 'package.json'),
          codexPath: process.env.CODEX_PATH || path.join(process.env.NOVEL_STUDIO_CODEX_RUNTIME, target?.packageName || '', 'vendor', target?.triple || '', 'bin', executable),
          manifestPath: path.join(process.env.NOVEL_STUDIO_CODEX_RUNTIME, 'runtime-manifest.json'),
        }
      : null,
    packagedRoot
      ? {
          source: 'packaged', root: packagedRoot,
          adapterPath: path.join(packagedRoot, 'codex-acp', 'dist', 'index.js'),
          adapterPackagePath: path.join(packagedRoot, 'codex-acp', 'package.json'),
          cliPackagePath: path.join(packagedRoot, 'codex', 'package.json'),
          codexPath: path.join(packagedRoot, target.packageName, 'vendor', target.triple, 'bin', executable),
          manifestPath: path.join(packagedRoot, 'runtime-manifest.json'),
        }
      : null,
    target
      ? {
          source: 'development', root: developmentRoot,
          adapterPath: path.join(developmentRoot, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js'),
          adapterPackagePath: path.join(developmentRoot, 'node_modules', '@agentclientprotocol', 'codex-acp', 'package.json'),
          cliPackagePath: path.join(developmentRoot, 'node_modules', '@openai', 'codex', 'package.json'),
          codexPath: process.env.CODEX_PATH || path.join(developmentRoot, 'node_modules', '@openai', target.packageName, 'vendor', target.triple, 'bin', executable),
          manifestPath: path.join(developmentRoot, 'resources', 'codex-runtime-manifest.json'),
        }
      : null,
  ].filter(Boolean)
}

export function inspectCodexRuntime({ appPath, resourcesPath }) {
  const candidate = runtimeCandidates({ appPath, resourcesPath }).find((item) => fs.existsSync(item.adapterPath) && fs.existsSync(item.codexPath))
  if (!candidate) return {
    available: false,
    adapterAvailable: false,
    cliAvailable: false,
    adapterVersion: '',
    cliVersion: '',
    integrity: 'missing',
    environmentAuthAvailable: Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY),
    source: '',
  }
  const adapterPackage = packageJson(candidate.adapterPackagePath)
  const cliPackage = packageJson(candidate.cliPackagePath)
  const manifest = packageJson(candidate.manifestPath)
  const actual = {
    adapter: sha256File(candidate.adapterPath),
    cli: sha256File(candidate.codexPath),
  }
  const versionValid = adapterPackage?.version === ADAPTER_VERSION
  const manifestValid = manifest
    ? manifest.adapterVersion === ADAPTER_VERSION
      && manifest.files?.adapter === actual.adapter
      && manifest.files?.cli === actual.cli
    : candidate.source === 'development'
  return {
    available: versionValid && manifestValid,
    adapterAvailable: true,
    cliAvailable: true,
    adapterVersion: adapterPackage?.version || '',
    cliVersion: cliPackage?.version || '',
    integrity: versionValid && manifestValid ? (manifest ? 'verified' : 'development') : 'invalid',
    environmentAuthAvailable: Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY),
    source: candidate.source,
    paths: candidate,
    hashes: actual,
    capabilities: {
      execOutputSchema: Boolean(manifest?.capabilities?.execOutputSchema),
    },
  }
}

function updateType(update) {
  const type = update?.sessionUpdate || 'status'
  if (type === 'agent_message_chunk') return 'text_delta'
  if (type === 'agent_thought_chunk') return 'reasoning'
  if (type === 'plan') return 'plan'
  if (type === 'tool_call') return 'tool_call'
  if (type === 'tool_call_update') return update.status === 'completed' ? 'tool_result' : 'tool_call'
  if (type === 'usage_update') return 'usage'
  return 'status'
}

function updateText(update) {
  if (update?.content?.type === 'text') return update.content.text || ''
  if (typeof update?.content === 'string') return update.content
  return ''
}

function structuredFromContent(content) {
  const text = String(content || '').trim()
  if (!text) return null
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1))
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) } catch { /* continue */ }
  }
  return null
}

function sessionDirectories(workspaceRoot, mirrorRoot) {
  const cwd = path.resolve(workspaceRoot || mirrorRoot)
  const mirror = path.resolve(mirrorRoot)
  return {
    cwd,
    additionalDirectories: cwd === mirror ? [] : [mirror],
  }
}

export function codexPromptText({ messages, outputSchema, displayTitle = '', mirrorRoot = '' }) {
  const normalizedMessages = Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages || '') }]
  const systemMessages = normalizedMessages.filter((message) => message.role === 'system')
  const taskMessages = normalizedMessages.filter((message) => message.role !== 'system')
  return [
    ...systemMessages.map((message) => `system:\n${message.content || ''}`),
    outputSchema ? `受保护输出 Schema（只返回符合此 Schema 的 JSON）：\n${JSON.stringify(outputSchema)}` : '',
    displayTitle,
    mirrorRoot ? `当前 AgentRun 的受控创作目录：${mirrorRoot}\n只在此目录读取项目快照或写入候选；书籍工作区根目录只用于会话归类。` : '',
    ...taskMessages
      .map((message) => `${message.role || 'user'}:\n${message.content || ''}`),
  ].filter(Boolean).join('\n\n')
}

function classifyTool(toolCall = {}) {
  const text = JSON.stringify(toolCall).toLowerCase()
  if (/mcp/.test(text)) return 'mcp'
  if (/subagent|sub-agent|spawn agent|delegate/.test(text)) return 'subagent'
  if (/web|http|search|fetch|browser/.test(text)) return 'web'
  if (/write|edit|patch|file|read/.test(text)) return 'file'
  return 'command'
}

function toolPermissionLabel(kind, toolCall = {}) {
  const title = String(toolCall.title || toolCall.toolCallId || 'Codex 工具调用')
  return `${kind === 'command' ? '运行命令' : kind === 'file' ? '访问镜像文件' : kind === 'web' ? '访问网络' : kind === 'mcp' ? '调用 MCP' : '启动子 Agent'}：${title}`
}

function safeToolLocations(mirrorRoot, toolCall = {}) {
  const paths = []
  const visit = (value, key = '', depth = 0) => {
    if (depth > 8) return
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key, depth + 1))
    if (value && typeof value === 'object') return Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, depth + 1))
    if (typeof value === 'string' && /(path|cwd|file|location)/i.test(key)) paths.push(value)
    if (typeof value === 'string' && /(command|cmd|script)/i.test(key)) {
      const command = value.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'";|&]+/gi, '')
      const commandPaths = command.match(/(?:^|[\s'"=])((?:\.\.[\\/]|~[\\/]|[A-Za-z]:[\\/]|\/(?!bin\/|usr\/bin\/))[^\s'";|&]*)/g) || []
      commandPaths.forEach((candidate) => paths.push(candidate.trim().replace(/^['"=]/, '')))
    }
  }
  visit(toolCall)
  paths.forEach((candidate) => {
    if (/^~[\\/]/.test(candidate)) throw new Error('路径越出当前 AgentRun 镜像')
    resolveMirrorPath(mirrorRoot, candidate)
  })
}

function execEvent(line) {
  try {
    const parsed = JSON.parse(line)
    const type = parsed.type || parsed.event || 'status'
    const text = parsed.item?.text || parsed.message || parsed.text || ''
    return { type, text, raw: parsed }
  } catch {
    return { type: 'status', text: line, raw: { line } }
  }
}

export class CodexAgentGateway {
  constructor({
    appPath,
    resourcesPath,
    repository,
    spawnProcess = spawn,
    connectionFactory = null,
    approvalTimeoutMs = 5 * 60 * 1000,
    onGlobalEvent = () => {},
    shouldAutoApprove = () => false,
  }) {
    this.appPath = appPath
    this.resourcesPath = resourcesPath
    this.repository = repository
    this.spawnProcess = spawnProcess
    this.connectionFactory = connectionFactory
    this.approvalTimeoutMs = approvalTimeoutMs
    this.onGlobalEvent = onGlobalEvent
    this.shouldAutoApprove = shouldAutoApprove
    this.runtime = null
    this.process = null
    this.connection = null
    this.initializeResult = null
    this.sessions = new Map()
    this.sessionToRun = new Map()
    this.pendingApprovals = new Map()
    this.startPromise = null
    this.authenticatedMethod = ''
    this.configOptions = []
    this.registeredWorkspaces = new Set()
    this.workspaceRegistrationPromises = new Map()
  }

  inspectRuntime() {
    this.runtime = inspectCodexRuntime({ appPath: this.appPath, resourcesPath: this.resourcesPath })
    return {
      ...this.runtime,
      paths: undefined,
      hashes: this.runtime.hashes,
      adapterStatus: this.connection ? 'ready' : this.process ? 'starting' : 'stopped',
      protocolVersion: this.initializeResult?.protocolVersion || '',
      agentCapabilities: this.initializeResult?.agentCapabilities || {},
      authMethods: this.initializeResult?.authMethods || [],
      authenticatedMethod: this.authenticatedMethod,
      configOptions: publicConfigOptions(this.configOptions),
      sessions: [...this.sessions.values()].map((session) => ({
        agentRunId: session.agentRunId, sessionId: session.sessionId, active: Boolean(session.activeStepId),
      })),
    }
  }

  async startAdapter() {
    if (this.connection) return this.inspectRuntime()
    if (this.startPromise) return this.startPromise
    this.startPromise = this._startAdapter().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async _startAdapter() {
    const runtime = this.runtime || inspectCodexRuntime({ appPath: this.appPath, resourcesPath: this.resourcesPath })
    this.runtime = runtime
    if (!runtime.available) {
      const error = new Error(`Codex 运行时不可用：${runtime.integrity}`)
      error.codexPhase = 'adapter_start'
      throw error
    }
    const handlers = {
      sessionUpdate: (params) => this._handleSessionUpdate(params),
      requestPermission: (params) => this._handlePermissionRequest(params),
      readTextFile: (params) => this._readTextFile(params),
      writeTextFile: (params) => this._writeTextFile(params),
    }
    try {
      if (this.connectionFactory) {
        this.connection = await this.connectionFactory({ handlers, runtime })
      } else {
        this.process = this.spawnProcess(process.execPath, [runtime.paths.adapterPath], {
          cwd: path.dirname(runtime.paths.adapterPath),
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: process.versions.electron ? '1' : process.env.ELECTRON_RUN_AS_NODE,
            CODEX_PATH: runtime.paths.codexPath,
            INITIAL_AGENT_MODE: 'agent',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.process.stderr?.on('data', (chunk) => this.onGlobalEvent({ type: 'adapter_log', text: String(chunk).slice(0, 4096) }))
        this.process.on('exit', (code, signal) => {
          this.onGlobalEvent({ type: 'adapter_exit', code, signal })
          this.connection = null
          this.process = null
        })
        const writable = Writable.toWeb(this.process.stdin)
        const readable = Readable.toWeb(this.process.stdout)
        this.connection = new ClientSideConnection(() => handlers, ndJsonStream(writable, readable))
      }
      this.initializeResult = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'novel-studio', title: 'Novel Studio', version: '0.1.0' },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          session: { configOptions: { boolean: {} } },
        },
      })
      if (String(this.initializeResult.protocolVersion) !== String(PROTOCOL_VERSION)) {
        const error = new Error(`ACP 协议不兼容：${this.initializeResult.protocolVersion}`)
        error.codexPhase = 'initialize'
        throw error
      }
      return this.inspectRuntime()
    } catch (error) {
      error.codexPhase ||= this.connection ? 'initialize' : 'adapter_start'
      await this.restartAdapter({ suppressErrors: true })
      throw error
    }
  }

  async authenticate(methodId = 'chat-gpt') {
    await this.startAdapter()
    const available = this.initializeResult?.authMethods || []
    if (!available.some((method) => method.id === methodId)) throw new Error(`Codex 不支持认证方式 ${methodId}`)
    await this.connection.authenticate({ methodId })
    this.authenticatedMethod = methodId
    return this.inspectRuntime()
  }

  async testConnection({ cwd, model = '', reasoningEffort = '', fastMode = false } = {}) {
    await this.startAdapter()
    const created = await this.connection.newSession({ cwd, additionalDirectories: [], mcpServers: [] })
    this.configOptions = created.configOptions || this.configOptions
    try {
      const diagnostic = { sessionId: created.sessionId, configOptions: created.configOptions || [], configKey: '' }
      // Configuring a disposable diagnostic session never sends a model prompt.
      if (model || reasoningEffort || fastMode) await this._configureSession(diagnostic, { model, reasoningEffort, fastMode })
      this.configOptions = diagnostic.configOptions
      return {
        ok: true,
        protocolVersion: this.initializeResult?.protocolVersion || '',
        sessionCreated: Boolean(created?.sessionId),
        adapterVersion: ADAPTER_VERSION,
        configOptions: publicConfigOptions(this.configOptions),
        models: modelDirectory(this.configOptions, true),
        selected: sessionModelSnapshot(this.configOptions),
        refreshedAt: new Date().toISOString(),
      }
    } finally {
      if (created?.sessionId && this.initializeResult?.agentCapabilities?.sessionCapabilities?.close) {
        await this.connection.closeSession({ sessionId: created.sessionId })
      }
    }
  }

  async openDesktopWorkspace({ workspaceRoot, waitForRegistration = false }) {
    const runtime = this.runtime || inspectCodexRuntime({ appPath: this.appPath, resourcesPath: this.resourcesPath })
    this.runtime = runtime
    if (!runtime.cliAvailable || !workspaceRoot || !fs.existsSync(workspaceRoot)) throw new Error('Codex 书籍工作区或桌面运行时不可用')
    const root = path.resolve(workspaceRoot)
    const child = this.spawnProcess(runtime.paths.codexPath, ['app', root], {
      cwd: root,
      detached: !waitForRegistration,
      stdio: 'ignore',
    })
    await new Promise((resolve, reject) => {
      let settled = false
      let timeout = null
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        callback(value)
      }
      child.once('spawn', () => {
        if (!waitForRegistration) finish(resolve)
      })
      child.once('error', (error) => finish(reject, error))
      if (waitForRegistration) {
        child.once('exit', (code) => {
          if (code === 0 || code === null) finish(resolve)
          else finish(reject, new Error(`Codex 项目登记失败：进程退出码 ${code}`))
        })
        timeout = setTimeout(() => finish(resolve), 8000)
      }
    })
    if (!waitForRegistration) child.unref?.()
    if (waitForRegistration) {
      this.registeredWorkspaces.add(root)
      fs.writeFileSync(path.join(root, DESKTOP_PROJECT_MARKER), `${JSON.stringify({ schemaVersion: 1, registeredAt: new Date().toISOString() })}\n`, { mode: 0o600 })
    }
    return { opened: true, workspaceName: path.basename(root) }
  }

  async ensureDesktopWorkspace({ workspaceRoot }) {
    const root = path.resolve(workspaceRoot || '')
    if (!workspaceRoot || !fs.existsSync(root)) throw new Error('Codex 书籍工作区不存在')
    if (this.registeredWorkspaces.has(root) || fs.existsSync(path.join(root, DESKTOP_PROJECT_MARKER))) {
      this.registeredWorkspaces.add(root)
      return { registered: true, cached: true, workspaceName: path.basename(root) }
    }
    if (this.workspaceRegistrationPromises.has(root)) return this.workspaceRegistrationPromises.get(root)
    const registration = this.openDesktopWorkspace({ workspaceRoot: root, waitForRegistration: true })
      .then((result) => ({ ...result, registered: true, cached: false }))
      .finally(() => this.workspaceRegistrationPromises.delete(root))
    this.workspaceRegistrationPromises.set(root, registration)
    return registration
  }

  async createSession({ agentRunId, mirrorRoot, workspaceRoot = '', authMethod = '', backend = 'codex_acp' }) {
    await this.startAdapter()
    try {
      const directories = sessionDirectories(workspaceRoot, mirrorRoot)
      if (workspaceRoot) await this.ensureDesktopWorkspace({ workspaceRoot: directories.cwd })
      const created = await this.connection.newSession({ ...directories, mcpServers: [] })
      const session = {
        agentRunId, sessionId: created.sessionId, mirrorRoot, workspaceRoot: directories.cwd, activeStepId: '', onEvent: null,
        events: [], content: '', outputStarted: false, configKey: '', configOptions: created.configOptions || [],
      }
      this.configOptions = session.configOptions
      this.sessions.set(agentRunId, session)
      this.sessionToRun.set(created.sessionId, agentRunId)
      this.repository?.upsertSession?.({
        agentRunId, backend, sessionId: created.sessionId, status: 'active',
        protocolVersion: this.initializeResult?.protocolVersion || '', adapterVersion: ADAPTER_VERSION,
        capabilities: this.initializeResult?.agentCapabilities || {}, authMethod,
      })
      return session
    } catch (error) {
      error.codexPhase ||= 'session_new'
      throw error
    }
  }

  async resumeSession({ agentRunId, mirrorRoot, workspaceRoot = '', persistedSession, authMethod = '' }) {
    await this.startAdapter()
    const sessionId = persistedSession?.sessionId
    const directories = sessionDirectories(workspaceRoot, mirrorRoot)
    if (workspaceRoot) await this.ensureDesktopWorkspace({ workspaceRoot: directories.cwd })
    if (sessionId && this.initializeResult?.agentCapabilities?.sessionCapabilities?.resume) {
      try {
        const response = await this.connection.resumeSession({ sessionId, ...directories, mcpServers: [] })
        return this._restoreSessionState({ agentRunId, sessionId, mirrorRoot, workspaceRoot: directories.cwd, authMethod, strategy: 'resume', configOptions: response.configOptions })
      } catch { /* load next */ }
    }
    if (sessionId && this.initializeResult?.agentCapabilities?.loadSession) {
      try {
        const response = await this.connection.loadSession({ sessionId, ...directories, mcpServers: [] })
        return this._restoreSessionState({ agentRunId, sessionId, mirrorRoot, workspaceRoot: directories.cwd, authMethod, strategy: 'load', configOptions: response.configOptions })
      } catch { /* recreate next */ }
    }
    const recreated = await this.createSession({ agentRunId, mirrorRoot, workspaceRoot: workspaceRoot ? directories.cwd : '', authMethod })
    this.repository?.upsertSession?.({ agentRunId, status: 'recreated', recoveryStrategy: 'recreate' })
    this.repository?.updateRun?.(agentRunId, { sessionRecreated: true })
    this.repository?.appendEvent?.({ agentRunId, type: 'session_recreated', payload: { previousSessionId: sessionId || '' } })
    return recreated
  }

  _restoreSessionState({ agentRunId, sessionId, mirrorRoot, workspaceRoot = mirrorRoot, authMethod, strategy, configOptions = [] }) {
    const session = {
      agentRunId, sessionId, mirrorRoot, workspaceRoot, activeStepId: '', onEvent: null,
      events: [], content: '', outputStarted: false, configKey: '', configOptions: configOptions || [],
    }
    this.configOptions = session.configOptions
    this.sessions.set(agentRunId, session)
    this.sessionToRun.set(sessionId, agentRunId)
    this.repository?.upsertSession?.({ agentRunId, backend: 'codex_acp', sessionId, status: 'active', recoveryStrategy: strategy, authMethod })
    return session
  }

  async _configureSession(session, settings = {}) {
    const desired = {
      model: String(settings.model || ''),
      reasoningEffort: String(settings.reasoningEffort || ''),
      fastMode: Boolean(settings.fastMode),
    }
    const configKey = JSON.stringify(desired)
    if (session.configKey === configKey) return
    try {
      const applyOption = async (configId, value) => {
        const option = session.configOptions.find((item) => item.id === configId)
        if (!option) {
          if (configId === 'fast-mode' && value === false) return
          throw new Error(`当前 Codex 运行时未声明配置 ${configId}；请刷新模型列表`)
        }
        if (option.currentValue === value) return
        if (!this.connection?.setSessionConfigOption) throw new Error('当前 Codex 运行时不支持显式模型配置')
        if (option.type === 'select' && !option.options?.flatMap(item => item.options || [item]).some((item) => item.value === value)) {
          throw new Error(`Codex 会话不支持配置 ${configId}=${value}`)
        }
        const response = await this.connection.setSessionConfigOption({
          sessionId: session.sessionId,
          configId,
          value,
          ...(option.type === 'boolean' ? { type: 'boolean' } : {}),
        })
        if (!response.configOptions?.some((item) => item.id === configId && item.currentValue === value)) {
          throw new Error(`Codex 配置回读不匹配：${configId}=${value} 未生效；已停止本次调用`)
        }
        session.configOptions = response.configOptions
        this.configOptions = session.configOptions
      }
      if (desired.model) await applyOption('model', desired.model)
      if (desired.reasoningEffort) await applyOption('reasoning_effort', desired.reasoningEffort)
      const fastOption = session.configOptions.find(option => option.id === 'fast-mode')
      await applyOption('fast-mode', fastOption?.type === 'select' ? (desired.fastMode ? 'on' : 'off') : desired.fastMode)
      const actual = sessionModelSnapshot(session.configOptions)
      if ((desired.model && actual.model !== desired.model) || (desired.reasoningEffort && actual.reasoningEffort !== desired.reasoningEffort) || actual.fastMode !== desired.fastMode) throw new Error('模型参数最终回读不匹配，已停止本次调用')
      session.configKey = configKey
      session.modelSnapshot = sessionModelSnapshot(session.configOptions)
    } catch (error) {
      error.codexPhase = 'session_config'
      throw error
    }
  }

  async prompt({ agentRunId, agentStepId, messages, continuationMessages = null, outputSchema = null, signal, onEvent = () => {}, allowExecFallback = true, settings = {} }) {
    let session = this.sessions.get(agentRunId)
    const useContextDelta = Boolean(session && Array.isArray(continuationMessages) && continuationMessages.length)
    const fullPromptText = codexPromptText({
      messages,
      outputSchema,
      displayTitle: settings.displayTitle,
      mirrorRoot: settings.mirrorRoot,
    })
    const promptText = codexPromptText({
      messages: useContextDelta ? continuationMessages : messages,
      outputSchema,
      displayTitle: settings.displayTitle,
      mirrorRoot: settings.mirrorRoot,
    })
    let approval = null
    try {
      approval = await this._requestApproval({
        projectId: settings.projectId,
        agentRunId,
        agentStepId,
        sessionId: session?.sessionId || '',
        actionType: 'model_call',
        permission: `运行 Codex 创作步骤：${settings.stepLabel || agentStepId}`,
        payload: { model: settings.model || '', reasoningEffort: settings.reasoningEffort || '', displayTitle: settings.displayTitle || '', promptDigest: createHash('sha256').update(promptText).digest('hex') },
      })
      if (!session) {
        const persistedSession = this.repository?.getRun?.(agentRunId)?.session || null
        session = persistedSession?.sessionId
          ? await this.resumeSession({
              agentRunId,
              mirrorRoot: settings.mirrorRoot,
              workspaceRoot: settings.workspaceRoot,
              authMethod: settings.authMethod,
              persistedSession,
            })
          : await this.createSession({ agentRunId, mirrorRoot: settings.mirrorRoot, workspaceRoot: settings.workspaceRoot, authMethod: settings.authMethod })
      }
      await this._configureSession(session, settings)
      const lockedRun = this.repository?.getRun?.(agentRunId)
      if (lockedRun && session.modelSnapshot?.verified && !lockedRun.modelRoutes?.codexCapabilitySnapshot) {
        this.repository?.updateRun?.(agentRunId, { modelRoutes: { ...lockedRun.modelRoutes,
          codexModel: session.modelSnapshot.model, codexReasoningEffort: session.modelSnapshot.reasoningEffort,
          codexFastMode: session.modelSnapshot.fastMode, codexCapabilitySnapshot: session.modelSnapshot } })
      }
      session.activeStepId = agentStepId
      session.onEvent = onEvent
      session.events = []
      session.content = ''
      session.outputStarted = false
      if (signal?.aborted) throw new CodexCancelledError()
      const abort = () => { void this.cancelTurn(agentRunId) }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await this.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: promptText }] })
        if (response.stopReason === 'cancelled') throw new CodexCancelledError()
        const result = {
          schemaVersion: 1,
          backend: 'codex_acp',
          sessionId: session.sessionId,
          content: session.content,
          structuredOutput: structuredFromContent(session.content),
          usage: response.usage || {},
          modelSnapshot: session.modelSnapshot || sessionModelSnapshot(session.configOptions),
          events: session.events,
          fallbackFrom: '',
          fallbackReason: '',
          outputStarted: session.outputStarted,
          contextReuse: useContextDelta ? 'delta' : 'full',
        }
        this.repository?.completeApproval?.(approval.id, { result: { backend: result.backend, outputStarted: result.outputStarted } })
        return result
      } finally {
        signal?.removeEventListener('abort', abort)
        session.activeStepId = ''
        session.onEvent = null
      }
    } catch (error) {
      const outputStarted = Boolean(session?.outputStarted)
      const fallback = allowExecFallback && this._canFallback(error, outputStarted)
      if (!fallback) {
        if (approval?.id && error.name !== 'CodexCancelledError') this.repository?.completeApproval?.(approval.id, { error: error.message })
        error.codexPartialResult = {
          schemaVersion: 1,
          backend: 'codex_acp',
          sessionId: session?.sessionId || '',
          content: session?.content || '',
          structuredOutput: structuredFromContent(session?.content || ''),
          usage: {},
          events: session?.events || [],
          fallbackFrom: '',
          fallbackReason: '',
          outputStarted,
          contextReuse: useContextDelta ? 'delta' : 'full',
        }
        throw error
      }
      try {
        const result = await this.runExecFallback({
          agentRunId, agentStepId, prompt: fullPromptText, outputSchema, signal, onEvent,
          mirrorRoot: settings.mirrorRoot || session?.mirrorRoot,
          workspaceRoot: settings.workspaceRoot || session?.workspaceRoot,
          model: settings.model || '',
          reasoningEffort: settings.reasoningEffort || '',
          fastMode: Boolean(settings.fastMode),
          fallbackReason: `${error.codexPhase || 'prompt_transport'}: ${error.message}`,
        })
        result.contextReuse = 'full'
        if (approval?.id) this.repository?.completeApproval?.(approval.id, { result: { backend: result.backend, fallbackReason: result.fallbackReason } })
        return result
      } catch (fallbackError) {
        if (approval?.id && fallbackError.name !== 'CodexCancelledError') this.repository?.completeApproval?.(approval.id, { error: fallbackError.message })
        throw fallbackError
      }
    }
  }

  _canFallback(error, outputStarted) {
    if (outputStarted || error?.name === 'CodexCancelledError' || FALLBACK_BLOCKED.test(String(error?.message || ''))) return false
    const phase = error?.codexPhase || 'prompt_transport'
    return ['adapter_start', 'initialize', 'session_new', 'prompt_transport'].includes(phase)
  }

  async runExecFallback({ agentRunId, agentStepId, prompt, outputSchema, signal, onEvent = () => {}, mirrorRoot, workspaceRoot = mirrorRoot, model = '', reasoningEffort = '', fastMode = false, fallbackReason = '' }) {
    const runtime = this.runtime || inspectCodexRuntime({ appPath: this.appPath, resourcesPath: this.resourcesPath })
    if (!runtime.cliAvailable || !mirrorRoot) throw new Error('Codex exec 兼容模式运行时不完整')
    const execDirectory = path.join(mirrorRoot, '.codex', 'exec')
    fs.mkdirSync(execDirectory, { recursive: true, mode: 0o700 })
    const nonce = `${agentStepId}-${Date.now()}`.replace(/[^a-zA-Z0-9_.-]/g, '-')
    const outputPath = path.join(execDirectory, `${nonce}.nscandidate.json`)
    const schemaPath = path.join(execDirectory, `${nonce}.schema.json`)
    if (outputSchema) fs.writeFileSync(schemaPath, JSON.stringify(outputSchema), { mode: 0o600 })
    const args = [
      'exec', '--json', '--output-last-message', outputPath,
      '--sandbox', 'read-only', '--cd', workspaceRoot,
      ...(path.resolve(workspaceRoot) === path.resolve(mirrorRoot) ? [] : ['--add-dir', mirrorRoot]),
      '--ignore-user-config', '--skip-git-repo-check',
      '-c', 'approval_policy="never"',
      ...execModelArgs({ model, reasoningEffort, fastMode }),
      ...(outputSchema && runtime.capabilities?.execOutputSchema ? ['--output-schema', schemaPath] : []),
      '-',
    ]
    const child = this.spawnProcess(runtime.paths.codexPath, args, {
      cwd: workspaceRoot,
      env: { ...process.env, INITIAL_AGENT_MODE: 'agent' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const events = []
    let stdout = ''
    let stderr = ''
    let cancelled = false
    const abort = () => { cancelled = true; child.kill() }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdin.end(prompt)
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + String(chunk)).slice(-MAX_EXEC_OUTPUT)
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = execEvent(line)
        events.push(event)
        onEvent({ ...event, backend: 'codex_exec', agentRunId, agentStepId })
      }
    })
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-64 * 1024) })
    const exit = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }))
    }).finally(() => signal?.removeEventListener('abort', abort))
    if (cancelled) throw new CodexCancelledError()
    if (exit.code !== 0) throw new Error(`Codex exec 运行失败（${exit.code ?? exit.signal}）：${stderr.trim().slice(-2000)}`)
    const content = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
    return {
      schemaVersion: 1,
      backend: 'codex_exec',
      sessionId: `exec-${agentRunId}-${Date.now()}`,
      content,
      structuredOutput: structuredFromContent(content),
      usage: {},
      modelSnapshot: { model, reasoningEffort, fastMode, verified: false, source: 'exec_explicit_arguments' },
      events,
      fallbackFrom: 'codex_acp',
      fallbackReason,
      outputStarted: Boolean(content || events.length),
    }
  }

  async cancelTurn(agentRunId) {
    const session = this.sessions.get(agentRunId)
    if (!session?.sessionId || !this.connection) return false
    await this.connection.cancel({ sessionId: session.sessionId })
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.agentRunId === agentRunId) this._settleApproval(approvalId, false, '运行已取消', true)
    }
    return true
  }

  async closeSession(agentRunId) {
    const session = this.sessions.get(agentRunId)
    if (!session) return false
    try {
      await this.cancelTurn(agentRunId)
      if (this.initializeResult?.agentCapabilities?.sessionCapabilities?.close) {
        await this.connection.closeSession({ sessionId: session.sessionId })
      }
    } finally {
      this.sessions.delete(agentRunId)
      this.sessionToRun.delete(session.sessionId)
      this.repository?.upsertSession?.({ agentRunId, status: 'closed', closedAt: new Date().toISOString() })
    }
    return true
  }

  async restartAdapter({ suppressErrors = false } = {}) {
    try { await this.shutdown() } catch (error) { if (!suppressErrors) throw error }
    return suppressErrors ? null : this.startAdapter()
  }

  async shutdown() {
    for (const agentRunId of [...this.sessions.keys()]) {
      try { await this.closeSession(agentRunId) } catch { /* exit continues */ }
    }
    for (const approvalId of [...this.pendingApprovals.keys()]) this._settleApproval(approvalId, false, '应用已退出', true)
    this.repository?.expireAllPendingApprovals?.()
    const child = this.process
    this.connection = null
    this.initializeResult = null
    this.process = null
    this.authenticatedMethod = ''
    if (child && !child.killed) child.kill()
  }

  async _handleSessionUpdate(params) {
    const agentRunId = this.sessionToRun.get(params.sessionId)
    const session = this.sessions.get(agentRunId)
    if (!session) return
    const type = updateType(params.update)
    const event = { type, text: updateText(params.update), update: params.update, agentRunId, agentStepId: session.activeStepId }
    if (['text_delta', 'reasoning', 'plan', 'tool_call', 'tool_result', 'usage'].includes(type)) session.outputStarted = true
    if (type === 'text_delta') session.content += event.text
    session.events.push(event)
    this.repository?.appendEvent?.({ agentRunId, agentStepId: session.activeStepId, type, summary: event.text.slice(0, 500), payload: params.update })
    session.onEvent?.(event)
    this.onGlobalEvent(event)
  }

  async _handlePermissionRequest(params) {
    const agentRunId = this.sessionToRun.get(params.sessionId)
    const session = this.sessions.get(agentRunId)
    if (!session) return { outcome: { outcome: 'cancelled' } }
    const kind = classifyTool(params.toolCall)
    try { safeToolLocations(session.mirrorRoot, params.toolCall) } catch (error) {
      this.repository?.appendEvent?.({ agentRunId, agentStepId: session.activeStepId, type: 'permission', summary: '路径越界已拒绝', payload: { kind, error: error.message } })
      return { outcome: { outcome: 'cancelled' } }
    }
    try {
      const approval = await this._requestApproval({
        projectId: this.repository?.getRun?.(agentRunId)?.projectId,
        agentRunId,
        agentStepId: session.activeStepId,
        sessionId: params.sessionId,
        externalRequestId: params.toolCall?.toolCallId || '',
        actionType: kind,
        permission: toolPermissionLabel(kind, params.toolCall),
        payload: { toolCall: params.toolCall, options: params.options },
      })
      const option = params.options.find((item) => item.kind === 'allow_once')
      if (!option) return { outcome: { outcome: 'cancelled' } }
      this.repository?.completeApproval?.(approval.id, { result: { optionId: option.optionId } })
      return { outcome: { outcome: 'selected', optionId: option.optionId } }
    } catch {
      return { outcome: { outcome: 'cancelled' } }
    }
  }

  async _readTextFile(params) {
    const agentRunId = this.sessionToRun.get(params.sessionId)
    const session = this.sessions.get(agentRunId)
    if (!session) throw new Error('ACP 会话不存在')
    return { content: readMirrorText(session.mirrorRoot, params.path, { maxBytes: Number(params.limit || 2 * 1024 * 1024) }) }
  }

  async _writeTextFile(params) {
    const agentRunId = this.sessionToRun.get(params.sessionId)
    const session = this.sessions.get(agentRunId)
    if (!session) throw new Error('ACP 会话不存在')
    const filePath = resolveMirrorPath(session.mirrorRoot, params.path)
    const relative = path.relative(session.mirrorRoot, filePath)
    const before = fs.existsSync(filePath) ? readMirrorText(session.mirrorRoot, relative) : ''
    const approval = await this._requestApproval({
      projectId: this.repository?.getRun?.(agentRunId)?.projectId,
      agentRunId,
      agentStepId: session.activeStepId,
      sessionId: params.sessionId,
      actionType: 'file',
      permission: `写入受控镜像文件：${relative}`,
      payload: { path: relative, before: before.slice(0, 32 * 1024), after: String(params.content || '').slice(0, 32 * 1024) },
    })
    const result = writeMirrorText(session.mirrorRoot, relative, params.content)
    this.repository?.completeApproval?.(approval.id, { result })
    return {}
  }

  _requestApproval(input) {
    if (!this.repository?.createApproval) return Promise.resolve({ id: `approval-${randomUUID()}` })
    const approval = this.repository.createApproval({
      ...input,
      expiresAt: new Date(Date.now() + this.approvalTimeoutMs).toISOString(),
    })
    if (input.actionType === 'model_call' && this.shouldAutoApprove(input)) {
      const resolved = this.repository.resolveApproval?.({
        id: approval.id,
        approved: true,
        note: '当前项目在本次应用会话内已授权自动批准模型调用',
      }) || { ...approval, status: 'approved' }
      this.onGlobalEvent({ type: 'permission_auto_approved', approval: resolved })
      return Promise.resolve(resolved)
    }
    this.onGlobalEvent({ type: 'permission', approval })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this._settleApproval(approval.id, false, '审批已过期', true), this.approvalTimeoutMs)
      this.pendingApprovals.set(approval.id, { approval, resolve, reject, timer, agentRunId: input.agentRunId })
    })
  }

  resolveApproval(input) {
    const approval = this.repository?.resolveApproval?.(input) || { id: input.id, status: input.approved ? 'approved' : 'rejected' }
    this._settleApproval(input.id, Boolean(input.approved), input.reason || '', false, approval)
    return approval
  }

  _settleApproval(id, approved, reason, expired = false, approval = null) {
    const pending = this.pendingApprovals.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingApprovals.delete(id)
    if (expired) this.repository?.resolveApproval?.({ id, approved: false, reason })
    if (approved) pending.resolve(approval || pending.approval)
    else if (expired) pending.reject(new CodexCancelledError(reason))
    else {
      const error = new Error(reason || '本次操作未获批准')
      error.name = 'CodexApprovalRejectedError'
      error.codexPhase = 'approval'
      pending.reject(error)
    }
  }
}

export { safeToolLocations }

export { ADAPTER_VERSION as CODEX_ACP_ADAPTER_VERSION, structuredFromContent }
