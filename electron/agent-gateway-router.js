export function normalizeAgentProvider(value) {
  return ['qoder', 'claude', 'grok'].includes(value) ? value : 'codex'
}

export function agentProviderLabel(value) {
  return { codex: 'Codex', qoder: 'Qoder', claude: 'Claude Code', grok: 'Grok Build' }[normalizeAgentProvider(value)]
}

export function agentProviderModel(settings = {}, provider = settings.agentProvider) {
  if (provider === 'grok') return settings.grokModel || ''
  return provider === 'claude' ? settings.claudeModel || '' : provider === 'qoder' ? settings.qoderModel || 'auto' : settings.model || ''
}

export function agentProviderReasoningEffort(settings = {}, provider = settings.agentProvider) {
  if (provider === 'grok') return settings.grokReasoningEffort || ''
  return provider === 'claude' ? settings.claudeReasoningEffort || '' : settings.reasoningEffort ?? 'high'
}

export function agentProviderBackend(provider) {
  return normalizeAgentProvider(provider) === 'claude' ? 'claude_sdk' : `${normalizeAgentProvider(provider)}_acp`
}

export function agentRunSettings(defaults, input = {}, provider = defaults.agentProvider) {
  provider = normalizeAgentProvider(provider)
  const modelKey = { claude: 'claudeModel', qoder: 'qoderModel', grok: 'grokModel', codex: 'codexModel' }[provider]
  const effortKey = { claude: 'claudeReasoningEffort', grok: 'grokReasoningEffort' }[provider] || 'codexReasoningEffort'
  return { agentProvider: provider, codexModel: input[modelKey] ?? agentProviderModel(defaults, provider),
    codexReasoningEffort: input[effortKey] ?? agentProviderReasoningEffort(defaults, provider),
    codexFastMode: provider === 'codex' && (input.codexFastMode ?? Boolean(defaults.fastMode)),
    codexAuthMethod: provider === 'grok' ? 'cached_token' : provider === 'claude' ? defaults.claudeAuthMethod || 'cli' : input.codexAuthMethod ?? defaults.authMethod ?? 'chatgpt' }
}

export class AgentGatewayRouter {
  constructor({ repository, codex, qoder, claude, grok }) {
    this.repository = repository
    this.gateways = { codex, qoder, claude, grok }
  }

  gateway(provider) {
    const selected = this.gateways[normalizeAgentProvider(provider)]
    if (!selected) throw new Error(`${agentProviderLabel(provider)} 执行器未初始化`)
    return selected
  }

  providerForRun(agentRunId) {
    const provider = this.repository?.agentProviderForRun?.(agentRunId)
    if (provider) return normalizeAgentProvider(provider)
    const run = this.repository?.getRunSummary?.(agentRunId) || this.repository?.getRun?.(agentRunId, { includeEvents: false })
    return normalizeAgentProvider(run?.modelRoutes?.agentProvider)
  }

  async prompt(input) {
    const provider = normalizeAgentProvider(input?.settings?.agentProvider || this.providerForRun(input?.agentRunId))
    for (const [owner, gateway] of Object.entries(this.gateways)) {
      if (owner !== provider && gateway?.sessions?.has(input.agentRunId)) await gateway.closeSession(input.agentRunId)
    }
    return this.gateway(provider).prompt(input)
  }

  cancelTurn(agentRunId) {
    // Collaborative runs can own both Codex and Grok sessions. Cancel only
    // sessions actually owned by a gateway, independent of the root provider.
    const owners = Object.values(this.gateways).filter(g => g?.sessions?.has(agentRunId))
    return owners.length ? Promise.all(owners.map(g => g.cancelTurn(agentRunId))) : this.gateway(this.providerForRun(agentRunId)).cancelTurn(agentRunId)
  }

  closeSession(agentRunId) {
    const owners = Object.values(this.gateways).filter(g => g?.sessions?.has(agentRunId))
    return owners.length ? Promise.all(owners.map(g => g.closeSession(agentRunId))) : this.gateway(this.providerForRun(agentRunId)).closeSession(agentRunId)
  }

  resolveApproval(input) {
    const owner = Object.values(this.gateways).find((gateway) => gateway?.pendingApprovals?.has(input.id))
    return (owner || this.gateway('codex')).resolveApproval(input)
  }

  async shutdown() {
    await Promise.allSettled(Object.values(this.gateways).map((gateway) => gateway?.shutdown?.()))
  }
}
