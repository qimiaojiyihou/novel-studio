import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chapterWritingScenes, compileChapterScene } from '../electron/chapter-scene-writing.js'

test('each draft request includes only its scene, applicable prose and preceding story', () => {
  const scenes = [{ title: '算价钱', goal: '他舍不得这笔钱。' }, { title: '关窗', goal: '她合上窗户。' }]
  const sample = { use: '人物盘算', text: '只有第一场能看到的原文', title: '参考', label: '第一章' }
  const input = { project: { title: '本书', style: '旁白跟着人物走。' }, chapter: { chapter_no: 4, title: '过河', scenePlan: { scenes } },
    task: 'chapter', intent: 'draft', promptContext: { voiceLibrary: { samples: [sample, { use: '底色', text: '固定原文' }] } } }
  const get = (index, preceding) => compileChapterScene({ input, scenes, index, preceding, previousEnding: '第三章章尾', targetLength: 1800 })
  const first = get(0, ''), second = get(1, '他付了钱。')
  assert.deepEqual(first.voiceSamples.map(s => s.use), ['人物盘算'])
  assert.match(first.messages[1].content, /只有第一场能看到的原文/)
  assert.doesNotMatch(first.messages[1].content, /合上窗户|固定原文/)
  assert.deepEqual(second.voiceSamples, [])
  assert.match(second.messages[1].content, /他付了钱。/)
  assert.match(second.messages[1].content, /第三章章尾/)
  assert.match(second.messages[1].content, /旁白跟着人物走/)
  assert.doesNotMatch(second.messages[1].content, /固定原文|只有第一场能看到的原文|算价钱/)
  const step = { candidateType: 'manuscript', input: {} }
  assert.deepEqual(chapterWritingScenes(input, 'codex', step), scenes)
  assert.deepEqual(chapterWritingScenes({ ...input, intent: 'continue' }, 'codex', step), [])
  assert.deepEqual(chapterWritingScenes(input, 'claude', step), [])
})

test('a malformed second scene retries only that scene and the merged chapter contains each successful response once', async () => {
  const { AgentRuntime } = await import('../electron/agent-runtime.js')
  const histories = [], calls = [], finished = []
  const runtime = new AgentRuntime({
    prepareCodexPrompt: () => ({
      sceneCount: 2, generationRecordId: 'merged', agentProvider: 'codex',
      prepareScene(index, preceding, retryOf) {
        histories.push({ index, preceding, retryOf })
        return { generationRecordId: 'scene-' + histories.length, isolatedScene: true, messages: [{ role: 'user', content: String(index) }] }
      },
    }),
    codexGateway: { prompt: async request => {
      calls.push(request)
      const text = ['甲场正文', '', '乙场正文'][calls.length - 1]
      return { structuredOutput: { manuscript: text }, backend: 'codex_acp' }
    } },
    completeCodexGeneration: async event => finished.push([event.prepared.generationRecordId, event.status]),
  })
  const run = { id: 'run', projectId: 'book', executionMode: 'codex', modelRoutes: {} }
  const result = await runtime._executeTask({ run, step: { id: 'step', task: 'chapter' }, mirror: { root: '/unused' }, signal: new AbortController().signal })
  assert.equal(result.structuredOutput.manuscript, '甲场正文\n\n乙场正文')
  assert.deepEqual(result.sceneRecords, ['scene-1', 'scene-3'])
  assert.deepEqual(histories.map(h => [h.index,h.preceding,h.retryOf]), [[0,'',null],[1,'甲场正文',null],[1,'甲场正文','scene-2']])
  assert.deepEqual(finished, [['scene-1','completed'],['scene-2','failed'],['scene-3','completed'],['merged','completed']])
  assert.ok(calls.every(call => call.settings.isolatedScene && !call.continuationMessages))
})

test('scene budgets use actual chapter text, exclude the previous chapter and reserve the closing cue for the last scene', () => {
  const scenes = [{ title: '进门' }, { title: '看账' }, { title: '还钱' }]
  const input = { project: { title: '旧账' }, chapter: {} }
  const compile = (index, preceding) => compileChapterScene({ input, scenes, index, preceding,
    previousEnding: '旧'.repeat(1800), targetLength: 2500 })
  const first = compile(0, '')
  assert.equal(first.scene.budget.target, 833)
  assert.doesNotMatch(first.messages[1].content, /【章末收束】/)
  const second = compile(1, '甲'.repeat(700) + '，。')
  assert.deepEqual(second.scene.budget, { chapterTarget: 2500, written: 700, target: 900 })
  const last = compile(2, '乙'.repeat(1530))
  assert.equal(last.scene.budget.target, 970)
  assert.match(last.messages[1].content, /【章末收束】/)
})

