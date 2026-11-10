import { buildCreativeContext, knowledgeValue } from './creative-context.js'
import { createDraftContextDeduper, isChapterFirstDraft } from './draft-context-dedupe.js'
import { COMPACT_HANDOFF_MODE } from './chapter-handoff.js'

const PROFILE_DEFAULTS = Object.freeze({
  maxContextChars: 32000,
  contextBudgetUnlimited: false,
  recentChapterCount: 3,
  relevantChapterCount: 4,
  knowledgeLimit: 16,
  chapterSummaryChars: 1200,
})

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback
}

function profileFrom(row) {
  if (!row) return { ...PROFILE_DEFAULTS }
  return {
    projectId: row.project_id,
    maxContextChars: Number(row.max_context_chars),
    contextBudgetUnlimited: Boolean(row.context_budget_unlimited),
    recentChapterCount: Number(row.recent_chapter_count),
    relevantChapterCount: Number(row.relevant_chapter_count),
    knowledgeLimit: Number(row.knowledge_limit),
    chapterSummaryChars: Number(row.chapter_summary_chars),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function memoryFrom(row) {
  return {
    chapterId: row.chapter_id,
    projectId: row.project_id,
    chapterNo: Number(row.chapter_no),
    title: row.title,
    summary: row.summary,
    keywords: parseJson(row.keywords_json, []),
    sourceUpdatedAt: row.source_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function uniqueParts(parts) {
  const seen = new Set()
  return parts.map(cleanText).filter((part) => {
    if (!part || seen.has(part)) return false
    seen.add(part)
    return true
  })
}

function excerpt(text, limit) {
  const source = cleanText(text)
  if (source.length <= limit) return source
  const headLength = Math.max(1, Math.floor(limit * 0.62))
  const tailLength = Math.max(1, limit - headLength - 1)
  return `${source.slice(0, headLength)}…${source.slice(-tailLength)}`
}

function summaryFor(chapter, limit) {
  const card = parseJson(chapter.card_json, {})
  const contract = uniqueParts([
    card.goal,
    card.protagonistGoal,
    card.resistance,
    card.turningPoint,
    card.payoff,
    card.cost,
    card.ending,
    ...(Array.isArray(card.requiredScenes) ? card.requiredScenes.flatMap((scene) => [scene.title, scene.goal, scene.result]) : []),
  ])
  const sections = [
    `第 ${chapter.chapter_no} 章《${chapter.title}》`,
    contract.length ? `章节合同：${contract.join('；')}` : '',
    cleanText(chapter.scene_plan) ? `场景推进：${excerpt(chapter.scene_plan, Math.max(240, Math.floor(limit * 0.35)))}` : '',
    cleanText(chapter.manuscript) ? `正文记忆：${excerpt(chapter.manuscript, Math.max(300, Math.floor(limit * 0.48)))}` : '',
  ].filter(Boolean)
  return excerpt(sections.join('\n'), limit)
}

function termsFor(value) {
  const source = cleanText(value).toLowerCase()
  const terms = new Set()
  for (const match of source.matchAll(/[\p{Script=Han}]{2,}|[a-z0-9_-]{2,}/gu)) {
    const token = match[0]
    terms.add(token)
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) terms.add(token.slice(index, index + 2))
    }
  }
  return [...terms].slice(0, 160)
}

function overlapScore(queryTerms, candidateTerms) {
  const query = new Set(queryTerms)
  return candidateTerms.reduce((score, term) => score + (query.has(term) ? (term.length > 2 ? 3 : 1) : 0), 0)
}

function appendWithinBudget(sections, label, content, budget) {
  const body = budget === null ? String(content ?? '').trim() : cleanText(content)
  if (!body) return { used: 0, truncated: false }
  const prefix = `${sections.length ? '\n\n' : ''}## ${label}\n`
  if (budget === null) {
    sections.push(prefix + body)
    return { used: prefix.length + body.length, truncated: false }
  }
  const remaining = budget - sections.join('').length
  if (remaining <= prefix.length + 12) return { used: 0, truncated: true }
  const allowed = remaining - prefix.length
  const clipped = body.length > allowed ? `${body.slice(0, Math.max(0, allowed - 1))}…` : body
  sections.push(prefix + clipped)
  return { used: prefix.length + clipped.length, truncated: clipped.length < body.length }
}

export function createContextRepository(database, { now = () => new Date().toISOString() } = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')

  function assertProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    return project
  }

  function ensureProfile(projectId) {
    assertProject(projectId)
    const timestamp = now()
    database.prepare(`
      INSERT OR IGNORE INTO context_profiles (
        project_id, max_context_chars, recent_chapter_count, relevant_chapter_count,
        knowledge_limit, chapter_summary_chars, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      PROFILE_DEFAULTS.maxContextChars,
      PROFILE_DEFAULTS.recentChapterCount,
      PROFILE_DEFAULTS.relevantChapterCount,
      PROFILE_DEFAULTS.knowledgeLimit,
      PROFILE_DEFAULTS.chapterSummaryChars,
      timestamp,
      timestamp,
    )
    return profileFrom(database.prepare('SELECT * FROM context_profiles WHERE project_id = ?').get(projectId))
  }

  function syncChapterMemories(projectId, { force = false } = {}) {
    const profile = ensureProfile(projectId)
    const chapters = database.prepare(`
      SELECT id, project_id, chapter_no, title, card_json, scene_plan, manuscript, updated_at
      FROM chapters WHERE project_id = ? ORDER BY chapter_no
    `).all(projectId)
    const existingRows = database.prepare('SELECT * FROM chapter_memories WHERE project_id = ?').all(projectId)
    const existing = new Map(existingRows.map((row) => [row.chapter_id, row]))
    const timestamp = now()
    const upsert = database.prepare(`
      INSERT INTO chapter_memories (
        chapter_id, project_id, chapter_no, title, summary, keywords_json,
        source_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_id) DO UPDATE SET
        project_id = excluded.project_id,
        chapter_no = excluded.chapter_no,
        title = excluded.title,
        summary = excluded.summary,
        keywords_json = excluded.keywords_json,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const chapter of chapters) {
        const current = existing.get(chapter.id)
        if (current?.confirmed) continue // Saving prose marks review pending; never replaces an accepted handoff.
        if (!force && current?.source_updated_at === chapter.updated_at) continue
        const summary = summaryFor(chapter, profile.chapterSummaryChars)
        const keywords = termsFor(`${chapter.title}\n${summary}`)
        upsert.run(
          chapter.id,
          projectId,
          chapter.chapter_no,
          chapter.title,
          summary,
          JSON.stringify(keywords),
          chapter.updated_at,
          current?.created_at || timestamp,
          timestamp,
        )
      }
      const chapterIds = new Set(chapters.map((chapter) => chapter.id))
      for (const memory of existingRows) {
        if (!chapterIds.has(memory.chapter_id)) database.prepare('DELETE FROM chapter_memories WHERE chapter_id = ?').run(memory.chapter_id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return database.prepare('SELECT * FROM chapter_memories WHERE project_id = ? ORDER BY chapter_no').all(projectId).map(memoryFrom)
  }

  function loadContextManager(projectId) {
    const profile = ensureProfile(projectId)
    const memories = syncChapterMemories(projectId)
    const chapterCount = Number(database.prepare('SELECT COUNT(*) AS count FROM chapters WHERE project_id = ?').get(projectId).count)
    return {
      profile,
      memories,
      stats: {
        chapterCount,
        memoryCount: memories.length,
        memoryCharacters: memories.reduce((total, memory) => total + memory.summary.length, 0),
      },
    }
  }

  function updateContextProfile(input = {}) {
    const projectId = String(input.projectId || '')
    const current = ensureProfile(projectId)
    const requestedBudget = Math.round(Number(input.maxContextChars))
    const next = {
      maxContextChars: input.maxContextChars == null || input.maxContextChars === '' || !Number.isSafeInteger(requestedBudget)
        ? current.maxContextChars : Math.max(8000, requestedBudget),
      contextBudgetUnlimited: typeof input.contextBudgetUnlimited === 'boolean' ? input.contextBudgetUnlimited : current.contextBudgetUnlimited,
      recentChapterCount: clampInteger(input.recentChapterCount, 0, 20, current.recentChapterCount),
      relevantChapterCount: clampInteger(input.relevantChapterCount, 0, 20, current.relevantChapterCount),
      knowledgeLimit: clampInteger(input.knowledgeLimit, 0, 100, current.knowledgeLimit),
      chapterSummaryChars: clampInteger(input.chapterSummaryChars, 200, 4000, current.chapterSummaryChars),
    }
    database.prepare(`
      UPDATE context_profiles SET
        max_context_chars = ?, context_budget_unlimited = ?, recent_chapter_count = ?, relevant_chapter_count = ?,
        knowledge_limit = ?, chapter_summary_chars = ?, updated_at = ?
      WHERE project_id = ?
    `).run(
      next.maxContextChars,
      Number(next.contextBudgetUnlimited),
      next.recentChapterCount,
      next.relevantChapterCount,
      next.knowledgeLimit,
      next.chapterSummaryChars,
      now(),
      projectId,
    )
    if (next.chapterSummaryChars !== current.chapterSummaryChars) syncChapterMemories(projectId, { force: true })
    return loadContextManager(projectId)
  }

  function knowledgeCandidates(projectId, queryTerms) {
    const items = database.prepare(`
      SELECT id, kind, title, content_json, source_type, source_id, status, position, updated_at,
             effective_from_chapter, effective_to_chapter, knowledge_scope_json, evidence_json, source_digest
      FROM knowledge_items
      WHERE project_id = ? AND status = 'open'
      ORDER BY updated_at DESC, position
    `).all(projectId).map((row) => {
      const content = parseJson(row.content_json, {})
      const text = `${row.title} ${Object.values(content).join(' ')}`
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        text: cleanText(text),
        row,
        score: overlapScore(queryTerms, termsFor(text)) + (row.kind === 'fact' ? 1 : 0),
      }
    })
    const checks = database.prepare(`
      SELECT id, severity, title, detail, updated_at
      FROM continuity_checks
      WHERE project_id = ? AND status = 'open'
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, updated_at DESC
    `).all(projectId).map((row) => {
      const text = cleanText(`${row.title} ${row.detail}`)
      const severityBonus = row.severity === 'critical' ? 3 : row.severity === 'warning' ? 2 : 1
      return {
        id: row.id,
        kind: `continuity-${row.severity}`,
        title: row.title,
        text,
        score: overlapScore(queryTerms, termsFor(text)) + severityBonus,
      }
    })
    return [...items, ...checks]
  }

  function acceptedStateSnapshots(projectId, chapterNo, limit) {
    const rows = database.prepare(`
      SELECT candidate.id, candidate.chapter_id, candidate.payload_json, candidate.created_at,
        chapter.chapter_no, chapter.title
      FROM knowledge_candidates candidate
      JOIN chapters chapter ON chapter.id = candidate.chapter_id
      WHERE candidate.project_id = ?
        AND candidate.task = 'chapter_state_extract'
        AND candidate.status = 'accepted'
        AND chapter.chapter_no < ?
      ORDER BY chapter.chapter_no DESC, candidate.created_at DESC
    `).all(projectId, chapterNo)
    const seen = new Set()
    return rows.filter((row) => {
      if (seen.has(row.chapter_id)) return false
      seen.add(row.chapter_id)
      return true
    }).slice(0, limit).reverse().map((row) => ({
      id: row.id,
      chapterId: row.chapter_id,
      chapterNo: Number(row.chapter_no),
      title: row.title,
      payload: parseJson(row.payload_json, {}),
    }))
  }

  function buildGenerationContext(input = {}) {
    if (input.task === 'chapter_state_extract' && input.chapterStateMode === COMPACT_HANDOFF_MODE) return buildCreativeContext(database, input)
    const projectId = String(input.projectId || '')
    const project = assertProject(projectId)
    const profile = ensureProfile(projectId)
    const budget = profile.contextBudgetUnlimited ? null : profile.maxContextChars
    const pack = database.prepare('SELECT pack_version FROM project_pack_bindings WHERE project_id = ?').get(projectId)
    if (input.localRevision || input.creativePackVersion === '1.3.0' || (!input.creativePackVersion && pack?.pack_version === '1.3.0')) return buildCreativeContext(database, { ...input, budget })
    const memories = syncChapterMemories(projectId)
    const chapters = database.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId)
    const chapter = chapters.find((item) => item.id === input.chapterId) || chapters[0]
    if (!chapter) throw new Error('项目中还没有章节')
    const deduper = isChapterFirstDraft(input, chapter) ? createDraftContextDeduper() : null
    const deduplicated = []
    const card = parseJson(chapter.card_json, {})
    const queryText = [project.title, project.genre, project.idea, chapter.title, JSON.stringify(card), chapter.scene_plan, input.styleText, input.instruction].join(' ')
    const queryTerms = termsFor(queryText)
    const previous = memories.filter((memory) => memory.chapterNo < Number(chapter.chapter_no))
    const recent = previous.slice(-profile.recentChapterCount)
    const recentIds = new Set(recent.map((memory) => memory.chapterId))
    const relevant = previous
      .filter((memory) => !recentIds.has(memory.chapterId))
      .map((memory) => ({ ...memory, score: overlapScore(queryTerms, memory.keywords) }))
      .filter((memory) => memory.score > 0)
      .sort((left, right) => right.score - left.score || right.chapterNo - left.chapterNo)
      .slice(0, profile.relevantChapterCount)
    const rankedKnowledge = knowledgeCandidates(projectId, queryTerms).sort((left, right) => right.score - left.score)
    const stateSnapshots = acceptedStateSnapshots(
      projectId,
      Number(chapter.chapter_no),
      Math.max(3, profile.recentChapterCount + profile.relevantChapterCount),
    )

    const planningDocuments = database.prepare('SELECT kind, content_json FROM planning_documents WHERE project_id = ? ORDER BY kind').all(projectId)
    const planningEntities = database.prepare('SELECT id, kind, title, data_json FROM planning_entities WHERE project_id = ? ORDER BY kind, position').all(projectId)
    const planning = {
      documents: Object.fromEntries(planningDocuments.map((item) => [item.kind, parseJson(item.content_json, {})])),
      entities: planningEntities.map((item) => ({ kind: item.kind, title: item.title, ...parseJson(item.data_json, {}) })),
    }
    const planningJson = JSON.stringify(planning)
    const planningExcerpt = budget === null ? planningJson : excerpt(planningJson, Math.max(1200, Math.floor(budget * 0.25)))

    const sections = []
    let truncated = planningExcerpt.length < planningJson.length
    const append = (label, content) => {
      const result = appendWithinBudget(sections, label, content, budget)
      truncated ||= result.truncated
      return result
    }
    append('当前创作任务', [
      `项目：${project.title}`,
      `题材：${project.genre}`,
      `核心想法：${project.idea || '暂无'}`,
      `当前章节：第 ${chapter.chapter_no} 章《${chapter.title}》`,
      `章节卡：${JSON.stringify(card)}`,
      `场景计划：${chapter.scene_plan || '暂无'}`,
      cleanText(chapter.manuscript) ? budget === null ? `当前正文：${chapter.manuscript}`
        : `当前正文尾部：${excerpt(chapter.manuscript, Math.min(5000, Math.floor(budget * 0.18)))}` : '',
    ].filter(Boolean).join('\n'))
    const includedPlanning = append('已确认故事规划', planningExcerpt)
    if (deduper && planningExcerpt === planningJson && includedPlanning.used && !includedPlanning.truncated) {
      for (const [kind, data] of Object.entries(planning.documents)) deduper.addDocument(kind, data)
      planningEntities.forEach((entity) => deduper.addEntity(entity, parseJson(entity.data_json, {})))
    }
    if (stateSnapshots.length) {
      const snapshotLimit = Math.max(800, Math.floor(profile.chapterSummaryChars * 1.5))
      append('已确认章后状态', stateSnapshots.map((snapshot) => (
        `第 ${snapshot.chapterNo} 章《${snapshot.title}》：${excerpt(JSON.stringify({
          summary: snapshot.payload?.summary || '',
          characterStates: snapshot.payload?.characterStates || [],
          relationshipChanges: snapshot.payload?.relationshipChanges || [],
          openThreads: snapshot.payload?.openThreads || [],
          foreshadow: snapshot.payload?.foreshadow || { setups: [], payoffs: [] },
          facts: (snapshot.payload?.facts || []).slice(0, 8),
          timelineEvents: (snapshot.payload?.timelineEvents || []).slice(0, 6),
        }), snapshotLimit)}`
      )).join('\n'))
    }
    if (recent.length) append('最近章节记忆', recent.map((memory) => memory.summary).join('\n\n'))
    if (relevant.length) append('相关旧章召回', relevant.map((memory) => memory.summary).join('\n\n'))
    const knowledge = []
    for (const item of rankedKnowledge) {
      if (knowledge.length >= profile.knowledgeLimit) break
      const value = deduper && item.row ? knowledgeValue(item.row) : null
      if (value && deduper.duplicate(item.row, value)) {
        deduplicated.push(`knowledge_item:${item.id}:content`)
        continue
      }
      const rendered = value ? deduper.compactLinkedFact(item.row, value) : value
      if (value) deduper.addFact(item.row, value)
      if (rendered !== value) deduplicated.push(`knowledge_item:${item.id}:content`)
      const body = rendered !== value ? cleanText(`${item.title} ${Object.values(rendered.content).join(' ')}`) : item.text
      const scoped = value && (value.effectiveFrom != null || value.effectiveTo != null
        || value.scope?.author !== true || Object.keys(value.scope).length !== 1)
      knowledge.push({ ...item, text: scoped ? `${body}（知情范围：${JSON.stringify(value.scope)}；生效：${value.effectiveFrom ?? '不限'} 至 ${value.effectiveTo ?? '不限'}）` : body })
    }
    if (knowledge.length) append('相关知识与连续性', knowledge.map((item) => `[${item.kind}] ${item.text}`).join('\n'))

    const text = sections.join('')
    return {
      text,
      diagnostics: {
        budgetChars: budget,
        usedChars: text.length,
        recentChapterIds: recent.map((memory) => memory.chapterId),
        relevantChapterIds: relevant.map((memory) => memory.chapterId),
        knowledgeItemIds: knowledge.map((item) => item.id),
        stateCandidateIds: stateSnapshots.map((snapshot) => snapshot.id),
        memoryCount: memories.length,
        ...(deduper ? { deduplicated } : {}),
        truncated,
      },
    }
  }

  return {
    loadContextManager,
    updateContextProfile,
    rebuildChapterMemories: (projectId) => {
      ensureProfile(projectId)
      syncChapterMemories(projectId, { force: true })
      return loadContextManager(projectId)
    },
    buildGenerationContext,
  }
}

export { PROFILE_DEFAULTS }
