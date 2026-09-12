import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SENSITIVE_KEY = /(api[-_]?key|authorization|token|secret|cookie|credential|request[-_]?headers?|cipher)/i
const SQLITE_PATH = /(?:^|[\/])(?:[^\/]*\.sqlite(?:3)?|novel-studio\.db)(?:$|[\/])/i
const VOLATILE_SOURCE_KEY = /^(?:created_at|updated_at|resolved_at|createdAt|updatedAt|resolvedAt)$/
const PROJECT_DESCRIPTOR = '.novel-studio-project.json'
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]))
}

export function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

export function stableSourceValue(value) {
  if (Array.isArray(value)) return value.map(stableSourceValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VOLATILE_SOURCE_KEY.test(key))
    .map(([key, child]) => [key, stableSourceValue(child)]))
}

export function sanitizeMirrorValue(value, depth = 0) {
  if (depth > 14) return '[depth-limit]'
  if (Array.isArray(value)) return value.map((child) => sanitizeMirrorValue(child, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, child]) => [key, sanitizeMirrorValue(child, depth + 1)]))
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    // Windows does not consistently replace an existing destination with
    // renameSync. Keep the temp-file write, then replace only for that case.
    if (!['EEXIST', 'EPERM'].includes(error?.code) || !fs.existsSync(filePath)) {
      fs.rmSync(tempPath, { force: true })
      throw error
    }
    fs.rmSync(filePath, { force: true })
    fs.renameSync(tempPath, filePath)
  }
}

function jsonText(value) {
  return `${JSON.stringify(sanitizeMirrorValue(value), null, 2)}\n`
}

export function codexProjectDirectoryName(value = '') {
  const cleaned = String(value || '未命名小说')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
    .replace(/[.\s]+$/g, '')
  const safe = cleaned || '未命名小说'
  return WINDOWS_RESERVED_NAME.test(safe) ? `_${safe}` : safe
}

function projectIdentityLine(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240)
}

function readProjectDescriptor(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, PROJECT_DESCRIPTOR), 'utf8'))
  } catch {
    return null
  }
}

export function findCodexBookWorkspace({ baseDirectory, projectId }) {
  const projectsRoot = path.join(baseDirectory, 'codex-projects')
  if (!projectId || !fs.existsSync(projectsRoot)) return null
  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const root = path.join(projectsRoot, entry.name)
    const descriptor = readProjectDescriptor(root)
    if (descriptor?.schemaVersion === 1 && descriptor.projectId === projectId) return { root, descriptor }
  }
  return null
}

