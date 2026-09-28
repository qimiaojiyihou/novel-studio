import { Worker } from 'node:worker_threads'

export function deleteProjectOffMainThread({ databasePath, projectId }) {
  if (!databasePath || !projectId) return Promise.reject(new Error('缺少书库路径或项目 ID'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./project-delete-worker.js', import.meta.url), {
      workerData: { databasePath, projectId },
    })
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    worker.once('message', (result) => finish(result.ok ? null : new Error(result.error || '删除书籍失败')))
    worker.once('error', finish)
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error(`删除书籍的后台任务异常退出（${code}）`))
      else finish(new Error('删除书籍的后台任务没有返回结果'))
    })
  })
}
