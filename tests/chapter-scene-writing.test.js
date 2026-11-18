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
