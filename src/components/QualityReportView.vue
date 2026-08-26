<template>
  <section class="quality-report">
    <header>
      <div><span class="eyebrow copper">QUALITY VERDICT</span><h2>{{ verdictLabel }}</h2><p>{{ report.modelReview?.summary || '评审模型没有提供摘要。' }}</p></div>
      <div class="score-stamp"><strong>{{ report.aggregate?.modelAverage || '—' }}</strong><span>/ 5</span><small>{{ report.execution === 'remote' ? '真实模型评审' : 'Mock 流程验证' }}{{ report.sameModelReview ? ' · 同模型评审' : '' }}</small></div>
    </header>
    <div class="rubric-grid">
      <article v-for="dimension in dimensions" :key="dimension.id">
        <span>{{ dimension.label }}</span><strong>{{ report.modelReview?.scores?.[dimension.id] || 1 }}</strong>
        <i><b :style="{ width: `${(report.modelReview?.scores?.[dimension.id] || 1) * 20}%` }"></b></i>
      </article>
    </div>
    <div class="deterministic">
      <span>确定性检查</span>
      <div><b v-for="item in report.deterministicChecks" :key="item.id" :class="{ passed: item.passed }">{{ item.passed ? '✓' : '!' }} {{ item.label }}</b></div>
    </div>
    <div class="issue-list">
      <h3>可定位问题</h3>
      <label v-for="issue in report.modelReview?.issues || []" :key="issue.id" :class="issue.severity">
        <input type="checkbox" :checked="selectedIssues.includes(issue.id)" :disabled="issue.severity === 'info'" @change="$emit('toggle-issue', issue.id)" />
        <span class="severity">{{ severityLabel(issue.severity) }}</span>
        <div><strong>{{ issue.category }} · {{ issue.criterion }}</strong><p v-if="issue.evidence">证据：{{ issue.evidence }}</p><small v-if="issue.repairInstruction">最小修复：{{ issue.repairInstruction }}</small></div>
      </label>
      <p v-if="!report.modelReview?.issues?.length" class="no-issues">评审没有发现可定位问题。</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { QUALITY_DIMENSIONS } from '../../electron/creative-quality.js'
const props = defineProps({ report: { type: Object, required: true }, selectedIssues: { type: Array, default: () => [] } })
defineEmits(['toggle-issue'])
const dimensions = QUALITY_DIMENSIONS
const verdictLabel = computed(() => ({
  pass_first_try: '首次生成达标', pass_after_repair: '定向修复后达标', automatic_complete: '自动评审完成，等待人工评分', fail: '当前候选未达标',
}[props.report.aggregate?.verdict] || '评审完成'))
function severityLabel(value) { return { high: '高', warning: '中', info: '提示' }[value] || value }
</script>

<style scoped>
.quality-report { margin-top: 17px; overflow: hidden; border: 1px solid #d3c7b8; background: #faf7f0; }
.quality-report > header { display: flex; justify-content: space-between; gap: 22px; padding: 19px 20px; color: #eeeae3; background: #30383d; }
.quality-report h2 { margin: 8px 0 5px; font: 21px var(--font-display); }
.quality-report header p { max-width: 700px; margin: 0; color: #a6aeb1; font: 10px/1.6 var(--font-body); }
.score-stamp { display: grid; grid-template-columns: auto auto; align-content: center; min-width: 92px; text-align: right; }
.score-stamp strong { color: #e3aa8a; font: 31px var(--font-display); }
.score-stamp > span { align-self: end; padding-bottom: 5px; color: #8e989c; font-size: 9px; }
.score-stamp small { grid-column: 1 / 3; color: #8e989c; font-size: 7px; }
.rubric-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #ddd2c3; }
.rubric-grid article { display: grid; gap: 7px; min-width: 0; padding: 11px; background: #fffaf3; }
.rubric-grid span { color: #80756a; font-size: 8px; }
.rubric-grid strong { color: #4d443c; font: 20px var(--font-display); }
.rubric-grid i { height: 3px; overflow: hidden; background: #e2d8ca; }
.rubric-grid i b { display: block; height: 100%; background: var(--copper); }
.deterministic { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 13px 16px; border-top: 1px solid #ded3c5; }
.deterministic > span { color: #8f705f; font-size: 8px; letter-spacing: .08em; }
.deterministic > div { display: flex; flex-wrap: wrap; gap: 5px; }
.deterministic b { padding: 4px 6px; color: #a0523f; border: 1px solid #dcb7aa; font-size: 7px; font-weight: 500; }
.deterministic b.passed { color: #426c5f; border-color: #9eb9af; }
.issue-list { border-top: 1px solid #ded3c5; }
.issue-list h3 { margin: 0; padding: 13px 16px; font: 15px var(--font-display); }
.issue-list label { display: grid; grid-template-columns: 18px 35px 1fr; gap: 8px; padding: 12px 16px; border-top: 1px solid #e4dbcf; cursor: pointer; }
.issue-list label.high { background: #fff1ea; }
.issue-list label.info { opacity: .68; cursor: default; }
.issue-list input { margin: 2px 0 0; accent-color: var(--copper); }
.severity { display: grid; place-items: center; width: 25px; height: 18px; color: #9a604f; border: 1px solid #d4a999; font-size: 7px; }
.issue-list label > div { display: grid; gap: 4px; }
.issue-list strong { color: #544b43; font-size: 9px; }
.issue-list p { margin: 0; color: #80756a; font: 9px/1.5 var(--font-body); }
.issue-list small { color: #a06a54; font-size: 8px; }
.no-issues { margin: 0; padding: 20px 16px; color: #637a71; border-top: 1px solid #e4dbcf; font-size: 9px; }
@media (max-width: 1200px) { .rubric-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
