// Real Claude requests, synthetic books only. Never opens the user's library.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createCodexRepository } from '../electron/codex-repository.js'
import { createCodexProjectMirror } from '../electron/codex-project-mirror.js'
import { ClaudeAgentGateway } from '../electron/claude-agent-gateway.js'
import { AgentGatewayRouter } from '../electron/agent-gateway-router.js'
import { AgentRuntime } from '../electron/agent-runtime.js'

if (!process.argv.includes('--live')) throw new Error('真实生成联调请显式传入 --live；会消耗当前 Claude Code 配置的额度')
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-claude-creative-'))
const db = new DatabaseSync(':memory:')
runMigrations(db)
const workspace = createWorkspaceRepository(db), repository = createCodexRepository(db)
const mirrors = new Map(), books = [], applied = [], eventCounts = {}
const model = option('--model', 'sonnet'), effort = option('--effort', 'medium')
const gateway = new ClaudeAgentGateway({ repository, shouldAutoApprove: () => true, onGlobalEvent: event => { eventCounts[event.type] = (eventCounts[event.type] || 0) + 1 } })
const router = new AgentGatewayRouter({ repository, claude: gateway })
const runtime = new AgentRuntime({ repository, codexGateway: router,
  createMirror: async run => {
    const mirror = createCodexProjectMirror({ baseDirectory: directory, agentRun: run, workspace: workspace.loadWorkspaceSnapshot(run.projectId) })
    mirrors.set(run.id, mirror)
    return mirror
  },
  prepareCodexPrompt: async ({ run, step }) => ({ agentProvider: 'claude', model: run.modelRoutes.codexModel,
    reasoningEffort: run.modelRoutes.codexReasoningEffort, authMethod: 'claude-login',
    messages: [{ role: 'user', content: `请为虚构小说《${books.find(book => book.project.id === run.projectId)?.project.title}》写一段80至150字的中文正文，只返回含 manuscript 字段的 JSON。主角在雨夜车站捡到一封没有署名的信。不要读取文件。不要输出解释。` }],
    continuationMessages: step.input?.revision ? [{ role: 'user', content: '修改上一版：结尾明确出现一把红伞。只返回 manuscript 字段的 JSON。' }] : null,
    outputSchema: { type: 'object', properties: { manuscript: { type: 'string' } }, required: ['manuscript'], additionalProperties: false },
  }),
  runPreflight: async () => ({ blocked: false }),
  currentSourceDigest: async run => mirrors.get(run.id)?.sourceDigest || '',
  applyCandidate: async input => applied.push(input),
})
const waitRun = async runId => {
  const timer = setTimeout(() => { void runtime.cancel(runId) }, 120000)
  try { await runtime.advance(runId); const run = repository.getRun(runId); assert.equal(run.status, 'waiting_confirmation', run.error); return run }
  finally { clearTimeout(timer) }
}
try {
  for (const title of ['真实联调虚构样本甲', '真实联调虚构样本乙']) books.push(workspace.createProject({ title, genre: '悬疑', idea: '只用于联调的雨夜来信' }))
  const runs = []
  for (const book of books) {
    const started = await runtime.startInline({ task: 'chapter', projectId: book.project.id, chapterId: book.chapters[0].id,
      target: { kind: 'manuscript', targetId: book.chapters[0].id }, executionMode: 'codex', freshStart: true,
      modelRoutes: { agentProvider: 'claude', codexModel: model, codexReasoningEffort: effort } })
    const run = await waitRun(started.id), candidate = run.candidates[0]
    assert.equal(candidate.status, 'pending')
    assert.equal(candidate.evidence.executionBackend, 'claude_sdk')
    assert.equal(candidate.evidence.modelSnapshot.reasoningEffort, effort)
    assert.ok(candidate.payload.manuscript.length > 40)
    assert.equal(workspace.loadWorkspaceSnapshot(book.project.id).chapters[0].manuscript, '')
    runs.push(run)
    console.log(JSON.stringify({ stage: 'candidate', book: book.project.title, backend: run.actualBackend, model: candidate.evidence.modelSnapshot.model, effort, text: candidate.payload.manuscript }))
  }
  assert.notEqual(runs[0].session.sessionId, runs[1].session.sessionId)
  assert.notEqual(mirrors.get(runs[0].id).workspaceRoot, mirrors.get(runs[1].id).workspaceRoot)
  await runtime.continueInline({ runId: runs[0].id, parentCandidateId: runs[0].candidates[0].id, instruction: '结尾出现红伞', mode: 'revise' })
  const revised = await waitRun(runs[0].id)
  const revision = revised.candidates.find(candidate => candidate.id !== runs[0].candidates[0].id)
  assert.ok(revision?.payload.manuscript.includes('红伞'))
  assert.equal(revised.session.sessionId, runs[0].session.sessionId)
  assert.equal(applied.length, 0)
  assert.ok(eventCounts.text_delta > 0)
  console.log(JSON.stringify({ passed: true, separateBookProjects: true, separateSessions: true, resumed: true,
    model, effort, originalManuscriptUntouched: true, pendingCandidates: 3, events: eventCounts, revision: revision.payload.manuscript }))
} finally {
  await router.shutdown()
  db.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
