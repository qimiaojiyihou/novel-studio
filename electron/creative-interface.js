import { createHash, randomUUID } from 'node:crypto'
import { createCodexRepository } from './codex-repository.js'
import { createFinalizationRepository } from './chapter-finalization.js'

export class CreativeInterfaceError extends Error {
  constructor(code, message, details = null) { super(message); this.code = code; this.details = details }
}
const fail = (code, message, details) => { throw new CreativeInterfaceError(code, message, details) }
const parse = value => JSON.parse(value || '{}')
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
export const creativeDigest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const stamp = () => new Date().toISOString()
const terminal = new Set(['completed', 'cancelled', 'failed', 'stale'])
const chapterKinds = new Set(['chapter_field', 'planning_chapter_bundle', 'chapter_card', 'scene_plan', 'manuscript', 'manuscript_selection', 'chapter_state', 'continuity_audit', 'quality_review'])
const targetKinds = new Set([...chapterKinds, 'planning_document', 'planning_document_bundle', 'planning_entity', 'planning_entity_bundle'])

// A short critical section per book covers both renderer and external mutations.
// Model turns run outside it; persisted runs keep their target occupied until settled.
export class CreativeMutationQueue {
  constructor() { this.tails = new Map() }
  async run(projectId, action) {
    if (!projectId) return action()
    const previous = this.tails.get(projectId) || Promise.resolve()
    let release
    const tail = new Promise(resolve => { release = resolve })
    this.tails.set(projectId, tail)
    await previous
    try { return await action() } finally {
      release()
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId)
    }
  }
}

export class CreativeInterface {
  constructor({ database, invoke, snapshot, stageCandidate, queue = new CreativeMutationQueue(), buildId = '', onChange = () => {} }) {
    Object.assign(this, { db: database, invoke, snapshot, stageCandidate, queue, buildId, onChange })
    this.inflight = new Map()
    this.reader = createCodexRepository(database)
    this.finalizations = createFinalizationRepository(database)
    // Extension tables are intentionally separate from the published story schema.
    // No existing row is migrated or rebound. The host backs up before first install.
    database.exec(`
      CREATE TABLE IF NOT EXISTS creative_clients (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS creative_requests (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES creative_clients(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', error_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(client_id, request_key)
      );
      CREATE INDEX IF NOT EXISTS creative_requests_project ON creative_requests(project_id, created_at);
    `)
    this.recover()
  }

