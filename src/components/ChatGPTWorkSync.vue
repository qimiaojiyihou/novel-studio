<template>
  <div v-if="visible" class="work-sync-backdrop" @mousedown.self="emit('close')">
    <section class="work-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="work-sync-title">
      <header class="work-sync-header">
        <div><span class="eyebrow">CHATGPT WORK · DESIGN SYNC</span><h2 id="work-sync-title">同步《{{ project?.title }}》的设计</h2><p>按固定对话和版本增量写入设定；正文不会被同步包修改。</p></div>
        <button type="button" class="icon-button" aria-label="关闭设计同步" @click="emit('close')">×</button>
      </header>

      <nav class="work-sync-steps" aria-label="设计同步步骤">
        <span :class="{ active: step === 1, done: binding }">1 绑定对话</span>
        <span :class="{ active: step === 2, done: preview }">2 检查更新</span>
        <span :class="{ active: step === 3, done: latestApplied }">3 确认写入</span>
      </nav>

      <div class="work-sync-body">
        <section class="work-sync-card">
          <div class="work-sync-card-heading"><div><small>固定来源</small><h3>ChatGPT Work 对话</h3></div><span v-if="binding" class="work-sync-state ok">已绑定</span></div>
          <label><span>对话名称</span><input v-model="draft.threadTitle" :disabled="busy || Boolean(binding?.lastAppliedVersion)" placeholder="例如：《现实遗物》设定" /></label>
          <label><span>对话 ID 或链接</span><input v-model="draft.threadId" :disabled="busy || Boolean(binding?.lastAppliedVersion)" placeholder="粘贴 ChatGPT Work 对话链接或任务 ID" /></label>
          <div class="work-sync-actions">
            <button type="button" :disabled="busy || !draft.threadId.trim()" @click="saveBinding">{{ binding ? '更新绑定信息' : '绑定此对话' }}</button>
            <button v-if="binding" type="button" class="secondary" :disabled="busy" @click="openCodex">打开本书 Codex 任务</button>
          </div>
          <p v-if="binding" class="work-sync-note">最近成功版本：{{ binding.lastAppliedVersion || '尚未同步' }}。首次导入后来源对话会锁定，避免把另一段对话误写进本书。</p>
        </section>

        <section v-if="binding" class="work-sync-card">
          <div class="work-sync-card-heading"><div><small>同步提示词</small><h3>{{ binding.lastAppliedVersion ? '继续同步设计变化' : '建立第一版设计基线' }}</h3></div></div>
          <div class="work-sync-mode-grid">
            <button type="button" :class="{ active: !binding.lastAppliedVersion }" :disabled="busy || Boolean(binding.lastAppliedVersion)" @click="copyPrompt('initial')">
              <strong>首次全量同步</strong><span>汇总本对话中全部已确认且仍有效的设计，建立完整基线。</span><small>{{ binding.lastAppliedVersion ? '基线已建立' : '当前应使用' }}</small>
            </button>
            <button type="button" :class="{ active: Boolean(binding.lastAppliedVersion) }" :disabled="busy || !binding.lastAppliedVersion" @click="copyPrompt('incremental')">
              <strong>后续增量同步</strong><span>只整理上次成功版本之后已经确认的新增或修改内容。</span><small>{{ binding.lastAppliedVersion ? `基于 ${binding.lastAppliedVersion}` : '首次同步后启用' }}</small>
            </button>
          </div>
        </section>

        <section class="work-sync-card" :class="{ muted: !binding }">
          <div class="work-sync-card-heading"><div><small>设计同步包</small><h3>粘贴并检查更新</h3></div><span v-if="preview" class="work-sync-state" :class="preview.preview?.conflicts?.length ? 'warn' : 'ok'">{{ preview.preview?.conflicts?.length ? '有冲突' : '可写入' }}</span></div>
          <textarea v-model="packageText" :disabled="busy || !binding" spellcheck="false" placeholder="将 ChatGPT Work 返回的 JSON 同步包粘贴到这里。支持纯 JSON 或 ```json 代码块。"></textarea>
          <div class="work-sync-actions"><button type="button" :disabled="busy || !binding || !packageText.trim()" @click="previewPackage">检查更新</button></div>
        </section>

        <section v-if="preview" class="work-sync-card work-sync-preview">
          <div class="work-sync-card-heading"><div><small>{{ preview.packageVersion }}</small><h3>{{ preview.summary || '设计增量预览' }}</h3></div><span>{{ preview.preview?.changes?.length || 0 }} 项变化</span></div>
          <div v-if="preview.preview?.conflicts?.length" class="work-sync-conflicts">
            <strong>需要先处理的冲突</strong>
            <p v-for="item in preview.preview.conflicts" :key="item.type + item.ref + item.message">{{ item.message }}</p>
          </div>
          <div class="work-sync-change-list">
            <article v-for="item in preview.preview?.changes || []" :key="item.opId">
              <span :class="item.action">{{ actionLabel(item.action) }}</span><div><strong>{{ item.label }}</strong><small>{{ typeLabel(item.type) }}<template v-if="item.ref"> · {{ item.ref }}</template></small></div>
            </article>
          </div>
          <label class="work-sync-confirm"><input v-model="confirmed" type="checkbox" :disabled="busy || preview.preview?.conflicts?.length" />我已核对这份差异，只将以上设计内容写入当前项目。</label>
          <div class="work-sync-actions"><button type="button" class="apply" :disabled="busy || !confirmed || preview.preview?.conflicts?.length" @click="applyPackage">{{ busy ? '正在处理…' : '确认写入 Novel Studio' }}</button></div>
        </section>

        <section v-if="packages.length" class="work-sync-card work-sync-history">
          <div class="work-sync-card-heading"><div><small>同步记录</small><h3>最近版本</h3></div></div>
          <article v-for="item in packages" :key="item.id">
            <div><strong>{{ item.packageVersion }}</strong><small>{{ item.summary || '未填写摘要' }}</small></div>
            <div class="work-sync-history-actions">
              <span :class="item.status">{{ statusLabel(item.status) }}</span>
              <button v-if="['failed','previewed'].includes(item.status)" type="button" class="secondary" :disabled="busy" @click="resumePackage(item)">{{ item.status === 'failed' ? '继续写入' : '继续确认' }}</button>
            </div>
          </article>
        </section>
      </div>
      <footer class="work-sync-footer"><span>{{ message }}</span><button type="button" @click="emit('close')">关闭</button></footer>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'

