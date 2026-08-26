import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GenerationCancelledError,
  StructuredOutputError,
  prepareModelTask,
  probeModelCapabilities,
  runEmbeddedModelTask,
  shapeModelResult,
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

test('embedded rewrite mock keeps the selected preset in the prompt snapshot', async () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'rewrite',
    selectedText: '“我没有拿档案。”周雨说。',
    rewriteMode: 'dialogue',
    mockDelayMs: 0,
  })
  const result = await runEmbeddedModelTask(prepared, { taskId: 'rewrite-dialogue' })
  assert.equal(prepared.promptSnapshot.rewritePreset.id, 'dialogue')
  assert.match(prepared.messages[1].content, /对白有效化/)
  assert.match(result.text, /周雨说/)
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

test('planning field model results remove workflow narration before display', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'planning_field',
    planning: {
      sectionLabel: '故事基础',
      targetLabel: '规划测试小说',
      fieldKey: 'targetAudience',
      fieldLabel: '目标读者',
      currentValue: '',
    },
    modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: '', model: '' },
    mockDelayMs: 0,
  })
  const result = shapeModelResult(
    prepared,
    '我将按 Novel Studio 长篇规划规范校准“目标读者”候选，保持只读，不修改真实项目。目标读者：18—35岁喜欢都市文娱和职业体验题材的男性向网文读者。',
  )

  assert.equal(result.text, '18—35岁喜欢都市文娱和职业体验题材的男性向网文读者。')
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

test('MiMo uses official completion budget and structured-output parameters', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'scene_plan',
    modelProfile: {
      id: 'mimo',
      provider: 'custom',
      name: '小米 MiMo',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro',
      settings: { thinkingEnabled: true, maxTokens: 16384, responseFormat: 'auto' },
    },
  })
  assert.deepEqual(prepared.parameters.thinking, { type: 'enabled' })
  assert.equal(prepared.parameters.max_completion_tokens, 16384)
  assert.deepEqual(prepared.parameters.response_format, { type: 'json_object' })
  assert.equal('max_tokens' in prepared.parameters, false)
  assert.equal('temperature' in prepared.parameters, false)
})

test('MiMo structured correction retry disables thinking for deterministic JSON', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'scene_plan',
    structuredRetry: { attempt: 2, deterministic: true },
    modelProfile: {
      id: 'mimo',
      provider: 'mimo',
      name: '小米 MiMo',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      model: 'mimo-v2.5-pro',
      settings: { thinkingEnabled: true, maxTokens: 16384, responseFormat: 'auto' },
    },
  })
  assert.deepEqual(prepared.parameters.thinking, { type: 'disabled' })
  assert.equal(prepared.parameters.temperature, 0.1)
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

test('structured knowledge tasks use JSON output and shape reviewable objects', async () => {
  for (const task of ['chapter_state_extract', 'continuity_audit']) {
    const prepared = prepareModelTask({
      ...baseInput,
      task,
      chapter: { ...baseInput.chapter, manuscript: '主角把钥匙放进外套内袋。' },
      modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: '', model: '', settings: { responseFormat: 'auto' } },
      mockDelayMs: 0,
    })
    const result = await runEmbeddedModelTask(prepared)
    assert.deepEqual(prepared.parameters.response_format, { type: 'json_object' })
    if (task === 'chapter_state_extract') assert.ok(Array.isArray(result.stateSnapshot.facts))
    else assert.ok(Array.isArray(result.audit.issues))
  }
})

test('chapter state extraction normalizes common object maps and field aliases', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'chapter_state_extract',
    modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
  })
  const content = JSON.stringify({
    summary: '林砚带伤逃出医院。',
    facts: [{ fact: '假身份已经暴露', evidence: '工牌和脸对不上。' }],
    characterStates: {
      林砚: { location: '医院外墙', physicalState: '右肋伤势加剧', inventory: ['手机'], knowledge: ['医生仍只是嫌疑人'] },
    },
    relationshipChanges: [{ from: '林砚', to: '保安', change: '由被注意变为被追捕' }],
    timelineEvents: [{ time: '当夜', event: '林砚逃出医院', evidence: '他跌出院外。' }],
    foreshadow: [{ description: '钥匙尚未使用', status: 'set' }, { description: '身份暴露', status: 'fulfilled' }],
    openThreads: [{ thread: '继续追查药房路线' }],
  })
  const result = shapeModelResult(prepared, content)

  assert.deepEqual(result.stateSnapshot.facts[0], {
    subject: '', predicate: '', object: '假身份已经暴露', certainty: 'confirmed', evidence: '工牌和脸对不上。',
  })
  assert.deepEqual(result.stateSnapshot.characterStates[0], {
    character: '林砚', location: '医院外墙', physical: '右肋伤势加剧', emotional: '', possessions: ['手机'], knows: ['医生仍只是嫌疑人'],
  })
  assert.deepEqual(result.stateSnapshot.relationshipChanges, ['林砚 → 保安：由被注意变为被追捕'])
  assert.deepEqual(result.stateSnapshot.foreshadow, { setups: ['钥匙尚未使用'], payoffs: ['身份暴露'] })
  assert.deepEqual(result.stateSnapshot.openThreads, ['继续追查药房路线'])
})

test('malformed structured output is classified and preserves the failed model response', () => {
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'chapter_state_extract',
    modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
  })
  const truncated = '{"summary":"章后状态","facts":[{"subject":"林砚"}'
  assert.throws(
    () => shapeModelResult(prepared, truncated),
    (error) => error instanceof StructuredOutputError
      && error.name === 'StructuredOutputError'
      && error.rawOutput === truncated,
  )
})