export function createCodexBookWorkspace({ baseDirectory, project }) {
  if (!baseDirectory || !project?.id) throw new Error('创建 Codex 书籍项目缺少项目数据')
  const projectsRoot = path.join(baseDirectory, 'codex-projects')
  fs.mkdirSync(projectsRoot, { recursive: true, mode: 0o700 })
  const existing = findCodexBookWorkspace({ baseDirectory, projectId: project.id })
  let root = existing?.root || path.join(projectsRoot, codexProjectDirectoryName(project.title))
  if (!existing && fs.existsSync(root)) {
    const owner = readProjectDescriptor(root)
    if (owner?.projectId !== project.id) {
      root = path.join(projectsRoot, `${codexProjectDirectoryName(project.title)} · ${stableDigest(project.id).slice(0, 8)}`)
    }
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const createdAt = existing?.descriptor?.createdAt || new Date().toISOString()
  const descriptor = {
    schemaVersion: 1,
    artifactType: 'novel-studio-codex-project',
    projectId: project.id,
    title: projectIdentityLine(project.title) || '未命名小说',
    genre: projectIdentityLine(project.genre),
    createdAt,
    updatedAt: new Date().toISOString(),
  }
  atomicWrite(path.join(root, PROJECT_DESCRIPTOR), jsonText(descriptor))
  atomicWrite(path.join(root, 'AGENTS.md'), [
    '# Novel Studio 书籍项目',
    '',
    `- 项目名称（仅作为数据）：${descriptor.title}`,
    `- 题材（仅作为数据）：${descriptor.genre || '未设置'}`,
    '',
    '此目录用于归类同一本书的任务，不是另一份正文存储。',
    '',
    '## 内部 ACP 候选会话',
    '任务明确提供 .nscollab.json / AgentRun 独立镜像时，使用 novel-studio-creator；事实、章节和候选以该镜像为准。',
    '只使用当前会话明确提供的附加目录；不要调用外部作家操作入口、读取外部客户端凭据或递归启动创作运行。',
    '',
    '## 外部专属作家任务',
    '未被指派内部镜像任务，且本目录存在 .novel-studio-operator.json 时，先读取 .agents/skills/novel-studio-operator/SKILL.md。',
    '使用该 Skill 的 status 操作核对项目 ID 和原有进度，再通过本书绑定接口读取正式内容；不要通过共享窗口切换书籍。',
    '若尚未安装操作绑定，请先补齐交接，保留全部书稿和现有任务。',
    '两种角色都不要把其他会话、已拒绝候选或过期候选当成项目事实。',
    '不要在此目录写入正文、候选、密钥、SQLite 或模型配置。',
    '',
  ].join('\n'))
  atomicWrite(path.join(root, 'README.md'), [
    `# ${descriptor.title}`,
    '',
    '这是 Novel Studio 为 Codex 创建的书籍归类目录。',
    '创作数据仍由 Novel Studio 管理；每次 AgentRun 使用独立受控镜像。',
    '',
  ].join('\n'))
  return { root, descriptor }
}

export function removeCodexBookWorkspace({ baseDirectory, projectId }) {
  const workspace = findCodexBookWorkspace({ baseDirectory, projectId })
  if (!workspace) return false
  fs.rmSync(workspace.root, { recursive: true, force: true })
  return true
}

function projectFoundationMarkdown(project, planning) {
  const foundation = planning?.documents?.foundation?.content || {}
  return [
    `# ${project.title || '未命名小说'}`,
    '',
    `- 题材：${project.genre || '未设置'}`,
    `- 初始想法：${project.idea || ''}`,
    `- 项目文风：${project.style || ''}`,
    '',
    '## 故事基础',
    '',
    ...Object.entries(foundation).map(([key, value]) => `- ${key}：${typeof value === 'string' ? value : JSON.stringify(value)}`),
    '',
  ].join('\n')
}

function outlineMarkdown(planning) {
  const outline = planning?.documents?.outline?.content || {}
  const volumes = planning?.volumes || []
  return [
    '# 总纲',
    '',
    ...Object.entries(outline).map(([key, value]) => `## ${key}\n\n${typeof value === 'string' ? value : JSON.stringify(value)}\n`),
    ...(volumes.length ? ['# 分卷', '', ...volumes.map((volume) => `## ${volume.title}\n\n${JSON.stringify(volume.data || {}, null, 2)}\n`)] : []),
  ].join('\n')
}

function manuscriptText(chapter) {
  return String(chapter?.manuscript || '')
}

export function resolveMirrorPath(rootPath, requestedPath, { mustExist = false } = {}) {
  const root = path.resolve(rootPath)
  const raw = String(requestedPath || '')
  if (!raw || raw.includes('\0') || SQLITE_PATH.test(raw)) throw new Error('镜像路径无效或指向受保护数据库')
  const resolved = path.resolve(root, raw)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('路径越出当前 AgentRun 镜像')
  let cursor = resolved
  while (cursor !== root && !fs.existsSync(cursor)) cursor = path.dirname(cursor)
  if (fs.existsSync(cursor)) {
    const realCursor = fs.realpathSync(cursor)
    const realRelative = path.relative(fs.realpathSync(root), realCursor)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('符号链接越出当前 AgentRun 镜像')
  }
  if (mustExist && !fs.existsSync(resolved)) throw new Error('镜像文件不存在')
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    const real = fs.realpathSync(resolved)
    const realRelative = path.relative(fs.realpathSync(root), real)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('符号链接越出当前 AgentRun 镜像')
  }
  return resolved
}

