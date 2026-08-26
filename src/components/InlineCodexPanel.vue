<template>
  <aside v-if="visible" class="inline-codex-panel" :class="{ 'is-minimized': minimized }" aria-label="AI 就地创作">
    <header class="inline-panel-head">
      <div><span class="panel-kicker">{{ panelKicker }}</span><h2>{{ targetLabel }}</h2></div>
      <div class="inline-panel-window-actions">
        <button
          v-if="!minimized"
          type="button"
          aria-label="缩小 AI 候选窗口"
          title="缩小窗口"
          @click="minimized = true"
        >−</button>
        <button
          v-else
          type="button"
          aria-label="展开 AI 候选窗口"
          title="展开窗口"
          @click="minimized = false"
        >□</button>
        <button type="button" aria-label="关闭 AI 候选窗口" title="关闭窗口" @click="emit('close')">×</button>
      </div>
    </header>

    <div v-if="minimized" class="inline-minimized-status">
      <span :class="`state-dot state-${run?.status || 'pending'}`"></span>
      <strong>{{ run ? statusLabel(run.status) : '正在读取状态' }}</strong>
      <span>{{ backendLabel }}</span>
      <button type="button" @click="minimized = false">查看候选</button>
    </div>

    <div v-else-if="loading" class="inline-panel-empty">正在读取运行状态…</div>
    <template v-else-if="run">
      <section class="inline-run-meta">
        <div><span>模型</span><strong>{{ modelLabel }}</strong></div>
        <div><span>后端</span><strong>{{ backendLabel }}</strong></div>
        <div><span>状态</span><strong :class="`state-${run.status}`">{{ statusLabel(run.status) }}</strong></div>
        <div><span>推理</span><strong>{{ run.modelRoutes?.codexReasoningEffort || 'high' }}</strong></div>
      </section>

      <div v-if="run.actualBackend === 'codex_exec'" class="inline-panel-notice">ACP 在首个输出前中断，本次使用只读 exec 兼容模式。</div>
      <div v-if="run.executionMode === 'codex' && sessionModelApprovalEnabled" class="inline-panel-notice">本项目在本次应用会话内会自动批准模型调用；工具操作和正式写入仍需逐次确认。</div>
      <div v-if="run.error || actionError" class="inline-panel-error">{{ actionError || run.error }}</div>

      <section v-if="pendingApproval" class="inline-approval">
        <span class="panel-kicker">APPROVAL</span>
        <h3>{{ pendingApproval.permission }}</h3>
        <pre>{{ JSON.stringify(pendingApproval.payload || {}, null, 2) }}</pre>
        <p v-if="pendingApproval.actionType === 'model_call'" class="approval-scope-note">会话免审只覆盖当前项目的模型调用，应用退出后自动失效。</p>
        <div><button type="button" @click="resolveApproval(false)">拒绝</button><button type="button" class="accent" @click="resolveApproval(true)">仅批准本次</button><button v-if="pendingApproval.actionType === 'model_call'" type="button" class="accent session" @click="approveProjectSession">本项目会话免审</button></div>
      </section>

      <details class="inline-trace">
        <summary><span>技术运行信息</span><small>{{ tokenUsage }}</small></summary>
        <div v-if="!trace.length" class="inline-panel-empty">等待状态更新…</div>
        <article v-for="event in trace" :key="`${event.sequence}-${event.type}`">
          <span>{{ eventLabel(event.type) }}</span>
          <p>{{ eventText(event) }}</p>
        </article>
      </details>

      <section
        v-if="streaming"
        ref="streamingCandidateElement"
        class="inline-candidate inline-streaming-candidate"
        aria-busy="true"
        @scroll="handleStreamingScroll"
      >
        <div class="inline-section-title candidate-version-head">
          <span>{{ streamingText ? '正在生成候选' : '正在准备候选' }}</span>
          <small class="streaming-state"><i></i>实时输出</small>
        </div>
        <div v-if="streamingText" class="inline-candidate-text inline-streaming-text">{{ streamingText }}</div>
        <div v-else class="inline-streaming-empty"><span></span>等待模型开始输出…</div>
      </section>

      <section v-else-if="selectedCandidate" class="inline-candidate">
        <div class="inline-section-title candidate-version-head">
          <span>{{ candidateHeading }}</span>
          <label v-if="candidateOptions.length > 1">
            <span>查看版本</span>
            <select v-model="selectedCandidateId">
              <option v-for="option in candidateOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <small v-else>{{ candidateTypeLabel }}</small>
        </div>
        <div v-if="candidateIsPlanningBundle" class="planning-bundle-candidate">
          <div class="bundle-candidate-toolbar">
            <p>一次调用生成了 {{ bundleFields.length }} 个字段。取消勾选的字段不会写入项目。</p>
            <div><button type="button" @click="selectAllBundleFields">全选</button><button type="button" @click="clearBundleFields">全不选</button></div>
          </div>
          <label v-for="field in bundleFields" :key="field.key" class="bundle-field" :class="{ selected: bundleSelectedKeys.includes(field.key) }">
            <input v-model="bundleSelectedKeys" type="checkbox" :value="field.key" />
            <span class="bundle-field-copy">
              <strong>{{ field.label }}</strong>
              <small v-if="field.originalValue">当前：{{ field.originalValue }}</small>
              <span>{{ field.candidateValue }}</span>
            </span>
          </label>
        </div>
        <InlineManuscriptDiff v-else-if="candidateIsManuscript" :original="sourceManuscript" :candidate="composedManuscript" />
        <pre v-else-if="candidateIsJson">{{ JSON.stringify(pendingCandidate.payload || {}, null, 2) }}</pre>
        <div v-else class="inline-candidate-text">{{ candidateText }}</div>
        <p v-if="selectedCandidate.artifactType === 'renderer_draft'" class="draft-note">接受后只填入当前编辑器，仍需点击原表单的保存按钮。</p>
        <p v-if="candidateIsStale" class="draft-note">{{ selectedCandidate.overrideReason || '这份候选已被更新版本替代，只可查看或继续修改。' }}</p>
        <p v-else-if="selectedCandidate.status === 'accepted'" class="draft-note accepted">这一版已经写入项目；仍可在下方继续要求 Codex 修改。</p>
        <label v-if="candidateCanResolve" class="candidate-note"><span>本次判断（可选）</span><input v-model.trim="reason" /></label>
        <div v-if="candidateCanResolve" class="inline-candidate-actions">
          <button type="button" :disabled="busy" @click="rejectCandidate">放弃</button>
          <button type="button" class="accent" :disabled="busy || !candidateCanAccept" @click="acceptCandidate">{{ busy ? '处理中…' : candidateIsPlanningBundle ? `接受已选 ${bundleSelectedKeys.length} 项` : '接受候选' }}</button>
        </div>
      </section>

      <section v-if="canContinueConversation" class="inline-followup">
        <div class="inline-section-title"><span>继续让 Codex 修改</span><small>同一 ACP 会话</small></div>
        <div v-if="revisionMessages.length" class="revision-history">
          <article v-for="message in revisionMessages" :key="message.id">
            <span>你 · 第 {{ message.round }} 版</span>
            <p>{{ message.instruction }}</p>
          </article>
        </div>
        <textarea
          v-model.trim="followupInstruction"
          rows="3"
          :disabled="conversationBusy"
          placeholder="例如：删掉系统流表述；保留职业体验，把目标读者放宽到女性读者，并缩短到 120 字。"
          @keydown.meta.enter.prevent="submitRevision"
          @keydown.ctrl.enter.prevent="submitRevision"
        ></textarea>
        <div class="followup-actions">
          <small>⌘/Ctrl + Enter 发送；每次返回完整的新候选。</small>
          <button type="button" class="accent" :disabled="conversationBusy || !followupInstruction" @click="submitRevision">
            {{ conversationBusy ? '正在修改…' : '生成修改稿' }}
          </button>
        </div>
      </section>

      <footer class="inline-panel-footer">
        <button v-if="['running','waiting_approval'].includes(run.status)" type="button" @click="pause">暂停</button>
        <button v-if="run.status === 'paused'" type="button" @click="resume">恢复</button>
        <button v-if="retryableStep" type="button" @click="retry">重试步骤</button>
        <button v-if="canFinishConversation" type="button" @click="finishConversation">结束对话</button>
        <button v-if="!['completed','cancelled'].includes(run.status) && !canFinishConversation" type="button" class="danger" @click="cancel">取消运行</button>
      </footer>
    </template>
    <div v-else class="inline-panel-empty">这次就地任务还没有运行记录。</div>
  </aside>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { appendCodexStream, nextCodexStreamLength, recoverCodexStream, visibleCodexStream } from '../utils/codex-stream.js'
