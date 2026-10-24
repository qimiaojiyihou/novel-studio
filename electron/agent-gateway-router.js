export function normalizeAgentProvider(value) {
  return ['qoder', 'claude'].includes(value) ? value : 'codex'
}

export function agentProviderLabel(value) {
  return { codex: 'Codex', qoder: 'Qoder', claude: 'Claude Code' }[normalizeAgentProvider(value)]
}

export function agentProviderModel(settings = {}, provider = settings.agentProvider) {
  return provider === 'claude' ? settings.claudeModel || '' : provider === 'qoder' ? settings.qoderModel || 'auto' : settings.model || ''
}

export function agentProviderReasoningEffort(settings = {}, provider = settings.agentProvider) {
  return provider === 'claude' ? settings.claudeReasoningEffort || '' : settings.reasoningEffort ?? 'high'
}

export function agentProviderBackend(provider) {
  return normalizeAgentProvider(provider) === 'claude' ? 'claude_sdk' : `${normalizeAgentProvider(provider)}_acp`
}

export class AgentGatewayRouter {
  constructor({ repository, codex, qoder, claude }) {
    this.repository = repository
    this.gateways = { codex, qoder, claude }
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

  prompt(input) {
    const provider = normalizeAgentProvider(input?.settings?.agentProvider || this.providerForRun(input?.agentRunId))
    return this.gateway(provider).prompt(input)
  }

  cancelTurn(agentRunId) {
    return this.gateway(this.providerForRun(agentRunId)).cancelTurn(agentRunId)
  }

  closeSession(agentRunId) {
    return this.gateway(this.providerForRun(agentRunId)).closeSession(agentRunId)
  }

  resolveApproval(input) {
    const owner = Object.values(this.gateways).find((gateway) => gateway?.pendingApprovals?.has(input.id))
    return (owner || this.gateway('codex')).resolveApproval(input)
  }

  async shutdown() {
    await Promise.allSettled(Object.values(this.gateways).map((gateway) => gateway?.shutdown?.()))
  }
}
