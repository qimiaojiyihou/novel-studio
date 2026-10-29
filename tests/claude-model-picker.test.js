import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, reactive, nextTick } from 'vue'
import { claudeModelDirectory, claudeModelPresentation } from '../src/utils/claude-models.js'

test('Claude picker supports stable aliases before loading and arbitrary future CLI models without manual IDs', () => {
  assert.deepEqual(claudeModelDirectory().map(item => item.value), ['sonnet', 'opus', 'haiku'])
  const rows = claudeModelDirectory([{ id: 'model', options: [{ options: [{ value: 'future', displayName: 'Future Claude' }] }, { value: 'future', name: 'duplicate' }] }])
  assert.deepEqual(rows.map(item => item.value), ['future'])
  assert.equal(rows[0].name, 'Future Claude')
})

test('model names include the resolved version without replacing the selected CLI alias', () => {
  const row = claudeModelPresentation({ value: 'opus', name: 'Opus', resolvedModel: 'claude-opus-5-5', description: 'Opus 4.6 old hint' })
  assert.equal(row.name, 'Opus 5.5')
  assert.equal(row.value, 'opus')
  assert.equal(row.versionSource, 'model_id')
  assert.equal(claudeModelPresentation({ value: 'default', name: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' }).name, '默认（Opus 5.5）')
  assert.equal(claudeModelPresentation({ value: 'fable', name: 'Fable', resolvedModel: 'claude-fable-5-1' }).name, 'Fable 5.1')
  assert.equal(claudeModelPresentation({ value: 'claude-sonnet-4-5-20250929', name: 'Sonnet' }).name, 'Sonnet 4.5')
})

test('older CLI descriptions supply version hints while unresolved aliases stay explicitly unknown', () => {
  const row = claudeModelPresentation({ value: 'sonnet[1m]', name: 'Sonnet (1M context)', description: 'Sonnet 4.6 for long sessions · pricing omitted' })
  assert.equal(row.name, 'Sonnet 4.6 (1M context)')
  assert.equal(row.versionSource, 'cli_description')
  assert.equal(row.resolvedModel, undefined)
  assert.equal(claudeModelDirectory()[0].name, 'Claude Sonnet · 版本待读取')
  const custom = claudeModelPresentation({ value: 'opus', name: 'Opus', resolvedModel: 'vendor/custom-model', description: 'Opus 5.5' })
  assert.equal(custom.name, 'Opus · 自定义映射')
  assert.equal(custom.versionLabel, '')
})

const componentUrl = new URL('../src/components/ModelSettings.vue', import.meta.url)
const { descriptor } = parse(fs.readFileSync(componentUrl, 'utf8'))
const flush = async () => { for (let i = 0; i < 8; i++) await nextTick() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let serial = 0

async function mountPicker(t, { provider = 'claude', cached = [], selected = 'saved-custom' } = {}) {
  const reads = [], requests = [], id = `claude-picker-${++serial}`
  const service = {
    getCodexStatus: async () => ({ settings: { agentProvider: provider, grokModel: selected, grokCliPath: '', claudeModel: selected, claudeCliPath: '', claudeAuthMethod: 'cli' },
      runtime: {}, grokRuntime: { configOptions: cached }, claudeRuntime: { configOptions: cached, modelCatalog: { cached: true, refreshedAt: '2026-10-24T00:00:00Z' } } }),
    getCodexModels: input => { reads.push(input); const request = deferred(); requests.push(request); return request.promise },
  }
  globalThis[id] = service
  const compiled = compileScript(descriptor, { id }).content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (all, bindings, source) => {
    if (source.endsWith('/app-service.js')) return `const { appService } = { appService: globalThis[${JSON.stringify(id)}] };`
    if (source.endsWith('.vue')) return `const ${bindings.trim()} = {};`
    return `import ${bindings} from ${JSON.stringify(source === 'vue' ? import.meta.resolve('vue') : new URL(source, componentUrl).href)};`
  })
  const component = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).default
  component.render = () => null
  const renderer = createRenderer({ createComment: () => ({}), createText: () => ({}), createElement: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const props = reactive({ visible: false, settings: { profiles: [], routes: {} } })
  const app = renderer.createApp({ render: () => h(component, props) })
  app.mount({})
  const state = app._instance.subTree.component.setupState
  t.after(() => { app.unmount(); delete globalThis[id] })
  props.visible = true
  await flush()
  return { state, props, reads, requests }
}

const result = (value = 'new-model') => ({ status: { configOptions: [{ id: 'model', options: [{ value, name: 'New Claude' }] }], refreshedAt: '2026-10-24T01:00:00Z', runtime: {} } })

test('opening Claude settings automatically reads the list and leaves the saved model unchanged', async t => {
  const f = await mountPicker(t)
  assert.equal(f.reads.length, 1)
  assert.equal(f.reads[0].agentProvider, 'claude')
  assert.equal(f.reads[0].model, '')
  assert.equal(f.state.claudeModelsLoading, true)
  assert.deepEqual(f.state.claudeModelOptions.map(item => item.value), ['sonnet', 'opus', 'haiku'])
  f.requests[0].resolve(result())
  await flush()
  assert.deepEqual(f.state.claudeModelOptions.map(item => item.value), ['new-model'])
  assert.equal(f.state.codexDraft.claudeModel, 'saved-custom')
  assert.equal(f.state.claudeModelsLoading, false)
})

test('the default option shows its resolved version and selected model details use the exact CLI ID', async t => {
  const f = await mountPicker(t, { selected: '' })
  f.requests[0].resolve({ status: { configOptions: [{ id: 'model', options: [
    { value: 'default', name: 'Default (recommended)', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['medium', 'high'] },
    { value: 'sonnet', name: 'Sonnet', resolvedModel: 'claude-sonnet-5-5', supportedEffortLevels: ['low', 'high'] },
  ] }], runtime: {} } })
  await flush()
  assert.equal(f.state.claudeDefaultModelLabel, 'CLI 默认模型（当前 Opus 5.5）')
  assert.equal(f.state.claudeSelectedModel.resolvedModel, 'claude-opus-5-5')
  assert.deepEqual(f.state.claudeEffortOptions.map(option => option.value), ['medium', 'high'])
  f.state.codexDraft.claudeModel = 'sonnet'
  await flush()
  assert.equal(f.state.claudeSelectedModel.name, 'Sonnet 5.5')
  assert.equal(f.state.claudeSelectedModel.resolvedModel, 'claude-sonnet-5-5')
})

test('failed automatic refresh retains cached choices and the current selection', async t => {
  const f = await mountPicker(t, { cached: result('cached-model').status.configOptions, selected: 'cached-model' })
  assert.equal(f.state.claudeModelOptions[0].value, 'cached-model')
  f.requests[0].reject(new Error('metadata offline'))
  await flush()
  assert.equal(f.state.claudeModelOptions[0].value, 'cached-model')
  assert.equal(f.state.codexDraft.claudeModel, 'cached-model')
  assert.equal(f.state.codexMessage.state, 'error')
})

test('switching providers loads Claude automatically and ignores a late response after leaving', async t => {
  const f = await mountPicker(t, { provider: 'qoder' })
  assert.equal(f.reads.length, 0)
  f.state.codexDraft.agentProvider = 'claude'
  await flush()
  assert.equal(f.reads.length, 1)
  f.state.codexDraft.agentProvider = 'qoder'
  await flush()
  f.requests[0].resolve(result('late-model'))
  await flush()
  assert.notEqual(f.state.codexStatus.claudeRuntime?.configOptions?.[0]?.options?.[0]?.value, 'late-model')
  assert.equal(f.state.claudeModelsLoading, false)
})

test('closing the panel ignores its in-flight response', async t => {
  const f = await mountPicker(t)
  f.props.visible = false
  await flush()
  f.requests[0].resolve(result('closed-panel-model'))
  await flush()
  assert.notEqual(f.state.codexStatus.claudeRuntime?.configOptions?.[0]?.options?.[0]?.value, 'closed-panel-model')
})

test('changing the CLI path drops stale choices and late results from the old source', async t => {
  const f = await mountPicker(t, { cached: result('old-cache').status.configOptions })
  f.state.codexDraft.claudeCliPath = '/synthetic/new-claude'
  await flush()
  const refresh = f.state.refreshClaudeModels(true)
  await flush()
  assert.equal(f.reads.length, 2)
  f.requests[0].resolve(result('old-response'))
  await flush()
  assert.notEqual(f.state.claudeModelOptions[0].value, 'old-response')
  f.requests[1].resolve(result('new-source'))
  await refresh
  assert.equal(f.state.claudeModelOptions[0].value, 'new-source')
  assert.equal(f.state.codexDraft.claudeModel, 'saved-custom')
})

test('Grok ACP model discovery uses local login settings and preserves the chosen model across failures', async t => {
  const f = await mountPicker(t, { provider: 'grok', selected: 'grok-chosen' })
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].agentProvider,'grok'); assert.equal(f.reads[0].model,'grok-chosen')
  assert.equal(f.reads[0].reasoningEffort,'')
  f.requests[0].resolve({ status: { configOptions: [
    { id:'model',type:'select',currentValue:'grok-chosen',options:[{value:'grok-chosen',name:'Grok Chosen'}] },
    { id:'reasoning_effort',type:'select',currentValue:'high',options:[{value:'low',name:'Low'},{value:'high',name:'High'}] },
  ], runtime:{} }, message:'目录读取成功' })
  await flush()
  assert.deepEqual(f.state.grokModelOptions.map(o=>o.value),['grok-chosen'])
  assert.deepEqual(f.state.grokEffortOptions.map(o=>o.value),['low','high'])
  const pending=f.state.refreshGrokModels(); await flush(); f.requests[1].reject(new Error('登录过期')); await pending
  assert.equal(f.state.codexDraft.grokModel,'grok-chosen'); assert.equal(f.state.grokModelOptions[0].value,'grok-chosen')
})

test('a late Grok directory response cannot replace another executor state', async t => {
  const f = await mountPicker(t, { provider:'grok' })
  f.state.codexDraft.agentProvider='qoder'; await flush()
  f.requests[0].resolve({ status:{configOptions:[{id:'model',options:[{value:'stale',name:'Stale'}]}],runtime:{}},message:'stale' }); await flush()
  assert.equal(f.state.codexDraft.agentProvider,'qoder'); assert.deepEqual(f.state.grokModelOptions,[])
})
