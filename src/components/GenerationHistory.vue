<template>
  <div v-if="visible" class="history-backdrop" @mousedown.self="$emit('close')">
    <section class="history-panel" aria-label="生成记录">
      <header class="history-header">
        <div>
          <span class="history-kicker">GENERATION PROOFS</span>
          <h2>生成记录</h2>
          <p>每次生成的模型、提示词版本、重试次数与结果都留在这里。再次生成会基于当前已确认内容产生新候选。</p>
        </div>
        <div class="history-head-actions">
          <button class="history-refresh" :disabled="loading" @click="$emit('refresh')">{{ loading ? '读取中…' : '刷新' }}</button>
          <button class="history-close" title="关闭" @click="$emit('close')">×</button>
        </div>
      </header>

      <nav class="history-filters" aria-label="记录筛选">
        <button v-for="filter in filters" :key="filter.id" :class="{ active: activeFilter === filter.id }" @click="activeFilter = filter.id">
          {{ filter.label }} <span>{{ countFor(filter.id) }}</span>
        </button>
      </nav>

      <div class="history-body">
        <div v-if="loading && !records.length" class="history-empty">正在整理生成凭证…</div>
        <div v-else-if="!filteredRecords.length" class="history-empty">这个筛选下还没有生成记录。</div>
        <article v-for="record in filteredRecords" :key="record.id" class="proof-row" :class="record.status">
          <div class="proof-rail">
            <i></i><span>{{ Math.max(1, record.attemptCount || 1) }}</span>
          </div>
          <div class="proof-main">
            <div class="proof-heading">
              <div>
                <span class="proof-status" :class="record.status">{{ statusLabel(record.status) }}</span>
                <strong>{{ taskLabel(record.task) }}</strong>
                <small v-if="record.retryOfId">重试稿</small>
              </div>
              <time>{{ formatTime(record.createdAt) }}</time>
            </div>
            <div class="proof-meta">
              <span>{{ record.model?.name || 'MockProvider' }}</span>
              <span>{{ record.model?.model || record.model?.provider || '内置回退' }}</span>
              <span>{{ Math.max(1, record.attemptCount || 1) }} 次尝试</span>
              <span v-if="record.promptSnapshot?.promptHash">提示词 {{ shortHash(record.promptSnapshot.promptHash) }}</span>
            </div>
            <p v-if="record.error" class="proof-error">{{ record.error }}</p>
            <p v-else class="proof-excerpt">{{ excerpt(record.output) }}</p>
            <details class="proof-details">
              <summary>查看任务凭证</summary>
              <dl>
                <div><dt>任务参数</dt><dd>{{ requestSummary(record) }}</dd></div>
                <div><dt>提示词模板</dt><dd>{{ record.promptSnapshot?.template?.name || record.promptTemplateId || '内置模板' }} · v{{ record.promptTemplateVersion || 1 }}</dd></div>
                <div><dt>采样参数</dt><dd><code>{{ compactJson(record.parameters) }}</code></dd></div>
                <div v-if="record.events?.length"><dt>执行轨迹</dt><dd>{{ eventSummary(record.events) }}</dd></div>
              </dl>
            </details>
          </div>
          <div class="proof-actions">
            <button
              :disabled="!canRetry(record) || retryingId === record.id"
              :title="retryTitle(record)"
              @click="$emit('retry', record)"
            >{{ retryingId === record.id ? '生成中…' : '再次生成' }}</button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  records: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  retryingId: { type: String, default: '' },
})

defineEmits(['close', 'refresh', 'retry'])

const activeFilter = ref('all')
const filters = [
  { id: 'all', label: '全部' },
  { id: 'completed', label: '已完成' },
  { id: 'failed', label: '失败' },
  { id: 'cancelled', label: '已取消' },
]
const filteredRecords = computed(() => activeFilter.value === 'all'
  ? props.records
  : props.records.filter((record) => record.status === activeFilter.value))

function countFor(status) {
  return status === 'all' ? props.records.length : props.records.filter((record) => record.status === status).length
}

function statusLabel(status) {
  return { completed: '完成', failed: '失败', cancelled: '取消', pending: '执行中' }[status] || status
}

function taskLabel(task) {
  return {
    chapter: '正文候选', planning_field: '规划字段', chapter_card: '章节卡', scene_plan: '场景计划',
    rewrite: '局部重写', chapter_state_extract: '章后状态', continuity_audit: '连续性审计',
    quality_review: '创作质量评审',
  }[task] || task || '生成任务'
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false })
}

function shortHash(value) {
  return String(value).slice(0, 10)
}

function excerpt(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text ? (text.length > 150 ? `${text.slice(0, 150)}…` : text) : '任务已完成，未保存文本型输出。'
}

function requestSummary(record) {
  const request = record.request || {}
  const target = request.planning?.fieldLabel || request.planning?.targetLabel || ''
  return [taskLabel(request.task || record.task), target, request.instruction ? `要求：${request.instruction}` : ''].filter(Boolean).join(' · ')
}