test('scene plan object pollution is retriable structured-output failure', () => {
  const ending = '保安抬头说：“名单里没有你。”'
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'scene_plan',
    chapter: { ...baseInput.chapter, card: { goal: '身份暴露', ending } },
    modelProfile: { id: 'mimo', provider: 'mimo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  })
  const polluted = JSON.stringify({
    schemaVersion: 1,
    summary: '核查身份',
    scenes: [{
      id: 'S1', title: '核查', pov: '林砚', time: '傍晚', location: '走廊', presentCharacters: ['林砚', '保安'],
      entryState: { location: '走廊', injury: '肋骨旧伤' }, goal: '离开医院', obstacle: '保安核查', actionBeats: [ending],
      turn: '身份暴露', exitState: { location: '走廊', exposed: true }, knowledgeChanges: [], continuityRisks: [],
    }],
    legacyNotes: '',
  })
  assert.throws(
    () => shapeModelResult(prepared, polluted),
    (error) => error instanceof StructuredOutputError && /结构校验失败/.test(error.message),
  )
})

test('scene plan ending mismatch reports the exact expected and actual beats for repair', () => {
  const ending = '林砚将特殊钥匙握在手心，左肩伤口传来撕裂般的疼痛。'
  const actual = '林砚咬紧牙关，消失在夜色中。'
  const prepared = prepareModelTask({
    ...baseInput,
    task: 'scene_plan',
    chapter: { ...baseInput.chapter, card: { goal: '取得钥匙', ending } },
    modelProfile: { id: 'mimo', provider: 'mimo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  })
  const content = JSON.stringify({
    schemaVersion: 1,
    summary: '取得钥匙',
    scenes: [{
      id: 'S1', title: '仓库发现', pov: '林砚', time: '夜晚', location: '仓库', presentCharacters: ['林砚'],
      entryState: '林砚位于仓库入口；左肩带伤', goal: '取得特殊钥匙', obstacle: '守卫追赶', actionBeats: [actual],
      turn: '林砚取得钥匙', exitState: '林砚离开仓库；持有特殊钥匙；左肩伤势加重', knowledgeChanges: ['钥匙用途未知'], continuityRisks: [],
    }],
    legacyNotes: ending,
  })

  assert.throws(
    () => shapeModelResult(prepared, content),
    (error) => error instanceof StructuredOutputError
      && error.message.includes(`期望：${JSON.stringify(ending)}`)
      && error.message.includes(`实际：${JSON.stringify(actual)}`),
  )
})

test('scene plans and quality reviews use validated structured responses', async () => {
  const scenePrepared = prepareModelTask({
    ...baseInput,
    task: 'scene_plan',
    modelProfile: { id: 'deepseek-default', provider: 'deepseek', name: 'DeepSeek', baseUrl: '', model: '', settings: { responseFormat: 'auto' } },
    mockDelayMs: 0,
  })
  const sceneResult = await runEmbeddedModelTask(scenePrepared)
  assert.equal(sceneResult.scenePlan.schemaVersion, 1)
  assert.ok(sceneResult.scenePlan.scenes.every((scene) => scene.entryState && scene.exitState))
  assert.deepEqual(scenePrepared.parameters.response_format, { type: 'json_object' })

  const qualityPrepared = prepareModelTask({
    ...baseInput,
    task: 'quality_review',
    evaluationCase: { assertions: [{ id: 'boundary' }] },
    sourceGeneration: { task: 'chapter', intent: 'draft', output: '正文候选' },
    mockDelayMs: 0,
  })
  const qualityResult = await runEmbeddedModelTask(qualityPrepared)
  assert.equal(qualityResult.review.scores.continuity, 3)
  assert.equal(qualityResult.review.assertionScores.boundary, 0)
  assert.match(qualityResult.review.summary, /Mock/)
})

test('provider capability probe checks model listing, text, streaming, and structured output', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'novel-pro' }, { id: 'novel-lite' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const body = JSON.parse(options.body)
    if (body.stream) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"NOVEL_STUDIO_OK"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    const content = body.response_format ? '{"status":"ok"}' : 'NOVEL_STUDIO_OK'
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await probeModelCapabilities({
      id: 'custom',
      provider: 'custom',
      name: '自定义模型',
      baseUrl: 'https://model.test/v1',
      model: 'novel-pro',
      settings: {},
    }, 'secret-key')

    assert.equal(result.overall, 'ready')
    assert.equal(result.modelList.supported, true)
    assert.deepEqual(result.modelList.models, ['novel-pro', 'novel-lite'])
    assert.equal(result.text.supported, true)
    assert.equal(result.streaming.supported, true)
    assert.equal(result.structuredOutput.supported, true)
    assert.equal(requests.length, 4)
    assert.equal(requests.some((request) => request.body?.response_format?.type === 'json_object'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider capability probe reports optional capability failures without hiding text readiness', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return new Response('not exposed', { status: 404 })
    const body = JSON.parse(options.body)
    if (body.response_format) return new Response('unsupported', { status: 400 })
    if (body.stream) {
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"NOVEL_STUDIO_OK"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'NOVEL_STUDIO_OK' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await probeModelCapabilities({
      provider: 'custom', name: '兼容模型', baseUrl: 'https://model.test/v1', model: 'novel', settings: {},
    }, 'secret-key')
    assert.equal(result.overall, 'limited')
    assert.equal(result.text.supported, true)
    assert.equal(result.streaming.supported, true)
    assert.equal(result.modelList.supported, false)
    assert.equal(result.structuredOutput.supported, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
