import { computed, inject } from 'vue'
import { creativeAgentLabel } from '../utils/agent-provider.js'

export function useCreativeAgent() {
  const provider = inject('creative-agent-provider', computed(() => 'codex'))
  return { provider, agentLabel: computed(() => creativeAgentLabel(provider.value)) }
}
