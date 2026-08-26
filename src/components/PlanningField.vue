<template>
  <div class="planning-field" :class="{ wide: field.wide, tall: field.tall, busy }">
    <span class="planning-field-head">
      <span>
        <strong>{{ field.label }}</strong>
        <small>{{ field.hint }}</small>
      </span>
      <span class="field-actions">
        <button
          v-if="String(modelValue || '').trim()"
          type="button"
          class="cascade-button"
          :disabled="busy"
          title="修改此设定，并检查全书中受它影响的内容"
          @click="$emit('cascade')"
        >联动修改</button>
        <CreativeExecutionControl
          compact
          :default-mode="defaultExecutionMode"
          :app-model-label="appModelLabel"
          action-label="AI 候选"
          :busy="busy"
          :disabled="busy"
          @execute="$emit('generate', $event)"
          @edit-default="$emit('edit-default')"
        />
      </span>
    </span>
    <textarea
      ref="editor"
      :class="{ compact: field.type === 'input' }"
      :rows="field.tall ? 8 : field.type === 'input' ? 2 : 4"
      :value="modelValue || ''"
      :aria-label="field.label"
      :placeholder="field.placeholder"
      @input="handleInput"
    ></textarea>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import CreativeExecutionControl from './CreativeExecutionControl.vue'

const props = defineProps({
  field: { type: Object, required: true },
  modelValue: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  defaultExecutionMode: { type: String, default: 'app_model' },
  appModelLabel: { type: String, default: '任务模型' },
})

const emit = defineEmits(['update:modelValue', 'generate', 'edit-default', 'cascade'])
const editor = ref(null)

function resize(target = editor.value) {
  if (!target) return
  target.style.height = 'auto'
  target.style.height = `${Math.min(360, Math.max(target.scrollHeight, props.field.tall ? 210 : props.field.type === 'input' ? 64 : 96))}px`
}

function handleInput(event) {
  emit('update:modelValue', event.target.value)
  resize(event.target)
}

onMounted(() => nextTick(resize))
watch(() => props.modelValue, () => nextTick(resize))
</script>

<style scoped>
.planning-field { display: grid; align-content: start; gap: 8px; min-width: 0; }
.planning-field.wide { grid-column: 1 / -1; }
.planning-field-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.planning-field-head > span { display: grid; gap: 3px; }
.planning-field-head > .field-actions { display: flex; align-items: center; gap: 6px; }
.cascade-button { padding: 5px 7px; color: #776a5f; border: 1px solid #d5c8b8; background: transparent; font: 8px var(--font-ui); letter-spacing: .04em; white-space: nowrap; }
.cascade-button:hover:not(:disabled) { color: var(--copper); border-color: #d9b7a6; background: rgba(182,85,62,.04); }
.cascade-button:disabled { opacity: .45; }
.planning-field strong { color: #49423b; font: 13px var(--font-display); }
.planning-field small { color: #9a8d7e; font-size: 8px; line-height: 1.35; }
.planning-field textarea { box-sizing: border-box; width: 100%; min-height: 96px; max-height: 360px; padding: 10px 11px; overflow-y: auto; color: #49423b; border: 1px solid #d8cdbf; outline: 0; resize: vertical; background: rgba(255,255,255,.46); font: 12px/1.7 var(--font-body); }
.planning-field textarea.compact { min-height: 64px; }
.planning-field.tall textarea { min-height: 210px; }
.planning-field textarea:focus { border-color: var(--copper-light); background: #fffdf8; box-shadow: 0 0 0 2px rgba(182,85,62,.06); }
.planning-field.busy textarea { border-color: #d9b7a6; }
.field-spinner { width: 7px; height: 7px; border: 1px solid rgba(182,85,62,.35); border-top-color: var(--copper); border-radius: 50%; animation: field-spin .8s linear infinite; }
@keyframes field-spin { to { transform: rotate(360deg); } }
</style>
