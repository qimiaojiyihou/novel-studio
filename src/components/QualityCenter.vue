<template>
  <div v-if="visible" class="quality-backdrop" @mousedown.self="$emit('close')">
    <section class="quality-shell" aria-label="创作质量中心">
      <aside class="quality-rail">
        <div class="quality-mark">QC</div>
        <div>
          <span class="eyebrow">EDITORIAL PROOF</span>
          <h2>质量中心</h2>
          <p>把“感觉不错”变成可以复跑和比较的证据。</p>
        </div>
        <nav>
          <button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id">
            <span>{{ item.mark }}</span><div><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></div>
          </button>
        </nav>
        <div class="gate-note">
          <span>平衡合格线</span>
          <strong>3.8 / 5</strong>
          <small>关键规则全通过 · 核心维度不低于 3.0</small>
        </div>
      </aside>

      <main class="quality-main">
        <header class="quality-head">
          <div><span class="eyebrow copper">{{ activeTab.eyebrow }}</span><h1>{{ activeTab.title }}</h1><p>{{ activeTab.description }}</p></div>
          <button class="close-button" @click="$emit('close')">关闭</button>
        </header>

        <section v-if="tab === 'chapter'" class="quality-content chapter-quality">
          <div class="readiness-panel">
            <div class="panel-title"><div><span>生成前准备度</span><strong>{{ chapter?.title }}</strong></div><button :disabled="busy" @click="refreshPreflight">重新检查</button></div>
            <p>{{ preflight?.summary || '正在读取章节合同与场景计划…' }}</p>
            <div class="check-grid">
              <article v-for="item in preflight?.checks || []" :key="item.id" :class="{ passed: item.passed, critical: item.critical && !item.passed }">
                <span>{{ item.passed ? '✓' : item.critical ? '!' : '·' }}</span><div><strong>{{ item.label }}</strong><small v-if="!item.passed">{{ item.detail || '需要补充' }}</small></div>
              </article>
            </div>
          </div>

          <div class="review-launch">
            <label><span>待评审生成记录</span><select v-model="selectedGenerationId"><option value="">请选择</option><option v-for="record in reviewableRecords" :key="record.id" :value="record.id">{{ taskLabel(record.task) }} · {{ formatTime(record.createdAt) }} · {{ record.model?.name || 'Mock' }}</option></select></label>
            <label><span>独立评审模型</span><select v-model="reviewerProfileId"><option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model || profile.provider }}</option></select></label>
            <CreativeExecutionControl
              :default-mode="defaultExecutionMode"
              :app-model-label="selectedReviewerLabel"
              action-label="运行七维评审"
              busy-label="评审中"
              :busy="busy === 'review'"
              :disabled="Boolean(busy) || !selectedGenerationId"
              @execute="runReview"
              @edit-default="emit('edit-project')"
            />
          </div>

          <QualityReportView v-if="selectedReport" :report="selectedReport" :selected-issues="selectedIssues" @toggle-issue="toggleIssue" />
          <div v-if="selectedReport" class="report-actions">
            <CreativeExecutionControl
              :default-mode="defaultExecutionMode"
              :app-model-label="sourceModelLabel"
              :action-label="`生成定向修复候选 · ${selectedIssues.length} 项`"
              busy-label="修复候选生成中"
              :busy="busy === 'repair'"
              :disabled="Boolean(busy) || !selectedIssues.length"
              @execute="repairSelected"
              @edit-default="emit('edit-project')"
            />
          </div>
        </section>

        <section v-else-if="tab === 'benchmark'" class="quality-content benchmark-content">
          <div class="benchmark-thesis">
            <div><span class="eyebrow copper">URBAN SUSPENSE · 3 CHAPTERS</span><h2>《午夜病历》三章闭环</h2><p>从故事前提到三章正文，连续检验身份暴露、伤情持续、人物知情边界、钥匙硬规则和章尾不越界。</p></div>
            <div class="benchmark-seal"><strong>03</strong><span>章节</span></div>
          </div>
          <div class="benchmark-config">
            <label><span>生成模型</span><select v-model="benchmarkGenerator"><option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model || profile.provider }}</option></select></label>
            <label><span>评审模型</span><select v-model="benchmarkReviewer"><option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model || profile.provider }}</option></select></label>
            <button class="primary-action" :disabled="busy || !benchmarkGenerator" @click="startBenchmark('urban-suspense-three-chapter-v1')">{{ busy === 'benchmark' ? '基准运行中…' : '开始三章基准' }}</button>
            <button class="secondary-action" :disabled="busy || !benchmarkGenerator" @click="startBenchmark('prompt-eval-cases-v1')">运行 10 项提示词基线</button>
            <button v-if="activeBenchmark?.status === 'running' && !activeBenchmark.summary?.paused" class="secondary-action" @click="pauseBenchmark">暂停</button>
            <button v-if="activeBenchmark?.status === 'running' && activeBenchmark.summary?.paused" class="secondary-action" @click="resumeBenchmark">继续</button>
            <button v-if="activeBenchmark?.status === 'running'" class="cancel-action" @click="cancelBenchmark">取消</button>
          </div>
          <div v-if="activeBenchmark" class="benchmark-progress">
            <div class="progress-copy"><strong>{{ runStatus(activeBenchmark.status) }}</strong><span>{{ activeBenchmark.steps?.filter((step) => step.status === 'completed').length || 0 }} 个步骤完成</span></div>
            <div class="benchmark-line"><i :style="{ width: benchmarkProgress + '%' }"></i></div>
            <div class="step-list"><article v-for="step in activeBenchmark.steps || []" :key="step.id" :class="[step.status, { active: step.id === activeBenchmarkStepId }]" @click="activeBenchmarkStepId = step.id"><span>{{ step.position }}</span><strong>{{ step.stepKey }}</strong><small>{{ step.status }}</small></article></div>
            <div v-if="activeBenchmarkStep" class="step-evidence">
              <header><div><span>STEP EVIDENCE</span><strong>{{ activeBenchmarkStep.stepKey }}</strong></div><small>{{ activeBenchmarkStep.durationMs || 0 }} ms · {{ activeBenchmarkStep.generation?.attemptCount || 1 }} 次尝试</small></header>
              <details><summary>输入快照</summary><pre>{{ JSON.stringify(activeBenchmarkStep.input, null, 2) }}</pre></details>
              <details><summary>输出与评分</summary><pre>{{ JSON.stringify(activeBenchmarkStep.output, null, 2) }}</pre></details>
              <details v-if="activeBenchmarkStep.generation"><summary>完整提示词快照与参数</summary><pre>{{ JSON.stringify({ promptSnapshot: activeBenchmarkStep.generation.promptSnapshot, parameters: activeBenchmarkStep.generation.parameters, events: activeBenchmarkStep.generation.events }, null, 2) }}</pre></details>
            </div>
          </div>
          <div class="run-history">
            <h3>基准历史</h3>
            <article v-for="run in benchmarkRuns" :key="run.id" @click="selectBenchmark(run)">
              <div><strong>{{ runStatus(run.status, run.summary) }}</strong><small>{{ formatTime(run.createdAt) }} · {{ fixtureLabel(run.fixtureId) }}</small></div>
              <div class="run-score"><b>{{ run.summary?.modelAverage || '—' }}</b><span>{{ benchmarkVerdict(run) }}</span></div>
            </article>
          </div>
        </section>

        <section v-else-if="tab === 'human'" class="quality-content human-content">
          <div class="blind-note"><span>BLIND REVIEW</span><p>人工评分时隐藏模型名称和自动分数，只阅读候选、规划合同与问题证据。</p></div>
          <label class="report-select"><span>选择质量报告</span><select v-model="selectedReportId"><option value="">请选择</option><option v-for="report in reports" :key="report.id" :value="report.id">{{ formatTime(report.createdAt) }} · {{ report.repaired ? '修复稿' : '首稿' }}</option></select></label>
          <div v-if="blindPacket" class="blind-manuscript">
            <details><summary>章节合同与场景规划</summary><pre>{{ JSON.stringify({ card: blindPacket.chapter?.card, scenePlan: blindPacket.chapter?.scenePlan }, null, 2) }}</pre></details>
            <div><span>CANDIDATE · {{ blindPacket.repaired ? '修复稿' : '首次生成' }}</span><pre>{{ blindPacket.candidate }}</pre></div>
          </div>
          <div v-if="selectedReport" class="human-rubric">
            <label v-for="dimension in dimensions" :key="dimension.id"><span>{{ dimension.label }}</span><input v-model.number="humanScores[dimension.id]" type="range" min="1" max="5" step="0.5" /><b>{{ humanScores[dimension.id] }}</b></label>
            <label class="human-notes"><span>评审备注</span><textarea v-model="humanNotes" placeholder="记录最影响阅读体验的问题和证据"></textarea></label>
            <button class="primary-action" :disabled="busy" @click="saveHumanReview">保存人工评分</button>
          </div>
        </section>

        <section v-else class="quality-content history-content">
          <article v-for="report in reports" :key="report.id" :class="report.aggregate?.verdict" @click="selectReport(report)">
            <div class="history-verdict"><span>{{ verdictLabel(report.aggregate?.verdict) }}</span><strong>{{ report.aggregate?.modelAverage || '—' }}</strong><small>模型平均分</small></div>
            <div><h3>{{ report.repaired ? '定向修复稿' : '首次生成稿' }}</h3><p>{{ report.modelReview?.summary || '暂无评审摘要' }}</p><small>{{ formatTime(report.createdAt) }} · {{ report.execution === 'remote' ? '真实模型' : '模拟运行' }} · {{ report.source?.model?.name || report.source?.model?.model || '未知模型' }} · 模板 v{{ report.source?.templateVersion || 1 }}</small></div>
          </article>
          <div v-if="!reports.length" class="empty-history">当前项目还没有质量报告。先在“当前章节”运行一次评审。</div>
        </section>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { QUALITY_DIMENSIONS } from '../../electron/creative-quality.js'
