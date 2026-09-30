import { parentPort, workerData } from 'node:worker_threads'
import { migrateStorage } from './storage-migration.js'
let lastProgress = 0
try {
  const result = await migrateStorage(workerData, { progress(message) {
    if (Date.now() - lastProgress < 250) return
    lastProgress = Date.now()
    parentPort.postMessage({ type: 'progress', message })
  } })
  parentPort.postMessage({ type: 'complete', result })
} catch (error) { parentPort.postMessage({ type: 'error', error: error.message }) }
