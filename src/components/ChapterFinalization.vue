<template>
  <div class="finalize-backdrop" @click.self="$emit('close')">
    <section ref="dialogElement" class="finalize-panel" role="dialog" aria-modal="true" aria-label="完成本章" tabindex="-1">
      <header><div><small>章节定稿</small><h2>完成本章</h2></div><button @click="$emit('close')" aria-label="关闭定稿面板">×</button></header>
      <ol v-if="completionMode === 'review' && !record?.checks?.manualFinalization" class="finalize-progress" aria-label="定稿进度">
        <li v-for="(label, index) in ['本地检查', '独立审稿', '确认交接']" :key="label" :aria-current="index === progressIndex ? 'step' : undefined" :class="{ done: index < progressIndex || record?.status === 'completed' }"><span>{{ index < progressIndex || record?.status === 'completed' ? '✓' : index + 1 }}</span>{{ label }}</li>
      </ol>
      <main>
        <label class="completion-mode">本次定稿方式<select v-model="completionMode" aria-label="本次定稿方式" :disabled="busy || amendmentBusy" @change="modeTouched = true"><option value="review">审稿并交接</option><option value="manual">人工直接定稿（跳过审稿与交接）</option></select></label>
        <ChapterManualFinalization v-if="completionMode === 'manual'" :project-id="projectId" :chapter-id="chapterId" :disabled="busy" @busy="amendmentBusy = $event" @completed="amendmentCompleted" />
        <template v-else>
        <ChapterAmendment :project-id="projectId" :chapter-id="chapterId" :disabled="busy" @busy="amendmentBusy = $event" @completed="amendmentCompleted" />
        <p>此方式会审稿并生成交接，确认后供后续章节使用；若要跳过，请在上方选择“人工直接定稿”。</p>
        <p class="finalize-tip">建议先集中完成正文修改，再做一次独立审稿。下方“本地检查”不调用模型；正文变化后，旧报告保留作参考，新稿另行检查。</p>
        <label>独立审稿方式<select v-model="reviewerChoice" :disabled="busy" @change="reviewerTouched = true"><option value="route">使用质量评审路由</option><option value="codex">Codex · 新会话</option><option v-for="profile in settings.profiles.filter(p => p.enabled)" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
        <p v-if="record" class="reviewer-lock"><span>当前任务</span><strong>{{ record.reviewer?.label }}</strong><em v-if="selectionDiffers">切换后会取消当前任务，并用所选审稿器重新检查</em></p>
        <button class="primary-button" :disabled="busy" @click="start">{{ startLabel }}</button>
        <button v-if="record?.status === 'ready_for_review' && !selectionDiffers" class="primary-button review-ready" :disabled="busy" @click="confirm('start-review')">集中修改已完成，开始独立审稿</button>
        <p v-if="error" role="alert" class="finalize-error">{{ error }}</p>
        <template v-if="record">
          <h3>{{ statusLabel }} <small>· {{ record.source_digest.slice(0, 10) }}</small></h3>
          <p v-if="record.checks?.manualFinalization">本版由作者直接定稿，未审稿、未生成交接。可在这里为当前保存稿另行启动审稿与交接。</p>
          <p v-else-if="record.checks?.authorAmendment">沿用原审稿，经作者校正。本次没有新增模型审稿；下方报告属于原审稿版本。</p>
          <p v-else>{{ record.reviewer?.label }}。本次模型配置已锁定。</p>
          <p v-if="record.error" class="finalize-error">{{ record.error }}</p>
          <section v-if="handoffActive" class="handoff-progress-card" :class="`is-${handoffProgress.health}`" aria-live="polite">
            <div class="handoff-progress-heading"><div><small>正在处理</small><h3>{{ handoffProgress.guidance }}</h3></div><span>{{ handoffProgress.freshness }}</span></div>
            <p class="handoff-runtime">已耗时 {{ handoffProgress.elapsed }} · 关闭面板后任务会在后台继续</p>
            <div class="handoff-progress-track" role="progressbar" aria-label="章后交接处理中"><i /></div>
            <ol class="handoff-checklist">
              <li class="done"><span>✓</span>锁定本章正文</li>
              <li class="active"><span>•</span>生成结构化交接</li>
              <li><span>○</span>核对原文证据</li>
              <li><span>○</span>等待作者确认</li>
            </ol>
          </section>
          <details v-if="!record.checks?.manualFinalization" class="finalize-result" :open="!handoffActive"><summary><span><strong>本地检查</strong><small>不调用模型</small></span><em>✓ 已完成</em></summary><div class="result-body"><p>{{ record.checks?.hanCount }} 中文字</p><p v-if="!record.checks?.findings?.length">未发现本地可检测的格式异常；这不代表文学质量已通过。</p><article v-for="(finding, index) in record.checks?.findings" :key="index"><strong>{{ finding.reason }}</strong><blockquote v-if="finding.evidence">{{ finding.evidence }}</blockquote></article></div></details>
          <details v-if="record.review?.scores" class="finalize-result" :open="!handoffActive"><summary><span><strong>独立审稿</strong><small>{{ record.review.issues?.length || 0 }} 项建议</small></span><em>✓ 已完成</em></summary><div class="result-body"><p>{{ record.review.summary }}</p><article v-for="(issue, index) in record.review.issues" :key="index"><strong>{{ issue.severity }} · {{ issue.category || issue.reason }}</strong><blockquote>{{ issue.evidence }}</blockquote><p>{{ issue.criterion || issue.reason }}</p><p>{{ issue.repairInstruction || issue.suggestion }}</p></article><p v-if="!record.review.issues?.length">审稿未列出问题；请仍按自己的阅读感受决定。</p></div></details>
          <section v-for="approval in approvals" :key="approval.id"><strong>{{ approval.permission || 'Codex 本次调用审批' }}</strong><p>{{ approval.actionType }} · {{ approval.severity }}</p><button @click="resolveApproval(approval, false)">拒绝</button><button @click="resolveApproval(approval, true)">仅批准本次</button></section>
          <template v-if="['waiting_review_confirmation','failed','paused'].includes(record.status)">
            <label>继续定稿的原因（高严重度问题必填）<textarea v-model="reason" rows="3" placeholder="也可以先关闭面板，回到正文修订后重新检查。" /></label>
            <button :disabled="busy" @click="confirm('accept-review')">{{ record.review?.issues ? '接受审稿判断，提取章后交接' : '恢复独立任务' }}</button>
          </template>
          <section v-if="Object.keys(record.state || {}).length" class="handoff-review">
            <h3>{{ record.status === 'completed' ? '已确认交接' : '核对章后交接' }}</h3>
            <p v-if="record.handoff?.mode === 'delta-v1'" class="finalize-tip">只记录本章变化。未重复列出的旧事实仍保留原来源；空数组不表示旧状态被清除。</p>
            <p>{{ record.state.summary }}</p>
            <div v-if="record.stateIssues?.length" role="status" class="finalize-error">有 {{ record.stateIssues.length }} 处来源待核对。贴入锁定正文中的原句，或明确移除没有本章依据的条目；不会重新调用模型。</div>
            <ul v-if="record.stateIssues?.some(issue => !issue.key)"><li v-for="issue in record.stateIssues.filter(item => !item.key)" :key="issue.path">{{ issue.message }}</li></ul>
            <details v-if="canCorrectState" class="source-manuscript"><summary>查看锁定正文 · 可选中复制证据</summary><pre>{{ record.manuscript }}</pre></details>
            <p v-if="correctionsStale" class="finalize-error" role="alert">交接候选已更新，请先刷新表单，再核对修改。</p>
            <button v-if="correctionsStale" @click="resetEvidenceEdits">刷新核对表单</button>
            <div v-for="section in stateSections" :key="section.key"><h4>{{ section.label }} · {{ section.items.length }} 项</h4>
              <article v-for="item in section.items" :key="item.path" :class="{ 'evidence-invalid': item.issue, 'evidence-omitted': evidenceEdits[item.path]?.remove }">
                <p>{{ item.text }}</p>
                <p v-if="item.issue" class="finalize-error" :id="`issue-${item.path}`">{{ item.issue }}</p>
                <template v-if="canCorrectState">
                  <label>第 {{ item.index + 1 }} 项 · 证据原句<textarea :value="evidenceEdits[item.path]?.quote ?? item.evidence" rows="2" :disabled="busy || evidenceEdits[item.path]?.remove || correctionsStale"
                    :aria-invalid="Boolean(item.issue)" :aria-describedby="item.issue ? `issue-${item.path}` : undefined" @input="editEvidence(item, { quote: $event.target.value })" /></label>
                  <button :disabled="busy || correctionsStale" @click="editEvidence(item, { remove: !evidenceEdits[item.path]?.remove })">{{ evidenceEdits[item.path]?.remove ? '保留此条目' : '从本次交接移除此项' }}</button>
                </template>
                <blockquote v-else-if="item.evidence">{{ item.evidence }}</blockquote>
              </article>
            </div>
            <template v-if="canCorrectState && (corrections.length || record.stateIssues?.length)">
              <label>本次核对说明（修正时必填）<textarea ref="evidenceReasonElement" v-model="stateReason" rows="2" :disabled="busy" :aria-invalid="reasonMissing" :aria-describedby="reasonMissing ? 'evidence-save-error' : 'evidence-save-help'" placeholder="例如：引句多了一层引号；移除本章未发生变化的历史条目。" /></label>
              <p id="evidence-save-help" class="finalize-tip">修改证据或移除条目后，请填写核对说明再保存。未修改条目时，只重新检查已有交接，不会自动改写或重新生成。</p>
              <p v-if="corrections.length">待提交 {{ corrections.length }} 项修正。移除只影响本次交接候选，历史记录保留。</p>
              <button class="primary-button" :disabled="busy || correctionsStale" :aria-busy="busy" @click="saveEvidenceCorrections">{{ busy ? '正在保存并重验…' : '保存修正并本地重验' }}</button>
            </template>
            <div ref="evidenceFeedbackElement" class="evidence-save-result">
              <p v-if="evidenceError" id="evidence-save-error" class="finalize-error evidence-save-error" role="alert">{{ evidenceError }}</p>
              <p v-if="evidenceFeedback" class="evidence-save-feedback" role="status">{{ evidenceFeedback }}</p>
            </div>
            <p v-if="record.handoff?.authorCorrections?.length">已保留 {{ record.handoff.authorCorrections.length }} 次作者核对记录。</p>
            <details><summary>高级：完整来源数据与修正记录</summary><pre>{{ JSON.stringify({ state: record.state, corrections: record.handoff?.authorCorrections || [] }, null, 2) }}</pre></details>
          </section>
        </template>
        </template>
      </main>
      <footer><button @click="$emit('close')">{{ record?.status === 'completed' ? '关闭' : handoffActive ? '后台继续' : '稍后定稿' }}</button><button v-if="record && !['completed','cancelled','stale'].includes(record.status)" :disabled="busy || amendmentBusy" @click="confirm('cancel')">取消本次定稿</button><button v-if="completionMode === 'review' && record?.status === 'waiting_confirmation'" class="primary-button" :disabled="busy || amendmentBusy || corrections.length > 0" @click="confirm('accept-state')">确认交接，完成本章</button></footer>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import ChapterAmendment from './ChapterAmendment.vue'