  project(id) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=? AND project_type='user' AND archived_at=''").get(id)
    if (!row) fail('PROJECT_UNAVAILABLE', '绑定项目不存在或已归档')
    return row
  }

  bind({ clientId, projectId, expectedTitle, token }) {
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(clientId || '') || !token || token.length < 32) fail('INVALID_BINDING', '客户端标识或凭据无效')
    const project = this.project(projectId)
    if (project.title !== expectedTitle) fail('IDENTITY_MISMATCH', '项目 ID 与核对书名不一致')
    const existing = this.db.prepare('SELECT * FROM creative_clients WHERE id=?').get(clientId)
    if (existing) {
      if (existing.project_id !== projectId || existing.token_hash !== creativeDigest(token) || existing.revoked_at) fail('BINDING_CONFLICT', '已有客户端绑定不可更换项目；请创建独立客户端')
      return this.publicBinding(existing)
    }
    this.db.prepare('INSERT INTO creative_clients(id,project_id,title,token_hash,created_at) VALUES(?,?,?,?,?)')
      .run(clientId, projectId, expectedTitle, creativeDigest(token), stamp())
    return this.publicBinding(this.db.prepare('SELECT * FROM creative_clients WHERE id=?').get(clientId))
  }

  publicBinding(row) { return { clientId: row.id, projectId: row.project_id, title: row.title, createdAt: row.created_at } }
  authenticate(token) {
    const client = this.db.prepare("SELECT * FROM creative_clients WHERE token_hash=? AND revoked_at=''").get(creativeDigest(String(token || '')))
    if (!client) fail('UNAUTHENTICATED', '客户端凭据无效')
    this.project(client.project_id)
    return client
  }

  owned(table, id, projectId) {
    const row = id && this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=?`).get(id, projectId)
    if (!row) fail('PROJECT_MISMATCH', '对象不存在或不属于绑定项目')
    return row
  }

  validate(client, operation, input = {}) {
    const projectId = client.project_id
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', '请求参数需要 JSON 对象')
    if (input.projectId && input.projectId !== projectId) fail('PROJECT_MISMATCH', '请求项目与客户端绑定不一致')
    this.project(projectId)
    if (input.chapterId) this.owned('chapters', input.chapterId, projectId)
    if (input.sourceChapterId) this.owned('chapters', input.sourceChapterId, projectId)
    if (input.runId) this.owned('agent_runs', input.runId, projectId)
    if (input.candidateId) {
      const row = this.owned('agent_candidates', input.candidateId, projectId)
      if (input.runId !== row.run_id) fail('PROJECT_MISMATCH', '候选不属于指定运行')
    }
    if (input.parentCandidateId) {
      const row = this.owned('agent_candidates', input.parentCandidateId, projectId)
      if (input.runId !== row.run_id) fail('PROJECT_MISMATCH', '父候选不属于指定运行')
    }
    if (input.stepId) {
      const step = this.db.prepare('SELECT * FROM agent_steps WHERE id=?').get(input.stepId)
      if (!step || step.run_id !== input.runId) fail('PROJECT_MISMATCH', '步骤不属于指定运行')
    }
    if (operation === 'approval.resolve') this.owned('bridge_action_requests', input.id, projectId)
    if (operation.startsWith('finalization.') && input.id) this.owned('chapter_finalizations', input.id, projectId)
    if (input.replaceFinalizationId) {
      const row = this.owned('chapter_finalizations', input.replaceFinalizationId, projectId)
      if (row.chapter_id !== input.chapterId) fail('PROJECT_MISMATCH', '被替换定稿不属于指定章节')
    }
    if (input.target) {
      const target = input.target
      if (!targetKinds.has(target.kind)) fail('UNSUPPORTED_TARGET', '外部创作支持已保存的章节、规划文档和人物/世界/分卷卡片')
      if (chapterKinds.has(target.kind)) {
        this.owned('chapters', target.targetId, projectId)
        if (input.chapterId && input.chapterId !== target.targetId) fail('PROJECT_MISMATCH', '章节与创作目标不一致')
      } else if (target.kind.startsWith('planning_entity')) this.owned('planning_entities', target.targetId, projectId)
      else if (!this.db.prepare('SELECT id FROM planning_documents WHERE project_id=? AND kind=?').get(projectId, target.targetId)) fail('PROJECT_MISMATCH', '规划文档不属于绑定项目')
      if (target.sourceGenerationId) {
        const row = this.owned('generation_records', target.sourceGenerationId, projectId)
        if (row.chapter_id && row.chapter_id !== target.targetId) fail('PROJECT_MISMATCH', '来源记录不属于目标章节')
      }
      if (target.reportId) this.owned('quality_reports', target.reportId, projectId)
      if (target.scopeId) {
        if (target.scopeType === 'project' && target.scopeId !== projectId) fail('PROJECT_MISMATCH','目标范围不属于绑定项目')
        if (target.scopeType === 'chapter') this.owned('chapters',target.scopeId,projectId)
        if (target.scopeType === 'volume') this.owned('planning_entities',target.scopeId,projectId)
      }
    }
    return { ...input, projectId }
  }

  targetKey(input) {
    if (input.chapterId) return `chapter:${input.chapterId}`
    if (chapterKinds.has(input.target?.kind)) return `chapter:${input.target.targetId}`
    if (input.target) return `${input.target.kind.startsWith('planning_entity') ? 'entity' : 'document'}:${input.target.targetId}`
    return 'project'
  }

  assertTargetAvailable(projectId, input, exceptRunId = '', skipFinalization = false) {
    const key = this.targetKey(input)
    const rows = this.db.prepare(`SELECT r.*, s.input_json FROM agent_runs r
      LEFT JOIN agent_steps s ON s.run_id=r.id AND s.position=1 WHERE r.project_id=?`).all(projectId)
    for (const row of rows) {
      if (row.id === exceptRunId || terminal.has(row.status)) continue
      const pending = this.db.prepare("SELECT 1 FROM agent_candidates WHERE run_id=? AND status='pending' LIMIT 1").get(row.id)
      if (row.status === 'waiting_confirmation' && row.workflow_id === 'inline-action' && !pending) continue
      const other = this.targetKey({ chapterId: row.chapter_id, target: parse(row.input_json).target })
      if (other === key || other === 'project' || key === 'project') fail('TARGET_BUSY', '该创作目标已有运行，请读取并继续已有任务', { runId: row.id, status: row.status })
    }
    const finalization = input.chapterId || (chapterKinds.has(input.target?.kind) && input.target.targetId)
    if (finalization && !skipFinalization) {
      const row = this.db.prepare("SELECT id,status FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND status NOT IN ('completed','cancelled','stale','blocked') ORDER BY rowid DESC LIMIT 1").get(projectId, finalization)
      if (row) fail('TARGET_BUSY', '该章节有未结束的定稿，请先完成或取消定稿', { finalizationId: row.id, status: row.status })
    }
  }

  async call(token, { operation, input = {}, requestId = '' } = {}) {
    const client = this.authenticate(token)
    const normalized = this.validate(client, operation || '', input)
    if (READ_OPERATIONS.has(operation)) return this.read(client, operation, normalized)
    if (!WRITE_OPERATIONS.has(operation)) fail('UNKNOWN_OPERATION', '未开放的创作操作')
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) fail('IDEMPOTENCY_REQUIRED', '写操作需要稳定的 requestId；重连时使用原值')
    const fingerprint = creativeDigest({ operation, input: normalized })
    const key = `${client.id}:${requestId}`
    const previous = this.db.prepare('SELECT * FROM creative_requests WHERE client_id=? AND request_key=?').get(client.id, requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', '同一个 requestId 已用于其他参数')
      if (this.inflight.has(key)) return this.inflight.get(key)
      return this.replay(previous)
    }
    const id = `creative-request-${randomUUID()}`
    this.db.prepare(`INSERT INTO creative_requests(id,client_id,project_id,request_key,operation,fingerprint,payload_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'processing',?,?)`).run(id, client.id, client.project_id, requestId, operation, fingerprint, JSON.stringify(normalized), stamp(), stamp())
    const pending = this.queue.run(client.project_id, async () => {
      try {
        const payload = this.validate(client, operation, normalized)
        const result = await this.write(operation, payload, id)
        this.db.prepare("UPDATE creative_requests SET status='completed',result_json=?,updated_at=? WHERE id=?").run(JSON.stringify(result ?? null), stamp(), id)
        this.onChange({ projectId: client.project_id, operation, requestId })
        return result
      } catch (error) {
        const info = { code: error.code || 'OPERATION_FAILED', message: error.message, details: error.details || null }
        this.db.prepare("UPDATE creative_requests SET status='failed',error_json=?,updated_at=? WHERE id=?").run(JSON.stringify(info), stamp(), id)
        throw new CreativeInterfaceError(info.code, info.message, info.details)
      }
    }).finally(() => this.inflight.delete(key))
    this.inflight.set(key, pending)
    return pending
  }

  replay(row) {
    if (row.status === 'completed') return JSON.parse(row.result_json)
    const error = parse(row.error_json)
    fail(error.code || 'REQUEST_INTERRUPTED', error.message || '应用已重启，请读取请求记录与原运行后显式恢复；该请求不会重新执行', error.details || { requestId: row.request_key })
  }

  async read(client, operation, input) {
    const projectId = client.project_id
    if (operation === 'identity') return { ...this.publicBinding(client), buildId: this.buildId }
    if (operation === 'snapshot') return this.snapshot(projectId)
    if (operation === 'request.get') {
      const row = this.db.prepare('SELECT * FROM creative_requests WHERE client_id=? AND request_key=?').get(client.id, input.requestId)
      if (!row) fail('NOT_FOUND', '请求记录不存在')
      return { requestId: row.request_key, operation: row.operation, status: row.status, result: parse(row.result_json), error: parse(row.error_json) }
    }
    if (operation === 'chapter.get') return this.owned('chapters', input.chapterId, projectId)
    if (operation === 'revisions.list') { this.owned('chapters', input.chapterId, projectId); return this.invoke('revisions:list', input.chapterId) }
    if (operation === 'run.get') { this.owned('agent_runs', input.runId, projectId); return this.reader.getRun(input.runId) }
    if (operation === 'run.events') {
      this.owned('agent_runs', input.runId, projectId)
      return this.invoke('agent:events', { agentRunId: input.runId, after: Number(input.afterSequence || 0), limit: Math.min(200, Number(input.limit) || 100) })
    }
    if (operation === 'runs.list') return this.invoke('agent:list', { projectId, limit: 100 })
    if (operation === 'approvals.list') return this.reader.listApprovals({ projectId, status:input.status || 'pending', readOnly:true })
    if (operation === 'finalization.get') {
      if (!input.id && !input.chapterId) fail('INVALID_INPUT', '请指定定稿记录或章节')
      return input.id ? this.finalizations.get(input.id) : this.finalizations.latest(input.chapterId)
    }
    if (operation === 'finalization.correction-preview') {
      this.owned('chapters', input.chapterId, projectId)
      return this.invoke('chapter:amendment-preview', input)
    }
    if (operation === 'finalization.manual-preview') {
      this.owned('chapters', input.chapterId, projectId)
      return this.invoke('chapter:manual-preview', input)
    }
  }

  async write(operation, input, journalId) {
    const projectId = input.projectId
    if (['run.start', 'run.start-inline', 'candidate.propose'].includes(operation)) this.assertTargetAvailable(projectId, input)
    if (['run.continue','run.resume','run.retry'].includes(operation)) {
      const run=this.owned('agent_runs',input.runId,projectId)
      const step=this.db.prepare('SELECT input_json FROM agent_steps WHERE run_id=? ORDER BY position LIMIT 1').get(run.id)
      this.assertTargetAvailable(projectId,{chapterId:run.chapter_id,target:parse(step?.input_json).target},run.id,Boolean(parse(run.model_routes_json).finalizationId))
    }
    const call = (channel, value) => this.invoke(channel, value)
    if (operation === 'run.start' || operation === 'run.start-inline') {
      // External callers never choose connection identifiers or overwrite frozen routes.
      const payload = pick(input, ['projectId','chapterId','workflowId','task','intent','target','instruction','targetLength','executionMode','modelProfileId','reviewerProfileId','codexModel','codexReasoningEffort','codexFastMode','freshStart'])
      return call(operation === 'run.start' ? 'agent:start' : 'agent:start-inline', { ...payload, _creativeRequestId: journalId, executionMode: payload.executionMode || 'codex' })
    }
    if (operation === 'candidate.propose') {
      const current = await this.snapshot(projectId)
      if (!input.sourceDigest || current.sourceDigest !== input.sourceDigest) fail('SOURCE_STALE', '项目来源已变化，请重新读取后提交候选')
      return this.stageCandidate({ ...pick(input, ['projectId','chapterId','task','intent','target','instruction','payload','sourceDigest']), journalId, verifySource: async () => {
        if ((await this.snapshot(projectId)).sourceDigest !== input.sourceDigest) fail('SOURCE_STALE', '候选准备期间项目来源已变化')
      } })
    }
    if (operation === 'chapter.create') {
      confirmed(input)
      const chapter = await call('chapter:create', pick(input, ['projectId','title','sourceChapterId','mode']))
      return chapter
    }
    if (operation === 'candidate.resolve') {
      confirmed(input)
      const run = this.owned('agent_runs', input.runId, projectId)
      if (parse(run.model_routes_json).finalizationId) fail('FINALIZATION_REQUIRED', '定稿子运行的候选请通过定稿确认流程处理')
      if (typeof input.accept !== 'boolean') fail('INVALID_INPUT', '请明确接受或放弃候选')
      return call(input.accept ? 'agent:confirm-candidate' : 'agent:reject-candidate', pick(input, ['runId','candidateId','reason','editedPayload','applyOptions']))
    }
    if (operation === 'run.continue') return call('agent:continue-inline', pick(input, ['runId','instruction','parentCandidateId','mode','legacyRuleChoice','scope']))
    if (operation === 'run.retry') return call('agent:retry-step', pick(input, ['runId','stepId','legacyRuleChoice']))
    if (operation === 'run.resume') return call('agent:resume', pick(input, ['runId','legacyRuleChoice']))
    if (['run.pause', 'run.cancel', 'run.finish'].includes(operation)) return call(({ 'run.pause':'agent:pause','run.cancel':'agent:cancel','run.finish':'agent:finish-inline' })[operation], input.runId)
    if (operation === 'approval.resolve') { confirmed(input); if (typeof input.approved !== 'boolean') fail('INVALID_INPUT', '请明确本次审批决定'); return call('approvals:resolve', pick(input, ['id','approved','note','reason'])) }
    if (operation === 'finalization.start') {
      this.owned('chapters', input.chapterId, projectId)
      const existing=this.db.prepare("SELECT id FROM chapter_finalizations WHERE project_id=? AND chapter_id=? AND status NOT IN ('completed','cancelled','stale','blocked') ORDER BY rowid DESC LIMIT 1").get(projectId,input.chapterId)
      if (existing) return call('chapter:finalize-get',{id:existing.id})
      this.assertTargetAvailable(projectId,input,'',true)
      return call('chapter:finalize-start', { ...pick(input, ['projectId','chapterId','targetLength','reviewer']), _creativeRequestId:journalId, deferReview: true })
    }
    if (operation === 'finalization.act') {
      if (['accept-state', 'accept-review', 'correct-state'].includes(input.action)) confirmed(input)
      return call('chapter:finalize-confirm', pick(input, ['id','action','sourceDigest','stateDigest','corrections','reason']))
    }
    if (operation === 'finalization.correct') {
      confirmed(input)
      this.owned('chapters', input.chapterId, projectId)
      this.assertTargetAvailable(projectId, input)
      return call('chapter:amendment-confirm', { ...pick(input, ['projectId','chapterId','baseFinalizationId','sourceDigest','stateDigest','previewDigest','meaningUnchanged','confirm','reason','corrections']), requestId: journalId })
    }
    if (operation === 'finalization.manual') {
      if (input.confirm !== true || input.skipReview !== true || input.skipHandoff !== true) fail('CONFIRMATION_REQUIRED', '请明确选择人工直接定稿，并跳过本次审稿和交接')
      this.owned('chapters', input.chapterId, projectId)
      this.assertTargetAvailable(projectId, input)
      return call('chapter:manual-confirm', { ...pick(input, ['projectId','chapterId','sourceDigest','previewDigest','confirm','skipReview','skipHandoff','reason']), requestId: journalId })
    }
    fail('UNKNOWN_OPERATION', '未开放的创作操作')
  }

  recover() {
    // Never replay an indeterminate write after a process crash. Preserve original runs.
    for (const row of this.db.prepare("SELECT * FROM creative_requests WHERE status='processing'").all()) {
      const run = this.db.prepare("SELECT id FROM agent_runs WHERE project_id=? AND json_extract(model_routes_json,'$.creativeRequestId')=? ORDER BY rowid DESC LIMIT 1").get(row.project_id, row.id)
      const finalization=this.db.prepare("SELECT id FROM chapter_finalizations WHERE project_id=? AND json_extract(checks_json,'$.creativeRequestId')=? ORDER BY rowid DESC LIMIT 1").get(row.project_id,row.id)
      const details = { requestId: row.request_key, ...(run ? { runId: run.id } : {}), ...(finalization ? {finalizationId:finalization.id} : {}), instruction: '读取当前状态；有运行时使用原 runId 显式恢复，正式写入先核对结果。' }
      this.db.prepare("UPDATE creative_requests SET status='interrupted',error_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify({ code:'REQUEST_INTERRUPTED', message:'应用重启中断了回执；已保留结果线索，不会重复执行请求', details }), stamp(), row.id)
    }
    const runs = this.db.prepare(`SELECT * FROM agent_runs WHERE json_extract(model_routes_json,'$.creativeRequestId') IS NOT NULL AND status IN ('running','pending','waiting_approval')`).all()
    for (const run of runs) {
      const step=this.db.prepare("SELECT id FROM agent_steps WHERE run_id=? AND status IN ('running','waiting_approval','pending') ORDER BY CASE WHEN status='pending' THEN 1 ELSE 0 END,position LIMIT 1").get(run.id)
      if (step) this.db.prepare("UPDATE agent_steps SET status='interrupted',error='应用已重启，请显式重试原步骤',interrupted_at=? WHERE id=?").run(stamp(),step.id)
      this.db.prepare("UPDATE agent_runs SET status='paused',error='应用已重启，请显式恢复原任务' WHERE id=?").run(run.id)
      this.db.prepare("UPDATE bridge_action_requests SET status='expired',resolved_at=? WHERE agent_run_id=? AND status='pending'").run(stamp(), run.id)
    }
    this.db.prepare("UPDATE chapter_finalizations SET status='failed',error='应用已重启，请读取原定稿并显式恢复',updated_at=? WHERE json_extract(checks_json,'$.creativeRequestId') IS NOT NULL AND status IN ('checking','reviewing','extracting')").run(stamp())
  }
}

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
function confirmed(input) { if (input.confirm !== true || !String(input.reason || input.note || '').trim()) fail('CONFIRMATION_REQUIRED', '正式决定需要 confirm:true 和作者确认说明 reason 或 note') }
export const READ_OPERATIONS = new Set(['identity','snapshot','request.get','chapter.get','revisions.list','runs.list','run.get','run.events','approvals.list','finalization.get','finalization.correction-preview','finalization.manual-preview'])
export const WRITE_OPERATIONS = new Set(['run.start','run.start-inline','run.continue','run.pause','run.cancel','run.resume','run.retry','run.finish','candidate.propose','candidate.resolve','approval.resolve','chapter.create','finalization.start','finalization.act','finalization.correct','finalization.manual'])
