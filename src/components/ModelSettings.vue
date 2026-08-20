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
            <div class="form-footnote">API Key 只在本机保存，列表不会显示密钥内容。开源版本不附带任何本地模型权重。</div>
            <div class="form-actions">
              <button type="button" class="outline-button" @click="cancelEdit">取消</button>
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

const props = defineProps({
  visible: { type: Boolean, default: false },
  settings: { type: Object, required: true },
})

const emit = defineEmits(['close', 'save-profile', 'delete-profile', 'route-change'])

const taskDefinitions = [
  { id: 'chapter', label: '正文续写', description: '默认优先选择本地正文模型' },
  { id: 'chapter_card', label: '章节卡', description: '将想法拆成可执行的章节合同' },
  { id: 'scene_plan', label: '场景计划', description: '把章节卡变成场景动作链' },
  { id: 'rewrite', label: '局部重写', description: '处理编辑器中选中的文字' },
]

const editingId = ref(null)
const draft = reactive(emptyDraft())
const enabledProfiles = computed(() => props.settings.profiles.filter((profile) => profile.enabled))

watch(() => props.visible, (visible) => {
  if (!visible) cancelEdit()
})

function emptyDraft() {
  return { id: '', provider: 'custom', name: '', baseUrl: '', model: '', apiKey: '', enabled: true }
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
  Object.assign(draft, { ...profile, apiKey: '' })
  editingId.value = profile.id
}

function startNewProfile() {
  Object.assign(draft, emptyDraft())
  editingId.value = ''
}

function cancelEdit() {
  editingId.value = null
  Object.assign(draft, emptyDraft())
}

function submitProfile() {
  const payload = { ...draft }
  if (!payload.apiKey) delete payload.apiKey
  emit('save-profile', payload)
}

function requestDelete() {
  emit('delete-profile', draft.id)
}
</script>
