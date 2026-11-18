import { ref } from 'vue'

export function useInlineRunSelection() {
  const runId = ref(''), status = ref(''), run = ref(null), panelOpen = ref(false)
  function clear() {
    runId.value = ''; status.value = ''; run.value = null; panelOpen.value = false
  }
  function syncProject(projectId) {
    // Completion ends execution, not access to the persisted candidates.
    if (run.value?.projectId !== projectId) clear()
  }
  function update(next, projectId) {
    if (!next?.id || next.projectId !== projectId) return false
    runId.value = next.id; status.value = next.status; run.value = next
    return true
  }
  return { runId, status, run, panelOpen, clear, syncProject, update }
}