function compactJson(value) {
  const text = JSON.stringify(value || {})
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

function eventSummary(events) {
  const retries = events.filter((event) => event.type === 'retrying')
  if (!retries.length) return '单次执行完成，没有触发自动重试。'
  return retries.map((event) => `第 ${event.attempt} 次失败，${event.delayMs} ms 后进入第 ${event.nextAttempt} 次`).join('；')
}

function canRetry(record) {
  return record.status !== 'pending' && record.task !== 'rewrite' && Boolean(record.request?.task && record.request?.projectId)
}

function retryTitle(record) {
  if (record.status === 'pending') return '任务仍在执行'
  if (record.task === 'rewrite') return '局部重写需要在编辑器中重新选择文字'
  if (!record.request?.task) return '旧记录没有可重试任务快照'
  return '按原任务参数、基于当前已确认内容重新生成候选'
}
</script>

<style scoped>
.history-backdrop{position:fixed;inset:0;z-index:90;background:rgba(11,13,15,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:34px}
.history-panel{width:min(1040px,94vw);height:min(820px,90vh);overflow:hidden;border:1px solid #52493f;background:#201f1d;color:#eee8df;box-shadow:0 28px 80px rgba(0,0,0,.5);display:flex;flex-direction:column}
.history-header{padding:28px 30px 22px;border-bottom:1px solid #403b35;display:flex;justify-content:space-between;gap:24px;background:linear-gradient(120deg,#272521,#1d1d1c)}
.history-kicker{font:600 10px/1.2 ui-monospace,monospace;letter-spacing:.18em;color:#c88b58}.history-header h2{margin:7px 0 6px;font:500 28px/1.1 Georgia,serif}.history-header p{margin:0;color:#a9a198;font-size:13px;max-width:690px;line-height:1.6}
.history-head-actions{display:flex;align-items:flex-start;gap:10px}.history-refresh,.history-close{border:1px solid #565049;background:transparent;color:#d9d1c7;cursor:pointer}.history-refresh{padding:8px 14px;font-size:12px}.history-close{width:34px;height:34px;font-size:22px}.history-refresh:disabled{opacity:.45}
.history-filters{display:flex;gap:4px;padding:14px 30px;border-bottom:1px solid #393631;background:#242321}.history-filters button{border:0;background:transparent;color:#8f8981;padding:8px 13px;cursor:pointer;font-size:12px}.history-filters button span{margin-left:5px;font-family:ui-monospace,monospace}.history-filters button.active{background:#34302b;color:#f2ece4}
.history-body{overflow:auto;padding:18px 30px 30px}.history-empty{padding:80px 20px;text-align:center;color:#89837b}
.proof-row{display:grid;grid-template-columns:42px minmax(0,1fr) 108px;border:1px solid #3d3934;border-bottom:0;background:#252421;min-height:148px}.proof-row:last-child{border-bottom:1px solid #3d3934}.proof-row:hover{background:#292724}
.proof-rail{position:relative;border-right:1px solid #3d3934;display:flex;flex-direction:column;align-items:center}.proof-rail:before{content:"";position:absolute;top:0;bottom:0;left:20px;width:1px;background:#4d4740}.proof-rail i{z-index:1;width:9px;height:9px;margin-top:28px;border-radius:50%;background:#8d867d;border:3px solid #252421}.completed .proof-rail i{background:#7ea27c}.failed .proof-rail i{background:#c26858}.cancelled .proof-rail i{background:#ba956d}.proof-rail span{z-index:1;margin-top:12px;padding:2px 4px;background:#252421;color:#807970;font:10px ui-monospace,monospace}
.proof-main{padding:20px 18px}.proof-heading{display:flex;justify-content:space-between;gap:12px}.proof-heading>div{display:flex;align-items:center;gap:9px}.proof-heading strong{font-size:15px}.proof-heading small{color:#b98b65}.proof-heading time{color:#777169;font:11px ui-monospace,monospace}.proof-status{border:1px solid #676059;padding:2px 6px;color:#aaa39a;font:10px ui-monospace,monospace}.proof-status.completed{border-color:#536d53;color:#93b291}.proof-status.failed{border-color:#7d4c45;color:#db8170}.proof-status.cancelled{border-color:#705f49;color:#c5a47b}
.proof-meta{display:flex;flex-wrap:wrap;gap:7px 16px;margin:12px 0;color:#8e877f;font-size:11px}.proof-meta span:not(:last-child):after{content:"/";margin-left:16px;color:#4e4943}.proof-excerpt,.proof-error{margin:0;color:#c1bab1;font-size:12px;line-height:1.6}.proof-error{color:#e28a79}.proof-details{margin-top:13px;color:#8e877f;font-size:11px}.proof-details summary{cursor:pointer;color:#b99574}.proof-details dl{margin:12px 0 0;padding:12px 14px;background:#1e1d1b}.proof-details dl div{display:grid;grid-template-columns:86px 1fr;gap:12px;margin:7px 0}.proof-details dt{color:#756f68}.proof-details dd{margin:0;color:#aaa39a;word-break:break-word}.proof-details code{white-space:normal;color:#b7ad9f}
.proof-actions{border-left:1px solid #3d3934;display:flex;align-items:center;justify-content:center}.proof-actions button{border:1px solid #71523a;background:#3b2d23;color:#dfb185;padding:9px 12px;cursor:pointer;font-size:12px}.proof-actions button:disabled{border-color:#4c4843;background:#2a2927;color:#68635d;cursor:not-allowed}
@media (max-width:760px){.history-backdrop{padding:0}.history-panel{width:100vw;height:100vh}.history-header{padding:22px}.history-body,.history-filters{padding-left:16px;padding-right:16px}.proof-row{grid-template-columns:32px 1fr}.proof-actions{grid-column:2;border:0;justify-content:flex-start;padding:0 18px 18px}.proof-heading time{display:none}}
</style>
