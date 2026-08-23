const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('novelStudio', {
  loadWorkspace: (projectId) => ipcRenderer.invoke('workspace:load', projectId),
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
  onGenerationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('generation:event', listener)
    return () => ipcRenderer.removeListener('generation:event', listener)
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
