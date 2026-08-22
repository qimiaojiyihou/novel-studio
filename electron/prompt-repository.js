import { randomUUID } from 'node:crypto'
import { builtInPromptTemplate } from './prompt-templates.js'

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function mapGenerationRecord(row) {
  return row ? {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    chapterId: row.chapter_id || '',
    task: row.task,
    status: row.status,
    modelProfileId: row.model_profile_id || '',
    model: parseJson(row.model_json),
    promptTemplateId: row.prompt_template_id,
    promptTemplateVersion: Number(row.prompt_template_version),
    promptSnapshot: parseJson(row.prompt_snapshot_json),
    parameters: parseJson(row.parameters_json),
    output: row.output_text,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  } : null
}

export function createPromptRepository(database, {
  now = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
} = {}) {
  const projectById = database.prepare('SELECT * FROM projects WHERE id = ?')
  const chapterById = database.prepare('SELECT * FROM chapters WHERE id = ?')

  function resolveVolume(projectId, chapter, explicitVolumeId = '') {
    const volumeId = cleanText(explicitVolumeId || parseJson(chapter?.card_json).volumeId)
    if (!volumeId) return null
    const volume = database.prepare(`
      SELECT * FROM planning_entities WHERE id = ? AND project_id = ? AND kind = 'volume'
    `).get(volumeId, projectId)
    return volume ? { ...volume, data: parseJson(volume.data_json) } : null
  }

  function ensureStyleProfile(projectId, scopeType, scopeId, name, text) {
    const current = database.prepare(`
      SELECT * FROM style_profiles WHERE project_id = ? AND scope_type = ? AND scope_id = ?
    `).get(projectId, scopeType, scopeId)
    const customText = cleanText(text)
    if (!current) {
      const createdAt = now()
      database.prepare(`
        INSERT INTO style_profiles (id, project_id, scope_type, scope_id, name, style_json, custom_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)
      `).run(createId('style'), projectId, scopeType, scopeId, name, customText, createdAt, createdAt)
    } else if (current.custom_text !== customText || current.name !== name) {
      database.prepare('UPDATE style_profiles SET name = ?, custom_text = ?, updated_at = ? WHERE id = ?')
        .run(name, customText, now(), current.id)
    }
    return database.prepare(`
      SELECT * FROM style_profiles WHERE project_id = ? AND scope_type = ? AND scope_id = ?
    `).get(projectId, scopeType, scopeId)
  }

  function resolveTemplate(task, projectId, chapterId, volumeId) {
    const bindings = database.prepare(`
      SELECT b.*, t.name, t.task AS template_task, t.current_version, v.content_json
      FROM prompt_bindings b
      JOIN prompt_templates t ON t.id = b.template_id AND t.enabled = 1
      JOIN prompt_template_versions v ON v.template_id = t.id AND v.version = t.current_version
      WHERE b.enabled = 1 AND b.task = ? AND (b.project_id IS NULL OR b.project_id = ?)
    `).all(task, projectId)
    const rank = { global: 0, project: 1, volume: 2, chapter: 3 }
    const matching = bindings.filter((binding) => {
      if (binding.scope_type === 'global') return true
      if (binding.scope_type === 'project') return binding.scope_id === projectId
      if (binding.scope_type === 'volume') return Boolean(volumeId) && binding.scope_id === volumeId
      if (binding.scope_type === 'chapter') return Boolean(chapterId) && binding.scope_id === chapterId
      return false
    }).sort((left, right) => rank[right.scope_type] - rank[left.scope_type] || right.priority - left.priority || right.updated_at.localeCompare(left.updated_at))
    const selected = matching[0]
    if (!selected) return builtInPromptTemplate(task)
    return {
      id: selected.template_id,
      task: selected.template_task,
      name: selected.name,
      version: Number(selected.current_version),
      content: parseJson(selected.content_json),
      binding: { id: selected.id, scopeType: selected.scope_type, scopeId: selected.scope_id },
    }
  }

  function resolvePromptContext({ projectId, chapterId = '', volumeId = '', task = 'chapter' }) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    const chapter = chapterId ? chapterById.get(chapterId) : null
    if (chapter && chapter.project_id !== projectId) throw new Error('章节不属于当前项目')
    const volume = resolveVolume(projectId, chapter, volumeId)
    const chapterCard = parseJson(chapter?.card_json)
    const definitions = [
      { scopeType: 'project', scopeId: projectId, name: `${project.title} · 项目文风`, label: '项目级', text: project.style },
      volume ? { scopeType: 'volume', scopeId: volume.id, name: `${volume.title} · 卷级文风`, label: '卷级', text: volume.data.volumeStyle } : null,
      chapter ? { scopeType: 'chapter', scopeId: chapter.id, name: `${chapter.title} · 章节级文风`, label: '章节级', text: chapterCard.chapterStyle } : null,
    ].filter(Boolean)
    const sources = definitions.map((definition) => {
      const profile = ensureStyleProfile(projectId, definition.scopeType, definition.scopeId, definition.name, definition.text)
      return {
        profileId: profile.id,
        scopeType: definition.scopeType,
        scopeId: definition.scopeId,
        label: definition.label,
        text: profile.custom_text,
        style: parseJson(profile.style_json),
      }
    }).filter((source) => source.text || Object.keys(source.style).length)
    return {
      template: resolveTemplate(task, projectId, chapter?.id || '', volume?.id || ''),
      style: {
        sources,
        mergedText: sources.map((source) => source.text).filter(Boolean).join('\n'),
        mergedStyle: Object.assign({}, ...sources.map((source) => source.style)),
        volume: volume ? { id: volume.id, title: volume.title } : null,
      },
    }
  }

  function startGenerationRecord(input = {}) {
    const project = projectById.get(input.projectId)
    if (!project) throw new Error('项目不存在')
    const chapter = input.chapterId ? chapterById.get(input.chapterId) : null
    if (chapter && chapter.project_id !== input.projectId) throw new Error('章节不属于当前项目')
    const snapshot = input.promptSnapshot || {}
    const id = createId('generation')
    const createdAt = now()
    database.prepare(`
      INSERT INTO generation_records (
        id, task_id, project_id, chapter_id, task, status, model_profile_id, model_json,
        prompt_template_id, prompt_template_version, prompt_snapshot_json, parameters_json,
        output_text, error, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '{}', '', '', ?, '')
    `).run(
      id,
      cleanText(input.taskId) || id,
      input.projectId,
      chapter?.id || null,
      cleanText(input.task) || 'chapter',
      input.modelProfileId || null,
      JSON.stringify(input.model || {}),
      cleanText(snapshot.template?.id),
      Number(snapshot.template?.version || 1),
      JSON.stringify(snapshot),
      createdAt,
    )
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  function finishGenerationRecord({ id, status, parameters = {}, output = '', error = '' }) {
    if (!['completed', 'cancelled', 'failed'].includes(status)) throw new Error('生成记录状态不受支持')
    const current = database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id)
    if (!current) throw new Error('生成记录不存在')
    database.prepare(`
      UPDATE generation_records
      SET status = ?, parameters_json = ?, output_text = ?, error = ?, completed_at = ?
      WHERE id = ?
    `).run(status, JSON.stringify(parameters || {}), String(output || ''), String(error || ''), now(), id)
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  function getGenerationRecord(id) {
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  return { resolvePromptContext, startGenerationRecord, finishGenerationRecord, getGenerationRecord }
}
