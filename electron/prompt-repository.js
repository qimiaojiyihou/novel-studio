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

const PROMPT_TASKS = ['planning_field', 'chapter_card', 'scene_plan', 'chapter', 'rewrite', 'chapter_state_extract', 'continuity_audit']
const SCOPE_RANK = { project: 1, volume: 2, chapter: 3 }

function mapTemplate(row) {
  return row ? {
    id: row.id,
    task: row.task,
    name: row.name,
    kind: row.kind,
    enabled: Boolean(row.enabled),
    version: Number(row.current_version),
    content: parseJson(row.content_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function mapAddon(row) {
  return row ? {
    id: row.id,
    name: row.name,
    category: row.category,
    kind: row.kind,
    enabled: Boolean(row.enabled),
    version: Number(row.current_version),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
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
    request: parseJson(row.request_json),
    retryOfId: row.retry_of_id || '',
    attemptCount: Number(row.attempt_count || 1),
    events: parseJson(row.events_json, []),
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

  function assertProject(projectId) {
    const project = projectById.get(projectId)
    if (!project) throw new Error('项目不存在')
    return project
  }

  function assertScope(projectId, scopeType, scopeId) {
    if (scopeType === 'project' && scopeId === projectId) return
    if (scopeType === 'volume') {
      const volume = database.prepare("SELECT id FROM planning_entities WHERE id = ? AND project_id = ? AND kind = 'volume'").get(scopeId, projectId)
      if (volume) return
    }
    if (scopeType === 'chapter') {
      const chapter = chapterById.get(scopeId)
      if (chapter?.project_id === projectId) return
    }
    throw new Error('提示词作用范围不属于当前项目')
  }

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

  function resolveAddons(task, projectId, chapterId, volumeId) {
    const bindings = database.prepare(`
      SELECT b.*, a.name, a.category, a.kind, a.current_version, v.content
      FROM prompt_addon_bindings b
      JOIN prompt_addons a ON a.id = b.addon_id AND a.enabled = 1
      JOIN prompt_addon_versions v ON v.addon_id = a.id AND v.version = a.current_version
      WHERE b.enabled = 1 AND b.project_id = ? AND (b.task = '*' OR b.task = ?)
    `).all(projectId, task)
    return bindings.filter((binding) => {
      if (binding.scope_type === 'project') return binding.scope_id === projectId
      if (binding.scope_type === 'volume') return Boolean(volumeId) && binding.scope_id === volumeId
      if (binding.scope_type === 'chapter') return Boolean(chapterId) && binding.scope_id === chapterId
      return false
    }).sort((left, right) => SCOPE_RANK[left.scope_type] - SCOPE_RANK[right.scope_type]
      || left.priority - right.priority || left.created_at.localeCompare(right.created_at))
      .map((binding) => ({
        id: binding.addon_id,
        name: binding.name,
        category: binding.category,
        kind: binding.kind,
        version: Number(binding.current_version),
        content: binding.content,
        binding: {
          id: binding.id,
          scopeType: binding.scope_type,
          scopeId: binding.scope_id,
          task: binding.task,
          priority: Number(binding.priority),
        },
      }))
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
      addons: resolveAddons(task, projectId, chapter?.id || '', volume?.id || ''),
      style: {
        sources,
        mergedText: sources.map((source) => source.text).filter(Boolean).join('\n'),
        mergedStyle: Object.assign({}, ...sources.map((source) => source.style)),
        volume: volume ? { id: volume.id, title: volume.title } : null,
      },
    }
  }

  function loadPromptCenter(projectId) {
    const project = assertProject(projectId)
    const templates = database.prepare(`
      SELECT t.*, v.content_json
      FROM prompt_templates t
      JOIN prompt_template_versions v ON v.template_id = t.id AND v.version = t.current_version
      WHERE t.enabled = 1
      ORDER BY CASE t.kind WHEN 'built_in' THEN 0 ELSE 1 END, t.task, t.name
    `).all().map(mapTemplate)
    const addons = database.prepare(`
      SELECT a.*, v.content
      FROM prompt_addons a
      JOIN prompt_addon_versions v ON v.addon_id = a.id AND v.version = a.current_version
      WHERE a.enabled = 1
      ORDER BY a.category, CASE a.kind WHEN 'built_in' THEN 0 ELSE 1 END, a.name
    `).all().map(mapAddon)
    const bindings = database.prepare(`
      SELECT * FROM prompt_bindings WHERE project_id IS NULL OR project_id = ?
      ORDER BY task, priority DESC, updated_at DESC
    `).all(projectId).map((row) => ({
      id: row.id, projectId: row.project_id || '', scopeType: row.scope_type, scopeId: row.scope_id,
      task: row.task, templateId: row.template_id, enabled: Boolean(row.enabled), priority: Number(row.priority),
    }))
    const addonBindings = database.prepare(`
      SELECT * FROM prompt_addon_bindings WHERE project_id = ? ORDER BY priority, created_at
    `).all(projectId).map((row) => ({
      id: row.id, projectId: row.project_id, scopeType: row.scope_type, scopeId: row.scope_id,
      task: row.task, addonId: row.addon_id, enabled: Boolean(row.enabled), priority: Number(row.priority),
    }))
    const volumes = database.prepare("SELECT id, title, data_json FROM planning_entities WHERE project_id = ? AND kind = 'volume' ORDER BY position").all(projectId)
      .map((row) => ({ id: row.id, title: row.title, data: parseJson(row.data_json) }))
    const chapters = database.prepare('SELECT id, chapter_no, title, card_json FROM chapters WHERE project_id = ? ORDER BY chapter_no').all(projectId)
      .map((row) => ({ id: row.id, chapterNo: Number(row.chapter_no), title: row.title, card: parseJson(row.card_json) }))
    const storedStyles = new Map(database.prepare('SELECT * FROM style_profiles WHERE project_id = ?').all(projectId)
      .map((row) => [`${row.scope_type}:${row.scope_id}`, row]))
    const styleScopes = [
      { scopeType: 'project', scopeId: projectId, label: '项目级', name: project.title, text: project.style },
      ...volumes.map((volume) => ({ scopeType: 'volume', scopeId: volume.id, label: '卷级', name: volume.title, text: volume.data.volumeStyle || '' })),
      ...chapters.map((chapter) => ({ scopeType: 'chapter', scopeId: chapter.id, label: '章节级', name: `第 ${chapter.chapterNo} 章 · ${chapter.title}`, text: chapter.card.chapterStyle || '' })),
    ].map((scope) => {
      const stored = storedStyles.get(`${scope.scopeType}:${scope.scopeId}`)
      return { ...scope, profileId: stored?.id || '', text: scope.text, style: parseJson(stored?.style_json) }
    })
    return { tasks: PROMPT_TASKS, templates, bindings, addons, addonBindings, styleScopes, volumes, chapters }
  }

  function savePromptTemplate(input = {}) {
    const task = cleanText(input.task)
    if (!PROMPT_TASKS.includes(task)) throw new Error('提示词任务类型不受支持')
    const content = {
      system: cleanText(input.content?.system),
      request: cleanText(input.content?.request),
      outputContract: cleanText(input.content?.outputContract),
    }
    if (!content.system || !content.request) throw new Error('系统提示和任务要求不能为空')
    const existing = input.id ? database.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(input.id) : null
    const createdAt = now()
    if (existing?.kind === 'user') {
      const version = Number(existing.current_version) + 1
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('UPDATE prompt_templates SET task = ?, name = ?, current_version = ?, updated_at = ? WHERE id = ?')
          .run(task, cleanText(input.name) || existing.name, version, createdAt, existing.id)
        database.prepare('INSERT INTO prompt_template_versions (id, template_id, version, content_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(createId('prompt-version'), existing.id, version, JSON.stringify(content), createdAt)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return mapTemplate(database.prepare(`SELECT t.*, v.content_json FROM prompt_templates t JOIN prompt_template_versions v ON v.template_id = t.id AND v.version = t.current_version WHERE t.id = ?`).get(existing.id))
    }
    const id = createId('prompt')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`INSERT INTO prompt_templates (id, task, name, kind, enabled, current_version, created_at, updated_at) VALUES (?, ?, ?, 'user', 1, 1, ?, ?)`)
        .run(id, task, cleanText(input.name) || '未命名提示词', createdAt, createdAt)
      database.prepare('INSERT INTO prompt_template_versions (id, template_id, version, content_json, created_at) VALUES (?, ?, 1, ?, ?)')
        .run(createId('prompt-version'), id, JSON.stringify(content), createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapTemplate(database.prepare(`SELECT t.*, v.content_json FROM prompt_templates t JOIN prompt_template_versions v ON v.template_id = t.id AND v.version = t.current_version WHERE t.id = ?`).get(id))
  }

  function bindPromptTemplate(input = {}) {
    const projectId = cleanText(input.projectId)
    const scopeType = cleanText(input.scopeType) || 'project'
    const scopeId = cleanText(input.scopeId) || projectId
    const task = cleanText(input.task)
    assertProject(projectId)
    assertScope(projectId, scopeType, scopeId)
    const template = database.prepare('SELECT * FROM prompt_templates WHERE id = ? AND enabled = 1').get(input.templateId)
    if (!template || template.task !== task) throw new Error('模板与当前任务不匹配')
    const createdAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM prompt_bindings WHERE project_id = ? AND scope_type = ? AND scope_id = ? AND task = ?')
        .run(projectId, scopeType, scopeId, task)
      database.prepare(`INSERT INTO prompt_bindings (id, project_id, scope_type, scope_id, task, template_id, enabled, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 10, ?, ?)`)
        .run(createId('prompt-binding'), projectId, scopeType, scopeId, task, template.id, createdAt, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return loadPromptCenter(projectId)
  }

  function saveStyleProfile(input = {}) {
    const projectId = cleanText(input.projectId)
    const scopeType = cleanText(input.scopeType)
    const scopeId = cleanText(input.scopeId)
    const text = cleanText(input.text)
    const style = input.style && typeof input.style === 'object' ? input.style : {}
    const project = assertProject(projectId)
    assertScope(projectId, scopeType, scopeId)
    let name = project.title
    if (scopeType === 'project') {
      database.prepare('UPDATE projects SET style = ?, updated_at = ? WHERE id = ?').run(text, now(), projectId)
    } else if (scopeType === 'volume') {
      const row = database.prepare('SELECT title, data_json FROM planning_entities WHERE id = ?').get(scopeId)
      name = row.title
      database.prepare('UPDATE planning_entities SET data_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ ...parseJson(row.data_json), volumeStyle: text }), now(), scopeId)
    } else {
      const row = chapterById.get(scopeId)
      name = row.title
      database.prepare('UPDATE chapters SET card_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ ...parseJson(row.card_json), chapterStyle: text }), now(), scopeId)
    }
    const profile = ensureStyleProfile(projectId, scopeType, scopeId, `${name} · ${scopeType === 'project' ? '项目' : scopeType === 'volume' ? '卷级' : '章节级'}文风`, text)
    database.prepare('UPDATE style_profiles SET style_json = ?, custom_text = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(style), text, now(), profile.id)
    return loadPromptCenter(projectId)
  }

  function savePromptAddon(input = {}) {
    const content = cleanText(input.content)
    if (!content) throw new Error('提示词插件内容不能为空')
    const existing = input.id ? database.prepare('SELECT * FROM prompt_addons WHERE id = ?').get(input.id) : null
    const createdAt = now()
    if (existing?.kind === 'user') {
      const version = Number(existing.current_version) + 1
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('UPDATE prompt_addons SET name = ?, category = ?, current_version = ?, updated_at = ? WHERE id = ?')
          .run(cleanText(input.name) || existing.name, cleanText(input.category) || '自定义', version, createdAt, existing.id)
        database.prepare('INSERT INTO prompt_addon_versions (id, addon_id, version, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(createId('addon-version'), existing.id, version, content, createdAt)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return mapAddon(database.prepare(`SELECT a.*, v.content FROM prompt_addons a JOIN prompt_addon_versions v ON v.addon_id = a.id AND v.version = a.current_version WHERE a.id = ?`).get(existing.id))
    }
    const id = createId('addon')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`INSERT INTO prompt_addons (id, name, category, kind, enabled, current_version, created_at, updated_at) VALUES (?, ?, ?, 'user', 1, 1, ?, ?)`)
        .run(id, cleanText(input.name) || '未命名插件', cleanText(input.category) || '自定义', createdAt, createdAt)
      database.prepare('INSERT INTO prompt_addon_versions (id, addon_id, version, content, created_at) VALUES (?, ?, 1, ?, ?)')
        .run(createId('addon-version'), id, content, createdAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return mapAddon(database.prepare(`SELECT a.*, v.content FROM prompt_addons a JOIN prompt_addon_versions v ON v.addon_id = a.id AND v.version = a.current_version WHERE a.id = ?`).get(id))
  }

  function setPromptAddonBinding(input = {}) {
    const projectId = cleanText(input.projectId)
    const scopeType = cleanText(input.scopeType) || 'project'
    const scopeId = cleanText(input.scopeId) || projectId
    const task = cleanText(input.task) || '*'
    assertProject(projectId)
    assertScope(projectId, scopeType, scopeId)
    if (task !== '*' && !PROMPT_TASKS.includes(task)) throw new Error('插件任务类型不受支持')
    const addon = database.prepare('SELECT id FROM prompt_addons WHERE id = ? AND enabled = 1').get(input.addonId)
    if (!addon) throw new Error('提示词插件不存在')
    const createdAt = now()
    database.prepare(`
      INSERT INTO prompt_addon_bindings (id, project_id, scope_type, scope_id, task, addon_id, enabled, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, scope_type, scope_id, task, addon_id)
      DO UPDATE SET enabled = excluded.enabled, priority = excluded.priority, updated_at = excluded.updated_at
    `).run(createId('addon-binding'), projectId, scopeType, scopeId, task, addon.id, input.enabled === false ? 0 : 1, Number(input.priority || 0), createdAt, createdAt)
    return loadPromptCenter(projectId)
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
        output_text, error, created_at, completed_at, request_json, retry_of_id, attempt_count, events_json
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '{}', '', '', ?, '', ?, ?, 1, '[]')
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
      JSON.stringify(input.request || {}),
      input.retryOfId || null,
    )
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  function finishGenerationRecord({ id, status, parameters = {}, output = '', error = '', attemptCount = 1, events = [] }) {
    if (!['completed', 'cancelled', 'failed'].includes(status)) throw new Error('生成记录状态不受支持')
    const current = database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id)
    if (!current) throw new Error('生成记录不存在')
    database.prepare(`
      UPDATE generation_records
      SET status = ?, parameters_json = ?, output_text = ?, error = ?, attempt_count = ?, events_json = ?, completed_at = ?
      WHERE id = ?
    `).run(status, JSON.stringify(parameters || {}), String(output || ''), String(error || ''), Math.max(1, Number(attemptCount || 1)), JSON.stringify(events || []), now(), id)
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  function getGenerationRecord(id) {
    return mapGenerationRecord(database.prepare('SELECT * FROM generation_records WHERE id = ?').get(id))
  }

  function listGenerationRecords({ projectId, status = '', limit = 100 } = {}) {
    assertProject(projectId)
    const boundedLimit = Math.min(300, Math.max(1, Number(limit || 100)))
    const rows = status
      ? database.prepare('SELECT * FROM generation_records WHERE project_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(projectId, status, boundedLimit)
      : database.prepare('SELECT * FROM generation_records WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(projectId, boundedLimit)
    return rows.map(mapGenerationRecord)
  }

  return {
    resolvePromptContext,
    loadPromptCenter,
    savePromptTemplate,
    bindPromptTemplate,
    saveStyleProfile,
    savePromptAddon,
    setPromptAddonBinding,
    startGenerationRecord,
    finishGenerationRecord,
    getGenerationRecord,
    listGenerationRecords,
  }
}
