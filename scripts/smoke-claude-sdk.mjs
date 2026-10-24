// No user manuscript or project database is opened. --live sends two small
// synthetic requests to the selected CLI account and may consume its quota.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ClaudeAgentGateway } from '../electron/claude-agent-gateway.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-claude-sdk-smoke-'))
const gateway = new ClaudeAgentGateway({})
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 180000)
const authMethod = process.argv.includes('--api-key') ? 'environment' : 'cli'
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] || '' }
const model = option('--model'), reasoningEffort = option('--effort')
try {
  const diagnostic = await gateway.testConnection({ cwd: root, authMethod })
  console.log(JSON.stringify({ diagnostic: diagnostic.ok, models: diagnostic.models.map(item => item.value), creativeRequestSent: false }))
  if (process.argv.includes('--live')) {
    const input = { agentRunId: 'synthetic-smoke', agentStepId: 'first', signal: controller.signal,
      messages: [{ role: 'user', content: '只返回 text 为“测试候选”的 JSON 对象。不要访问文件。' }],
      outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      settings: { mirrorRoot: root, model, reasoningEffort, authMethod: authMethod === 'environment' ? 'api-key' : 'claude-login' } }
    const result = await gateway.prompt(input)
    assert.equal(result.backend, 'claude_sdk')
    assert.equal(result.structuredOutput?.text, '测试候选')
    assert.ok(result.sessionId)
    const next = await gateway.prompt({ ...input, agentStepId: 'second', continuationMessages: [{ role: 'user', content: '将刚才的 text 改为“第二版候选”，只返回 JSON 对象。' }] })
    assert.equal(next.contextReuse, 'delta')
    assert.equal(next.sessionId, result.sessionId)
    assert.equal(next.structuredOutput?.text, '第二版候选')
    console.log(JSON.stringify({ generated: true, resumed: true, backend: result.backend, model: result.modelSnapshot?.model,
      reasoningEffort: result.modelSnapshot?.reasoningEffort, first: result.structuredOutput, second: next.structuredOutput }))
  }
} finally {
  clearTimeout(timer)
  await gateway.shutdown()
  fs.rmSync(root, { recursive: true, force: true })
}
