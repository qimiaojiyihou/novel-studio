import assert from 'node:assert/strict'
import test from 'node:test'

import { toIpcPayload } from '../src/utils/ipc-payload.js'

test('model settings are converted from nested proxies into an Electron-cloneable payload', () => {
  const settings = new Proxy({
    thinkingEnabled: true,
    requestConfig: new Proxy({ headers: {}, taskBody: {} }, {}),
  }, {})
  const profile = new Proxy({
    id: 'deepseek-default',
    model: 'deepseek-v4-pro',
    settings,
  }, {})

  assert.throws(() => structuredClone(profile), { name: 'DataCloneError' })

  const payload = toIpcPayload(profile, '模型连接测试')

  assert.deepEqual(payload, {
    id: 'deepseek-default',
    model: 'deepseek-v4-pro',
    settings: {
      thinkingEnabled: true,
      requestConfig: { headers: {}, taskBody: {} },
    },
  })
  assert.doesNotThrow(() => structuredClone(payload))
})

test('unsupported values produce a useful IPC payload error', () => {
  assert.throws(
    () => toIpcPayload({ maxTokens: 1n }, '模型配置'),
    /模型配置包含不可传输的数据/,
  )
})
