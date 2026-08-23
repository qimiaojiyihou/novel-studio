import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelGateway } from '../electron/model-gateway.js'

test('model gateway exposes prepared parameters to the main process without returning them to renderer results', async () => {
  const gateway = createModelGateway({ getGoRuntime: () => ({ status: 'stopped', baseUrl: '', authToken: '' }) })
  let preparedParameters
  const result = await gateway.generate({
    task: 'chapter',
    project: { title: '参数边界测试', genre: '都市', idea: '一次选择', style: '克制' },
    chapter: { chapter_no: 1, title: '第一章', card: {}, scene_plan: '' },
    modelProfile: { id: 'local-default', provider: 'local', name: '本地模型', baseUrl: '', model: '' },
    mockDelayMs: 0,
  }, {
    taskId: 'prepared-parameters-test',
    onPrepared: (prepared) => { preparedParameters = prepared.parameters },
  })
  assert.equal(preparedParameters.temperature, 0.78)
  assert.equal(Object.hasOwn(result, 'requestParameters'), false)
  assert.ok(result.manuscript)
})

test('model gateway retries a transient failure before any streamed content arrives', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response('temporary outage', { status: 503 })
    return new Response(JSON.stringify({ choices: [{ message: { content: '重试后正文' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const events = []
    const gateway = createModelGateway({ getGoRuntime: () => ({ status: 'stopped', baseUrl: '', authToken: '' }) })
    const result = await gateway.generate({
      task: 'chapter',
      project: { title: '自动重试', genre: '悬疑', idea: '断线之后', style: '克制' },
      chapter: { chapter_no: 1, title: '第一章', card: {}, scene_plan: '' },
      modelProfile: { id: 'remote', provider: 'custom', name: '远程模型', baseUrl: 'https://model.test/v1', model: 'novel' },
      apiKey: 'test-key',
    }, { taskId: 'retry-transient', onEvent: (event) => events.push(event) })

    assert.equal(calls, 2)
    assert.equal(result.manuscript, '重试后正文')
    assert.equal(result.attemptCount, 2)
    assert.equal(events.filter((event) => event.type === 'retrying').length, 1)
    assert.equal(events.find((event) => event.type === 'retrying').nextAttempt, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('model gateway does not retry after a streamed delta has been emitted', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    const encoder = new TextEncoder()
    let emitted = false
    const stream = new ReadableStream({
      pull(controller) {
        if (!emitted) {
          emitted = true
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已经开始"}}]}\n\n'))
          return
        }
        controller.error(new Error('socket interrupted'))
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  try {
    const events = []
    const gateway = createModelGateway({ getGoRuntime: () => ({ status: 'stopped', baseUrl: '', authToken: '' }) })
    await assert.rejects(gateway.generate({
      task: 'chapter',
      project: { title: '流式边界', genre: '悬疑', idea: '半句话', style: '克制' },
      chapter: { chapter_no: 1, title: '第一章', card: {}, scene_plan: '' },
      modelProfile: { id: 'remote', provider: 'custom', name: '远程模型', baseUrl: 'https://model.test/v1', model: 'novel' },
      apiKey: 'test-key',
    }, { taskId: 'no-retry-after-delta', onEvent: (event) => events.push(event) }), /socket interrupted/)

    assert.equal(calls, 1)
    assert.equal(events.filter((event) => event.type === 'retrying').length, 0)
    assert.equal(events.some((event) => event.type === 'delta'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
