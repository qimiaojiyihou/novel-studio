const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('novelStudio', {
  creativePreferences: (payload) => ipcRenderer.invoke('creative:preferences', payload),
  upgradeCreativePack: (payload) => ipcRenderer.invoke('creative:upgrade', payload),
  listStyleSamples: (payload) => ipcRenderer.invoke('authoring:samples', payload),
  saveStyleSample: (payload) => ipcRenderer.invoke('authoring:save-sample', payload),
  listProtections: (payload) => ipcRenderer.invoke('authoring:protections', payload),
  protectText: (payload) => ipcRenderer.invoke('authoring:protect', payload),
  loadWorkspace: (projectId) => ipcRenderer.invoke('workspace:load', projectId),
  loadWorkspaceSnapshot: (projectId) => ipcRenderer.invoke('workspace:snapshot', projectId),
  onCreativeChange: (callback) => {
    const listener = (_event,payload) => callback(payload)
    ipcRenderer.on('creative:changed',listener)
    return () => ipcRenderer.removeListener('creative:changed',listener)
  },
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  updateProject: (patch) => ipcRenderer.invoke('project:update', patch),
  archiveProject: (projectId) => ipcRenderer.invoke('project:archive', projectId),
  restoreProject: (projectId) => ipcRenderer.invoke('project:restore', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('project:delete', projectId),
  exportProjectFile: (payload) => ipcRenderer.invoke('project:export-file', payload),
  importProjectFile: () => ipcRenderer.invoke('project:import-file'),
  createChapter: (input) => ipcRenderer.invoke('chapter:create', input),
  updateChapter: (patch) => ipcRenderer.invoke('chapter:update', patch),
  reorderChapters: (input) => ipcRenderer.invoke('chapters:reorder', input),
  duplicateChapter: (chapterId) => ipcRenderer.invoke('chapter:duplicate', chapterId),
  deleteChapter: (chapterId) => ipcRenderer.invoke('chapter:delete', chapterId),
  createRevision: (payload) => ipcRenderer.invoke('revision:create', payload),
  listRevisions: (chapterId) => ipcRenderer.invoke('revisions:list', chapterId),
  restoreRevision: (payload) => ipcRenderer.invoke('revision:restore', payload),
  loadPlanningCenter: (projectId) => ipcRenderer.invoke('planning:load', projectId),
  savePlanningDocument: (payload) => ipcRenderer.invoke('planning:document-save', payload),
  createPlanningEntity: (payload) => ipcRenderer.invoke('planning:entity-create', payload),
  updatePlanningEntity: (payload) => ipcRenderer.invoke('planning:entity-update', payload),
  reorderPlanningEntities: (payload) => ipcRenderer.invoke('planning:entities-reorder', payload),
  deletePlanningEntity: (entityId) => ipcRenderer.invoke('planning:entity-delete', entityId),
  createCharacterRelationship: (payload) => ipcRenderer.invoke('planning:relationship-create', payload),
  updateCharacterRelationship: (payload) => ipcRenderer.invoke('planning:relationship-update', payload),
  deleteCharacterRelationship: (id) => ipcRenderer.invoke('planning:relationship-delete', id),
  createStoryArc: (payload) => ipcRenderer.invoke('planning:arc-create', payload),
  updateStoryArc: (payload) => ipcRenderer.invoke('planning:arc-update', payload),
  deleteStoryArc: (id) => ipcRenderer.invoke('planning:arc-delete', id),
  createStoryArcBeat: (payload) => ipcRenderer.invoke('planning:arc-beat-create', payload),
  updateStoryArcBeat: (payload) => ipcRenderer.invoke('planning:arc-beat-update', payload),
  deleteStoryArcBeat: (id) => ipcRenderer.invoke('planning:arc-beat-delete', id),
  createPlanningCandidate: (payload) => ipcRenderer.invoke('planning:candidate-create', payload),
  resolvePlanningCandidate: (payload) => ipcRenderer.invoke('planning:candidate-resolve', payload),
  createStoryChangeSet: (payload) => ipcRenderer.invoke('story-change:create', payload),
  getStoryChangeSet: (id) => ipcRenderer.invoke('story-change:get', id),
  listStoryChangeSets: (payload) => ipcRenderer.invoke('story-change:list', payload),
  updateStoryChangeSelection: (payload) => ipcRenderer.invoke('story-change:selection', payload),
  applyStoryChangeSet: (payload) => ipcRenderer.invoke('story-change:apply', payload),
  revertStoryChangeSet: (id) => ipcRenderer.invoke('story-change:revert', id),
  cancelStoryChangeSet: (id) => ipcRenderer.invoke('story-change:cancel', id),
  loadKnowledgeCenter: (projectId) => ipcRenderer.invoke('knowledge:load', projectId),
  syncKnowledgeSources: (projectId) => ipcRenderer.invoke('knowledge:sync', projectId),
  refreshContinuityChecks: (projectId) => ipcRenderer.invoke('knowledge:checks-refresh', projectId),
  createKnowledgeItem: (payload) => ipcRenderer.invoke('knowledge:item-create', payload),
  updateKnowledgeItem: (payload) => ipcRenderer.invoke('knowledge:item-update', payload),
  reorderKnowledgeItems: (payload) => ipcRenderer.invoke('knowledge:items-reorder', payload),
  deleteKnowledgeItem: (itemId) => ipcRenderer.invoke('knowledge:item-delete', itemId),
  resolveContinuityCheck: (payload) => ipcRenderer.invoke('knowledge:check-resolve', payload),
  createKnowledgeCandidate: (payload) => ipcRenderer.invoke('knowledge:candidate-create', payload),
  resolveKnowledgeCandidate: (payload) => ipcRenderer.invoke('knowledge:candidate-resolve', payload),
  updateKnowledgeItemCandidate: (payload) => ipcRenderer.invoke('knowledge:item-candidate-update', payload),
  resolveKnowledgeItemCandidate: (payload) => ipcRenderer.invoke('knowledge:item-candidate-resolve', payload),
  loadContextManager: (projectId) => ipcRenderer.invoke('context:load', projectId),
  updateContextProfile: (payload) => ipcRenderer.invoke('context:update', payload),
  rebuildContextMemories: (projectId) => ipcRenderer.invoke('context:rebuild', projectId),
  loadPromptCenter: (projectId) => ipcRenderer.invoke('prompts:load', projectId),
  savePromptTemplate: (payload) => ipcRenderer.invoke('prompts:template-save', payload),
  bindPromptTemplate: (payload) => ipcRenderer.invoke('prompts:template-bind', payload),
  saveStyleProfile: (payload) => ipcRenderer.invoke('prompts:style-save', payload),
  savePromptAddon: (payload) => ipcRenderer.invoke('prompts:addon-save', payload),
  setPromptAddonBinding: (payload) => ipcRenderer.invoke('prompts:addon-bind', payload),
  previewPrompt: (payload) => ipcRenderer.invoke('prompts:preview', payload),
  loadModelSettings: () => ipcRenderer.invoke('models:load'),
  saveModelProfile: (profile) => ipcRenderer.invoke('models:save', profile),
  testModelProfile: (profile) => ipcRenderer.invoke('models:test', profile),
  deleteModelProfile: (id) => ipcRenderer.invoke('models:delete', id),
  updateTaskRoute: (payload) => ipcRenderer.invoke('models:route', payload),
  getCodexStatus: () => ipcRenderer.invoke('codex:status'),
  saveCodexSettings: (payload) => ipcRenderer.invoke('codex:settings-save', payload),
  startCodexAuth: (methodId) => ipcRenderer.invoke('codex:start-auth', methodId),
  cancelCodexAuth: () => ipcRenderer.invoke('codex:cancel-auth'),
  testCodex: (payload) => ipcRenderer.invoke('codex:test', payload),
  getCodexModels: (payload) => ipcRenderer.invoke('codex:models', payload),
  startChapterFinalization: (payload) => ipcRenderer.invoke('chapter:finalize-start', payload),
  getChapterFinalization: (payload) => ipcRenderer.invoke('chapter:finalize-get', payload),
  confirmChapterFinalization: (payload) => ipcRenderer.invoke('chapter:finalize-confirm', payload),
  previewChapterAmendment: (payload) => ipcRenderer.invoke('chapter:amendment-preview', payload),
  confirmChapterAmendment: (payload) => ipcRenderer.invoke('chapter:amendment-confirm', payload),
  previewManualFinalization: (payload) => ipcRenderer.invoke('chapter:manual-preview', payload),
  confirmManualFinalization: (payload) => ipcRenderer.invoke('chapter:manual-confirm', payload),
  restartCodexAdapter: () => ipcRenderer.invoke('codex:restart-adapter'),
  openCodexProject: (projectId) => ipcRenderer.invoke('codex:open-project', projectId),
  getWorkDesignSync: (projectId) => ipcRenderer.invoke('work-design:state', projectId),
  bindWorkDesignSync: (payload) => ipcRenderer.invoke('work-design:bind', payload),
  getWorkDesignPrompt: (projectId) => ipcRenderer.invoke('work-design:prompt', projectId),
  previewWorkDesignPackage: (payload) => ipcRenderer.invoke('work-design:preview', payload),
  applyWorkDesignPackage: (payload) => ipcRenderer.invoke('work-design:apply', payload),
  getSessionModelApproval: (projectId) => ipcRenderer.invoke('approvals:session-model-policy', { projectId }),
  setSessionModelApproval: (payload) => ipcRenderer.invoke('approvals:session-model-policy', payload),
  startAgent: (payload) => ipcRenderer.invoke('agent:start', payload),
  startInlineAgent: (payload) => ipcRenderer.invoke('agent:start-inline', payload),
  continueInlineAgent: (payload) => ipcRenderer.invoke('agent:continue-inline', payload),
  finishInlineAgent: (runId) => ipcRenderer.invoke('agent:finish-inline', runId),
  listAgentRuns: (payload) => ipcRenderer.invoke('agent:list', payload),
  getAgentRun: (runId) => ipcRenderer.invoke('agent:get', runId),
  pauseAgentRun: (runId) => ipcRenderer.invoke('agent:pause', runId),
  resumeAgentRun: (runId) => ipcRenderer.invoke('agent:resume', runId),
  cancelAgentRun: (runId) => ipcRenderer.invoke('agent:cancel', runId),
  confirmAgentCandidate: (payload) => ipcRenderer.invoke('agent:confirm-candidate', payload),
  rejectAgentCandidate: (payload) => ipcRenderer.invoke('agent:reject-candidate', payload),
  retryAgentStep: (payload) => ipcRenderer.invoke('agent:retry-step', payload),
  listAgentEvents: (payload) => ipcRenderer.invoke('agent:events', payload),
  listApprovals: (payload) => ipcRenderer.invoke('approvals:list', payload),
  getApproval: (id) => ipcRenderer.invoke('approvals:get', id),
  resolveApproval: (payload) => ipcRenderer.invoke('approvals:resolve', payload),
  startGeneration: async (payload) => {
    const result = await ipcRenderer.invoke('generation:start', payload)
    if (result?.cancelled) {
      const error = new Error('生成任务已取消')
      error.name = 'GenerationCancelledError'
      throw error
    }
    return result
  },
  listGenerationRecords: (payload) => ipcRenderer.invoke('generation:list', payload),
  retryGeneration: async (payload) => {
    const result = await ipcRenderer.invoke('generation:retry', payload)
    if (result?.cancelled) {
      const error = new Error('生成任务已取消')
      error.name = 'GenerationCancelledError'
      throw error
    }
    return result
  },
  cancelGeneration: (taskId) => ipcRenderer.invoke('generation:cancel', taskId),
  qualityPreflight: (payload) => ipcRenderer.invoke('quality:preflight', payload),
  listQualityReports: (payload) => ipcRenderer.invoke('quality:list', payload),
  getQualityReport: (reportId) => ipcRenderer.invoke('quality:get', reportId),
  getBlindQualityReviewPacket: (reportId) => ipcRenderer.invoke('quality:blind-packet', reportId),
  reviewQuality: (payload) => ipcRenderer.invoke('quality:review', payload),
  repairQuality: (payload) => ipcRenderer.invoke('quality:repair', payload),
  saveHumanReview: (payload) => ipcRenderer.invoke('quality:human-review', payload),
  startBenchmark: (payload) => ipcRenderer.invoke('benchmark:start', payload),
  listBenchmarkRuns: (payload) => ipcRenderer.invoke('benchmark:list', payload),
  getBenchmarkRun: (runId) => ipcRenderer.invoke('benchmark:get', runId),
  pauseBenchmark: (runId) => ipcRenderer.invoke('benchmark:pause', runId),
  resumeBenchmark: (runId) => ipcRenderer.invoke('benchmark:resume', runId),
  cancelBenchmark: (runId) => ipcRenderer.invoke('benchmark:cancel', runId),
  onBenchmarkEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('benchmark:event', listener)
    return () => ipcRenderer.removeListener('benchmark:event', listener)
  },
  onGenerationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('generation:event', listener)
    return () => ipcRenderer.removeListener('generation:event', listener)
  },
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onCodexEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('codex:event', listener)
    return () => ipcRenderer.removeListener('codex:event', listener)
  },
  onApprovalEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('approvals:event', listener)
    return () => ipcRenderer.removeListener('approvals:event', listener)
  },
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
  onRuntimeInfo: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:changed', listener)
    return () => ipcRenderer.removeListener('runtime:changed', listener)
  },
  onCloseRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window:close-requested', listener)
    return () => ipcRenderer.removeListener('window:close-requested', listener)
  },
  respondToClose: (payload) => ipcRenderer.send('window:close-response', payload),
})
