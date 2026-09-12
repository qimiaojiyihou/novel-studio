<template>
  <aside v-if="visible" class="story-change-panel" aria-label="设定联动修改">
    <header class="change-panel-head">
      <div>
        <span>STORY CHANGESET</span>
        <h2>{{ currentSet?.rootLabel || target?.fieldLabel || '设定联动修改' }}</h2>
        <p>改一处，检查整本书；确认前不会写入项目。</p>
      </div>
      <button type="button" aria-label="关闭设定联动修改" @click="emit('close')">×</button>
    </header>

    <nav class="change-tabs">
      <button :class="{ active: view === 'change' }" :disabled="!target && !currentSet" @click="view = 'change'">本次修改</button>
      <button :class="{ active: view === 'history' }" @click="openHistory">历史记录 <span>{{ history.length }}</span></button>
    </nav>

    <div v-if="error || run?.error" class="change-error">{{ error || run?.error }}</div>

    <main v-if="view === 'history'" class="change-panel-body history-body">
      <div v-if="loading && !history.length" class="change-empty">正在读取设定变更记录…</div>
      <div v-else-if="!history.length" class="change-empty">
        <strong>还没有联动修改记录</strong>
        <p>在故事基础、人物、世界观、总纲或章节规划字段旁点击“联动修改”。</p>
      </div>
      <button v-for="item in history" :key="item.id" class="history-card" @click="inspectHistory(item)">
        <span :class="`history-status status-${item.status}`">{{ setStatusLabel(item.status) }}</span>
        <strong>{{ item.rootLabel }}</strong>
        <p>{{ item.summary || item.instruction || '等待联动分析' }}</p>
        <small>{{ item.counts?.total || 0 }} 项 · {{ formatTime(item.updatedAt) }}</small>
      </button>
    </main>

    <main v-else class="change-panel-body">
      <section v-if="!currentSet" class="change-brief">
        <div class="root-card">
          <span>当前根设定</span>
          <strong>{{ target?.fieldLabel || '尚未选择设定' }}</strong>
          <p>{{ target?.currentValue || '当前内容为空，请先保存一项设定。' }}</p>
        </div>
        <label>
          <span>你想怎样改 <b>*</b></span>
          <textarea v-model.trim="instruction" rows="5" placeholder="例如：把主角获得能力的代价改成每次使用都会失去一段近期记忆；保留能力本身，重新校准人物动机、世界规则和后续章节。"></textarea>
        </label>
        <label class="explicit-toggle">
          <input v-model="useExplicitValue" type="checkbox" />
          <span>我已经写好了这项设定的新内容</span>
        </label>
        <label v-if="useExplicitValue">
          <span>明确的新设定</span>
          <textarea v-model="proposedValue" rows="5" placeholder="这里的文字将作为根设定的新内容；Codex 只负责分析和同步其他受影响内容。"></textarea>
        </label>
        <label class="manuscript-toggle">
          <input v-model="includeManuscript" type="checkbox" />
          <span><strong>同时检查已写正文</strong><small>正文只进入“人工复核”，默认不勾选。</small></span>
        </label>
        <div class="change-primary-actions">
          <button type="button" :disabled="busy || !canStart" @click="beginAnalysis">{{ busy ? '正在建立分析…' : '扫描全书并让 Codex 分析' }}</button>
        </div>
      </section>

      <template v-else>
        <section class="change-run-summary">
          <div>
            <span>状态</span>
            <strong :class="`status-${currentSet.status}`">{{ setStatusLabel(currentSet.status) }}</strong>
          </div>
          <div><span>影响项</span><strong>{{ currentSet.counts?.total || 0 }}</strong></div>
          <div><span>已选择</span><strong>{{ currentSet.counts?.selected || 0 }}</strong></div>
          <div><span>执行后端</span><strong>{{ backendLabel }}</strong></div>
        </section>

        <section v-if="pendingApproval" class="change-approval">
          <span>APPROVAL</span>
          <h3>{{ pendingApproval.permission }}</h3>
          <p>这是一轮整书影响分析，不会直接写入任何设定。</p>
          <div>
            <button type="button" :disabled="busy" @click="resolveApproval(false)">拒绝</button>
            <button type="button" class="accent" :disabled="busy" @click="resolveApproval(true)">批准本次分析</button>
          </div>
        </section>

        <section v-if="isAnalyzing" class="change-analyzing">
          <i></i>
          <div><strong>{{ runStatusLabel }}</strong><p>先使用确定性引用扫描，再由 Codex 判断隐含因果、人物知情边界和正文承接。</p></div>
        </section>

        <section v-if="currentSet.summary" class="change-summary-copy">
          <span>分析摘要</span>
          <p>{{ currentSet.summary }}</p>
        </section>

        <section v-for="group in visibleGroups" :key="group.level" class="change-group" :class="`group-${group.level}`">
          <header>
            <div><span>{{ group.eyebrow }}</span><h3>{{ group.label }} <b>{{ group.items.length }}</b></h3></div>
            <button v-if="group.level !== 'required' && currentSet.status === 'waiting_confirmation'" type="button" @click="toggleGroup(group)">{{ group.items.every(item => item.selected) ? '全部取消' : '全部选择' }}</button>
          </header>
          <article v-for="item in group.items" :key="item.id" class="change-item" :class="{ selected: item.selected, manuscript: item.targetKind === 'manuscript' }">
            <label class="change-item-select">
              <input
                type="checkbox"
                :checked="item.selected"
                :disabled="currentSet.status !== 'waiting_confirmation' || item.impactLevel === 'required' || selectionBusyId === item.id"
                @change="setSelection(item, $event.target.checked)"
              />
              <span><strong>{{ item.fieldLabel }}</strong><small>{{ item.reason }}</small></span>
            </label>
            <div v-if="item.targetKind === 'manuscript'" class="manuscript-warning">正文修改会先保存旧稿版本；请展开差异后再决定是否勾选。</div>
            <details class="change-diff" :open="item.impactLevel === 'required'">
              <summary>查看修改前后</summary>
              <div>
                <section><span>修改前</span><pre>{{ formatValue(item.before) }}</pre></section>
                <section><span>修改后</span><pre>{{ formatValue(item.after) }}</pre></section>
              </div>
            </details>
            <div v-if="item.evidence?.length" class="change-evidence"><span v-for="evidence in item.evidence" :key="evidence">{{ evidenceLabel(evidence) }}</span></div>
          </article>
        </section>

        <section v-if="currentSet.status === 'stale'" class="change-stale">
          项目内容在分析后发生了变化。为避免覆盖新内容，请从目标设定重新发起联动修改。
        </section>
      </template>
    </main>

    <footer v-if="view === 'change' && currentSet" class="change-panel-footer">
      <template v-if="currentSet.status === 'waiting_confirmation'">
        <button type="button" :disabled="busy" @click="discard">放弃整组</button>
        <button type="button" class="accent" :disabled="busy || !currentSet.counts?.selected || !pendingCandidate" @click="applySelected">{{ busy ? '正在写入…' : `一次应用 ${currentSet.counts?.selected || 0} 项` }}</button>
      </template>
      <template v-else-if="currentSet.status === 'applied'">
        <span>已作为一个事务写入，可整组撤销。</span>
        <button type="button" class="danger" :disabled="busy" @click="revert">撤销整组</button>
      </template>
      <template v-else-if="isAnalyzing">
        <button type="button" class="danger" :disabled="busy" @click="cancelAnalysis">取消分析</button>
      </template>
      <template v-else-if="retryableStep">
        <button type="button" :disabled="busy" @click="discard">放弃整组</button>
        <button type="button" class="accent" :disabled="busy" @click="retryAnalysis">重试分析</button>
      </template>
      <button v-else-if="['draft', 'analyzing'].includes(currentSet.status)" type="button" class="danger" :disabled="busy" @click="discard">放弃整组</button>
      <button v-else type="button" @click="openHistory">返回历史</button>
    </footer>
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
  target: { type: Object, default: null },
  resumeRunId: { type: String, default: '' },
  resumeChangeSetId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'workspace-change', 'toast', 'run-updated'])
