import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CodexAgentGateway, CodexCancelledError, codexPromptText, structuredFromContent } from './codex-agent-gateway.js'
import { resolveMirrorPath } from './codex-project-mirror.js'

const SDK_VERSION = '0.3.310'
// Directory scanners can traverse a symlink below an otherwise valid root.
// Expose exact-file tools only; every access is checked after resolving links.
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit'])
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

export function normalizeClaudeEffort(value = '') {
  const effort = String(value || '').trim()
  if (effort && !CLAUDE_EFFORT_LEVELS.includes(effort)) throw new Error(`Claude Code 不支持思考强度：${effort}`)
  return effort
}

export function claudeResultError(message) {
  const detail = (message.errors || []).join('\n') || message.result || `Claude Code 运行未完成：${message.subtype}`
  if (/insufficient[ _]balance|billing_error/i.test(detail)) {
    return Object.assign(new Error('Claude Code 当前服务余额不足，请补充该服务额度后重试；本次未生成可确认候选'), { code: 'CLAUDE_BILLING_LIMIT' })
  }
  return new Error(detail)
}

export function claudeSdkLaunchOptions(executablePath, { execPath = process.execPath, electron = Boolean(process.versions.electron) } = {}) {
  // Resolve npm/bun symlinks so the SDK recognizes cli.js as JavaScript rather
  // than invoking the shebang through /usr/bin/env node on a GUI-only PATH.
  const cliPath = fs.realpathSync(executablePath)
  return { pathToClaudeCodeExecutable: cliPath, executable: execPath, executableArgs: [],
    nodeEnvironment: electron && /\.(?:[cm]?js)$/i.test(cliPath) ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

export function claudeCatalogIdentity({ configuredPath = '', authMethod = 'cli', env = process.env } = {}) {
  const runtime = inspectClaudeRuntime({ configuredPath, env })
  const config = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude')
  const stamp = file => { try { const stat = fs.statSync(file); return `${file}:${stat.size}:${stat.mtimeMs}` } catch { return `${file}:missing` } }
  return createHash('sha256').update(JSON.stringify([runtime.executablePath, stamp(runtime.executablePath), authMethod, config,
    stamp(path.join(config, 'settings.json')), stamp(path.join(config, '.credentials.json')),
    authMethod === 'environment' ? env.ANTHROPIC_API_KEY || '' : '', env.ANTHROPIC_BASE_URL || ''])).digest('hex')
}

// Keep CLI authentication compatible without loading user hooks, permissions,
// plugins, shell environment, or project settings into an embedded agent.
export function claudeQueryEnvironment({ env = process.env, authMethod = 'cli', readFile = fs.readFileSync } = {}) {
  const result = { ...env }
  if (authMethod !== 'environment') {
    delete result.ANTHROPIC_API_KEY
    delete result.ANTHROPIC_AUTH_TOKEN
    const config = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude')
    let user
    try { user = JSON.parse(readFile(path.join(config, 'settings.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Claude Code 用户认证配置读取失败，请检查 settings.json 格式') }
    for (const key of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) {
      if (typeof user?.env?.[key] === 'string' && user.env[key]) result[key] = user.env[key]
    }
  } else {
    delete result.ANTHROPIC_AUTH_TOKEN
    delete result.CLAUDE_CODE_OAUTH_TOKEN
  }
  // Explicit SDK effort, or CLI model default, owns this setting.
  delete result.CLAUDE_CODE_EFFORT_LEVEL
  // Compatible gateways may reject new prompt-cache fields introduced by the
  // CLI. Cache hints are optional; leave the official endpoint unchanged.
  if (result.ANTHROPIC_BASE_URL) {
    let official
    try { official = new URL(result.ANTHROPIC_BASE_URL).hostname === 'api.anthropic.com' }
    catch { throw new Error('Claude Code 服务地址格式无效，请检查本机认证配置') }
    if (!official) result.DISABLE_PROMPT_CACHING = '1'
  }
  return result
}

export function claudeExecutableCandidates({ configuredPath = '', env = process.env, platform = process.platform } = {}) {
  const home = env.HOME || env.USERPROFILE || os.homedir()
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const expand = value => value.startsWith('~/') ? path.join(home, value.slice(2)) : value
  const directories = [
    ...String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean),
    path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.npm-global', 'bin'),
    ...(platform === 'win32' ? [path.join(env.APPDATA || home, 'npm')] : ['/opt/homebrew/bin', '/usr/local/bin']),
  ]
  // An explicit but invalid selection must not silently run a different CLI.
  return [...new Set((configuredPath.trim() ? [expand(configuredPath.trim())] : directories.flatMap(dir => names.map(name => path.join(dir, name)))).map(item => path.resolve(item)))]
}

export function inspectClaudeRuntime(options = {}) {
  const executablePath = claudeExecutableCandidates(options).find(candidate => {
    try {
      if (!fs.statSync(candidate).isFile()) return false
      if ((options.platform || process.platform) !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
      return true
    } catch { return false }
  }) || ''
  return {
    available: Boolean(executablePath), cliAvailable: Boolean(executablePath), adapterAvailable: true,
    adapterVersion: SDK_VERSION, cliVersion: '', executablePath,
    source: executablePath ? (options.configuredPath ? 'configured' : 'detected') : '',
    integrity: executablePath ? 'external' : 'missing',
    environmentAuthAvailable: Boolean((options.env || process.env).ANTHROPIC_API_KEY),
    capabilities: { streaming: true, resume: true, cancellation: true, structuredOutput: true, execFallback: false },
  }
}

// Used in PreToolUse, even for reads that the CLI would otherwise auto-approve.
// No shell, subagents, user plugins, or externally configured MCP tools are exposed.
export function validateClaudeTool(root, name, input = {}) {
  if (!FILE_TOOLS.has(name)) throw new Error(`当前创作任务未开放工具 ${name}`)
  const requested = input.file_path
  if (typeof requested !== 'string' || !requested) throw new Error('工具缺少镜像文件路径')
  return resolveMirrorPath(root, requested)
}

async function defaultQuery(input) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  return query(input)
}

export class ClaudeAgentGateway extends CodexAgentGateway {
  constructor({ settingsProvider = () => ({}), queryFactory = defaultQuery, diagnosticTimeoutMs = 20000, modelCatalogFile = '', catalogIdentity = claudeCatalogIdentity, ...options } = {}) {
    super({ ...options, agentId: 'claude', agentName: 'Claude Code', acpBackend: 'claude_sdk', adapterVersion: SDK_VERSION, supportsExecFallback: false })
    this.settingsProvider = settingsProvider
    this.queryFactory = queryFactory
    this.diagnosticTimeoutMs = diagnosticTimeoutMs
    this.runtimePathOverride = null
    this.diagnostics = new Set()
    this.modelCatalogFile = modelCatalogFile
    this.catalogIdentity = catalogIdentity
    this.modelCatalog = null
    try { if (modelCatalogFile) this.modelCatalog = JSON.parse(fs.readFileSync(modelCatalogFile, 'utf8')) } catch { /* first launch or invalid cache */ }
  }

  catalogSource({ configuredPath, authMethod } = {}) {
    return { configuredPath: configuredPath ?? this.runtimePathOverride ?? this.settingsProvider()?.claudeCliPath ?? '',
      authMethod: authMethod || this.settingsProvider()?.claudeAuthMethod || 'cli' }
  }

  getModelCatalog(source = this.catalogSource()) {
    const cached = this.modelCatalog
    if (cached?.identity !== this.catalogIdentity(source) || !Array.isArray(cached.models) || cached.models.length > 500) return { configOptions: [], refreshedAt: '', cached: false }
    const models = cached.models.filter(item => item && typeof item.value === 'string' && item.value).map(item => ({
      value: item.value, name: String(item.name || item.value), description: String(item.description || ''), resolvedModel: String(item.resolvedModel || ''),
      supportsEffort: item.supportsEffort, supportedEffortLevels: Array.isArray(item.supportedEffortLevels) ? item.supportedEffortLevels.filter(value => CLAUDE_EFFORT_LEVELS.includes(value)) : [],
    }))
    return { configOptions: [{ id: 'model', type: 'select', name: 'Claude Code 模型', options: models }], refreshedAt: cached.refreshedAt, cached: true }
  }

  useConfiguredPath(value) {
    const next = String(value || '').trim()
    const changed = next !== (this.runtimePathOverride ?? this.settingsProvider()?.claudeCliPath ?? '')
    this.runtimePathOverride = next
    return changed
  }

  inspectRuntime() {
    const detected = inspectClaudeRuntime({ configuredPath: this.runtimePathOverride ?? this.settingsProvider()?.claudeCliPath ?? '' })
    const catalog = this.getModelCatalog()
    return { ...detected, cliVersion: this.runtime?.cliVersion || '', adapterStatus: this.sessions.size ? 'ready' : 'stopped',
      authenticatedMethod: this.authenticatedMethod, configOptions: catalog.configOptions, modelCatalog: catalog,
      sessions: [...this.sessions.values()].map(s => ({ agentRunId: s.agentRunId, sessionId: s.sessionId, active: Boolean(s.activeStepId) })) }
  }

  _options({ cwd, mirrorRoot, model = '', reasoningEffort = '', authMethod = 'cli', abortController, hooks, canUseTool, resume, outputSchema, runtime = this.inspectRuntime() }) {
    if (!runtime.available) throw new Error('Claude Code CLI 未找到；请安装官方 Claude Code，或填写可执行文件路径')
    if (authMethod === 'environment' && !runtime.environmentAuthAvailable) throw new Error('未检测到 ANTHROPIC_API_KEY；请配置应用进程环境变量后重试')
    const env = claudeQueryEnvironment({ authMethod })
    const effort = normalizeClaudeEffort(reasoningEffort)
    const launch = claudeSdkLaunchOptions(runtime.executablePath)
    Object.assign(env, launch.nodeEnvironment)
    return {
      pathToClaudeCodeExecutable: launch.pathToClaudeCodeExecutable, cwd, env,
      executable: launch.executable, executableArgs: launch.executableArgs,
      abortController, model: model || undefined, resume: resume || undefined,
      ...(effort ? { effort } : {}),
      ...(mirrorRoot && cwd !== mirrorRoot ? { additionalDirectories: [mirrorRoot] } : {}),
      includePartialMessages: true, persistSession: true,
      settingSources: [], mcpServers: {}, plugins: [],
      tools: [...FILE_TOOLS], allowedTools: [], permissionMode: 'default',
      hooks, canUseTool, maxTurns: 40,
      systemPrompt: '你是 Novel Studio 的小说创作助手。只在当前任务镜像目录读取快照、生成候选，不修改真实书库。按作者要求和输出约定创作。',
      ...(outputSchema ? { outputFormat: { type: 'json_schema', schema: outputSchema } } : {}),
    }
  }

  async testConnection({ cwd, model = '', configuredPath, authMethod = this.settingsProvider()?.claudeAuthMethod || 'cli' } = {}) {
    const source = this.catalogSource({ configuredPath, authMethod })
    const sourceIdentity = this.catalogIdentity(source)
    const controller = new AbortController()
    let query
    const timer = setTimeout(() => { controller.abort(); query?.close?.() }, this.diagnosticTimeoutMs)
    this.diagnostics.add(controller)
    let abortListener
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(new Error('Claude Code 诊断已取消或超时；请检查本机 CLI 后重试'))
      controller.signal.addEventListener('abort', abortListener, { once: true })
    })
    try {
      return await Promise.race([aborted, (async () => {
        const runtime = configuredPath === undefined ? this.inspectRuntime() : inspectClaudeRuntime({ configuredPath: String(configuredPath || '') })
        query = await this.queryFactory({ prompt: (async function* () {})(), options: this._options({ cwd, model, authMethod, abortController: controller, runtime }) })
        if (controller.signal.aborted) { query?.close?.(); throw new Error('Claude Code 诊断已取消') }
        const [models, account] = await Promise.all([query.supportedModels(), query.accountInfo()])
        if (controller.signal.aborted) throw new Error('Claude Code 诊断已取消')
        const hasSource = value => value && value !== 'none'
        if (!hasSource(account?.tokenSource) && !hasSource(account?.apiKeySource) && !account?.subscriptionType && !account?.email && (!account?.apiProvider || account.apiProvider === 'firstParty')) {
          throw new Error('Claude Code 尚未登录；请在终端执行 claude auth login，完成后重新测试')
        }
        this.authenticatedMethod = authMethod === 'environment' ? 'api-key' : 'claude-login'
        this.configOptions = [{ id: 'model', type: 'select', currentValue: model, name: 'Claude Code 模型',
          options: models.map(item => ({ value: item.value, name: item.displayName || item.value, description: item.description || '',
            resolvedModel: item.resolvedModel || '', supportsEffort: item.supportsEffort,
            supportedEffortLevels: item.supportedEffortLevels || [] })) }]
        const refreshedAt = new Date().toISOString()
        if (sourceIdentity === this.catalogIdentity(source) && sourceIdentity === this.catalogIdentity(this.catalogSource())) {
          this.modelCatalog = { identity: sourceIdentity, models: this.configOptions[0].options, refreshedAt }
          if (this.modelCatalogFile) {
            const temporary = `${this.modelCatalogFile}.${process.pid}.tmp`
            try {
              fs.mkdirSync(path.dirname(this.modelCatalogFile), { recursive: true, mode: 0o700 })
              fs.writeFileSync(temporary, JSON.stringify(this.modelCatalog), { mode: 0o600 })
              fs.renameSync(temporary, this.modelCatalogFile)
            } catch { /* a readable live directory should still work on a read-only disk */ }
            finally { try { fs.rmSync(temporary, { force: true }) } catch {} }
          }
        }
        return { ok: true, provider: 'claude', sessionCreated: false, adapterVersion: SDK_VERSION,
          configOptions: this.configOptions, models: this.configOptions[0].options,
          selected: { provider: 'claude', model, verified: false, source: 'sdk_catalog' }, runtime: this.inspectRuntime(), refreshedAt }
      })()])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abortListener)
      this.diagnostics.delete(controller)
      query?.close?.()
    }
  }

  async prompt({ agentRunId, agentStepId, messages, continuationMessages = null, outputSchema = null, signal, onEvent = () => {}, settings = {} }) {
    if (this.sessions.get(agentRunId)?.activeStepId) throw new Error('当前 Claude Code 会话已有运行中的步骤')
    const root = fs.realpathSync(settings.mirrorRoot)
    const workspaceRoot = fs.realpathSync(settings.workspaceRoot || root)
    const descriptorPath = path.join(workspaceRoot, '.novel-studio-project.json')
    if (settings.projectId && fs.existsSync(descriptorPath)) {
      const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
      if (descriptor.projectId !== settings.projectId) throw new Error('Claude Code 工作区与书籍不匹配，已停止运行')
    }
    const prior = this.sessions.get(agentRunId)
    if (prior && prior.mirrorRoot !== root) throw new Error('Claude Code 会话镜像发生变化，已停止运行')
    if (prior && prior.workspaceRoot !== workspaceRoot) throw new Error('Claude Code 会话书籍项目发生变化，已停止运行')
    const persisted = this.repository?.getRun?.(agentRunId)?.session
    if (persisted?.sessionId && persisted.backend !== 'claude_sdk') throw new Error('会话提供方不匹配，已停止 Claude Code 运行')
    const session = prior || { agentRunId, sessionId: persisted?.sessionId || '', mirrorRoot: root, workspaceRoot,
      model: settings.model || '', reasoningEffort: normalizeClaudeEffort(settings.reasoningEffort), completed: false, runtime: this.inspectRuntime() }
    const contextReuse = session.completed && continuationMessages?.length ? 'delta' : 'full'
    const text = codexPromptText({ messages: contextReuse === 'delta' ? continuationMessages : messages, outputSchema, displayTitle: settings.displayTitle, mirrorRoot: root })
    const controller = new AbortController()
    const abort = () => { void this.cancelTurn(agentRunId) }
    Object.assign(session, { activeStepId: agentStepId, controller, query: null, events: [], content: '', outputStarted: false, completed: false })
    this.sessions.set(agentRunId, session)
    signal?.addEventListener('abort', abort, { once: true })
    const emit = (type, text = '', payload = {}) => {
      const event = { type, text, ...payload, backend: 'claude_sdk', agentRunId, agentStepId }
      if (type === 'text_delta') {
        if (session.content.length + text.length > 8 * 1024 * 1024) throw new Error('Claude Code 输出超过 8 MiB 上限，已停止本次运行')
        session.content += text
      }
      if (['text_delta', 'tool_call', 'tool_result'].includes(type)) session.outputStarted = true
      if (session.events.length < 200) session.events.push(event)
      this.eventBuffer.push({ agentRunId, agentStepId, type, text, summary: text.slice(0, 500), payload: { ...payload, text } })
      onEvent(event)
      this.onGlobalEvent(event)
    }
    let approval, result, structuredOutput
    const snapshot = () => ({ schemaVersion: 1, backend: 'claude_sdk', sessionId: session.sessionId, content: session.content,
      structuredOutput: structuredOutput ?? structuredFromContent(session.content), usage: result?.usage || {}, modelSnapshot: session.modelSnapshot,
      events: session.events, outputStarted: session.outputStarted, fallbackFrom: '', fallbackReason: '', contextReuse })
    try {
      if (signal?.aborted) throw new CodexCancelledError()
      approval = await this._requestApproval({ projectId: settings.projectId, agentRunId, agentStepId, sessionId: session.sessionId,
        actionType: 'model_call', permission: `运行 Claude Code 创作步骤：${settings.stepLabel || agentStepId}`,
        payload: { model: session.model, reasoningEffort: session.reasoningEffort, promptDigest: createHash('sha256').update(text).digest('hex') } })
      if (controller.signal.aborted) throw new CodexCancelledError()
      const authorize = async (name, input, toolUseId = '') => {
        validateClaudeTool(root, name, input)
        if (controller.signal.aborted) throw new CodexCancelledError()
        if (['Write', 'Edit'].includes(name)) {
          const allowed = await this._requestApproval({ projectId: settings.projectId, agentRunId, agentStepId, sessionId: session.sessionId,
            actionType: 'file', externalRequestId: toolUseId, permission: `Claude Code 写入候选镜像：${input.file_path}`,
            payload: { tool: name, path: input.file_path } })
          // A file approval is scoped to this one invocation, never a CLI-wide rule.
          this.repository?.completeApproval?.(allowed.id, { result: { tool: name, path: input.file_path, approved: true } })
        }
      }
      const options = this._options({ cwd: workspaceRoot, mirrorRoot: root, model: session.model, reasoningEffort: session.reasoningEffort,
        authMethod: settings.authMethod === 'api-key' ? 'environment' : 'cli', runtime: session.runtime,
        abortController: controller, resume: session.sessionId, outputSchema,
        hooks: { PreToolUse: [{ hooks: [async input => {
          try {
            // StructuredOutput is the SDK's schema-return tool, not filesystem access.
            if (input.tool_name === 'StructuredOutput' && outputSchema) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
            await authorize(input.tool_name, input.tool_input || {}, input.tool_use_id)
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
          } catch (error) {
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: error.message } }
          }
        }] }] },
        // Fail closed if a CLI skips/does not support the hook: the callback
        // independently checks paths and only permits reads; writes need the hook.
        canUseTool: async (name, input) => {
          try {
            if (name === 'StructuredOutput' && outputSchema) return { behavior: 'allow', updatedInput: input }
            validateClaudeTool(root, name, input)
            if (['Write', 'Edit'].includes(name)) return { behavior: 'deny', message: '镜像写入需要逐次审批，请直接返回候选正文' }
            return { behavior: 'allow', updatedInput: input }
          } catch (error) { return { behavior: 'deny', message: error.message } }
        },
      })
      session.query = await this.queryFactory({ prompt: (async function* () { yield { type: 'user', session_id: session.sessionId || '', message: { role: 'user', content: text }, parent_tool_use_id: null } })(), options })
      if (controller.signal.aborted) throw new CodexCancelledError()
      const streamed = new Set()
      for await (const message of session.query) {
        if (controller.signal.aborted) throw new CodexCancelledError()
        if (message.type === 'system' && message.subtype === 'init') {
          session.sessionId = message.session_id
          this.runtime = { cliVersion: message.claude_code_version || '' }
          session.modelSnapshot = { provider: 'claude', model: message.model || settings.model || '', modelName: message.model || settings.model || 'Claude Code 默认模型',
            verified: Boolean(message.model), source: 'sdk_init', reasoningEffort: session.reasoningEffort, fastMode: false }
          this.repository?.upsertSession?.({ agentRunId, backend: 'claude_sdk', sessionId: session.sessionId, status: 'active',
            protocolVersion: 'sdk', adapterVersion: SDK_VERSION, authMethod: settings.authMethod || 'claude-login', recoveryStrategy: options.resume ? 'resume' : 'new' })
          const run = this.repository?.getRun?.(agentRunId)
          if (run && session.modelSnapshot.verified && !run.modelRoutes?.codexCapabilitySnapshot) this.repository?.updateRun?.(agentRunId, { modelRoutes: {
            ...run.modelRoutes, codexModel: session.modelSnapshot.model, codexReasoningEffort: session.reasoningEffort, codexFastMode: false, codexCapabilitySnapshot: session.modelSnapshot } })
          emit('status', `Claude Code 会话已就绪 · ${session.modelSnapshot.modelName}`)
        } else if (message.type === 'stream_event' && !message.parent_tool_use_id) {
          const delta = message.event?.delta
          if (delta?.type === 'text_delta') { streamed.add(message.event?.message_id || 'turn'); emit('text_delta', delta.text || '') }
        } else if (message.type === 'assistant' && !message.parent_tool_use_id) {
          for (const block of message.message?.content || []) {
            if (block.type === 'text' && !streamed.size) emit('text_delta', block.text || '')
            if (block.type === 'tool_use') emit('tool_call', block.name || '', { toolCallId: block.id, tool: block.name })
          }
          streamed.clear()
        } else if (message.type === 'user') {
          for (const block of message.message?.content || []) if (block.type === 'tool_result') emit('tool_result', block.is_error ? '工具执行失败' : '工具执行完成', { toolCallId: block.tool_use_id })
        } else if (message.type === 'result') {
          result = message
          if (message.is_error || message.subtype !== 'success') throw claudeResultError(message)
          structuredOutput = message.structured_output
          if (structuredOutput !== undefined && !session.content) emit('text_delta', JSON.stringify(structuredOutput))
          if (!session.content && message.result) emit('text_delta', message.result)
          emit('usage', '', { inputTokens: message.usage?.input_tokens || 0, outputTokens: message.usage?.output_tokens || 0 })
        }
      }
      if (!result) throw new Error('Claude Code 连接提前结束，未返回完整结果')
      session.completed = true
      this.repository?.completeApproval?.(approval.id, { result: { backend: 'claude_sdk', outputStarted: session.outputStarted } })
      return snapshot()
    } catch (error) {
      const failure = controller.signal.aborted || signal?.aborted ? new CodexCancelledError() : error
      if (approval?.id) this.repository?.completeApproval?.(approval.id, { error: failure.message })
      if (session.sessionId) this.repository?.upsertSession?.({ agentRunId, status: failure.name === 'CodexCancelledError' ? 'interrupted' : 'failed' })
      failure.codexPartialResult = snapshot()
      throw failure
    } finally {
      this.eventBuffer.flush(agentRunId)
      signal?.removeEventListener('abort', abort)
      session.query?.close?.()
      session.query = null
      session.activeStepId = ''
    }
  }

  async cancelTurn(agentRunId) {
    const session = this.sessions.get(agentRunId)
    if (!session) return false
    session.controller?.abort()
    session.query?.close?.()
    for (const [id, pending] of this.pendingApprovals) if (pending.agentRunId === agentRunId) this._settleApproval(id, false, '运行已取消', true)
    return true
  }

  async closeSession(agentRunId) {
    const session = this.sessions.get(agentRunId)
    if (!session) return false
    await this.cancelTurn(agentRunId)
    this.eventBuffer.flush(agentRunId)
    this.sessions.delete(agentRunId)
    if (session.sessionId) this.repository?.upsertSession?.({ agentRunId, status: 'closed', closedAt: new Date().toISOString() })
    return true
  }

  async shutdown() {
    for (const controller of this.diagnostics) controller.abort()
    await Promise.all([...this.sessions.keys()].map(id => this.closeSession(id)))
    for (const id of [...this.pendingApprovals.keys()]) this._settleApproval(id, false, '应用已退出', true)
    this.authenticatedMethod = ''
  }
}
