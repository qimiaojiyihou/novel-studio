import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targets = {
  'darwin-arm64': { packageName: 'codex-darwin-arm64', triple: 'aarch64-apple-darwin', executable: 'codex' },
  'darwin-x64': { packageName: 'codex-darwin-x64', triple: 'x86_64-apple-darwin', executable: 'codex' },
  'linux-arm64': { packageName: 'codex-linux-arm64', triple: 'aarch64-unknown-linux-musl', executable: 'codex' },
  'linux-x64': { packageName: 'codex-linux-x64', triple: 'x86_64-unknown-linux-musl', executable: 'codex' },
  'win32-arm64': { packageName: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc', executable: 'codex.exe' },
  'win32-x64': { packageName: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc', executable: 'codex.exe' },
}

const targetKey = process.env.NOVEL_STUDIO_TARGET || `${process.platform}-${process.arch}`
const target = targets[targetKey]
if (!target) throw new Error(`Unsupported Codex runtime target: ${targetKey}`)

const adapterPackagePath = path.join(root, 'node_modules', '@agentclientprotocol', 'codex-acp', 'package.json')
const adapterEntryPath = path.join(root, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js')
const adapterLicensePath = path.join(root, 'node_modules', '@agentclientprotocol', 'codex-acp', 'LICENSE')
const cliPackagePath = path.join(root, 'node_modules', '@openai', 'codex', 'package.json')
const platformPackagePath = path.join(root, 'node_modules', '@openai', target.packageName)
const nativeCliPath = path.join(platformPackagePath, 'vendor', target.triple, 'bin', target.executable)

for (const required of [adapterPackagePath, adapterEntryPath, adapterLicensePath, cliPackagePath, nativeCliPath]) {
  if (!fs.existsSync(required)) throw new Error(`Missing fixed Codex runtime file: ${required}`)
}

const adapterPackage = JSON.parse(fs.readFileSync(adapterPackagePath, 'utf8'))
const cliPackage = JSON.parse(fs.readFileSync(cliPackagePath, 'utf8'))
if (adapterPackage.version !== '1.6.2') throw new Error(`codex-acp version drift: ${adapterPackage.version}`)
const pinnedCliVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@openai/codex']
if (cliPackage.version !== pinnedCliVersion) throw new Error(`Codex CLI version drift: ${cliPackage.version} (expected ${pinnedCliVersion})`)

const outputRoot = path.join(root, 'resources', 'codex-runtime', targetKey)
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(outputRoot, 'codex-acp', 'dist'), { recursive: true })
fs.mkdirSync(path.join(outputRoot, 'codex'), { recursive: true })
fs.copyFileSync(adapterPackagePath, path.join(outputRoot, 'codex-acp', 'package.json'))
fs.copyFileSync(adapterEntryPath, path.join(outputRoot, 'codex-acp', 'dist', 'index.js'))
fs.copyFileSync(adapterLicensePath, path.join(outputRoot, 'codex-acp', 'LICENSE'))
fs.copyFileSync(cliPackagePath, path.join(outputRoot, 'codex', 'package.json'))
fs.cpSync(platformPackagePath, path.join(outputRoot, target.packageName), { recursive: true })

const digest = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const packagedAdapter = path.join(outputRoot, 'codex-acp', 'dist', 'index.js')
const packagedCli = path.join(outputRoot, target.packageName, 'vendor', target.triple, 'bin', target.executable)
if (process.platform !== 'win32') fs.chmodSync(packagedCli, 0o755)
const manifest = {
  schemaVersion: 1,
  target: targetKey,
  adapterVersion: adapterPackage.version,
  cliVersion: cliPackage.version,
  capabilities: {
    // Fixed CLI 0.153.4 declares --output-schema; post-run validation still applies.
    execOutputSchema: true,
  },
  files: { adapter: digest(packagedAdapter), cli: digest(packagedCli) },
}
fs.writeFileSync(path.join(outputRoot, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Built Codex runtime ${targetKey} (${adapterPackage.version} / ${cliPackage.version})`)
