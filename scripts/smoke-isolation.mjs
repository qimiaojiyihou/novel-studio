import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export function assertIsolatedRuntime(runtime, fixtureDirectory) {
  const expected = path.join(fs.realpathSync(fixtureDirectory), 'novel-studio.sqlite')
  const actual = runtime?.database?.path
  assert.ok(actual && path.isAbsolute(actual), 'Smoke test requires the actual database path before writing')
  assert.equal(fs.realpathSync(actual), expected, 'Smoke test stopped: application is not using the isolated database')
}