const view = ref('change')
const instruction = ref('')
const proposedValue = ref('')
const useExplicitValue = ref(false)
const includeManuscript = ref(true)
const currentSet = ref(null)
const run = ref(null)
const history = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const selectionBusyId = ref('')
let refreshTimer = null
let eventCleanup = null

const canStart = computed(() => Boolean(props.projectId && props.target?.kind && props.target?.targetId && props.target?.fieldKey && instruction.value.trim() && (!useExplicitValue.value || proposedValue.value.trim())))
const pendingCandidate = computed(() => [...(run.value?.candidates || [])].reverse().find((item) => item.status === 'pending' && item.artifactType === 'story_change_set') || null)
const pendingApproval = computed(() => run.value?.approvals?.find((item) => item.status === 'pending') || null)
const retryableStep = computed(() => [...(run.value?.steps || [])].reverse().find((item) => ['failed', 'interrupted'].includes(item.status) && item.attemptCount < 3) || null)
const isAnalyzing = computed(() => Boolean(currentSet.value && ['draft', 'analyzing'].includes(currentSet.value.status) && run.value && !['completed', 'cancelled', 'failed'].includes(run.value.status)))
const backendLabel = computed(() => ({ codex_acp: 'Codex ACP', codex_exec: 'Codex exec', qoder_acp: 'Qoder ACP' }[run.value?.actualBackend] || (run.value ? `等待 ${run.value.modelRoutes?.agentProvider === 'qoder' ? 'Qoder' : 'Codex'}` : '本地扫描')))
const runStatusLabel = computed(() => ({ pending: '准备项目镜像', waiting_approval: '等待批准模型调用', running: '正在分析整书影响', paused: '分析已暂停', failed: '分析失败' }[run.value?.status] || '正在整理候选'))
const groups = computed(() => [
  { level: 'required', eyebrow: 'REQUIRED', label: '必须同步', items: currentSet.value?.items?.filter((item) => item.impactLevel === 'required') || [] },
  { level: 'suggested', eyebrow: 'SUGGESTED', label: '建议同步', items: currentSet.value?.items?.filter((item) => item.impactLevel === 'suggested') || [] },
  { level: 'review', eyebrow: 'REVIEW', label: '人工复核', items: currentSet.value?.items?.filter((item) => item.impactLevel === 'review') || [] },
])
const visibleGroups = computed(() => groups.value.filter((group) => group.items.length))
const targetKey = computed(() => [props.target?.kind, props.target?.targetId, props.target?.fieldKey].join(':'))