import { appService } from '../services/app-service.js'
import { projectExecutionMode } from '../utils/inline-creative.js'
import CreativeExecutionControl from './CreativeExecutionControl.vue'
import QualityReportView from './QualityReportView.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  project: { type: Object, required: true },
  chapter: { type: Object, default: null },
  modelSettings: { type: Object, required: true },
})
const emit = defineEmits(['close', 'toast', 'repair-candidate', 'codex-action', 'edit-project'])
const tabs = [
  { id: 'chapter', mark: 'C', label: '当前章节', hint: '准备度与七维评审' },
  { id: 'benchmark', mark: '3', label: '三章基准', hint: '真实模型闭环验证' },
  { id: 'human', mark: 'H', label: '人工评审', hint: '隐藏模型后的读稿评分' },
  { id: 'history', mark: '↺', label: '历史报告', hint: '首稿与修复稿对比' },
]
const tab = ref('chapter')
const busy = ref('')
const preflight = ref(null)
const reports = ref([])
const generationRecords = ref([])
const benchmarkRuns = ref([])
const activeBenchmark = ref(null)
const activeBenchmarkStepId = ref('')
const selectedGenerationId = ref('')
const selectedReportId = ref('')
const selectedIssues = ref([])
const reviewerProfileId = ref('')
const benchmarkGenerator = ref('')
const benchmarkReviewer = ref('')
const humanScores = reactive(Object.fromEntries(QUALITY_DIMENSIONS.map((item) => [item.id, 3.5])))
const humanNotes = ref('')
const blindPacket = ref(null)
let benchmarkCleanup = null

