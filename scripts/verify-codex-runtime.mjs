import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetKey = process.env.NOVEL_STUDIO_TARGET || `${process.platform}-${process.arch}`
const runtimeRoot = path.join(root, 'resources', 'codex-runtime', targetKey)
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json')
if (!fs.existsSync(manifestPath)) throw new Error(`Missing runtime manifest for ${targetKey}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const target = {
  'darwin-arm64': ['codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
  'darwin-x64': ['codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  'linux-arm64': ['codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
  'linux-x64': ['codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
  'win32-arm64': ['codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  'win32-x64': ['codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
}[targetKey]
if (!target) throw new Error(`Unsupported target ${targetKey}`)
const adapter = path.join(runtimeRoot, 'codex-acp', 'dist', 'index.js')
const cli = path.join(runtimeRoot, target[0], 'vendor', target[1], 'bin', target[2])
const digest = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
if (manifest.adapterVersion !== '1.6.2') throw new Error(`Unexpected adapter ${manifest.adapterVersion}`)
if (digest(adapter) !== manifest.files.adapter || digest(cli) !== manifest.files.cli) throw new Error('Codex runtime SHA-256 verification failed')
if (process.platform !== 'win32' && !(fs.statSync(cli).mode & 0o111)) throw new Error('Codex CLI is not executable')
console.log(`Verified Codex runtime ${targetKey}: ACP ${manifest.adapterVersion}, CLI ${manifest.cliVersion}`)
