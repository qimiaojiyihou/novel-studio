import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { CodexAgentGateway } from './codex-agent-gateway.js'
import { grokConfigOptions, grokModelSnapshot } from './grok-config.js'

const ADAPTER_VERSION = 'native-acp'

export function inspectGrokRuntime({ configuredPath = '', env = process.env, platform = process.platform } = {}) {
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const expand = p => p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  const names = platform === 'win32' ? ['grok.exe', 'grok.cmd', 'grok'] : ['grok']
  const directories = [path.join(home, '.grok', 'bin'), path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', ...(env.PATH || '').split(path.delimiter)]
  const candidates = configuredPath ? [expand(configuredPath)] : directories.filter(Boolean).flatMap(dir => names.map(name => path.join(dir, name)))
  const executablePath = candidates.find(file => {
    try { if (!fs.statSync(file).isFile()) return false; fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return true } catch { return false }
  }) || ''
  return { available: Boolean(executablePath), cliAvailable: Boolean(executablePath), adapterAvailable: Boolean(executablePath),
    adapterVersion: ADAPTER_VERSION, cliVersion: '', integrity: executablePath ? 'external' : 'missing',
    executablePath: executablePath ? path.resolve(executablePath) : '', configuredPath,
    source: executablePath ? configuredPath ? 'configured' : 'detected' : '',
    capabilities: { execFallback: false }, environmentAuthAvailable: false }
}

export class GrokAgentGateway extends CodexAgentGateway {
  constructor({ settingsProvider = () => ({}), ...options } = {}) {
    super({ ...options, agentId: 'grok', agentName: 'Grok Build', acpBackend: 'grok_acp', adapterVersion: ADAPTER_VERSION, supportsExecFallback: false })
    this.settingsProvider = settingsProvider
    this.runtimePathOverride = null
  }

  _runtimeSnapshot() {
    return inspectGrokRuntime({ configuredPath: this.runtimePathOverride ?? this.settingsProvider().grokCliPath ?? '' })
  }

  useConfiguredPath(value) {
    const next = String(value || '').trim()
    if (next === (this.runtimePathOverride ?? this.settingsProvider().grokCliPath ?? '')) return false
    if (this.runtimeUsers || this.sessions.size) throw new Error('Grok 正在创作或保留会话，请结束当前任务后再修改 CLI 路径')
    this.runtimePathOverride = next
    return true
  }

  inspectRuntime() {
    this.runtime = { ...this._runtimeSnapshot(), cliVersion: this.initializeResult?.agentInfo?.version || '' }
    return { ...this.runtime, adapterStatus: this.connection ? 'ready' : 'stopped',
      protocolVersion: this.initializeResult?.protocolVersion || '',
      agentCapabilities: this.initializeResult?.agentCapabilities || {},
      authenticatedMethod: this.authenticatedMethod, configOptions: grokConfigOptions(this.configOptions),
      sessions: [...this.sessions.values()].map(s => ({ agentRunId: s.agentRunId, sessionId: s.sessionId, active: Boolean(s.activeStepId) })) }
  }

  async _startAdapter() {
    const runtime = this._runtimeSnapshot()
    this.runtime = runtime
    if (!runtime.available) throw Object.assign(new Error('未找到 Grok Build CLI，请安装官方 Grok Build，运行 grok login 后重试，或填写 CLI 路径'), { codexPhase: 'adapter_start' })
    const handlers = { sessionUpdate: p => this._handleSessionUpdate(p), requestPermission: p => this._handlePermissionRequest(p),
      readTextFile: p => this._readTextFile(p), writeTextFile: p => this._writeTextFile(p) }
    try {
      if (this.connectionFactory) this.connection = await this.connectionFactory({ handlers, runtime })
      else {
        // Ask-mode permissions stay enabled. The host never supplies a key or
        // launches an interactive browser login from a background generation.
        const child = this.spawnProcess(runtime.executablePath, ['--no-auto-update', 'agent', '--no-leader', 'stdio'], {
          cwd: path.dirname(runtime.executablePath), env: { ...process.env, XAI_API_KEY: '', GROK_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'],
          ...(process.platform === 'win32' && /\.(cmd|bat)$/i.test(runtime.executablePath) ? { shell: true } : {}),
        })
        this.process = child
        child.stderr?.on('data', () => {}) // Raw CLI logs may contain local authentication details.
        child.on('error', error => this.onGlobalEvent({ type: 'adapter_error', provider: 'grok', text: error.code || 'spawn_error' }))
        child.on('exit', (code, signal) => {
          this.onGlobalEvent({ type: 'adapter_exit', provider: 'grok', code, signal })
          if (this.process === child) { this.connection = null; this.process = null; this.authenticatedMethod = ''; this.initializeResult = null }
        })
        this.connection = new ClientSideConnection(() => handlers, ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)))
      }
      this.initializeResult = await this.connection.initialize({ protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'novel-studio', title: 'Novel Studio', version: '0.1.1' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } })
      if (String(this.initializeResult.protocolVersion) !== String(PROTOCOL_VERSION)) throw new Error(`Grok ACP 协议不兼容：${this.initializeResult.protocolVersion}`)
      return this.inspectRuntime()
    } catch (error) {
      error.codexPhase ||= this.connection ? 'initialize' : 'adapter_start'
      await this.restartAdapter({ suppressErrors: true })
      throw error
    }
  }

  async authenticate() {
    await this.startAdapter()
    if (this.authenticatedMethod === 'cached_token') return this.inspectRuntime()
    if (!this.initializeResult?.authMethods?.some(m => m.id === 'cached_token')) throw new Error('Grok 本机登录态未就绪，请先在终端运行 grok login，完成后重新测试')
    try {
      await this.connection.authenticate({ methodId: 'cached_token', _meta: { headless: true } })
      this.authenticatedMethod = 'cached_token'
    } catch (error) {
      throw Object.assign(new Error('Grok 本机登录态未就绪或已过期，请在终端运行 grok login，完成后重新测试'), { cause: error, codexPhase: 'authenticate' })
    }
    return this.inspectRuntime()
  }

  async ensureDesktopWorkspace({ workspaceRoot }) {
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) throw new Error('Grok 书籍工作区不存在')
    return { registered: true, workspaceName: path.basename(workspaceRoot) }
  }

  async createSession(input) { await this.authenticate(); return super.createSession({ ...input, authMethod: 'cached_token' }) }
  async resumeSession(input) { await this.authenticate(); return super.resumeSession({ ...input, authMethod: 'cached_token' }) }

  async _configureSession(session, settings = {}) {
    const desired = { model: String(settings.model || ''), reasoningEffort: String(settings.reasoningEffort || '') }
    const configKey = JSON.stringify(desired)
    if (session.configKey === configKey) return
    try {
      const set = async (id, value) => {
        if (!value) return
        const option = grokConfigOptions(session.configOptions).find(o => o.id === id)
        if (!option || !option.options.some(o => o.value === value)) throw new Error(`当前 Grok 模型未声明支持 ${id}=${value}，请刷新模型与强度列表`)
        if (option.currentValue === value) return
        const result = await this.connection.setSessionConfigOption({ sessionId: session.sessionId, configId: id, value })
        session.configOptions = result.configOptions || []
        if (grokConfigOptions(session.configOptions).find(o => o.id === id)?.currentValue !== value) throw new Error(`Grok 设置回读不匹配：${id}=${value} 未生效`)
      }
      await set('model', desired.model)
      // A model change can change the effort options; validate the new list.
      await set('reasoning_effort', desired.reasoningEffort)
      session.modelSnapshot = grokModelSnapshot(session.configOptions)
      session.configKey = configKey
      this.configOptions = session.configOptions
    } catch (error) { error.codexPhase = 'session_config'; throw error }
  }

  async testConnection({ cwd, model = '', reasoningEffort = '' } = {}) {
    return this.withRuntimeUsage(async () => {
      await this.authenticate()
      const created = await this.connection.newSession({ cwd, additionalDirectories: [], mcpServers: [] })
      const diagnostic = { sessionId: created.sessionId, configOptions: created.configOptions || [], configKey: '' }
      try {
        await this._configureSession(diagnostic, { model, reasoningEffort })
        return { ok: true, provider: 'grok', sessionCreated: true, adapterVersion: ADAPTER_VERSION,
          protocolVersion: this.initializeResult.protocolVersion, configOptions: grokConfigOptions(diagnostic.configOptions),
          selected: diagnostic.modelSnapshot, runtime: this.inspectRuntime(), refreshedAt: new Date().toISOString() }
      } finally {
        if (this.initializeResult?.agentCapabilities?.sessionCapabilities?.close) await this.connection.closeSession({ sessionId: created.sessionId })
      }
    })
  }
}