const props = defineProps({ visible:Boolean, project:{ type:Object, default:() => ({}) } })
const emit = defineEmits(['close', 'applied', 'toast'])
const busy = ref(false)
const binding = ref(null)
const packages = ref([])
const packageText = ref('')
const preview = ref(null)
const confirmed = ref(false)
const message = ref('')
const draft = reactive({ threadId:'', threadTitle:'' })
const latestApplied = computed(() => packages.value.find(item => item.status === 'applied'))
const step = computed(() => preview.value ? 3 : binding.value ? 2 : 1)

watch(() => [props.visible, props.project?.id], async ([visible]) => {
  if (!visible || !props.project?.id) return
  preview.value = null; confirmed.value = false; packageText.value = ''; message.value = ''
  await loadState()
}, { immediate:true })

async function loadState() {
  busy.value = true
  try {
    const state = await appService.getWorkDesignSync(props.project.id)
    binding.value = state?.binding || null
    packages.value = state?.packages || []
    draft.threadId = binding.value?.threadId || ''
    draft.threadTitle = binding.value?.threadTitle || `${props.project.title || '当前作品'} · ChatGPT Work`
  } catch (error) { notify(`读取同步状态失败：${error.message}`) }
  finally { busy.value = false }
}

function notify(text) { message.value = text; emit('toast', text) }
async function saveBinding() {
  busy.value = true
  try {
    binding.value = await appService.bindWorkDesignSync({ projectId:props.project.id, threadId:draft.threadId.trim(), threadTitle:draft.threadTitle.trim() })
    notify('ChatGPT Work 对话已与本书固定绑定')
  } catch (error) { notify(`绑定失败：${error.message}`) }
  finally { busy.value = false }
}
async function copyPrompt(mode) {
  busy.value = true
  try {
    const prompt = await appService.getWorkDesignPrompt({ projectId:props.project.id, mode })
    await navigator.clipboard.writeText(prompt)
    notify(`${mode === 'initial' ? '首次全量' : '后续增量'}同步提示词已复制，可粘贴到绑定的 ChatGPT Work 对话`)
  } catch (error) { notify(`复制失败：${error.message}`) }
  finally { busy.value = false }
}
async function openCodex() {
  busy.value = true
  try { await appService.openCodexProject(props.project.id); notify('已打开本书 Codex 专属任务') }
  catch (error) { notify(`打开 Codex 失败：${error.message}`) }
  finally { busy.value = false }
}
async function previewPackage() {
  busy.value = true; confirmed.value = false
  try { preview.value = await appService.previewWorkDesignPackage({ projectId:props.project.id, packageText:packageText.value }); notify('已完成差异检查，请核对后确认写入') }
  catch (error) { preview.value = null; notify(`检查失败：${error.message}`) }
  finally { busy.value = false }
}
async function applyPackage() {
  busy.value = true
  try {
    const result = await appService.applyWorkDesignPackage({ projectId:props.project.id, packageId:preview.value.id, previewDigest:preview.value.previewDigest, confirm:true })
    preview.value = result; confirmed.value = false
    await loadState()
    notify(`同步版本 ${result.packageVersion} 已写入；未改动正文`)
    emit('applied', result)
  } catch (error) { notify(`写入失败：${error.message}`); await loadState() }
  finally { busy.value = false }
}
function resumePackage(item) {
  preview.value = item
  confirmed.value = false
  message.value = item.status === 'failed'
    ? `已恢复 ${item.packageVersion} 的中断现场；已完成项目会跳过，请核对后继续写入`
    : `已恢复 ${item.packageVersion} 的待确认预览`
}
function actionLabel(value) { return ({ create:'新增', update:'更新', match:'绑定并更新' })[value] || value }
function typeLabel(value) { return ({ project:'项目',document:'规划文档',entity:'人物/设定/分卷',chapter:'章节规划',relationship:'人物关系',arc:'情节弧',beat:'情节节点',knowledge:'知识与连续性' })[value] || value }
function statusLabel(value) { return ({ previewed:'待确认',applying:'写入中',applied:'已写入',failed:'写入中断' })[value] || value }
</script>
