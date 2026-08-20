const electronApi = window.novelStudio

export const appService = {
  loadWorkspace() {
    return electronApi.loadWorkspace()
  },
  updateProject(patch) {
    return electronApi.updateProject(patch)
  },
  updateChapter(patch) {
    return electronApi.updateChapter(patch)
  },
  createRevision(payload) {
    return electronApi.createRevision(payload)
  },
  loadModelSettings() {
    return electronApi.loadModelSettings()
  },
  saveModelProfile(profile) {
    return electronApi.saveModelProfile(profile)
  },
  deleteModelProfile(id) {
    return electronApi.deleteModelProfile(id)
  },
  updateTaskRoute(payload) {
    return electronApi.updateTaskRoute(payload)
  },
  startGeneration(payload, onEvent = () => {}) {
    const taskId = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const unsubscribe = electronApi.onGenerationEvent((event) => {
      if (event?.taskId === taskId) onEvent(event)
    })
    const promise = electronApi.startGeneration({ ...payload, taskId })
      .finally(unsubscribe)
    return {
      taskId,
      promise,
      cancel: () => electronApi.cancelGeneration(taskId),
    }
  },
  getRuntimeInfo() {
    return electronApi.getRuntimeInfo()
  },
  onRuntimeInfo(callback) {
    return electronApi.onRuntimeInfo(callback)
  },
  onCloseRequest(callback) {
    return electronApi.onCloseRequest(callback)
  },
  respondToClose(payload) {
    return electronApi.respondToClose(payload)
  },
}
