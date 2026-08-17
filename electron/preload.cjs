const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('novelStudio', {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  updateProject: (patch) => ipcRenderer.invoke('project:update', patch),
  updateChapter: (patch) => ipcRenderer.invoke('chapter:update', patch),
  createRevision: (payload) => ipcRenderer.invoke('revision:create', payload),
  generateMock: (payload) => ipcRenderer.invoke('generation:mock', payload),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
})