import { composeInlineManuscriptCandidate } from '../utils/inline-creative.js'
import InlineManuscriptDiff from './InlineManuscriptDiff.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  runId: { type: String, default: '' },
  currentDraftDigest: { type: String, default: '' },
  currentDraftValue: { type: String, default: undefined },
  sourceManuscript: { type: String, default: '' },
})
const emit = defineEmits(['close', 'accepted', 'rejected', 'updated'])
const run = ref(null)
const loading = ref(false)
const busy = ref(false)
const reason = ref('')
const followupInstruction = ref('')
const selectedCandidateId = ref('')
const bundleSelectedKeys = ref([])
const actionError = ref('')
const sessionModelApprovalEnabled = ref(false)
const minimized = ref(false)
const streaming = ref(false)
const streamingSource = ref('')
const streamingOutput = ref('')
const streamingStepId = ref('')
const streamingCandidateElement = ref(null)
let agentCleanup = null
let codexCleanup = null
let approvalCleanup = null
let refreshTimer = null
let typewriterTimer = null
let refreshSequence = 0
let streamAutoFollow = true
let approvalProjectId = ''

const step = computed(() => run.value?.steps?.[0] || null)
const orderedCandidates = computed(() => run.value?.candidates || [])
const selectedCandidate = computed(() => orderedCandidates.value.find((item) => item.id === selectedCandidateId.value)
  || [...orderedCandidates.value].reverse().find((item) => item.status === 'pending')
  || orderedCandidates.value.at(-1) || null)
