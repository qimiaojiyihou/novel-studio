<template>
  <div v-if="visible" class="settings-backdrop" @click.self="$emit('close')">
    <section class="settings-panel" aria-label="模型与任务路由">
      <header class="settings-header">
        <div>
          <span class="eyebrow copper">MODEL CABINET</span>
          <h2>模型与任务路由</h2>
          <p>把创作任务交给合适的模型。正文、本地模型和外部模型可以分别配置。</p>
        </div>
        <button class="settings-close" title="关闭设置" @click="$emit('close')">×</button>
      </header>

      <div class="settings-content">
        <section class="settings-block codex-agent-block">
          <div class="settings-block-heading">
            <div>
              <span class="settings-kicker">ACP AGENT</span>
              <h3>{{ agentName }} 创作 Agent</h3>
            </div>
            <span class="codex-runtime-state" :class="selectedAgentRuntime?.available ? 'ready' : 'missing'">
              {{ selectedAgentRuntime?.available ? 'ACP 已就绪' : '运行时待检查' }}
            </span>
          </div>
          <p class="codex-agent-intro">作为独立执行方式运行创作工作流。{{ codexDraft.agentProvider === 'qoder' ? 'Qoder 通过本机 qoder / qodercn 的 --acp 模式建立长会话，复用 CLI 登录状态。' : 'Codex 优先使用 ACP 长会话；启动失败且尚未产生输出时，自动进入只读 exec 兼容模式。' }}</p>
          <div class="codex-proof-grid">
            <article><span>ACP</span><strong>{{ selectedAgentRuntime?.adapterVersion || '—' }}</strong><small>{{ integrityLabel }}</small></article>
            <article><span>CLI</span><strong>{{ selectedAgentRuntime?.cliVersion || (selectedAgentRuntime?.available ? '已检测' : '—') }}</strong><small>{{ codexDraft.agentProvider === 'qoder' ? (selectedAgentRuntime?.executablePath || '等待填写 Qoder CLI 路径') : '随安装包固定发布' }}</small></article>
            <article><span>认证</span><strong>{{ agentAuthLabel }}</strong><small>{{ agentAuthDetail }}</small></article>
          </div>
          <div class="codex-settings-grid">
            <label><span>ACP 提供方</span><select v-model="codexDraft.agentProvider"><option value="codex">Codex</option><option value="qoder">Qoder</option></select></label>
            <label v-if="codexDraft.agentProvider === 'codex'"><span>默认认证</span><select v-model="codexDraft.authMethod"><option value="chatgpt">ChatGPT 登录</option><option value="environment" :disabled="!codexStatus.runtime?.environmentAuthAvailable">环境 API Key</option></select></label>
            <label v-if="codexDraft.agentProvider === 'qoder'" class="wide">
              <span>Qoder 默认模型</span>
              <select v-model="codexDraft.qoderModel">
                <option v-for="option in qoderModelOptions" :key="option.value" :value="option.value">{{ option.name }}{{ option.description ? ` · ${option.description}` : '' }}</option>
              </select>
              <small>{{ qoderModelConfig.options?.length ? '模型目录来自当前 Qoder ACP 登录账号；新任务会锁定这里选择的模型。' : '点击“测试 Qoder ACP”读取当前账号的模型目录。' }}</small>
            </label>
            <label v-if="codexDraft.agentProvider === 'qoder'" class="wide"><span>Qoder CLI 路径</span><input v-model.trim="codexDraft.qoderCliPath" placeholder="留空自动检测，例如 ~/.qoder-cn/entry/qodercn" /><small>支持 Qoder CLI 与 Qoder CLI CN；先在终端执行 qoder login 或 qodercn login，也可向应用进程提供 QODER_PERSONAL_ACCESS_TOKEN。</small></label>
            <label v-if="codexDraft.agentProvider === 'codex'">
              <span>默认模型</span>
              <input v-model="codexModelSearch" type="search" placeholder="搜索名称或模型 ID" aria-label="搜索 Codex 模型" />
              <select v-model="codexDraft.model" @change="refreshCodexModels(true)">
                <option value="">运行时默认{{ codexDefaultModel ? ` · ${codexDefaultModel}` : '' }}</option>
                <option v-for="option in filteredCodexModels" :key="option.value" :value="option.value">{{ option.name }} · {{ modelAvailability(option.status) }}</option>
              </select>
              <details><summary>高级模型 ID</summary><input v-model.trim="codexDraft.model" placeholder="例如 gpt-6-astra" aria-label="高级 Codex 模型 ID" /></details>
              <small>GPT-6 Astra 对应 gpt-6-astra。可用性以当前 ACP 目录为准；已有对话继续使用启动时锁定的模型。</small>
            </label>
            <label v-if="codexDraft.agentProvider === 'codex'"><span>推理强度</span><select v-model="codexDraft.reasoningEffort"><option value="">模型默认</option><option v-for="option in codexReasoningOptions" :key="option.value" :value="option.value">{{ option.name }}</option><option v-if="codexDraft.reasoningEffort && !codexReasoningOptions.some(o => o.value === codexDraft.reasoningEffort)" :value="codexDraft.reasoningEffort">{{ codexDraft.reasoningEffort }} · 待刷新验证</option></select></label>
            <label v-if="codexDraft.agentProvider === 'codex'" class="codex-toggle"><span>Fast mode{{ codexFastSupported ? '' : ' · 待验证支持' }}</span><input v-model="codexDraft.fastMode" type="checkbox" :disabled="!codexFastSupported" /></label>
          </div>
          <div v-if="codexMessage.text" class="connection-result" :class="codexMessage.state"><i></i><span>{{ codexMessage.text }}</span></div>
          <div class="codex-actions">
            <button v-if="codexDraft.agentProvider === 'codex'" class="outline-button" :disabled="codexBusy" @click="authenticateCodex">{{ codexDraft.authMethod === 'environment' ? '使用环境变量认证' : '登录 ChatGPT' }}</button>
            <button class="test-button" :disabled="codexBusy" @click="testCodex">测试 {{ agentName }} ACP</button>
            <button v-if="codexDraft.agentProvider === 'codex'" class="outline-button" :disabled="codexBusy" @click="refreshCodexModels()">刷新模型列表</button>
            <button class="primary-button" :disabled="codexBusy" @click="saveCodex">保存 Agent 设置</button>
          </div>
          <small class="codex-permission-note">工具权限按次审批；不会提供永久允许。{{ agentName }} 只访问当前 AgentRun 的受控镜像，结果只进入候选区。</small>
        </section>
        <section class="settings-block route-block">
          <div class="settings-block-heading">
            <div>
              <span class="settings-kicker">TASK ROUTING</span>
              <h3>任务路由</h3>
            </div>
            <span class="settings-hint">生成时按任务选择</span>
          </div>
          <div class="route-list">
            <label v-for="task in taskDefinitions" :key="task.id" class="route-row">
              <span class="route-copy">
                <strong>{{ task.label }}</strong>
                <small>{{ task.description }}</small>
              </span>
              <select :value="settings.routes?.[task.id] || ''" @change="$emit('route-change', { task: task.id, modelProfileId: $event.target.value })">
                <option v-for="profile in enabledProfiles" :key="profile.id" :value="profile.id">
                  {{ profile.name }}{{ profile.model ? ` · ${profile.model}` : '' }}
                </option>
              </select>
            </label>
          </div>
        </section>

        <section class="settings-block profile-block">
          <div class="settings-block-heading">
            <div>
              <span class="settings-kicker">MODEL PROFILES</span>
              <h3>模型配置</h3>
            </div>
            <button class="settings-add" @click="startNewProfile">＋ 添加模型</button>
          </div>

          <div class="profile-list">
            <article v-for="profile in settings.profiles" :key="profile.id" class="profile-row" :class="{ selected: editingId === profile.id }">
              <span class="profile-orb" :class="profile.provider"></span>
              <div class="profile-copy">
                <strong>{{ profile.name }}</strong>
                <small>{{ providerLabel(profile.provider) }} · {{ profile.model || '模型名称待填写' }}</small>
              </div>
              <span v-if="profile.testedAt" class="capability-state" :class="profile.capabilities?.overall || 'unavailable'">
                {{ capabilityOverallLabel(profile.capabilities?.overall) }}
              </span>
              <span v-if="profile.apiKeyConfigured" class="key-state">密钥已配置</span>
              <span v-else class="key-state empty">待配置</span>
              <button class="profile-edit" @click="editProfile(profile)">编辑</button>
            </article>
          </div>

          <form v-if="editingId !== null" class="profile-form" @submit.prevent="submitProfile">
            <div class="form-heading">
              <div>
                <span class="settings-kicker">{{ draft.id ? 'EDIT PROFILE' : 'NEW PROFILE' }}</span>
                <h4>{{ draft.id ? '编辑模型配置' : '添加 OpenAI 兼容模型' }}</h4>
              </div>
              <button v-if="draft.id && !isBuiltIn(draft)" type="button" class="delete-profile" @click="requestDelete">删除</button>
            </div>

            <div class="form-grid">
              <label>
                <span>类型</span>
                <select v-model="draft.provider">
                  <option value="local">本地模型</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="mimo">小米 MiMo</option>
                  <option value="openai">GPT / OpenAI</option>
                  <option value="kimi">Kimi</option>
                  <option value="custom">其他 OpenAI 兼容</option>
                </select>
              </label>
              <label>
                <span>显示名称</span>
                <input v-model.trim="draft.name" required placeholder="例如：我的正文模型" />
              </label>
              <label class="wide">
                <span>Base URL</span>
                <input v-model.trim="draft.baseUrl" required placeholder="https://api.example.com/v1" />
              </label>
              <label>
                <span>模型名称</span>
                <input v-model.trim="draft.model" placeholder="填写服务商提供的模型名" />
              </label>
              <label>
                <span>API Key</span>
                <input v-model="draft.apiKey" type="password" autocomplete="new-password" placeholder="留空表示保持现有密钥" />
              </label>
            </div>
            <details v-if="draft.provider === 'deepseek' || isMiMoDraft()" class="advanced-cabinet" open>
              <summary><span><b>{{ isMiMoDraft() ? '小米 MiMo 高级参数' : 'DeepSeek 高级参数' }}</b><small>思考、采样和输出预算</small></span><i>⌄</i></summary>
              <div class="advanced-grid">
                <label>
                  <span>思考模式</span>
                  <select v-model="draft.settings.thinkingEnabled">
                    <option :value="true">启用</option>
                    <option :value="false">关闭</option>
                  </select>
                </label>
                <label v-if="draft.provider === 'deepseek'">
                  <span>推理强度</span>
                  <select v-model="draft.settings.reasoningEffort" :disabled="!draft.settings.thinkingEnabled">
                    <option value="low">Low · 速度优先</option>
                    <option value="high">High · 默认</option>
                    <option value="max">Max · 质量优先</option>
                  </select>
                </label>
                <label>
                  <span>采样控制</span>
                  <select v-model="draft.settings.samplingMode">
                    <option value="task-default">按任务默认</option>
                    <option value="temperature">Temperature</option>
                    <option value="top_p">Top P</option>
                  </select>
                </label>
                <label v-if="draft.settings.samplingMode === 'temperature'">
                  <span>Temperature · 0–2</span>
                  <input v-model.number="draft.settings.temperature" type="number" min="0" max="2" step="0.05" />
                </label>
                <label v-else-if="draft.settings.samplingMode === 'top_p'">
                  <span>Top P · 0–1</span>
                  <input v-model.number="draft.settings.topP" type="number" min="0" max="1" step="0.05" />
                </label>
                <label>
                  <span>最大输出 Token</span>
                  <input v-model.number="draft.settings.maxTokens" type="number" min="1" max="131072" step="256" />
                </label>
                <label>
                  <span>结构化输出</span>
                  <select v-model="draft.settings.responseFormat">
                    <option value="auto">自动 · 章节卡使用 JSON</option>
                    <option value="text">始终文本</option>
                    <option value="json_object">始终 JSON</option>
                  </select>
                </label>
              </div>
              <p v-if="isMiMoDraft()">MiMo 使用官方 <code>max_completion_tokens</code> 输出预算；开启思考时，采样值由模型采用推荐默认值。章节卡、场景计划和评审在“自动”模式下请求 JSON。</p>
              <p v-else>章节卡在“自动”模式下请求 JSON；其他写作任务保持文本。采样控制遵循 Temperature 与 Top P 二选一。</p>
            </details>
            <details class="json-cabinet" :open="draft.provider === 'custom'">
              <summary><span><b>JSON 请求配置</b><small>供应商参数、请求头和任务覆盖</small></span><i>⌄</i></summary>
              <div class="json-config-sheet">
                <div class="json-config-guide">
                  <span><b>endpointPath</b> 自定义接口路径</span>
                  <span><b>headers</b> 额外请求头</span>
                  <span><b>body</b> 全局参数</span>
                  <span><b>taskBody</b> 按任务覆盖</span>
                </div>
                <textarea
                  v-model="requestConfigText"
                  spellcheck="false"
                  aria-label="JSON 请求配置"
                  @input="markJsonDirty"
                ></textarea>
                <div class="json-config-status" :class="jsonValidation.state">
                  <span><i></i>{{ jsonValidation.message }}</span>
                  <button type="button" @click="validateRequestConfig">校验 JSON</button>
                </div>
                <p><code>model</code>、<code>messages</code> 和 <code>stream</code> 由软件管理。密钥请求头请写成 <code v-pre>{{apiKey}}</code>，明文密钥不会进入 JSON 配置。</p>
              </div>
            </details>
            <div class="form-footnote">API Key 只在本机保存，列表不会显示密钥内容。开源版本不附带任何本地模型权重。</div>
            <div v-if="connectionTest.state !== 'idle'" class="connection-result" :class="connectionTest.state">
              <i></i><span>{{ connectionTest.message }}</span>
            </div>
            <div v-if="saveState.state !== 'idle'" class="connection-result" :class="saveState.state">
              <i></i><span>{{ saveState.message }}</span>
            </div>
            <section v-if="draft.testedAt" class="capability-proof">
              <div class="capability-proof-head">
                <div><span class="settings-kicker">CAPABILITY PROOF</span><strong>供应商能力探测</strong></div>
                <small>{{ formatTestedAt(draft.testedAt) }} · 保存配置后保留结果</small>
              </div>
              <div class="capability-grid">
                <article v-for="item in capabilityDefinitions" :key="item.key" :class="capabilityResult(item.key)?.supported ? 'supported' : 'unsupported'">
                  <span>{{ item.marker }}</span>
                  <div><strong>{{ item.label }}</strong><small>{{ capabilityDetail(item.key) }}</small></div>
                </article>
              </div>
            </section>
            <div class="form-actions">
              <button type="button" class="outline-button" @click="cancelEdit">取消</button>
              <button type="button" class="test-button" :disabled="connectionTest.state === 'testing'" @click="testConnection">
                {{ connectionTest.state === 'testing' ? '正在测试…' : '测试连接' }}
              </button>
              <button type="submit" class="primary-button" :disabled="saveState.state === 'saving'">
                {{ saveState.state === 'saving' ? '正在保存…' : '保存配置' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { modelDirectory } from '../../electron/codex-models.js'
import {
  normalizeRequestConfig,
  parseRequestConfigJson,
  REQUEST_CONFIG_TEMPLATE,
} from '../../electron/model-request-config.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  settings: { type: Object, required: true },
  saveState: { type: Object, default: () => ({ state: 'idle', message: '' }) },
})