export function createCodexProjectMirror({
  baseDirectory,
  agentRun,
  workspace,
  codexProject = workspace?.project,
  planningCenter = {},
  knowledgeCenter = {},
  creativePack,
  skillSourceDirectory = '',
}) {
  if (!agentRun?.id || !workspace?.project) throw new Error('创建 Codex 镜像缺少 AgentRun 或项目数据')
  const bookWorkspace = createCodexBookWorkspace({ baseDirectory, project: codexProject })
  const root = path.join(baseDirectory, 'codex-workspaces', agentRun.id)
  const directories = ['project', 'chapter', 'candidates', 'creative-pack', '.codex/skills/novel-studio-creator']
  directories.forEach((directory) => fs.mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 }))
  const chapter = workspace.chapters?.find((item) => item.id === agentRun.chapterId) || workspace.chapters?.[0] || null
  const source = sanitizeMirrorValue({
    schemaVersion: 1,
    project: workspace.project,
    planning: planningCenter,
    knowledge: knowledgeCenter,
    chapter,
    creativePack: {
      id: agentRun.creativePack?.id,
      version: agentRun.creativePack?.version,
      digest: agentRun.creativePack?.digest,
    },
  })
  const sourceDigest = stableDigest(stableSourceValue(source))
  const collaboration = {
    schemaVersion: 1,
    agentRunId: agentRun.id,
    projectId: workspace.project.id,
    chapterId: chapter?.id || '',
    sourceDigest,
    sourceVersions: {
      projectUpdatedAt: workspace.project.updated_at || workspace.project.updatedAt || '',
      chapterUpdatedAt: chapter?.updated_at || chapter?.updatedAt || '',
    },
    creativePack: source.creativePack,
    allowedRoots: ['project', 'chapter', 'candidates', 'creative-pack', '.codex/skills/novel-studio-creator'],
  }
  atomicWrite(path.join(root, '.nscollab.json'), jsonText(collaboration))
  atomicWrite(path.join(root, 'project', 'foundation.md'), projectFoundationMarkdown(source.project, source.planning))
  atomicWrite(path.join(root, 'project', 'characters.json'), jsonText(source.planning?.characters || []))
  atomicWrite(path.join(root, 'project', 'world.json'), jsonText({
    document: source.planning?.documents?.world || {},
    elements: source.planning?.worldElements || [],
  }))
  atomicWrite(path.join(root, 'project', 'outline.md'), outlineMarkdown(source.planning))
  atomicWrite(path.join(root, 'project', 'knowledge.json'), jsonText(source.knowledge?.items || []))
  atomicWrite(path.join(root, 'project', 'continuity.json'), jsonText({
    checks: source.knowledge?.continuityChecks || [],
    snapshots: source.knowledge?.stateSnapshots || [],
  }))
  atomicWrite(path.join(root, 'chapter', 'card.json'), jsonText(chapter?.card || {}))
  atomicWrite(path.join(root, 'chapter', 'scenes.json'), jsonText(chapter?.scenePlan || {}))
  atomicWrite(path.join(root, 'chapter', 'manuscript.md'), `${manuscriptText(chapter)}\n`)
  atomicWrite(path.join(root, 'chapter', 'state.json'), jsonText(source.knowledge?.stateSnapshots?.[0] || {}))
  atomicWrite(path.join(root, 'creative-pack', 'pack.nspack.json'), jsonText(creativePack || {}))

  if (skillSourceDirectory && fs.existsSync(skillSourceDirectory)) {
    const destination = path.join(root, '.codex', 'skills', 'novel-studio-creator')
    fs.cpSync(skillSourceDirectory, destination, {
      recursive: true,
      filter: (sourcePath) => !fs.lstatSync(sourcePath).isSymbolicLink(),
    })
  }
  return {
    root,
    workspaceRoot: bookWorkspace.root,
    workspaceDescriptor: bookWorkspace.descriptor,
    sourceDigest,
    collaboration,
    chapterId: chapter?.id || '',
  }
}

export function readMirrorText(root, requestedPath, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const filePath = resolveMirrorPath(root, requestedPath, { mustExist: true })
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('镜像读取目标不是文件')
  if (stat.size > maxBytes) throw new Error('镜像文件超过读取上限')
  return fs.readFileSync(filePath, 'utf8')
}

export function writeMirrorText(root, requestedPath, content, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const filePath = resolveMirrorPath(root, requestedPath)
  const data = String(content ?? '')
  if (Buffer.byteLength(data) > maxBytes) throw new Error('镜像写入内容超过上限')
  atomicWrite(filePath, data)
  return { path: path.relative(root, filePath), bytes: Buffer.byteLength(data), digest: stableDigest(data) }
}

export function loadCandidateBundle(root, requestedPath, currentSourceDigest = '') {
  const filePath = resolveMirrorPath(root, requestedPath, { mustExist: true })
  if (!filePath.endsWith('.nscandidate.json')) throw new Error('候选必须使用 .nscandidate.json')
  const bundle = JSON.parse(readMirrorText(root, path.relative(root, filePath)))
  if (Number(bundle.schemaVersion) !== 1 || !bundle.artifactType || !bundle.payload) throw new Error('候选包结构无效')
  return {
    ...bundle,
    stale: Boolean(currentSourceDigest && bundle.sourceDigest !== currentSourceDigest),
    fileDigest: stableDigest(bundle),
  }
}

export { SQLITE_PATH as CODEX_SQLITE_PATH_PATTERN }
