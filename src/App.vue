<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">NS</div>
        <div>
          <div class="brand-name">Novel Studio</div>
          <div class="brand-subtitle">a quiet room for unfinished stories</div>
        </div>
      </div>
      <div class="topbar-project">
        <span class="eyebrow">CURRENT PROJECT</span>
        <strong>{{ project.title || '未命名小说' }}</strong>
        <span class="dot-separator">·</span>
        <span>{{ project.genre || '未设置题材' }}</span>
      </div>
      <div class="topbar-actions">
        <span class="runtime-pill" :class="runtime.goServiceStatus">
          <span class="status-dot"></span>{{ runtimeLabel }}
        </span>
        <span class="save-label" :class="saveState">{{ saveLabel }}</span>
        <button class="icon-button" title="模型与项目设置" @click="openSettings">⋯</button>
      </div>
    </header>

    <main class="workspace-grid" v-if="workspaceReady">
      <aside class="structure-panel panel-dark">
        <div class="panel-heading">
          <span class="eyebrow">WORKSPACE</span>
          <button class="quiet-button" title="添加章节">＋</button>
        </div>
        <div class="project-summary">
          <div class="project-title">{{ project.title }}</div>
          <div class="project-meta">{{ project.genre }} · 本地项目</div>
        </div>

        <nav class="side-nav" aria-label="项目导航">
          <button class="nav-item active"><span class="nav-glyph">◈</span>正在创作</button>
          <button class="nav-item"><span class="nav-glyph">⌁</span>故事基础</button>
          <button class="nav-item"><span class="nav-glyph">◎</span>人物与关系</button>
          <button class="nav-item"><span class="nav-glyph">▤</span>知识与连续性</button>
        </nav>

        <div class="chapter-section">
          <div class="section-label">
            <span>正文结构</span>
            <span class="section-count">{{ chapters.length }} 章</span>
          </div>
          <div class="chapter-list">
            <button
              v-for="chapter in chapters"
              :key="chapter.id"
              class="chapter-item"
              :class="{ selected: chapter.id === activeChapter?.id }"
              @click="selectChapter(chapter.id)"
            >
              <span class="chapter-number">{{ String(chapter.chapter_no).padStart(2, '0') }}</span>
              <span class="chapter-copy">
                <strong>{{ chapter.title }}</strong>
                <small>{{ chapter.status === 'draft' ? '草稿' : chapter.status }}</small>
              </span>
              <span class="chapter-state" :class="chapter.status"></span>
            </button>
          </div>
        </div>

        <div class="panel-footer">
          <div class="storage-note"><span class="storage-icon">⌂</span><span>项目保存在本机</span></div>
          <div class="storage-note muted"><span>SQLite · schema v{{ runtime.database?.schemaVersion || 1 }} · 外键{{ runtime.database?.foreignKeys ? '已启用' : '待检查' }}</span></div>
        </div>
      </aside>

      <section class="editor-panel">
        <div class="editor-heading">
          <div>
            <div class="eyebrow copper">CHAPTER {{ String(activeChapter.chapter_no).padStart(2, '0') }}</div>
            <input v-model="activeChapter.title" class="chapter-title-input" @blur="saveChapterTitle" />
            <div class="chapter-subline">
              <span>{{ countChinese(editorText) }} 中文字</span>
              <span class="dot-separator">·</span>
              <span>{{ activeTab === 'manuscript' ? '正文编辑' : activeTab === 'card' ? '章节卡' : '场景计划' }}</span>
            </div>
          </div>
          <div class="editor-heading-actions">
            <button class="outline-button" @click="saveManuscript">保存版本</button>
            <button v-if="runningTask" class="cancel-generation-button" :disabled="generationCancelPending" @click="cancelGeneration">
              {{ generationCancelPending ? '正在取消…' : '取消生成' }}
            </button>
            <button class="primary-button" @click="runGeneration('chapter')" :disabled="taskIsRunning()">
              <span v-if="isTaskRunning('chapter')" class="spinner"></span>
              {{ isTaskRunning('chapter') ? '生成中' : '生成正文' }}
            </button>
          </div>
        </div>

        <div class="editor-tabs" role="tablist">
          <button :class="{ active: activeTab === 'manuscript' }" @click="activeTab = 'manuscript'">正文</button>
          <button :class="{ active: activeTab === 'card' }" @click="activeTab = 'card'">章节卡</button>
          <button :class="{ active: activeTab === 'scene' }" @click="activeTab = 'scene'">场景计划</button>
          <span class="tab-spacer"></span>
          <span class="editor-mode">CodeMirror 6 · prose</span>
        </div>

        <div class="editor-body" @mousedown.self="closeSelectionTools">
          <NovelEditor
            v-if="activeTab === 'manuscript'"
            v-model="editorText"
            @selection-change="handleSelection"
          />
          <div v-else-if="activeTab === 'card'" class="artifact-view card-view">
            <div class="artifact-header"><span class="eyebrow copper">CHAPTER CONTRACT</span><span class="artifact-state">{{ activeChapter.card?.goal ? '已生成' : '待生成' }}</span></div>
            <h2>{{ activeChapter.card?.goal || '还没有章节卡' }}</h2>
            <div class="artifact-grid">
              <article><span>主角目标</span><p>{{ activeChapter.card?.protagonistGoal || '等待规划' }}</p></article>
              <article><span>主要阻力</span><p>{{ activeChapter.card?.resistance || '等待规划' }}</p></article>
              <article><span>转折</span><p>{{ activeChapter.card?.turningPoint || '等待规划' }}</p></article>
              <article><span>结尾合同</span><p>{{ activeChapter.card?.ending || '等待规划' }}</p></article>
            </div>
            <div v-if="activeChapter.card?.requiredScenes?.length" class="scene-stack">
              <div v-for="scene in activeChapter.card.requiredScenes" :key="scene.id" class="scene-row"><b>{{ scene.id }}</b><strong>{{ scene.title }}</strong><span>{{ scene.result }}</span></div>
            </div>
          </div>
          <pre v-else class="artifact-view scene-plan-view">{{ activeChapter.scene_plan || '还没有场景计划。点击右侧“生成场景计划”开始。' }}</pre>

          <div
            v-if="selectionTools.visible && activeTab === 'manuscript'"
            class="selection-tools"
            :style="selectionToolsStyle"
            @mousedown.stop
          >
            <span class="selection-caption">已选 {{ selectionTools.text.length }} 字</span>
            <button :disabled="taskIsRunning() || selectionPreview.visible" @click="rewriteSelection('润色')">润色</button>
            <button :disabled="taskIsRunning() || selectionPreview.visible" @click="rewriteSelection('扩写')">扩写</button>
            <button :disabled="taskIsRunning() || selectionPreview.visible" @click="rewriteSelection('局部重写')">局部重写</button>
          </div>

          <div v-if="selectionPreview.visible" class="selection-review" @mousedown.stop>
            <div>
              <strong>局部候选稿</strong>
              <small>{{ selectionPreview.mode }} · {{ selectionPreview.replacementText.length }} 字 · 尚未保存</small>
            </div>
            <button class="selection-review-undo" @click="discardSelectionPreview">撤销</button>
            <button class="selection-review-accept" @click="acceptSelectionPreview">接受</button>
          </div>

          <div v-if="streamPreview.visible" class="generation-strip" aria-live="polite">
            <div class="generation-strip-head">
              <span class="generation-pulse"></span>
              <strong>{{ generationTaskLabel(streamPreview.task) }}</strong>
              <span>{{ streamPreview.gateway === 'go-service' ? 'Go 流式服务' : '内置流式服务' }}</span>
              <small>{{ countChinese(streamPreview.content) }} 字抵达</small>
            </div>
            <pre>{{ streamPreview.content || streamPreview.status }}</pre>
          </div>
        </div>
      </section>

      <aside class="context-panel">
        <div class="context-heading">
          <div><span class="eyebrow">WRITING LENS</span><h2>本章写作镜头</h2></div>
          <span class="lens-symbol">◌</span>
        </div>

        <section class="context-section focus-section">
          <div class="section-label"><span>当前目标</span><span class="verified">● 已确认</span></div>
          <p class="focus-copy">{{ activeChapter.card?.goal || '先生成一张章节卡，让故事从想法变成可以执行的动作。' }}</p>
        </section>

        <section class="context-section">
          <div class="section-label"><span>本章场景</span><button class="link-button" @click="runGeneration('chapter_card')">{{ isTaskRunning('chapter_card') ? '生成中…' : '生成章节卡' }}</button></div>
          <div v-if="activeChapter.card?.requiredScenes?.length" class="context-scenes">
            <div v-for="scene in activeChapter.card.requiredScenes" :key="scene.id" class="context-scene"><span>{{ scene.id }}</span><strong>{{ scene.title }}</strong><small>{{ scene.goal }}</small></div>
          </div>
          <div v-else class="empty-context">章节卡还没有内容<br><small>先从一个具体目标开始</small></div>
        </section>

        <section class="context-section">
          <div class="section-label"><span>文风与要求</span><span class="scope-chip">项目级</span></div>
          <p class="style-copy">{{ project.style || '尚未设置项目文风。' }}</p>
          <textarea v-model="instruction" class="instruction-input" placeholder="给这次生成补充一条临时要求…"></textarea>
        </section>

        <section class="context-section model-section">
          <div class="section-label"><span>当前模型策略</span><button class="link-button" @click="openSettings">配置</button></div>
          <div class="model-route"><span class="model-orb local"></span><div><strong>正文 · {{ modelName('chapter') }}</strong><small>{{ modelDetail('chapter') }}</small></div></div>
          <div class="model-route"><span class="model-orb external"></span><div><strong>规划 · {{ modelName('chapter_card') }}</strong><small>{{ modelDetail('chapter_card') }} · 可在设置中切换</small></div></div>
        </section>

        <section class="context-section progress-section">
          <div class="section-label"><span>章节进度</span><span>{{ Math.min(100, Math.round(countChinese(editorText) / 20)) }}%</span></div>
          <div class="progress-track"><div class="progress-bar" :style="{ width: `${Math.min(100, Math.round(countChinese(editorText) / 20))}%` }"></div></div>
          <div class="progress-meta"><span>{{ countChinese(editorText) }} 中文字</span><span>目标 2,000 字</span></div>
        </section>

        <div class="context-bottom-actions">
          <button class="secondary-action" @click="runGeneration('scene_plan')" :disabled="taskIsRunning()"><span>↳</span>{{ isTaskRunning('scene_plan') ? '生成场景计划中…' : '生成场景计划' }}</button>
          <button class="secondary-action" @click="saveManuscript"><span>⌘</span>保存当前版本</button>
        </div>
      </aside>
    </main>

    <div v-else class="loading-screen"><div class="loading-mark">NS</div><p>{{ loadError ? '工作区打开失败：' + loadError : '正在打开你的写作桌面…' }}</p></div>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <ModelSettings
      :visible="settingsOpen"
      :settings="modelSettings"
      @close="settingsOpen = false"
      @save-profile="saveModelProfile"
      @delete-profile="deleteModelProfile"
      @route-change="changeTaskRoute"
    />
    <DiffReview
      :visible="candidate.visible"
      :original="candidate.original"
      :candidate="candidate.content"
      :title="candidate.title"
      :subtitle="candidate.subtitle"
      @accept="acceptCandidate"
      @discard="discardCandidate"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import DiffReview from './components/DiffReview.vue'
