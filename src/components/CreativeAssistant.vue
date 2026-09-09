<template>
  <section class="assistant-center">
    <header class="assistant-hero">
      <div>
        <span class="eyebrow copper">CREATIVE ORCHESTRATOR</span>
        <h1>创作助手</h1>
        <p>把章节卡、场景计划、正文、质量评审和章后状态放在同一次运行中。每一步都先成为候选，由你确认后才写入项目。</p>
      </div>
      <div class="assistant-launch">
        <label><span>执行方式</span><select v-model="launch.executionMode"><option value="codex">Codex · ACP 优先</option><option value="app_model">应用模型路由</option></select></label>
        <small v-if="launch.executionMode === 'codex'" class="assistant-launch-note">Codex 模型在“模型与项目设置 → Codex 创作 Agent”中选择，并在 AgentRun 启动时锁定。</small>
        <label><span>工作流 · Creative Pack {{ creativePreferences?.version }}</span><select v-model="launch.workflowId"><option v-for="workflow in creativePreferences?.workflows || []" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option></select></label>
        <details v-if="creativePreferences?.upgrade"><summary>预览升级到 1.3.0</summary><p>新增精简流程；场景按需展开，章末默认约束事件，字数偏差保留候选。现有正文、长章节卡和已启动运行保持原样。</p><p>涉及任务：{{ creativePreferences.upgrade.changedTasks.join('、') }}</p><button type="button" @click="upgradePack">确认升级创作规则</button></details>
        <label v-if="launch.executionMode === 'app_model'"><span>生成模型</span><select v-model="launch.modelProfileId"><option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
        <label v-if="launch.workflowId === 'chapter-creation'"><span>独立审稿</span><select v-model="launch.reviewerProfileId"><option value="">质量评审路由</option><option value="codex">Codex · 新会话</option><option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
        <label v-if="launch.workflowId !== 'project-initialization'"><span>正文目标字数</span><input v-model.number="launch.targetLength" type="number" min="800" max="12000" step="100" /></label>
        <button class="primary-button" :disabled="busy || !projectId" @click="startRun">{{ busy ? '正在启动…' : '开始新的 AgentRun' }}</button>
      </div>
    </header>

    <div v-if="message.text" class="assistant-message" :class="message.state">{{ message.text }}</div>

    <div class="assistant-layout">
      <aside class="assistant-runs">
        <div class="assistant-section-title"><span>运行记录</span><button @click="loadRuns">刷新</button></div>
        <button v-for="run in runs" :key="run.id" class="assistant-run-row" :class="{ active: run.id === activeRun?.id }" @click="selectRun(run.id)">
          <span class="run-status-dot" :class="run.status"></span>
          <div><strong>{{ workflowLabel(run.workflowId) }}</strong><small>{{ backendLabel(run) }} · {{ statusLabel(run.status) }}</small></div>
          <time>{{ shortTime(run.updatedAt) }}</time>
        </button>
        <div v-if="!runs.length" class="assistant-empty">还没有运行记录。选择执行方式后开始本章。</div>
      </aside>

      <main v-if="activeRun" class="assistant-run-detail">
        <header class="assistant-run-head">
          <div>
            <span class="settings-kicker">AGENT RUN</span>
            <h2>{{ workflowLabel(activeRun.workflowId) }}</h2>
            <p>{{ backendLabel(activeRun) }}<template v-if="activeRun.executionMode === 'codex'"> · {{ activeRun.modelRoutes?.codexModel || 'Codex 默认模型' }} / {{ activeRun.modelRoutes?.codexReasoningEffort || 'high' }}</template><template v-if="activeRun.modelRoutes?.targetLength"> · 正文目标 {{ activeRun.modelRoutes.targetLength }} 字</template><template v-if="activeRun.fallbackReason"> · {{ activeRun.fallbackReason }}</template></p>
          </div>
          <div class="assistant-run-controls">
            <button v-if="['running','waiting_approval'].includes(activeRun.status)" class="outline-button" @click="pauseRun">暂停</button>
            <button v-if="activeRun.status === 'paused'" class="outline-button" @click="resumeRun">恢复</button>
            <button v-if="!['completed','cancelled'].includes(activeRun.status)" class="danger-quiet" @click="cancelRun">取消</button>
          </div>
        </header>

        <div v-if="activeRun.actualBackend === 'codex_exec'" class="compatibility-banner">Codex 兼容模式：ACP 尚未产生输出即失败，本次改用只读 exec；工具能力暂不可用。</div>
        <div v-if="activeRun.sessionRecreated" class="compatibility-banner neutral">应用重启后已重建 ACP 会话，只使用已确认内容恢复上下文。</div>
        <div v-if="activeRun.legacySnapshot" class="compatibility-banner">这是缺少完整冻结信息的旧版运行。请保留历史并开始新的升级运行，以免混用创作规则。</div>

        <section class="agent-timeline">
          <article v-for="step in activeRun.steps" :key="step.id" class="agent-step" :class="step.status">
            <div class="agent-step-marker"><span>{{ String(step.position).padStart(2, '0') }}</span></div>
            <div class="agent-step-copy">
              <div><strong>{{ stepLabel(step) }}</strong><span>{{ statusLabel(step.status) }}</span></div>
              <small>{{ step.executionBackend ? backendName(step.executionBackend) : step.action }}</small>
              <p v-if="step.error">{{ step.error }}</p>
            </div>
            <button v-if="['failed','interrupted','rejected','stale'].includes(step.status) && step.attemptCount < 3" class="step-retry" @click="retryStep(step)">重试</button>
          </article>
        </section>

        <section v-if="pendingCandidate" class="agent-candidate-card">
          <header><div><span class="settings-kicker">CANDIDATE</span><h3>{{ candidateLabel(pendingCandidate.artifactType) }}</h3></div><span><template v-if="pendingCandidate.artifactType === 'manuscript'">{{ manuscriptCount }} / {{ activeRun.modelRoutes?.targetLength || '—' }} 字 · </template>源摘要 {{ pendingCandidate.sourceDigest.slice(0, 10) }}</span></header>
          <CreativeCandidateEditor v-if="candidateDraft" v-model="candidateDraft" />
          <div class="candidate-actions">
            <input v-model.trim="candidateReason" placeholder="可选：记录本次判断" />
            <button class="outline-button" :disabled="busy" @click="resolveCandidate(false)">拒绝并暂停</button>
            <button class="primary-button" :disabled="busy" @click="resolveCandidate(true)">确认并继续</button>
          </div>
        </section>

        <section v-if="qualityStep?.output?.review" class="agent-quality-card">
          <span class="settings-kicker">QUALITY REVIEW</span>
          <h3>正文候选评审</h3>
          <p>{{ qualityStep.output.review.summary }}</p>
          <div class="quality-score-line"><span v-for="(score, key) in qualityStep.output.review.scores" :key="key"><b>{{ score }}</b><small>{{ key }}</small></span></div>
        </section>
      </main>
      <main v-else class="assistant-no-run"><span>◌</span><h2>选择或开始一次运行</h2><p>Codex 模式会为本次 AgentRun 建立独立项目镜像和长会话。</p></main>
    </div>
  </section>
