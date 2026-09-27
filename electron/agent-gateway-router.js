export function normalizeAgentProvider(value) {
  return value === 'qoder' ? 'qoder' : 'codex'
}

export function agentProviderLabel(value) {
  return normalizeAgentProvider(value) === 'qoder' ? 'Qoder' : 'Codex'
}

export class AgentGatewayRouter {
  constructor({ repository, codex, qoder }) {
    this.repository = repository
    this.gateways = { codex, qoder }
  }

  gateway(provider) {
    return this.gateways[normalizeAgentProvider(provider)]
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