import ModelSettings from './components/ModelSettings.vue'
import NovelEditor from './components/NovelEditor.vue'
import { appService } from './services/app-service.js'
import { countChinese, formatRelativeTime } from './services/format.js'

const workspaceReady = ref(false)
const workspace = ref(null)
const chapters = ref([])
const activeChapterId = ref('')
const editorText = ref('')
const activeTab = ref('manuscript')
const instruction = ref('')
const runningTask = ref('')
const generationCancelPending = ref(false)
const lastSavedAt = ref('')
const saveState = ref('saved')
const isDirty = ref(false)
const toast = ref('')
const loadError = ref('')
const settingsOpen = ref(false)
const selectionTools = reactive({ visible: false, text: '', from: 0, to: 0, left: 0, top: 0, bottom: 0 })
const selectionPreview = reactive({
  visible: false,
  mode: '',
  originalDocument: '',
  originalText: '',
  replacementText: '',
})
const candidate = reactive({ visible: false, original: '', content: '', title: '', subtitle: '' })
const streamPreview = reactive({ visible: false, task: '', status: '', content: '', gateway: 'embedded' })
const runtime = reactive({ goServiceStatus: 'embedded-fallback', mode: 'embedded' })
const project = reactive({ title: '', genre: '', idea: '', style: '' })
const modelSettings = reactive({ profiles: [], routes: {} })
let autosaveTimer = null
let savePromise = null
let closeRequestCleanup = null
let runtimeInfoCleanup = null
let closeInProgress = false
let activeGeneration = null

