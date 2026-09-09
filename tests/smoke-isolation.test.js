import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertIsolatedRuntime } from '../scripts/smoke-isolation.mjs'

test('desktop smoke verifies actual database identity before fixture writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-smoke-isolation-'))
  try {
    const fixture = path.join(root, 'fixture'), library = path.join(root, 'library')
    fs.mkdirSync(fixture); fs.mkdirSync(library)
    const fixtureDb = path.join(fixture, 'novel-studio.sqlite'), libraryDb = path.join(library, 'novel-studio.sqlite')
    fs.writeFileSync(fixtureDb, ''); fs.writeFileSync(libraryDb, '')
    assert.doesNotThrow(() => assertIsolatedRuntime({ database: { path: fixtureDb } }, fixture))
    assert.throws(() => assertIsolatedRuntime({ database: { path: libraryDb } }, fixture), /not using the isolated/)
    assert.throws(() => assertIsolatedRuntime({}, fixture), /actual database path/)
    fs.unlinkSync(fixtureDb)
    fs.symlinkSync(libraryDb, fixtureDb)
    assert.throws(() => assertIsolatedRuntime({ database: { path: fixtureDb } }, fixture), /not using the isolated/)
    const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')
    assert.match(main, /if \(process\.env\.NOVEL_STUDIO_TEST_USER_DATA\)/)
    const smoke = fs.readFileSync(new URL('../scripts/smoke-creative-upgrade.mjs', import.meta.url), 'utf8')
    assert.ok(smoke.indexOf('assertIsolatedRuntime(runtime, fixtureDirectory)') < smoke.indexOf('window.novelStudio.createProject'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
