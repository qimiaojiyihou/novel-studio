<template>
  <div class="entity-editor">
    <div class="entity-editor-heading">
      <div class="entity-title-block">
        <span>{{ meta.eyebrow }} / {{ String(entity.position).padStart(2, '0') }}</span>
        <div>
          <input :value="entity.title" :aria-label="meta.titleLabel" @input="$emit('update-title', $event.target.value)" />
          <button v-if="String(entity.title || '').trim()" type="button" class="cascade-title" title="修改名称并检查全书影响" @click="$emit('cascade-title')">联动修改</button>
          <CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="appModelLabel" action-label="AI 起名" :busy="titleBusy" :disabled="titleBusy" @execute="$emit('generate-title', $event)" @edit-default="$emit('edit-default')" />
        </div>
        <p>{{ meta.copy }}</p>
      </div>
      <div class="entity-heading-actions">
        <CreativeExecutionControl
          :default-mode="defaultExecutionMode"
          :app-model-label="appModelLabel"
          action-label="AI 补全整卡"
          :busy="bundleBusy"
          :disabled="bundleBusy"
          @execute="$emit('generate-all', $event)"
          @edit-default="$emit('edit-default')"
        />
        <div class="entity-tools">
          <button :disabled="entity.position <= 1" @click="$emit('move', -1)">↑</button>
          <button :disabled="entity.position >= entityCount" @click="$emit('move', 1)">↓</button>
          <button class="delete" @click="$emit('delete')">删除</button>
        </div>
      </div>
    </div>
    <div class="entity-field-grid">
      <PlanningField
        v-for="field in fields.filter(item => !item.optional)"
        :key="field.key"
        :field="field"
        :model-value="String(entity.data[field.key] || '')"
        :busy="generationKey === `entity:${entity.id}:${field.key}`"
        :default-execution-mode="defaultExecutionMode"
        :app-model-label="appModelLabel"
        @update:model-value="$emit('update-field', { key: field.key, value: $event })"
        @generate="$emit('generate-field', { field, mode: $event })"
        @cascade="$emit('cascade-field', { field })"
        @edit-default="$emit('edit-default')"
      />
    </div>
    <ExtraDataEditor
      :model-value="entity.data"
      :known-keys="fields.map(field => field.key)"
      @update="$emit('update-field', $event)"
    />
    <details v-if="fields.some(item => item.optional)">
      <summary>人物声音（可选）</summary>
      <div class="entity-field-grid">
        <PlanningField v-for="field in fields.filter(item => item.optional)" :key="field.key" :field="field" :model-value="String(entity.data[field.key] || '')"
          :default-execution-mode="defaultExecutionMode" :app-model-label="appModelLabel"
          @update:model-value="$emit('update-field', { key: field.key, value: $event })" @generate="$emit('generate-field', { field, mode: $event })" />
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import PlanningField from '../PlanningField.vue'
import CreativeExecutionControl from '../CreativeExecutionControl.vue'
import ExtraDataEditor from './ExtraDataEditor.vue'

const props = defineProps({
  kind: { type: String, required: true },
  entity: { type: Object, required: true },
  fields: { type: Array, required: true },
  entityCount: { type: Number, required: true },
  generationKey: { type: String, default: '' },
  defaultExecutionMode: { type: String, default: 'app_model' },
  appModelLabel: { type: String, default: '任务模型' },
})
defineEmits(['update-title', 'update-field', 'generate-title', 'generate-field', 'generate-all', 'cascade-title', 'cascade-field', 'move', 'delete', 'edit-default'])

const definitions = {
  character: { eyebrow: 'CHARACTER FILE', titleLabel: '人物姓名或称谓', copy: '人物卡记录会改变选择的内在机制，不追求一次写成完整传记。' },
  world: { eyebrow: 'WORLD FACT', titleLabel: '设定名称', copy: '把这条设定写成会限制行动、制造代价或改变结果的事实。' },
  volume: { eyebrow: 'STORY PHASE', titleLabel: '分卷名称', copy: '一卷是一段完成了阶段目标、并改变整体局势的故事。' },
}
const meta = computed(() => definitions[props.kind])
const titleBusy = computed(() => props.generationKey === `entity:${props.entity.id}:title`)
const bundleBusy = computed(() => props.generationKey === `entity:${props.entity.id}:bundle`)
</script>

<style scoped>
.entity-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 25px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.entity-title-block { min-width: 0; flex: 1; }.entity-title-block > span { color: var(--copper); font: 600 8px var(--font-ui); letter-spacing: .14em; }.entity-title-block > div { display: flex; align-items: center; gap: 10px; margin-top: 7px; }.entity-title-block input { min-width: 0; width: min(460px, 100%); padding: 2px 0; color: #352f2a; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; font: 26px var(--font-display); }.entity-title-block input:focus { border-bottom-color: var(--copper-light); }.entity-title-block button { flex: 0 0 auto; padding: 5px 7px; color: var(--copper); border: 1px solid #d9b7a6; background: transparent; font-size: 8px; }.entity-title-block button.cascade-title { color: #776a5f; border-color: #d5c8b8; }.entity-title-block button.cascade-title:hover { color: var(--copper); border-color: #d9b7a6; }.entity-title-block p { margin: 6px 0 0; color: #938679; font: 9px/1.55 var(--font-body); }
.entity-heading-actions { display: flex; align-items: center; gap: 9px; }.entity-tools { display: flex; gap: 4px; }.entity-tools button { width: 27px; height: 27px; color: #82766b; border: 1px solid #d6cabc; background: transparent; font-size: 9px; }.entity-tools button.delete { width: auto; padding: 0 8px; color: #a14d3b; }.entity-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 23px 18px; }
</style>