const dimensions = QUALITY_DIMENSIONS
const enabledProfiles = computed(() => props.modelSettings.profiles.filter((profile) => profile.enabled))
const defaultExecutionMode = computed(() => projectExecutionMode(props.project))
const selectedReviewerLabel = computed(() => enabledProfiles.value.find((profile) => profile.id === reviewerProfileId.value)?.name || '评审模型')
const selectedReport = computed(() => reports.value.find((report) => report.id === selectedReportId.value) || null)
const selectedSourceRecord = computed(() => generationRecords.value.find((record) => record.id === selectedReport.value?.generationRecordId) || null)
const sourceModelLabel = computed(() => selectedSourceRecord.value?.model?.name || selectedSourceRecord.value?.model?.model || '原任务模型')
const activeBenchmarkStep = computed(() => activeBenchmark.value?.steps?.find((step) => step.id === activeBenchmarkStepId.value) || null)
const reviewableRecords = computed(() => generationRecords.value.filter((record) => record.chapterId === props.chapter?.id && record.status === 'completed' && ['chapter', 'chapter_card', 'scene_plan'].includes(record.task)))
const activeTab = computed(() => ({
  chapter: { eyebrow: 'CHAPTER PROOF', title: '当前章节检查', description: '先看输入是否足够，再检查候选到底哪里成立、哪里需要修。' },
  benchmark: { eyebrow: 'MODEL BENCHMARK', title: '三章闭环基准', description: '真实模型输出才进入能力结论；Mock 只验证软件链路。' },
  human: { eyebrow: 'HUMAN VERDICT', title: '人工盲评', description: '在不知道模型与自动分数的情况下判断实际阅读质量。' },
  history: { eyebrow: 'EVIDENCE LEDGER', title: '质量证据账本', description: '保留首次生成与修复后结果，避免用后一次成绩覆盖前一次。' },
}[tab.value]))
const benchmarkProgress = computed(() => {
  const steps = activeBenchmark.value?.steps || []
  if (!steps.length) return activeBenchmark.value?.status === 'completed' ? 100 : 4
  return Math.round((steps.filter((step) => step.status === 'completed').length / Math.max(1, steps.length)) * 100)
})