const activeChapter = computed(() => chapters.value.find((chapter) => chapter.id === activeChapterId.value) || chapters.value[0])
const runtimeLabel = computed(() => {
  if (runtime.goServiceStatus === 'ready') return 'Go 服务已连接'
  if (runtime.goServiceStatus === 'starting') return 'Go 启动中 · 内置可用'
  return '内置服务模式'
})
const saveLabel = computed(() => {
  if (saveState.value === 'dirty') return '有未保存修改'
  if (saveState.value === 'saving') return '正在保存…'
  if (saveState.value === 'error') return '保存失败，请重试'
  return lastSavedAt.value ? `已保存 ${formatRelativeTime(lastSavedAt.value)}` : '已保存'
})
const selectionToolsStyle = computed(() => ({
  left: `${selectionTools.left || 50}%`,
  top: `${selectionTools.bottom || 23}px`,
}))

function countChineseText(value) { return countChinese(value) }
function taskIsRunning() { return Boolean(runningTask.value) }
function isTaskRunning(task) { return runningTask.value === task }
function selectedModel(task) {
  const profileId = modelSettings.routes[task]
  return modelSettings.profiles.find((profile) => profile.id === profileId)
}
function modelName(task) {
  return selectedModel(task)?.name || 'MockProvider'
}
function modelDetail(task) {
  const profile = selectedModel(task)
  if (!profile) return '当前使用内置 MockProvider'
  if (profile.provider === 'local') return profile.model ? `本地 · ${profile.model}` : '本地模型待接入'
  return profile.apiKeyConfigured ? `${profile.provider} · API Key 已配置` : `${profile.provider} · 待配置 API Key`
}