const emit = defineEmits(['close', 'save-profile', 'delete-profile', 'route-change'])

const taskDefinitions = [
  { id: 'chapter', label: '正文续写', description: '默认优先选择本地正文模型' },
  { id: 'planning_field', label: '故事规划', description: '故事基础、人物、世界观与总纲的逐项生成' },
  { id: 'chapter_card', label: '章节卡', description: '将想法拆成可执行的章节合同' },
  { id: 'scene_plan', label: '场景计划', description: '把章节卡变成场景动作链' },
  { id: 'rewrite', label: '局部重写', description: '处理编辑器中选中的文字' },
  { id: 'chapter_state_extract', label: '章后状态', description: '从已写正文提取下一章可用的事实与人物状态' },
  { id: 'continuity_audit', label: '连续性审计', description: '核对正文与已确认事实并生成待处理提醒' },
  { id: 'quality_review', label: '创作质量评审', description: '独立检查规划遵循、因果、连续性、人物与文字质量' },
]

const editingId = ref(null)
const draft = reactive(emptyDraft())
const connectionTest = reactive({ state: 'idle', message: '' })
const requestConfigText = ref('')
const jsonValidation = reactive({ state: 'idle', message: '保存或测试前会自动校验' })
const enabledProfiles = computed(() => props.settings.profiles.filter((profile) => profile.enabled))
const codexStatus = reactive({ runtime: {}, qoderRuntime: {}, settings: {} })
const codexDraft = reactive({ enabled: true, preferredBackend: 'codex_acp', agentProvider: 'codex', qoderCliPath: '', qoderModel: 'auto', model: '', reasoningEffort: 'high', fastMode: false, authMethod: 'chatgpt' })
const codexMessage = reactive({ state: 'idle', text: '' })
const codexBusy = ref(false)
const agentName = computed(() => codexDraft.agentProvider === 'qoder' ? 'Qoder' : 'Codex')
const selectedAgentRuntime = computed(() => codexDraft.agentProvider === 'qoder' ? codexStatus.qoderRuntime : codexStatus.runtime)
const integrityLabel = computed(() => ({ verified: '摘要校验通过', development: '开发环境校验', external: '本机外部运行时', invalid: '摘要或版本不匹配', missing: '资源缺失' }[selectedAgentRuntime.value?.integrity] || '等待诊断'))
const agentAuthLabel = computed(() => codexDraft.agentProvider === 'qoder'
  ? (selectedAgentRuntime.value?.environmentAuthAvailable ? 'Qoder PAT' : 'Qoder 登录态')
  : (codexDraft.authMethod === 'environment' ? '环境变量' : 'ChatGPT'))
