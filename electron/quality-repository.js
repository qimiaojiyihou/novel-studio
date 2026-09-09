import { randomUUID } from 'node:crypto'
import { recordCreativeDependencies, invalidateCreativeDependencies } from './creative-context.js'
import {
  QUALITY_RUBRIC_VERSION,
  URBAN_SUSPENSE_BENCHMARK,
  aggregateQuality,
  emptyScenePlan,
  normalizeModelReview,
} from './creative-quality.js'

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function mapHumanReview(row) {
  return row ? {
    id: row.id,
    reportId: row.report_id,
    reviewerLabel: row.reviewer_label,
    scores: parseJson(row.scores_json),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapReport(row, humanReviews = []) {
  return row ? {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id || '',
    generationRecordId: row.generation_record_id,
    reviewerProfileId: row.reviewer_profile_id || '',
    rubricVersion: Number(row.rubric_version || QUALITY_RUBRIC_VERSION),
    deterministicChecks: parseJson(row.deterministic_json, []),
    modelReview: parseJson(row.model_review_json),
    aggregate: parseJson(row.aggregate_json),
    execution: row.execution,
    repaired: Boolean(row.repaired),
    humanReviews,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapRun(row) {
  return row ? {
    id: row.id,
    fixtureId: row.fixture_id,
    projectId: row.project_id,
    generatorProfileId: row.generator_profile_id || '',
    reviewerProfileId: row.reviewer_profile_id || '',
    status: row.status,
    summary: parseJson(row.summary_json),
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  } : null
}

function mapStep(row) {
  return row ? {
    id: row.id,
    runId: row.run_id,
    position: Number(row.position),
    stepKey: row.step_key,
    task: row.task,
    generationRecordId: row.generation_record_id || '',
    qualityReportId: row.quality_report_id || '',
    status: row.status,
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  } : null
}

export function createQualityRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const reportById = database.prepare('SELECT * FROM quality_reports WHERE id = ?')
  const runById = database.prepare('SELECT * FROM benchmark_runs WHERE id = ?')

  function humanReviews(reportId) {
    return database.prepare('SELECT * FROM quality_human_reviews WHERE report_id = ? ORDER BY created_at, rowid')
      .all(reportId).map(mapHumanReview)
  }

  function getReport(id) {
    let row = reportById.get(id)
    if (!row) return null
    if (database.prepare("SELECT name FROM sqlite_master WHERE name='creative_dependencies'").get()) {
      invalidateCreativeDependencies(database, row.project_id)
      row = reportById.get(id)
    }
    const report = mapReport(row, humanReviews(id))
    const source = database.prepare(`
      SELECT model_profile_id, model_json, prompt_template_id, prompt_template_version,
        generation_intent, parent_generation_id
      FROM generation_records WHERE id = ?
    `).get(row.generation_record_id)
    return {
      ...report,
      sameModelReview: Boolean(source?.model_profile_id && row.reviewer_profile_id === source.model_profile_id),
      source: source ? {
        model: parseJson(source.model_json),
        templateId: source.prompt_template_id,
        templateVersion: Number(source.prompt_template_version || 1),
        intent: source.generation_intent,
        parentGenerationId: source.parent_generation_id || '',
      } : null,
    }
  }

  function getReportByGeneration(generationRecordId) {
    const row = database.prepare('SELECT id FROM quality_reports WHERE generation_record_id = ?').get(generationRecordId)
    return row ? getReport(row.id) : null
  }

  function getBlindReviewPacket(id) {
    const report = reportById.get(id)
    if (!report) throw new Error('质量报告不存在')
    const generation = database.prepare('SELECT task, generation_intent, output_text FROM generation_records WHERE id = ?').get(report.generation_record_id)
    const chapter = report.chapter_id ? database.prepare(`
      SELECT chapter_no, title, card_json, scene_plan, scene_plan_json FROM chapters WHERE id = ?
    `).get(report.chapter_id) : null
    return {
      reportId: id,
      task: generation?.task || '',
      intent: generation?.generation_intent || 'draft',
      repaired: Boolean(report.repaired),
      candidate: generation?.output_text || '',
      chapter: chapter ? {
        chapterNo: Number(chapter.chapter_no),
        title: chapter.title,
        card: parseJson(chapter.card_json),
        scenePlan: parseJson(chapter.scene_plan_json, { legacyNotes: chapter.scene_plan || '' }),
      } : null,
    }
  }

  function recomputeReport(id) {
    const report = getReport(id)
    if (!report) throw new Error('质量报告不存在')
    const aggregate = aggregateQuality({
      deterministicChecks: report.deterministicChecks,
      modelReview: report.modelReview,
      humanReviews: report.humanReviews,
      execution: report.execution,
      repaired: report.repaired,
    })
    if (report.aggregate.stale) Object.assign(aggregate, { stale: true, staleReason: report.aggregate.staleReason, automaticPassed: false, finalPassed: false })
    database.prepare('UPDATE quality_reports SET aggregate_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(aggregate), now(), id)
    return getReport(id)
  }

  function recomputeLinkedBenchmark(reportId) {
    const linked = database.prepare('SELECT run_id FROM benchmark_steps WHERE quality_report_id = ?').get(reportId)
    if (!linked) return null
    const run = getBenchmarkRun(linked.run_id)
    if (!run) return null
    const reportIds = [...new Set(run.steps.map((step) => step.qualityReportId).filter(Boolean))]
    const reports = reportIds.map(getReport).filter(Boolean)
    if (!reports.length) return run
    const remote = reports.every((report) => report.execution === 'remote')
    const automaticPassed = remote && reports.every((report) => report.aggregate.automaticPassed)
    const hasHumanReview = reports.every((report) => report.humanReviews.length > 0)
    const finalPassed = automaticPassed && hasHumanReview && reports.every((report) => report.aggregate.finalPassed)
    const modelAverage = Number((reports.reduce((sum, report) => sum + Number(report.aggregate.modelAverage || 0), 0) / reports.length).toFixed(2))
    const humanAverage = hasHumanReview
      ? Number((reports.reduce((sum, report) => sum + Number(report.aggregate.humanAverage || 0), 0) / reports.length).toFixed(2))
      : 0
    const summary = {
      ...run.summary,
      reportIds,
      modelAverage,
      humanAverage,
      automaticPassed,
      finalPassed,
      verdict: finalPassed ? 'pass' : automaticPassed && !hasHumanReview ? 'awaiting_human_review' : 'fail',
      execution: remote ? 'remote' : 'mock',
    }
    database.prepare('UPDATE benchmark_runs SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), run.id)
    return getBenchmarkRun(run.id)
  }

  function createReport(input = {}) {
    const generation = database.prepare('SELECT * FROM generation_records WHERE id = ?').get(input.generationRecordId)
    if (!generation) throw new Error('待评审的生成记录不存在')
    const projectId = input.projectId || generation.project_id
    if (projectId !== generation.project_id) throw new Error('质量报告与生成记录不属于同一项目')
    const existing = database.prepare('SELECT id FROM quality_reports WHERE generation_record_id = ?').get(generation.id)
    if (existing) return getReport(existing.id)
    const id = createId('quality')
    const createdAt = now()
    const deterministicChecks = Array.isArray(input.deterministicChecks) ? input.deterministicChecks : []
    const modelReview = normalizeModelReview(input.modelReview)
    const execution = input.execution === 'remote' ? 'remote' : 'mock'
    const aggregate = aggregateQuality({ deterministicChecks, modelReview, execution, repaired: Boolean(input.repaired) })
    database.prepare(`
      INSERT INTO quality_reports (
        id, project_id, chapter_id, generation_record_id, reviewer_profile_id,
        rubric_version, deterministic_json, model_review_json, aggregate_json,
        execution, repaired, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.chapterId || generation.chapter_id || null,
      generation.id,
      input.reviewerProfileId || null,
      QUALITY_RUBRIC_VERSION,
      JSON.stringify(deterministicChecks),
      JSON.stringify(modelReview),
      JSON.stringify(aggregate),
      execution,
      input.repaired ? 1 : 0,
      createdAt,
      createdAt,
    )
    const sources = [...(parseJson(generation.prompt_snapshot_json).contextSources || []), ...(input.contextSources || [])]
    if (sources.length && database.prepare("SELECT name FROM sqlite_master WHERE name='creative_dependencies'").get()) {
      recordCreativeDependencies(database, { projectId, artifactKind: 'review', artifactId: id, sources })
    }
    return getReport(id)
  }

  function addHumanReview(input = {}) {
    if (!reportById.get(input.reportId)) throw new Error('质量报告不存在')
    const id = createId('human-review')
    const createdAt = now()
    database.prepare(`
      INSERT INTO quality_human_reviews (id, report_id, reviewer_label, scores_json, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.reportId,
      String(input.reviewerLabel || '人工评审').trim() || '人工评审',
      JSON.stringify(input.scores || {}),
      String(input.notes || '').trim(),
      createdAt,
      createdAt,
    )
    const report = recomputeReport(input.reportId)
    recomputeLinkedBenchmark(input.reportId)
    return report
  }

  function listReports({ projectId, chapterId = '', limit = 100 } = {}) {
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) throw new Error('项目不存在')
    const bounded = Math.max(1, Math.min(300, Number(limit || 100)))
    const rows = chapterId
      ? database.prepare('SELECT * FROM quality_reports WHERE project_id = ? AND chapter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(projectId, chapterId, bounded)
      : database.prepare('SELECT * FROM quality_reports WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(projectId, bounded)
    return rows.map((row) => getReport(row.id))
  }

  function createBenchmarkRun({ generatorProfileId = '', reviewerProfileId = '', fixture = URBAN_SUSPENSE_BENCHMARK } = {}) {
    const generator = database.prepare('SELECT id FROM model_profiles WHERE id = ? AND enabled = 1').get(generatorProfileId)
    if (!generator) throw new Error('请选择可用的基准生成模型')
    const reviewer = database.prepare('SELECT id FROM model_profiles WHERE id = ? AND enabled = 1').get(reviewerProfileId || generatorProfileId)
    if (!reviewer) throw new Error('请选择可用的质量评审模型')
    const runId = createId('benchmark')
    const projectId = createId('benchmark-project')
    const createdAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at, archived_at, project_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', 'benchmark')
      `).run(projectId, fixture.project.title, fixture.project.genre, fixture.project.idea, fixture.project.style, createdAt, createdAt)
      database.prepare(`
        INSERT INTO planning_documents (project_id, kind, content_json, created_at, updated_at)
        VALUES (?, 'foundation', ?, ?, ?), (?, 'world', ?, ?, ?), (?, 'outline', '{}', ?, ?)
      `).run(
        projectId, JSON.stringify({ boundaries: '医生只是嫌疑人；第一章尚未取得钥匙，第二章取得但不使用，第三章午夜首次使用且只使用一次；第三章停在门后第一次传出自己的声音和一个即时反应，不重复声音，不继续调查或解释来源。' }), createdAt, createdAt,
        projectId, JSON.stringify({ hardRules: '特殊钥匙每天午夜只能使用一次，失败后当天不会再次生效。' }), createdAt, createdAt,
        projectId, createdAt, createdAt,
      )
      database.prepare(`
        INSERT INTO planning_entities (id, project_id, kind, title, position, data_json, created_at, updated_at)
        VALUES (?, ?, 'character', '林砚', 1, ?, ?, ?)
      `).run(
        createId('benchmark-character'),
        projectId,
        JSON.stringify({ role: '主角', identity: '追查被修改病历的调查者', fear: '在证据不足时把嫌疑人当成凶手' }),
        createdAt,
        createdAt,
      )
      const insertChapter = database.prepare(`
        INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at, scene_plan_json)
        VALUES (?, ?, ?, ?, 'draft', ?, '', '', ?, ?)
      `)
      fixture.chapters.forEach((chapter, index) => insertChapter.run(
        createId('benchmark-chapter'),
        projectId,
        index + 1,
        chapter.title,
        JSON.stringify({ goal: chapter.contract, ending: chapter.contract, requiredScenes: [] }),
        createdAt,
        JSON.stringify(emptyScenePlan()),
      ))
      database.prepare(`
        INSERT INTO benchmark_runs (
          id, fixture_id, project_id, generator_profile_id, reviewer_profile_id,
          status, summary_json, error, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', '{}', '', ?, '')
      `).run(runId, fixture.id, projectId, generator.id, reviewer.id, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return getBenchmarkRun(runId)
  }

  function updateBenchmarkRun(id, { status, summary, error = '' } = {}) {
    const run = runById.get(id)
    if (!run) throw new Error('基准运行不存在')
    const allowed = ['pending', 'running', 'completed', 'cancelled', 'failed']
    if (!allowed.includes(status)) throw new Error('基准状态不受支持')
    const completedAt = ['completed', 'cancelled', 'failed'].includes(status) ? now() : ''
    database.prepare('UPDATE benchmark_runs SET status = ?, summary_json = ?, error = ?, completed_at = ? WHERE id = ?')
      .run(status, JSON.stringify(summary || parseJson(run.summary_json)), String(error || ''), completedAt, id)
    return getBenchmarkRun(id)
  }

  function startBenchmarkStep({ runId, stepKey, task, input = {} } = {}) {
    if (!runById.get(runId)) throw new Error('基准运行不存在')
    const position = Number(database.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM benchmark_steps WHERE run_id = ?').get(runId).position)
    const id = createId('benchmark-step')
    const createdAt = now()
    database.prepare(`
      INSERT INTO benchmark_steps (
        id, run_id, position, step_key, task, status, input_json, output_json, error, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, '{}', '', ?, '')
    `).run(id, runId, position, stepKey, task, JSON.stringify(input), createdAt)
    return mapStep(database.prepare('SELECT * FROM benchmark_steps WHERE id = ?').get(id))
  }

  function finishBenchmarkStep(id, { status = 'completed', generationRecordId = '', qualityReportId = '', output = {}, error = '' } = {}) {
    if (!['completed', 'cancelled', 'failed'].includes(status)) throw new Error('基准步骤状态不受支持')
    database.prepare(`
      UPDATE benchmark_steps
      SET status = ?, generation_record_id = ?, quality_report_id = ?, output_json = ?, error = ?, completed_at = ?
      WHERE id = ?
    `).run(status, generationRecordId || null, qualityReportId || null, JSON.stringify(output || {}), String(error || ''), now(), id)
    return mapStep(database.prepare('SELECT * FROM benchmark_steps WHERE id = ?').get(id))
  }

  function getBenchmarkRun(id) {
    const row = runById.get(id)
    if (!row) return null
    const steps = database.prepare('SELECT * FROM benchmark_steps WHERE run_id = ? ORDER BY position').all(id).map((stepRow) => {
      const step = mapStep(stepRow)
      const generation = stepRow.generation_record_id
        ? database.prepare(`
          SELECT model_json, prompt_snapshot_json, parameters_json, generation_intent,
            attempt_count, events_json, created_at, completed_at
          FROM generation_records WHERE id = ?
        `).get(stepRow.generation_record_id)
        : null
      const startedAt = Date.parse(step.createdAt)
      const endedAt = Date.parse(step.completedAt)
      return {
        ...step,
        durationMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : 0,
        generation: generation ? {
          model: parseJson(generation.model_json),
          promptSnapshot: parseJson(generation.prompt_snapshot_json),
          parameters: parseJson(generation.parameters_json),
          intent: generation.generation_intent,
          attemptCount: Number(generation.attempt_count || 1),
          events: parseJson(generation.events_json, []),
          createdAt: generation.created_at,
          completedAt: generation.completed_at,
        } : null,
      }
    })
    return {
      ...mapRun(row),
      steps,
    }
  }

  function listBenchmarkRuns({ limit = 50 } = {}) {
    const bounded = Math.max(1, Math.min(100, Number(limit || 50)))
    return database.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(bounded)
      .map((row) => getBenchmarkRun(row.id))
  }

  return {
    createReport,
    getReport,
    getReportByGeneration,
    getBlindReviewPacket,
    addHumanReview,
    listReports,
    createBenchmarkRun,
    updateBenchmarkRun,
    startBenchmarkStep,
    finishBenchmarkStep,
    getBenchmarkRun,
    listBenchmarkRuns,
  }
}
