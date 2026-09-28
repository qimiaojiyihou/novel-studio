import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { deleteProjectOffMainThread } from '../electron/project-deletion.js'

test('background deletion removes only its book, keeps the UI loop responsive, and rejects a repeated deletion', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'novel-studio-delete-test-'))
  const databasePath = path.join(directory, 'synthetic.sqlite')
  assert.ok(databasePath.startsWith(`${tmpdir()}${path.sep}`))
  const database = new DatabaseSync(databasePath)
  try {
    runMigrations(database)
    const repository = createWorkspaceRepository(database)
    const first = repository.createProject({ title: '模拟书 A' })
    const second = repository.createProject({ title: '模拟书 B' })
    const insertedAt = '2026-09-28T00:00:00.000Z'
    const runInsert = database.prepare(`
      INSERT INTO agent_runs (id, project_id, chapter_id, workflow_id, creative_pack_id,
        creative_pack_version, creative_pack_digest, created_at, updated_at)
      VALUES (?, ?, ?, 'test', ?, ?, 'test-digest', ?, ?)
    `)
    const stepInsert = database.prepare(`
      INSERT INTO agent_steps (id, run_id, step_key, position, action, created_at, updated_at)
      VALUES (?, ?, 'test', 1, 'generate', ?, ?)
    `)
    const eventInsert = database.prepare(`
      INSERT INTO agent_events (id, agent_run_id, agent_step_id, sequence, event_type, created_at)
      VALUES (?, ?, ?, ?, 'output', ?)
    `)
    database.exec('BEGIN IMMEDIATE')
    for (const [book, label, count] of [[first, 'a', 12000], [second, 'b', 3000]]) {
      const binding = database.prepare('SELECT pack_id, pack_version FROM project_pack_bindings WHERE project_id = ?').get(book.project.id)
      runInsert.run(`run-${label}`, book.project.id, book.chapters[0].id, binding.pack_id, binding.pack_version, insertedAt, insertedAt)
      stepInsert.run(`step-${label}`, `run-${label}`, insertedAt, insertedAt)
      for (let sequence = 1; sequence <= count; sequence++) {
        eventInsert.run(`event-${label}-${sequence}`, `run-${label}`, `step-${label}`, sequence, insertedAt)
      }
    }
    database.exec('COMMIT')

    let ticks = 0
    const heartbeat = setInterval(() => { ticks++ }, 1)
    try {
      await deleteProjectOffMainThread({ databasePath, projectId: first.project.id })
    } finally {
      clearInterval(heartbeat)
    }
    assert.ok(ticks > 0, 'deletion should leave the caller event loop responsive')
    assert.equal(repository.listProjects().length, 1)
    assert.equal(repository.loadWorkspace().project.id, second.project.id)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM agent_events').get().n, 3000)
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(deleteProjectOffMainThread({ databasePath, projectId: first.project.id }), /项目不存在/)
    await assert.rejects(deleteProjectOffMainThread({ databasePath, projectId: second.project.id }), /至少保留一个未归档项目/)
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM agent_events').get().n, 3000)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
