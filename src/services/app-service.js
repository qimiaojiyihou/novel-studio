import { toIpcPayload } from '../utils/ipc-payload.js'

const electronApi = window.novelStudio

export const appService = {
  creativePreferences(payload) { return electronApi.creativePreferences(payload) },
  upgradeCreativePack(payload) { return electronApi.upgradeCreativePack(payload) },
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
  exportProjectFile(payload) {
    return electronApi.exportProjectFile(payload)
  },
  importProjectFile() {
    return electronApi.importProjectFile()
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
  createCharacterRelationship(payload) {
    return electronApi.createCharacterRelationship(payload)
  },
  updateCharacterRelationship(payload) {
    return electronApi.updateCharacterRelationship(payload)
  },
  deleteCharacterRelationship(id) {
    return electronApi.deleteCharacterRelationship(id)
  },
  createStoryArc(payload) {
    return electronApi.createStoryArc(payload)
  },
  updateStoryArc(payload) {
    return electronApi.updateStoryArc(payload)
  },
  deleteStoryArc(id) {
    return electronApi.deleteStoryArc(id)
  },
  createStoryArcBeat(payload) {
    return electronApi.createStoryArcBeat(payload)
  },
  updateStoryArcBeat(payload) {
    return electronApi.updateStoryArcBeat(payload)
  },
  deleteStoryArcBeat(id) {
    return electronApi.deleteStoryArcBeat(id)
  },
  createPlanningCandidate(payload) {
    return electronApi.createPlanningCandidate(payload)
  },
  resolvePlanningCandidate(payload) {
    return electronApi.resolvePlanningCandidate(payload)
  },
  createStoryChangeSet(payload) {
    return electronApi.createStoryChangeSet(toIpcPayload(payload, '设定联动修改'))
  },
  getStoryChangeSet(id) {
    return electronApi.getStoryChangeSet(id)
  },
  listStoryChangeSets(payload) {
    return electronApi.listStoryChangeSets(payload)
  },
  updateStoryChangeSelection(payload) {
    return electronApi.updateStoryChangeSelection(payload)
  },
  applyStoryChangeSet(payload) {
    return electronApi.applyStoryChangeSet(payload)
  },
  revertStoryChangeSet(id) {
    return electronApi.revertStoryChangeSet(id)
  },
  cancelStoryChangeSet(id) {
    return electronApi.cancelStoryChangeSet(id)
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
  updateKnowledgeItemCandidate(payload) {
    return electronApi.updateKnowledgeItemCandidate(payload)
  },
  resolveKnowledgeItemCandidate(payload) {
    return electronApi.resolveKnowledgeItemCandidate(payload)
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
    return electronApi.saveModelProfile(toIpcPayload(profile, '模型配置'))
  },
  testModelProfile(profile) {
    return electronApi.testModelProfile(toIpcPayload(profile, '模型连接测试'))
  },
  deleteModelProfile(id) {
    return electronApi.deleteModelProfile(id)
  },
  updateTaskRoute(payload) {
    return electronApi.updateTaskRoute(payload)
  },
  getCodexStatus() {
    return electronApi.getCodexStatus()
  },
  saveCodexSettings(payload) {
    return electronApi.saveCodexSettings(toIpcPayload(payload, 'Codex Agent 设置'))
  },
  startCodexAuth(methodId) {
    return electronApi.startCodexAuth(methodId)
  },
  cancelCodexAuth() {
    return electronApi.cancelCodexAuth()
  },
  testCodex(payload) {
    return electronApi.testCodex(payload)
  },
  getCodexModels(payload) { return electronApi.getCodexModels(payload) },
  listStyleSamples(payload) { return electronApi.listStyleSamples(payload) },
  saveStyleSample(payload) { return electronApi.saveStyleSample(payload) },
  listProtections(payload) { return electronApi.listProtections(payload) },
  protectText(payload) { return electronApi.protectText(payload) },
  startChapterFinalization(payload) { return electronApi.startChapterFinalization(payload) },
  getChapterFinalization(payload) { return electronApi.getChapterFinalization(payload) },
  confirmChapterFinalization(payload) { return electronApi.confirmChapterFinalization(payload) },
  previewChapterAmendment(payload) { return electronApi.previewChapterAmendment(payload) },
  confirmChapterAmendment(payload) { return electronApi.confirmChapterAmendment(payload) },
  previewManualFinalization(payload) { return electronApi.previewManualFinalization(payload) },
  confirmManualFinalization(payload) { return electronApi.confirmManualFinalization(payload) },
  restartCodexAdapter() {
    return electronApi.restartCodexAdapter()
  },
  openCodexProject(projectId) {
    return electronApi.openCodexProject(projectId)
  },
  getSessionModelApproval(projectId) {
    return electronApi.getSessionModelApproval(projectId)
  },
  setSessionModelApproval(payload) {
    return electronApi.setSessionModelApproval(payload)
  },
  startAgent(payload) {
    return electronApi.startAgent(payload)
  },
  startInlineAgent(payload) {
    return electronApi.startInlineAgent(toIpcPayload(payload, 'Codex 就地创作任务'))
  },
  continueInlineAgent(payload) {
    return electronApi.continueInlineAgent(toIpcPayload(payload, 'Codex 候选修改'))
  },
  finishInlineAgent(runId) {
    return electronApi.finishInlineAgent(runId)
  },
  listAgentRuns(payload) {
    return electronApi.listAgentRuns(payload)
  },
  getAgentRun(runId) {
    return electronApi.getAgentRun(runId)
  },
  pauseAgentRun(runId) {
    return electronApi.pauseAgentRun(runId)
  },
  resumeAgentRun(runId) {
    return electronApi.resumeAgentRun(runId)
  },
  cancelAgentRun(runId) {
    return electronApi.cancelAgentRun(runId)
  },
  confirmAgentCandidate(payload) {
    return electronApi.confirmAgentCandidate(toIpcPayload(payload, 'Agent 候选确认'))
  },
  rejectAgentCandidate(payload) {
    return electronApi.rejectAgentCandidate(toIpcPayload(payload, 'Agent 候选放弃'))
  },
  retryAgentStep(payload) {
    return electronApi.retryAgentStep(payload)
  },
  listAgentEvents(payload) {
    return electronApi.listAgentEvents(payload)
  },
  listApprovals(payload) {
    return electronApi.listApprovals(payload)
  },
  getApproval(id) {
    return electronApi.getApproval(id)
  },
  resolveApproval(payload) {
    return electronApi.resolveApproval(payload)
  },
  onAgentEvent(callback) {
    return electronApi.onAgentEvent(callback)
  },
  onCodexEvent(callback) {
    return electronApi.onCodexEvent(callback)
  },
  onApprovalEvent(callback) {
    return electronApi.onApprovalEvent(callback)
  },
  onCreativeChange(callback) { return electronApi.onCreativeChange?.(callback) },
  loadWorkspaceSnapshot(projectId) { return electronApi.loadWorkspaceSnapshot(projectId) },
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
  listGenerationRecords(payload) {
    return electronApi.listGenerationRecords(payload)
  },
  qualityPreflight(payload) {
    return electronApi.qualityPreflight(payload)
  },
  listQualityReports(payload) {
    return electronApi.listQualityReports(payload)
  },
  getQualityReport(reportId) {
    return electronApi.getQualityReport(reportId)
  },
  getBlindQualityReviewPacket(reportId) {
    return electronApi.getBlindQualityReviewPacket(reportId)
  },
  reviewQuality(payload) {
    return electronApi.reviewQuality(payload)
  },
  repairQuality(payload) {
    return electronApi.repairQuality(payload)
  },
  saveHumanReview(payload) {
    return electronApi.saveHumanReview(payload)
  },
  startBenchmark(payload) {
    return electronApi.startBenchmark(payload)
  },
  listBenchmarkRuns(payload) {
    return electronApi.listBenchmarkRuns(payload)
  },
  getBenchmarkRun(runId) {
    return electronApi.getBenchmarkRun(runId)
  },
  pauseBenchmark(runId) {
    return electronApi.pauseBenchmark(runId)
  },
  resumeBenchmark(runId) {
    return electronApi.resumeBenchmark(runId)
  },
  cancelBenchmark(runId) {
    return electronApi.cancelBenchmark(runId)
  },
  onBenchmarkEvent(callback) {
    return electronApi.onBenchmarkEvent(callback)
  },
  retryGeneration(recordId, onEvent = () => {}) {
    const taskId = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const unsubscribe = electronApi.onGenerationEvent((event) => {
      if (event?.taskId === taskId) onEvent(event)
    })
    const promise = electronApi.retryGeneration({ recordId, taskId })
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