const pendingCandidate = selectedCandidate
const selectedStep = computed(() => run.value?.steps?.find((item) => item.id === selectedCandidate.value?.stepId) || step.value)
const candidateIsStale = computed(() => selectedCandidate.value?.status === 'stale')
const candidateIsPlanningBundle = computed(() => ['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(selectedCandidate.value?.artifactType))
const bundleFields = computed(() => Array.isArray(selectedCandidate.value?.payload?.fields) ? selectedCandidate.value.payload.fields : [])
const candidateCanAccept = computed(() => selectedCandidate.value?.status === 'pending'
  && (!candidateIsPlanningBundle.value || bundleSelectedKeys.value.length > 0))
const candidateCanResolve = computed(() => selectedCandidate.value?.status === 'pending')
const pendingApproval = computed(() => run.value?.approvals?.find((item) => item.status === 'pending') || null)
const retryableStep = computed(() => [...(run.value?.steps || [])].reverse().find((item) => ['failed', 'interrupted'].includes(item.status) && item.attemptCount < 3) || null)
const targetLabel = computed(() => step.value?.input?.target?.fieldLabel || ({ chapter_card: '章节卡', scene_plan: '场景计划', chapter: '正文', rewrite: '局部重写', continuity_audit: '连续性审计', quality_review: '质量评审' }[step.value?.task] || '就地创作'))
const panelKicker = computed(() => {
  const targetKind = step.value?.input?.target?.kind
  const bundleLabel = targetKind === 'planning_document_bundle' ? 'PAGE' : targetKind === 'planning_entity_bundle' ? 'CARD' : targetKind === 'planning_chapter_bundle' ? 'CHAPTER' : ''
  if (run.value?.executionMode === 'app_model') return bundleLabel ? `AI · ${bundleLabel} BATCH` : 'AI · INLINE'
  return bundleLabel ? `CODEX · ${bundleLabel} SESSION` : 'CODEX · INLINE'
})
const modelLabel = computed(() => run.value?.executionMode === 'app_model'
  ? run.value?.modelRoutes?.appModelName || run.value?.modelRoutes?.planning_field || run.value?.modelRoutes?.modelProfileId || '规划任务模型'
  : run.value?.modelRoutes?.codexModel || 'Codex 默认模型')
const backendLabel = computed(() => ({ codex_acp: 'Codex ACP', codex_exec: 'Codex exec', app_model: '任务模型' }[run.value?.actualBackend]
  || (run.value?.executionMode === 'app_model' ? '等待任务模型' : '等待 ACP')))
const trace = computed(() => (run.value?.events || []).filter((item) => ['status', 'plan', 'tool_call', 'tool_result', 'usage', 'failed', 'completed'].includes(item.type)).slice(-24))
const tokenUsage = computed(() => {
  const usage = [...(run.value?.events || [])].reverse().find((item) => item.type === 'usage')?.payload || {}
  const total = usage.totalTokens || usage.total_tokens || (Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0))
  return total ? `${total} tokens` : '受控项目镜像'
})
const candidateIsManuscript = computed(() => ['manuscript', 'manuscript_selection'].includes(selectedCandidate.value?.artifactType))
const candidateIsJson = computed(() => !['planning_field', 'renderer_draft', 'manuscript_selection', 'planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(selectedCandidate.value?.artifactType) && selectedCandidate.value?.artifactType !== 'manuscript')
const candidateText = computed(() => selectedCandidate.value?.payload?.text || selectedCandidate.value?.payload?.manuscript || '')
const streamingText = computed(() => visibleCodexStream(streamingOutput.value))
const composedManuscript = computed(() => composeInlineManuscriptCandidate({
  source: props.sourceManuscript,
  artifactType: selectedCandidate.value?.artifactType,
  payload: selectedCandidate.value?.payload,
  action: selectedStep.value?.input,
}))
const candidateTypeLabel = computed(() => ({ planning_field: '字段候选', planning_document_bundle: '整页候选', planning_entity_bundle: '整卡候选', planning_chapter_bundle: '整章规划候选', renderer_draft: '编辑器草稿', manuscript: '完整正文', manuscript_selection: '选区替换', chapter_card: 'JSON 章节合同', scene_plan: '结构化场景卡', chapter_state: '章后状态', continuity_audit: '审计报告', quality_review: '质量报告' }[selectedCandidate.value?.artifactType] || selectedCandidate.value?.artifactType || ''))
const candidateHeading = computed(() => ({ pending: '待确认候选', accepted: '已接受版本', rejected: '已放弃版本', stale: '历史候选', cancelled: '已取消候选' }[selectedCandidate.value?.status] || '候选版本'))
const candidateOptions = computed(() => orderedCandidates.value.map((candidate, index) => ({
  id: candidate.id,
  label: `第 ${index + 1} 版 · ${{ pending: '待确认', accepted: '已接受', rejected: '已放弃', stale: '历史', cancelled: '已取消' }[candidate.status] || candidate.status}`,
})))
const conversationBusy = computed(() => busy.value || ['pending', 'waiting_approval', 'running'].includes(run.value?.status))
const conversationWasFinished = computed(() => (run.value?.events || []).some((event) => event.type === 'inline_conversation_finished'))
const latestCandidateStatus = computed(() => orderedCandidates.value.at(-1)?.status || '')
const canContinueConversation = computed(() => Boolean(selectedCandidate.value)
  && run.value?.workflowId === 'inline-action'
  && run.value?.executionMode === 'codex'
  && run.value?.status !== 'cancelled'
  && !streaming.value
  && !conversationWasFinished.value
  && !(run.value?.status === 'completed' && ['rejected', 'cancelled'].includes(latestCandidateStatus.value))
  && !pendingApproval.value)
const canFinishConversation = computed(() => run.value?.workflowId === 'inline-action'
  && run.value?.status === 'waiting_confirmation'
  && !orderedCandidates.value.some((candidate) => candidate.status === 'pending'))
const revisionMessages = computed(() => (run.value?.steps || []).filter((item) => item.input?.revision).map((item) => ({
  id: item.id,
  round: item.input.revision.round,
  instruction: item.input.revision.instruction,
})))

watch(streamingText, async () => {
  if (!streamAutoFollow) return
  await nextTick()
  const element = streamingCandidateElement.value
  if (element) element.scrollTop = element.scrollHeight
})
watch(() => props.runId, () => {
  minimized.value = false
  run.value = null
  selectedCandidateId.value = ''
  approvalProjectId = ''
  resetStreaming()
  void refresh()
}, { immediate: true })
watch(() => selectedCandidate.value?.id, () => {
  bundleSelectedKeys.value = candidateIsPlanningBundle.value ? bundleFields.value.map((field) => field.key) : []
}, { immediate: true })
watch(() => props.visible, (visible) => { if (visible) { minimized.value = false; void refresh({ background: true }) } })
onMounted(() => {
  agentCleanup = appService.onAgentEvent(handleAgentEvent)
  codexCleanup = appService.onCodexEvent(handleCodexEvent)
  approvalCleanup = appService.onApprovalEvent((event) => {
    if (event?.agentRunId === props.runId) scheduleRefresh(0, { refreshApproval: true })
  })
})
onBeforeUnmount(() => {
  agentCleanup?.()
  codexCleanup?.()
  approvalCleanup?.()
  if (refreshTimer) clearTimeout(refreshTimer)
  stopTypewriter()
})

async function refresh(options = {}) {
  if (!props.runId) { run.value = null; return }
  const sequence = ++refreshSequence
  const showInitialLoading = !options.background && !run.value
  if (showInitialLoading) loading.value = true
  try {
    const refreshedRun = await appService.getAgentRun(props.runId)
    if (sequence !== refreshSequence || !refreshedRun) return
    run.value = refreshedRun
    const latestPending = [...(run.value?.candidates || [])].reverse().find((candidate) => candidate.status === 'pending')
    if (latestPending) selectedCandidateId.value = latestPending.id
    else if (!(run.value?.candidates || []).some((candidate) => candidate.id === selectedCandidateId.value)) {
      selectedCandidateId.value = run.value?.candidates?.at(-1)?.id || ''
    }
    const activeStepId = run.value?.currentStepId || run.value?.steps?.find((item) => ['pending', 'running'].includes(item.status))?.id || ''
    const activeStepHasCandidate = Boolean(activeStepId && run.value?.candidates?.some((candidate) => candidate.stepId === activeStepId))
    const runIsGenerating = ['pending', 'running'].includes(run.value?.status) && !activeStepHasCandidate
    if (runIsGenerating && !streaming.value) beginStreaming(activeStepId)
    if (runIsGenerating && !streamingSource.value) {
      const recovered = recoverCodexStream(run.value?.events || [], activeStepId)
      streamingSource.value = recovered
      streamingOutput.value = recovered
    }
    if (!runIsGenerating) resetStreaming()
    if (run.value?.executionMode === 'codex' && run.value?.projectId && (options.refreshApproval || approvalProjectId !== run.value.projectId)) {
      approvalProjectId = run.value.projectId
      sessionModelApprovalEnabled.value = Boolean((await appService.getSessionModelApproval(run.value.projectId)).enabled)
    } else if (run.value?.executionMode !== 'codex') {
      sessionModelApprovalEnabled.value = false
    }
    if (!options.preserveError) actionError.value = ''
    emit('updated', run.value)
  } catch (error) {
    if (sequence === refreshSequence) actionError.value = error.message
  } finally {
    if (sequence === refreshSequence) loading.value = false
  }
}

function beginStreaming(agentStepId = '') {
  if (agentStepId && streamingStepId.value && streamingStepId.value !== agentStepId) {
    stopTypewriter()
    streamingSource.value = ''
    streamingOutput.value = ''
  }
  streamingStepId.value = agentStepId || streamingStepId.value
  streaming.value = true
  streamAutoFollow = true
}

function resetStreaming() {
  stopTypewriter()
  streaming.value = false
  streamingSource.value = ''
  streamingOutput.value = ''
  streamingStepId.value = ''
  streamAutoFollow = true
}

function stopTypewriter() {
  if (!typewriterTimer) return
  clearInterval(typewriterTimer)
  typewriterTimer = null
}

function startTypewriter() {
  if (typewriterTimer) return
  typewriterTimer = setInterval(() => {
    const remaining = streamingSource.value.length - streamingOutput.value.length
    if (remaining <= 0) {
      stopTypewriter()
      return
    }
    const nextLength = nextCodexStreamLength(streamingOutput.value.length, streamingSource.value.length)
    streamingOutput.value = streamingSource.value.slice(0, nextLength)
  }, 24)
}

function flushTypewriter() {
  stopTypewriter()
  streamingOutput.value = streamingSource.value
}

function scheduleRefresh(delay = 120, options = {}) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refresh({ background: true, ...options })
  }, delay)
}