watch(targetKey, () => {
  if (!props.target) {
    if (!props.resumeChangeSetId) {
      resetDraft()
      view.value = 'history'
    }
    return
  }
  resetDraft()
  view.value = 'change'
})
watch(() => props.visible, (visible) => {
  if (!visible) return
  void initialize()
})
watch(() => props.projectId, () => {
  history.value = []
  currentSet.value = null
  run.value = null
  if (props.visible) void initialize()
})

onMounted(() => {
  eventCleanup = appService.onAgentEvent((event) => {
    if (event?.runId === run.value?.id || event?.agentRunId === run.value?.id) scheduleRefresh(100)
  })
  if (props.visible) void initialize()
})
onBeforeUnmount(() => {
  eventCleanup?.()
  if (refreshTimer) clearTimeout(refreshTimer)
})

function resetDraft() {
  instruction.value = ''
  proposedValue.value = ''
  useExplicitValue.value = false
  includeManuscript.value = true
  currentSet.value = null
  run.value = null
  error.value = ''
}

async function initialize() {
  await loadHistory()
  if (props.resumeChangeSetId) {
    await loadChangeSet(props.resumeChangeSetId, props.resumeRunId)
  }
}

async function loadHistory() {
  if (!props.projectId) return
  try { history.value = await appService.listStoryChangeSets({ projectId: props.projectId, limit: 80 }) }
  catch (cause) { error.value = cause.message }
}