onMounted(async () => {
  closeRequestCleanup = appService.onCloseRequest(handleCloseRequest)
  runtimeInfoCleanup = appService.onRuntimeInfo((info) => Object.assign(runtime, info))
  window.addEventListener('beforeunload', handleBrowserBeforeUnload)
  try {
    const loaded = await appService.loadWorkspace()
    workspace.value = loaded
    Object.assign(project, loaded.project)
    chapters.value = loaded.chapters
    activeChapterId.value = loaded.chapters[0]?.id || ''
    const info = await appService.getRuntimeInfo()
    Object.assign(runtime, info)
    const loadedModels = await appService.loadModelSettings()
    modelSettings.profiles = loadedModels.profiles
    modelSettings.routes = loadedModels.routes
    workspaceReady.value = true
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    console.error('[Novel Studio] workspace load failed', error)
  }
})

watch(activeChapter, (chapter) => {
  if (!chapter) return
  editorText.value = chapter.manuscript || ''
  isDirty.value = false
  saveState.value = 'saved'
}, { immediate: true })

watch(editorText, (value) => {
  const dirty = Boolean(activeChapter.value && value !== (activeChapter.value.manuscript || ''))
  isDirty.value = dirty
  if (!dirty) {
    if (saveState.value !== 'saving') saveState.value = 'saved'
    return
  }
  saveState.value = 'dirty'
  if (!selectionPreview.visible) scheduleAutosave()
})

