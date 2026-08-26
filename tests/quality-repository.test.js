import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createQualityRepository } from '../electron/quality-repository.js'
import { createWorkspaceRepository } from '../electron/workspace-repository.js'
import { createProjectBackup } from '../electron/project-portability.js'

const NOW = '2026-08-24T15:00:00.000Z'
const scores = { planningAdherence: 4, causalProgression: 4, sceneProgression: 4, continuity: 4, characterAgencyVoice: 4, suspenseEnding: 4, proseNaturalness: 4 }

function setup() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database, { now: () => NOW })
  let id = 0
  const repository = createQualityRepository(database, { now: () => NOW, createId: (prefix) => `${prefix}-${++id}` })
  database.prepare(`INSERT INTO model_profiles
    (id, provider, name, base_url, model, api_key_cipher, enabled, created_at, updated_at, settings_json)
    VALUES ('model-1', 'deepseek', 'DeepSeek', 'https://api.example.test/v1', 'deepseek-chat', 'cipher', 1, ?, ?, '{}')`).run(NOW, NOW)
  return { database, repository }
}

function insertGeneration(database, { id, projectId, chapterId }) {
  database.prepare(`INSERT INTO generation_records (
    id, task_id, project_id, chapter_id, task, status, model_profile_id, model_json,
    prompt_template_id, prompt_template_version, prompt_snapshot_json, parameters_json,
    output_text, error, created_at, completed_at, request_json, retry_of_id, attempt_count, events_json,
    generation_intent, parent_generation_id
  ) VALUES (?, ?, ?, ?, 'chapter', 'completed', 'model-1', '{}', 'builtin-chapter-v1', 3, '{}', '{}', ?, '', ?, ?, '{}', NULL, 1, '[]', 'draft', NULL)`)
    .run(id, `task-${id}`, projectId, chapterId, '足够长的正文候选。'.repeat(30), NOW, NOW)
}

test('quality reports preserve automatic and human verdicts', () => {
  const { database, repository } = setup()
  database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('project-1', '项目', '悬疑', '追查病历', '', NOW, NOW)
  database.prepare(`INSERT INTO chapters
    (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '第一章', 'draft', '{}', '', '', ?)`)
    .run(NOW)
  insertGeneration(database, { id: 'generation-1', projectId: 'project-1', chapterId: 'chapter-1' })
  const report = repository.createReport({
    generationRecordId: 'generation-1', deterministicChecks: [{ id: 'critical', critical: true, passed: true }],
    reviewerProfileId: 'model-1', modelReview: { scores, issues: [], summary: '首稿达到自动门槛' }, execution: 'remote',
  })
  assert.equal(report.sameModelReview, true)
  assert.equal(report.aggregate.automaticPassed, true)
  assert.equal(report.aggregate.finalPassed, false)
  const blind = repository.getBlindReviewPacket(report.id)
  assert.match(blind.candidate, /正文候选/)
  assert.equal('model' in blind, false)
  assert.equal('aggregate' in blind, false)
  const reviewed = repository.addHumanReview({ reportId: report.id, scores, notes: '盲评通过' })
  assert.equal(reviewed.aggregate.finalPassed, true)
  assert.equal(reviewed.aggregate.verdict, 'pass_first_try')
  database.close()
})

test('benchmark workspace stays hidden and human review recomputes the run verdict', () => {
  const { database, repository } = setup()
  const run = repository.createBenchmarkRun({ generatorProfileId: 'model-1', reviewerProfileId: 'model-1' })
  assert.equal(database.prepare('SELECT project_type FROM projects WHERE id = ?').get(run.projectId).project_type, 'benchmark')
  assert.equal(createWorkspaceRepository(database).listProjects().some((project) => project.id === run.projectId), false)
  assert.throws(() => createProjectBackup(database, run.projectId), /基准工作区/)
  const chapterId = database.prepare('SELECT id FROM chapters WHERE project_id = ? ORDER BY chapter_no LIMIT 1').get(run.projectId).id
  insertGeneration(database, { id: 'benchmark-generation', projectId: run.projectId, chapterId })
  const report = repository.createReport({
    generationRecordId: 'benchmark-generation', deterministicChecks: [{ id: 'critical', critical: true, passed: true }],
    modelReview: { scores, issues: [], summary: '自动评审通过' }, execution: 'remote',
  })
  const step = repository.startBenchmarkStep({ runId: run.id, stepKey: 'chapter-1-quality', task: 'quality_review' })
  repository.finishBenchmarkStep(step.id, { generationRecordId: 'benchmark-generation', qualityReportId: report.id, output: report })
  repository.updateBenchmarkRun(run.id, { status: 'completed', summary: { reportIds: [report.id], automaticPassed: true, finalPassed: false, verdict: 'awaiting_human_review', execution: 'remote' } })
  repository.addHumanReview({ reportId: report.id, scores, notes: '人工通过' })
  assert.equal(repository.getBenchmarkRun(run.id).summary.finalPassed, true)
  assert.equal(repository.getBenchmarkRun(run.id).summary.verdict, 'pass')

  database.prepare('DELETE FROM projects WHERE id = ?').run(run.projectId)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM benchmark_runs').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quality_reports').get().count, 0)
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()
})