const agentAuthDetail = computed(() => {
  if (codexDraft.agentProvider === 'qoder') {
    return selectedAgentRuntime.value?.environmentAuthAvailable
      ? '检测到 QODER_PERSONAL_ACCESS_TOKEN'
      : '复用 qoder CLI 本机登录状态'
  }
  return codexStatus.runtime?.authenticatedMethod
    ? '本次应用会话已认证'
    : codexStatus.runtime?.environmentAuthAvailable
      ? '检测到 API Key 环境变量'
      : '不保存 Codex 凭据'
})
const codexModelConfig = computed(() => codexStatus.runtime?.configOptions?.find((option) => option.id === 'model') || {})
const codexModelSearch = ref('')
const codexModelsRefreshed = ref(false)
const codexModelOptions = computed(() => modelDirectory(codexStatus.runtime?.configOptions || [], codexModelsRefreshed.value))
const filteredCodexModels = computed(() => codexModelOptions.value.filter((option) => option.value === codexDraft.model || `${option.name} ${option.value}`.toLowerCase().includes(codexModelSearch.value.toLowerCase())))
const codexReasoningOptions = computed(() => codexStatus.runtime?.configOptions?.find(o => o.id === 'reasoning_effort')?.options || [])
const codexFastSupported = computed(() => Boolean(codexStatus.runtime?.configOptions?.find(o => o.id === 'fast-mode')))
const modelAvailability = (status) => ({ available: '可用', pending: '待刷新', unsupported: '当前运行时未支持' }[status])
const codexDefaultModel = computed(() => codexModelConfig.value.currentValue || '')
const qoderModelConfig = computed(() => codexStatus.qoderRuntime?.configOptions?.find((option) => option.id === 'model') || {})
const qoderModelOptions = computed(() => {
  const options = (qoderModelConfig.value.options || []).flatMap((item) => item.options || [item])
  const values = new Set(options.map((item) => item.value))
  const result = options.map((item) => ({ value: item.value, name: item.name || item.value, description: item.description || '' }))
  if (!values.has('auto')) result.unshift({ value: 'auto', name: 'Auto', description: '使用 Qoder 默认选择' })
  if (codexDraft.qoderModel && !values.has(codexDraft.qoderModel) && codexDraft.qoderModel !== 'auto') {
    result.push({ value: codexDraft.qoderModel, name: codexDraft.qoderModel, description: '等待 ACP 回读验证' })
  }
  return result
})

