import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const CREATIVE_PACK_SCHEMA_VERSION = 1
export const OFFICIAL_PACK_ID = 'official.general-longform.zh-CN'
export const OFFICIAL_PACK_VERSION = '1.1.0'
export const OFFICIAL_PACK_SOURCE = 'official'

const SAFE_WORKFLOW_ACTIONS = new Set([
  'generate',
  'preflight',
  'quality_review',
  'checkpoint',
  'state_extract',
])
const EXECUTABLE_KEYS = new Set(['script', 'scripts', 'command', 'commands', 'exec', 'executable', 'hooks'])
const EXECUTABLE_EXTENSIONS = /\.(?:js|mjs|cjs|ts|go|sh|bash|zsh|command|exe|dll|dylib)$/i

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

function digestInput(pack) {
  const copy = structuredClone(pack)
  copy.manifest ||= {}
  copy.manifest.integrity = { ...(copy.manifest.integrity || {}), sha256: '' }
  return stableStringify(copy)
}

export function creativePackDigest(pack) {
  return createHash('sha256').update(digestInput(pack)).digest('hex')
}

export function sealCreativePack(pack) {
  const sealed = structuredClone(pack)
  sealed.manifest ||= {}
  sealed.manifest.integrity = { algorithm: 'sha256', sha256: '' }
  sealed.manifest.integrity.sha256 = creativePackDigest(sealed)
  return sealed
}

function isSemVer(value) {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ''))
}

function compareSemVer(left, right) {
  const numberParts = (value) => String(value || '0.0.0').split('-')[0].split('.').map(Number)
  const a = numberParts(left)
  const b = numberParts(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  }
  return 0
}

