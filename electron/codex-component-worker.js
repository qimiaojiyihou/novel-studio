import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import { prepareCodexComponent } from './codex-component-download.js'

try {
  if (workerData.directory) fs.mkdirSync(workerData.directory, { recursive: true, mode: 0o700 })
  const result = await prepareCodexComponent(workerData, text => parentPort.postMessage({ type: 'progress', text }))
  parentPort.postMessage({ type: 'done', result })
} catch (error) { parentPort.postMessage({ type: 'error', message: error.message }) }
