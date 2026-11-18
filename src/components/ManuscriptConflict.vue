<template>
  <div class="manuscript-conflict-backdrop">
    <section ref="panel" class="manuscript-conflict-dialog" role="dialog" aria-modal="true" aria-label="正文版本冲突">
      <header>
        <span class="eyebrow copper">MANUSCRIPT CONFLICT</span>
        <h2>正文有两个版本</h2>
        <p>《{{ chapterTitle }}》在你编辑时被创作任务更新。请核对两份正文，再决定是否读取最新版。</p>
      </header>
      <div class="manuscript-conflict-columns">
        <label>
          <strong>当前编辑稿 · {{ localText.length }} 字</strong>
          <span>仍留在编辑器中，{{ backupReady ? '并已存入版本历史' : '尚未存入版本历史' }}</span>
          <textarea :value="localText" readonly aria-label="当前编辑稿，可选择复制" />
        </label>
        <label>
          <strong>创作任务的最新正文 · {{ latestText.length }} 字</strong>
          <span>数据库中的当前版本</span>
          <textarea :value="latestText" readonly aria-label="创作任务的最新正文，可选择复制" />
        </label>
      </div>
      <p v-if="error" class="manuscript-conflict-error" role="alert">{{ error }}</p>
      <p v-else class="manuscript-conflict-note">
        {{ backupReady ? '读取最新版后，可在“版本历史”找到“冲突时保留的编辑稿”，再手工合并。' : '正在保存当前编辑稿的备份，请稍候。' }}
      </p>
      <footer>
        <button type="button" :disabled="busy" @click="$emit('keep-editing')">继续编辑当前稿</button>
        <button type="button" class="primary" :disabled="busy || !backupReady || !latestReady" @click="$emit('load-latest')">
          {{ busy ? '正在处理…' : '读取最新正文' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useDialogFocus } from '../composables/useDialogFocus.js'

defineProps({
  chapterTitle: { type: String, default: '' },
  localText: { type: String, default: '' },
  latestText: { type: String, default: '' },
  backupReady: Boolean,
  latestReady: Boolean,
  busy: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits(['keep-editing', 'load-latest'])
const panel = ref(null)
useDialogFocus(panel, () => emit('keep-editing'))
</script>

<style scoped>
.manuscript-conflict-backdrop { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; padding: 24px; background: rgba(5, 12, 23, .7); }
.manuscript-conflict-dialog { display: grid; gap: 18px; width: min(1100px, 96vw); max-height: calc(100vh - 48px); overflow: auto; padding: 26px; color: var(--ns-text); border: 1px solid var(--ns-border); border-radius: 16px; background: var(--ns-surface); box-shadow: var(--ns-shadow-lg); }
.manuscript-conflict-dialog h2 { margin: 7px 0; font: 26px var(--font-display); }
.manuscript-conflict-dialog header p, .manuscript-conflict-note { margin: 0; color: var(--ns-text-muted); line-height: 1.6; }
.manuscript-conflict-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-height: 0; }
.manuscript-conflict-columns label { display: grid; gap: 7px; min-width: 0; }
.manuscript-conflict-columns strong { font-size: 14px; }
.manuscript-conflict-columns span { color: var(--ns-text-muted); font-size: 12px; }
.manuscript-conflict-columns textarea { box-sizing: border-box; width: 100%; min-height: 280px; height: min(45vh, 460px); resize: vertical; padding: 14px; color: var(--ns-text); border: 1px solid var(--ns-border); border-radius: 9px; background: var(--ns-surface-soft); font: 14px/1.8 var(--font-body); }
.manuscript-conflict-error { margin: 0; color: var(--ns-danger); }
.manuscript-conflict-dialog footer { display: flex; justify-content: flex-end; gap: 10px; }
.manuscript-conflict-dialog footer button { min-height: 40px; padding: 0 16px; border: 1px solid var(--ns-border); border-radius: 8px; background: var(--ns-surface); }
.manuscript-conflict-dialog footer .primary { color: white; border-color: var(--ns-accent); background: var(--ns-accent); }
.manuscript-conflict-dialog footer button:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 760px) { .manuscript-conflict-backdrop { padding: 8px; }.manuscript-conflict-dialog { max-height: calc(100vh - 16px); padding: 18px; }.manuscript-conflict-columns { grid-template-columns: 1fr; }.manuscript-conflict-columns textarea { min-height: 160px; height: 24vh; } }
</style>
