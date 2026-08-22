import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GenerationCancelledError,
  prepareModelTask,
  runEmbeddedModelTask,
} from '../electron/model-adapter.js'

const baseInput = {
  task: 'chapter',
  project: { title: '测试小说', genre: '都市', idea: '一次无法撤回的选择', style: '克制、具体' },
  chapter: { chapter_no: 1, title: '第一章', card: {}, scene_plan: '' },
}

test('embedded adapter streams mock fallback and shapes a manuscript result', async () => {
  const prepared = prepareModelTask({
    ...baseInput,
    modelProfile: { id: 'local-default', provider: 'local', name: '本地正文模型', baseUrl: '', model: '' },
    mockDelayMs: 0,
  })
  const events = []
  const result = await runEmbeddedModelTask(prepared, {
    taskId: 'mock-task',
    onEvent: (event) => events.push(event),
  })

  assert.equal(prepared.execution, 'mock')
  assert.equal(result.gateway, 'embedded')
  assert.ok(result.manuscript.length > 0)
  assert.equal(events[0].type, 'started')
  assert.equal(events.at(-1).type, 'completed')
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.delta).join(''), result.manuscript)
})

test('embedded adapter cancellation emits a cancelled terminal event', async () => {
  const prepared = prepareModelTask({ ...baseInput, mockDelayMs: 0 })
  const controller = new AbortController()
  const events = []

  await assert.rejects(
    runEmbeddedModelTask(prepared, {
      taskId: 'cancel-task',
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'delta') controller.abort()
      },
    }),
    GenerationCancelledError,
  )
  assert.equal(events.at(-1).type, 'cancelled')
})

test('embedded adapter supports OpenAI-compatible SSE responses', async () => {
  const originalFetch = globalThis.fetch
  let requestPayload
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body)
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"段。"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  try {
    const prepared = prepareModelTask({
      ...baseInput,
      modelProfile: {
        id: 'custom-model',
        provider: 'custom',
        name: '自定义模型',
        baseUrl: 'http://model.test/v1',
        model: 'story-model',
      },
      apiKey: 'provider-key',
    })
    const result = await runEmbeddedModelTask(prepared)
    assert.equal(result.manuscript, '第一段。')
    assert.equal(result.execution, 'remote')
    assert.equal(requestPayload.stream, true)
    assert.equal(requestPayload.model, 'story-model')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('embedded adapter applies custom JSON request config without exposing protected fields', async () => {
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, options) => {
    captured = { url, headers: options.headers, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '自定义响应' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const prepared = prepareModelTask({
      ...baseInput,
      modelProfile: {
        id: 'custom-json',
        provider: 'custom',
        name: '自定义 JSON 模型',
        baseUrl: 'https://custom.example/v2',
        model: 'novel-pro',
        settings: {
          requestConfig: {
            endpointPath: '/responses/chat',
            stream: false,
            headers: { 'X-Provider': 'novel-cloud', 'api-key': '{{apiKey}}' },
            body: { min_p: 0.1, enable_thinking: true },
            taskBody: { chapter: { repetition_penalty: 1.12 } },
          },
        },
      },
      apiKey: 'encrypted-at-rest-key',
    })
    const result = await runEmbeddedModelTask(prepared)
    assert.equal(result.manuscript, '自定义响应')
    assert.equal(captured.url, 'https://custom.example/v2/responses/chat')
    assert.equal(captured.headers['api-key'], 'encrypted-at-rest-key')
    assert.equal(captured.headers.Authorization, undefined)
    assert.equal(captured.body.model, 'novel-pro')
    assert.equal(captured.body.stream, false)
    assert.equal(captured.body.min_p, 0.1)
    assert.equal(captured.body.enable_thinking, true)
    assert.equal(captured.body.repetition_penalty, 1.12)
    assert.ok(Array.isArray(captured.body.messages))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('planning field generation returns a reviewable text candidate', async () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'planning_field',
    planning: {
      sectionLabel: '故事基础',
      targetLabel: '规划测试小说',
      fieldKey: 'coreConflict',
      fieldLabel: '核心冲突',
      currentValue: '',
    },
    modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: '', model: '' },
    mockDelayMs: 0,
  })
  const result = await runEmbeddedModelTask(prepared)
  assert.equal(result.task, 'planning_field')
  assert.ok(result.text.includes('主角'))
  assert.equal(prepared.messages[0].content.includes('只返回字段候选内容'), true)
  assert.equal(prepared.promptSnapshot.template.task, 'planning_field')
})

test('generation context includes confirmed knowledge and open continuity checks', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    knowledgeCenter: {
      facts: [{ status: 'open', title: '旧稿规则', content: { statement: '只能由原作者修改' } }],
      timeline: [{ status: 'open', title: '第一章', content: { event: '主角拿到钥匙' } }],
      foreshadows: [],
      checks: [{ status: 'open', severity: 'warning', title: '缺少场景计划', detail: '第二章尚未拆分' }],
    },
  })
  const userMessage = prepared.messages.find((message) => message.role === 'user').content
  assert.match(userMessage, /旧稿规则/)
  assert.match(userMessage, /只能由原作者修改/)
  assert.match(userMessage, /缺少场景计划/)
})

test('DeepSeek advanced parameters are included without mixing temperature and top_p', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'chapter_card',
    modelProfile: {
      id: 'deepseek-default',
      provider: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      settings: {
        thinkingEnabled: true,
        reasoningEffort: 'max',
        samplingMode: 'top_p',
        topP: 0.82,
        maxTokens: 8192,
        responseFormat: 'auto',
      },
    },
    apiKey: 'deepseek-key',
  })
  assert.deepEqual(prepared.parameters.thinking, { type: 'enabled' })
  assert.equal(prepared.parameters.reasoning_effort, 'max')
  assert.equal(prepared.parameters.top_p, 0.82)
  assert.equal('temperature' in prepared.parameters, false)
  assert.equal(prepared.parameters.max_tokens, 8192)
  assert.deepEqual(prepared.parameters.response_format, { type: 'json_object' })
})

test('connection test requires complete configuration and uses a minimal request', () => {
  assert.throws(() => prepareModelTask({ task: 'connection_test', modelProfile: { provider: 'deepseek' } }), /Base URL/)
  const prepared = prepareModelTask({
    task: 'connection_test',
    modelProfile: {
      provider: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      settings: { thinkingEnabled: true, reasoningEffort: 'max', maxTokens: 9000 },
    },
    apiKey: 'deepseek-key',
  })
  assert.equal(prepared.execution, 'remote')
  assert.deepEqual(prepared.parameters.thinking, { type: 'disabled' })
  assert.equal(prepared.parameters.max_tokens, 32)
  assert.equal(prepared.parameters.temperature, 0)
  assert.match(prepared.messages[1].content, /NOVEL_STUDIO_OK/)
})

test('prebuilt long-form context replaces the legacy all-record context and returns diagnostics', async () => {
  const prepared = prepareModelTask({
    ...baseInput,
    longContext: {
      text: '## 当前创作任务\n只携带被预算选中的内容',
      diagnostics: { budgetChars: 8000, usedChars: 23, recentChapterIds: ['chapter-1'] },
    },
    knowledgeCenter: { facts: [{ status: 'open', title: '不应直接注入', content: {} }] },
    mockDelayMs: 0,
  })
  const message = prepared.messages.find((item) => item.role === 'user').content
  assert.match(message, /只携带被预算选中的内容/)
  assert.doesNotMatch(message, /不应直接注入/)
  const result = await runEmbeddedModelTask(prepared)
  assert.equal(result.contextDiagnostics.budgetChars, 8000)
})
