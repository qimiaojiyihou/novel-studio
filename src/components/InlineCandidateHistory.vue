<template>
  <div class="candidate-history-backdrop" @mousedown.self="emit('close')" @keydown.esc.stop="emit('close')">
    <section ref="dialogRoot" class="candidate-history" role="dialog" aria-modal="true" aria-labelledby="candidate-history-title" tabindex="-1">
      <header>
        <div><span class="eyebrow">CANDIDATES</span><h2 id="candidate-history-title">本书候选稿</h2><p>查看已保存的候选与历史版本。打开查看不会替换正文。</p></div>
        <button class="icon-button" aria-label="关闭候选稿历史" @click="emit('close')">×</button>
      </header>
      <div class="candidate-history-tools">
        <label>范围 <select v-model="chapterId" :disabled="loading"><option value="">全书任务</option><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.title }}</option></select></label>
        <button class="outline-button" :disabled="loading" @click="load(0)">刷新</button>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="loading" role="status">正在读取候选记录…</p>
      <p v-else-if="!runs.length && !error" class="candidate-history-empty">这个范围还没有已保存的候选稿。</p>
      <div v-else class="candidate-history-list" aria-label="候选任务列表">
        <button v-for="run in runs" :key="run.id" :disabled="loading" @click="emit('open-run', run.id)">
          <span><strong>{{ targetLabel(run) }}</strong><small>{{ chapterLabel(run) }} · {{ statusLabel(run.status) }}</small></span>
          <span class="candidate-history-count"><strong>{{ run.pendingCandidateCount ? `${run.pendingCandidateCount} 份待确认` : `${run.candidateCount} 个版本` }}</strong><small>{{ formatTime(run.updatedAt) }}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <footer><button class="outline-button" :disabled="loading || page === 0" @click="load(page - 1)">上一页</button><span>第 {{ page + 1 }} 页</span><button class="outline-button" :disabled="loading || !hasMore" @click="load(page + 1)">下一页</button></footer>
    </section>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
const props = defineProps({ projectId: { type: String, required: true }, chapters: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'open-run'])
const runs = ref([]), loading = ref(false), error = ref(''), chapterId = ref(''), page = ref(0), hasMore = ref(false), dialogRoot = ref(null)
const PAGE_SIZE = 30
let sequence = 0
async function load(nextPage = 0) {
  const serial = ++sequence, projectId = props.projectId
  loading.value = true; error.value = ''
  try {
    const rows = await appService.listAgentRuns({ projectId, chapterId: chapterId.value, candidateHistory: true, limit: PAGE_SIZE + 1, offset: nextPage * PAGE_SIZE })
    if (serial !== sequence || projectId !== props.projectId) return
    runs.value = rows.slice(0, PAGE_SIZE); hasMore.value = rows.length > PAGE_SIZE; page.value = nextPage
  } catch (failure) { if (serial === sequence) error.value = failure.message }
  finally { if (serial === sequence) loading.value = false }
}
watch([() => props.projectId, chapterId], () => { runs.value = []; void load(0) }, { immediate: true })
onMounted(async () => { await nextTick(); dialogRoot.value?.focus() })
onBeforeUnmount(() => { sequence++ })
function targetLabel(run) { return ({ manuscript: '正文候选', manuscript_selection: '局部重写候选', chapter_card: '章节卡候选', scene_plan: '场景计划候选', chapter_field: '章节字段候选', planning_document_bundle: '整页规划候选', planning_entity_bundle: '设定卡候选', planning_chapter_bundle: '章节规划候选', reference_guide_draft: '参考资料候选' })[run.inlineTargetKind] || '创作候选' }
function chapterLabel(run) { return props.chapters.find(chapter => chapter.id === run.chapterId)?.title || '项目资料' }
function statusLabel(status) { return ({ completed: '已结束', cancelled: '已取消', failed: '生成中断', waiting_confirmation: '等待确认', running: '生成中', pending: '待执行', waiting_approval: '等待批准', paused: '已暂停' })[status] || status }
function formatTime(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
</script>

<style scoped>
.candidate-history-backdrop { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 24px; background: #11182088; }
.candidate-history { width: min(760px, 100%); max-height: calc(100vh - 48px); overflow: auto; padding: 24px; color: var(--ns-text); background: var(--ns-surface); border: 1px solid var(--ns-border-strong); border-radius: 14px; box-shadow: var(--ns-shadow-lg); }
header, .candidate-history-tools, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
header { align-items: flex-start; } h2 { margin: 8px 0; } p { font-size: 13px; line-height: 1.7; }
.candidate-history-tools { margin: 16px 0; } label { display: flex; align-items: center; gap: 8px; min-width: 0; } select { max-width: min(430px, 55vw); padding: 6px; }
.candidate-history-list { display: grid; gap: 8px; } .candidate-history-list > button { display: flex; align-items: center; gap: 16px; padding: 14px; border: 1px solid var(--ns-border-strong); border-radius: 8px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.candidate-history-list > button:hover, .candidate-history-list > button:focus-visible { background: var(--ns-accent-soft); outline: 2px solid var(--ns-accent); }
.candidate-history-list > button > span:first-child { flex: 1; } strong, small { display: block; } small { margin-top: 6px; color: var(--ns-text-muted); font-size: 12px; } strong { font-size: 14px; } .candidate-history-count { text-align: right; }
footer { justify-content: center; margin-top: 20px; } .candidate-history-empty { padding: 32px 0; text-align: center; }
@media (max-width: 600px) { .candidate-history-backdrop { padding: 10px; } .candidate-history { padding: 16px; } .candidate-history-list > button { gap: 8px; } }
</style>
