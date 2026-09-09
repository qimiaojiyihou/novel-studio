<template>
  <div v-if="pending.length || notice" class="approval-dock">
    <button v-if="!open" type="button" class="approval-dock-trigger" @click="open = true"><span>{{ pending.length }}</span>{{ pending.length ? ' 个 Codex 请求等待审批' : ' 查看审批结果' }}</button>
    <aside v-if="open" class="approval-drawer">
      <header><div><span class="settings-kicker">PERMISSION QUEUE</span><h2>逐次审批</h2></div><button type="button" aria-label="关闭审批面板" @click="open = false">×</button></header>
      <p class="approval-intro">
        <span v-if="modelSessionApprovalEnabled">本项目模型调用已在当前应用会话内免重复审批；工具操作和正式写入仍逐次确认。</span>
        <span v-else>模型调用可授权到当前项目的本次应用会话；工具操作和正式写入始终逐次确认。</span>
        <button v-if="modelSessionApprovalEnabled" type="button" @click="setModelSessionApproval(false)">恢复模型逐次审批</button>
      </p>
      <p v-if="notice" class="approval-notice" :class="noticeTone" role="status">{{ notice }}</p>
      <p v-if="!pending.length" class="approval-empty">当前没有等待处理的审批请求。</p>
      <article v-for="request in pending" :key="request.id" class="approval-card" :aria-busy="resolvingId === request.id">
        <div class="approval-card-head"><span>{{ actionLabel(request.actionType) }}</span><time :class="{ expired: isExpired(request) }">{{ expiryLabel(request) }}</time></div>
        <h3>{{ request.permission }}</h3>
        <pre>{{ approvalPreview(request) }}</pre>
        <label v-if="highRisk(request)"><span>批准备注</span><input v-model.trim="notes[request.id]" :disabled="Boolean(resolvingId) || isExpired(request)" placeholder="高风险操作需要说明本次用途" /></label>
        <div class="approval-actions">
          <button type="button" class="outline-button" :disabled="Boolean(resolvingId) || isExpired(request)" @click="resolve(request, false)">{{ resolvingId === request.id ? '处理中…' : '拒绝' }}</button>
          <button type="button" class="primary-button" :disabled="Boolean(resolvingId) || isExpired(request) || (highRisk(request) && !notes[request.id])" @click="resolve(request, true)">{{ resolvingId === request.id ? '处理中…' : '仅批准本次' }}</button>
          <button v-if="request.actionType === 'model_call'" type="button" class="primary-button approval-session-button" :disabled="Boolean(resolvingId) || isExpired(request)" @click="approveProjectSession(request)">本项目会话免审</button>
        </div>
      </article>
    </aside>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { approvalExpired, approvalExpiryLabel } from '../utils/approval-state.js'

const props = defineProps({ projectId: { type: String, default: '' } })
const pending = ref([])
const open = ref(false)
const modelSessionApprovalEnabled = ref(false)
const nowMs = ref(Date.now())
const resolvingId = ref('')
const notice = ref('')
const noticeTone = ref('success')
const notes = reactive({})
let unsubscribe = null
let clockTimer = null
let noticeTimer = null
let closeTimer = null
let loadSequence = 0
let expiryRefreshInFlight = false

watch(() => props.projectId, () => {
  pending.value = []
  open.value = false
  clearNotice()
  void load()
})
onMounted(() => {
  void load()
  unsubscribe = appService.onApprovalEvent(event => {
    if (event?.projectId === props.projectId) void load(true)
  })
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
    if (!expiryRefreshInFlight && pending.value.some(request => isExpired(request))) void refreshExpiredRequests()
  }, 1000)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  window.clearInterval(clockTimer)
  window.clearTimeout(noticeTimer)
  window.clearTimeout(closeTimer)
})

async function load(reveal = false) {
  const projectId = props.projectId
  if (!projectId) return false
  const sequence = ++loadSequence
  try {
    const [requests, policy] = await Promise.all([
      appService.listApprovals({ projectId, status: 'pending' }),
      appService.getSessionModelApproval(projectId),
    ])
    if (sequence !== loadSequence || projectId !== props.projectId) return false
    pending.value = requests
    modelSessionApprovalEnabled.value = Boolean(policy.enabled)
    if (reveal && pending.value.length) open.value = true
    return true
  } catch (error) {
    if (sequence === loadSequence) showNotice(`审批队列刷新失败：${errorMessage(error)}`, 'error', 6000)
    return false
  }
}

