import { randomUUID } from 'node:crypto'
import { contentDigest } from './chapter-finalization.js'

export function createAuthoringRepository(db) {
  function project(id) { if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) throw new Error('项目不存在') }
  function source(input) {
    const row = input.candidateId
      ? db.prepare('SELECT payload_json FROM agent_candidates WHERE id = ? AND project_id = ? AND chapter_id = ?').get(input.candidateId, input.projectId, input.chapterId)
      : db.prepare('SELECT manuscript FROM chapters WHERE id = ? AND project_id = ?').get(input.chapterId, input.projectId)
    if (!row) throw new Error('原文来源不存在')
    const text = row.manuscript ?? JSON.parse(row.payload_json).manuscript
    if (typeof text !== 'string') throw new Error('请选择正文内容')
    if (input.sourceDigest && input.sourceDigest !== contentDigest(text)) throw new Error('正文来源已变化，请重新选择')
    return text
  }
  return {
    listSamples({ projectId }) { project(projectId); return db.prepare('SELECT * FROM author_style_samples WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) },
    saveSample(input) {
      project(input.projectId)
      const original = input.id ? db.prepare('SELECT * FROM author_style_samples WHERE id = ? AND project_id = ?').get(input.id, input.projectId) : null
      if (input.id && !original) throw new Error('认可片段不存在')
      if (input.action === 'delete') { db.prepare('DELETE FROM author_style_samples WHERE id = ? AND project_id = ?').run(input.id, input.projectId); return }
      const manuscript = original ? null : source(input)
      const text = String(input.text ?? original?.text ?? '').trim()
      if (!text || text.length > 6000) throw new Error('认可片段应为1—6000字')
      if (!original && !manuscript.includes(text)) throw new Error('认可片段应选自当前原文')
      const now = new Date().toISOString()
      if (original) db.prepare('UPDATE author_style_samples SET text=?, reason=?, active=?, updated_at=? WHERE id=?')
        .run(text, String(input.reason ?? original.reason), input.active === undefined ? original.active : Number(Boolean(input.active)), now, original.id)
      else {
        const revisionId = `revision-${randomUUID()}`
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('INSERT INTO revisions (id,chapter_id,content,source,created_at) VALUES (?,?,?,?,?)').run(revisionId, input.chapterId, manuscript, 'author-style-source', now)
          db.prepare(`INSERT INTO author_style_samples (id, project_id, chapter_id, revision_id, source_digest, text, reason, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(randomUUID(), input.projectId, input.chapterId, revisionId, contentDigest(manuscript), text, String(input.reason || ''), now, now)
          db.exec('COMMIT')
        } catch (error) { db.exec('ROLLBACK'); throw error }
      }
    },
    protections(input) {
      project(input.projectId)
      const digest = input.candidateId ? contentDigest(source(input)) : ''
      return db.prepare('SELECT * FROM manuscript_protections WHERE project_id = ? AND chapter_id = ? AND active = 1').all(input.projectId, input.chapterId).filter(item => !digest || item.source_digest === digest)
    },
    protect(input) {
      project(input.projectId)
      if (input.action === 'remove') { db.prepare('UPDATE manuscript_protections SET active=0 WHERE id=? AND project_id=?').run(input.id, input.projectId); return }
      const text = source(input), from = Number(input.from), to = Number(input.to)
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length) throw new Error('请选择要保留的原文范围')
      db.prepare(`INSERT INTO manuscript_protections (id, project_id, chapter_id, source_digest, start_offset, end_offset, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.projectId, input.chapterId, contentDigest(text), from, to, text.slice(from, to), new Date().toISOString())
    },
  }
}
