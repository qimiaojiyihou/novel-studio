<template>
  <div class="entity-editor">
    <div class="entity-editor-heading">
      <div class="entity-title-block">
        <span>{{ meta.eyebrow }} / {{ String(entity.position).padStart(2, '0') }}</span>
        <div>
          <input :value="entity.title" :aria-label="meta.titleLabel" @input="$emit('update-title', $event.target.value)" />
          <button :disabled="titleBusy" @click="$emit('generate-title')">{{ titleBusy ? '生成中' : 'AI 起名' }}</button>
        </div>
        <p>{{ meta.copy }}</p>
      </div>
      <div class="entity-tools">
        <button :disabled="entity.position <= 1" @click="$emit('move', -1)">↑</button>
        <button :disabled="entity.position >= entityCount" @click="$emit('move', 1)">↓</button>
        <button class="delete" @click="$emit('delete')">删除</button>
      </div>
    </div>
    <div class="entity-field-grid">
      <PlanningField
        v-for="field in fields"
        :key="field.key"
        :field="field"
        :model-value="String(entity.data[field.key] || '')"
        :busy="generationKey === `entity:${entity.id}:${field.key}`"
        @update:model-value="$emit('update-field', { key: field.key, value: $event })"
        @generate="$emit('generate-field', field)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import PlanningField from '../PlanningField.vue'

const props = defineProps({
  kind: { type: String, required: true },
  entity: { type: Object, required: true },
  fields: { type: Array, required: true },
  entityCount: { type: Number, required: true },
  generationKey: { type: String, default: '' },
})
defineEmits(['update-title', 'update-field', 'generate-title', 'generate-field', 'move', 'delete'])

const definitions = {
  character: { eyebrow: 'CHARACTER FILE', titleLabel: '人物姓名或称谓', copy: '人物卡记录会改变选择的内在机制，不追求一次写成完整传记。' },
  world: { eyebrow: 'WORLD FACT', titleLabel: '设定名称', copy: '把这条设定写成会限制行动、制造代价或改变结果的事实。' },
  volume: { eyebrow: 'STORY PHASE', titleLabel: '分卷名称', copy: '一卷是一段完成了阶段目标、并改变整体局势的故事。' },
}
const meta = computed(() => definitions[props.kind])
const titleBusy = computed(() => props.generationKey === `entity:${props.entity.id}:title`)
</script>

<style scoped>
.entity-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 25px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.entity-title-block { min-width: 0; flex: 1; }.entity-title-block > span { color: var(--copper); font: 600 8px var(--font-ui); letter-spacing: .14em; }.entity-title-block > div { display: flex; align-items: center; gap: 10px; margin-top: 7px; }.entity-title-block input { min-width: 0; width: min(460px, 100%); padding: 2px 0; color: #352f2a; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; font: 26px var(--font-display); }.entity-title-block input:focus { border-bottom-color: var(--copper-light); }.entity-title-block button { flex: 0 0 auto; padding: 5px 7px; color: var(--copper); border: 1px solid #d9b7a6; background: transparent; font-size: 8px; }.entity-title-block p { margin: 6px 0 0; color: #938679; font: 9px/1.55 var(--font-body); }
.entity-tools { display: flex; gap: 4px; }.entity-tools button { width: 27px; height: 27px; color: #82766b; border: 1px solid #d6cabc; background: transparent; font-size: 9px; }.entity-tools button.delete { width: auto; padding: 0 8px; color: #a14d3b; }.entity-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 23px 18px; }
</style>
