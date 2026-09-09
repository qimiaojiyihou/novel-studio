<template>
  <section v-if="view || error" class="amendment-card" aria-label="定稿后校正">
    <header><div><small>作者校正 · 不调用模型</small><h3>定稿后校正</h3></div><button :disabled="busy || disabled" @click="refresh">刷新差异</button></header>
    <template v-if="view">
      <p>仅改错字、标点或排版，可核对差异后沿用原审稿。实质改写后可使用下方完整审稿流程；若选择跳过审稿与交接，请在上方切换为“人工直接定稿”。</p>
      <p class="amendment-lineage">原审稿：{{ view.reviewer?.model }} · {{ date(view.reviewedAt) }}<br>最近定稿：{{ date(view.completedAt) }}<span v-if="view.priorCorrection"> · 沿用原审稿，经作者校正</span></p>
      <template v-if="!view.alreadyCurrent">
        <h4>与最近定稿对比 · {{ view.changes.length }} 处变更范围</h4>
        <p class="amendment-warning">少量改字也可能改变含义（例如增加或删去“不”）。这里展示文字差异，不自动判断语义。</p>
        <div class="amendment-diff" aria-label="与最近定稿的差异">
          <p v-if="!view.changes.length">正文与最近定稿一致，可核对其他来源后恢复定稿。</p>
          <article v-for="(change, index) in view.changes" :key="index"><small>第 {{ index + 1 }} 处</small><p><span>{{ view.baseline.slice(Math.max(0, change.from - 32), change.from) }}</span><del v-if="change.before">{{ change.before }}</del><ins v-if="change.after">{{ change.after }}</ins><span>{{ view.baseline.slice(change.to, change.to + 32) }}</span></p></article>
        </div>
        <details v-if="view.priorCorrection" open><summary>与原审稿正文的累计差异 · {{ view.cumulativeChanges.length }} 处（含以前的校正）</summary><div class="amendment-diff"><p v-if="!view.cumulativeChanges.length">与原审稿正文一致。</p><article v-for="(change, index) in view.cumulativeChanges" :key="index"><small>第 {{ index + 1 }} 处</small><p><span>{{ view.reviewedManuscript.slice(Math.max(0, change.from - 32), change.from) }}</span><del v-if="change.before">{{ change.before }}</del><ins v-if="change.after">{{ change.after }}</ins><span>{{ view.reviewedManuscript.slice(change.to, change.to + 32) }}</span></p></article></div></details>
        <details><summary>完整正文对照（原文与当前保存稿）</summary><h4>最近定稿原文</h4><pre>{{ view.baseline }}</pre><h4>当前保存稿</h4><pre>{{ view.manuscript }}</pre></details>
        <p v-if="view.pending" class="amendment-error">本章已有未结束的定稿任务。请先在下方取消该任务，刷新差异后再校正；也可继续完整定稿。</p>
        <p v-if="view.dependencyIssues.length" class="amendment-error">原审稿依赖的设定或其他章节已变化，请重新审稿。来源：{{ view.dependencyIssues.join('、') }}</p>
        <p v-for="finding in view.checks.findings" :key="finding.id" class="amendment-warning">本地检查：{{ finding.reason }}</p>
        <div v-if="view.issues.length" class="amendment-evidence"><h4>仅核对受影响的交接引句 · {{ view.issues.length }} 处</h4><p>条目含义保留。请从当前保存稿复制原句；如果事实本身有变化，请重新审稿。</p>
          <article v-for="issue in view.issues" :key="issue.path"><p>{{ issue.text || issue.message }}</p><blockquote>{{ issue.quote }}</blockquote><label v-if="issue.key">新的证据原句<textarea v-model="quotes[issue.path]" rows="3" :disabled="busy || disabled" /></label><p v-else class="amendment-error">{{ issue.message }}，请走完整定稿流程。</p></article>
        </div>
        <label>校正说明<textarea v-model="reason" rows="2" :disabled="busy || disabled" placeholder="例如：把‘以经’改成‘已经’，统一引号；情节、事实和交接含义均未改变。" /></label>
        <label class="amendment-attestation"><input v-model="attested" type="checkbox" :disabled="busy || disabled">我已核对累计差异，确认仅属文字校正，未改变剧情、人物事实和交接含义。</label>
        <button class="primary-button" :disabled="busy || disabled || blocked" :aria-busy="busy" @click="save">{{ busy ? '正在保存校正…' : '确认文字校正，恢复定稿' }}</button>
      </template>
      <p v-else class="amendment-success">当前正文已定稿{{ view.priorCorrection ? '·已校正。沿用原审稿，经作者校正；没有新增模型审稿。' : '，暂时没有需要确认的正文校正。' }}</p>
    </template>
    <p v-if="error" ref="errorElement" class="amendment-error" role="alert" tabindex="-1">{{ error }}</p>
    <p v-if="success" ref="successElement" class="amendment-success" role="status" tabindex="-1">{{ success }}</p>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