import ChapterManualFinalization from './ChapterManualFinalization.vue'
import { useDialogFocus } from '../composables/useDialogFocus.js'
import { finalizationProgressActivity } from '../utils/finalization-progress.js'
import { HANDOFF_SECTIONS, evidenceQuote, handoffItems, handoffItemText } from '../../electron/chapter-handoff.js'
const props = defineProps({ projectId: String, chapterId: String, targetLength: { type: Number, default: 2000 }, settings: { type: Object, default: () => ({ profiles: [], routes: {} }) } })
const emit = defineEmits(['close', 'completed'])
const dialogElement = ref(null)
useDialogFocus(dialogElement, () => emit('close'))
const record = ref(null), reviewerChoice = ref('route'), reason = ref(''), error = ref(''), busy = ref(false), approvals = ref([]), handoffEvents = ref([]), nowMs = ref(Date.now())
const evidenceEdits = ref({}), editStateDigest = ref(''), stateReason = ref('')
const evidenceReasonElement = ref(null), evidenceFeedbackElement = ref(null)
const evidenceError = ref(''), evidenceFeedback = ref(''), reasonMissing = ref(false)
const amendmentBusy = ref(false)
const completionMode = ref('review')
let modeTouched = false
function amendmentCompleted(value) { operationEpoch += 1; refreshSerial += 1; record.value = value; emit('completed', value) }
let timer, clockTimer, disposed = false, reviewerTouched = false, operationEpoch = 0, refreshSerial = 0
const labels = { checking: '准备检查', ready_for_review: '本地检查已完成，等待启动审稿', reviewing: '独立审稿中', waiting_review_confirmation: '等待审稿确认', extracting: '提取交接中', waiting_state_correction: '交接已保留，等待核对来源', waiting_confirmation: '等待交接确认', completed: '本章已定稿', stale: '正文已变动，需要重新检查', failed: '任务中断，可恢复', blocked: '请先补充正文', cancelled: '已取消' }
const statusLabel = computed(() => record.value?.status === 'paused' ? '已暂停，可恢复定稿' : labels[record.value?.status] || '待检查')
const progressIndex = computed(() => ['extracting','waiting_state_correction','waiting_confirmation','completed'].includes(record.value?.status) ? 2 : Object.keys(record.value?.review || {}).length || record.value?.status === 'reviewing' ? 1 : 0)
const handoffActive = computed(() => record.value?.status === 'extracting')
const handoffProgress = computed(() => finalizationProgressActivity(handoffEvents.value, { now: nowMs.value, startedAt: record.value?.updated_at }))
const selectedReviewerKey = computed(() => {
  if (reviewerChoice.value === 'codex') return 'codex'
  const profileId = reviewerChoice.value === 'route' ? props.settings.routes?.quality_review || '' : reviewerChoice.value
  return `app_model:${profileId}`
})
const lockedReviewerKey = computed(() => record.value?.reviewer?.executionMode === 'codex'
  ? 'codex'
  : `app_model:${record.value?.reviewer?.profileId || ''}`)
