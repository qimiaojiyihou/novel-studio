import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import * as tar from 'tar'
import { CODEX_COMPONENT_TARGETS, CodexComponentManager, CodexModelCatalog, codexVersion, newerCodexVersion } from '../electron/codex-component-manager.js'
import { downloadCodexPackage, extractCodexPackage, officialCodexUrl, prepareCodexComponent } from '../electron/codex-component-download.js'
import { CodexAgentGateway, inspectCodexRuntime } from '../electron/codex-agent-gateway.js'
import { modelDirectory } from '../electron/codex-models.js'

const target = `${process.platform}-${process.arch}`
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function put(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
function fixtureRuntime(root, version, runtimeTarget = target) {
  const [name, triple, executable] = CODEX_COMPONENT_TARGETS[runtimeTarget]
  put(root, 'codex/package.json', JSON.stringify({ name: '@openai/codex', version }))
  put(root, 'codex-acp/package.json', JSON.stringify({ version: '1.6.2' }))
  put(root, 'codex-acp/dist/index.js', '// fixture adapter')
  put(root, 'codex-acp/LICENSE', 'fixture')
  put(root, `${name}/vendor/${triple}/bin/${executable}`, '// fixture CLI')
  put(root, 'runtime-manifest.json', JSON.stringify({ schemaVersion: 1, target: runtimeTarget, cliVersion: version, adapterVersion: '1.6.2',
    files: { adapter: digest(path.join(root, 'codex-acp/dist/index.js')), cli: digest(path.join(root, `${name}/vendor/${triple}/bin/${executable}`)) } }))
}
function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-codex-components-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const activations = [], downloads = []
  let busy = false, nextVersion = '0.160.0'
  const manager = new CodexComponentManager({ directory, bundledVersion: '0.159.2',
    inspect: root => {
      const result = inspectCodexRuntime({ appPath: directory, resourcesPath: '/missing', managedRoot: root })
      return result.source === 'managed' ? result : { available: false }
    },
    prepare: async input => {
      if (input.action === 'download') { fixtureRuntime(manager.root(nextVersion), nextVersion); downloads.push(nextVersion) }
      return { version: nextVersion }
    },
    validate: async () => {}, isBusy: () => busy, activate: async root => { activations.push(root) }, ...overrides,
  })
  return { directory, manager, activations, downloads, setBusy: value => { busy = value }, setVersion: value => { nextVersion = value } }
}

test('component versions and target mappings cover Windows/macOS/Linux without accepting paths', () => {
  assert.equal(Object.keys(CODEX_COMPONENT_TARGETS).length, 6)
  assert.equal(CODEX_COMPONENT_TARGETS['win32-x64'][2], 'codex.exe')
  assert.throws(() => codexVersion('../outside'), /格式/)
  assert.throws(() => codexVersion('0.160.0-beta'), /格式/)
  assert.equal(newerCodexVersion('0.160.0', '0.159.2'), true)
  assert.equal(newerCodexVersion('0.159.2', '0.159.2'), false)
})

test('downloaded components are verified and activated independently, preserving the bundled fallback', async t => {
  const { manager, activations, downloads } = setup(t)
  await manager.check()
  assert.equal(manager.status().updateAvailable, true)
  await manager.update({ adapterRoot: {} })
  assert.equal(manager.status().activeVersion, '0.160.0')
  assert.equal(manager.status().source, 'managed')
  assert.equal(manager.status().bundledVersion, '0.159.2')
  assert.equal(activations.length, 1)
  await manager.update({ adapterRoot: {} })
  assert.equal(downloads.length, 1, 'Repeated same-version updates perform no install')
})

test('a busy book task or idle session postpones both update and rollback, then applies at idle', async t => {
  const { manager, activations, setBusy } = setup(t)
  setBusy(true)
  await manager.update({ adapterRoot: {} })
  assert.equal(manager.status().pendingVersion, '0.160.0')
  assert.equal(manager.status().source, 'bundled')
  assert.equal(activations.length, 0)
  setBusy(false)
  await manager.applyPending()
  assert.equal(activations.length, 1)
  setBusy(true)
  await manager.rollback(true)
  assert.equal(manager.status().source, 'managed')
  assert.equal(manager.status().pendingVersion, 'bundled')
  setBusy(false)
  await manager.applyPending()
  assert.equal(manager.status().source, 'bundled')
})

