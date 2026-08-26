<template>
  <div class="creative-execution" :class="{ compact }">
    <button class="creative-execution-main" type="button" :disabled="disabled" @click="execute(defaultMode)">
      <span v-if="busy" class="creative-execution-spinner"></span>
      <span>{{ busy ? busyLabel : actionLabel }}</span>
      <small>{{ defaultMode === 'codex' ? 'Codex' : appModelLabel }}</small>
    </button>
    <button class="creative-execution-menu" type="button" :disabled="disabled" aria-label="选择本次执行方式" @click="open = !open">⌄</button>
    <div v-if="open" class="creative-execution-popover">
      <button type="button" @click="execute(alternateMode)">
        <strong>仅本次使用{{ alternateMode === 'codex' ? ' Codex' : '任务模型' }}</strong>
        <small>不修改项目默认方式</small>
      </button>
      <button type="button" @click="emit('edit-default'); open = false">
        <strong>修改项目默认方式</strong>
        <small>当前：{{ defaultMode === 'codex' ? 'Codex' : '应用模型路由' }}</small>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  defaultMode: { type: String, default: 'app_model' },
  appModelLabel: { type: String, default: '任务模型' },
  actionLabel: { type: String, default: '生成候选' },
  busyLabel: { type: String, default: '生成中' },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['execute', 'edit-default'])
const open = ref(false)
const alternateMode = computed(() => props.defaultMode === 'codex' ? 'app_model' : 'codex')

function execute(mode) {
  open.value = false
  emit('execute', mode)
}
</script>

<style scoped>
.creative-execution { position: relative; display: inline-flex; align-items: stretch; min-height: 38px; }
.creative-execution button { font: inherit; }
.creative-execution-main { display: flex; align-items: center; gap: 9px; padding: 0 14px; border: 1px solid #bb573d; border-right: 0; background: #bd563c; color: #fff7ef; cursor: pointer; }
.creative-execution-main small { padding-left: 9px; border-left: 1px solid rgba(255,255,255,.35); color: rgba(255,255,255,.76); font-size: 10px; letter-spacing: .06em; }
.creative-execution-menu { width: 34px; border: 1px solid #a84631; background: #a84631; color: #fff7ef; cursor: pointer; }
.creative-execution button:disabled { opacity: .52; cursor: default; }
.creative-execution-popover { position: absolute; z-index: 40; top: calc(100% + 7px); right: 0; width: 230px; padding: 6px; border: 1px solid #c9bdad; background: #faf5ec; box-shadow: 0 16px 38px rgba(23,27,30,.24); }
.creative-execution-popover button { display: block; width: 100%; padding: 10px 11px; border: 0; background: transparent; color: #283036; text-align: left; cursor: pointer; }
.creative-execution-popover button:hover { background: #eee4d5; }
.creative-execution-popover strong,.creative-execution-popover small { display: block; }
.creative-execution-popover small { margin-top: 3px; color: #7c776e; font-size: 11px; }
.compact { min-height: 29px; }
.compact .creative-execution-main { padding: 0 9px; font-size: 12px; }
.compact .creative-execution-main small { display: none; }
.compact .creative-execution-menu { width: 28px; }
.creative-execution-spinner { width: 11px; height: 11px; border: 1px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