watch(() => props.visible, async (visible) => {
  if (!visible) { benchmarkCleanup?.(); benchmarkCleanup = null; return }
  reviewerProfileId.value = props.modelSettings.routes.quality_review || props.modelSettings.routes.chapter || enabledProfiles.value[0]?.id || ''
  benchmarkGenerator.value = props.modelSettings.routes.planning_field || enabledProfiles.value[0]?.id || ''
  benchmarkReviewer.value = reviewerProfileId.value
  benchmarkCleanup = appService.onBenchmarkEvent(async (event) => {
    if (event.type === 'started' && event.run) activeBenchmark.value = event.run
    if (event.runId && (!activeBenchmark.value || activeBenchmark.value.id === event.runId)) {
      activeBenchmark.value = await appService.getBenchmarkRun(event.runId)
      if (!activeBenchmarkStepId.value) activeBenchmarkStepId.value = activeBenchmark.value?.steps?.at(-1)?.id || ''
      if (['completed', 'failed', 'cancelled'].includes(activeBenchmark.value?.status)) await loadBenchmarkReports(activeBenchmark.value)
    }
  })
  await loadAll()
})
watch(() => props.chapter?.id, () => { if (props.visible) void refreshPreflight() })
watch(selectedReportId, async (reportId) => {
  blindPacket.value = reportId ? await appService.getBlindQualityReviewPacket(reportId) : null
})

