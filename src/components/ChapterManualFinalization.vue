<template>
  <section class="manual-finalization" aria-label="人工直接定稿">
    <h3>人工直接定稿</h3>
    <p>以你当前保存的正文为准，直接标记为定稿。不限于错字校正，也适用于人工改写后的版本。</p>
    <p class="manual-notice">本次不调用 AI 审稿，不生成或更新交接。旧审稿与旧交接保留为历史记录；后续创作不会将旧交接视为本版的已确认内容。需要时可再选择“审稿并交接”。</p>
    <p v-if="view">{{ view.title }} · {{ view.hanCount }} 中文字 · 当前保存稿</p>
    <p v-if="view?.pending" class="manual-error">本章有未结束的定稿任务。请切回“审稿并交接”完成或取消该任务后，再刷新。</p>
    <template v-if="!view?.alreadyCurrent">
      <label>定稿说明（选填）<textarea v-model="reason" rows="2" :disabled="busy || disabled" placeholder="例如：人工修改已完成，本次直接定稿。" /></label>
      <button class="primary-button" :disabled="busy || disabled || loading || !view || view.empty || Boolean(view.pending)" :aria-busy="busy" @click="save">{{ busy ? '正在保存定稿…' : '确认直接定稿' }}</button>
      <p v-if="view?.empty" class="manual-error">正文为空，请先保存正文再定稿。</p>
    </template>
    <p v-else-if="!success" class="manual-success">当前保存稿已人工定稿。本版未审稿，交接未更新。</p>
    <button class="refresh-button" :disabled="busy || disabled || loading" @click="refresh">刷新当前保存稿</button>
    <p v-if="error" ref="errorElement" role="alert" tabindex="-1" class="manual-error">{{ error }}</p>
    <p v-if="success" ref="successElement" role="status" tabindex="-1" class="manual-success">{{ success }}</p>
  </section>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
const props = defineProps({ projectId: String, chapterId: String, disabled: Boolean })
const emit = defineEmits(['busy', 'completed'])
const view = ref(null), reason = ref(''), busy = ref(false), loading = ref(false), error = ref(''), success = ref('')
const errorElement = ref(null), successElement = ref(null)
let serial = 0, disposed = false, pending = null
async function refresh() {
  if (busy.value || props.disabled) return
  const epoch = ++serial
  loading.value = true
  try {
    const value = await appService.previewManualFinalization({ projectId: props.projectId, chapterId: props.chapterId })
    if (disposed || epoch !== serial) return
    view.value = value; pending = null; error.value = ''; success.value = ''
  } catch (e) { if (!disposed && epoch === serial) error.value = e.message }
  finally { if (!disposed && epoch === serial) loading.value = false }
}
async function save() {
  if (busy.value || props.disabled || loading.value || !view.value || view.value.pending) return
  const input = { projectId: props.projectId, chapterId: props.chapterId, sourceDigest: view.value.sourceDigest,
    previewDigest: view.value.previewDigest, confirm: true, skipReview: true, skipHandoff: true, reason: reason.value.trim() }
  const fingerprint = JSON.stringify(input)
  if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, requestId: crypto.randomUUID() }
  busy.value = true; emit('busy', true); error.value = ''; success.value = ''
  try {
    const result = await appService.confirmManualFinalization({ ...input, requestId: pending.requestId })
    if (disposed) return
    if (result.status !== 'completed') throw new Error('定稿决定已留档，正文随后又有修改，请刷新后核对')
    view.value = { ...view.value, alreadyCurrent: true }
    emit('completed', result)
    success.value = '已人工定稿。本次已跳过审稿和交接，没有调用模型。'
    await nextTick(); successElement.value?.focus(); successElement.value?.scrollIntoView({ block: 'nearest' })
  } catch (e) {
    if (!disposed) { error.value = `${e.message} 定稿说明已保留。`; await nextTick(); errorElement.value?.focus() }
  } finally { busy.value = false; emit('busy', false) }
}
watch(() => [props.projectId, props.chapterId], refresh, { immediate: true })
onBeforeUnmount(() => { disposed = true; serial++ })
</script>

<style scoped>
.manual-finalization{padding:20px;border:1px solid #b5d2c9;border-radius:12px;background:#fff;color:#273e45}.manual-finalization h3{margin:0 0 12px}.manual-finalization p{line-height:1.7}.manual-notice{padding:12px 14px;background:#fcf8ef;border-left:3px solid #bfa46f}.manual-finalization label{display:grid;gap:8px;margin:16px 0}.manual-finalization textarea{resize:vertical;line-height:1.7}.manual-finalization :is(button,textarea){font:inherit;border:1px solid #abc7c0;border-radius:8px;padding:10px 14px;color:#29474c;background:#fff}.manual-finalization button{cursor:pointer}.manual-finalization .primary-button{background:#386c66;color:#fff}.manual-finalization button:disabled{opacity:.6;cursor:default}.refresh-button{margin:12px 0 0 12px}.manual-error{color:#993d36;padding:12px;background:#fff1ed}.manual-success{padding:12px;background:#e8f3ed;color:#365f51}.manual-finalization :is(button,textarea):focus-visible{outline:3px solid #5d9488;outline-offset:3px}
</style>
