<template>
  <div v-if="pending.length" class="approval-dock">
    <button class="approval-dock-trigger" @click="open = !open"><span>{{ pending.length }}</span> 个 Codex 请求等待审批</button>
    <aside v-if="open" class="approval-drawer">
      <header><div><span class="settings-kicker">PERMISSION QUEUE</span><h2>逐次审批</h2></div><button @click="open = false">×</button></header>
      <p class="approval-intro">
        <span v-if="modelSessionApprovalEnabled">本项目模型调用已在当前应用会话内免重复审批；工具操作和正式写入仍逐次确认。</span>
        <span v-else>模型调用可授权到当前项目的本次应用会话；工具操作和正式写入始终逐次确认。</span>
        <button v-if="modelSessionApprovalEnabled" type="button" @click="setModelSessionApproval(false)">恢复模型逐次审批</button>
      </p>
      <article v-for="request in pending" :key="request.id" class="approval-card">
        <div class="approval-card-head"><span>{{ actionLabel(request.actionType) }}</span><time>5 分钟内有效</time></div>
        <h3>{{ request.permission }}</h3>
        <pre>{{ approvalPreview(request) }}</pre>
        <label v-if="highRisk(request)"><span>批准备注</span><input v-model.trim="notes[request.id]" placeholder="高风险操作需要说明本次用途" /></label>
        <div class="approval-actions"><button class="outline-button" @click="resolve(request, false)">拒绝</button><button class="primary-button" :disabled="highRisk(request) && !notes[request.id]" @click="resolve(request, true)">仅批准本次</button><button v-if="request.actionType === 'model_call'" class="primary-button approval-session-button" @click="approveProjectSession(request)">本项目会话免审</button></div>
      </article>
    </aside>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({ projectId: { type: String, default: '' } })
const pending = ref([])
const open = ref(false)
const modelSessionApprovalEnabled = ref(false)
const notes = reactive({})
let unsubscribe = null

watch(() => props.projectId, () => void load())
onMounted(() => {
  void load()
  unsubscribe = appService.onApprovalEvent(() => void load(true))
})
onBeforeUnmount(() => unsubscribe?.())

async function load(reveal = false) {
  if (!props.projectId) return
  const [requests, policy] = await Promise.all([
    appService.listApprovals({ projectId: props.projectId, status: 'pending' }),
    appService.getSessionModelApproval(props.projectId),
  ])
  pending.value = requests
  modelSessionApprovalEnabled.value = Boolean(policy.enabled)
  if (reveal && pending.value.length) open.value = true
}

async function setModelSessionApproval(enabled) {
  const policy = await appService.setSessionModelApproval({ projectId: props.projectId, enabled })
  modelSessionApprovalEnabled.value = Boolean(policy.enabled)
}

async function approveProjectSession(request) {
  await setModelSessionApproval(true)
  await resolve(request, true)
}

async function resolve(request, approved) {
  await appService.resolveApproval({ id: request.id, approved, note: notes[request.id] || '', reason: approved ? '' : notes[request.id] || '用户拒绝本次请求' })
  delete notes[request.id]
  await load()
  if (!pending.value.length) open.value = false
}

function highRisk(request) { return ['command', 'web', 'mcp', 'subagent', 'project_write'].includes(request.actionType) }
function actionLabel(type) { return ({ model_call: '模型调用', command: '命令', file: '镜像文件', web: '网络', mcp: 'MCP', subagent: '子 Agent', project_write: '项目写入' }[type] || type) }
function approvalPreview(request) {
  const payload = request.payload || {}
  if (payload.before !== undefined || payload.after !== undefined) return `文件：${payload.path || ''}\n\n原内容：\n${payload.before || '（新文件）'}\n\n候选内容：\n${payload.after || ''}`
  return JSON.stringify(payload, null, 2).slice(0, 12000)
}
</script>