onBeforeUnmount(() => {
  if (autosaveTimer) window.clearTimeout(autosaveTimer)
  void activeGeneration?.cancel()
  closeRequestCleanup?.()
  runtimeInfoCleanup?.()
  window.removeEventListener('beforeunload', handleBrowserBeforeUnload)
})

async function selectChapter(id) {
  if (id === activeChapterId.value) return
  if (selectionPreview.visible) discardSelectionPreview()
  await saveManuscript({ createRevision: false, source: 'chapter-switch' })
  activeChapterId.value = id
  activeTab.value = 'manuscript'
}

async function saveChapterTitle() {
  if (!activeChapter.value) return
  const updated = await appService.updateChapter({ id: activeChapter.value.id, title: activeChapter.value.title })
  replaceChapter(updated)
  lastSavedAt.value = new Date().toISOString()
}

async function saveManuscript({ createRevision = true, source = 'manual-save', forceRevision = false } = {}) {
  if (!activeChapter.value) return false
  if (!isDirty.value && !forceRevision) return true
  if (savePromise) return savePromise
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  saveState.value = 'saving'
  savePromise = (async () => {
    try {
      const chapterId = activeChapter.value.id
      const content = editorText.value
      const updated = await appService.updateChapter({ id: chapterId, manuscript: content, status: 'draft' })
      replaceChapter(updated)
      if (createRevision || forceRevision) {
        await appService.createRevision({ chapterId, content, source })
      }
      lastSavedAt.value = new Date().toISOString()
      isDirty.value = false
      saveState.value = 'saved'
      return true
    } catch (error) {
      saveState.value = 'error'
      showToast(`保存失败：${error.message}`)
      throw error
    }
  })()
  try {
    return await savePromise
  } finally {
    savePromise = null
  }
}

function replaceChapter(updated) {
  if (!updated) return
  const index = chapters.value.findIndex((chapter) => chapter.id === updated.id)
  if (index >= 0) chapters.value[index] = updated
}

async function runGeneration(task) {
  if (runningTask.value || !activeChapter.value) return
  runningTask.value = task
  try {
    const originalManuscript = editorText.value
    if (isDirty.value) {
      await saveManuscript({ createRevision: true, source: `before-ai-${task}` })
    } else if (task === 'chapter' && originalManuscript) {
      await saveManuscript({ createRevision: true, source: 'before-ai-generation', forceRevision: true })
    }
    const result = await executeGeneration({
      task,
      chapterId: activeChapter.value.id,
      instruction: instruction.value,
      modelProfileId: modelSettings.routes[task],
    })
    if (task === 'chapter_card') {
      const updated = await appService.updateChapter({ id: activeChapter.value.id, card: result.card })
      replaceChapter(updated)
      activeTab.value = 'card'
      showToast(`章节卡已生成 · ${executionLabel(result)}`)
    } else if (task === 'scene_plan') {
      const updated = await appService.updateChapter({ id: activeChapter.value.id, scenePlan: result.scenePlan })
      replaceChapter(updated)
      activeTab.value = 'scene'
      showToast(`场景计划已生成 · ${executionLabel(result)}`)
    } else if (task === 'chapter') {
      activeTab.value = 'manuscript'
      candidate.original = originalManuscript
      candidate.content = result.manuscript || ''
      candidate.title = '正文候选稿'
      candidate.subtitle = `生成来源：${executionLabel(result)}。请在差异视图中确认后再写入正文。`
      candidate.visible = true
      showToast('正文候选稿已生成，请确认差异')
    }
  } catch (error) {
    showToast(generationErrorMessage(error, '生成失败'))
  } finally {
    runningTask.value = ''
  }
}

