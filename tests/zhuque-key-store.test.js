import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createZhuqueKeyStore } from '../electron/zhuque-key-store.js'

function fixture() {
  const database = new DatabaseSync(':memory:')
  runMigrations(database)
  let next = 0
  const store = createZhuqueKeyStore(database, {
    encrypt: value => `encrypted:${value}`,
    decrypt: value => value.startsWith('encrypted:') ? value.slice(10) : '',
    encryptionAvailable: () => true,
    createId: () => `key-${++next}`,
    now: () => '2026-09-25T00:00:00.000Z',
  })
  return { database, store }
}

test('multiple encrypted Zhuque keys share one global selection without exposing secrets', () => {
  const { database, store } = fixture()
  try {
    const first = store.add({ label: '甲', apiKey: 'secret-a' })
    const second = store.add({ label: '乙', apiKey: 'secret-b' })
    assert.deepEqual(first.keys.map(key => key.label), ['甲'])
    assert.deepEqual(second.keys.map(key => key.label), ['甲', '乙'])
    assert.equal(second.selectedKeyId, 'key-2')
    assert.equal(store.selectedKey(), 'secret-b')
    assert.doesNotMatch(JSON.stringify(store.status()), /secret-/)
    assert.equal(database.prepare("SELECT key_cipher FROM zhuque_api_keys WHERE id = 'key-2'").get().key_cipher, 'encrypted:secret-b')
    store.select('key-1')
    assert.equal(store.selectedKey(), 'secret-a')
    const anotherWindow = createZhuqueKeyStore(database, {
      encrypt: value => `encrypted:${value}`,
      decrypt: value => value.slice(10),
      encryptionAvailable: () => true,
    })
    assert.equal(anotherWindow.status().selectedKeyId, 'key-1')
    assert.equal(anotherWindow.selectedKey(), 'secret-a')
    assert.throws(() => store.select('missing'), /不存在/)
    store.remove('key-1')
    assert.equal(store.status().selectedKeyId, 'key-2')
    store.remove('key-2')
    assert.deepEqual(store.status().keys, [])
    assert.equal(store.selectedKey(), '')
  } finally { database.close() }
})

test('old single key migrates once into the multi-key list without retaining duplicate plaintext', () => {
  const database = new DatabaseSync(':memory:')
  try {
    runMigrations(database, { targetVersion: 28 })
    database.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('zhuque_api_key_cipher', ?, ?)")
      .run('enc:legacy-cipher', '2026-09-25T00:00:00.000Z')
    runMigrations(database)
    assert.equal(database.prepare("SELECT key_cipher FROM zhuque_api_keys WHERE id = 'legacy'").get().key_cipher, 'enc:legacy-cipher')
    assert.equal(database.prepare("SELECT value FROM app_settings WHERE key = 'zhuque_selected_key_id'").get().value, 'legacy')
    assert.equal(database.prepare("SELECT value FROM app_settings WHERE key = 'zhuque_api_key_cipher'").get(), undefined)
    runMigrations(database)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM zhuque_api_keys').get().count, 1)
  } finally { database.close() }
})

test('invalid key input and unavailable encryption do not change selection', () => {
  const { database, store } = fixture()
  try {
    assert.throws(() => store.add({ label: '空', apiKey: '' }), /API Key/)
    const noEncryption = createZhuqueKeyStore(database, { encryptionAvailable: () => false })
    assert.throws(() => noEncryption.add({ label: '新', apiKey: 'secret' }), /加密/)
    assert.deepEqual(store.status().keys, [])
  } finally { database.close() }
})