test('restart recovers a validated pending update and a pending bundled rollback', async t => {
  const fixture = setup(t)
  fixture.setBusy(true)
  await fixture.manager.update({ adapterRoot: {} })
  const fresh = () => new CodexComponentManager({ directory: fixture.directory, bundledVersion: '0.159.2', inspect: fixture.manager.inspect })
  const restarted = fresh()
  await restarted.applyPending()
  assert.equal(restarted.status().activeVersion, '0.160.0')
  restarted.isBusy = () => true
  await restarted.rollback(true)
  const rollbackRestart = fresh()
  assert.equal(rollbackRestart.status().pendingVersion, 'bundled')
  await rollbackRestart.applyPending()
  assert.equal(rollbackRestart.status().source, 'bundled')
})

test('ACP validation failure retains the prior selection and does not activate', async t => {
  const { manager, activations } = setup(t, { validate: async () => { throw new Error('ACP fixture incompatible') } })
  await assert.rejects(manager.update({ adapterRoot: {} }), /incompatible/)
  assert.equal(manager.status().pendingVersion, '')
  assert.equal(manager.status().source, 'bundled')
  assert.equal(activations.length, 0)
})

test('corrupt managed components fall back to bundled runtime, and invalid pending data is never applied', async t => {
  const { directory, manager } = setup(t)
  await manager.update({ adapterRoot: {} })
  const bundled = path.join(directory, 'resources/codex-runtime', target)
  fixtureRuntime(bundled, '0.159.2')
  const [name, triple, executable] = CODEX_COMPONENT_TARGETS[target]
  put(manager.root('0.160.0'), `${name}/vendor/${triple}/bin/${executable}`, 'tampered')
  assert.equal(manager.status().source, 'bundled')
  const resolved = inspectCodexRuntime({ appPath: directory, resourcesPath: path.join(directory, 'resources'), managedRoot: manager.root('0.160.0') })
  assert.equal(resolved.source, 'packaged')
  assert.equal(resolved.cliVersion, '0.159.2')
  manager.save({ pending: '0.160.0' })
  assert.equal(await manager.applyPending(), false)
})

test('only active and previous independent versions are retained; rollback changes no book files', async t => {
  const { manager, directory, setVersion } = setup(t)
  put(directory, 'books.fixture', 'unchanged')
  for (const version of ['0.160.0', '0.161.0', '0.162.0']) { setVersion(version); await manager.update({ adapterRoot: {} }) }
  assert.deepEqual(fs.readdirSync(path.join(directory, 'versions')).sort(), ['0.161.0', '0.162.0'])
  await manager.rollback()
  assert.equal(manager.status().activeVersion, '0.161.0')
  assert.equal(fs.readFileSync(path.join(directory, 'books.fixture'), 'utf8'), 'unchanged')
})

test('parallel component clicks are rejected rather than installing twice', async t => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const { manager } = setup(t, { prepare: async () => { await blocked; return { version: '0.160.0' } } })
  const first = manager.check()
  await assert.rejects(manager.check(), /正在进行/)
  release(); await first
  assert.equal(manager.status().busy, false)
})

test('model cache persists unknown future models, deduplicates reads, preserves failures and isolates accounts/runtime', async t => {
  const { directory } = setup(t)
  let identity = 'account-a:runtime1', calls = 0, release
  const cache = new CodexModelCatalog({ file: path.join(directory, 'catalog.json'), identity: () => identity })
  const gate = new Promise(resolve => { release = resolve })
  const read = async () => { calls++; await gate; return { configOptions: [{ id: 'model', currentValue: 'future-model', options: [{ value: 'future-model', name: 'Future Model' }] }], refreshedAt: '2026-09-30T00:00:00Z' } }
  const a = cache.refresh('future-model', read), b = cache.refresh('future-model', read)
  release(); await Promise.all([a, b])
  assert.equal(calls, 1)
  assert.equal(cache.get().cached, true)
  assert.equal(modelDirectory(cache.get().configOptions, true)[0].value, 'future-model')
  await assert.rejects(cache.refresh('', async () => { throw new Error('offline') }), /offline/)
  assert.equal(cache.get().configOptions[0].currentValue, 'future-model')
  identity = 'account-b:runtime1'
  assert.equal(cache.get().cached, false)
  identity = 'account-a:runtime2'
  assert.equal(cache.get().cached, false)
})