function executionLabel(result) {
  const name = result.model?.name || 'MockProvider'
  const gateway = result.gateway === 'go-service' ? 'Go 服务' : '内置服务'
  return result.execution === 'remote' ? `${name} · ${gateway}` : `${name} · Mock 回退 · ${gateway}`
}

function generationTaskLabel(task) {
  return {
    chapter: '正文正在落稿',
    chapter_card: '章节卡正在成形',
    scene_plan: '场景计划正在展开',
    rewrite: '局部候选正在改写',
  }[task] || '内容正在生成'
}

function handleGenerationEvent(event) {
  if (!event) return
  streamPreview.gateway = event.gateway || streamPreview.gateway
  if (event.type === 'gateway-fallback') {
    streamPreview.status = 'Go 服务暂时未响应，已接续到内置服务…'
    return
  }
  if (event.type === 'started') {
    streamPreview.status = '模型已接收任务，等待第一段内容…'
    return
  }
  if (event.type === 'delta') {
    streamPreview.content += event.delta || ''
    streamPreview.status = '内容持续抵达中…'
    return
  }
  if (event.type === 'cancelled') streamPreview.status = '生成已取消'
  if (event.type === 'failed') streamPreview.status = event.error || '生成任务执行失败'
}

async function executeGeneration(payload) {
  streamPreview.visible = true
  streamPreview.task = payload.task
  streamPreview.status = '正在建立生成任务…'
  streamPreview.content = ''
  streamPreview.gateway = runtime.mode === 'go-service' ? 'go-service' : 'embedded'
  const generation = appService.startGeneration(payload, handleGenerationEvent)
  activeGeneration = generation
  try {
    return await generation.promise
  } finally {
    if (activeGeneration?.taskId === generation.taskId) activeGeneration = null
    generationCancelPending.value = false
    streamPreview.visible = false
  }
}

async function cancelGeneration() {
  if (!activeGeneration || generationCancelPending.value) return
  generationCancelPending.value = true
  streamPreview.status = '正在停止模型任务…'
  try {
    await activeGeneration.cancel()
  } catch (error) {
    generationCancelPending.value = false
    showToast(`取消失败：${error.message}`)
  }
}

function generationErrorMessage(error, prefix) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('取消') ? '生成已取消，原稿保持不变' : `${prefix}：${message}`
}

function handleSelection(selection) {
  selectionTools.text = selection.text || ''
  selectionTools.from = selection.from
  selectionTools.to = selection.to
  selectionTools.left = selection.coords ? (selection.coords.left + selection.coords.right) / 2 : 0
  selectionTools.top = selection.coords?.top || 0
  selectionTools.bottom = selection.coords?.bottom || 0
  selectionTools.visible = Boolean(selection.text && selection.to > selection.from)
}

function closeSelectionTools() {
  if (!selectionTools.visible) return
  selectionTools.visible = false
}

async function rewriteSelection(mode) {
  if (!selectionTools.text || !activeChapter.value || runningTask.value || selectionPreview.visible) return
  const { from, to, text } = selectionTools
  const originalDocument = editorText.value
  runningTask.value = 'rewrite'
  try {
    if (isDirty.value || originalDocument) {
      await saveManuscript({ createRevision: true, source: 'before-ai-rewrite', forceRevision: true })
    }
    const result = await executeGeneration({
      task: 'rewrite',
      chapterId: activeChapter.value.id,
      selectedText: text,
      rewriteMode: mode,
      instruction: instruction.value,
      modelProfileId: modelSettings.routes.rewrite,
    })
    selectionPreview.mode = mode
    selectionPreview.originalDocument = originalDocument
    selectionPreview.originalText = text
    selectionPreview.replacementText = result.text || ''
    editorText.value = originalDocument.slice(0, from) + selectionPreview.replacementText + originalDocument.slice(to)
    selectionPreview.visible = true
    selectionTools.visible = false
    showToast(`${mode}候选已生成，请接受或撤销 · ${executionLabel(result)}`)
  } catch (error) {
    showToast(generationErrorMessage(error, '局部重写失败'))
  } finally {
    runningTask.value = ''
  }
}