const selectionDiffers = computed(() => Boolean(record.value) && selectedReviewerKey.value !== lockedReviewerKey.value)
const selectedReviewerLabel = computed(() => {
  if (reviewerChoice.value === 'codex') return 'Codex'
  const profileId = reviewerChoice.value === 'route' ? props.settings.routes?.quality_review || '' : reviewerChoice.value
  return props.settings.profiles.find(item => item.id === profileId)?.name || '所选模型'
})
const startLabel = computed(() => {
  if (!record.value) return '先做本地检查 · 不调用模型'
  if (selectionDiffers.value) return `改用 ${selectedReviewerLabel.value} 准备新检查`
  if (['failed', 'paused'].includes(record.value.status)) return Object.keys(record.value.review || {}).length ? '恢复交接 · 优先取回已有结果' : '恢复当前独立审稿'
  return '检查当前保存稿 / 聚焦已有定稿'
})
function choiceForRecord(value) {
  if (value?.reviewer?.executionMode === 'codex') return 'codex'
  return value?.reviewer?.profileId || 'route'
}
const stateSections = computed(() => {
  const state = record.value?.state || {}
  return HANDOFF_SECTIONS.map(([key, label]) => ({ key, label, items: handoffItems(state, key).map((item, index) => ({
      key, index, path: `${key}.${index}`, text: handoffItemText(item), evidence: evidenceQuote(item),
      issue: record.value.stateIssues?.find(issue => issue.path === `${key}.${index}`)?.message,
    })) })).filter(section => section.items.length)
})
const canCorrectState = computed(() => ['waiting_state_correction', 'waiting_confirmation'].includes(record.value?.status))
const corrections = computed(() => Object.values(evidenceEdits.value))
const correctionsStale = computed(() => corrections.value.length > 0 && editStateDigest.value !== record.value?.stateDigest)
function clearEvidenceFeedback() { evidenceError.value = ''; evidenceFeedback.value = ''; reasonMissing.value = false }
function resetEvidenceEdits() { evidenceEdits.value = {}; editStateDigest.value = ''; stateReason.value = ''; clearEvidenceFeedback() }
watch(stateReason, value => { if (reasonMissing.value && value.trim()) { evidenceError.value = ''; reasonMissing.value = false } })
watch(() => record.value?.id, resetEvidenceEdits)
watch(() => record.value?.state_run_id, () => { handoffEvents.value = [] })
function editEvidence(item, values) {
  clearEvidenceFeedback()
  if (!corrections.value.length) editStateDigest.value = record.value.stateDigest
  const next = { key: item.key, index: item.index, quote: item.evidence, ...evidenceEdits.value[item.path], ...values }
  if (!next.remove && next.quote === item.evidence) delete evidenceEdits.value[item.path]
  else evidenceEdits.value[item.path] = next
}
async function saveEvidenceCorrections() {
  if (busy.value || correctionsStale.value) return
  clearEvidenceFeedback()
  const count = corrections.value.length
  if (count && !stateReason.value.trim()) {
    reasonMissing.value = true
    evidenceError.value = '请填写本次核对说明，再保存修正。刚才修改的证据和移除选择都已保留在表单中。'
    await nextTick()
    evidenceReasonElement.value?.focus()
    evidenceFeedbackElement.value?.scrollIntoView({ block: 'nearest' })
    return
  }
  // Electron IPC accepts plain data, not Vue's reactive item proxies.
  const saved = await confirm('correct-state', { corrections: corrections.value.map(({ key, index, quote, remove }) => ({ key, index, quote, remove: Boolean(remove) })), reason: stateReason.value,
    sourceDigest: record.value.source_digest, stateDigest: editStateDigest.value || record.value.stateDigest })
  if (saved) {
    resetEvidenceEdits()
    const remaining = record.value?.stateIssues?.length || 0
    const action = count ? `已保存 ${count} 项修正。` : '已本地重验，本次没有提交条目修改。'
    evidenceFeedback.value = remaining
      ? `${action}仍有 ${remaining} 处来源待核对，请替换对应证据原句或移除没有本章依据的条目；不会重新调用模型。`
      : `${action}本地重验已通过，请点击底部“确认交接，完成本章”。`
  } else {
    evidenceError.value = `${error.value || '保存未成功，请重试。'} 当前表单中的修正已保留。`
  }
  await nextTick()
  evidenceFeedbackElement.value?.scrollIntoView({ block: 'nearest' })
}
async function refresh() {
  if (disposed || busy.value || amendmentBusy.value) return
  const epoch = operationEpoch
  const serial = ++refreshSerial
  try {
    const value = await appService.getChapterFinalization(record.value?.id ? { id: record.value.id } : { chapterId: props.chapterId })
    if (disposed || epoch !== operationEpoch || serial !== refreshSerial) return
    const initializeChoice = !record.value && !reviewerTouched
    if (!record.value && !modeTouched && value?.checks?.manualFinalization) completionMode.value = 'manual'
    record.value = value
    if (initializeChoice && value) reviewerChoice.value = choiceForRecord(value)
    if (value) {
      const [pending, events] = await Promise.all([
        appService.listApprovals({ projectId: props.projectId, status: 'pending' }),
        value.state_run_id ? appService.listAgentEvents({ agentRunId: value.state_run_id, after: 0, limit: 5000 }) : Promise.resolve([]),
      ])
      if (disposed || epoch !== operationEpoch || serial !== refreshSerial) return
      approvals.value = pending.filter(item => [value.review_run_id, value.state_run_id].includes(item.agentRunId))
      handoffEvents.value = events
    }
  } catch (e) { if (!disposed && epoch === operationEpoch && serial === refreshSerial) error.value = e.message }
}
async function start() {
  if (amendmentBusy.value) return
  if (record.value && !selectionDiffers.value && ['failed', 'paused'].includes(record.value.status)) {
    await confirm('accept-review')
    return
  }
  busy.value = true; error.value = ''
  operationEpoch += 1
  refreshSerial += 1
  try {
    const replace = selectionDiffers.value ? record.value?.id || '' : ''
    record.value = await appService.startChapterFinalization({ projectId: props.projectId, chapterId: props.chapterId, targetLength: props.targetLength,
      freshStart: Boolean(replace), replaceFinalizationId: replace, deferReview: true,
      reviewer: { executionMode: reviewerChoice.value === 'codex' ? 'codex' : 'app_model', profileId: ['codex', 'route'].includes(reviewerChoice.value) ? '' : reviewerChoice.value } })
  } catch (e) { error.value = e.message } finally { busy.value = false }
}
async function confirm(action, extra = {}) {
  if (amendmentBusy.value) return false
  busy.value = true; error.value = ''
  operationEpoch += 1
  refreshSerial += 1
  try {
    record.value = await appService.confirmChapterFinalization({ id: record.value.id, action, reason: reason.value, ...extra })
    if (record.value?.status === 'completed') emit('completed', record.value)
    return true
  } catch (e) { error.value = e.message; return false } finally { busy.value = false }
}
async function resolveApproval(item, approved) {
  try { await appService.resolveApproval({ id: item.id, approved, note: reason.value }); await refresh() } catch (e) { error.value = e.message }
}
onMounted(() => { void refresh(); timer = setInterval(refresh, 1500); clockTimer = setInterval(() => { nowMs.value = Date.now() }, 1000) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); clearInterval(clockTimer) })
</script>

