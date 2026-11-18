import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { indexReferenceChapters } from './reference-chapters.js'
let db
try {
  db = new DatabaseSync(workerData.databasePath, { readOnly: true })
  const input = workerData.input
  const row = db.prepare('SELECT content,chapter_index_json FROM reference_novels WHERE id=? AND project_id=?').get(input.bookId, input.projectId)
  if (!row) throw new Error('参考书不属于当前作品或已移除')
  const storedIndex = JSON.parse(row.chapter_index_json)
  const chapters = storedIndex.length ? storedIndex : indexReferenceChapters(row.content)
  let value
  if (input.chapter === undefined) {
    const query = String(input.query || '').trim().toLowerCase()
    const matches = chapters.map((chapter, index) => ({ index, title: chapter.title, length: chapter.end - chapter.start }))
      .filter(chapter => !query || chapter.title.toLowerCase().includes(query) || String(chapter.index + 1) === query)
    const pageCount = Math.max(1, Math.ceil(matches.length / 50))
    const page = Math.min(Math.max(0, Number(input.page) || 0), pageCount - 1)
    value = { chapters: matches.slice(page * 50, page * 50 + 50), count: matches.length, page, pageCount }
  } else {
    const chapter = chapters[Number(input.chapter)]
    if (!chapter) throw new Error('章节不存在，请重新选择')
    const length = chapter.end - chapter.start
    const offset = Math.max(0, Math.min(Math.floor(Number(input.offset) || 0), Math.max(0, length - 1)))
    const text = row.content.slice(chapter.start + offset, Math.min(chapter.end, chapter.start + offset + 16000))
    value = { title: chapter.title, text, offset, length, hasNext: offset + text.length < length }
  }
  parentPort.postMessage({ ok: true, value })
} catch (error) { parentPort.postMessage({ ok: false, error: error.message }) }
finally { db?.close() }
