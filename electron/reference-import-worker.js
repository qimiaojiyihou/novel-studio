import { parentPort, workerData } from 'node:worker_threads'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseManuscript } from './manuscript-formats.js'

try {
  const info = await stat(workerData.filePath)
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('每个文件应小于10 MB，请拆分后导入')
  const buffer = await readFile(workerData.filePath)
  const ext = path.extname(workerData.filePath).toLowerCase()
  const filename = path.basename(workerData.filePath)
  const title = path.basename(filename, ext)
  let text
  if (ext === '.docx') {
    const parsed = parseManuscript(buffer, { format: 'docx', fallbackTitle: title })
    text = parsed.chapters.map(chapter => [chapter.title, chapter.manuscript].join('\n')).join('\n\n')
  } else if (['.txt', '.md', '.markdown'].includes(ext)) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(buffer)
    else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(buffer)
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
      catch { text = new TextDecoder('gb18030', { fatal: true }).decode(buffer) }
    }
  } else throw new Error('请选择TXT、Markdown或Word DOCX文件')
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim()
  if (!text || !/[\p{L}\p{N}]/u.test(text)) throw new Error('文件中没有可分析的正文')
  parentPort.postMessage({ ok: true, book: { title, filename, text } })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message })
}
