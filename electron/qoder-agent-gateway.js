import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { CodexAgentGateway } from './codex-agent-gateway.js'

const QODER_ACP_ADAPTER_VERSION = 'native-acp'

function flattenedOptions(option = {}) {
  return (option.options || []).flatMap((item) => item.options || [item])
}

function qoderModelSnapshot(configOptions = []) {
  const option = configOptions.find((item) => item.id === 'model')
  const model = String(option?.currentValue || 'auto')
  const selected = flattenedOptions(option).find((item) => item.value === model)
  return {
    provider: 'qoder',
    model,
    modelName: selected?.name || model,
    reasoningEffort: '',
    fastMode: false,
    verified: Boolean(option),
    source: option ? 'acp_config_readback' : 'acp_default',
  }
}

function executableNames(platform = process.platform) {
  return platform === 'win32'
    ? [
        'qoder.exe', 'qoder.cmd', 'qoder',
        'qodercli.exe', 'qodercli.cmd', 'qodercli',
        'qodercn.exe', 'qodercn.cmd', 'qodercn',
        'qoderclicn.exe', 'qoderclicn.cmd', 'qoderclicn',
      ]
    : ['qoder', 'qodercli', 'qodercn', 'qoderclicn']
}

function isExecutable(filePath, platform = process.platform) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (platform !== 'win32') fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function qoderExecutableCandidates({ configuredPath = '', env = process.env, platform = process.platform } = {}) {
  const names = executableNames(platform)
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const pathEntries = String(env.PATH || '').split(path.delimiter).filter(Boolean)
  const knownDirectories = platform === 'win32'
    ? [
        path.join(env.APPDATA || '', 'npm'),
        path.join(env.LOCALAPPDATA || '', 'Programs', 'qoder'),
      ]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        path.join(home, '.local', 'bin'),
        path.join(home, '.qoder-cn', 'entry'),
        path.join(home, '.qoder', 'bin'),
        path.join(home, '.npm-global', 'bin'),
      ]
  return [...new Set([
    String(configuredPath || '').trim(),
    ...pathEntries.flatMap((directory) => names.map((name) => path.join(directory, name))),
    ...knownDirectories.filter(Boolean).flatMap((directory) => names.map((name) => path.join(directory, name))),
  ].filter(Boolean).map((candidate) => path.resolve(candidate)))]
}

export function inspectQoderRuntime({ configuredPath = '', env = process.env, platform = process.platform } = {}) {
  const executablePath = qoderExecutableCandidates({ configuredPath, env, platform })
    .find((candidate) => isExecutable(candidate, platform)) || ''
  return {
    available: Boolean(executablePath),
    adapterAvailable: Boolean(executablePath),
    cliAvailable: Boolean(executablePath),
    adapterVersion: QODER_ACP_ADAPTER_VERSION,
    cliVersion: '',
    integrity: executablePath ? 'external' : 'missing',
    environmentAuthAvailable: Boolean(env.QODER_PERSONAL_ACCESS_TOKEN),
    source: executablePath
      ? (configuredPath && path.resolve(configuredPath) === executablePath ? 'configured' : 'detected')
      : '',
    executablePath,
    configuredPath: String(configuredPath || '').trim(),
    capabilities: { execFallback: false },
  }
}

export class QoderAgentGateway extends CodexAgentGateway {
  constructor({ settingsProvider = () => ({}), ...options } = {}) {
    super({
      ...options,
      agentId: 'qoder',
      agentName: 'Qoder',
      acpBackend: 'qoder_acp',
      adapterVersion: QODER_ACP_ADAPTER_VERSION,
      supportsExecFallback: false,
    })
    this.settingsProvider = settingsProvider
    this.runtimePathOverride = null
  }

  _runtimeSnapshot() {
    return inspectQoderRuntime({ configuredPath: this.runtimePathOverride ?? this.settingsProvider()?.qoderCliPath ?? '' })
  }

  useConfiguredPath(value) {
    const next = String(value || '').trim()
    const changed = next !== (this.runtimePathOverride ?? this.settingsProvider()?.qoderCliPath ?? '')
    this.runtimePathOverride = next
    return changed
  }

  inspectRuntime() {
    const detected = this._runtimeSnapshot()
    this.runtime = {
      ...detected,
      cliVersion: this.initializeResult?.agentInfo?.version || this.runtime?.cliVersion || '',
    }
    return {
      ...this.runtime,
      adapterStatus: this.connection ? 'ready' : this.process ? 'starting' : 'stopped',
      protocolVersion: this.initializeResult?.protocolVersion || '',
      agentCapabilities: this.initializeResult?.agentCapabilities || {},
      authMethods: this.initializeResult?.authMethods || [],
      authenticatedMethod: this.authenticatedMethod,
      configOptions: this.configOptions || [],
      sessions: [...this.sessions.values()].map((session) => ({
        agentRunId: session.agentRunId,
        sessionId: session.sessionId,
        active: Boolean(session.activeStepId),
      })),
    }
  }

