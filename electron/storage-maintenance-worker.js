import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { compactCompletedEventBatch, compactRequestReceipts } from './storage-maintenance.js'

const database = new DatabaseSync(workerData.databasePath)
try {
  database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000')
  const receipts = compactRequestReceipts(database, { limit: 10 })
  const events = compactCompletedEventBatch(database, { limit: 1000 })
  parentPort.postMessage({ ok: true, receipts, events })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message })
} finally {
  database.close()
}