function validateDeclarativeValue(value, trail = '$') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`能力包 ${trail} 包含不可声明式执行内容`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateDeclarativeValue(item, `${trail}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_KEYS.has(key.toLowerCase())) throw new Error(`能力包 ${trail}.${key} 不允许声明可执行入口`)
    if (key.includes('\0') || key.startsWith('/') || key.split(/[\\/]/).includes('..') || EXECUTABLE_EXTENSIONS.test(key)) {
      throw new Error(`能力包路径 ${key} 不安全`)
    }
    validateDeclarativeValue(child, `${trail}.${key}`)
  }
}

export function validateCreativePack(pack, { appVersion = '0.1.0', verifyIntegrity = true } = {}) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('能力包必须是 JSON 对象')
  validateDeclarativeValue(pack)
  const manifest = pack.manifest
  if (!manifest || Number(manifest.schemaVersion) !== CREATIVE_PACK_SCHEMA_VERSION) {
    throw new Error(`仅支持 CreativePackManifest@${CREATIVE_PACK_SCHEMA_VERSION}`)
  }
  for (const field of ['id', 'name', 'version', 'language', 'license', 'minAppVersion']) {
    if (!String(manifest[field] || '').trim()) throw new Error(`能力包清单缺少 ${field}`)
  }
  if (!isSemVer(manifest.version) || !isSemVer(manifest.minAppVersion)) throw new Error('能力包版本与最低应用版本必须使用 SemVer')
  if (compareSemVer(appVersion, manifest.minAppVersion) < 0) {
    throw new Error(`能力包需要 Novel Studio ${manifest.minAppVersion} 或更高版本`)
  }
  if (!Array.isArray(manifest.tasks) || !manifest.tasks.length) throw new Error('能力包至少需要一个任务')
  if (!Array.isArray(manifest.promptProfiles)) throw new Error('能力包 promptProfiles 必须是数组')
  if (!Array.isArray(pack.workflows) || !pack.workflows.length) throw new Error('能力包至少需要一个工作流')
  if (!pack.prompts || typeof pack.prompts !== 'object') throw new Error('能力包缺少 prompts')
  if (!pack.schemas || typeof pack.schemas !== 'object') throw new Error('能力包缺少 schemas')
  for (const workflow of pack.workflows) {
    if (Number(workflow.schemaVersion) !== 1 || !workflow.id || !Array.isArray(workflow.steps)) throw new Error('工作流格式无效')
    const ids = new Set()
    for (const step of workflow.steps) {
      if (!step.id || ids.has(step.id)) throw new Error(`工作流 ${workflow.id} 的步骤 ID 缺失或重复`)
      ids.add(step.id)
      if (!SAFE_WORKFLOW_ACTIONS.has(step.action)) throw new Error(`工作流动作 ${step.action} 未被允许`)
      if (step.task && !manifest.tasks.includes(step.task)) throw new Error(`工作流引用了未声明任务 ${step.task}`)
    }
  }
  for (const task of manifest.tasks) {
    if (!pack.prompts[task]) throw new Error(`能力包缺少任务模板 ${task}`)
  }
  const actualDigest = creativePackDigest(pack)
  if (verifyIntegrity && manifest.integrity?.sha256 !== actualDigest) throw new Error('能力包摘要不匹配，文件可能已被修改')
  return { valid: true, digest: actualDigest, manifest }
}

export function loadCreativePackFile(filePath, options) {
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) throw new Error('能力包超过 10 MB')
  const pack = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  validateCreativePack(pack, options)
  return pack
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback } catch { return fallback }
}

function mapPackRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    license: row.license,
    source: row.source,
    currentVersion: row.current_version,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapVersionRow(row, { includeContent = true } = {}) {
  if (!row) return null
  return {
    id: row.id,
    packId: row.pack_id,
    version: row.version,
    minAppVersion: row.min_app_version,
    digest: row.digest,
    manifest: parseJson(row.manifest_json, {}),
    content: includeContent ? parseJson(row.content_json, {}) : undefined,
    installedAt: row.installed_at,
  }
}

export function bindDefaultCreativePack(database, projectId, {
  boundAt = new Date().toISOString(),
} = {}) {
  const existing = database.prepare('SELECT * FROM project_pack_bindings WHERE project_id = ?').get(projectId)
  if (existing) return existing
  const project = database.prepare('SELECT id, project_type FROM projects WHERE id = ?').get(projectId)
  if (!project) throw new Error('项目不存在')
  if (project.project_type !== 'user') return null
  const pack = database.prepare(`
    SELECT p.id, p.current_version
    FROM creative_packs p
    JOIN creative_pack_versions v ON v.pack_id = p.id AND v.version = p.current_version
    WHERE p.source = 'official' AND p.enabled = 1
    ORDER BY p.updated_at DESC
    LIMIT 1
  `).get()
  if (!pack) throw new Error('缺少可用的官方 Creative Pack')
  database.prepare(`
    INSERT INTO project_pack_bindings (id, project_id, pack_id, pack_version, bound_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`pack-binding-${projectId}`, projectId, pack.id, pack.current_version, boundAt, boundAt)
  return database.prepare('SELECT * FROM project_pack_bindings WHERE project_id = ?').get(projectId)
}

export function repairMissingCreativePackBindings(database, {
  boundAt = new Date().toISOString(),
} = {}) {
  const projects = database.prepare(`
    SELECT p.id
    FROM projects p
    LEFT JOIN project_pack_bindings b ON b.project_id = p.id
    WHERE p.project_type = 'user' AND b.project_id IS NULL
    ORDER BY p.created_at
  `).all()
  for (const project of projects) bindDefaultCreativePack(database, project.id, { boundAt })
  return projects.length
}

