<template>
  <div ref="root" class="creative-execution" :class="{ compact }">
    <button class="creative-execution-main" type="button" :disabled="disabled || busy" :aria-busy="busy" @click="execute(defaultMode)">
      <span v-if="busy" class="creative-execution-spinner"></span>
      <span>{{ busy ? busyLabel : actionLabel }}</span>
      <small>{{ defaultMode === 'codex' ? 'Codex' : appModelLabel }}</small>
    </button>
    <button ref="trigger" class="creative-execution-menu" type="button" :disabled="disabled || busy" aria-label="选择本次执行方式" aria-haspopup="menu" :aria-controls="menuId" :aria-expanded="open" @click="toggle" @keydown.down.prevent="showMenu" @keydown.up.prevent="showMenu(true)"><span class="creative-execution-chevron" :class="{ open }"></span></button>
    <Teleport to="body">
    <div v-if="open" :id="menuId" ref="menu" class="creative-execution-popover" role="menu" aria-label="本次创作执行方式" :style="menuStyle" @keydown="navigateMenu">
      <button type="button" role="menuitem" @click="execute(alternateMode)">
        <strong>仅本次使用{{ alternateMode === 'codex' ? ' Codex' : '任务模型' }}</strong>
        <small>不修改项目默认方式</small>
      </button>
      <button type="button" role="menuitem" @click="close(true); emit('edit-default')">
        <strong>修改项目默认方式</strong>
        <small>当前：{{ defaultMode === 'codex' ? 'Codex' : '应用模型路由' }}</small>
      </button>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { placePopover } from '../utils/ui-layout.js'

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
const root = ref(null), trigger = ref(null), menu = ref(null)
const menuId = useId()
const menuStyle = ref({})
const alternateMode = computed(() => props.defaultMode === 'codex' ? 'app_model' : 'codex')

function positionMenu() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const result = placePopover(rect, { width: 264, height: menu.value?.offsetHeight || 156 }, { width: window.innerWidth, height: window.innerHeight })
  menuStyle.value = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, `${value}px`]))
}
async function showMenu(last = false) {
  if (props.disabled || props.busy) return
  open.value = true
  positionMenu()
  await nextTick()
  positionMenu()
  const items = menu.value?.querySelectorAll('[role="menuitem"]') || []
  items[last === true ? items.length - 1 : 0]?.focus()
}
function close(restoreFocus = false) { open.value = false; if (restoreFocus) trigger.value?.focus() }
function toggle() { if (open.value) close(true); else void showMenu() }
function dismiss(event) { if (open.value && !root.value?.contains(event.target) && !menu.value?.contains(event.target)) close() }
function navigateMenu(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...menu.value.querySelectorAll('[role="menuitem"]')]
  const current = items.indexOf(document.activeElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[index]?.focus()
}
watch(() => props.disabled || props.busy, value => { if (value) close() })
onMounted(() => {
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('focusin', dismiss)
  window.addEventListener('resize', positionMenu)
  window.addEventListener('scroll', positionMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismiss, true)
  document.removeEventListener('focusin', dismiss)
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
})
function execute(mode) {
  if (props.disabled || props.busy) return
  close(open.value)
  emit('execute', mode)
}
</script>

<style scoped>
.creative-execution { position: relative; display: inline-flex; align-items: stretch; min-height: 42px; }
.creative-execution button { font: inherit; }
.creative-execution-main { display: flex; align-items: center; justify-content: center; gap: 9px; min-width: 0; padding: 0 15px; border: 1px solid var(--ns-accent, #5c8d85); border-right: 0; border-radius: 9px 0 0 9px; background: var(--ns-accent, #5c8d85); color: #f7fffd; box-shadow: 0 4px 12px rgba(65,105,98,.14); white-space: nowrap; cursor: pointer; }
.creative-execution-main:hover { border-color: var(--ns-accent-hover, #24665f); background: var(--ns-accent-hover, #24665f); }
.creative-execution-main > span:not(.creative-execution-spinner) { font-weight: 620; line-height: 1; }
.creative-execution-main small { padding-left: 9px; border-left: 1px solid rgba(255,255,255,.34); color: rgba(247,255,253,.78); font-size: 10px; line-height: 1.2; letter-spacing: .04em; }
.creative-execution-menu { position: relative; width: 38px; flex: 0 0 38px; border: 1px solid var(--ns-accent, #5c8d85); border-left-color: rgba(255,255,255,.28); border-radius: 0 9px 9px 0; background: var(--ns-accent, #5c8d85); color: #f7fffd; cursor: pointer; }
.creative-execution-menu:hover { border-color: var(--ns-accent-hover, #24665f); border-left-color: rgba(255,255,255,.3); background: var(--ns-accent-hover, #24665f); }
.creative-execution-chevron { position: absolute; top: 50%; left: 50%; width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translate(-50%, -68%) rotate(45deg); transition: transform .18s ease; }
.creative-execution-chevron.open { transform: translate(-50%, -30%) rotate(225deg); }
.creative-execution button:disabled { opacity: 1; color: #526970; background: #e3ebed; border-color: #bdcdd1; cursor: not-allowed; }
.creative-execution button:disabled small { color: #526970; border-color: #bdcdd1; }
.creative-execution-popover { position: fixed; z-index: 500; box-sizing: border-box; overflow: auto; padding: 7px; border: 1px solid var(--ns-border, #d7e0e8); border-radius: 10px; background: var(--ns-surface, #fff); box-shadow: var(--ns-shadow-md, 0 16px 38px rgba(23,27,30,.18)); font: 13px/1.5 var(--font-ui, sans-serif); }
.creative-execution-popover button { display: block; width: 100%; padding: 11px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--ns-text, #172236); text-align: left; cursor: pointer; }
.creative-execution-popover button:hover { background: var(--ns-accent-soft, #dceeea); }
.creative-execution-popover button:focus-visible { outline: 2px solid var(--ns-accent-hover); outline-offset: -2px; background: var(--ns-accent-soft); }
.creative-execution-popover strong,.creative-execution-popover small { display: block; }
.creative-execution-popover small { margin-top: 4px; color: var(--ns-text-muted, #68778b); font-size: 11px; }
.compact { min-height: 36px; }
.compact .creative-execution-main { padding: 0 11px; border-radius: 8px 0 0 8px; font-size: 12px; }
.compact .creative-execution-main small { display: none; }
.compact .creative-execution-menu { width: 34px; flex-basis: 34px; border-radius: 0 8px 8px 0; }
.creative-execution-spinner { width: 11px; height: 11px; border: 1px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