function handleCodexEvent(event) {
  if (event?.agentRunId !== props.runId) return
  if (event.type === 'text_delta') {
    beginStreaming(event.agentStepId || '')
    streamingSource.value = appendCodexStream(streamingSource.value, event.text || '')
    startTypewriter()
    return
  }
  scheduleRefresh(160)
}

async function finalizeStreaming() {
  flushTypewriter()
  await refresh({ background: true })
  resetStreaming()
  scheduleRefresh(180)
}

function handleAgentEvent(event) {
  if (event?.agentRunId !== props.runId) return
  if (['run_started', 'inline_revision_started'].includes(event.type)) {
    resetStreaming()
    beginStreaming(event.payload?.stepId || '')
    scheduleRefresh(80)
    return
  }
  if (event.type === 'candidate_created') {
    void finalizeStreaming()
    return
  }
  if (['run_failed', 'run_cancelled'].includes(event.type)) resetStreaming()
  scheduleRefresh(80)
}

function handleStreamingScroll(event) {
  const element = event.currentTarget
  streamAutoFollow = element.scrollHeight - element.scrollTop - element.clientHeight < 72
}
async function resolveApproval(approved) {
  if (!pendingApproval.value) return
  try {
    actionError.value = ''
    await appService.resolveApproval({ id: pendingApproval.value.id, approved, reason: approved ? '' : '作者拒绝本次调用' })
    await refresh()
  } catch (error) { actionError.value = error.message }
}
async function approveProjectSession() {
  if (!pendingApproval.value || !run.value?.projectId) return
  try {
    actionError.value = ''
    await appService.setSessionModelApproval({ projectId: run.value.projectId, enabled: true })
    sessionModelApprovalEnabled.value = true
    await appService.resolveApproval({ id: pendingApproval.value.id, approved: true, note: '作者授权当前项目在本次应用会话内自动批准模型调用' })
    await refresh()
  } catch (error) { actionError.value = error.message }
}
async function acceptCandidate() {
  if (!selectedCandidate.value || busy.value || !candidateCanAccept.value) return
  busy.value = true
  const candidate = selectedCandidate.value
  try {
    actionError.value = ''
    run.value = await appService.confirmAgentCandidate({
      runId: run.value.id,
      candidateId: candidate.id,
      reason: reason.value,
      currentDraftDigest: props.currentDraftDigest,
      ...(candidateIsPlanningBundle.value ? { applyOptions: { fieldKeys: [...bundleSelectedKeys.value] } } : {}),
    })
    emit('accepted', { run: run.value, candidate })
    reason.value = ''
  } catch (error) { actionError.value = error.message } finally { busy.value = false }
}
async function rejectCandidate() {
  if (!selectedCandidate.value || busy.value || !candidateCanResolve.value) return
  busy.value = true
  const candidate = selectedCandidate.value
  try {
    actionError.value = ''
    run.value = await appService.rejectAgentCandidate({ runId: run.value.id, candidateId: candidate.id, reason: reason.value })
    emit('rejected', { run: run.value, candidate })
    reason.value = ''
  } catch (error) {
    const message = error.message
    await refresh({ preserveError: true })
    actionError.value = message
  } finally { busy.value = false }
}
async function runControl(action) {
  try { actionError.value = ''; run.value = await action(); emit('updated', run.value) }
  catch (error) { actionError.value = error.message }
}
async function submitRevision() {
  if (!followupInstruction.value || !selectedCandidate.value || conversationBusy.value) return
  busy.value = true
  resetStreaming()
  beginStreaming()
  try {
    actionError.value = ''
    run.value = await appService.continueInlineAgent({
      runId: run.value.id,
      parentCandidateId: selectedCandidate.value.id,
      instruction: followupInstruction.value,
      currentDraftDigest: props.currentDraftDigest,
      ...(props.currentDraftValue === undefined ? {} : { currentDraftValue: props.currentDraftValue }),
    })
    followupInstruction.value = ''
    emit('updated', run.value)
  } catch (error) { resetStreaming(); actionError.value = error.message } finally { busy.value = false }
}
async function finishConversation() {
  await runControl(() => appService.finishInlineAgent(run.value.id))
}
async function pause() { await runControl(() => appService.pauseAgentRun(run.value.id)) }
async function resume() { await runControl(() => appService.resumeAgentRun(run.value.id)) }
async function retry() { await runControl(() => appService.retryAgentStep({ runId: run.value.id, stepId: retryableStep.value.id })) }
async function cancel() { await runControl(() => appService.cancelAgentRun(run.value.id)) }
function selectAllBundleFields() { bundleSelectedKeys.value = bundleFields.value.map((field) => field.key) }
function clearBundleFields() { bundleSelectedKeys.value = [] }
function statusLabel(value) { return ({ pending: '待开始', waiting_approval: '等待审批', running: '执行中', waiting_confirmation: '等待确认', paused: '已暂停', interrupted: '已中断', completed: '已完成', rejected: '已拒绝', stale: '已过期', cancelled: '已取消', failed: '失败' }[value] || value) }
function eventLabel(value) { return ({ plan: '计划', tool_call: '工具', tool_result: '结果', usage: '用量', status: '状态', failed: '错误', completed: '完成' }[value] || value) }
function eventText(event) {
  const payload = event.payload || {}
  if (event.type === 'status') {
    if (Array.isArray(payload.availableCommands)) return `ACP 会话能力已加载（${payload.availableCommands.length} 项）`
    const threadStatus = payload?._meta?.codex?.threadStatus?.type
    if (threadStatus) return ({ active: 'ACP 会话正在工作', idle: 'ACP 会话已空闲' }[threadStatus] || `ACP 会话：${threadStatus}`)
    if (String(event.summary || '').startsWith('system:')) return 'Codex 已接收受控创作任务'
    return String(payload.status || payload.message || payload.sessionUpdate || event.summary || '状态已更新').slice(0, 180)
  }
  return String(event.summary || payload.text || payload.delta || payload.status || payload.message || JSON.stringify(payload)).slice(0, 500)
}
</script>

