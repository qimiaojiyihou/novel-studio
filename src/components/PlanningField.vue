<template>
  <div class="planning-field" :class="{ wide: field.wide, tall: field.tall, busy }">
    <span class="planning-field-head">
      <span>
        <strong>{{ field.label }}</strong>
        <small>{{ field.hint }}</small>
      </span>
      <button type="button" :disabled="busy" :aria-label="`为${field.label}生成 AI 候选`" @click.prevent="$emit('generate')">
        <span v-if="busy" class="field-spinner"></span>{{ busy ? '生成中' : 'AI 候选' }}
      </button>
    </span>
    <input
      v-if="field.type === 'input'"
      :value="modelValue || ''"
      :aria-label="field.label"
      :placeholder="field.placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <textarea
      v-else
      :value="modelValue || ''"
      :aria-label="field.label"
      :placeholder="field.placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
  </div>
</template>

<script setup>
defineProps({
  field: { type: Object, required: true },
  modelValue: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})

defineEmits(['update:modelValue', 'generate'])
</script>

<style scoped>
.planning-field { display: grid; align-content: start; gap: 8px; min-width: 0; }
.planning-field.wide { grid-column: 1 / -1; }
.planning-field-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.planning-field-head > span { display: grid; gap: 3px; }
.planning-field strong { color: #49423b; font: 13px var(--font-display); }
.planning-field small { color: #9a8d7e; font-size: 8px; line-height: 1.35; }
.planning-field button { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 4px 6px; color: var(--copper); border: 1px solid #d9b7a6; background: transparent; font-size: 8px; }
.planning-field button:hover { color: #fffaf2; background: var(--copper); }
.planning-field input, .planning-field textarea { width: 100%; color: #49423b; border: 1px solid #d8cdbf; outline: 0; background: rgba(255,255,255,.46); font: 12px/1.7 var(--font-body); }
.planning-field input { min-height: 38px; padding: 8px 10px; }
.planning-field textarea { min-height: 96px; padding: 10px 11px; resize: vertical; }
.planning-field.tall textarea { min-height: 210px; }
.planning-field input:focus, .planning-field textarea:focus { border-color: var(--copper-light); background: #fffdf8; box-shadow: 0 0 0 2px rgba(182,85,62,.06); }
.planning-field.busy input, .planning-field.busy textarea { border-color: #d9b7a6; }
.field-spinner { width: 7px; height: 7px; border: 1px solid rgba(182,85,62,.35); border-top-color: var(--copper); border-radius: 50%; animation: field-spin .8s linear infinite; }
@keyframes field-spin { to { transform: rotate(360deg); } }
</style>
