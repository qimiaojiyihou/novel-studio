import { Worker } from 'node:worker_threads'

function runReferenceWorker(file, workerData, resultKey) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(file, import.meta.url), { workerData })
    let settled = false
    const finish = (error, book) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) { void worker.terminate(); reject(error) }
      else resolve(book)
    }
    const timer = setTimeout(() => finish(new Error('参考小说读取超时，请拆分文件后重试')), 30000)
    worker.once('message', result => finish(result.ok ? null : new Error(result.error), result[resultKey]))
    worker.once('error', error => finish(error))
    worker.once('exit', code => { if (!settled) finish(new Error(`参考小说读取任务提前结束（${code}）`)) })
  })
}

export function readReferenceNovel(filePath) {
  return runReferenceWorker('./reference-import-worker.js', { filePath }, 'book')
}

export function browseReferenceNovel(databasePath, input) {
  return runReferenceWorker('./reference-browse-worker.js', { databasePath, input }, 'value')
}
