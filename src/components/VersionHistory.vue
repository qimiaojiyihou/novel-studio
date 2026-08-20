<template>
  <div v-if="visible" class="version-backdrop" @mousedown.self="$emit('close')">
    <aside class="version-drawer" role="dialog" aria-modal="true" aria-label="版本历史">
      <header class="version-header">
        <div>
          <span class="eyebrow copper">REVISION ARCHIVE</span>
          <h2>版本历史</h2>
          <p>{{ chapterTitle }} · 恢复前会自动保存当前正文</p>
        </div>
        <button class="version-close" :disabled="restoring" @click="$emit('close')">×</button>
      </header>

      <div v-if="loading" class="version-loading">正在整理版本档案…</div>
      <div v-else-if="!revisions.length" class="version-empty">
        <span>还没有保存过版本</span>
        <p>回到正文点击“保存版本”，之后就能在这里恢复。</p>
      </div>
      <div v-else class="version-layout">
        <nav class="version-list" aria-label="历史版本">
          <button
            v-for="revision in revisions"
            :key="revision.id"
            :class="{ selected: revision.id === selectedId }"
            @click="selectedId = revision.id"
          >
            <span class="version-mark"></span>
            <strong>{{ sourceLabel(revision.source) }}</strong>
            <small>{{ formatTime(revision.createdAt) }} · {{ revision.characterCount }} 字</small>
          </button>
        </nav>
        <section v-if="selected" class="version-preview">
          <div class="version-preview-meta">
            <span>{{ sourceLabel(selected.source) }}</span>
            <small>当前正文 {{ currentContent.length }} 字 · 此版本 {{ selected.characterCount }} 字</small>
          </div>
          <pre>{{ selected.content || '（此版本正文为空）' }}</pre>
        </section>
      </div>

      <footer class="version-footer">
        <span>恢复完成后，可用自动保存的“恢复前版本”撤销本次操作。</span>
        <button :disabled="!selected || restoring" @click="$emit('restore', selected.id)">
          {{ restoring ? '正在恢复…' : '恢复此版本' }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  visible: Boolean,
  revisions: { type: Array, default: () => [] },
  chapterTitle: { type: String, default: '' },
  currentContent: { type: String, default: '' },
  loading: Boolean,
  restoring: Boolean,
})

defineEmits(['close', 'restore'])

const selectedId = ref('')
const selected = computed(() => props.revisions.find((revision) => revision.id === selectedId.value) || props.revisions[0])

watch(() => [props.visible, props.revisions], () => {
  if (props.visible && !props.revisions.some((revision) => revision.id === selectedId.value)) {
    selectedId.value = props.revisions[0]?.id || ''
  }
}, { deep: true })

function sourceLabel(source) {
  return {
    'manual-save': '手动保存',
    manual: '手动保存',
    'before-ai-generation': '正文生成前',
    'before-ai-chapter': '正文生成前',
    'before-ai-rewrite': '局部重写前',
    'ai-generation-accepted': 'AI 正文已接受',
    'ai-rewrite-accepted': '局部候选已接受',
    'before-version-restore': '版本恢复前',
  }[source] || source || '历史版本'
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>