<style scoped>
.inline-codex-panel { position: fixed; z-index: 115; top: 40px; right: 20px; bottom: 20px; width: min(clamp(880px, 70vw, 1380px), calc(100vw - 40px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #4c5357; background: #20262a; color: #e8dfd2; box-shadow: 0 30px 90px rgba(5,8,10,.56); transition: width .2s ease, height .2s ease, bottom .2s ease; }
.inline-codex-panel.is-minimized { top: auto; bottom: 24px; width: min(390px, calc(100vw - 48px)); height: auto; }
.inline-panel-head { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 8px 16px 8px 20px; border-bottom: 1px solid #394146; }
.inline-panel-head > div:first-child { display: flex; align-items: baseline; gap: 14px; min-width: 0; }
.inline-panel-head h2 { margin: 0; overflow: hidden; font-family: Georgia, 'Songti SC', serif; font-size: 20px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.inline-panel-window-actions { display: flex; align-items: center; gap: 2px; margin-left: 18px; }
.inline-panel-head button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; background: transparent; color: #bfc2bf; font-size: 21px; line-height: 1; cursor: pointer; }
.inline-panel-head button:hover { border-color: #596267; background: #293034; color: #f4ede4; }
.inline-panel-head button:focus-visible,.inline-minimized-status button:focus-visible { outline: 2px solid #d06a4a; outline-offset: 2px; }
.is-minimized .inline-panel-head { align-items: center; padding: 14px 16px; }
.is-minimized .inline-panel-head h2 { margin-top: 2px; max-width: 210px; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
.is-minimized .panel-kicker { font-size: 8px; }
.inline-minimized-status { display: flex; align-items: center; gap: 8px; padding: 11px 16px 13px; color: #929ca0; font-size: 10px; }
.inline-minimized-status strong { color: #e5ddd2; font-size: 11px; }
.inline-minimized-status button { margin-left: auto; padding: 7px 10px; border: 1px solid #97533f; background: #7e4334; color: #fff6ec; font-size: 10px; cursor: pointer; }
.state-dot { width: 7px; height: 7px; border-radius: 50%; background: #899397; box-shadow: 0 0 0 3px rgba(137,147,151,.12); }
.state-dot.state-running,.state-dot.state-waiting_approval,.state-dot.state-waiting_confirmation { background: #d06a4a; box-shadow: 0 0 0 3px rgba(208,106,74,.14); }
.state-dot.state-completed { background: #73a28e; box-shadow: 0 0 0 3px rgba(115,162,142,.14); }
.panel-kicker { color: #d06a4a; font-size: 10px; font-weight: 700; letter-spacing: .18em; }
.inline-run-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: #394146; border-bottom: 1px solid #394146; }
.inline-run-meta div { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 8px 14px; background: #252c30; }
.inline-run-meta span { flex: 0 0 auto; color: #8f999e; font-size: 9px; letter-spacing: .08em; }
.inline-run-meta strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.inline-panel-notice,.inline-panel-error { margin: 7px 16px 0; padding: 7px 10px; border-left: 3px solid #c57b43; background: #2d3336; font-size: 11px; line-height: 1.4; }
.inline-panel-error { border-color: #c0523a; color: #f0b6a8; }
.inline-approval { margin: 14px 18px 0; padding: 15px; border: 1px solid #6c5a4e; background: #2c2c2a; }
.inline-approval h3 { margin: 6px 0 10px; font-size: 14px; }
.inline-approval pre,.inline-candidate pre { max-height: 190px; overflow: auto; white-space: pre-wrap; font-size: 11px; }
.inline-approval > div,.inline-candidate-actions,.inline-panel-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.inline-approval button,.inline-candidate-actions button,.inline-panel-footer button { padding: 8px 11px; border: 1px solid #596267; background: transparent; color: #e8dfd2; cursor: pointer; }
.inline-approval button.accent,.inline-candidate-actions button.accent { border-color: #bd563c; background: #bd563c; color: white; }
.inline-approval button.session { border-color: #687e78; background: #465f58; }
.approval-scope-note { margin: 10px 0; color: #aaa397; font-size: 10px; line-height: 1.5; }
.inline-trace { flex: 0 0 auto; max-height: 34%; overflow: auto; padding: 8px 16px; border-bottom: 1px solid #394146; }
.inline-trace summary { display: flex; justify-content: space-between; color: #9ea7aa; font-size: 11px; cursor: pointer; list-style: none; }
.inline-trace summary::-webkit-details-marker { display: none; }
.inline-trace summary::before { content: '＋'; margin-right: 7px; color: #d06a4a; }
.inline-trace[open] summary::before { content: '－'; }
.inline-trace summary small { margin-left: auto; }
.inline-section-title { display: flex; justify-content: space-between; color: #aeb4b6; font-size: 11px; letter-spacing: .08em; }
.inline-trace article { display: grid; grid-template-columns: 54px 1fr; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #343c40; }
.inline-trace article span { color: #d06a4a; font-size: 10px; }
.inline-trace article p { margin: 0; color: #c5c8c6; font-size: 12px; line-height: 1.55; white-space: pre-wrap; }
.inline-candidate { flex: 1 1 52%; min-height: 280px; overflow: auto; padding: 18px 28px 22px; border-top: 1px solid #465056; background: #f6efe4; color: #303538; }
.candidate-version-head { align-items: center; }
.candidate-version-head label { display: flex; align-items: center; gap: 7px; letter-spacing: 0; }
.candidate-version-head label span { color: #85796e; font-size: 10px; }
.candidate-version-head select { max-width: 160px; padding: 5px 7px; color: #4b433c; border: 1px solid #c7b9a7; background: #fffaf1; font-size: 10px; }
.inline-candidate-text { max-width: 90ch; margin: 12px auto 0; white-space: pre-wrap; font-family: Georgia, 'Songti SC', serif; font-size: 16px; line-height: 1.85; }
.planning-bundle-candidate { display: grid; gap: 10px; margin-top: 14px; }
.bundle-candidate-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 12px; border: 1px solid #d5c8b8; background: rgba(255,255,255,.48); }
.bundle-candidate-toolbar p { margin: 0; color: #756b62; font-size: 11px; line-height: 1.5; }
.bundle-candidate-toolbar > div { display: flex; flex: 0 0 auto; gap: 5px; }
.bundle-candidate-toolbar button { padding: 5px 8px; color: #755748; border: 1px solid #c9aa98; background: #fffaf1; font-size: 9px; cursor: pointer; }
.bundle-field { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; padding: 12px 14px; border: 1px solid #d6cabb; background: rgba(255,255,255,.42); cursor: pointer; }
.bundle-field.selected { border-color: #bd8068; border-left: 3px solid #bd563c; background: #fffaf1; }
.bundle-field > input { margin: 4px 0 0; accent-color: #bd563c; }
.bundle-field-copy { display: grid; gap: 6px; min-width: 0; }
.bundle-field-copy strong { color: #4c433c; font: 13px var(--font-display); }
.bundle-field-copy small { overflow: hidden; color: #95887c; font-size: 9px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.bundle-field-copy > span { color: #39332e; font: 13px/1.7 var(--font-body); white-space: pre-wrap; }
.inline-streaming-candidate { scroll-behavior: smooth; }
.streaming-state { display: flex; align-items: center; gap: 7px; color: #80756c; letter-spacing: .04em; }
.streaming-state i { width: 6px; height: 6px; border-radius: 50%; background: #bd563c; box-shadow: 0 0 0 3px rgba(189,86,60,.12); }
.inline-streaming-text::after { content: ''; display: inline-block; width: 2px; height: 1em; margin-left: 4px; background: #bd563c; vertical-align: -.12em; animation: stream-caret 1s steps(1,end) infinite; }
.inline-streaming-empty { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 180px; color: #94887d; font: 12px/1.5 var(--font-body); }
.inline-streaming-empty span { width: 7px; height: 7px; border-radius: 50%; background: #bd563c; box-shadow: 0 0 0 4px rgba(189,86,60,.1); }
@keyframes stream-caret { 0%,48% { opacity: 1; } 49%,100% { opacity: 0; } }
.draft-note { color: #8a5b43; font-size: 12px; }
.draft-note.accepted { color: #4e7166; }
.candidate-note { display: block; margin: 14px 0; font-size: 11px; }
.candidate-note span { display: block; margin-bottom: 5px; }
.candidate-note input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #c7b9a7; background: #fffaf1; }
.inline-candidate-actions button { color: #303538; border-color: #b5a898; }
.inline-candidate-actions button.accent { color: white; }
.inline-followup { padding: 15px 18px; border-top: 1px solid #465056; background: #252c30; }
.revision-history { max-height: 110px; margin-top: 10px; overflow: auto; }
.revision-history article { margin-top: 8px; padding-left: 9px; border-left: 2px solid #845b4e; }
.revision-history span { color: #d28a70; font-size: 9px; }
.revision-history p { margin: 3px 0 0; color: #c7cbca; font-size: 11px; line-height: 1.5; }
.inline-followup textarea { box-sizing: border-box; width: 100%; min-height: 76px; margin-top: 11px; padding: 10px 11px; resize: vertical; color: #ece3d8; border: 1px solid #596267; outline: none; background: #1e2427; font: 12px/1.55 var(--font-body); }
.inline-followup textarea:focus { border-color: #c56b50; }
.followup-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 9px; }
.followup-actions small { color: #879095; font-size: 9px; line-height: 1.4; }
.followup-actions button { flex: 0 0 auto; padding: 8px 11px; color: white; border: 1px solid #bd563c; background: #bd563c; cursor: pointer; }
.followup-actions button:disabled { cursor: default; opacity: .45; }
.inline-panel-footer { padding: 12px 18px; border-top: 1px solid #394146; }
.inline-panel-footer .danger { color: #e69a86; }
.inline-panel-empty { padding: 28px; color: #90999d; text-align: center; }
@media (max-width: 860px) {
  .inline-codex-panel { top: 58px; right: 12px; bottom: 12px; width: calc(100vw - 24px); }
  .inline-codex-panel.is-minimized { right: 12px; bottom: 12px; width: min(390px, calc(100vw - 24px)); }
  .inline-run-meta { grid-template-columns: 1fr 1fr; }
  .inline-candidate { min-height: 190px; padding: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .inline-codex-panel { transition: none; }
  .inline-streaming-candidate { scroll-behavior: auto; }
  .inline-streaming-text::after { animation: none; }
}
</style>