async function acceptSelectionPreview() {
  if (!selectionPreview.visible || runningTask.value) return
  try {
    await saveManuscript({ createRevision: true, source: 'ai-rewrite-accepted', forceRevision: true })
    selectionPreview.visible = false
    showToast('局部候选已接受并保存为新版本')
  } catch {
    // Keep the preview open so the user can retry after the storage error is resolved.
  }
}

function discardSelectionPreview() {
  if (!selectionPreview.visible) return
  editorText.value = selectionPreview.originalDocument
  selectionPreview.visible = false
  selectionTools.visible = false
  showToast('已撤销局部候选，正文恢复为原稿')
}

async function acceptCandidate() {
  if (!candidate.visible || !activeChapter.value) return
  editorText.value = candidate.content
  try {
    await saveManuscript({ createRevision: true, source: 'ai-generation-accepted', forceRevision: true })
    candidate.visible = false
    showToast('正文候选稿已接受并保存为新版本')
  } catch {
    // Keep the candidate context in place; saveState already exposes the failure.
  }
}

function discardCandidate() {
  candidate.visible = false
  showToast('已放弃正文候选稿，原稿保持不变')
}

function scheduleAutosave() {
  if (autosaveTimer) window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(async () => {
    autosaveTimer = null
    if (!isDirty.value || selectionPreview.visible || candidate.visible) return
    try {
      await saveManuscript({ createRevision: false, source: 'autosave' })
    } catch {
      // saveManuscript updates the visible error state and toast.
    }
  }, 1200)
}

function handleBrowserBeforeUnload(event) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function handleCloseRequest() {
  if (closeInProgress) return
  if (runningTask.value) {
    showToast('生成任务仍在运行，完成后再关闭窗口')
    appService.respondToClose({ saved: false, error: 'generation-running' })
    return
  }
  closeInProgress = true
  try {
    if (candidate.visible) discardCandidate()
    if (selectionPreview.visible) discardSelectionPreview()
    if (isDirty.value) await saveManuscript({ createRevision: false, source: 'close-autosave' })
    appService.respondToClose({ saved: true })
  } catch (error) {
    closeInProgress = false
    appService.respondToClose({ saved: false, error: error.message })
    showToast(`关闭前保存失败：${error.message}`)
  }
}

function openSettings() {
  settingsOpen.value = true
}

async function refreshModelSettings() {
  const loaded = await appService.loadModelSettings()
  modelSettings.profiles = loaded.profiles
  modelSettings.routes = loaded.routes
}

async function saveModelProfile(profile) {
  try {
    await appService.saveModelProfile(profile)
    await refreshModelSettings()
    showToast('模型配置已保存')
  } catch (error) {
    showToast(`模型配置保存失败：${error.message}`)
  }
}

async function deleteModelProfile(id) {
  try {
    await appService.deleteModelProfile(id)
    await refreshModelSettings()
    showToast('模型配置已删除')
  } catch (error) {
    showToast(error.message)
  }
}

async function changeTaskRoute(payload) {
  try {
    const routes = await appService.updateTaskRoute(payload)
    modelSettings.routes = routes
    showToast('任务路由已更新')
  } catch (error) {
    showToast(`任务路由更新失败：${error.message}`)
  }
}

function showToast(message) {
  toast.value = message
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => { toast.value = '' }, 3200)
}
</script>