async function setModelSessionApproval(enabled) {
  try {
    const policy = await appService.setSessionModelApproval({ projectId: props.projectId, enabled })
    modelSessionApprovalEnabled.value = Boolean(policy.enabled)
    return true
  } catch (error) {
    showNotice(`会话审批设置失败：${errorMessage(error)}`, 'error', 6000)
    return false
  }
}

async function approveProjectSession(request) {
  if (resolvingId.value) return
  if (isExpired(request)) return resolve(request, true)
  const updated = await setModelSessionApproval(true)
  if (updated) await resolve(request, true)
}

async function resolve(request, approved) {
  if (resolvingId.value) return
  open.value = true
  if (isExpired(request)) {
    showNotice('该审批请求已经过期，已从队列移除。请回到原任务重新触发操作。', 'error', 6500)
    await load()
    return
  }
  resolvingId.value = request.id
  clearNotice()
  try {
    await appService.resolveApproval({ id: request.id, approved, note: notes[request.id] || '', reason: approved ? '' : notes[request.id] || '用户拒绝本次请求' })
    delete notes[request.id]
    await load()
    showNotice(approved ? '已批准本次请求，原任务正在继续。' : '已拒绝本次请求，结果已返回原任务。', 'success', 2600)
    if (!pending.value.length) scheduleClose()
  } catch (error) {
    const message = errorMessage(error)
    const expired = /expired|过期/i.test(message)
    showNotice(expired ? '该审批请求已经过期，已从队列移除。请回到原任务重新触发操作。' : `审批处理失败：${message}`, 'error', 6500)
    await load()
    open.value = true
  } finally {
    resolvingId.value = ''
  }
}

async function refreshExpiredRequests() {
  expiryRefreshInFlight = true
  open.value = true
  showNotice('审批请求已过期，已从队列移除。请回到原任务重新触发操作。', 'error', 6500)
  try { await load() } finally { expiryRefreshInFlight = false }
}

function showNotice(message, tone = 'success', duration = 4000) {
  window.clearTimeout(noticeTimer)
  window.clearTimeout(closeTimer)
  notice.value = message
  noticeTone.value = tone
  noticeTimer = window.setTimeout(() => { notice.value = '' }, duration)
}

function clearNotice() {
  window.clearTimeout(noticeTimer)
  window.clearTimeout(closeTimer)
  notice.value = ''
}

function scheduleClose() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => { if (!pending.value.length) open.value = false }, 2200)
}

function errorMessage(error) { return String(error?.message || error || '未知错误') }
function isExpired(request) { return approvalExpired(request, nowMs.value) }
function expiryLabel(request) { return approvalExpiryLabel(request, nowMs.value) }

function highRisk(request) { return ['command', 'web', 'mcp', 'subagent', 'project_write'].includes(request.actionType) }
function actionLabel(type) { return ({ model_call: '模型调用', command: '命令', file: '镜像文件', web: '网络', mcp: 'MCP', subagent: '子 Agent', project_write: '项目写入' }[type] || type) }
function approvalPreview(request) {
  const payload = request.payload || {}
  if (payload.before !== undefined || payload.after !== undefined) return `文件：${payload.path || ''}\n\n原内容：\n${payload.before || '（新文件）'}\n\n候选内容：\n${payload.after || ''}`
  return JSON.stringify(payload, null, 2).slice(0, 12000)
}
</script>

<style scoped>
.approval-notice,
.approval-empty { margin: 14px 22px 0; padding: 12px 14px; border: 1px solid; border-radius: 9px; font-size: 10px; line-height: 1.6; }
.approval-notice.success { color: #245e53; border-color: rgba(45, 123, 114, .34); background: rgba(45, 123, 114, .1); }
.approval-notice.error { color: #9b4538; border-color: rgba(182, 85, 62, .35); background: rgba(182, 85, 62, .1); }
.approval-empty { color: #776d62; border-color: #d0c6b9; background: rgba(255, 255, 255, .45); }
.approval-card-head time.expired { color: #a33e31; font-weight: 700; }
.approval-actions button:disabled,
.approval-card input:disabled { cursor: not-allowed; opacity: .48; }
</style>
