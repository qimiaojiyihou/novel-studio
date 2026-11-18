<template>
  <section class="reference-calibration" aria-label="同场景盲评">
    <h3>同场景盲评</h3>
    <p class="reference-hint">同一模型按相同场景独立生成。提交判断后揭晓各稿使用的材料。</p>
    <label>对照方式<select v-model="comparisonMode" :disabled="running"><option value="rule">普通 / 规则</option><option value="samples">普通 / 规则 / 规则和选段</option></select></label>
    <label>本次测试的规则<select v-model="rule" :disabled="running"><option v-for="line in rules" :key="line">{{ line }}</option></select></label>
    <div class="reference-book-options">
      <label>测试任务<select v-model="task" :disabled="running"><option value="draft">起草</option><option value="rewrite">定向修稿</option></select></label>
      <label v-if="showModelOverrides">盲评模型<select v-model="backend" :disabled="running"><option value="codex">Codex · 跟随 Codex 设置</option><option value="app">应用模型 · {{ modelLabel }}</option></select></label>
    </div>
    <label>场景与要求<textarea v-model="brief" :disabled="running" maxlength="1200" rows="2" /></label>
    <label>{{ task === 'rewrite' ? '待修原稿' : '共同前文（可选）' }}<textarea v-model="sourceText" :disabled="running" maxlength="6000" rows="3" /></label>
    <div><button type="button" :disabled="disabled || running || voting || !rule || !brief.trim() || (task === 'rewrite' && !sourceText.trim())" @click="start()">{{ comparisonMode === 'samples' ? '生成三稿' : '生成两稿' }}</button>
      <button v-if="running" type="button" @click="stop">停止盲评</button>
      <span v-if="running" role="status"> 正在生成独立稿件…</span></div>
    <p v-if="error" class="reference-error" role="alert">{{ error }}</p>
    <label v-if="history.length">最近盲评<select :value="record?.id || ''" :disabled="running || voting" @change="open($event.target.value)">
      <option value="" disabled>选择一组盲评</option>
      <option v-for="item in history" :key="item.id" :value="item.id">{{ item.verdict ? '已评' : '待评' }} · {{ item.brief.slice(0, 44) }}</option>
    </select></label>
    <article v-if="record" class="reference-trial">
      <strong>{{ record.task === 'rewrite' ? '定向修稿' : '起草' }} · {{ record.model.model }} {{ record.model.reasoningEffort }}</strong>
      <p>{{ record.brief }}</p>
      <details><summary>本组场景与规则</summary><p>{{ record.rule }}</p><div v-for="s in record.voiceSamples" :key="s.use"><small>{{ s.use }} · 《{{ s.title }}》</small><pre>{{ s.text }}</pre></div><pre v-if="record.source_text">{{ record.source_text }}</pre></details>
      <div class="versions"><section v-for="(text, i) in [record.output_a, record.output_b, record.output_c].filter(Boolean)" :key="i"><h4>{{ 'ABC'[i] }} 稿</h4><pre>{{ text }}</pre></section></div>
      <p v-if="!record.complete" role="status">已保存 {{ record.completed }} / {{ record.expected }} 稿。{{ record.error }}</p><button v-if="!record.complete" type="button" :disabled="running || voting" @click="start(record.id)">补齐剩余稿件</button><template v-if="!record.verdict && record.complete">
        <label>具体反馈（可选）<textarea v-model="feedback" :disabled="voting" maxlength="1200" rows="2" placeholder="哪句更自然？有没有擅自改剧情或改动指定范围以外的句子？" /></label>
        <div class="votes"><button v-for="(label, key) in choices" :key="key" type="button" :disabled="voting || running" @click="vote(key)">{{ label }}</button></div>
      </template>
      <p v-if="record.verdict" role="status">你的选择：{{ choices[record.verdict] }}。<template v-if="record.order">{{ record.order.map((v,i) => 'ABC'[i] + ' 稿：' + v).join('，') }}。</template><template v-else>{{ record.guidedSlot === 0 ? 'A' : 'B' }} 稿使用了参考规则。</template>{{ record.feedback }}</p>
    </article>
  </section>
