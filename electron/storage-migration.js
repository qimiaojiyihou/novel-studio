import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { LIBRARY_ASSETS, LIBRARY_DATABASE, assertMigrationPlan, validateStorageTarget } from './storage-location.js'

const quote = name => `"${name.replaceAll('"', '""')}"`
const stringify = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item)

export function libraryManifest(database, progress = () => {}) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
  const result = { schema: createHash('sha256').update(stringify(schema)).digest('hex'), tables: {} }
  for (const { name } of tables) {
    progress(`核对数据表：${name}`)
    const primary = database.prepare(`PRAGMA table_info(${quote(name)})`).all().filter(column => column.pk).sort((a,b) => a.pk-b.pk)
    const order = primary.length ? primary.map(column => quote(column.name)).join(',') : 'rowid'
    const rows = database.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${order}`)
    rows.setReadBigInts(true)
    const digest = createHash('sha256')
    let count = 0
    for (const row of rows.iterate()) { digest.update(stringify(row)).update('\n'); count++ }
    result.tables[name] = { count, digest: digest.digest('hex') }
  }
  return result
}

async function assetsManifest(directory, progress) {
  const manifest = {}
  async function visit(relative) {
    const file = path.join(directory, relative)
    const stat = await fsp.lstat(file)
    if (stat.isSymbolicLink()) throw new Error(`书库附属目录含符号链接，请先处理：${relative}`)
    if (stat.isDirectory()) {
      manifest[relative] = 'directory'
      for (const name of (await fsp.readdir(file)).sort()) await visit(path.join(relative, name))
    } else if (stat.isFile()) {
      progress(`核对附属文件：${relative}`)
      const hash = createHash('sha256')
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
      manifest[relative] = { size: stat.size, digest: hash.digest('hex') }
    } else throw new Error(`书库附属目录含特殊文件：${relative}`)
  }
  for (const name of LIBRARY_ASSETS) if (fs.existsSync(path.join(directory, name))) await visit(name)
  return manifest
}

export async function migrateStorage(pending, { progress = () => {}, beforePublish = () => {}, availableBytes } = {}) {
  assertMigrationPlan(pending)
  const { source, target } = validateStorageTarget(pending.sourceDirectory, pending.targetDirectory, pending.jobId)
  const sourceFile = path.join(source, LIBRARY_DATABASE)
  if (!fs.existsSync(sourceFile)) throw new Error('源书库数据库不存在，迁移已停止')
  const markerFile = path.join(target, '.novel-studio-migration.json')
  const marker = fs.existsSync(markerFile) ? JSON.parse(await fsp.readFile(markerFile, 'utf8')) : null
  const stage = path.join(target, `.migration-${pending.jobId}`)
  progress('检查空间和附属文件；原目录保持不变')
  const sourceAssets = await assetsManifest(source, progress)
  const assetBytes = Object.values(sourceAssets).reduce((total, item) => total + (item.size || 0), 0)
  const disk = await fsp.statfs(target)
  const free = availableBytes ?? disk.bavail * disk.bsize
  const required = fs.statSync(sourceFile).size + assetBytes + 64 * 1024 * 1024
  if (!marker && free < required) throw new Error(`目标空间不足：至少需要 ${Math.ceil(required / 1024 / 1024)} MB。原书库未改变`)
  let sourceDatabase, destinationDatabase
  try {
    sourceDatabase = new DatabaseSync(sourceFile, { readOnly: true })
    sourceDatabase.exec('PRAGMA busy_timeout=1000')
    const sourceVersion = sourceDatabase.prepare('PRAGMA data_version').get().data_version
    const sourceManifest = libraryManifest(sourceDatabase, progress)
    if (!marker) {
      await fsp.writeFile(markerFile, JSON.stringify({ jobId: pending.jobId, state: 'copying' }), { flag: 'wx', mode: 0o600 })
      await fsp.mkdir(stage, { mode: 0o700 })
    }
    // A previously interrupted copy is deliberately not overwritten. A verified
    // publication can be completed after a crash; a partial one needs a new folder.
    if (marker && marker.state !== 'verified') throw new Error('发现未完成的迁移文件，请保留它们并另选空目录重试')
    const destination = marker ? target : stage
    const destinationFile = path.join(destination, LIBRARY_DATABASE)
    if (!marker) {
      progress('复制一致性书库快照，并回收数据库内部空闲页')
      sourceDatabase.exec(`VACUUM INTO '${destinationFile.replaceAll("'", "''")}'`)
      await fsp.chmod(destinationFile, 0o600)
      for (const name of LIBRARY_ASSETS) if (fs.existsSync(path.join(source, name))) {
        progress(`复制 ${name}`)
        await fsp.cp(path.join(source, name), path.join(stage, name), { recursive: true, errorOnExist: true, force: false })
      }
    }
    progress('校验新书库完整性、书稿、版本、候选、审批及运行记录')
    destinationDatabase = new DatabaseSync(destinationFile, { readOnly: true })
    if (destinationDatabase.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw new Error('新书库完整性校验未通过')
    if (destinationDatabase.prepare('PRAGMA foreign_key_check').all().length) throw new Error('新书库项目关联校验未通过')
    const destinationManifest = libraryManifest(destinationDatabase, progress)
    if (stringify(sourceManifest) !== stringify(destinationManifest)) throw new Error('新旧书库内容校验不一致，保持原目录')
    const targetAssets = await assetsManifest(destination, progress)
    if (stringify(sourceAssets) !== stringify(targetAssets)) throw new Error('附属文件校验不一致，保持原目录')
    destinationDatabase.close(); destinationDatabase = null
    await beforePublish()
    if (sourceDatabase.prepare('PRAGMA data_version').get().data_version !== sourceVersion) throw new Error('迁移期间源书库发生变化，保持原目录')
    if (!marker) {
      progress('校验通过，准备切换目录')
      // The location config is switched only after all files are published.
      // A partial publication stays inactive and is preserved for diagnosis.
      for (const name of [LIBRARY_DATABASE, ...LIBRARY_ASSETS]) if (fs.existsSync(path.join(stage, name))) await fsp.rename(path.join(stage, name), path.join(target, name))
      await fsp.rmdir(stage)
      await fsp.writeFile(markerFile, JSON.stringify({ jobId: pending.jobId, state: 'verified' }), { mode: 0o600 })
    }
    return { directory: target, verification: { tables: Object.keys(sourceManifest.tables).length,
      rows: Object.values(sourceManifest.tables).reduce((sum,item) => sum+item.count,0),
      manifestDigest: createHash('sha256').update(stringify(sourceManifest)).digest('hex'),
      sourceBytes: fs.statSync(sourceFile).size, destinationBytes: fs.statSync(path.join(target, LIBRARY_DATABASE)).size } }
  } finally { destinationDatabase?.close(); sourceDatabase?.close() }
}
