import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const LIBRARY_DATABASE = 'novel-studio.sqlite'
export const LIBRARY_ASSETS = ['codex-projects', 'codex-workspaces', 'backups', 'service-data']
const CONFIG_NAME = 'library-location.json'
const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function assertMigrationPlan(pending) {
  if (!pending || !JOB_ID.test(pending.jobId || '') || !path.isAbsolute(pending.sourceDirectory || '')
    || !path.isAbsolute(pending.targetDirectory || '')) throw new Error('书库迁移计划无效，请取消并重新选择目录')
}

export function readStorageConfig(bootstrapDirectory) {
  const file = path.join(bootstrapDirectory, CONFIG_NAME)
  if (!fs.existsSync(file)) return { schemaVersion: 1, directory: bootstrapDirectory }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (config.schemaVersion !== 1 || !path.isAbsolute(config.directory || '')) throw new Error('书库位置配置无效，请检查 library-location.json')
  if (config.pending) {
    assertMigrationPlan(config.pending)
    if (path.resolve(config.pending.sourceDirectory) !== path.resolve(config.directory)) throw new Error('迁移源与当前书库位置不一致，请核对 library-location.json')
  }
  return config
}

export function writeStorageConfig(bootstrapDirectory, config) {
  fs.mkdirSync(bootstrapDirectory, { recursive: true })
  const file = path.join(bootstrapDirectory, CONFIG_NAME)
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(handle, JSON.stringify(config, null, 2)); fs.fsyncSync(handle) }
  finally { fs.closeSync(handle) }
  fs.renameSync(temporary, file)
}

export function resolveStorageDirectory(bootstrapDirectory) {
  const config = readStorageConfig(bootstrapDirectory)
  const directory = path.resolve(config.directory)
  // An unplugged custom drive must never silently become a new empty library.
  if (directory !== path.resolve(bootstrapDirectory)
    && (!fs.existsSync(directory) || !fs.existsSync(path.join(directory, LIBRARY_DATABASE)))) {
    throw new Error(`书库目录未就绪：${directory}。请连接原磁盘后重试；原目录保留在 ${config.previousDirectory || bootstrapDirectory}`)
  }
  return directory
}

const within = (parent, child) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }

export function validateStorageTarget(sourceDirectory, targetDirectory, jobId = '') {
  if (!path.isAbsolute(targetDirectory || '')) throw new Error('请选择绝对路径的数据目录')
  const source = fs.realpathSync(sourceDirectory)
  const target = fs.realpathSync(targetDirectory)
  if (!fs.statSync(target).isDirectory()) throw new Error('目标需要是文件夹')
  if (within(source, target) || within(target, source)) throw new Error('目标与当前书库目录应相互独立，避免嵌套复制')
  const entries = fs.readdirSync(target)
  const marker = path.join(target, '.novel-studio-migration.json')
  if (entries.length) {
    const owned = jobId && fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).jobId === jobId
    if (!owned) throw new Error('请选择空文件夹；现有文件和书库不会被覆盖')
  }
  return { source, target }
}

export function queueStorageMigration(bootstrapDirectory, targetDirectory) {
  const config = readStorageConfig(bootstrapDirectory)
  if (config.pending) throw new Error('已有待执行迁移，请先执行或取消')
  const sourceDirectory = resolveStorageDirectory(bootstrapDirectory)
  const { target } = validateStorageTarget(sourceDirectory, targetDirectory)
  const pending = { jobId: randomUUID(), sourceDirectory, targetDirectory: target, requestedAt: new Date().toISOString() }
  writeStorageConfig(bootstrapDirectory, { ...config, pending, lastError: '' })
  return pending
}

export function cancelStorageMigration(bootstrapDirectory) {
  const config = readStorageConfig(bootstrapDirectory)
  delete config.pending
  writeStorageConfig(bootstrapDirectory, config)
}

export function commitStorageMigration(bootstrapDirectory, pending, result) {
  const config = readStorageConfig(bootstrapDirectory)
  if (config.pending?.jobId !== pending.jobId || result.directory !== pending.targetDirectory) throw new Error('迁移计划发生变化，保持原书库位置')
  writeStorageConfig(bootstrapDirectory, {
    schemaVersion: 1, directory: result.directory, previousDirectory: pending.sourceDirectory,
    migratedAt: new Date().toISOString(), verification: result.verification,
  })
}
