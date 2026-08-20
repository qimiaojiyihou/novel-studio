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
  generateMock(payload) {
    return electronApi.generateMock(payload)
  },
  getRuntimeInfo() {
    return electronApi.getRuntimeInfo()
  },
  onCloseRequest(callback) {
    return electronApi.onCloseRequest(callback)
  },
  respondToClose(payload) {
    return electronApi.respondToClose(payload)
  },
}