async function loadAll() {
  if (!props.project.id) return
  try {
    const [nextReports, nextRecords, nextRuns] = await Promise.all([
      appService.listQualityReports({ projectId: props.project.id }),
      appService.listGenerationRecords({ projectId: props.project.id, limit: 200 }),
      appService.listBenchmarkRuns({ limit: 40 }),
    ])
    reports.value = nextReports
    generationRecords.value = nextRecords
    benchmarkRuns.value = nextRuns
    if (!selectedGenerationId.value) selectedGenerationId.value = reviewableRecords.value[0]?.id || ''
    if (!selectedReportId.value) selectedReportId.value = nextReports[0]?.id || ''
    activeBenchmark.value = nextRuns[0] || null
    activeBenchmarkStepId.value = activeBenchmark.value?.steps?.at(-1)?.id || ''
    if (activeBenchmark.value) await loadBenchmarkReports(activeBenchmark.value)
    await refreshPreflight()
  } catch (error) { emit('toast', `质量中心加载失败：${error.message}`) }
}
async function refreshPreflight() {
  if (!props.chapter?.id) return
  try { preflight.value = await appService.qualityPreflight({ projectId: props.project.id, chapterId: props.chapter.id, intent: props.chapter.manuscript?.trim() ? 'rewrite' : 'draft' }) }
  catch (error) { emit('toast', `准备度检查失败：${error.message}`) }
}
async function runReview(executionMode = 'app_model') {
  if (executionMode === 'codex') {
    const source = reviewableRecords.value.find((record) => record.id === selectedGenerationId.value)
    if (!source || !props.chapter?.id) return
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        chapterId: props.chapter.id,
        task: 'quality_review',
        intent: 'analysis',
        target: {
          kind: 'quality_review',
          targetId: props.chapter.id,
          fieldLabel: `${taskLabel(source.task)}七维质量评审`,
          sourceGenerationId: source.id,
        },
        instruction: '以独立编辑评审者身份完成七维评分，逐项给出可定位证据、严重度和最小修复指令。不要改写原稿。',
      },
      onAccepted: async () => {
        await loadAll()
        const report = reports.value.find((item) => item.generationRecordId === source.id)
        if (report) {
          selectedReportId.value = report.id
          selectedIssues.value = report.modelReview.issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.id)
        }
      },
    })
    return
  }
  busy.value = 'review'
  try {
    const report = await appService.reviewQuality({ generationRecordId: selectedGenerationId.value, reviewerProfileId: reviewerProfileId.value })
    reports.value = [report, ...reports.value.filter((item) => item.id !== report.id)]
    selectedReportId.value = report.id
    selectedIssues.value = report.modelReview.issues.filter((issue) => issue.severity !== 'info').map((issue) => issue.id)
    emit('toast', report.execution === 'remote' ? '质量评审完成' : 'Mock 质量流程完成，不计入能力结论')
  } catch (error) { emit('toast', `质量评审失败：${error.message}`) }
  finally { busy.value = '' }
}
function toggleIssue(id) { selectedIssues.value = selectedIssues.value.includes(id) ? selectedIssues.value.filter((item) => item !== id) : [...selectedIssues.value, id] }
async function repairSelected(executionMode = 'app_model') {
  if (executionMode === 'codex') {
    const report = selectedReport.value
    const source = selectedSourceRecord.value
    if (!report || !source || !props.chapter?.id) return
    const kind = source.task === 'chapter_card' ? 'chapter_card' : source.task === 'scene_plan' ? 'scene_plan' : 'manuscript'
    emit('codex-action', {
      request: {
        projectId: props.project.id,
        chapterId: props.chapter.id,
        task: source.task,
        intent: 'repair',
        target: {
          kind,
          targetId: props.chapter.id,
          fieldLabel: `${taskLabel(source.task)}定向质量修复`,
          sourceGenerationId: source.id,
          reportId: report.id,
          issueIds: [...selectedIssues.value],
        },
        instruction: '仅处理选中的质量问题；保留未涉及的事实、事件顺序、人物状态和章节结尾合同。返回完整候选。',
      },
      onAccepted: loadAll,
    })
    return
  }
  busy.value = 'repair'
  try {
    const result = await appService.repairQuality({ reportId: selectedReport.value.id, issueIds: selectedIssues.value })
    const source = generationRecords.value.find((record) => record.id === selectedReport.value.generationRecordId)
    emit('repair-candidate', { result, source, report: selectedReport.value })
    emit('toast', '定向修复候选已生成，请在差异视图中确认')
  } catch (error) { emit('toast', `生成修复候选失败：${error.message}`) }
  finally { busy.value = '' }
}
async function loadBenchmarkReports(run) {
  const ids = run?.summary?.reportIds || []
  if (!ids.length) return
  const loaded = (await Promise.all(ids.map((id) => appService.getQualityReport(id)))).filter(Boolean)
  reports.value = [...loaded, ...reports.value.filter((report) => !ids.includes(report.id))]
  if (!selectedReportId.value && loaded.length) selectedReportId.value = loaded[0].id
}
async function selectBenchmark(run) {
  activeBenchmark.value = await appService.getBenchmarkRun(run.id)
  activeBenchmarkStepId.value = activeBenchmark.value?.steps?.at(-1)?.id || ''
  await loadBenchmarkReports(activeBenchmark.value)
}
async function startBenchmark(fixtureId) {
  busy.value = 'benchmark'
  try {
    activeBenchmark.value = await appService.startBenchmark({ fixtureId, generatorProfileId: benchmarkGenerator.value, reviewerProfileId: benchmarkReviewer.value })
    await loadBenchmarkReports(activeBenchmark.value)
    benchmarkRuns.value = await appService.listBenchmarkRuns({ limit: 40 })
    emit('toast', activeBenchmark.value.summary?.execution === 'remote' ? '模型基准运行完成' : 'Mock 基准流程完成，不计入能力结论')
  } catch (error) { emit('toast', `基准运行失败：${error.message}`) }
  finally { busy.value = '' }
}
async function pauseBenchmark() { if (activeBenchmark.value) activeBenchmark.value = await appService.pauseBenchmark(activeBenchmark.value.id) }
async function resumeBenchmark() { if (activeBenchmark.value) activeBenchmark.value = await appService.resumeBenchmark(activeBenchmark.value.id) }
async function cancelBenchmark() { if (activeBenchmark.value) await appService.cancelBenchmark(activeBenchmark.value.id) }
async function saveHumanReview() {
  busy.value = 'human'
  try {
    const report = await appService.saveHumanReview({ reportId: selectedReport.value.id, scores: { ...humanScores }, notes: humanNotes.value })
    reports.value = reports.value.map((item) => item.id === report.id ? report : item)
    benchmarkRuns.value = await appService.listBenchmarkRuns({ limit: 40 })
    if (activeBenchmark.value) activeBenchmark.value = await appService.getBenchmarkRun(activeBenchmark.value.id)
    emit('toast', '人工评分已保存并重新计算结论')
  } catch (error) { emit('toast', `人工评分保存失败：${error.message}`) }
  finally { busy.value = '' }
}
function selectReport(report) { selectedReportId.value = report.id; tab.value = 'chapter' }
function taskLabel(task) { return { chapter: '正文', chapter_card: '章节卡', scene_plan: '场景计划' }[task] || task }
function verdictLabel(value) { return { pass_first_try: '首次达标', pass_after_repair: '修复后达标', automatic_complete: '等待人工评分', fail: '未达标' }[value] || '待评审' }
function runStatus(value, summary = activeBenchmark.value?.summary) { return summary?.paused ? '已暂停（当前步骤完成后生效）' : ({ pending: '等待开始', running: '运行中', completed: '运行完成', cancelled: '已取消', failed: '运行失败' }[value] || value) }
function fixtureLabel(value) { return value === 'prompt-eval-cases-v1' ? '10 项提示词基线' : '都市悬疑三章闭环' }
function benchmarkVerdict(run) { return run.summary?.execution === 'mock' ? '模拟运行' : run.summary?.verdict === 'pass' ? '基准通过' : run.summary?.verdict === 'awaiting_human_review' ? '等待人工评分' : '未达标' }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' }
</script>

