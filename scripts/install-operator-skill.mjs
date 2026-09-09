import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { callCreative } from './creative-client.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const digest = data => createHash('sha256').update(data).digest('hex')
const configName = '.novel-studio-operator.json'

function regularPath(root, file) {
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('安装目标越出书籍工作区')
  let cursor = root
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component)
    let stat
    try { stat = fs.lstatSync(cursor) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (stat?.isSymbolicLink()) throw new Error('操作指引安装目标含符号链接')
  }
}

function sourceFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Skill 源文件应为普通文件')
    const relative = path.join(prefix, entry.name), absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(absolute, relative) : [[relative, fs.readFileSync(absolute)]]
  })
}

export async function installOperator({ workspace, clientFile, projectId,
  skillSource = path.resolve(here, '../skills/novel-studio-operator'),
  clientSource = path.join(here, 'creative-client.mjs'), call = callCreative }) {
  const root = fs.realpathSync(workspace), client = fs.realpathSync(clientFile)
  const descriptor = read(path.join(root, '.novel-studio-project.json'))
  if (!projectId || descriptor.projectId !== projectId || fs.existsSync(path.join(root, '.nscollab.json'))) throw new Error('请安装到已核对 ID 的书籍工作区，而非 ACP 镜像')
  const identity = await call(client, 'identity', {})
  if (identity.projectId !== projectId || !identity.clientId) throw new Error('客户端与书籍工作区不属于同一项目')
  const config = { schemaVersion: 1, projectId, clientId: identity.clientId, workspace: root, clientFile: client }
  regularPath(root, path.join(root, configName))
  if (fs.existsSync(path.join(root, configName)) && JSON.stringify(read(path.join(root, configName))) !== JSON.stringify(config)) throw new Error('已有操作绑定不同，保留原文件；请明确核对后再安装')
  const prefix = path.join('.agents', 'skills', 'novel-studio-operator')
  const manifestFile = path.join(root, prefix, '.installed-files.json')
  regularPath(root, manifestFile)
  const previous = fs.existsSync(manifestFile) ? read(manifestFile) : {}
  const files = sourceFiles(skillSource).filter(([name]) => name !== '.installed-files.json')
    .map(([name, data]) => [path.join(prefix, name), data])
  const transport = path.join(prefix, 'scripts', 'creative-client.mjs')
  if (!files.some(([name]) => name === transport)) files.push([transport, fs.readFileSync(clientSource)])
  files.push([configName, Buffer.from(`${JSON.stringify(config, null, 2)}\n`)])
  files.push(['NOVEL-STUDIO-OPERATOR.md', Buffer.from([
    '# Novel Studio 专属任务操作入口', '',
    '外部作家任务先读取 `.agents/skills/novel-studio-operator/SKILL.md`。',
    '从本目录运行 `node .agents/skills/novel-studio-operator/scripts/operate.mjs status` 核验绑定和进度。',
    '仅为操作指引，不替代当前作者要求，不储存正文或凭据。',
    '内部 ACP 候选会话继续使用其明确提供的 .nscollab.json 镜像与 novel-studio-creator。', '',
  ].join('\n'))])
  // Preflight every destination before writing. Never overwrite an author's edited guide.
  for (const [name, data] of files) {
    const target = path.join(root, name)
    regularPath(root, target)
    if (fs.existsSync(target)) {
      const current = digest(fs.readFileSync(target))
      if (current !== digest(data) && current !== previous[name]) throw new Error(`保留已有自定义文件，请先核对：${name}`)
    }
  }
  let changed = 0
  for (const [name, data] of files) {
    const target = path.join(root, name)
    if (fs.existsSync(target) && digest(fs.readFileSync(target)) === digest(data)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.writeFileSync(target, data, { mode: 0o600 })
    changed++
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify(Object.fromEntries(files.map(([name, data]) => [name, digest(data)])), null, 2)}\n`, { mode: 0o600 })
  return { projectId, clientId: identity.clientId, workspace: root, changedFiles: changed, buildId: identity.buildId,
    note: '仅安装操作 Skill 和公开绑定指针；未修改书稿、审批、运行或客户端凭据。' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), values = {}
    while (args.length) {
      const key = args.shift(), value = args.shift()
      if (!['--workspace', '--client', '--project'].includes(key) || !value || Object.hasOwn(values, key)) throw new Error('用法：install-operator-skill.mjs --workspace 书籍目录 --client 本书客户端文件 --project 项目ID')
      values[key] = value
    }
    if (!values['--workspace'] || !values['--client'] || !values['--project']) throw new Error('安装需要明确书籍目录、客户端路径和项目 ID')
    const result = await installOperator({ workspace: values['--workspace'], clientFile: values['--client'], projectId: values['--project'] })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'INSTALL_ERROR', message: error.message })}\n`)
    process.exitCode = 1
  }
}