watch(() => props.visible, (visible) => {
  if (!visible) cancelEdit()
  else void loadCodex()
})

async function loadCodex() {
  try {
    const loaded = await appService.getCodexStatus()
    Object.assign(codexStatus, loaded)
    Object.assign(codexDraft, loaded.settings || {})
  } catch (error) {
    Object.assign(codexMessage, { state: 'error', text: `Codex 状态读取失败：${error.message}` })
  }
}

async function saveCodex() {
  codexBusy.value = true
  try {
    const saved = await appService.saveCodexSettings(codexDraft)
    Object.assign(codexDraft, saved)
    Object.assign(codexMessage, { state: 'success', text: `${agentName.value} Agent 设置已保存；凭据继续由对应 CLI 登录态或环境变量维护。` })
  } catch (error) {
    Object.assign(codexMessage, { state: 'error', text: `保存失败：${error.message}` })
  } finally { codexBusy.value = false }
}

async function authenticateCodex() {
  codexBusy.value = true
  Object.assign(codexMessage, { state: 'testing', text: '正在启动 Codex 认证…' })
  try {
    await appService.startCodexAuth(codexDraft.authMethod === 'environment' ? 'api-key' : 'chat-gpt')
    Object.assign(codexMessage, { state: 'success', text: 'Codex 认证完成。Novel Studio 未保存认证凭据。' })
    await loadCodex()
  } catch (error) {
    Object.assign(codexMessage, { state: 'error', text: `认证失败：${error.message}` })
  } finally { codexBusy.value = false }
}

