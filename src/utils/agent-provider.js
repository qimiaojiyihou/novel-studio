export function creativeAgentLabel(provider = 'codex') {
  return { codex: 'Codex', qoder: 'Qoder', claude: 'Claude Code' }[provider] || 'Codex'
}

export function creativeBackendLabel(backend) {
  return { codex_acp: 'Codex ACP', codex_exec: 'Codex exec', qoder_acp: 'Qoder ACP', claude_sdk: 'Claude Code SDK', app_model: '任务模型' }[backend] || backend || ''
}
