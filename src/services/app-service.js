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
  loadPlanningCenter(projectId) {
    return electronApi.loadPlanningCenter(projectId)
  },
  savePlanningDocument(payload) {
    return electronApi.savePlanningDocument(payload)
  },
  createPlanningEntity(payload) {
    return electronApi.createPlanningEntity(payload)
  },
  updatePlanningEntity(payload) {
    return electronApi.updatePlanningEntity(payload)
  },
  reorderPlanningEntities(payload) {
    return electronApi.reorderPlanningEntities(payload)
  },
  deletePlanningEntity(entityId) {
    return electronApi.deletePlanningEntity(entityId)
  },
  createPlanningCandidate(payload) {
    return electronApi.createPlanningCandidate(payload)
  },
  resolvePlanningCandidate(payload) {
    return electronApi.resolvePlanningCandidate(payload)
  },
  loadKnowledgeCenter(projectId) {
    return electronApi.loadKnowledgeCenter(projectId)
  },
  syncKnowledgeSources(projectId) {
    return electronApi.syncKnowledgeSources(projectId)
  },
  refreshContinuityChecks(projectId) {
    return electronApi.refreshContinuityChecks(projectId)
  },
  createKnowledgeItem(payload) {
    return electronApi.createKnowledgeItem(payload)
  },
  updateKnowledgeItem(payload) {
    return electronApi.updateKnowledgeItem(payload)
  },
  reorderKnowledgeItems(payload) {
    return electronApi.reorderKnowledgeItems(payload)
  },
  deleteKnowledgeItem(itemId) {
    return electronApi.deleteKnowledgeItem(itemId)
  },
  resolveContinuityCheck(payload) {
    return electronApi.resolveContinuityCheck(payload)
  },
  createKnowledgeCandidate(payload) {
    return electronApi.createKnowledgeCandidate(payload)
  },
  resolveKnowledgeCandidate(payload) {
    return electronApi.resolveKnowledgeCandidate(payload)
  },
  loadContextManager(projectId) {
    return electronApi.loadContextManager(projectId)
  },
  updateContextProfile(payload) {
    return electronApi.updateContextProfile(payload)
  },
  rebuildContextMemories(projectId) {
    return electronApi.rebuildContextMemories(projectId)
  },
  loadPromptCenter(projectId) {
    return electronApi.loadPromptCenter(projectId)
  },
  savePromptTemplate(payload) {
    return electronApi.savePromptTemplate(payload)
  },
  bindPromptTemplate(payload) {
    return electronApi.bindPromptTemplate(payload)
  },
  saveStyleProfile(payload) {
    return electronApi.saveStyleProfile(payload)
  },
  savePromptAddon(payload) {
    return electronApi.savePromptAddon(payload)
  },
  setPromptAddonBinding(payload) {
    return electronApi.setPromptAddonBinding(payload)
  },
  previewPrompt(payload) {
    return electronApi.previewPrompt(payload)
  },
  loadModelSettings() {
    return electronApi.loadModelSettings()
  },
  saveModelProfile(profile) {
    return electronApi.saveModelProfile(profile)
  },
  testModelProfile(profile) {
    return electronApi.testModelProfile(profile)
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
