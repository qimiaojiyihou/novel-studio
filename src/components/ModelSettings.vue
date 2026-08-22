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
            <details v-if="draft.provider === 'deepseek'" class="advanced-cabinet" open>
              <summary><span><b>DeepSeek 高级参数</b><small>思考、采样和输出预算</small></span><i>⌄</i></summary>
              <div class="advanced-grid">
                <label>
                  <span>思考模式</span>
                  <select v-model="draft.settings.thinkingEnabled">
                    <option :value="true">启用</option>
                    <option :value="false">关闭</option>
                  </select>
                </label>
                <label>
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
              <p>章节卡在“自动”模式下请求 JSON；其他写作任务保持文本。采样控制遵循 Temperature 与 Top P 二选一。</p>
            </details>
            <div class="form-footnote">API Key 只在本机保存，列表不会显示密钥内容。开源版本不附带任何本地模型权重。</div>
            <div v-if="connectionTest.state !== 'idle'" class="connection-result" :class="connectionTest.state">
              <i></i><span>{{ connectionTest.message }}</span>
            </div>
            <div class="form-actions">
              <button type="button" class="outline-button" @click="cancelEdit">取消</button>
              <button type="button" class="test-button" :disabled="connectionTest.state === 'testing'" @click="testConnection">
                {{ connectionTest.state === 'testing' ? '正在测试…' : '测试连接' }}
              </button>
              <button type="submit" class="primary-button">保存配置</button>
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

const props = defineProps({
  visible: { type: Boolean, default: false },
  settings: { type: Object, required: true },
})

const emit = defineEmits(['close', 'save-profile', 'delete-profile', 'route-change'])

const taskDefinitions = [
  { id: 'chapter', label: '正文续写', description: '默认优先选择本地正文模型' },
  { id: 'planning_field', label: '故事规划', description: '故事基础、人物、世界观与总纲的逐项生成' },
  { id: 'chapter_card', label: '章节卡', description: '将想法拆成可执行的章节合同' },
  { id: 'scene_plan', label: '场景计划', description: '把章节卡变成场景动作链' },
  { id: 'rewrite', label: '局部重写', description: '处理编辑器中选中的文字' },
]

const editingId = ref(null)
const draft = reactive(emptyDraft())
const connectionTest = reactive({ state: 'idle', message: '' })
const enabledProfiles = computed(() => props.settings.profiles.filter((profile) => profile.enabled))

watch(() => props.visible, (visible) => {
  if (!visible) cancelEdit()
})

function emptyDraft() {
  return {
    id: '', provider: 'custom', name: '', baseUrl: '', model: '', apiKey: '', enabled: true,
    settings: { thinkingEnabled: true, reasoningEffort: 'high', samplingMode: 'task-default', temperature: 1, topP: 1, maxTokens: 4096, responseFormat: 'auto' },
  }
}

function providerLabel(provider) {
  return {
    local: '本地服务',
    deepseek: 'DeepSeek',
    openai: 'GPT / OpenAI',
    kimi: 'Kimi',
    custom: 'OpenAI 兼容',
  }[provider] || '自定义'
}

function isBuiltIn(profile) {
  return ['local-default', 'deepseek-default', 'openai-default', 'kimi-default'].includes(profile.id)
}

function editProfile(profile) {
  Object.assign(draft, { ...profile, apiKey: '', settings: { ...emptyDraft().settings, ...(profile.settings || {}) } })
  editingId.value = profile.id
  resetConnectionTest()
}

function startNewProfile() {
  Object.assign(draft, emptyDraft())
  editingId.value = ''
  resetConnectionTest()
}

function cancelEdit() {
  editingId.value = null
  Object.assign(draft, emptyDraft())
  resetConnectionTest()
}

function submitProfile() {
  const payload = { ...draft }
  if (!payload.apiKey) delete payload.apiKey
  emit('save-profile', payload)
}

function requestDelete() {
  emit('delete-profile', draft.id)
}

function resetConnectionTest() {
  Object.assign(connectionTest, { state: 'idle', message: '' })
}

async function testConnection() {
  connectionTest.state = 'testing'
  connectionTest.message = '正在验证鉴权、模型名称和流式返回…'
  try {
    const result = await appService.testModelProfile({ ...draft, settings: { ...draft.settings } })
    connectionTest.state = 'success'
    connectionTest.message = `连接成功 · ${result.model?.name || draft.name} · ${result.latencyMs} ms · ${result.gateway === 'go-service' ? 'Go 服务' : '内置服务'}`
  } catch (error) {
    connectionTest.state = 'error'
    connectionTest.message = `连接失败：${error.message}`
  }
}
</script>
