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
          <button class="quiet-button" title="添加章节" :disabled="taskIsRunning()" @click="openNewChapter">＋</button>
        </div>
        <button class="project-summary project-switch-trigger" @click="toggleProjectMenu">
          <div class="project-title">{{ project.title }}</div>
          <div class="project-meta">{{ project.genre }} · {{ activeProjects.length }} 个创作中项目 <span>⌄</span></div>
        </button>
        <div v-if="projectMenuOpen" class="project-shelf">
          <div class="project-shelf-label">创作中的作品</div>
          <div v-for="item in activeProjects" :key="item.id" class="project-shelf-row" :class="{ active: item.id === project.id }">
            <button class="project-select" @click="switchProject(item.id)">
              <span>{{ item.title }}</span>
              <small>{{ item.chapterCount }} 章 · {{ item.characterCount }} 字</small>
            </button>
            <button class="row-more" :aria-label="`管理《${item.title}》`" @click.stop="toggleProjectActions(item.id)">⋯</button>
            <div v-if="projectActionId === item.id" class="row-action-menu project-action-menu" @click.stop>
              <button @click="openEditProject(item)">编辑项目信息</button>
              <button @click="askArchiveProject(item)">归档项目</button>
              <button class="danger" @click="askDeleteProject(item)">删除项目</button>
            </div>
          </div>
          <div v-if="archivedProjects.length" class="project-archive-block">
            <button class="archive-toggle" @click="archiveListOpen = !archiveListOpen">
              <span>已归档 · {{ archivedProjects.length }}</span><span>{{ archiveListOpen ? '−' : '+' }}</span>
            </button>
            <div v-if="archiveListOpen" class="archive-list">
              <div v-for="item in archivedProjects" :key="item.id" class="project-shelf-row archived">
                <div class="archived-project-copy"><span>{{ item.title }}</span><small>{{ item.chapterCount }} 章 · {{ item.characterCount }} 字</small></div>
                <button class="archive-restore" @click="restoreArchivedProject(item)">恢复</button>
                <button class="row-more" :aria-label="`管理归档项目《${item.title}》`" @click.stop="toggleProjectActions(item.id)">⋯</button>
                <div v-if="projectActionId === item.id" class="row-action-menu project-action-menu" @click.stop>
                  <button @click="restoreArchivedProject(item)">恢复到项目架</button>
                  <button class="danger" @click="askDeleteProject(item)">删除项目</button>
                </div>
              </div>
            </div>
          </div>
          <button class="new-project-link" @click="openNewProject">＋ 新建小说项目</button>
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
            <div
              v-for="(chapter, index) in chapters"
              :key="chapter.id"
              class="chapter-row"
              :class="{ selected: chapter.id === activeChapter?.id }"
            >
              <button class="chapter-item" @click="selectChapter(chapter.id)">
                <span class="chapter-number">{{ String(chapter.chapter_no).padStart(2, '0') }}</span>
                <span class="chapter-copy">
                  <strong>{{ chapter.title }}</strong>
                  <small>{{ chapter.status === 'draft' ? '草稿' : chapter.status }}</small>
                </span>
                <span class="chapter-state" :class="chapter.status"></span>
              </button>
              <button class="chapter-more" :aria-label="`管理${chapter.title}`" @click.stop="toggleChapterActions(chapter.id)">⋯</button>
              <div v-if="chapterActionId === chapter.id" class="row-action-menu chapter-action-menu" @click.stop>
                <button @click="openRenameChapter(chapter)">重命名</button>
                <button :disabled="index === 0" @click="moveChapter(chapter, -1)">上移一章</button>
                <button :disabled="index === chapters.length - 1" @click="moveChapter(chapter, 1)">下移一章</button>
                <button @click="duplicateChapter(chapter)">复制章节</button>
                <button class="danger" @click="askDeleteChapter(chapter)">删除章节</button>
              </div>
            </div>
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
            <button class="outline-button" @click="openVersionHistory">版本历史</button>
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
    <VersionHistory
      :visible="versionsOpen"
      :revisions="revisions"
      :chapter-title="activeChapter?.title || ''"
      :current-content="editorText"
      :loading="versionsLoading"
      :restoring="versionRestoring"
      @close="versionsOpen = false"
      @restore="restoreVersion"
    />
    <div v-if="newProjectOpen" class="project-dialog-backdrop" @mousedown.self="newProjectOpen = false">
      <form class="project-dialog" @submit.prevent="createNewProject">
        <span class="eyebrow copper">NEW MANUSCRIPT</span>
        <h2>建立新的小说项目</h2>
        <p>先写下最小起点。故事基础、人物和世界观可以之后继续补充。</p>
        <label><span>项目名称</span><input v-model.trim="newProjectDraft.title" required autofocus placeholder="例如：雾港来信" /></label>
        <label><span>题材</span><input v-model.trim="newProjectDraft.genre" placeholder="例如：都市悬疑" /></label>
        <label><span>一句话想法</span><textarea v-model.trim="newProjectDraft.idea" placeholder="主角遇到了什么，以及他为什么必须行动？"></textarea></label>
        <div class="project-dialog-actions">
          <button type="button" @click="newProjectOpen = false">取消</button>
          <button type="submit" :disabled="projectCreating">{{ projectCreating ? '正在建立…' : '建立项目' }}</button>
        </div>
      </form>
    </div>
    <div v-if="editProjectOpen" class="project-dialog-backdrop" @mousedown.self="editProjectOpen = false">
      <form class="project-dialog project-edit-dialog" @submit.prevent="saveProjectEdits">
        <span class="eyebrow copper">PROJECT NOTES</span>
        <h2>编辑项目信息</h2>
        <p>这里修改的是作品层信息，会成为后续规划和生成的共同上下文。</p>
        <div class="dialog-two-columns">
          <label><span>项目名称</span><input v-model.trim="editProjectDraft.title" required autofocus /></label>
          <label><span>题材</span><input v-model.trim="editProjectDraft.genre" placeholder="例如：都市悬疑" /></label>
        </div>
        <label><span>一句话想法</span><textarea v-model.trim="editProjectDraft.idea" placeholder="主角遇到了什么，以及他为什么必须行动？"></textarea></label>
        <label><span>项目文风</span><textarea v-model.trim="editProjectDraft.style" placeholder="描述全书共同遵守的表达方式"></textarea></label>
        <div class="project-dialog-actions">
          <button type="button" @click="editProjectOpen = false">取消</button>
          <button type="submit" :disabled="workspaceActionPending">{{ workspaceActionPending ? '正在保存…' : '保存修改' }}</button>
        </div>
      </form>
    </div>
    <div v-if="newChapterOpen" class="project-dialog-backdrop" @mousedown.self="newChapterOpen = false">
      <form class="project-dialog chapter-create-dialog" @submit.prevent="createNewChapter">
        <span class="eyebrow copper">NEXT CHAPTER</span>
        <h2>添加下一章</h2>
        <p>选择一个起点。无论从哪里开始，章节内容都可以继续手工修改。</p>
        <label><span>章节名称</span><input v-model.trim="newChapterDraft.title" autofocus :placeholder="`第 ${chapters.length + 1} 章`" /></label>
        <div class="chapter-mode-list" role="radiogroup" aria-label="章节创建方式">
          <button type="button" :class="{ selected: newChapterDraft.mode === 'blank' }" @click="newChapterDraft.mode = 'blank'">
            <b>空白章</b><span>从一张干净稿纸开始</span>
          </button>
          <button type="button" :class="{ selected: newChapterDraft.mode === 'copy-plan' }" @click="newChapterDraft.mode = 'copy-plan'">
            <b>继承本章规划</b><span>复制章节卡与场景计划，不复制正文</span>
          </button>
          <button type="button" :class="{ selected: newChapterDraft.mode === 'ai-plan' }" @click="newChapterDraft.mode = 'ai-plan'">
            <b>让 AI 起草规划</b><span>新建空白章后立即生成章节卡</span>
          </button>
        </div>
        <div class="project-dialog-actions">
          <button type="button" @click="newChapterOpen = false">取消</button>
          <button type="submit" :disabled="workspaceActionPending">{{ workspaceActionPending ? '正在添加…' : '添加章节' }}</button>
        </div>
      </form>
    </div>
    <div v-if="renameChapterOpen" class="project-dialog-backdrop" @mousedown.self="renameChapterOpen = false">
      <form class="project-dialog compact-dialog" @submit.prevent="saveChapterRename">
        <span class="eyebrow copper">CHAPTER LABEL</span>
        <h2>重命名章节</h2>
        <p>章节编号由结构顺序维护，这里只修改标题。</p>
        <label><span>章节标题</span><input v-model.trim="renameChapterDraft.title" required autofocus /></label>
        <div class="project-dialog-actions">
          <button type="button" @click="renameChapterOpen = false">取消</button>
          <button type="submit" :disabled="workspaceActionPending">保存标题</button>
        </div>
      </form>
    </div>
    <div v-if="confirmDialog.visible" class="project-dialog-backdrop confirm-backdrop" @mousedown.self="closeConfirmation">
      <section class="project-dialog confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="confirmDialog.title">
        <span class="eyebrow" :class="{ copper: confirmDialog.danger }">{{ confirmDialog.danger ? 'IRREVERSIBLE ACTION' : 'CONFIRM ACTION' }}</span>
        <h2>{{ confirmDialog.title }}</h2>
        <p>{{ confirmDialog.body }}</p>
        <div class="confirm-note" v-if="confirmDialog.note">{{ confirmDialog.note }}</div>
        <div class="project-dialog-actions">
          <button type="button" :disabled="workspaceActionPending" @click="closeConfirmation">取消</button>
          <button type="button" class="confirm-button" :class="{ danger: confirmDialog.danger }" :disabled="workspaceActionPending" @click="runConfirmedAction">
            {{ workspaceActionPending ? '正在处理…' : confirmDialog.confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import DiffReview from './components/DiffReview.vue'
import ModelSettings from './components/ModelSettings.vue'
import NovelEditor from './components/NovelEditor.vue'
import VersionHistory from './components/VersionHistory.vue'
import { appService } from './services/app-service.js'
import { countChinese, formatRelativeTime } from './services/format.js'

const workspaceReady = ref(false)
const workspace = ref(null)
const projects = ref([])
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
const projectMenuOpen = ref(false)
const projectActionId = ref('')
const chapterActionId = ref('')
const archiveListOpen = ref(false)
const newProjectOpen = ref(false)
const projectCreating = ref(false)
const editProjectOpen = ref(false)
const newChapterOpen = ref(false)
const renameChapterOpen = ref(false)
const workspaceActionPending = ref(false)
const versionsOpen = ref(false)
const versionsLoading = ref(false)
const versionRestoring = ref(false)
const revisions = ref([])
const newProjectDraft = reactive({ title: '', genre: '', idea: '' })
const editProjectDraft = reactive({ id: '', title: '', genre: '', idea: '', style: '' })
const newChapterDraft = reactive({ title: '', mode: 'blank' })
const renameChapterDraft = reactive({ id: '', title: '' })
const confirmDialog = reactive({ visible: false, title: '', body: '', note: '', confirmLabel: '确认', danger: false })
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
let confirmationRunner = null

const activeChapter = computed(() => chapters.value.find((chapter) => chapter.id === activeChapterId.value) || chapters.value[0])
const activeProjects = computed(() => projects.value.filter((item) => !item.archived && !item.archived_at))
const archivedProjects = computed(() => projects.value.filter((item) => item.archived || item.archived_at))
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

function applyWorkspace(loaded) {
  workspace.value = loaded
  Object.assign(project, loaded.project || {})
  projects.value = loaded.projects || []
  chapters.value = loaded.chapters || []
  activeChapterId.value = loaded.chapters?.[0]?.id || ''
  activeTab.value = 'manuscript'
  versionsOpen.value = false
  revisions.value = []
  projectActionId.value = ''
  chapterActionId.value = ''
}

onMounted(async () => {
  closeRequestCleanup = appService.onCloseRequest(handleCloseRequest)
  runtimeInfoCleanup = appService.onRuntimeInfo((info) => Object.assign(runtime, info))
  window.addEventListener('beforeunload', handleBrowserBeforeUnload)
  try {
    const loaded = await appService.loadWorkspace()
    applyWorkspace(loaded)
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
  versionsOpen.value = false
}

async function switchProject(projectId) {
  if (projectId === project.id || runningTask.value) {
    projectMenuOpen.value = false
    return
  }
  try {
    await saveManuscript({ createRevision: false, source: 'project-switch' })
    const loaded = await appService.loadWorkspace(projectId)
    applyWorkspace(loaded)
    projectMenuOpen.value = false
    showToast(`已切换到《${loaded.project.title}》`)
  } catch (error) {
    showToast(`切换项目失败：${error.message}`)
  }
}

async function toggleProjectMenu() {
  projectMenuOpen.value = !projectMenuOpen.value
  projectActionId.value = ''
  if (!projectMenuOpen.value) return
  try {
    projects.value = await appService.listProjects()
  } catch (error) {
    projectMenuOpen.value = false
    showToast(`读取项目列表失败：${error.message}`)
  }
}

function toggleProjectActions(projectId) {
  projectActionId.value = projectActionId.value === projectId ? '' : projectId
}

function toggleChapterActions(chapterId) {
  chapterActionId.value = chapterActionId.value === chapterId ? '' : chapterId
}

function openNewProject() {
  projectMenuOpen.value = false
  projectActionId.value = ''
  newProjectDraft.title = ''
  newProjectDraft.genre = ''
  newProjectDraft.idea = ''
  newProjectOpen.value = true
}

async function createNewProject() {
  if (!newProjectDraft.title || projectCreating.value) return
  projectCreating.value = true
  try {
    await saveManuscript({ createRevision: false, source: 'project-create' })
    const loaded = await appService.createProject({ ...newProjectDraft })
    applyWorkspace(loaded)
    newProjectOpen.value = false
    showToast(`《${loaded.project.title}》已建立，可以开始第一章`)
  } catch (error) {
    showToast(`建立项目失败：${error.message}`)
  } finally {
    projectCreating.value = false
  }
}

function openEditProject(item) {
  projectActionId.value = ''
  projectMenuOpen.value = false
  Object.assign(editProjectDraft, {
    id: item.id,
    title: item.title || '',
    genre: item.genre || '',
    idea: item.idea || '',
    style: item.style || '',
  })
  editProjectOpen.value = true
}

async function saveProjectEdits() {
  if (!editProjectDraft.id || !editProjectDraft.title || workspaceActionPending.value) return
  workspaceActionPending.value = true
  try {
    const updated = await appService.updateProject({ ...editProjectDraft })
    if (updated.id === project.id) Object.assign(project, updated)
    projects.value = await appService.listProjects()
    editProjectOpen.value = false
    showToast(`《${updated.title}》的项目信息已更新`)
  } catch (error) {
    showToast(`保存项目信息失败：${error.message}`)
  } finally {
    workspaceActionPending.value = false
  }
}

function askArchiveProject(item) {
  projectActionId.value = ''
  requestConfirmation({
    title: `归档《${item.title}》？`,
    body: '项目会离开创作中的作品列表，正文、规划与版本历史都会完整保留。',
    note: '之后可以从项目架的“已归档”区域恢复。',
    confirmLabel: '归档项目',
    run: async () => {
      if (item.id === project.id) await saveManuscript({ createRevision: false, source: 'project-archive' })
      const loaded = await appService.archiveProject(item.id)
      if (item.id === project.id) applyWorkspace(loaded)
      else projects.value = await appService.listProjects()
      projectMenuOpen.value = true
      showToast(`《${item.title}》已归档`)
    },
  })
}

async function restoreArchivedProject(item) {
  if (workspaceActionPending.value) return
  workspaceActionPending.value = true
  try {
    await appService.restoreProject(item.id)
    projects.value = await appService.listProjects()
    projectActionId.value = ''
    showToast(`《${item.title}》已恢复到项目架`)
  } catch (error) {
    showToast(`恢复项目失败：${error.message}`)
  } finally {
    workspaceActionPending.value = false
  }
}

function askDeleteProject(item) {
  projectActionId.value = ''
  requestConfirmation({
    title: `永久删除《${item.title}》？`,
    body: `将删除这个项目的 ${item.chapterCount} 个章节、正文、章节规划与全部版本历史。`,
    note: '此操作完成后不能从项目架恢复。',
    confirmLabel: '永久删除',
    danger: true,
    run: async () => {
      if (item.id === project.id) await saveManuscript({ createRevision: false, source: 'before-project-delete' })
      const loaded = await appService.deleteProject(item.id)
      if (item.id === project.id) applyWorkspace(loaded)
      else projects.value = await appService.listProjects()
      projectMenuOpen.value = true
      showToast(`《${item.title}》已删除`)
    },
  })
}

function openNewChapter() {
  if (!project.id || runningTask.value) return
  chapterActionId.value = ''
  newChapterDraft.title = ''
  newChapterDraft.mode = 'blank'
  newChapterOpen.value = true
}

async function createNewChapter() {
  if (!project.id || workspaceActionPending.value) return
  workspaceActionPending.value = true
  const shouldGeneratePlan = newChapterDraft.mode === 'ai-plan'
  try {
    await saveManuscript({ createRevision: false, source: 'chapter-create' })
    const chapter = await appService.createChapter({
      projectId: project.id,
      title: newChapterDraft.title,
      mode: newChapterDraft.mode === 'copy-plan' ? 'copy-plan' : 'blank',
      sourceChapterId: newChapterDraft.mode === 'copy-plan' ? activeChapter.value?.id : '',
    })
    chapters.value.push(chapter)
    activeChapterId.value = chapter.id
    activeTab.value = 'manuscript'
    projects.value = await appService.listProjects()
    newChapterOpen.value = false
    showToast(`第 ${chapter.chapter_no} 章已添加`)
  } catch (error) {
    showToast(`添加章节失败：${error.message}`)
    return
  } finally {
    workspaceActionPending.value = false
  }
  if (shouldGeneratePlan) await runGeneration('chapter_card')
}

function openRenameChapter(chapter) {
  chapterActionId.value = ''
  renameChapterDraft.id = chapter.id
  renameChapterDraft.title = chapter.title
  renameChapterOpen.value = true
}

async function saveChapterRename() {
  if (!renameChapterDraft.id || !renameChapterDraft.title || workspaceActionPending.value) return
  workspaceActionPending.value = true
  try {
    const updated = await appService.updateChapter({ id: renameChapterDraft.id, title: renameChapterDraft.title })
    replaceChapter(updated)
    renameChapterOpen.value = false
    lastSavedAt.value = new Date().toISOString()
    showToast(`章节已重命名为“${updated.title}”`)
  } catch (error) {
    showToast(`章节重命名失败：${error.message}`)
  } finally {
    workspaceActionPending.value = false
  }
}

async function moveChapter(chapter, direction) {
  if (workspaceActionPending.value || runningTask.value) return
  const from = chapters.value.findIndex((item) => item.id === chapter.id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= chapters.value.length) return
  workspaceActionPending.value = true
  chapterActionId.value = ''
  try {
    await saveManuscript({ createRevision: false, source: 'chapter-reorder' })
    const ids = chapters.value.map((item) => item.id)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    chapters.value = await appService.reorderChapters({ projectId: project.id, chapterIds: ids })
    projects.value = await appService.listProjects()
    showToast(`“${chapter.title}”已${direction < 0 ? '上移' : '下移'}`)
  } catch (error) {
    showToast(`调整章节顺序失败：${error.message}`)
  } finally {
    workspaceActionPending.value = false
  }
}

async function duplicateChapter(chapter) {
  if (workspaceActionPending.value || runningTask.value) return
  workspaceActionPending.value = true
  chapterActionId.value = ''
  try {
    if (chapter.id === activeChapter.value?.id) await saveManuscript({ createRevision: false, source: 'chapter-duplicate' })
    const result = await appService.duplicateChapter(chapter.id)
    chapters.value = result.chapters
    activeChapterId.value = result.chapter.id
    activeTab.value = 'manuscript'
    projects.value = await appService.listProjects()
    showToast(`“${chapter.title}”已复制为新章节`)
  } catch (error) {
    showToast(`复制章节失败：${error.message}`)
  } finally {
    workspaceActionPending.value = false
  }
}

function askDeleteChapter(chapter) {
  chapterActionId.value = ''
  requestConfirmation({
    title: `删除第 ${chapter.chapter_no} 章？`,
    body: `“${chapter.title}”的正文、章节卡、场景计划和版本历史都会一并删除。`,
    note: '删除后，其余章节会自动重新编号。',
    confirmLabel: '删除章节',
    danger: true,
    run: async () => {
      if (chapter.id === activeChapter.value?.id) await saveManuscript({ createRevision: false, source: 'before-chapter-delete' })
      const result = await appService.deleteChapter(chapter.id)
      chapters.value = result.chapters
      activeChapterId.value = result.activeChapterId
      activeTab.value = 'manuscript'
      projects.value = await appService.listProjects()
      showToast(`“${chapter.title}”已删除，章节编号已更新`)
    },
  })
}

function requestConfirmation({ title, body, note = '', confirmLabel, danger = false, run }) {
  Object.assign(confirmDialog, { visible: true, title, body, note, confirmLabel, danger })
  confirmationRunner = run
}

function closeConfirmation() {
  if (workspaceActionPending.value) return
  confirmDialog.visible = false
  confirmationRunner = null
}

async function runConfirmedAction() {
  if (!confirmationRunner || workspaceActionPending.value) return
  workspaceActionPending.value = true
  try {
    await confirmationRunner()
    confirmDialog.visible = false
    confirmationRunner = null
  } catch (error) {
    showToast(error.message)
  } finally {
    workspaceActionPending.value = false
  }
}

async function openVersionHistory() {
  if (!activeChapter.value || runningTask.value) return
  versionsOpen.value = true
  versionsLoading.value = true
  try {
    await saveManuscript({ createRevision: false, source: 'version-history-open' })
    revisions.value = await appService.listRevisions(activeChapter.value.id)
  } catch (error) {
    versionsOpen.value = false
    showToast(`读取版本失败：${error.message}`)
  } finally {
    versionsLoading.value = false
  }
}

async function restoreVersion(revisionId) {
  if (!activeChapter.value || versionRestoring.value) return
  versionRestoring.value = true
  try {
    const result = await appService.restoreRevision({ chapterId: activeChapter.value.id, revisionId })
    replaceChapter(result.chapter)
    editorText.value = result.chapter.manuscript || ''
    isDirty.value = false
    saveState.value = 'saved'
    lastSavedAt.value = new Date().toISOString()
    revisions.value = await appService.listRevisions(activeChapter.value.id)
    showToast(result.preservedRevisionId ? '版本已恢复，恢复前正文已自动保存' : '当前正文已经是这个版本')
  } catch (error) {
    showToast(`恢复版本失败：${error.message}`)
  } finally {
    versionRestoring.value = false
  }
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
      projectId: project.id,
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
      projectId: project.id,
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
