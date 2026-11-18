import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { cleanAutomaticTaskHistory } from './automatic-history-cleanup.js'

const database = new DatabaseSync(workerData.databasePath, { readOnly: true })
try {
  database.exec('PRAGMA busy_timeout=1000')
  const result = await cleanAutomaticTaskHistory(database, workerData)
  parentPort.postMessage({ ok: true, ...result })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message })
} finally {
  database.close()
}
