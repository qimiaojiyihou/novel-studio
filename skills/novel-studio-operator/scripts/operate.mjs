import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const READ_OPERATIONS = new Set(['identity', 'snapshot', 'request.get', 'chapter.get', 'revisions.list', 'runs.list', 'run.get', 'run.events', 'approvals.list', 'finalization.get', 'finalization.correction-preview', 'finalization.manual-preview'])
export const WRITE_OPERATIONS = new Set(['run.start', 'run.start-inline', 'run.continue', 'run.pause', 'run.cancel', 'run.resume', 'run.retry', 'run.finish', 'candidate.propose', 'candidate.resolve', 'approval.resolve', 'chapter.create', 'finalization.start', 'finalization.act', 'finalization.correct', 'finalization.manual'])
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }

export function loadBinding(workspace) {
  const root = fs.realpathSync(workspace)
  if (fs.existsSync(path.join(root, '.nscollab.json'))) fail('INTERNAL_MIRROR', '内部候选会话应使用 novel-studio-creator')
  const descriptor = read(path.join(root, '.novel-studio-project.json'))
  const binding = read(path.join(root, '.novel-studio-operator.json'))
  if (binding.schemaVersion !== 1 || !binding.clientId || !descriptor.projectId || descriptor.projectId !== binding.projectId
    || !path.isAbsolute(binding.clientFile) || fs.realpathSync(binding.workspace) !== root) {
    fail('BINDING_MISMATCH', '操作绑定与当前书籍工作区不一致，请核对项目 ID')
  }
  return binding
}

export function summarize(identity, snapshot) {
  const terminal = new Set(['completed', 'cancelled', 'failed', 'stale'])
  return {
    identity,
    project: { id: snapshot.project?.id, title: snapshot.project?.title, genre: snapshot.project?.genre },
    sourceDigest: snapshot.sourceDigest,
    chapters: (snapshot.chapters || []).map(chapter => ({
      id: chapter.id, number: chapter.chapter_no, title: chapter.title, status: chapter.status,
      chineseCharacters: (String(chapter.manuscript || '').match(/\p{Script=Han}/gu) || []).length,
    })),
    activeRuns: (snapshot.runs || []).filter(run => !terminal.has(run.status)).map(run => ({
      id: run.id, chapterId: run.chapterId, status: run.status, workflowId: run.workflowId,
      actualBackend: run.actualBackend, model: run.modelRoutes?.codexModel,
      reasoningEffort: run.modelRoutes?.codexReasoningEffort,
      finalizationId: run.modelRoutes?.finalizationId, updatedAt: run.updatedAt, error: run.error,
    })),
    pendingCandidates: (snapshot.candidates || []).filter(candidate => candidate.status === 'pending'),
    finalizations: (snapshot.finalizations || []).map(record => ({
      id: record.id, chapterId: record.chapterId, status: record.status,
      sourceDigest: record.sourceDigest, error: record.error,
      ...(record.authorAmendment ? { correction: { label: record.authorAmendment.label, reviewedFinalizationId: record.authorAmendment.reviewedFinalizationId } } : {}),
      ...(record.manualFinalization ? { completionMode: 'author-direct', reviewSkipped: true, handoffSkipped: true } : {}),
    })),
    note: '只读检查；汉字数不含标点。正式书稿请用 chapter.get 读取，候选与评审用原 ID 跟进。',
  }
}

export async function operate({ workspace, operation = 'status', input = {}, requestId = '', call }) {
  const binding = loadBinding(workspace)
  if (!READ_OPERATIONS.has(operation) && !WRITE_OPERATIONS.has(operation) && operation !== 'status') fail('UNKNOWN_OPERATION', '此入口只支持文档列出的项目创作操作')
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'input 应为 JSON 对象')
  if (input.projectId && input.projectId !== binding.projectId) fail('BINDING_MISMATCH', '请求项目与本书绑定不一致')
  if (WRITE_OPERATIONS.has(operation) && !/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) fail('REQUEST_ID_REQUIRED', '写操作需要 8—160 位稳定请求 ID')
  const decision = ['chapter.create', 'candidate.resolve', 'approval.resolve', 'finalization.correct'].includes(operation)
    || (operation === 'finalization.act' && ['accept-review', 'accept-state', 'correct-state'].includes(input.action))
  if (decision && (input.confirm !== true || !String(input.reason || input.note || '').trim())) fail('CONFIRMATION_REQUIRED', '请先核对作者决定，再提交 confirm:true 和实际 reason')
  if (operation === 'finalization.correct' && input.meaningUnchanged !== true) fail('CONFIRMATION_REQUIRED', '文字校正需要作者确认剧情、事实与交接含义未变')
  if (operation === 'finalization.manual' && (input.confirm !== true || input.skipReview !== true || input.skipHandoff !== true)) fail('CONFIRMATION_REQUIRED', '人工直接定稿需要作者明确选择跳过本次审稿与交接')
  // Reuse the application's transport. The installer copies it beside this file.
  const invoke = call || (await import('./creative-client.mjs')).callCreative
  const identity = await invoke(binding.clientFile, 'identity', {})
  if (identity.projectId !== binding.projectId || identity.clientId !== binding.clientId) fail('BINDING_MISMATCH', '运行中的应用返回了不同项目或客户端，已停止本次操作')
  if (operation === 'identity') return identity
  if (operation === 'status') {
    const snapshot = await invoke(binding.clientFile, 'snapshot', {})
    if (snapshot.project?.id !== binding.projectId) fail('BINDING_MISMATCH', '项目快照归属与绑定不一致')
    return summarize(identity, snapshot)
  }
  // No automatic retry: a lost write receipt must be inspected by request.get.
  return invoke(binding.clientFile, operation, input, requestId)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), operation = args.shift() || 'status', options = {}
    while (args.length) {
      const key = args.shift(), value = args.shift()
      if (!['--workspace', '--input', '--request-id'].includes(key) || !value || Object.hasOwn(options, key)) fail('INVALID_ARGUMENT', '用法：operate.mjs OPERATION [--workspace 书籍目录] [--input JSON文件] [--request-id 稳定请求ID]')
      options[key] = value
    }
    const result = await operate({ workspace: options['--workspace'] || process.cwd(), operation,
      input: options['--input'] ? read(options['--input']) : {}, requestId: options['--request-id'] || '' })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'OPERATOR_ERROR', message: error.message, details: error.details || null })}\n`)
    process.exitCode = 1
  }
}
