import fs from 'node:fs'
import path from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import { CODEX_COMPONENT_TARGETS, codexVersion } from './codex-component-manager.js'

const REGISTRY = 'https://registry.npmjs.org'
const MAX_PACKAGE = 256 * 1024 * 1024

export function officialCodexUrl(value) {
  const url = new URL(value)
  if (url.origin !== REGISTRY || url.username || url.password || url.hash || url.search
    || !url.pathname.startsWith('/@openai/')) throw new Error('Codex 组件下载地址不属于官方 npm 包')
  return url.href
}

async function metadata(version, fetchImpl) {
  const response = await fetchImpl(`${REGISTRY}/@openai%2Fcodex/${version}`, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`官方 Codex 组件目录请求失败（${response.status}）`)
  const body = await response.text()
  if (body.length > 1024 * 1024) throw new Error('官方组件目录响应过大')
  const result = JSON.parse(body)
  if (result.name !== '@openai/codex') throw new Error('官方组件包身份异常')
  return result
}

export async function downloadCodexPackage(info, destination, fetchImpl = fetch) {
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(info.dist?.integrity || '')) throw new Error('官方包缺少 SHA-512 校验摘要')
  const response = await fetchImpl(officialCodexUrl(info.dist.tarball), { redirect: 'error', signal: AbortSignal.timeout(180000) })
  if (!response.ok || !response.body) throw new Error(`组件下载失败（${response.status}）`)
  const hash = createHash('sha512'); let bytes = 0
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length
    if (bytes > MAX_PACKAGE) return callback(new Error('Codex 组件包超过大小限制'))
    hash.update(chunk); callback(null, chunk)
  } })
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  if (!timingSafeEqual(hash.digest(), Buffer.from(info.dist.integrity.slice(7), 'base64'))) throw new Error('Codex 组件包 SHA-512 摘要不匹配')
}

export async function extractCodexPackage(file, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  let extracted = 0, entries = 0, rejected = null
  await tar.x({ file, cwd: destination, strip: 1, strict: true, preservePaths: false,
    filter: (name, entry) => {
      const parts = name.replaceAll('\\', '/').split('/')
      if (parts[0] !== 'package' || parts.some(part => part === '..') || /^[a-z]:/i.test(name)
        || !['File', 'Directory'].includes(entry.type)) rejected ||= new Error('Codex 组件包含异常路径或链接')
      extracted += Number(entry.size || 0); entries++
      if (extracted > 1024 * 1024 * 1024 || entries > 20000) rejected ||= new Error('Codex 组件解包超过限制')
      // tar invokes filters from stream callbacks: throwing here escapes its Promise.
      // Skip rejected entries and report through the awaited extraction instead.
      return !rejected
    },
  })
  if (rejected) throw rejected
}

export async function prepareCodexComponent({ action, directory, target, adapterRoot }, onProgress = () => {}, fetchImpl = fetch) {
  const platform = CODEX_COMPONENT_TARGETS[target]
  if (!platform) throw new Error('Codex 组件平台不受支持')
  const latest = await metadata('latest', fetchImpl)
  const version = codexVersion(latest.version)
  if (action === 'check') return { version }
  if (action !== 'download') throw new Error('Codex 组件操作不受支持')
  const native = await metadata(`${version}-${target}`, fetchImpl)
  if (native.version !== `${version}-${target}` || !native.os?.includes(target.split('-')[0]) || !native.cpu?.includes(target.split('-')[1])) throw new Error('Codex 平台包版本或架构不匹配')
  const stage = fs.mkdtempSync(path.join(directory, 'download-'))
  const output = path.join(stage, target)
  try {
    fs.mkdirSync(output, { recursive: true })
    onProgress(`正在下载 Codex ${version}（${target}）…`)
    for (const [name, info] of [['codex', latest], [platform[0], native]]) {
      const archive = path.join(stage, `${name}.tgz`)
      await downloadCodexPackage(info, archive, fetchImpl)
      await extractCodexPackage(archive, path.join(output, name))
      const pkg = JSON.parse(fs.readFileSync(path.join(output, name, 'package.json'), 'utf8'))
      if (pkg.name !== '@openai/codex' || pkg.version !== info.version) throw new Error('组件解包后的身份不匹配')
    }
    // Keep the tested ACP adapter pinned; this update only replaces the CLI.
    fs.mkdirSync(path.join(output, 'codex-acp', 'dist'), { recursive: true })
    for (const [source, destination] of [[adapterRoot.adapterPath, 'dist/index.js'], [adapterRoot.adapterPackagePath, 'package.json'], [path.join(path.dirname(adapterRoot.adapterPackagePath), 'LICENSE'), 'LICENSE']]) {
      fs.copyFileSync(source, path.join(output, 'codex-acp', destination))
    }
    const adapter = JSON.parse(fs.readFileSync(path.join(output, 'codex-acp', 'package.json'), 'utf8'))
    const cli = path.join(output, platform[0], 'vendor', platform[1], 'bin', platform[2])
    if (process.platform !== 'win32') fs.chmodSync(cli, 0o755)
    const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const manifest = { schemaVersion: 1, target, adapterVersion: adapter.version, cliVersion: version,
      registry: REGISTRY, downloadedAt: new Date().toISOString(), packageIntegrity: { cli: latest.dist.integrity, native: native.dist.integrity },
      capabilities: { execOutputSchema: true }, files: { adapter: digest(path.join(output, 'codex-acp', 'dist', 'index.js')), cli: digest(cli) } }
    fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    const destination = path.join(directory, 'versions', version, target)
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
    // Never overwrite a version which an existing process might still be using.
    if (fs.existsSync(destination)) {
      const existing = JSON.parse(fs.readFileSync(path.join(destination, 'runtime-manifest.json'), 'utf8'))
      if (existing.files?.cli !== manifest.files.cli || existing.files?.adapter !== manifest.files.adapter) throw new Error('同版本本机组件与官方摘要不一致，请先回退并检查本机文件')
    } else fs.renameSync(output, destination)
    return { version }
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}
