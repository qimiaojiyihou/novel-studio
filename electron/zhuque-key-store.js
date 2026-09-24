import { randomUUID } from 'node:crypto'

export function createZhuqueKeyStore(database, {
  encrypt,
  decrypt,
  encryptionAvailable,
  now = () => new Date().toISOString(),
  createId = randomUUID,
} = {}) {
  const listQuery = database.prepare('SELECT id, label, created_at FROM zhuque_api_keys ORDER BY created_at, id')
  const keyQuery = database.prepare('SELECT key_cipher FROM zhuque_api_keys WHERE id = ?')
  const selectedQuery = database.prepare("SELECT value FROM app_settings WHERE key = 'zhuque_selected_key_id'")
  const selectKey = database.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('zhuque_selected_key_id', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
  const clearSelected = database.prepare("DELETE FROM app_settings WHERE key = 'zhuque_selected_key_id'")

  function selectedId() { return selectedQuery.get()?.value || null }
  function selectedKey() {
    const id = selectedId()
    return id ? decrypt(keyQuery.get(id)?.key_cipher || '') : ''
  }
  function status() {
    const selectedKeyId = selectedId()
    return {
      keys: listQuery.all().map(({ id, label, created_at }) => ({ id, label, createdAt: created_at })),
      selectedKeyId,
      configured: Boolean(selectedKey()),
    }
  }
  function transaction(action) {
    database.exec('BEGIN')
    try {
      const result = action()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  function add({ label, apiKey } = {}) {
    const name = String(label || '').trim()
    const value = String(apiKey || '').trim()
    if (!name || name.length > 80) throw new Error('密钥名称需为 1–80 个字符')
    if (!value || value.length > 4096) throw new Error('请输入有效的朱雀 API Key')
    if (!encryptionAvailable()) throw new Error('系统密钥加密暂不可用，请稍后重试')
    const id = createId()
    const time = now()
    const cipher = encrypt(value)
    transaction(() => {
      database.prepare('INSERT INTO zhuque_api_keys (id, label, key_cipher, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, cipher, time, time)
      selectKey.run(id, time)
    })
    return status()
  }
  function select(id) {
    if (!keyQuery.get(id)) throw new Error('所选朱雀密钥不存在')
    selectKey.run(id, now())
    return status()
  }
  function remove(id) {
    if (!keyQuery.get(id)) throw new Error('所选朱雀密钥不存在')
    const wasSelected = selectedId() === id
    transaction(() => {
      database.prepare('DELETE FROM zhuque_api_keys WHERE id = ?').run(id)
      if (wasSelected) {
        const next = listQuery.get()
        if (next) selectKey.run(next.id, now())
        else clearSelected.run()
      }
    })
    return status()
  }
  return { status, selectedKey, add, select, remove }
}
