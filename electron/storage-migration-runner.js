import { Worker } from 'node:worker_threads'

export function runStorageMigration(pending, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./storage-migration-worker.js', import.meta.url), { workerData: pending })
    let settled = false
    const finish = (error, result) => { if (settled) return; settled = true; if (error) reject(error); else resolve(result) }
    worker.on('message', message => {
      if (message.type === 'progress') onProgress(message.message)
      if (message.type === 'complete') finish(null, message.result)
      if (message.type === 'error') finish(new Error(message.error))
    })
    worker.once('error', error => finish(error))
    worker.once('exit', code => finish(new Error(`书库迁移进程退出（${code}），原书库仍保留`)))
  })
}