</template>

<script setup>
import CreativeCandidateEditor from './CreativeCandidateEditor.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({
  projectId: { type: String, default: '' },
  chapterId: { type: String, default: '' },
  modelSettings: { type: Object, default: () => ({ profiles: [], routes: {} }) },
})
const emit = defineEmits(['workspace-change'])
const runs = ref([])
const activeRun = ref(null)
const busy = ref(false)
const candidateReason = ref('')
const message = reactive({ state: 'idle', text: '' })
const launch = reactive({ executionMode: 'codex', workflowId: 'chapter-creation', modelProfileId: '', reviewerProfileId: '', targetLength: 2000 })
const creativePreferences = ref(null)
async function loadPreferences() {
  try {
    creativePreferences.value = await appService.creativePreferences({ projectId: props.projectId })
    launch.executionMode = creativePreferences.value.executionMode
    launch.workflowId = creativePreferences.value.workflows.some(item => item.id === 'chapter-compact') ? 'chapter-compact' : 'chapter-creation'
  } catch (error) { message.text = error.message; message.state = 'error' }
}
async function upgradePack() {
  try { await appService.upgradeCreativePack({ projectId: props.projectId, confirmed: true, fromDigest: creativePreferences.value.upgrade.current.digest }); await loadPreferences() } catch (error) { message.text = error.message; message.state = 'error' }
}
let unsubscribe = null

const enabledProfiles = computed(() => props.modelSettings.profiles?.filter((profile) => profile.enabled) || [])
const pendingCandidate = computed(() => activeRun.value?.candidates?.find((candidate) => candidate.status === 'pending') || null)
const candidateDraft = ref(null)
watch(() => pendingCandidate.value?.id, () => { candidateDraft.value = pendingCandidate.value ? JSON.parse(JSON.stringify(pendingCandidate.value.payload)) : null })
const prettyCandidate = computed(() => JSON.stringify(pendingCandidate.value?.payload || {}, null, 2))
const manuscriptCount = computed(() => [...String(pendingCandidate.value?.payload?.manuscript || '')].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length)
const qualityStep = computed(() => activeRun.value?.steps?.find((step) => step.action === 'quality_review' && step.status === 'completed'))

watch(() => props.projectId, () => { activeRun.value = null; void loadRuns() })
watch(enabledProfiles, (profiles) => {
  launch.modelProfileId ||= props.modelSettings.routes?.chapter_card || profiles[0]?.id || ''
  launch.reviewerProfileId ||= props.modelSettings.routes?.quality_review || profiles[0]?.id || ''
}, { immediate: true })

onMounted(() => {
  void loadRuns()
  unsubscribe = appService.onAgentEvent((event) => {
    if (event?.projectId && event.projectId !== props.projectId) return
    if (!event?.agentRunId || (activeRun.value && event.agentRunId !== activeRun.value.id)) return
    void refreshActive(event.agentRunId)
  })
})
onBeforeUnmount(() => unsubscribe?.())