async function testCodex() {
  codexBusy.value = true
  Object.assign(codexMessage, { state: 'testing', text: `正在校验 ${agentName.value} ACP 与协议…` })
  try {
    const selectedModel = codexDraft.agentProvider === 'qoder' ? codexDraft.qoderModel : codexDraft.model
    const result = await appService.testCodex({ agentProvider: codexDraft.agentProvider, qoderCliPath: codexDraft.qoderCliPath, model: selectedModel, reasoningEffort: codexDraft.reasoningEffort, fastMode: codexDraft.fastMode })
    Object.assign(codexMessage, { state: 'success', text: result.message })
    if (codexDraft.agentProvider === 'qoder') codexStatus.qoderRuntime = result.status.runtime || codexStatus.qoderRuntime
    else {
      codexStatus.runtime.configOptions = result.status.configOptions
      codexModelsRefreshed.value = true
    }
  } catch (error) {
    Object.assign(codexMessage, { state: 'error', text: `测试失败：${error.message}` })
  } finally { codexBusy.value = false }
}

async function refreshCodexModels(selectModel = false) {
  codexBusy.value = true
  try {
    const result = await appService.getCodexModels({ model: codexDraft.model })
    codexStatus.runtime.configOptions = result.status.configOptions
    codexModelsRefreshed.value = true
    if (selectModel) {
      codexDraft.reasoningEffort = result.status.selected.reasoningEffort
      if (!result.status.selected.fastModeSupported) codexDraft.fastMode = false
    }
    Object.assign(codexMessage, { state: 'success', text: result.message })
  } catch (error) {
    Object.assign(codexMessage, { state: 'error', text: error.message })
  } finally { codexBusy.value = false }
}

