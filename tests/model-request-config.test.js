import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRequestConfigJson,
  requestEndpointFor,
  requestHeadersFor,
  requestParametersFor,
} from '../electron/model-request-config.js'

test('JSON request config supports endpoint, headers, global body and task overrides', () => {
  const config = parseRequestConfigJson(JSON.stringify({
    endpointPath: '/generate/chat?api-version=2026-01-01',
    stream: false,
    headers: { 'X-Provider-Version': '2026-01', 'api-key': '{{apiKey}}' },
    body: { min_p: 0.08, repetition_penalty: 1.05 },
    taskBody: { chapter: { max_tokens: 12000, min_p: 0.12 } },
  }))
  assert.equal(requestEndpointFor('https://model.example/v1/', config), 'https://model.example/v1/generate/chat?api-version=2026-01-01')
  assert.deepEqual(requestHeadersFor(config, 'secret-key'), {
    'X-Provider-Version': '2026-01',
    'api-key': 'secret-key',
    'Content-Type': 'application/json',
  })
  assert.deepEqual(requestParametersFor('chapter', { temperature: 0.7 }, config), {
    temperature: 0.7,
    min_p: 0.12,
    repetition_penalty: 1.05,
    max_tokens: 12000,
  })
})

test('JSON request config protects prompts, model routing and encrypted key boundary', () => {
  assert.throws(() => parseRequestConfigJson('{"body":{"model":"other"}}'), /不能在 JSON 中覆盖/)
  assert.throws(() => parseRequestConfigJson('{"taskBody":{"chapter":{"messages":[]}}}'), /不能在 JSON 中覆盖/)
  assert.throws(() => parseRequestConfigJson('{"headers":{"Authorization":"Bearer plaintext"}}'), /必须使用.*apiKey/)
  assert.throws(() => parseRequestConfigJson('{"unknown":true}'), /不支持的顶层配置字段/)
  assert.throws(() => parseRequestConfigJson('{"endpointPath":123}'), /endpointPath 必须是字符串/)
  assert.throws(() => parseRequestConfigJson('{"stream":"false"}'), /stream 必须是 true 或 false/)
})

test('JSON request config accepts per-task overrides for knowledge workflows', () => {
  const config = parseRequestConfigJson(JSON.stringify({
    taskBody: {
      chapter_state_extract: { temperature: 0.1 },
      continuity_audit: { max_tokens: 6000 },
    },
  }))
  assert.equal(requestParametersFor('chapter_state_extract', {}, config).temperature, 0.1)
  assert.equal(requestParametersFor('continuity_audit', {}, config).max_tokens, 6000)
})

test('JSON request config accepts quality review task overrides', () => {
  const config = parseRequestConfigJson(JSON.stringify({ taskBody: { quality_review: { response_format: { type: 'json_object' }, seed: 7 } } }))
  assert.equal(requestParametersFor('quality_review', {}, config).seed, 7)
})