async function loadRuns() {
  const projectId=props.projectId
  if (!projectId) return
  await loadPreferences()
  const loaded=await appService.listAgentRuns({ projectId })
  if (projectId !== props.projectId) return
  runs.value=loaded
  if (activeRun.value) await refreshActive(activeRun.value.id)
  else if (runs.value[0]) await selectRun(runs.value[0].id)
}

async function refreshActive(runId) {
  const projectId = props.projectId
  const run = await appService.getAgentRun(runId)
  if (!run || run.projectId !== projectId || projectId !== props.projectId) return
  activeRun.value = run
  const index = runs.value.findIndex((item) => item.id === run.id)
  if (index >= 0) runs.value.splice(index, 1, run)
  else runs.value.unshift(run)
}

async function selectRun(runId) { await refreshActive(runId); candidateReason.value = '' }

async function startRun() {
  busy.value = true
  try {
    const run = await appService.startAgent({
      projectId: props.projectId,
      chapterId: props.chapterId,
      workflowId: launch.workflowId,
      executionMode: launch.executionMode,
      modelProfileId: launch.modelProfileId,
      reviewerProfileId: launch.reviewerProfileId,
      targetLength: Math.max(800, Math.min(12000, Math.round(Number(launch.targetLength) || 2000))),
    })
    runs.value.unshift(run)
    activeRun.value = run
    message.text = 'AgentRun 已启动。模型调用或工具请求出现时，请在审批抽屉中逐次确认。'
    message.state = 'success'
  } catch (error) { message.text = error.message; message.state = 'error' } finally { busy.value = false }
}

async function resolveCandidate(accept) {
  if (!pendingCandidate.value) return
  busy.value = true
  try {
    const payload = { runId: activeRun.value.id, candidateId: pendingCandidate.value.id, reason: candidateReason.value }
    if (accept && candidateDraft.value) payload.editedPayload = candidateDraft.value
    const run = accept ? await appService.confirmAgentCandidate(payload) : await appService.rejectAgentCandidate(payload)
    activeRun.value = run
    candidateReason.value = ''
    if (accept) emit('workspace-change')
  } catch (error) { message.text = error.message; message.state = 'error' } finally { busy.value = false }
}

async function pauseRun() { activeRun.value = await appService.pauseAgentRun(activeRun.value.id) }
async function resumeRun() {
  if (activeRun.value.legacySnapshot && !globalThis.confirm('继续使用此运行锁定的历史能力包规则？旧运行缺少完整冻结信息；取消后可从正式内容开始新的升级运行。')) return
  try { activeRun.value = await appService.resumeAgentRun({ runId: activeRun.value.id, legacyRuleChoice: 'continue' }) }
  catch (error) { message.text = error.message; message.state = 'error' }
}
async function cancelRun() { activeRun.value = await appService.cancelAgentRun(activeRun.value.id) }
async function retryStep(step) {
  if (activeRun.value.legacySnapshot && !globalThis.confirm('继续锁定的历史能力包规则重试？取消后可从正式内容新建升级运行。')) return
  try { activeRun.value = await appService.retryAgentStep({ runId: activeRun.value.id, stepId: step.id, legacyRuleChoice: 'continue' }) }
  catch (error) { message.text = error.message; message.state = 'error' }
}

function workflowLabel(id) { return ({ 'project-initialization': '项目初始化', 'chapter-creation': '完整章节流程', 'chapter-compact': '精简章节创作', 'inline-action': '就地任务' }[id] || id) }
function backendName(value) { return { codex_acp: 'Codex ACP', codex_exec: 'Codex exec', app_model: '应用模型' }[value] || value }
function backendLabel(run) { return run.actualBackend ? backendName(run.actualBackend) : run.executionMode === 'codex' ? 'Codex · 等待 ACP' : '应用模型路由' }
function statusLabel(value) { return ({ pending: '待开始', waiting_approval: '等待审批', running: '执行中', waiting_confirmation: '等待确认', paused: '已暂停', interrupted: '已中断', completed: '已完成', confirmed: '已确认', rejected: '已拒绝', stale: '已过期', cancelled: '已取消', failed: '失败' }[value] || value) }
function stepLabel(step) { return ({ preflight: '生成前准备度', chapter_card: '生成章节卡', scene_plan: '生成场景计划', chapter: '生成正文候选', quality_review: '质量评审', chapter_state_extract: '提取章后状态' }[step.task] || (step.action === 'checkpoint' ? '等待作者确认' : step.key)) }
function candidateLabel(type) { return ({ chapter_card: '章节卡候选', scene_plan: '场景计划候选', manuscript: '正文候选', manuscript_selection: '局部重写候选', planning_field: '规划字段候选', renderer_draft: '编辑器草稿候选', chapter_state: '章后状态候选', continuity_audit: '连续性审计候选', quality_review: '质量评审候选', foundation_bundle: '故事基础候选' }[type] || type) }
function shortTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }
</script>