</template>

<script setup>
import { showModelOverrides } from '../composables/model-controls.js'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
const props = defineProps({ projectId: String, defaultMode: String, guide: String, history: Array, disabled: Boolean, modelId: String, modelLabel: String })
const emit = defineEmits(['changed'])
const task = ref('draft'), backend = ref(props.defaultMode === 'app_model' ? 'app' : 'codex'), rule = ref(''), brief = ref(''), sourceText = ref('')
const record = ref(null), feedback = ref(''), error = ref(''), running = ref(false), voting = ref(false)
const comparisonMode = ref('rule')
const choices = computed(() => ({ A: 'A 稿更好', B: 'B 稿更好', ...(record.value?.output_c ? { C: 'C 稿更好' } : {}), tie: '差不多', neither: '都不满意' }))
let disposed = false, loadEpoch = 0
const rules = computed(() => {
  const lines = (props.guide || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const tagged = lines.filter(s => /^(?:[-*]\s*)?【(通用|对白|详略|冲突|视角|情绪|改稿)】./.test(s))
  return [...new Set(tagged.length ? tagged : lines)]
})
watch(rules, list => { if (!list.includes(rule.value)) rule.value = list[0] || '' }, { immediate: true })
async function open(id) {
  const epoch = ++loadEpoch
  try {
    const value = await appService.loadReferenceComparison({ projectId: props.projectId, id })
    if (!disposed && epoch === loadEpoch) { record.value = value; feedback.value = ''; error.value = '' }
  } catch (e) { if (!disposed && epoch === loadEpoch) error.value = e.message }
}
watch(() => props.history[0]?.id, id => { if (id && !record.value && !running.value) void open(id) }, { immediate: true })
async function start(comparisonId = '') {
  running.value = true; error.value = ''; loadEpoch++
  const previousId = props.history[0]?.id
  let polling = false
  const progress = setInterval(async () => {
    if (polling || disposed || !running.value) return
    polling = true
    try {
      const state = await appService.loadReferenceNovels({ projectId: props.projectId })
      const latestId = state.comparisons[0]?.id
      const id = comparisonId || (latestId !== previousId ? latestId : '')
      if (id) {
        const value = await appService.loadReferenceComparison({ projectId: props.projectId, id })
        if (!disposed && running.value) record.value = value
      }
    } catch { /* The generation request reports errors; polling is best effort. */ }
    finally { polling = false }
  }, 2000)
  try {
    const value = await appService.compareReferences({ comparisonId, projectId: props.projectId, task: task.value, backend: showModelOverrides.value ? backend.value : props.defaultMode === 'app_model' ? 'app' : 'codex', includeSamples: comparisonMode.value === 'samples',
      modelProfileId: props.modelId, brief: brief.value, sourceText: sourceText.value, rule: rule.value })
    if (!disposed) { record.value = value; feedback.value = ''; emit('changed') }
  } catch (e) { if (!disposed) error.value = e.message }
  finally { clearInterval(progress); running.value = false }
}
async function stop() { await appService.stopReferenceComparison({ projectId: props.projectId }) }
async function vote(verdict) {
  voting.value = true; error.value = ''; loadEpoch++
  try {
    const value = await appService.judgeReferenceComparison({ projectId: props.projectId, id: record.value.id, verdict, feedback: feedback.value })
    if (!disposed) { record.value = value; emit('changed') }
  } catch (e) { if (!disposed) error.value = e.message }
  finally { voting.value = false }
}
onBeforeUnmount(() => { disposed = true; if (running.value) void stop() })
</script>

<style scoped>
.versions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:16px}
.versions section{padding:14px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8}
.votes{display:flex;flex-wrap:wrap;gap:8px}
.reference-calibration,.reference-trial,label{display:grid;gap:10px}
.reference-book-options{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.reference-calibration{border-top:1px solid var(--ns-border,#bdcfd2);padding-top:20px}
input,textarea,select,button{font:inherit;color:inherit;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px;background:var(--ns-surface,#fff);padding:9px;min-width:0;max-width:100%}
button{cursor:pointer}button:disabled{opacity:.5}
</style>
