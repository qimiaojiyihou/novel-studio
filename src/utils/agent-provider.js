export function creativeAgentLabel(provider = 'codex') {
  return { codex: 'Codex', qoder: 'Qoder', claude: 'Claude Code', grok: 'Grok Build' }[provider] || 'Codex'
}

export function creativeBackendLabel(backend) {
  return { codex_acp: 'Codex ACP', codex_exec: 'Codex exec', qoder_acp: 'Qoder ACP', claude_sdk: 'Claude Code SDK', grok_acp: 'Grok Build ACP', app_model: '任务模型' }[backend] || backend || ''
}