watch(() => props.saveState.state, (state) => {
  if (state === 'success') cancelEdit()
})

function emptyDraft() {
  return {
    id: '', provider: 'custom', name: '', baseUrl: '', model: '', apiKey: '', enabled: true,
    capabilities: {}, testedAt: '',
    settings: {
      thinkingEnabled: true, reasoningEffort: 'high', samplingMode: 'task-default', temperature: 1, topP: 1, maxTokens: 16384, responseFormat: 'auto',
      requestConfig: normalizeRequestConfig(REQUEST_CONFIG_TEMPLATE),
    },
  }
}

const capabilityDefinitions = [
  { key: 'text', label: '基础文本', marker: 'T' },
  { key: 'streaming', label: '流式输出', marker: 'S' },
  { key: 'structuredOutput', label: '结构化 JSON', marker: '{}' },
  { key: 'modelList', label: '模型列表', marker: '≡' },
]

function providerLabel(provider) {
  return {
    local: '本地服务',
    deepseek: 'DeepSeek',
    mimo: '小米 MiMo',
    openai: 'GPT / OpenAI',
    kimi: 'Kimi',
    custom: 'OpenAI 兼容',
  }[provider] || '自定义'
}

function isMiMoDraft() {
  return draft.provider === 'mimo'
    || /xiaomimimo\.com/i.test(draft.baseUrl || '')
    || /^mimo-/i.test(draft.model || '')
}

