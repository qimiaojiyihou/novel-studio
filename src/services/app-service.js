const electronApi = window.novelStudio

export const appService = {
  loadWorkspace(projectId) {
    return electronApi.loadWorkspace(projectId)
  },
  listProjects() {
    return electronApi.listProjects()
  },
  createProject(input) {
    return electronApi.createProject(input)
  },
  updateProject(patch) {
    return electronApi.updateProject(patch)
  },
  archiveProject(projectId) {
    return electronApi.archiveProject(projectId)
  },
  restoreProject(projectId) {
    return electronApi.restoreProject(projectId)
  },
  deleteProject(projectId) {
    return electronApi.deleteProject(projectId)
  },
  createChapter(input) {
    return electronApi.createChapter(input)
  },
  updateChapter(patch) {
    return electronApi.updateChapter(patch)
  },
  reorderChapters(input) {
    return electronApi.reorderChapters(input)
  },
  duplicateChapter(chapterId) {
    return electronApi.duplicateChapter(chapterId)
  },
  deleteChapter(chapterId) {
    return electronApi.deleteChapter(chapterId)
  },
  createRevision(payload) {
    return electronApi.createRevision(payload)
  },
  listRevisions(chapterId) {
    return electronApi.listRevisions(chapterId)
  },
  restoreRevision(payload) {
    return electronApi.restoreRevision(payload)
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
