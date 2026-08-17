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
  generateMock(payload) {
    return electronApi.generateMock(payload)
  },
  getRuntimeInfo() {
    return electronApi.getRuntimeInfo()
  },
}
