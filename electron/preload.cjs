const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('novelStudio', {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  updateProject: (patch) => ipcRenderer.invoke('project:update', patch),
  updateChapter: (patch) => ipcRenderer.invoke('chapter:update', patch),
  createRevision: (payload) => ipcRenderer.invoke('revision:create', payload),
  loadModelSettings: () => ipcRenderer.invoke('models:load'),
  saveModelProfile: (profile) => ipcRenderer.invoke('models:save', profile),
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