<style scoped>
.quality-backdrop { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; padding: 30px; background: rgba(14,17,20,.78); backdrop-filter: blur(5px); }
.quality-shell { width: min(1340px, 96vw); height: min(860px, 92vh); display: grid; grid-template-columns: 238px 1fr; overflow: hidden; border: 1px solid #4c555a; background: #f2ede3; box-shadow: 0 28px 80px rgba(0,0,0,.42); }
.quality-rail { display: flex; flex-direction: column; padding: 24px 17px 18px; color: #d8dad9; background: #252c31; border-right: 1px solid #485158; }
.quality-mark { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 21px; color: #242b30; background: #d8cab7; font: 700 10px var(--font-ui); letter-spacing: .1em; }
.quality-rail h2 { margin: 7px 0 6px; color: #f4efe6; font: 24px var(--font-display); }
.quality-rail p { margin: 0; color: #89939a; font-size: 9px; line-height: 1.6; }
.quality-rail nav { display: grid; gap: 3px; margin-top: 25px; }
.quality-rail nav button { display: grid; grid-template-columns: 28px 1fr; gap: 9px; align-items: center; padding: 10px 9px; color: #9da5aa; border: 0; border-left: 2px solid transparent; background: transparent; text-align: left; }
.quality-rail nav button:hover, .quality-rail nav button.active { color: #fff7ed; background: #323a40; border-left-color: var(--copper-light); }
.quality-rail nav button > span { color: var(--copper-light); font: 12px var(--font-display); text-align: center; }
.quality-rail nav div { display: grid; gap: 3px; }
.quality-rail nav strong { font-size: 11px; }
.quality-rail nav small { color: #768087; font-size: 8px; }
.gate-note { margin-top: auto; display: grid; gap: 5px; padding: 13px; border: 1px solid #465158; background: #20262a; }
.gate-note span, .gate-note small { color: #7f8b91; font-size: 8px; }
.gate-note strong { color: #d7b194; font: 23px var(--font-display); }
.quality-main { min-width: 0; overflow: auto; }
.quality-head { position: sticky; top: 0; z-index: 4; display: flex; justify-content: space-between; gap: 24px; padding: 25px 30px 20px; color: #f4efe8; border-bottom: 1px solid #454d52; background: #2b3237; }
.quality-head h1 { margin: 7px 0 5px; font: 28px var(--font-display); }
.quality-head p { margin: 0; color: #99a1a5; font-size: 9px; }
.close-button { align-self: flex-start; padding: 7px 10px; color: #b4bbbe; border: 1px solid #566066; background: transparent; font-size: 9px; }
.quality-content { padding: 25px 30px 50px; }
.readiness-panel { border: 1px solid #d4c9ba; background: #faf7f0; }
.panel-title { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #ded4c7; }
.panel-title div { display: grid; gap: 4px; }
.panel-title span { color: #9b715e; font-size: 8px; letter-spacing: .1em; }
.panel-title strong { font: 16px var(--font-display); }
.panel-title button, .report-actions button { padding: 7px 9px; color: var(--copper); border: 1px solid #cda898; background: transparent; font-size: 9px; }
.readiness-panel > p { margin: 0; padding: 11px 16px; color: #766d63; background: #eee6da; font-size: 10px; }
.check-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #ded4c7; }
.check-grid article { display: flex; gap: 8px; min-height: 55px; padding: 11px; color: #766b61; background: #fffaf3; }
.check-grid article > span { display: grid; place-items: center; width: 17px; height: 17px; flex: 0 0 17px; color: #9d754e; border: 1px solid #c8ad8d; border-radius: 50%; font-size: 9px; }
.check-grid article.passed > span { color: white; border-color: #567b6e; background: #567b6e; }
.check-grid article.critical:not(.passed) { background: #fff0e8; }
.check-grid article div { display: grid; gap: 4px; }
.check-grid strong { font-size: 9px; }
.check-grid small { color: #a08474; font-size: 8px; line-height: 1.4; }
.review-launch, .benchmark-config { display: grid; grid-template-columns: 1.4fr 1fr auto; gap: 10px; align-items: end; margin-top: 17px; padding: 15px; border: 1px solid #d6caba; background: #eae2d6; }
label { display: grid; gap: 6px; color: #776d62; font-size: 8px; }
select, textarea { width: 100%; padding: 9px; color: #49423b; border: 1px solid #cfc1b1; background: #fffaf2; font-size: 10px; }
.primary-action { min-height: 35px; padding: 9px 13px; color: #fffaf2; border: 1px solid var(--copper); background: var(--copper); font-size: 10px; }
.report-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.report-actions button { color: #fff8ee; border-color: var(--copper); background: var(--copper); }
.benchmark-thesis { display: flex; justify-content: space-between; gap: 24px; padding: 23px 25px; color: #ece8e1; border-left: 4px solid var(--copper); background: #30383d; }
.benchmark-thesis h2 { margin: 10px 0 8px; font: 27px var(--font-display); }
.benchmark-thesis p { max-width: 690px; margin: 0; color: #a7afb2; font: 11px/1.75 var(--font-body); }
.benchmark-seal { display: grid; place-items: center; width: 82px; height: 82px; flex: 0 0 82px; border: 1px solid #727b7f; border-radius: 50%; }
.benchmark-seal strong { color: #e4b08f; font: 28px var(--font-display); }
.benchmark-seal span { margin-top: -16px; color: #929b9f; font-size: 8px; }
.benchmark-config { grid-template-columns: 1fr 1fr auto auto; }
.cancel-action { min-height: 35px; color: #9b4332; border: 1px solid #bd7f70; background: transparent; font-size: 9px; }
.benchmark-progress { margin-top: 17px; padding: 17px; border: 1px solid #d4c8b9; background: #faf7f0; }
.progress-copy { display: flex; justify-content: space-between; font-size: 10px; }
.benchmark-line { height: 5px; margin-top: 10px; background: #ddd2c3; }
.benchmark-line i { display: block; height: 100%; background: var(--copper); transition: width .25s ease; }
.step-list { display: grid; gap: 4px; max-height: 220px; margin-top: 12px; overflow: auto; }
.step-list article { display: grid; grid-template-columns: 28px 1fr auto; padding: 7px 9px; color: #7b7166; background: #eee7db; font-size: 8px; }
.step-list article { cursor: pointer; }
.step-list article.active { color: #4b4038; outline: 1px solid #b97c66; background: #fff8ee; }
.step-list article.completed span { color: #477365; }
.step-evidence { margin-top: 12px; border: 1px solid #d3c6b6; background: #eee6da; }
.step-evidence header { display: flex; justify-content: space-between; gap: 18px; padding: 11px 13px; background: #30383d; }
.step-evidence header div { display: grid; gap: 4px; }
.step-evidence header span, .step-evidence header small { color: #9da6a9; font-size: 7px; }
.step-evidence header strong { color: #f2ece3; font-size: 10px; }
.step-evidence details { padding: 9px 12px; border-top: 1px solid #d4c8b8; }
.step-evidence summary { color: #8f6655; font-size: 8px; cursor: pointer; }
.step-evidence pre { max-height: 260px; overflow: auto; white-space: pre-wrap; color: #4f473f; font: 9px/1.55 ui-monospace, monospace; }
.run-history { margin-top: 22px; }
.run-history h3 { font: 17px var(--font-display); }
.run-history > article { display: flex; align-items: center; justify-content: space-between; padding: 13px 15px; border-top: 1px solid #d9cebf; cursor: pointer; }
.run-history > article:hover { background: #faf7f0; }
.run-history article > div:first-child { display: grid; gap: 5px; }
.run-history small { color: #958a7e; font-size: 8px; }
.run-score { display: grid; min-width: 90px; text-align: right; }
.run-score b { font: 21px var(--font-display); }
.run-score span { color: #9c7663; font-size: 8px; }
.blind-note { display: flex; gap: 22px; padding: 15px 18px; color: #dfe2e1; background: #30383d; }
.blind-note span { color: #dda383; font: 9px var(--font-ui); letter-spacing: .13em; }
.blind-note p { margin: 0; color: #a8afb2; font-size: 10px; }
.report-select { margin-top: 17px; }
.blind-manuscript { display: grid; grid-template-columns: minmax(240px, .7fr) minmax(0, 1.3fr); gap: 10px; margin-top: 12px; }
.blind-manuscript details, .blind-manuscript > div { min-width: 0; padding: 13px; border: 1px solid #d5c8b8; background: #faf7f0; }
.blind-manuscript summary, .blind-manuscript span { color: #9a6b55; font-size: 8px; letter-spacing: .08em; cursor: pointer; }
.blind-manuscript pre { max-height: 320px; margin: 10px 0 0; overflow: auto; white-space: pre-wrap; color: #4e4740; font: 11px/1.75 var(--font-body); }
.human-rubric { margin-top: 16px; display: grid; gap: 1px; border: 1px solid #d3c7b8; background: #d3c7b8; }
.human-rubric > label { grid-template-columns: 180px 1fr 32px; align-items: center; padding: 12px 15px; background: #faf7f0; }
.human-rubric input[type='range'] { accent-color: var(--copper); }
.human-rubric b { color: var(--copper); font: 15px var(--font-display); text-align: right; }
.human-rubric .human-notes { grid-template-columns: 180px 1fr; }
.human-notes textarea { min-height: 90px; resize: vertical; }
.human-rubric > button { justify-self: end; margin: 12px; }
.history-content { display: grid; gap: 10px; }
.history-content > article { display: grid; grid-template-columns: 110px 1fr; border: 1px solid #d4c8b9; background: #faf7f0; cursor: pointer; }
.history-content > article:hover { border-color: #bc8b76; }
.history-verdict { display: grid; align-content: center; padding: 15px; color: #eee9e1; background: #30383d; }
.history-verdict span { color: #dca083; font-size: 8px; }
.history-verdict strong { margin-top: 5px; font: 27px var(--font-display); }
.history-verdict small { color: #8f999d; font-size: 8px; }
.history-content > article > div:last-child { padding: 14px 17px; }
.history-content h3 { margin: 0 0 6px; font: 15px var(--font-display); }
.history-content p { margin: 0 0 8px; color: #766c61; font: 10px/1.6 var(--font-body); }
.empty-history { padding: 30px; color: #8b8073; border: 1px dashed #cdbfae; text-align: center; font-size: 10px; }
@media (max-width: 1150px) { .quality-shell { grid-template-columns: 205px 1fr; } .check-grid { grid-template-columns: repeat(2, 1fr); } .review-launch, .benchmark-config { grid-template-columns: 1fr 1fr; } }
</style>