test('late directory response from an old account never replaces the current cache', async t => {
  const { directory } = setup(t)
  let identity = 'old', resolve
  const cache = new CodexModelCatalog({ file: path.join(directory, 'catalog.json'), identity: () => identity })
  const pending = cache.refresh('', () => new Promise(done => { resolve = done }))
  await Promise.resolve(); identity = 'new'
  await cache.refresh('', async () => ({ configOptions: [{ id: 'model', currentValue: 'new' }] }))
  resolve({ configOptions: [{ id: 'model', currentValue: 'old' }] }); await pending
  assert.equal(cache.get().configOptions[0].currentValue, 'new')
})

test('official download rejects external URLs, weak/mismatching digests and follows no redirects', async t => {
  const { directory } = setup(t)
  for (const url of ['https://example.test/@openai/codex.tgz', 'http://registry.npmjs.org/@openai/a', 'https://registry.npmjs.org.evil.test/@openai/a']) assert.throws(() => officialCodexUrl(url), /官方/)
  const bytes = Buffer.from('fixture')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const info = { dist: { tarball: 'https://registry.npmjs.org/@openai/codex/-/fixture.tgz', integrity } }
  let redirect
  const fixtureFetch = async (_url, options) => { redirect = options.redirect; return new Response(bytes) }
  await downloadCodexPackage(info, path.join(directory, 'download.tgz'), fixtureFetch)
  assert.equal(redirect, 'error')
  await assert.rejects(downloadCodexPackage({ dist: { ...info.dist, integrity: 'sha1-invalid' } }, path.join(directory, 'weak.tgz'), fixtureFetch), /SHA-512/)
  await assert.rejects(downloadCodexPackage(info, path.join(directory, 'bad.tgz'), async () => new Response('tampered')), /不匹配/)
})

test('archive extraction accepts normal packages and rejects symlinks before execution', async t => {
  const { directory } = setup(t)
  const source = path.join(directory, 'source')
  put(source, 'package/package.json', '{}')
  await tar.c({ file: path.join(directory, 'ok.tgz'), gzip: true, cwd: source }, ['package'])
  await extractCodexPackage(path.join(directory, 'ok.tgz'), path.join(directory, 'normal'))
  assert.equal(fs.readFileSync(path.join(directory, 'normal/package.json'), 'utf8'), '{}')
  fs.symlinkSync('../outside', path.join(source, 'package/link'))
  await tar.c({ file: path.join(directory, 'bad.tgz'), gzip: true, cwd: source }, ['package'])
  await assert.rejects(extractCodexPackage(path.join(directory, 'bad.tgz'), path.join(directory, 'rejected')), /异常路径或链接/)
})

test('metadata version and platform identity checks reject malformed official responses', async t => {
  const { directory } = setup(t)
  await assert.rejects(prepareCodexComponent({ action: 'check', target, directory }, () => {}, async () => new Response(JSON.stringify({ name: 'other', version: '0.160.0' }))), /身份/)
  await assert.rejects(prepareCodexComponent({ action: 'download', target, directory }, () => {}, async url => new Response(JSON.stringify({ name: '@openai/codex', version: url.endsWith('/latest') ? '0.160.0' : '0.160.0-wrong', os: ['wrong'], cpu: ['wrong'] }))), /不匹配/)
})

