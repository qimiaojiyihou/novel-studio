import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'

export const CODEX_COMPONENT_TARGETS = {
  'darwin-arm64': ['codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
  'darwin-x64': ['codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  'linux-arm64': ['codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
  'linux-x64': ['codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
  'win32-arm64': ['codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  'win32-x64': ['codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
}

export function codexVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(String(value))) throw new Error('Codex 组件版本格式异常')
  return String(value)
}

export function newerCodexVersion(left, right) {
  const a = codexVersion(left).split('.').map(Number), b = codexVersion(right).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export function writeCodexJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally { fs.rmSync(temporary, { force: true }) }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function runDownloadWorker(input, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./codex-component-worker.js', import.meta.url), { workerData: input })
    let settled = false
    worker.on('message', (message) => {
      if (message.type === 'progress') onProgress(message.text)
      else if (message.type === 'done') { settled = true; resolve(message.result) }
      else if (message.type === 'error') { settled = true; reject(new Error(message.message)) }
    })
    worker.once('error', reject)
    worker.once('exit', code => { if (!settled) reject(new Error(`组件下载进程提前结束（${code}）`)) })
  })
}

// This store is independent of the book database. IPC never accepts a URL or path.
export class CodexComponentManager {
  constructor({ directory, target = `${process.platform}-${process.arch}`, bundledVersion, inspect, prepare = runDownloadWorker, validate, isBusy = () => false, activate = async () => {}, now = () => new Date().toISOString() }) {
    if (!CODEX_COMPONENT_TARGETS[target]) throw new Error('当前平台尚无 Codex 组件包')
    this.directory = directory
    this.target = target
    this.bundledVersion = codexVersion(bundledVersion)
    this.inspect = inspect
    this.prepare = prepare
    this.validate = validate
    this.isBusy = isBusy
    this.activate = activate
    this.now = now
    this.file = path.join(directory, 'selection.json')
    this.state = readJson(this.file) || {}
    for (const key of ['active', 'previous', 'pending']) {
      try { if (this.state[key] && !(key === 'pending' && this.state[key] === 'bundled')) codexVersion(this.state[key]) } catch { delete this.state[key] }
    }
    this.operation = null
    this.progress = ''
    this.error = ''
    this.latestVersion = ''
    this.checkedAt = ''
    this.validationCache = new Map()
  }

  root(version) { return path.join(this.directory, 'versions', codexVersion(version), this.target) }
  valid(version) {
    if (!version) return false
    try {
      const root = this.root(version), target = CODEX_COMPONENT_TARGETS[this.target]
      const fingerprint = ['runtime-manifest.json', 'codex/package.json', 'codex-acp/package.json', 'codex-acp/dist/index.js', `${target[0]}/vendor/${target[1]}/bin/${target[2]}`]
        .map(file => { const stat = fs.statSync(path.join(root, file)); return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` }).join('|')
      const cached = this.validationCache.get(version)
      if (cached?.fingerprint === fingerprint) return cached.valid
      const runtime = this.inspect(root)
      const valid = runtime.available && runtime.cliVersion === version && runtime.integrity === 'verified'
      this.validationCache.set(version, { fingerprint, valid })
      return valid
    } catch { return false }
  }
  selectedRoot() { return this.valid(this.state.active) ? this.root(this.state.active) : '' }
  status() {
    const active = this.selectedRoot() ? this.state.active : ''
    return { activeVersion: active || this.bundledVersion, source: active ? 'managed' : 'bundled',
      bundledVersion: this.bundledVersion, previousVersion: this.valid(this.state.previous) ? this.state.previous : '',
      pendingVersion: this.state.pending || '', latestVersion: this.latestVersion, checkedAt: this.checkedAt,
      busy: Boolean(this.operation || this.applying), progress: this.progress, error: this.error,
      updateAvailable: Boolean(this.latestVersion && newerCodexVersion(this.latestVersion, active || this.bundledVersion)) }
  }
  save(state) { writeCodexJson(this.file, state); this.state = state }
  async exclusive(work) {
    if (this.operation || this.applying) throw new Error('Codex 组件操作正在进行，请稍后再试')
    this.operation = Promise.resolve().then(work)
    try { return await this.operation } catch (error) { this.error = error.message; throw error }
    finally { this.operation = null; this.progress = '' }
  }
  check() {
    return this.exclusive(async () => {
      this.error = ''; this.progress = '正在检查官方 Codex 组件版本…'
      const result = await this.prepare({ action: 'check', target: this.target }, text => { this.progress = text })
      this.latestVersion = codexVersion(result.version); this.checkedAt = this.now()
      return this.status()
    })
  }
  update({ adapterRoot }) {
    return this.exclusive(async () => {
      this.error = ''; this.progress = '正在下载并校验 Codex 组件…'
      const latest = await this.prepare({ action: 'check', target: this.target }, text => { this.progress = text })
      this.latestVersion = codexVersion(latest.version); this.checkedAt = this.now()
      if (!newerCodexVersion(this.latestVersion, this.status().activeVersion)) return this.status()
      const result = await this.prepare({ action: 'download', directory: this.directory, target: this.target, adapterRoot }, text => { this.progress = text })
      const version = codexVersion(result.version)
      if (!newerCodexVersion(version, this.status().activeVersion)) throw new Error('组件版本在下载期间发生变化，请重新检查')
      this.latestVersion = version; this.checkedAt = this.now()
      if (!this.valid(version)) throw new Error('下载的 Codex 组件摘要或版本校验失败')
      this.progress = '正在校验 ACP、模型目录与 exec 参数（不发送创作请求）…'
      await this.validate(this.root(version))
      this.save({ ...this.state, pending: version, pendingAt: this.now() })
      await this.applyPending()
      return this.status()
    })
  }
  async applyPending() {
    if (this.applying || !this.state.pending || this.isBusy()) return false
    const version = this.state.pending
    if (version === 'bundled') {
      // Only written by the local rollback action, not by downloaded metadata.
    } else if (!this.valid(version)) { this.error = '待启用组件校验失败，继续使用原版本'; return false }
    this.applying = true
    const previousState = { ...this.state }, previousRoot = this.selectedRoot()
    try {
      const active = version === 'bundled' ? '' : version
      await this.activate(active ? this.root(active) : '')
      try {
        this.save({ active, previous: previousState.active || '', pending: '', activatedAt: this.now() })
      } catch (error) {
        // A persistence error must not leave this process using an unrecorded version.
        await this.activate(previousRoot)
        throw error
      }
      this.prune()
      return true
    } catch (error) { this.error = error.message; throw error }
    finally { this.applying = false }
  }
  rollback(useBundled = false) {
    return this.exclusive(async () => {
      this.error = ''
      const previous = !useBundled && this.valid(this.state.previous) ? this.state.previous : 'bundled'
      this.save({ ...this.state, pending: previous, pendingAt: this.now() })
      await this.applyPending()
      return this.status()
    })
  }
  prune() {
    const versions = path.join(this.directory, 'versions')
    const keep = new Set([this.state.active, this.state.previous, this.state.pending].filter(Boolean))
    try {
      for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name) && !keep.has(entry.name)) {
          try { fs.rmSync(path.join(versions, entry.name), { recursive: true, force: true }) } catch { /* Windows may retain a closing process handle; retry after the next activation. */ }
        }
      }
    } catch { /* first update has no old component directories */ }
  }
}

export class CodexModelCatalog {
  constructor({ file, identity = () => '', now = () => new Date().toISOString() }) {
    this.file = file; this.identity = identity; this.now = now; this.inflight = new Map()
  }
  get() {
    const cached = readJson(this.file)
    return cached?.identity === this.identity() && Array.isArray(cached.configOptions) && cached.configOptions.length <= 20
      ? { configOptions: cached.configOptions, refreshedAt: cached.refreshedAt, cached: true } : { configOptions: [], refreshedAt: '', cached: false }
  }
  async refresh(model, read) {
    const identity = this.identity(), key = `${identity}:${model}`
    if (this.inflight.has(key)) return this.inflight.get(key)
    const pending = Promise.resolve().then(read).then(result => {
      // An account/runtime change while awaiting a response must not poison its new cache.
      if (identity === this.identity()) writeCodexJson(this.file, { identity, configOptions: result.configOptions, refreshedAt: result.refreshedAt || this.now() })
      return result
    }).finally(() => this.inflight.delete(key))
    this.inflight.set(key, pending)
    return pending
  }
}
