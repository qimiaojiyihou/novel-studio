<template>
  <section class="candidate-author-editor">
    <header><strong>作者编辑</strong><span>{{ description }}</span></header>
    <label v-for="field in fields" :key="field.path.join('.')">
      <span>{{ field.label }}</span>
      <textarea :value="field.value" :rows="field.value.length > 300 ? 9 : 3" @input="setValue(field.path, $event.target.value)"></textarea>
    </label>
    <details><summary>高级：数据结构（只读）</summary><pre>{{ JSON.stringify(modelValue, null, 2) }}</pre></details>
  </section>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ modelValue: { type: Object, required: true }, description: { type: String, default: '修改保留在候选中，确认后才写入' } })
const emit = defineEmits(['update:modelValue'])
const labels = { goal: '本章变化', protagonistGoal: '人物目标', resistance: '主要阻力', turningPoint: '转折', payoff: '回报', cost: '代价', ending: '章末落点', hook: '承接点', title: '标题', text: '内容', manuscript: '正文', summary: '摘要', requiredScenes: '必要场景', scenes: '场景', result: '结果', opening: '开场', candidateValue: '候选内容', name: '名称' }
const metadata = new Set(['id', 'key', 'label', 'sourceDigest', 'originalValue', 'schemaVersion', 'boundaryMode', 'generationId', 'sourceGenerationId'])
function flatten(value, path = [], heading = '') {
  return Object.entries(value || {}).flatMap(([key, item]) => {
    if (metadata.has(key) || ['patches', 'evidence'].includes(key)) return []
    const label = /^\d+$/.test(key) ? `${heading} ${Number(key) + 1}` : `${heading ? heading + ' · ' : ''}${labels[key] || key}`
    if (typeof item === 'string') return [{ path: [...path, key], label, value: item }]
    return item && typeof item === 'object' ? flatten(item, [...path, key], label) : []
  })
}
const fields = computed(() => flatten(props.modelValue))
function setValue(path, text) {
  const value = JSON.parse(JSON.stringify(props.modelValue))
  let target = value
  for (const key of path.slice(0, -1)) target = target[key]
  target[path.at(-1)] = text
  emit('update:modelValue', value)
}
</script>
<style scoped>
.candidate-author-editor{display:grid;gap:16px;min-width:0;padding:16px;background:#f9fcfc;color:#294449}.candidate-author-editor header{display:flex;flex-wrap:wrap;gap:12px}.candidate-author-editor header span{font-size:12px;color:#526c73}.candidate-author-editor label{display:grid;gap:8px}.candidate-author-editor textarea{box-sizing:border-box;resize:vertical;min-height:90px;width:100%;padding:12px;border:1px solid #afc8cd;border-radius:8px;color:#263e45;background:white;font:inherit;line-height:1.7}.candidate-author-editor pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
