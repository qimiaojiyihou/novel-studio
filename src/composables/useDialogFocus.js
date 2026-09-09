import { nextTick, onBeforeUnmount, onMounted } from 'vue'

// Keep keyboard interaction in the active dialog, then return to its opener.
export function useDialogFocus(panel, onClose) {
  let opener, disposed = false
  const focusable = () => [...(panel.value?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') || [])]
    .filter(element => element.getClientRects().length && element.tabIndex >= 0)
  function onKeydown(event) {
    if (event.defaultPrevented || !panel.value) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = focusable(), first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); panel.value.focus(); return }
    if (!panel.value.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus()
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  onMounted(async () => {
    opener = document.activeElement
    await nextTick()
    if (disposed) return
    focusable()[0]?.focus()
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    disposed = true
    document.removeEventListener('keydown', onKeydown)
    if (opener?.isConnected) opener.focus()
  })
}