  async _startAdapter() {
    const runtime = this._runtimeSnapshot()
    this.runtime = runtime
    if (!runtime.available) {
      const error = new Error('Qoder CLI 未找到；请安装 Qoder CLI，或在 Agent 设置中填写 qoder / qodercn 可执行文件路径')
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
        this.process = this.spawnProcess(runtime.executablePath, ['--acp'], {
          cwd: path.dirname(runtime.executablePath),
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          ...(process.platform === 'win32' && /\.(cmd|bat)$/i.test(runtime.executablePath) ? { shell: true } : {}),
        })
        this.process.stderr?.on('data', (chunk) => this.onGlobalEvent({
          type: 'adapter_log',
          provider: 'qoder',
          text: String(chunk).slice(0, 4096),
        }))
        this.process.on('exit', (code, signal) => {
          this.onGlobalEvent({ type: 'adapter_exit', provider: 'qoder', code, signal })
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
        const error = new Error(`Qoder ACP 协议不兼容：${this.initializeResult.protocolVersion}`)
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

  async authenticate() {
    await this.startAdapter()
    this.authenticatedMethod = this.runtime.environmentAuthAvailable ? 'environment' : 'qoder-login'
    return this.inspectRuntime()
  }

  async ensureDesktopWorkspace({ workspaceRoot }) {
    if (!workspaceRoot || !fs.existsSync(path.resolve(workspaceRoot))) throw new Error('Qoder 书籍工作区不存在')
    return { registered: true, cached: true, workspaceName: path.basename(workspaceRoot) }
  }

  async _configureSession(session, settings = {}) {
    const desiredModel = String(settings.model || this.settingsProvider()?.qoderModel || 'auto').trim() || 'auto'
    const configKey = JSON.stringify({ model: desiredModel })
    if (session.configKey === configKey) return
    try {
      const modelOption = session.configOptions.find((item) => item.id === 'model')
      if (!modelOption) throw new Error('当前 Qoder ACP 未声明模型配置；请先测试连接并刷新模型列表')
      if (!flattenedOptions(modelOption).some((item) => item.value === desiredModel)) {
        throw new Error(`当前 Qoder 账号不支持模型 ${desiredModel}`)
      }
      if (modelOption.currentValue !== desiredModel) {
        if (!this.connection?.setSessionConfigOption) throw new Error('当前 Qoder ACP 不支持显式模型配置')
        const response = await this.connection.setSessionConfigOption({
          sessionId: session.sessionId,
          configId: 'model',
          value: desiredModel,
        })
        if (!response.configOptions?.some((item) => item.id === 'model' && item.currentValue === desiredModel)) {
          throw new Error(`Qoder 模型回读不匹配：${desiredModel} 未生效；已停止本次调用`)
        }
        session.configOptions = response.configOptions
        this.configOptions = session.configOptions
      }
      const snapshot = qoderModelSnapshot(session.configOptions)
      if (snapshot.model !== desiredModel) throw new Error(`Qoder 模型最终回读不匹配：${desiredModel} 未生效`)
      session.configKey = configKey
      session.modelSnapshot = snapshot
    } catch (error) {
      error.codexPhase = 'session_config'
      throw error
    }
  }

  async testConnection({ cwd, model = '' } = {}) {
    await this.startAdapter()
    const created = await this.connection.newSession({ cwd, additionalDirectories: [], mcpServers: [] })
    this.configOptions = created.configOptions || []
    const diagnostic = {
      sessionId: created.sessionId,
      configOptions: created.configOptions || [],
      configKey: '',
      modelSnapshot: null,
    }
    try {
      await this._configureSession(diagnostic, { model })
      return {
        ok: true,
        provider: 'qoder',
        protocolVersion: this.initializeResult?.protocolVersion || '',
        sessionCreated: Boolean(created?.sessionId),
        adapterVersion: QODER_ACP_ADAPTER_VERSION,
        configOptions: diagnostic.configOptions,
        models: [],
        selected: diagnostic.modelSnapshot,
        runtime: this.inspectRuntime(),
        refreshedAt: new Date().toISOString(),
      }
    } finally {
      if (created?.sessionId && this.initializeResult?.agentCapabilities?.sessionCapabilities?.close) {
        await this.connection.closeSession({ sessionId: created.sessionId })
      }
    }
  }
}

export { QODER_ACP_ADAPTER_VERSION }
