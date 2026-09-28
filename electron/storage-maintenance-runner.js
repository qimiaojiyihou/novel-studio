import { Worker } from 'node:worker_threads'

export function runStorageMaintenanceBatch(databasePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./storage-maintenance-worker.js', import.meta.url), {
      workerData: { databasePath },
    })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    worker.once('message', result => finish(result.ok ? null : new Error(result.error || '书库整理失败'), result))
    worker.once('error', error => finish(error))
    worker.once('exit', code => finish(new Error(`书库整理后台任务异常退出（${code}）`)))
  })
}