export function createCreativePackRepository(database, { appVersion = '0.1.0', now = () => new Date().toISOString() } = {}) {
  function installPack(pack, { source = 'user', bindProjectId = '' } = {}) {
    const validation = validateCreativePack(pack, { appVersion })
    const manifest = validation.manifest
    const installedAt = now()
    const transaction = database.transaction(() => {
      database.prepare(`
        INSERT INTO creative_packs (id, name, language, license, source, current_version, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, language = excluded.language,
          license = excluded.license, current_version = excluded.current_version, enabled = 1, updated_at = excluded.updated_at
      `).run(manifest.id, manifest.name, manifest.language, manifest.license, source, manifest.version, installedAt, installedAt)
      database.prepare(`
        INSERT INTO creative_pack_versions (id, pack_id, version, min_app_version, digest, manifest_json, content_json, installed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pack_id, version) DO UPDATE SET digest = excluded.digest,
          manifest_json = excluded.manifest_json, content_json = excluded.content_json
      `).run(`${manifest.id}@${manifest.version}`, manifest.id, manifest.version, manifest.minAppVersion,
        validation.digest, JSON.stringify(manifest), JSON.stringify(pack), installedAt)
      if (bindProjectId) bindProject(bindProjectId, manifest.id, manifest.version)
    })
    transaction()
    return getPack(manifest.id, manifest.version)
  }

  function listPacks({ includeDisabled = false } = {}) {
    const rows = database.prepare(`SELECT * FROM creative_packs ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY source, name`).all()
    return rows.map((row) => ({
      ...mapPackRow(row),
      versions: database.prepare('SELECT * FROM creative_pack_versions WHERE pack_id = ? ORDER BY installed_at DESC').all(row.id)
        .map((version) => mapVersionRow(version, { includeContent: false })),
    }))
  }

  function getPack(packId, version = '') {
    const pack = mapPackRow(database.prepare('SELECT * FROM creative_packs WHERE id = ?').get(packId))
    if (!pack) return null
    const targetVersion = version || pack.currentVersion
    const versionRow = mapVersionRow(database.prepare('SELECT * FROM creative_pack_versions WHERE pack_id = ? AND version = ?').get(packId, targetVersion))
    return { ...pack, version: versionRow }
  }

  function getProjectBinding(projectId) {
    const row = database.prepare(`
      SELECT b.*, p.name, p.language, p.license, p.source, v.digest, v.manifest_json, v.content_json
      FROM project_pack_bindings b
      JOIN creative_packs p ON p.id = b.pack_id
      JOIN creative_pack_versions v ON v.pack_id = b.pack_id AND v.version = b.pack_version
      WHERE b.project_id = ?
    `).get(projectId)
    if (!row) return null
    return {
      projectId: row.project_id,
      packId: row.pack_id,
      version: row.pack_version,
      digest: row.digest,
      name: row.name,
      source: row.source,
      manifest: parseJson(row.manifest_json, {}),
      content: parseJson(row.content_json, {}),
      boundAt: row.bound_at,
      updatedAt: row.updated_at,
    }
  }

  function bindProject(projectId, packId, version = '') {
    const pack = getPack(packId, version)
    if (!pack?.version) throw new Error('能力包或版本不存在')
    const updatedAt = now()
    database.prepare(`
      INSERT INTO project_pack_bindings (id, project_id, pack_id, pack_version, bound_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET pack_id = excluded.pack_id, pack_version = excluded.pack_version, updated_at = excluded.updated_at
    `).run(`pack-binding-${projectId}`, projectId, packId, pack.version.version, updatedAt, updatedAt)
    return getProjectBinding(projectId)
  }

  function upgradePreview(projectId, packId, version) {
    const current = getProjectBinding(projectId)
    const target = getPack(packId, version)
    if (!target?.version) throw new Error('目标能力包版本不存在')
    const currentContent = current?.content || {}
    const targetContent = target.version.content || {}
    const changedTasks = [...new Set([
      ...Object.keys(currentContent.prompts || {}),
      ...Object.keys(targetContent.prompts || {}),
    ])].filter((task) => stableStringify(currentContent.prompts?.[task]) !== stableStringify(targetContent.prompts?.[task]))
    return {
      current: current ? { id: current.packId, version: current.version, digest: current.digest } : null,
      target: { id: target.id, version: target.version.version, digest: target.version.digest },
      changedTasks,
      changedWorkflows: stableStringify(currentContent.workflows || []) !== stableStringify(targetContent.workflows || []),
      requiresConfirmation: !current || current.packId !== target.id || current.version !== target.version.version,
    }
  }

  return { installPack, listPacks, getPack, getProjectBinding, bindProject, upgradePreview }
}

export function readBundledOfficialPack(baseDirectory) {
  const candidates = [
    path.join(baseDirectory, 'creative-packs', 'dist', `general-longform-${OFFICIAL_PACK_VERSION}.nspack.json`),
    path.join(baseDirectory, '..', 'creative-packs', 'dist', `general-longform-${OFFICIAL_PACK_VERSION}.nspack.json`),
  ]
  const filePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!filePath) throw new Error('安装包缺少官方通用长篇能力包')
  return loadCreativePackFile(filePath, { appVersion: '0.1.0' })
}

export function newPackId(prefix) {
  return `${prefix}-${randomUUID()}`
}