test('complete signed package preparation assembles local and Windows runtimes without npm scripts or writes outside staging', async t => {
  const { directory } = setup(t)
  const adapter = path.join(directory, 'adapter')
  put(adapter, 'dist/index.js', '// pinned ACP fixture')
  put(adapter, 'package.json', JSON.stringify({ version: '1.6.2' }))
  put(adapter, 'LICENSE', 'fixture license')
  for (const platform of new Set([target, 'win32-x64'])) {
    const version = '0.160.0', [name, triple, executable] = CODEX_COMPONENT_TARGETS[platform]
    const root = path.join(directory, platform)
    const infos = {}, blobs = {}
    for (const [alias, pkgVersion] of [['codex', version], [name, `${version}-${platform}`]]) {
      const source = path.join(root, alias)
      put(source, 'package/package.json', JSON.stringify({ name: '@openai/codex', version: pkgVersion, scripts: { postinstall: 'THIS_MUST_NEVER_RUN' } }))
      if (alias !== 'codex') put(source, `package/vendor/${triple}/bin/${executable}`, 'fixture native binary')
      const archive = path.join(root, `${alias}.tgz`)
      await tar.c({ file: archive, gzip: true, cwd: source }, ['package'])
      const bytes = fs.readFileSync(archive), url = `https://registry.npmjs.org/@openai/codex/-/${alias}.tgz`
      infos[pkgVersion] = { name: '@openai/codex', version: pkgVersion, os: [platform.split('-')[0]], cpu: [platform.split('-')[1]], dist: { tarball: url, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } }
      blobs[url] = bytes
    }
    const fixtureFetch = async url => url.endsWith('.tgz') ? new Response(blobs[url]) : new Response(JSON.stringify(infos[url.endsWith('/latest') ? version : url.split('/').at(-1)]))
    const args = { action: 'download', directory: root, target: platform, adapterRoot: { adapterPath: path.join(adapter, 'dist/index.js'), adapterPackagePath: path.join(adapter, 'package.json') } }
    await prepareCodexComponent(args, () => {}, fixtureFetch)
    const runtimeRoot = path.join(root, 'versions', version, platform)
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'runtime-manifest.json'), 'utf8'))
    assert.equal(manifest.target, platform)
    assert.equal(manifest.files.cli, digest(path.join(runtimeRoot, name, 'vendor', triple, 'bin', executable)))
    assert.equal(manifest.files.adapter, digest(path.join(adapter, 'dist/index.js')))
    assert.ok(!fs.readdirSync(root).some(entry => entry.startsWith('download-')), 'Temporary archives removed')
    if (platform === target) assert.equal(inspectCodexRuntime({ appPath: directory, resourcesPath: '/missing', managedRoot: runtimeRoot }).source, 'managed')
    await prepareCodexComponent(args, () => {}, fixtureFetch)
    assert.equal(fs.readFileSync(path.join(runtimeRoot, 'codex-acp/dist/index.js'), 'utf8'), '// pinned ACP fixture')
  }
})

test('failed selection persistence restores the running component and retains its pending recovery state', async t => {
  const { manager, activations, setBusy } = setup(t)
  setBusy(true); await manager.update({ adapterRoot: {} }); setBusy(false)
  const previous = { ...manager.state }, save = manager.save.bind(manager)
  manager.save = () => { throw new Error('disk fixture full') }
  await assert.rejects(manager.applyPending(), /disk fixture/)
  assert.deepEqual(activations, [manager.root('0.160.0'), ''])
  assert.deepEqual(manager.state, previous)
  assert.equal(manager.status().source, 'bundled')
  manager.save = save
  await manager.applyPending()
  assert.equal(manager.status().source, 'managed')
})

test('timer activation excludes competing update/rollback clicks while switching runtime', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { manager, setBusy } = setup(t, { activate: () => gate })
  setBusy(true); await manager.update({ adapterRoot: {} }); setBusy(false)
  const switching = manager.applyPending()
  assert.equal(manager.status().busy, true)
  await assert.rejects(manager.rollback(true), /正在进行/)
  release(); await switching
  assert.equal(manager.status().pendingVersion, '')
})

test('gateway blocks runtime replacement during requests/idle sessions and queues new calls behind a switch', async t => {
  const { directory } = setup(t)
  const gateway = new CodexAgentGateway({ appPath: directory, resourcesPath: '/missing' })
  let release
  const requestGate = new Promise(resolve => { release = resolve })
  const request = gateway.withRuntimeUsage(() => requestGate)
  await assert.rejects(gateway.changeRuntimeRoot('next'), /会话/)
  release(); await request
  gateway.sessions.set('idle-book-a', {})
  await assert.rejects(gateway.changeRuntimeRoot('next'), /会话/)
  gateway.sessions.clear()
  let finishSwitch, started = false
  gateway.shutdown = () => new Promise(resolve => { finishSwitch = resolve })
  const switchPromise = gateway.changeRuntimeRoot('next')
  const nextRequest = gateway.withRuntimeUsage(async () => { started = true; return gateway.managedRoot })
  await Promise.resolve()
  assert.equal(started, false)
  finishSwitch(); await switchPromise
  assert.equal(await nextRequest, 'next')
  assert.equal(gateway.runtimeUsers, 0)
})