const props = defineProps({ projectId: String, chapterId: String, disabled: Boolean })
const emit = defineEmits(['completed', 'busy'])
const view = ref(null), quotes = ref({}), reason = ref(''), attested = ref(false), busy = ref(false), error = ref(''), success = ref(''), errorElement = ref(null)
const successElement = ref(null)
let serial = 0, disposed = false, pendingInput = null
watch([reason, attested], () => { if (reason.value.trim() && attested.value && error.value === '请填写校正说明，并勾选确认未改变剧情与事实。') error.value = '' })
const date = value => new Date(value).toLocaleString('zh-CN')
const blocked = computed(() => view.value?.pending || view.value?.dependencyIssues.length || view.value?.checks.findings.some(item => item.severity === 'high') || view.value?.issues.some(item => !item.key))
async function refresh() {
  if (busy.value || props.disabled) return
  const epoch = ++serial
  try {
    const next = await appService.previewChapterAmendment({ projectId: props.projectId, chapterId: props.chapterId })
    if (disposed || epoch !== serial) return
    view.value = next; quotes.value = {}; attested.value = false; pendingInput = null; reason.value = ''; error.value = ''; success.value = ''
  } catch (e) { if (!disposed && epoch === serial) error.value = e.message }
}
async function save() {
  if (busy.value || props.disabled || blocked.value) return
  error.value = ''; success.value = ''
  if (!attested.value || !reason.value.trim()) {
    error.value = '请填写校正说明，并勾选确认未改变剧情与事实。'
    await nextTick(); errorElement.value?.focus(); return
  }
  const input = { projectId: props.projectId, chapterId: props.chapterId, baseFinalizationId: view.value.baseFinalizationId,
    sourceDigest: view.value.sourceDigest, stateDigest: view.value.stateDigest, previewDigest: view.value.previewDigest,
    meaningUnchanged: true, confirm: true, reason: reason.value.trim(),
    corrections: view.value.issues.filter(item => item.key).map(item => ({ key: item.key, index: item.index, quote: quotes.value[item.path] || '' })) }
  // Retrying an unchanged form after a lost IPC response keeps the same key.
  if (!pendingInput || JSON.stringify(input) !== pendingInput.fingerprint) pendingInput = { fingerprint: JSON.stringify(input), requestId: crypto.randomUUID() }
  busy.value = true; emit('busy', true)
  try {
    const result = await appService.confirmChapterAmendment({ ...input, requestId: pendingInput.requestId })
    if (disposed) return
    if (result.status !== 'completed') throw new Error('校正已留档，但正文后来又有变化。请刷新差异核对当前版本。')
    emit('completed', result)
    view.value = await appService.previewChapterAmendment({ projectId: props.projectId, chapterId: props.chapterId })
    success.value = '校正已保存，状态为“已定稿·已校正”。原审稿与校正记录均已保留，本次没有调用模型。'
    await nextTick(); successElement.value?.focus(); successElement.value?.scrollIntoView({ block: 'nearest' })
  } catch (e) { if (!disposed) { error.value = `${e.message} 表单内容已保留。`; await nextTick(); errorElement.value?.focus() } }
  finally { busy.value = false; emit('busy', false) }
}
watch(() => [props.projectId, props.chapterId], refresh, { immediate: true })
onBeforeUnmount(() => { disposed = true; serial++ })
</script>

<style scoped>
.amendment-card{padding:20px;border:1px solid #b5d2c9;border-radius:12px;background:#fff;color:#273e45}.amendment-card header{display:flex;align-items:center;justify-content:space-between;gap:12px}.amendment-card h3{margin:4px 0}.amendment-card small,.amendment-lineage{color:#597871;font-size:12px}.amendment-card p{line-height:1.7;overflow-wrap:anywhere}.amendment-warning{padding:10px 12px;border-left:3px solid #bfa46f;background:#fcf8ef;font-size:13px}.amendment-diff{max-height:300px;overflow:auto;border:1px solid #d5e2df;border-radius:8px;padding:12px;overscroll-behavior:contain}.amendment-diff article+article{border-top:1px solid #e4ecea;padding-top:8px}.amendment-diff p{white-space:pre-wrap;margin:6px 0 14px}.amendment-diff del{color:#893f3f;background:#fbe7e7}.amendment-diff ins{color:#285f4b;background:#e0f1e8;text-decoration:underline}.amendment-card details{margin:14px 0}.amendment-card summary{cursor:pointer;line-height:1.7}.amendment-card pre{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8;background:#f3f7f8;padding:12px}.amendment-card label{display:grid;gap:8px;margin:14px 0}.amendment-card textarea{width:100%;box-sizing:border-box;resize:vertical;line-height:1.7}.amendment-card button,.amendment-card textarea{font:inherit;border:1px solid #abc7c0;border-radius:8px;padding:10px 14px;color:#29474c;background:#fff}.amendment-card button{cursor:pointer}.amendment-card .primary-button{color:#fff;background:#386c66}.amendment-card button:disabled{opacity:.6;cursor:default}.amendment-card .amendment-attestation{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.6}.amendment-attestation input{width:18px;height:18px;flex:0 0 18px;margin:3px 0;accent-color:#386c66}.amendment-error{padding:10px 12px;background:#fff1ed;color:#993d36;border:1px solid #e2b9b0;border-radius:8px}.amendment-success{color:#365f51;padding:10px;background:#e8f3ed}.amendment-evidence{border-top:1px solid #dde7e3}.amendment-evidence blockquote{margin:0;background:#f3f6f6;padding:12px;white-space:pre-wrap}.amendment-card :is(button,textarea,input,summary):focus-visible{outline:3px solid #5d9488;outline-offset:3px}
</style>