function isBuiltIn(profile) {
  return ['local-default', 'deepseek-default', 'openai-default', 'kimi-default'].includes(profile.id)
}

function capabilityOverallLabel(value) {
  return { ready: '能力完整', limited: '部分可用', unavailable: '探测失败' }[value] || '未探测'
}

function capabilityResult(key) {
  return draft.capabilities?.[key] || null
}

function capabilityDetail(key) {
  const result = capabilityResult(key)
  if (!result) return '尚未探测'
  if (!result.supported) return result.error || '供应商未开放'
  if (key === 'modelList') return `${result.modelCount || 0} 个模型 · ${result.latencyMs} ms`
  return `可用 · ${result.latencyMs} ms`
}

function formatTestedAt(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '刚刚探测' : date.toLocaleString('zh-CN', { hour12: false })
}

function editProfile(profile) {
  Object.assign(draft, { ...profile, apiKey: '', settings: { ...emptyDraft().settings, ...(profile.settings || {}) } })
  editingId.value = profile.id
  setRequestConfigEditor(draft.settings.requestConfig)
  resetConnectionTest()
}

function startNewProfile() {
  Object.assign(draft, emptyDraft())
  editingId.value = ''
  setRequestConfigEditor(draft.settings.requestConfig)
  resetConnectionTest()
}

function cancelEdit() {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  setRequestConfigEditor(draft.settings.requestConfig)
  resetConnectionTest()
}

function submitProfile() {
  if (!validateRequestConfig()) return
  const payload = { ...draft, settings: { ...draft.settings, requestConfig: normalizeRequestConfig(draft.settings.requestConfig) } }
  if (!payload.apiKey) delete payload.apiKey
  emit('save-profile', payload)
}

function requestDelete() {
  emit('delete-profile', draft.id)
}

function resetConnectionTest() {
  Object.assign(connectionTest, { state: 'idle', message: '' })
}

function setRequestConfigEditor(config) {
  requestConfigText.value = JSON.stringify(normalizeRequestConfig(config), null, 2)
  Object.assign(jsonValidation, { state: 'idle', message: '保存或测试前会自动校验' })
}

function markJsonDirty() {
  Object.assign(jsonValidation, { state: 'dirty', message: 'JSON 已修改，等待校验' })
  resetConnectionTest()
}

function validateRequestConfig() {
  try {
    draft.settings.requestConfig = parseRequestConfigJson(requestConfigText.value)
    requestConfigText.value = JSON.stringify(draft.settings.requestConfig, null, 2)
    Object.assign(jsonValidation, { state: 'success', message: '配置有效，任务参数将在生成时合并' })
    return true
  } catch (error) {
    Object.assign(jsonValidation, { state: 'error', message: error.message })
    return false
  }
}

async function testConnection() {
  if (!validateRequestConfig()) return
  connectionTest.state = 'testing'
  connectionTest.message = '正在探测鉴权、基础文本、流式返回与结构化输出…'
  try {
    const result = await appService.testModelProfile({ ...draft, settings: { ...draft.settings, requestConfig: normalizeRequestConfig(draft.settings.requestConfig) } })
    draft.capabilities = result.capabilities || {}
    draft.testedAt = result.testedAt || result.capabilities?.checkedAt || new Date().toISOString()
    connectionTest.state = result.ok ? 'success' : 'error'
    connectionTest.message = result.ok
      ? `${capabilityOverallLabel(result.capabilities?.overall)} · 基础文本 ${result.latencyMs} ms · 已完成 4 项探测`
      : `基础文本不可用：${result.capabilities?.text?.error || '请检查地址、模型名称和密钥'}`
  } catch (error) {
    connectionTest.state = 'error'
    connectionTest.message = `连接失败：${error.message}`
  }
}
</script>