async function loadChangeSet(changeSetId, runId = '') {
  if (!changeSetId) return
  loading.value = true
  try {
    currentSet.value = await appService.getStoryChangeSet(changeSetId)
    const resolvedRunId = runId || currentSet.value?.agentRunId || ''
    run.value = resolvedRunId ? await appService.getAgentRun(resolvedRunId) : null
    view.value = 'change'
    scheduleRefresh()
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}

async function beginAnalysis() {
  if (!canStart.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const input = {
      projectId: props.projectId,
      target: {
        kind: props.target.kind,
        targetId: props.target.targetId,
        fieldKey: props.target.fieldKey,
        fieldLabel: props.target.fieldLabel,
      },
      instruction: instruction.value,
      scope: { includeManuscript: includeManuscript.value },
    }
    if (useExplicitValue.value) input.proposedValue = proposedValue.value
    currentSet.value = await appService.createStoryChangeSet(input)
    run.value = await appService.startInlineAgent({
      projectId: props.projectId,
      task: 'story_change',
      intent: 'analysis',
      target: {
        kind: 'story_change_set',
        targetId: currentSet.value.id,
        fieldKey: 'items',
        fieldLabel: `联动修改 · ${currentSet.value.rootLabel}`,
        promptProfile: 'story_change_propagation',
      },
      instruction: [instruction.value, includeManuscript.value ? '检查现有正文，但正文修改放入人工复核且默认不选。' : '本次不改动现有正文。'].join('\n'),
    })
    emit('run-updated', { run: run.value, changeSet: currentSet.value })
    scheduleRefresh(150)
  } catch (cause) {
    error.value = cause.message
    if (currentSet.value?.id && !run.value) await appService.cancelStoryChangeSet(currentSet.value.id).catch(() => {})
  } finally { busy.value = false }
}

function scheduleRefresh(delay = 700) {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (!props.visible || !currentSet.value) return
  refreshTimer = setTimeout(() => void refresh(), delay)
}

async function refresh() {
  if (!currentSet.value?.id) return
  try {
    const [nextSet, nextRun] = await Promise.all([
      appService.getStoryChangeSet(currentSet.value.id),
      run.value?.id ? appService.getAgentRun(run.value.id) : Promise.resolve(null),
    ])
    if (nextSet) currentSet.value = nextSet
    if (nextRun) run.value = nextRun
    emit('run-updated', { run: run.value, changeSet: currentSet.value })
    if (isAnalyzing.value || ['waiting_approval', 'running', 'pending'].includes(run.value?.status)) scheduleRefresh()
    await loadHistory()
  } catch (cause) { error.value = cause.message }
}

async function resolveApproval(approved) {
  if (!pendingApproval.value || busy.value) return
  busy.value = true
  try {
    await appService.resolveApproval({ id: pendingApproval.value.id, approved, note: approved ? '作者批准本次设定联动分析' : '作者拒绝本次设定联动分析' })
    await refresh()
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function setSelection(item, selected) {
  selectionBusyId.value = item.id
  try {
    currentSet.value = await appService.updateStoryChangeSelection({ changeSetId: currentSet.value.id, itemIds: [item.id], selected })
  } catch (cause) { error.value = cause.message }
  finally { selectionBusyId.value = '' }
}

async function toggleGroup(group) {
  const selected = !group.items.every((item) => item.selected)
  busy.value = true
  try {
    currentSet.value = await appService.updateStoryChangeSelection({ changeSetId: currentSet.value.id, itemIds: group.items.map((item) => item.id), selected })
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function applySelected() {
  if (!pendingCandidate.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await appService.confirmAgentCandidate({ runId: run.value.id, candidateId: pendingCandidate.value.id, reason: `作者确认联动写入 ${currentSet.value.counts.selected} 项` })
    await appService.finishInlineAgent(run.value.id).catch(() => {})
    currentSet.value = await appService.getStoryChangeSet(currentSet.value.id)
    run.value = await appService.getAgentRun(run.value.id)
    await loadHistory()
    emit('workspace-change', currentSet.value)
    emit('toast', `已一次写入 ${currentSet.value.counts.selected} 项联动修改`)
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function discard() {
  if (busy.value) return
  busy.value = true
  try {
    if (pendingCandidate.value) {
      await appService.rejectAgentCandidate({ runId: run.value.id, candidateId: pendingCandidate.value.id, reason: '作者放弃整组联动修改' })
    } else if (run.value?.id && !['completed', 'cancelled'].includes(run.value.status)) {
      await appService.cancelAgentRun(run.value.id)
    }
    currentSet.value = await appService.cancelStoryChangeSet(currentSet.value.id)
    await loadHistory()
    emit('toast', '已放弃整组联动修改，项目内容保持不变')
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function cancelAnalysis() {
  if (busy.value) return
  busy.value = true
  try {
    if (run.value?.id) await appService.cancelAgentRun(run.value.id)
    currentSet.value = await appService.cancelStoryChangeSet(currentSet.value.id)
    await loadHistory()
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function retryAnalysis() {
  if (!retryableStep.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    run.value = await appService.retryAgentStep({ runId: run.value.id, stepId: retryableStep.value.id })
    scheduleRefresh(150)
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

async function revert() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    currentSet.value = await appService.revertStoryChangeSet(currentSet.value.id)
    await loadHistory()
    emit('workspace-change', currentSet.value)
    emit('toast', '这一组设定修改已全部撤销')
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}

function openHistory() {
  view.value = 'history'
  void loadHistory()
}
function inspectHistory(item) {
  void loadChangeSet(item.id, item.agentRunId)
}
function formatValue(value) {
  if (typeof value === 'string') return value || '（空）'
  return JSON.stringify(value, null, 2)
}
function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
function setStatusLabel(status) {
  return ({ draft: '本地扫描完成', analyzing: '分析中', waiting_confirmation: '等待确认', applied: '已应用', reverted: '已撤销', cancelled: '已放弃', failed: '失败', stale: '已过期' }[status] || status)
}
function evidenceLabel(value) {
  const text = String(value || '')
  if (text === 'root_target') return '根设定'
  if (text.startsWith('text:')) return `文本引用 · ${text.slice(5, 45)}`
  if (text.startsWith('link:')) return '结构化引用'
  if (text.startsWith('chapter:')) return '同章状态链'
  return text
}
</script>

<style scoped>
.story-change-panel { position: fixed; z-index: 116; top: 40px; right: 20px; bottom: 20px; width: min(760px, calc(100vw - 40px)); display: flex; flex-direction: column; overflow: hidden; color: #e8dfd2; border: 1px solid #4c5357; background: #20262a; box-shadow: 0 30px 90px rgba(5,8,10,.58); }
.change-panel-head { display: flex; justify-content: space-between; gap: 24px; padding: 25px 30px 20px; border-bottom: 1px solid #3a4247; background: #222a2e; }.change-panel-head > div > span { color: #d16b4d; font: 700 8px var(--font-ui); letter-spacing: .2em; }.change-panel-head h2 { margin: 8px 0 3px; color: #eee5d8; font: 29px var(--font-display); }.change-panel-head p { margin: 0; color: #9aa2a4; font: 10px/1.5 var(--font-body); }.change-panel-head > button { align-self: flex-start; padding: 0; color: #bfc5c4; border: 0; background: transparent; font: 27px/1 var(--font-ui); }
.change-tabs { display: flex; border-bottom: 1px solid #3a4247; background: #242c30; }.change-tabs button { flex: 1; padding: 13px; color: #9ca4a6; border: 0; border-bottom: 2px solid transparent; background: transparent; font: 10px var(--font-ui); }.change-tabs button.active { color: #eddfd0; border-bottom-color: #c75b41; }.change-tabs span { display: inline-grid; place-items: center; min-width: 17px; height: 17px; margin-left: 5px; color: #d3bbb0; border-radius: 50%; background: #3b4448; font-size: 8px; }
.change-error { margin: 12px 24px 0; padding: 11px 13px; color: #ffc0ae; border-left: 3px solid #d05e44; background: rgba(132,48,34,.22); font: 10px/1.55 var(--font-body); }
.change-panel-body { flex: 1; min-height: 0; padding: 22px 24px 110px; overflow-y: auto; }.change-brief { display: grid; gap: 20px; }.root-card { padding: 16px 18px; border: 1px solid #465055; background: #252d31; }.root-card > span, .change-brief label > span { display: block; color: #aab1b2; font: 8px var(--font-ui); letter-spacing: .08em; }.root-card strong { display: block; margin: 7px 0; color: #eee4d8; font: 18px var(--font-display); }.root-card p { max-height: 140px; margin: 0; overflow-y: auto; color: #c6bdb3; white-space: pre-wrap; font: 11px/1.75 var(--font-body); }.change-brief textarea { box-sizing: border-box; width: 100%; margin-top: 7px; padding: 12px; color: #eee5d8; border: 1px solid #4c565a; outline: 0; resize: vertical; background: #1d2428; font: 11px/1.7 var(--font-body); }.change-brief textarea:focus { border-color: #a65c47; }.change-brief b { color: #dc7456; }
.explicit-toggle, .manuscript-toggle { display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; border: 1px solid #3e484d; background: #252d31; }.explicit-toggle > span, .manuscript-toggle > span { display: grid !important; gap: 3px; color: #d5ccc1 !important; font: 10px var(--font-body) !important; letter-spacing: 0 !important; }.manuscript-toggle small { color: #8f999b; }.change-primary-actions { display: flex; justify-content: flex-end; }.change-primary-actions button, .change-panel-footer button.accent { padding: 12px 18px; color: #fff4ec; border: 1px solid #c45d43; background: #bc563e; font: 11px var(--font-ui); }.change-primary-actions button:disabled { opacity: .45; }
.change-run-summary { display: grid; grid-template-columns: repeat(4,1fr); margin-bottom: 16px; border: 1px solid #424b50; }.change-run-summary > div { display: grid; gap: 4px; padding: 10px 12px; border-right: 1px solid #424b50; }.change-run-summary > div:last-child { border-right: 0; }.change-run-summary span { color: #879194; font: 8px var(--font-ui); }.change-run-summary strong { color: #ded5ca; font: 11px var(--font-ui); }
.change-approval { margin-bottom: 16px; padding: 17px; border: 1px solid #805642; background: #2c2b27; }.change-approval > span { color: #d56b4e; font: 700 8px var(--font-ui); letter-spacing: .16em; }.change-approval h3 { margin: 7px 0 3px; color: #eee2d3; font: 16px var(--font-display); }.change-approval p { margin: 0 0 12px; color: #aaa29a; font: 9px var(--font-body); }.change-approval div { display: flex; justify-content: flex-end; gap: 8px; }.change-approval button { padding: 8px 11px; color: #d5ccc3; border: 1px solid #566064; background: transparent; }.change-approval button.accent { color: #fff; border-color: #b75a43; background: #a9513d; }
.change-analyzing { display: flex; align-items: center; gap: 13px; margin-bottom: 16px; padding: 16px; border: 1px solid #3e4b4e; background: #252f32; }.change-analyzing i { width: 18px; height: 18px; border: 2px solid #4c595b; border-top-color: #d06449; border-radius: 50%; animation: spin .8s linear infinite; }.change-analyzing strong { color: #e6ddd2; font: 12px var(--font-ui); }.change-analyzing p { margin: 4px 0 0; color: #959fa1; font: 9px/1.5 var(--font-body); }
.change-summary-copy { margin-bottom: 18px; padding: 13px 15px; border-left: 3px solid #b65b44; background: #262e32; }.change-summary-copy span { color: #d16a4d; font: 8px var(--font-ui); letter-spacing: .1em; }.change-summary-copy p { margin: 5px 0 0; color: #d2c8bd; font: 10px/1.65 var(--font-body); }
.change-group { margin-bottom: 22px; }.change-group > header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px solid #414a4f; }.change-group > header span { color: #9ba4a6; font: 7px var(--font-ui); letter-spacing: .16em; }.change-group > header h3 { margin: 3px 0 0; color: #e5dcd1; font: 17px var(--font-display); }.change-group > header h3 b { color: #b0b7b7; font: 9px var(--font-ui); }.change-group > header button { padding: 4px 0; color: #c77b66; border: 0; background: transparent; font: 8px var(--font-ui); }
.change-item { margin-bottom: 8px; padding: 13px; border: 1px solid #3d474b; background: #242c30; opacity: .72; }.change-item.selected { border-color: #65564f; opacity: 1; }.change-item.manuscript { border-left: 3px solid #b77b48; }.change-item-select { display: flex; align-items: flex-start; gap: 10px; }.change-item-select input { margin-top: 3px; accent-color: #bd593f; }.change-item-select > span { display: grid; gap: 3px; }.change-item-select strong { color: #e4dbd0; font: 11px var(--font-ui); }.change-item-select small { color: #9ba3a3; font: 9px/1.5 var(--font-body); }.manuscript-warning { margin: 9px 0 0 24px; color: #d3a47b; font: 8px/1.45 var(--font-body); }
.change-diff { margin: 10px 0 0 24px; }.change-diff summary { cursor: pointer; color: #c77962; font: 8px var(--font-ui); }.change-diff > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }.change-diff section { min-width: 0; border: 1px solid #3f494d; background: #1d2428; }.change-diff section > span { display: block; padding: 6px 8px; color: #899396; border-bottom: 1px solid #394247; font: 7px var(--font-ui); }.change-diff pre { max-height: 240px; margin: 0; padding: 9px; overflow: auto; color: #c9c0b7; white-space: pre-wrap; overflow-wrap: anywhere; font: 9px/1.55 var(--font-body); }.change-evidence { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 0 24px; }.change-evidence span { padding: 3px 6px; color: #8f9c9e; border: 1px solid #3c494c; font: 7px var(--font-ui); }
.change-stale { padding: 13px; color: #e7a78f; border: 1px solid #744c40; background: rgba(107,54,42,.2); font: 9px/1.6 var(--font-body); }
.change-panel-footer { position: absolute; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: flex-end; gap: 9px; padding: 15px 24px; border-top: 1px solid #434c51; background: rgba(31,38,42,.98); }.change-panel-footer > span { margin-right: auto; color: #9ea6a6; font: 9px var(--font-body); }.change-panel-footer button { padding: 10px 14px; color: #cbc2b9; border: 1px solid #535e62; background: transparent; font: 9px var(--font-ui); }.change-panel-footer button.danger { color: #e0a08c; border-color: #745044; }.change-panel-footer button:disabled { opacity: .42; }
.history-body { display: grid; align-content: start; gap: 9px; padding-bottom: 24px; }.history-card { position: relative; display: grid; gap: 5px; padding: 14px 16px; text-align: left; color: #d9d0c6; border: 1px solid #3f494d; background: #242c30; }.history-card:hover { border-color: #6a5b54; }.history-card > span { position: absolute; top: 13px; right: 14px; color: #9ea6a6; font: 8px var(--font-ui); }.history-card strong { padding-right: 80px; font: 14px var(--font-display); }.history-card p { margin: 0; color: #9ea5a5; font: 9px/1.5 var(--font-body); }.history-card small { color: #717c7f; font: 8px var(--font-ui); }.change-empty { padding: 60px 20px; text-align: center; color: #929c9e; }.change-empty strong { display: block; color: #dcd3c8; font: 20px var(--font-display); }.change-empty p { margin: 8px 0; font: 10px/1.7 var(--font-body); }
.status-waiting_confirmation { color: #e2a47f !important; }.status-applied { color: #8fc2aa !important; }.status-reverted, .status-cancelled { color: #90999b !important; }.status-failed, .status-stale { color: #e0836b !important; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 820px) { .story-change-panel { top: 58px; right: 12px; bottom: 12px; width: calc(100vw - 24px); }.change-run-summary { grid-template-columns: 1fr 1fr; }.change-diff > div { grid-template-columns: 1fr; } }
</style>
