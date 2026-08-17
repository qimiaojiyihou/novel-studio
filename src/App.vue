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
        <span class="save-label">{{ saveLabel }}</span>
        <button class="icon-button" title="项目设置">⋯</button>
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
          <div class="storage-note muted"><span>SQLite · schema v1</span></div>
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

        <div class="editor-body" @click="closeSelectionTools">
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

          <div v-if="selectionTools.visible && activeTab === 'manuscript'" class="selection-tools" @click.stop>
            <span class="selection-caption">已选 {{ selectionTools.text.length }} 字</span>
            <button @click="rewriteSelection">润色</button>
            <button @click="rewriteSelection">扩写</button>
            <button @click="rewriteSelection">局部重写</button>
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
          <div class="section-label"><span>当前模型策略</span><button class="link-button">配置</button></div>
          <div class="model-route"><span class="model-orb local"></span><div><strong>正文 · 本地优先</strong><small>模型尚未接入，当前使用 MockProvider</small></div></div>
          <div class="model-route"><span class="model-orb external"></span><div><strong>规划 · 可切换外部模型</strong><small>DeepSeek · GPT · Kimi · OpenAI 兼容</small></div></div>
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
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
const lastSavedAt = ref('')
const toast = ref('')
const loadError = ref('')
const selectionTools = reactive({ visible: false, text: '' })
const runtime = reactive({ goServiceStatus: 'embedded-fallback', mode: 'embedded' })
const project = reactive({ title: '', genre: '', idea: '', style: '' })

const activeChapter = computed(() => chapters.value.find((chapter) => chapter.id === activeChapterId.value) || chapters.value[0])
const runtimeLabel = computed(() => runtime.mode === 'go-service' ? 'Go 服务已连接' : '内置服务模式')
const saveLabel = computed(() => lastSavedAt.value ? formatRelativeTime(lastSavedAt.value) : '自动保存已开启')

function countChineseText(value) { return countChinese(value) }
function taskIsRunning() { return Boolean(runningTask.value) }
function isTaskRunning(task) { return runningTask.value === task }

onMounted(async () => {
  try {
    const loaded = await appService.loadWorkspace()
    workspace.value = loaded
    Object.assign(project, loaded.project)
    chapters.value = loaded.chapters
    activeChapterId.value = loaded.chapters[0]?.id || ''
    const info = await appService.getRuntimeInfo()
    Object.assign(runtime, info)
    workspaceReady.value = true
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    console.error('[Novel Studio] workspace load failed', error)
  }
})

watch(activeChapter, (chapter) => {
  if (chapter) editorText.value = chapter.manuscript || ''
}, { immediate: true })

async function selectChapter(id) {
  if (id === activeChapterId.value) return
  await saveManuscript()
  activeChapterId.value = id
  activeTab.value = 'manuscript'
}

async function saveChapterTitle() {
  if (!activeChapter.value) return
  const updated = await appService.updateChapter({ id: activeChapter.value.id, title: activeChapter.value.title })
  replaceChapter(updated)
  lastSavedAt.value = new Date().toISOString()
}

async function saveManuscript() {
  if (!activeChapter.value) return
  const updated = await appService.updateChapter({ id: activeChapter.value.id, manuscript: editorText.value, status: 'draft' })
  replaceChapter(updated)
  await appService.createRevision({ chapterId: activeChapter.value.id, content: editorText.value, source: 'manual-save' })
  lastSavedAt.value = new Date().toISOString()
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
    const result = await appService.generateMock({ task, chapterId: activeChapter.value.id, instruction: instruction.value })
    if (task === 'chapter_card') {
      const updated = await appService.updateChapter({ id: activeChapter.value.id, card: result.card })
      replaceChapter(updated)
      activeTab.value = 'card'
      showToast('章节卡已生成，可以继续调整或生成场景计划')
    } else if (task === 'scene_plan') {
      const updated = await appService.updateChapter({ id: activeChapter.value.id, scenePlan: result.scenePlan })
      replaceChapter(updated)
      activeTab.value = 'scene'
      showToast('场景计划已生成')
    } else if (task === 'chapter') {
      editorText.value = result.manuscript
      await saveManuscript()
      activeTab.value = 'manuscript'
      showToast('Mock 正文已生成并保存为新版本')
    }
  } finally {
    runningTask.value = ''
  }
}

function handleSelection(selection) {
  selectionTools.text = selection.text || ''
  selectionTools.visible = Boolean(selection.text && selection.to > selection.from)
}

function closeSelectionTools() {
  if (!selectionTools.visible) return
  selectionTools.visible = false
}

function rewriteSelection() {
  showToast('局部重写入口已就绪，下一步接入真实模型任务')
  selectionTools.visible = false
}

function showToast(message) {
  toast.value = message
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => { toast.value = '' }, 3200)
}
</script>