test('a length correction revisits only the closing scene and assembles the closer valid draft', async () => {
  const { AgentRuntime } = await import('../electron/agent-runtime.js')
  for (const [initial, revised, accepted] of [[80, 100, 100], [80, 50, 80], [80, 0, 80], [100, 0, 100], [130, 105, 105]]) {
    const calls = []
    const runtime = new AgentRuntime({
      prepareCodexPrompt: () => ({
        sceneCount: 2, generationRecordId: 'parent',
        prepareScene(index, preceding, retryOfId, lengthDraft) {
          calls.push({ index, preceding, retryOfId, lengthDraft })
          return { isolatedScene: true, promptSnapshot: { scene: { budget: { chapterTarget: 200, written: preceding.length } } },
            generationRecordId: 'child-' + calls.length, messages: [] }
        },
      }),
      codexGateway: { prompt: async () => ({ backend: 'codex_acp', structuredOutput: {
        manuscript: calls.length === 1 ? '甲'.repeat(100) : '乙'.repeat(calls.length === 2 ? initial : revised),
      } }) },
      completeCodexGeneration: async () => {},
    })
    const result = await runtime._executeTask({ run: { id: 'r', executionMode: 'codex', modelRoutes: {} },
      step: { id: 's', task: 'chapter' }, mirror: { root: '/unused' }, signal: new AbortController().signal })
    assert.equal(result.structuredOutput.manuscript, '甲'.repeat(100) + '\n\n' + '乙'.repeat(accepted))
    assert.equal(calls.length, initial === 100 ? 2 : 3)
    if (calls.length === 3) assert.deepEqual(calls[2], { index: 1, preceding: '甲'.repeat(100),
      retryOfId: 'child-2', lengthDraft: '乙'.repeat(initial) })
    assert.deepEqual(result.sceneRecords, ['child-1', accepted === initial ? 'child-2' : 'child-3'])
  }
})

test('late multi-scene chapters bound the entire wire request including schema, without shortening the final chapter or leaking plans', async () => {
  const { codexPromptText } = await import('../electron/codex-agent-gateway.js')
  const scenes = Array.from({ length: 41 }, (_, i) => ({ title: '书院' + i, goal: '该场专属目标' + i + '号' }))
  const parts = scenes.slice(0, -1).map((_, i) => '行'.repeat(2400) + '实际落点' + i)
  const preceding = parts.join('\n\n')
  const input = { project: { title: '旧账', style: '旧'.repeat(12000) + '注意人称' }, chapter: { chapter_no: 800, title: '归来' },
    sceneInstruction: '只让他发现还款凭条', longContext: { text: '其他章节原文'.repeat(150000) } }
  const outputSchema = { description: '格式说明'.repeat(150), properties: { manuscript: { type: 'string' } } }
  const options = { input, scenes, preceding, precedingScenes: parts, previousEnding: '前章结尾', index: 40, displayTitle: '终场',
    outputSchema, targetLength: 12000 }
  for (const limit of [8000, 1000000, undefined]) {
    const snap = compileChapterScene({ ...options, maxChars: limit })
    const wire = codexPromptText({ messages: snap.messages, outputSchema, displayTitle: '终场' })
    assert.equal(snap.contextDiagnostics.usedChars, wire.length)
    assert.equal(snap.contextDiagnostics.usedBytes, Buffer.byteLength(wire))
    assert.ok(wire.length <= Math.min(24000, limit || Infinity) && Buffer.byteLength(wire) <= 48000)
    assert.ok(snap.contextDiagnostics.shortened.includes('earlierScenes'))
    assert.match(wire, /实际落点39/)
    assert.match(wire, /该场专属目标40号/)
    assert.match(wire, /只让他发现还款凭条/)
    assert.match(wire, /注意人称/)
    assert.doesNotMatch(wire, /其他章节原文|该场专属目标39号/)
    assert.equal(snap.scene.budget.written, 2400 * 40 + 4 * 40)
    if (limit !== 8000) assert.match(wire, /第1场末尾原文/)
  }
  assert.equal(parts.length, 40)
})

test('oversize mandatory material is reported before sending; a matched quotation is never sent partially', () => {
  const scene = { title: '算价钱', goal: '他舍不得这笔钱。' }
  const input = { project: { title: '还钱', style: '节制' }, chapter: { title: '钱' }, task: 'chapter', intent: 'draft',
    promptContext: { voiceLibrary: { samples: [{ use: '人物盘算', text: '不得泄露片段'.repeat(2000), title: '参考', label: '一' }] } } }
  const opts = { scenes: [scene], index: 0, input, maxChars: 8000 }
  const snap = compileChapterScene(opts)
  assert.deepEqual(snap.voiceSamples, [])
  assert.ok(snap.contextDiagnostics.shortened.includes('reference'))
  assert.doesNotMatch(snap.messages[1].content, /不得泄露片段/)
  assert.throws(() => compileChapterScene({ ...opts, lengthDraft: '全'.repeat(8400) }), { name: 'SceneRepairContextTooLarge' })
  assert.throws(() => compileChapterScene({ ...opts, input: { ...input, sceneInstruction: '约定'.repeat(8000) } }), { name: 'SceneContextTooLarge' })
})
