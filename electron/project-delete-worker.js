import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { createWorkspaceRepository } from './workspace-repository.js'

let database
let result
try {
  database = new DatabaseSync(workerData.databasePath)
  database.exec('PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON;')
  createWorkspaceRepository(database).deleteProject(workerData.projectId, { returnWorkspace: false })
  result = { ok: true }
} catch (error) {
  result = { ok: false, error: error.message }
} finally {
  try { database?.close() }
  catch (error) { result = { ok: false, error: `书库连接关闭失败：${error.message}` } }
  parentPort.postMessage(result)
}
