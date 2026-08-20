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
  generateMock: (payload) => ipcRenderer.invoke('generation:mock', payload),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
})
