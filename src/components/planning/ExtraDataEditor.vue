<template>
  <details v-if="entries.length" class="extra-data-editor" open>
    <summary>
      <span><strong>{{ title }}</strong><small>{{ entries.length }} 项 · 保留外接设计的完整结构</small></span>
      <i>展开 / 收起</i>
    </summary>
    <p class="extra-data-copy">{{ copy }}</p>
    <div class="extra-data-grid">
      <label v-for="entry in entries" :key="entry.key" :class="{ wide: entry.structured }">
        <span class="extra-data-heading">
          <span><strong>{{ fieldLabel(entry.key) }}</strong><small>{{ entry.key }}</small></span>
          <em>{{ entry.typeLabel }}</em>
        </span>
        <textarea
          :rows="entry.structured ? 8 : 4"
          :value="entry.draft"
          :aria-label="fieldLabel(entry.key)"
          @change="commit(entry, $event.target.value)"
        ></textarea>
        <small v-if="errors[entry.key]" class="extra-data-error">{{ errors[entry.key] }}</small>
      </label>
    </div>
  </details>
</template>

<script setup>
import { computed, reactive } from 'vue'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  knownKeys: { type: Array, default: () => [] },
  title: { type: String, default: '外接同步详细设定' },
  copy: { type: String, default: '这些字段由 ChatGPT Work 或外部创作任务写入。结构化内容会原样保存，并参与后续创作上下文。' },
})
const emit = defineEmits(['update'])
const errors = reactive({})

const labels = {
  title: '标题', workTitle: '作品名', positioning: '作品定位', coreQuestion: '核心命题', coreAppeal: '核心吸引力', styleRules: '文风规则', narrativeContract: '叙事合同', lengthPlan: '篇幅规划', pacing: '节奏规划',
  primarySetting: '主要舞台', tenLaws: '十条底层铁律', exceptionSystem: '例外体系', relicSystem: '现实遗物体系', reasoningBoundaries: '推理边界', historicalBackbone: '历史主干', mythologyRule: '神话与真实历史', society: '异常社会', secondSuccess: '第二次成功',
  structure: '全书结构', unit: '篇幅单位', baseBudget: '基础篇幅', conditionalBudget: '机动篇幅', expandedBudget: '总篇幅', acts: '七幕规划', firstVolumeCheckpoints: '首卷节奏检查点', checkpointRule: '检查点规则', structuralRequirements: '结构约束', confirmedDetailedChapterPlans: '已确认章节细纲',
  type: '设定类型', nature: '性质', definition: '定义', principle: '原则', role: '故事作用', function: '功能', limits: '限制', limit: '限制', constraints: '连续性约束', cost: '代价', effect: '效果', conditions: '成立条件', oldFact: '来源旧事实', appearance: '外观与表现', trajectory: '发展与回收', outcome: '结果', distinctFrom: '区别于', connections: '关联对象',
  personality: '性格与日常人格', strengths: '优势', flaws: '缺陷', flaw: '缺陷', identity: '身份与处境', speciality: '特殊性', arc: '人物弧', ending: '结局方向', background: '背景', position: '立场与位置', motivation: '动机', revealPlan: '揭示计划', knowledgeLimit: '知情边界', memory: '记忆边界',
  formalVolumeTitle: '正式卷名', actOrder: '所属幕', planningTargetWords: '规划字数', coreWork: '核心任务', closure: '阶段闭合', nextStage: '下一阶段入口', chapterCount: '预计章数', detailedCaseDesign: '案件细纲',
  subjectRef: '关联对象', relativeOrder: '相对时间', calendarDate: '公历时间', volumeRef: '关联分卷', firstIntroduction: '首次出现', readerUnderstanding: '读者初始理解', stageAnswer: '阶段答案', finalAnswer: '最终答案', exactTrigger: '精确触发条件', entryMechanism: '进入机制', useConditions: '使用条件', specificPattern: '具体规律', specificTests: '验证方式', notes: '备注',
  decisionId: '决策编号', rationale: '采用理由', module: '所属模块', openQuestion: '仍待确定', source: '来源', sourceStatus: '决策状态',
}

function serialized(value) {
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2)
  return value === undefined || value === null ? '' : String(value)
}

const entries = computed(() => Object.entries(props.modelValue || {})
  .filter(([key]) => !props.knownKeys.includes(key))
  .map(([key, value]) => ({
    key,
    value,
    structured: Boolean(value && typeof value === 'object'),
    typeLabel: Array.isArray(value) ? '列表' : value && typeof value === 'object' ? '结构化' : typeof value === 'boolean' ? '是 / 否' : typeof value === 'number' ? '数字' : '文本',
    draft: serialized(value),
  })))

function fieldLabel(key) {
  if (labels[key]) return labels[key]
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
}

function commit(entry, draft) {
  try {
    let value = draft
    if (entry.structured) value = JSON.parse(draft)
    else if (typeof entry.value === 'number') {
      value = Number(draft)
      if (!Number.isFinite(value)) throw new Error('请输入有效数字')
    } else if (typeof entry.value === 'boolean') {
      if (!['true', 'false'].includes(String(draft).trim().toLowerCase())) throw new Error('请输入 true 或 false')
      value = String(draft).trim().toLowerCase() === 'true'
    }
    errors[entry.key] = ''
    emit('update', { key: entry.key, value })
  } catch (error) {
    errors[entry.key] = entry.structured ? `JSON 格式有误：${error.message}` : error.message
  }
}
</script>

<style scoped>
.extra-data-editor { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--line); }
.extra-data-editor > summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; cursor: pointer; list-style: none; }
.extra-data-editor > summary::-webkit-details-marker { display: none; }
.extra-data-editor > summary span { display: flex; align-items: baseline; gap: 10px; }
.extra-data-editor > summary strong { color: #514840; font: 17px var(--font-display); }
.extra-data-editor > summary small, .extra-data-editor > summary i { color: #92877d; font: 9px var(--font-ui); }
.extra-data-editor > summary i { font-style: normal; }
.extra-data-copy { margin: 8px 0 18px; color: #867a70; font: 10px/1.65 var(--font-body); }
.extra-data-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 18px; }
.extra-data-grid label { min-width: 0; }
.extra-data-grid label.wide { grid-column: 1 / -1; }
.extra-data-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
.extra-data-heading > span { display: flex; flex-direction: column; gap: 2px; }
.extra-data-heading strong { color: #554c44; font: 11px var(--font-ui); }
.extra-data-heading small { color: #a09488; font: 8px var(--font-code); }
.extra-data-heading em { color: var(--copper); font: normal 8px var(--font-ui); letter-spacing: .08em; }
.extra-data-grid textarea { width: 100%; min-height: 92px; padding: 11px 12px; resize: vertical; color: #4f4841; border: 1px solid #d9cec1; outline: 0; background: rgba(255,255,255,.48); font: 11px/1.7 var(--font-body); }
.extra-data-grid textarea:focus { border-color: var(--copper-light); box-shadow: 0 0 0 2px rgba(181,101,67,.08); }
.extra-data-grid label.wide textarea { font-family: var(--font-code); font-size: 10px; }
.extra-data-error { display: block; margin-top: 5px; color: #a14d3b; font: 9px var(--font-ui); }
@media (max-width: 900px) { .extra-data-grid { grid-template-columns: 1fr; }.extra-data-grid label.wide { grid-column: auto; } }
</style>