<style scoped>
.evidence-save-result:empty{display:none}.evidence-save-feedback{padding:12px 14px;background:#e8f2ee;border:1px solid #acc9c1;border-radius:8px;color:#36554c}.evidence-save-error{padding:12px 14px;background:#fff1ed;border:1px solid #e1b5a9;border-radius:8px}.handoff-review textarea[aria-invalid='true']{border-color:#b85f47}
.finalize-tip{padding:12px 14px;background:#e8f2ee;border-left:3px solid #6d9c91;color:#36554c;font-size:13px}.review-ready{display:block;margin-top:12px}.source-manuscript pre{max-height:320px;overflow:auto;white-space:pre-wrap;font:inherit;line-height:1.8;background:#f6fafb;padding:16px}.evidence-invalid{border-left:3px solid #b85f47;padding-left:12px}.evidence-omitted{background:#f3e8e1}.evidence-omitted>p:first-child{text-decoration:line-through}.handoff-review textarea{resize:vertical;min-height:80px;line-height:1.7;width:100%;box-sizing:border-box}.handoff-review article{margin-bottom:16px;overflow-wrap:anywhere}.handoff-review button{font-size:13px}.finalize-panel :is(button,select,textarea,summary):focus-visible{outline:3px solid #5d9488;outline-offset:3px}
.handoff-progress-card{position:sticky;top:-1px;z-index:3;box-shadow:0 12px 32px #294d4514;border-color:#a9c9c1!important;background:linear-gradient(145deg,#fff 0%,#f1f8f5 100%)!important}.handoff-progress-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.handoff-progress-heading h3{margin:3px 0 0;font-size:17px}.handoff-progress-heading>span{flex:0 0 auto;margin-top:5px;color:#52736b;font-size:12px;font-variant-numeric:tabular-nums}.handoff-runtime{margin:8px 0 14px;color:#58716c;font-size:12px;font-variant-numeric:tabular-nums}.handoff-progress-track{height:6px;overflow:hidden;border-radius:999px;background:#d9e9e5}.handoff-progress-track i{display:block;width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7eafa3,#386c66,#7eafa3);animation:handoff-scan 1.6s ease-in-out infinite}.handoff-checklist{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;list-style:none;margin:16px 0 0;padding:0}.handoff-checklist li{display:flex;align-items:center;gap:7px;color:#82928f;font-size:12px;line-height:1.35}.handoff-checklist li span{display:grid;place-items:center;width:20px;height:20px;flex:0 0 20px;border:1px solid #cadbd7;border-radius:50%;background:#fff}.handoff-checklist li.done{color:#47746a}.handoff-checklist li.done span{border-color:#a7c9c0;background:#e2f0ec}.handoff-checklist li.active{color:#294f47;font-weight:650}.handoff-checklist li.active span{color:#fff;border-color:#4e8176;background:#4e8176;box-shadow:0 0 0 4px #dcece8}.handoff-progress-card.is-thinking .handoff-progress-track i{background:linear-gradient(90deg,#b89a65,#8b7043,#b89a65)}.handoff-progress-card.is-stalled{border-color:#d8b59d!important;background:linear-gradient(145deg,#fff 0%,#fbf2ec 100%)!important}.handoff-progress-card.is-stalled .handoff-progress-track i{background:#b76d4f;animation-duration:2.8s}.finalize-result{margin-top:14px;border:1px solid #d4e1e5;border-radius:12px;background:#fff;overflow:hidden}.finalize-result summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 18px;cursor:pointer;list-style:none}.finalize-result summary::-webkit-details-marker{display:none}.finalize-result summary>span{display:flex;align-items:baseline;gap:9px}.finalize-result summary small{font-weight:400}.finalize-result summary em{color:#568076;font-size:12px;font-style:normal}.finalize-result[open] summary{border-bottom:1px solid #e4edef}.result-body{padding:4px 18px 16px}.result-body article:last-child{border-bottom:0}@keyframes handoff-scan{0%{transform:translateX(-110%)}50%{transform:translateX(70%)}100%{transform:translateX(240%)}}@media(max-width:760px){.handoff-checklist{grid-template-columns:repeat(2,minmax(0,1fr))}.handoff-progress-heading{display:block}.handoff-progress-heading>span{display:block;margin-top:8px}}@media(prefers-reduced-motion:reduce){.handoff-progress-track i{width:100%;opacity:.65;animation:none}}
.finalize-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;flex:0 0 auto;list-style:none;margin:0;padding:16px 24px;border-bottom:1px solid var(--ns-border);background:white}.finalize-progress li{display:flex;align-items:center;gap:8px;color:#61747d;font-size:13px}.finalize-progress li span{display:grid;place-items:center;width:26px;height:26px;border:1px solid #cad8dc;border-radius:50%;font-size:12px}.finalize-progress li[aria-current='step']{color:#365f57;font-weight:600}.finalize-progress li[aria-current='step'] span,.finalize-progress li.done span{color:#365f57;border-color:#acc9c1;background:#e4f0ec}
.finalize-backdrop{position:fixed;inset:0;z-index:120;background:#22394333;display:flex;justify-content:flex-end;padding:20px}
.finalize-panel{width:min(850px,95vw);height:100%;min-height:0;display:flex;flex-direction:column;background:#f6fafb;color:#273e45;border:1px solid #b7cfd5;border-radius:18px;box-shadow:0 24px 80px #22394333;overflow:hidden}
header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 24px;flex-shrink:0;border-bottom:1px solid #d4e1e5}footer{border-top:1px solid #d4e1e5;flex-wrap:wrap}h2{margin:4px 0}h3{margin:16px 0 10px}small{font-size:12px;color:#54727b}main{overflow-y:auto;min-height:0;flex:1;padding:24px;overscroll-behavior:contain}main section{margin-top:20px;padding:18px;background:white;border:1px solid #d4e1e5;border-radius:12px}label{display:grid;gap:8px;margin:14px 0}button,select,textarea{font:inherit;color:#29474c;border:1px solid #aac5cd;border-radius:8px;padding:10px 14px;background:#fff}button{cursor:pointer}button:disabled{color:#57747a;background:#e1ebed;cursor:wait;opacity:1}.primary-button{background:#386c66;color:#fff}blockquote{margin:10px 0;padding:10px 14px;background:#edf4f5;white-space:pre-wrap;border-left:3px solid #85aba7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.finalize-error{color:#9b3430}article{padding:8px 0;border-bottom:1px solid #edf2f3}p{line-height:1.65}.reviewer-lock{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline;margin:10px 0 14px;padding:12px 14px;border:1px solid #d4e1e5;border-radius:10px;background:#fff}.reviewer-lock span{color:#61747d;font-size:12px}.reviewer-lock strong{font-size:13px}.reviewer-lock em{grid-column:2;color:#9b5b2d;font-size:12px;font-style:normal}
</style>
