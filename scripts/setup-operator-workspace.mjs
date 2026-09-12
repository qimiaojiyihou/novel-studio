import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { bindCreative, defaultCreativeInterfaceDirectory } from './creative-client.mjs'
import { installOperator } from './install-operator-skill.mjs'

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))

export function operatorClientId(projectId, nonce = randomUUID()) {
  if (!String(projectId || '').trim()) throw new Error('缺少项目 ID')
  const projectKey = createHash('sha256').update(String(projectId)).digest('hex').slice(0, 12)
  const machineKey = createHash('sha256').update(String(nonce)).digest('hex').slice(0, 12)
  return `book-${projectKey}-${machineKey}`
}

export function findLocalProjectClients(interfaceDirectory, projectId) {
  const clients = path.join(interfaceDirectory, 'clients')
  if (!fs.existsSync(clients)) return []
  const matches = []
  for (const entry of fs.readdirSync(clients, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    try {
      const value = read(path.join(clients, entry.name))
      if (value.projectId === projectId && value.clientId && value.token && value.serverFile) matches.push(value)
    } catch {}
  }
  return matches
}

export function findLocalProjectClient(interfaceDirectory, projectId) {
  return findLocalProjectClients(interfaceDirectory, projectId)[0] || null
}

export async function setupOperatorWorkspace({
  workspace,
  interfaceDirectory = defaultCreativeInterfaceDirectory(),
  bind = bindCreative,
  install = installOperator,
} = {}) {
  const root = fs.realpathSync(workspace)
  const descriptor = read(path.join(root, '.novel-studio-project.json'))
  if (descriptor.schemaVersion !== 1 || !descriptor.projectId || !descriptor.title) throw new Error('书籍工作区 descriptor 不完整')
  if (fs.existsSync(path.join(root, '.nscollab.json'))) throw new Error('内部 ACP 镜像不能绑定为外部专属任务')
  let binding = null
  const candidates = [...findLocalProjectClients(interfaceDirectory, descriptor.projectId).map(item => item.clientId), operatorClientId(descriptor.projectId)]
  for (const clientId of candidates) {
    try {
      binding = await bind(interfaceDirectory, { clientId, projectId: descriptor.projectId, expectedTitle: descriptor.title })
      break
    } catch (error) {
      if (error.code !== 'BINDING_CONFLICT' || clientId === candidates.at(-1)) throw error
    }
  }
  const installed = await install({
    workspace: root,
    clientFile: binding.clientFile,
    projectId: descriptor.projectId,
    replaceLocalBinding: true,
  })
  return {
    ...installed,
    interfaceDirectory: path.resolve(interfaceDirectory),
    next: '在 Codex 中打开此书籍工作区并新建任务；任务会读取 AGENTS.md，可将 NOVEL-STUDIO-TASK.md 作为首次消息。',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), values = {}
    while (args.length) {
      const key = args.shift(), value = args.shift()
      if (!['--workspace', '--directory'].includes(key) || !value || Object.hasOwn(values, key)) throw new Error('用法：setup-operator-workspace.mjs --workspace 书籍目录 [--directory creative-interface目录]')
      values[key] = value
    }
    if (!values['--workspace']) throw new Error('需要明确书籍工作区路径')
    const result = await setupOperatorWorkspace({ workspace: values['--workspace'], ...(values['--directory'] ? { interfaceDirectory: values['--directory'] } : {}) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: error.code || 'SETUP_ERROR', message: error.message, details: error.details || null })}\n`)
    process.exitCode = 1
  }
}
