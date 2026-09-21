<template>
  <div ref="root" class="manuscript-format-menu">
    <button
      type="button"
      class="manuscript-format-trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      :disabled="disabled"
      @click="open = !open"
    >排版</button>
    <div v-if="open" class="manuscript-format-popover" role="menu" aria-label="正文排版">
      <header><strong>正文排版</strong><small>整章处理 · 自动保留处理前版本</small></header>
      <button
        v-for="option in MANUSCRIPT_FORMAT_OPTIONS"
        :key="option.id"
        type="button"
        role="menuitem"
        @click="select(option.id)"
      >
        <span>{{ option.label }}</span>
        <small>{{ option.description }}</small>
      </button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { MANUSCRIPT_FORMAT_OPTIONS } from '../utils/manuscript-formatting.js'

defineProps({ disabled: { type: Boolean, default: false } })
const emit = defineEmits(['format'])
const root = ref(null)
const open = ref(false)

function select(action) {
  open.value = false
  emit('format', action)
}

function closeFromOutside(event) {
  if (open.value && !root.value?.contains(event.target)) open.value = false
}

function closeFromEscape(event) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', closeFromOutside)
  document.addEventListener('keydown', closeFromEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeFromOutside)
  document.removeEventListener('keydown', closeFromEscape)
})
</script>
