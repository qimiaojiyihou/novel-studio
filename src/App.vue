<template>
  <div class="app-shell">
    <a class="skip-link" href="#workspace-main">跳到创作区</a>
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">NS</div>
        <div>
          <div class="brand-name">Novel Studio</div>
          <div class="brand-subtitle">让未完成的故事继续生长</div>
        </div>
      </div>
      <div class="topbar-project">
        <span class="eyebrow">当前作品</span>
        <strong :title="project.title">{{ project.title || '未命名小说' }}</strong>
        <span class="dot-separator">·</span>
        <span>{{ project.genre || '未设置题材' }}</span>
      </div>
      <div class="topbar-actions">
        <span class="runtime-pill" :class="runtime.goServiceStatus">
          <span class="status-dot"></span>{{ runtimeLabel }}
        </span>
        <span class="save-label" :class="saveState">{{ saveLabel }}</span>
        <button v-if="externalChange" type="button" class="topbar-tool" @click="refreshExternalWorkspace">本书任务有更新</button>
        <button v-if="inlineRunId" class="topbar-tool inline-run-top-button" :class="inlineRunStatus" title="打开当前 Codex 就地任务" @click="inlinePanelOpen = true"><AppIcon name="codex" :size="15" /><span>Codex</span></button>
        <button class="topbar-tool story-change-top-button" :class="storyChangeRunStatus" title="设定联动修改与历史" @click="openStoryChangeHistory"><AppIcon name="change" :size="15" /><span>联动</span></button>
        <button class="topbar-tool quality-top-button" title="创作质量中心" @click="qualityCenterOpen = true"><AppIcon name="quality" :size="15" /><span>质检</span></button>
        <button class="icon-button history-button" aria-label="生成记录" title="生成记录" @click="openGenerationHistory"><AppIcon name="history" :size="18" /></button>
        <button class="icon-button" aria-label="模型与项目设置" title="模型与项目设置" @click="openSettings"><AppIcon name="settings" :size="18" /></button>
      </div>
    </header>

    <main id="workspace-main" class="workspace-grid" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'focus-mode': writingFocus && workspaceView === 'writing', 'lens-hidden': !lensVisible }" v-if="workspaceReady">
      <aside id="workspace-sidebar" class="structure-panel panel-dark" :class="{ collapsed: sidebarCollapsed }">
        <div class="panel-heading">
          <span class="eyebrow">作品工作台</span>
          <div class="panel-heading-actions">
            <button class="quiet-button add-chapter-button" title="添加章节" :disabled="taskIsRunning()" @click="openNewChapter">＋</button>
            <button
              class="sidebar-collapse-button"
              type="button"
              :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
              :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
              :aria-expanded="!sidebarCollapsed"
              aria-controls="workspace-sidebar"
              @click="sidebarCollapsed = !sidebarCollapsed"
            >{{ sidebarCollapsed ? '›' : '‹' }}</button>
          </div>
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
              <button @click="openWorkDesignSync(item)">同步 ChatGPT Work 设计</button>
              <button @click="openBookInCodex(item)">准备并打开 Codex 专属任务</button>
              <button @click="openProjectTransfer(item)">导入与导出</button>
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
          <button class="new-project-link" @click="openProjectTransfer(project)">⇩ 导入文件或项目备份</button>
        </div>

        <nav class="side-nav" aria-label="项目导航">
          <button class="nav-item" :class="{ active: workspaceView === 'writing' }" title="正在创作" aria-label="正在创作" @click="setWorkspaceView('writing')"><span class="nav-glyph"><AppIcon name="writing" /></span><span>正在创作</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'assistant' }" title="创作助手" aria-label="创作助手" @click="setWorkspaceView('assistant')"><span class="nav-glyph"><AppIcon name="assistant" /></span><span>创作助手</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'foundation' }" title="故事基础" aria-label="故事基础" @click="setWorkspaceView('foundation')"><span class="nav-glyph"><AppIcon name="foundation" /></span><span>故事基础</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'characters' }" title="人物与关系" aria-label="人物与关系" @click="setWorkspaceView('characters')"><span class="nav-glyph"><AppIcon name="characters" /></span><span>人物与关系</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'world' }" title="世界观" aria-label="世界观" @click="setWorkspaceView('world')"><span class="nav-glyph"><AppIcon name="world" /></span><span>世界观</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'outline' }" title="结构规划" aria-label="结构规划" @click="setWorkspaceView('outline')"><span class="nav-glyph"><AppIcon name="outline" /></span><span>结构规划</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'knowledge' }" title="知识与连续性" aria-label="知识与连续性" @click="setWorkspaceView('knowledge')"><span class="nav-glyph"><AppIcon name="knowledge" /></span><span>知识与连续性</span></button>
          <button class="nav-item" :class="{ active: workspaceView === 'prompts' }" title="提示词与文风" aria-label="提示词与文风" @click="setWorkspaceView('prompts')"><span class="nav-glyph"><AppIcon name="prompts" /></span><span>提示词与文风</span></button>
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
                  <small>{{ chapter.status === 'completed' ? (chapter.finalization_manual ? '已定稿·人工' : chapter.finalization_correction ? '已定稿·已校正' : '已定稿') : chapter.finalized_version_id ? '修订待定稿' : chapter.status === 'draft' ? '草稿' : chapter.status }}</small>
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
          <div class="storage-note"><span class="storage-icon"><AppIcon name="database" :size="15" /></span><span>项目保存在本机</span></div>
          <div class="storage-note muted"><span>SQLite · schema v{{ runtime.database?.schemaVersion || 1 }} · 外键{{ runtime.database?.foreignKeys ? '已启用' : '待检查' }}</span></div>
          <div class="storage-note muted"><span>{{ runtime.buildId }} · {{ runtime.uiEntry === 'development' ? '开发界面' : '构建界面' }}</span></div>
        </div>
      </aside>

      <template v-if="workspaceView === 'writing'">
      <section class="editor-panel">
        <div class="editor-heading">
          <div class="editor-heading-copy">
            <div class="eyebrow copper">CHAPTER {{ String(activeChapter.chapter_no).padStart(2, '0') }}</div>
            <div class="chapter-title-line"><input v-model="activeChapter.title" class="chapter-title-input" aria-label="章节标题" @blur="saveChapterTitle" /></div>
            <div class="chapter-subline">
              <span>{{ countChinese(editorText) }} 中文字</span>
              <span class="dot-separator">·</span>
              <span>{{ activeTab === 'manuscript' ? '正文编辑' : activeTab === 'card' ? '章节卡' : '场景计划' }}</span>
              <button class="chapter-finalization-status" @click="openFinalization">{{ activeChapter.status === 'completed' && !isDirty ? (activeChapter.finalization_manual ? '已定稿·人工' : activeChapter.finalization_correction ? '已定稿·已校正' : '已确认定稿') : activeChapter.finalized_version_id ? '修订待定稿' : '待检查 / 待定稿' }}</button>
              <button v-if="activeChapter.finalized_version_id && !activeChapter.finalization_manual" class="chapter-linked-edit" @click="openFinalization">定稿后校正</button>
              <span v-if="activeChapter.finalization_manual" class="chapter-manual-handoff-note">未审稿 · 交接未更新</span>
              <span class="chapter-title-actions">
                <CreativeExecutionControl
                  compact
                  class="chapter-title-generation"
                  :default-mode="defaultExecutionMode"
                  :app-model-label="modelName('planning_field')"
                  action-label="生成章节名"
                  :disabled="taskIsRunning()"
                  @execute="generateChapterTitle"
                  @edit-default="openEditProject(project)"
                />
                <button class="chapter-linked-edit" type="button" title="修改章节标题并检查对全书的影响" @click="startChapterTitleChange"><AppIcon name="change" :size="13" /><span>联动改名</span></button>
              </span>
            </div>
          </div>
          <div class="editor-view-actions" aria-label="创作区布局">
            <button type="button" class="outline-button" :aria-pressed="writingFocus" @click="writingFocus = !writingFocus"><AppIcon name="focus" :size="16" />{{ writingFocus ? '退出专注' : '专注写作' }}</button>
            <button v-if="!writingFocus" type="button" class="outline-button" :aria-expanded="lensVisible" aria-controls="writing-lens" @click="lensOpen = !lensVisible"><AppIcon name="panel" :size="16" />写作镜头</button>
          </div>
          <div class="editor-heading-actions">
            <div class="editor-version-actions" aria-label="版本操作">
              <button class="outline-button" @click="openVersionHistory">版本历史</button>
              <button class="outline-button" @click="saveManuscript">保存版本</button>
              <button class="outline-button finalize-chapter-button" @click="openFinalization"><AppIcon name="quality" :size="15" />完成本章</button>
              <button v-if="runningTask" class="cancel-generation-button" :disabled="generationCancelPending" @click="cancelGeneration">
                {{ generationCancelPending ? '正在取消…' : '取消生成' }}
              </button>
            </div>
            <div class="editor-generation-actions" aria-label="正文生成">
              <select v-model="generationIntent" class="generation-intent" aria-label="正文生成方式" :disabled="taskIsRunning()">
                <option v-if="!editorText.trim()" value="draft">生成首稿</option>
                <option v-if="editorText.trim()" value="continue">从光标续写</option>
                <option v-if="editorText.trim()" value="rewrite">整章重写</option>
              </select>
              <CreativeExecutionControl
                :default-mode="defaultExecutionMode"
                :app-model-label="modelName('chapter')"
                :action-label="generationIntentLabel"
                :busy="isTaskRunning('chapter')"
                :disabled="taskIsRunning()"
                @execute="runCreativeTask('chapter', $event)"
                @edit-default="openEditProject(project)"
              />
            </div>
          </div>
        </div>

        <div class="editor-tabs" role="tablist" aria-label="章节内容" @keydown="navigateEditorTabs">
          <button id="editor-tab-manuscript" role="tab" :aria-selected="activeTab === 'manuscript'" :tabindex="activeTab === 'manuscript' ? 0 : -1" aria-controls="chapter-editor-content" :class="{ active: activeTab === 'manuscript' }" @click="activeTab = 'manuscript'">正文</button>
          <button id="editor-tab-card" role="tab" :aria-selected="activeTab === 'card'" :tabindex="activeTab === 'card' ? 0 : -1" aria-controls="chapter-editor-content" :class="{ active: activeTab === 'card' }" @click="activeTab = 'card'">章节卡</button>
          <button id="editor-tab-scene" role="tab" :aria-selected="activeTab === 'scene'" :tabindex="activeTab === 'scene' ? 0 : -1" aria-controls="chapter-editor-content" :class="{ active: activeTab === 'scene' }" @click="activeTab = 'scene'">场景计划</button>
          <span class="tab-spacer"></span>
          <button v-if="activeTab === 'manuscript'" type="button" title="查找正文（Ctrl+F / ⌘F）" @click="novelEditorRef?.find()">查找</button>
          <span class="editor-mode">{{ saveState === 'saving' ? '正在保存' : '编辑内容自动保存' }}</span>
        </div>

        <details v-if="activeTab === 'manuscript'" class="manuscript-local-checks">
          <summary>本地检查 · {{ liveManuscriptChecks.findings.length ? `${liveManuscriptChecks.findings.length} 项编辑提示` : '未发现格式异常' }} <small>不调用模型，不判断文学质量</small></summary>
          <p v-for="(finding, index) in liveManuscriptChecks.findings" :key="index">{{ finding.reason }} <q v-if="finding.evidence">{{ finding.evidence }}</q></p>
        </details>
        <div id="chapter-editor-content" class="editor-body" role="tabpanel" :aria-labelledby="`editor-tab-${activeTab}`" @mousedown.self="closeSelectionTools">
          <NovelEditor
            v-if="activeTab === 'manuscript'"
            ref="novelEditorRef"
            v-model="editorText"
            @selection-change="handleSelection"
          />
          <div v-else-if="activeTab === 'card'" class="artifact-view card-view">
            <details class="formal-card-edit"><summary>手动编辑章节卡</summary>
              <CreativeCandidateEditor :model-value="formalCardDraft" description="修改暂存在表单中，点击保存章节卡后生效" @update:model-value="formalCardDraft = $event" />
              <button class="outline-button" @click="saveFormalCard">保存章节卡</button>
            </details>
            <div class="artifact-header"><span class="eyebrow copper">CHAPTER CONTRACT</span><span class="artifact-state">{{ activeChapter.card?.goal ? '已生成' : '待生成' }}</span></div>
            <h2>{{ activeChapter.card?.goal || '还没有章节卡' }}</h2>
            <div class="artifact-grid">
              <article><span>正文目标</span><p>{{ chapterTargetLength.toLocaleString('zh-CN') }} 中文字</p></article>
              <article><span>主角目标</span><p>{{ activeChapter.card?.protagonistGoal || '等待规划' }}</p></article>
              <article><span>主要阻力</span><p>{{ activeChapter.card?.resistance || '等待规划' }}</p></article>
              <article><span>转折</span><p>{{ activeChapter.card?.turningPoint || '等待规划' }}</p></article>
              <article><span>结尾合同</span><p>{{ activeChapter.card?.ending || '等待规划' }}</p></article>
            </div>
            <div v-if="activeChapter.card?.requiredScenes?.length" class="scene-stack">
              <div v-for="scene in activeChapter.card.requiredScenes" :key="scene.id" class="scene-row"><b>{{ scene.id }}</b><strong>{{ scene.title }}</strong><span>{{ scene.result }}</span></div>
            </div>
          </div>
          <ScenePlanEditor v-else :model-value="activeChapter.scenePlan" @update:model-value="updateStructuredScenePlan" />

          <div
            v-if="selectionTools.visible && activeTab === 'manuscript'"
            class="selection-tools"
            :style="selectionToolsStyle"
            @mousedown.stop
          >
            <span class="selection-caption">已选 {{ selectionTools.text.length }} 字</span>
            <select v-model="selectionExecutionMode" class="selection-execution-mode" title="本次局部重写执行方式"><option value="app_model">任务模型</option><option value="codex">Codex</option></select>
            <button
              v-for="preset in REWRITE_PRESETS"
              :key="preset.id"
              :disabled="taskIsRunning() || selectionPreview.visible"
              :title="preset.name"
              @click="rewriteSelection(preset, selectionExecutionMode)"
            >{{ preset.shortLabel }}</button>
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

      <aside v-show="lensVisible && !writingFocus" id="writing-lens" class="context-panel" aria-label="本章写作镜头">
        <div class="context-heading">
          <div><span class="eyebrow">WRITING LENS</span><h2>本章写作镜头</h2></div>
          <button class="icon-button" type="button" aria-label="收起写作镜头" title="收起写作镜头" @click="lensOpen = false">×</button>
        </div>

        <section class="context-section focus-section">
          <div class="section-label"><span>当前目标</span><span class="verified">● 已确认</span></div>
          <p class="focus-copy">{{ activeChapter.card?.goal || '先生成一张章节卡，让故事从想法变成可以执行的动作。' }}</p>
        </section>

        <section class="context-section">
          <div class="section-label"><span>本章场景</span><CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="modelName('chapter_card')" action-label="生成章节卡" :busy="isTaskRunning('chapter_card')" :disabled="taskIsRunning()" @execute="runCreativeTask('chapter_card', $event)" @edit-default="openEditProject(project)" /></div>
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
          <div class="section-label"><span>当前执行策略</span><button class="link-button" @click="openSettings">配置</button></div>
          <div class="model-route"><span class="model-orb" :class="executionRoute('chapter').mode === 'codex' ? 'agent' : 'local'"></span><div><strong>正文 · {{ executionRoute('chapter').name }}</strong><small>{{ executionRoute('chapter').detail }}</small></div></div>
          <div class="model-route"><span class="model-orb" :class="executionRoute('chapter_card').mode === 'codex' ? 'agent' : 'external'"></span><div><strong>规划 · {{ executionRoute('chapter_card').name }}</strong><small>{{ executionRoute('chapter_card').detail }}</small></div></div>
          <p v-if="defaultExecutionMode === 'codex'" class="model-route-fallback">仅在生成按钮下拉菜单选择“任务模型”时使用：正文 {{ modelName('chapter') }} · 规划 {{ modelName('chapter_card') }}</p>
        </section>

        <section class="context-section progress-section">
          <div class="section-label"><span>章节进度</span><span>{{ chapterProgress }}%</span></div>
          <div class="progress-track"><div class="progress-bar" :style="{ width: `${chapterProgress}%` }"></div></div>
          <div class="progress-meta"><span>{{ countChinese(editorText) }} 中文字</span><span>目标 {{ chapterTargetLength.toLocaleString('zh-CN') }} 字</span></div>
        </section>

        <div class="context-bottom-actions">
          <CreativeExecutionControl :default-mode="defaultExecutionMode" :app-model-label="modelName('scene_plan')" action-label="生成场景计划" :busy="isTaskRunning('scene_plan')" :disabled="taskIsRunning()" @execute="runCreativeTask('scene_plan', $event)" @edit-default="openEditProject(project)" />
          <button class="secondary-action" @click="saveManuscript"><span>⌘</span>保存当前版本</button>
        </div>
      </aside>
      </template>
      <CreativeAssistant
        v-else-if="workspaceView === 'assistant'"
        :project-id="project.id"
        :chapter-id="activeChapterId"
        :model-settings="modelSettings"
        @workspace-change="refreshWorkspaceFromAgent"
      />
      <KnowledgeCenter
        v-else-if="workspaceView === 'knowledge'"
        ref="knowledgeCenterRef"
        :project="project"
        :chapters="chapters"
        :active-chapter-id="activeChapterId"
        :model-settings="modelSettings"
        @toast="showToast"
        @codex-action="startInlineCodex"
        @story-change="startStoryChange"
      />
      <PromptCenter
        v-else-if="workspaceView === 'prompts'"
        :project="project"
        :active-chapter-id="activeChapterId"
        :model-settings="modelSettings"
        @toast="showToast"
        @project-updated="Object.assign(project, $event)"
        @codex-action="startInlineCodex"
      />
      <PlanningCenter
        v-else
        ref="planningCenterRef"
        :project="project"
        :section="workspaceView"
        :model-settings="modelSettings"
        @toast="showToast"
        @open-settings="openSettings"
        @edit-project="openEditProject(project)"
        @chapter-updated="replaceChapter"
        @delete-chapter="askDeleteChapter"
        @codex-action="startInlineCodex"
        @story-change="startStoryChange"
      />
    </main>

    <div v-else class="loading-screen"><div class="loading-mark">NS</div><p>{{ loadError ? '工作区打开失败：' + loadError : '正在打开你的写作桌面…' }}</p></div>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <ModelSettings
      :visible="settingsOpen"
      :settings="modelSettings"
      :save-state="modelProfileSaveState"
      @close="settingsOpen = false"
      @save-profile="saveModelProfile"
      @delete-profile="deleteModelProfile"
      @route-change="changeTaskRoute"
    />
    <ApprovalDrawer :project-id="project.id" />
    <ChapterFinalization v-if="finalizationOpen" :project-id="project.id" :chapter-id="activeChapter.id" :settings="modelSettings" @close="finalizationOpen = false" @completed="reloadAfterFinalization" />
    <InlineCodexPanel
      :visible="inlinePanelOpen"
      :run-id="inlineRunId"
      :current-draft-digest="inlineCurrentDraftDigest"
      :current-draft-value="inlineCurrentDraftValue"
      :source-manuscript="inlineSourceManuscript"
      :current-chapter-card="activeChapter?.card || {}"
      @close="inlinePanelOpen = false"
      @accepted="handleInlineAccepted"
      @rejected="handleInlineRejected"
      @updated="handleInlineRunUpdated"
    />
    <StoryChangePanel
      :visible="storyChangePanelOpen"
      :project-id="project.id"
      :target="storyChangeTarget"
      :resume-run-id="storyChangeResumeRunId"
      :resume-change-set-id="storyChangeResumeSetId"
      @close="storyChangePanelOpen = false"
      @workspace-change="refreshWorkspaceAfterStoryChange"
      @toast="showToast"
      @run-updated="handleStoryChangeRunUpdated"
    />
    <GenerationHistory
      :visible="generationHistoryOpen"
      :records="generationRecords"
      :loading="generationHistoryLoading"
      :retrying-id="retryingRecordId"
      @close="generationHistoryOpen = false"
      @refresh="refreshGenerationHistory"
      @retry="retryGenerationRecord"
    />
    <QualityCenter
      :visible="qualityCenterOpen"
      :project="project"
      :chapter="activeChapter"
      :model-settings="modelSettings"
      @close="qualityCenterOpen = false"
      @toast="showToast"
      @repair-candidate="handleQualityRepairCandidate"
      @codex-action="startInlineCodex"
      @edit-project="openEditProject(project)"
    />
    <ProjectTransfer
      :visible="projectTransferOpen"
      :project="transferProject || project"
      :busy="projectTransferBusy"
      @close="projectTransferOpen = false"
      @export="exportProjectFile"
      @import="importProjectFile"
    />
    <ChatGPTWorkSync
      :visible="workDesignSyncOpen"
      :project="project"
      @close="workDesignSyncOpen = false"
      @toast="showToast"
      @applied="refreshAfterWorkDesignSync"
    />
    <DiffReview
      :visible="candidate.visible"
      :original="candidate.original"
      :candidate="candidate.content"
      :title="candidate.title"
      :subtitle="candidate.subtitle"
      :hint="candidate.hint"
      :language="candidate.language"
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
      <form class="project-dialog project-brief-dialog" @submit.prevent="createNewProject">
        <span class="eyebrow copper">NEW MANUSCRIPT</span>
        <h2>建立新的小说项目</h2>
        <p>只要选一个方向，写下几个关键词就能开始。所有内容之后都能继续修改。</p>
        <label><span>项目名称</span><input v-model.trim="newProjectDraft.title" required autofocus placeholder="例如：雾港来信" /></label>
        <ProjectBriefFields
          id-prefix="new-project"
          :genre="newProjectDraft.genre"
          :idea="newProjectDraft.idea"
          :style="newProjectDraft.style"
          @update:genre="newProjectDraft.genre = $event"
          @update:idea="newProjectDraft.idea = $event"
          @update:style="newProjectDraft.style = $event"
        />
        <div class="project-dialog-actions">
          <button type="button" @click="newProjectOpen = false">取消</button>
          <button type="submit" :disabled="projectCreating">{{ projectCreating ? '正在建立…' : '建立项目' }}</button>
        </div>
      </form>
    </div>
    <div v-if="editProjectOpen" class="project-dialog-backdrop" @mousedown.self="editProjectOpen = false">
      <form class="project-dialog project-edit-dialog project-brief-dialog" @submit.prevent="saveProjectEdits">
        <span class="eyebrow copper">PROJECT NOTES</span>
        <h2>编辑项目信息</h2>
        <p>这里修改的是作品层信息，会成为后续规划和生成的共同上下文。</p>
        <label><span>项目名称</span><input v-model.trim="editProjectDraft.title" required autofocus /></label>
        <ProjectBriefFields
          id-prefix="edit-project"
          :genre="editProjectDraft.genre"
          :idea="editProjectDraft.idea"
          :style="editProjectDraft.style"
          @update:genre="editProjectDraft.genre = $event"
          @update:idea="editProjectDraft.idea = $event"
          @update:style="editProjectDraft.style = $event"
        />
        <div class="project-change-actions">
          <span>联动修改已保存的作品级设定</span>
          <button type="button" @click="startProjectFieldChange('title', '项目名称')">项目名称</button>
          <button type="button" @click="startProjectFieldChange('genre', '题材')">题材</button>
          <button type="button" @click="startProjectFieldChange('idea', '一句话想法')">一句话想法</button>
          <button type="button" @click="startProjectFieldChange('style', '项目文风')">项目文风</button>
        </div>
        <div class="project-draft-codex-actions">
          <CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="modelName('planning_field')" action-label="完善一句话想法" @execute="requestProjectDraft('idea', '一句话想法', $event)" />
          <CreativeExecutionControl compact :default-mode="defaultExecutionMode" :app-model-label="modelName('planning_field')" action-label="完善项目文风" @execute="requestProjectDraft('style', '项目文风', $event)" />
          <small>生成结果只填入此对话框，点击“保存修改”后才进入项目。</small>
        </div>
        <label class="project-execution-choice"><span>默认创作执行方式</span><select v-model="editProjectDraft.default_execution_mode"><option value="app_model">应用模型路由</option><option value="codex">Codex · ACP 优先</option></select><small>所有分裂生成按钮会默认使用这里的选择；下拉菜单仍可只覆盖单次调用。</small></label>
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
import AppIcon from './components/AppIcon.vue'
import ApprovalDrawer from './components/ApprovalDrawer.vue'
import CreativeAssistant from './components/CreativeAssistant.vue'
import CreativeExecutionControl from './components/CreativeExecutionControl.vue'
import GenerationHistory from './components/GenerationHistory.vue'
import KnowledgeCenter from './components/KnowledgeCenter.vue'
import InlineCodexPanel from './components/InlineCodexPanel.vue'
import ChapterFinalization from './components/ChapterFinalization.vue'
import StoryChangePanel from './components/StoryChangePanel.vue'
import ModelSettings from './components/ModelSettings.vue'
import NovelEditor from './components/NovelEditor.vue'
import ProjectBriefFields from './components/ProjectBriefFields.vue'
import QualityCenter from './components/QualityCenter.vue'
import { composeGenerationCandidate } from './utils/generation-intents.js'
import { creativeRoutePresentation, draftDigest, projectExecutionMode } from './utils/inline-creative.js'
import ScenePlanEditor from './components/ScenePlanEditor.vue'
import CreativeCandidateEditor from './components/CreativeCandidateEditor.vue'
import { checkManuscript } from '../electron/manuscript-checks.js'
import PlanningCenter from './components/PlanningCenter.vue'
import ProjectTransfer from './components/ProjectTransfer.vue'
import ChatGPTWorkSync from './components/ChatGPTWorkSync.vue'
import PromptCenter from './components/PromptCenter.vue'
import VersionHistory from './components/VersionHistory.vue'
import { REWRITE_PRESETS } from '../electron/prompt-templates.js'
import { appService } from './services/app-service.js'
import { countChinese, formatRelativeTime } from './services/format.js'

const workspaceReady = ref(false)
const SIDEBAR_COLLAPSED_KEY = 'novel-studio:structure-sidebar-collapsed'
const sidebarCollapsed = ref(false)
try { sidebarCollapsed.value = globalThis.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch {}
const workspace = ref(null)
const projects = ref([])
const chapters = ref([])
const activeChapterId = ref('')
const editorText = ref('')
const activeTab = ref('manuscript')
const workspaceView = ref('writing')
const writingFocus = ref(false)
const lensOpen = ref(null)
const viewportWidth = ref(window.innerWidth)
const lensVisible = computed(() => lensOpen.value ?? viewportWidth.value >= 1280)
function updateViewport() { viewportWidth.value = window.innerWidth }
function navigateEditorTabs(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const tabs = ['manuscript', 'card', 'scene']
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(activeTab.value) + (event.key === 'ArrowRight' ? 1 : 2)) % 3
  activeTab.value = tabs[index]
  document.getElementById(`editor-tab-${tabs[index]}`)?.focus()
}
const planningCenterRef = ref(null)
const knowledgeCenterRef = ref(null)
const novelEditorRef = ref(null)
const instruction = ref('')
const runningTask = ref('')
const generationCancelPending = ref(false)
const generationIntent = ref('draft')
const selectionExecutionMode = ref('app_model')
const cursorOffset = ref(0)
const lastSavedAt = ref('')
const saveState = ref('saved')
const isDirty = ref(false)
const toast = ref('')
const loadError = ref('')
const settingsOpen = ref(false)
const qualityCenterOpen = ref(false)
const finalizationOpen = ref(false)
async function openFinalization() {
  try {
    await saveManuscript({ createRevision: false })
    if (isDirty.value) await saveManuscript({ createRevision: false })
    if (!isDirty.value) finalizationOpen.value = true
  } catch { /* saving already reports its error */ }
}
async function reloadAfterFinalization(record) {
  const loaded = await appService.loadWorkspace(project.id)
  const chapter = loaded.chapters.find(item => item.id === activeChapter.value.id)
  if (chapter) replaceChapter(chapter)
  showToast(record?.checks?.manualFinalization ? '本章已人工定稿；本次未审稿，交接未更新' : '本章已定稿，交接记录已确认')
}
const inlinePanelOpen = ref(false)
const inlineRunId = ref('')
const inlineRunStatus = ref('')
const inlineRun = ref(null)
const inlineDraftDigest = ref('')
const storyChangePanelOpen = ref(false)
const storyChangeTarget = ref(null)
const storyChangeResumeRunId = ref('')
const storyChangeResumeSetId = ref('')
const storyChangeRunStatus = ref('')
const generationHistoryOpen = ref(false)
const generationHistoryLoading = ref(false)
const generationRecords = ref([])
const retryingRecordId = ref('')
const projectMenuOpen = ref(false)
const projectActionId = ref('')
const chapterActionId = ref('')
const archiveListOpen = ref(false)
const newProjectOpen = ref(false)
const projectCreating = ref(false)
const projectTransferOpen = ref(false)
const projectTransferBusy = ref(false)
const transferProject = ref(null)
const workDesignSyncOpen = ref(false)
const editProjectOpen = ref(false)
const newChapterOpen = ref(false)
const renameChapterOpen = ref(false)
const workspaceActionPending = ref(false)
const versionsOpen = ref(false)
const versionsLoading = ref(false)
const versionRestoring = ref(false)
const revisions = ref([])

watch(sidebarCollapsed, (collapsed) => {
  try { globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)) } catch {}
})
const newProjectDraft = reactive({ title: '', genre: '', idea: '', style: '' })
const editProjectDraft = reactive({ id: '', title: '', genre: '', idea: '', style: '', default_execution_mode: 'app_model' })
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
const candidate = reactive({ visible: false, original: '', content: '', title: '', subtitle: '', hint: '', language: 'markdown', task: '', candidateId: '', targetTab: 'manuscript' })
const streamPreview = reactive({ visible: false, task: '', status: '', content: '', gateway: 'embedded' })
const runtime = reactive({ goServiceStatus: 'embedded-fallback', mode: 'embedded' })
const project = reactive({ title: '', genre: '', idea: '', style: '', default_execution_mode: 'app_model' })
const modelSettings = reactive({ profiles: [], routes: {} })
const modelProfileSaveState = reactive({ state: 'idle', message: '' })
let autosaveTimer = null
let savePromise = null
let closeRequestCleanup = null
let runtimeInfoCleanup = null
let creativeChangeCleanup = null
const externalChange = ref(false)
let closeInProgress = false
let activeGeneration = null
let confirmationRunner = null
let scenePlanSaveTimer = null
const inlineBindings = new Map()

const activeChapter = computed(() => chapters.value.find((chapter) => chapter.id === activeChapterId.value) || chapters.value[0])
const chapterTargetLength = computed(() => Math.max(800, Math.min(12000, Math.round(Number(activeChapter.value?.card?.targetLength) || 2000))))
const liveManuscriptChecks = computed(() => checkManuscript(editorText.value, { targetLength: chapterTargetLength.value }))
const formalCardDraft = ref({})
let formalCardSource = ''
watch(() => [activeChapter.value?.id, activeChapter.value?.card], () => {
  formalCardSource = JSON.stringify(activeChapter.value?.card || {})
  formalCardDraft.value = { goal: '', protagonistGoal: '', resistance: '', turningPoint: '', payoff: '', cost: '', ending: '', ...JSON.parse(formalCardSource) }
}, { immediate: true })
async function saveFormalCard() {
  try {
    const chapterId = activeChapter.value.id
    const snapshot = await appService.loadWorkspace(project.id)
    const current = snapshot.chapters.find(chapter => chapter.id === chapterId)
    if (JSON.stringify(current?.card || {}) !== formalCardSource) throw new Error('章节卡已在其他位置修改，请重新打开后比较再保存')
    replaceChapter(await appService.updateChapter({ id: chapterId, card: formalCardDraft.value }))
    showToast('章节卡已保存')
  } catch (error) { showToast(error.message) }
}
const chapterProgress = computed(() => Math.min(100, Math.round((countChinese(editorText.value) / chapterTargetLength.value) * 100)))
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
  return lastSavedAt.value ? formatRelativeTime(lastSavedAt.value) : '已保存'
})
const selectionToolsStyle = computed(() => ({
  left: `${selectionTools.left || 50}%`,
  top: `${selectionTools.bottom || 23}px`,
}))
const generationIntentLabel = computed(() => ({ draft: '生成首稿', continue: '从光标续写', rewrite: '整章重写' }[generationIntent.value] || '生成正文'))
const defaultExecutionMode = computed(() => projectExecutionMode(project))
const inlineCurrentDraftDigest = computed(() => inlineBindings.get(inlineRunId.value)?.getDraftDigest?.() || inlineDraftDigest.value)
const inlineCurrentDraftValue = computed(() => inlineBindings.get(inlineRunId.value)?.getDraftValue?.())
const inlineSourceManuscript = computed(() => chapters.value.find((chapter) => chapter.id === inlineRun.value?.chapterId)?.manuscript || '')

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
function executionRoute(task) {
  return creativeRoutePresentation({
    project,
    taskModelName: modelName(task),
    taskModelDetail: modelDetail(task),
  })
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
  if (inlineRunId.value && inlineRunStatus.value && !['running', 'waiting_approval', 'waiting_confirmation', 'paused', 'pending'].includes(inlineRunStatus.value)) {
    inlineRunId.value = ''
    inlineRun.value = null
    inlinePanelOpen.value = false
  }
}

onMounted(async () => {
  window.addEventListener('resize', updateViewport)
  closeRequestCleanup = appService.onCloseRequest(handleCloseRequest)
  runtimeInfoCleanup = appService.onRuntimeInfo((info) => Object.assign(runtime, info))
  creativeChangeCleanup = appService.onCreativeChange(event => {
    if (event.projectId === project.id) externalChange.value = true
  })
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
    await restoreInlineRun()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    console.error('[Novel Studio] workspace load failed', error)
  }
})

async function refreshWorkspaceFromAgent() {
  const view = workspaceView.value
  const chapterId = activeChapterId.value
  const loaded = await appService.loadWorkspace(project.id)
  applyWorkspace(loaded)
  if (loaded.chapters?.some((chapter) => chapter.id === chapterId)) activeChapterId.value = chapterId
  workspaceView.value = view
  showToast('Agent 候选已确认并写入项目')
}

watch(() => project.id, () => { externalChange.value = false })
async function refreshExternalWorkspace() {
  if (isDirty.value || saveState.value === 'saving') {
    showToast('当前编辑稿有待保存修改，请先核对并保存，再读取任务更新')
    return
  }
  const projectId = project.id, chapterId = activeChapterId.value, view = workspaceView.value
  const loaded = await appService.loadWorkspaceSnapshot(projectId)
  if (project.id !== projectId || isDirty.value) return
  applyWorkspace(loaded)
  if (loaded.chapters.some(chapter => chapter.id === chapterId)) activeChapterId.value = chapterId
  workspaceView.value = view
  externalChange.value = false
  showToast('已读取本书创作任务的最新结果')
}

watch(activeChapter, (chapter) => {
  if (!chapter) return
  editorText.value = chapter.manuscript || ''
  isDirty.value = false
  saveState.value = 'saved'
  generationIntent.value = chapter.manuscript?.trim() ? 'continue' : 'draft'
  cursorOffset.value = chapter.manuscript?.length || 0
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
  window.removeEventListener('resize', updateViewport)
  if (autosaveTimer) window.clearTimeout(autosaveTimer)
  if (scenePlanSaveTimer) window.clearTimeout(scenePlanSaveTimer)
  void activeGeneration?.cancel()
  closeRequestCleanup?.()
  runtimeInfoCleanup?.()
  creativeChangeCleanup?.()
  window.removeEventListener('beforeunload', handleBrowserBeforeUnload)
})

async function restoreInlineRun() {
  if (!project.id) return
  const runs = await appService.listAgentRuns({ projectId: project.id, limit: 100 })
  const activeRuns = runs.filter((run) => run.workflowId === 'inline-action' && ['pending', 'waiting_approval', 'running', 'waiting_confirmation', 'paused'].includes(run.status))
  for (const active of activeRuns) {
    const detailed = await appService.getAgentRun(active.id)
    const storyStep = detailed?.steps?.find((step) => step.input?.target?.kind === 'story_change_set')
    if (storyStep && !storyChangeResumeRunId.value) {
      storyChangeResumeRunId.value = active.id
      storyChangeResumeSetId.value = storyStep.input.target.targetId || ''
      storyChangeRunStatus.value = active.status
      storyChangeTarget.value = null
      storyChangePanelOpen.value = true
      continue
    }
    if (!inlineRunId.value) {
      inlineRunId.value = active.id
      inlineRunStatus.value = active.status
      inlineRun.value = detailed
    }
  }
}

async function flushPlanningMemory() {
  await planningCenterRef.value?.flushSaves?.()
  await knowledgeCenterRef.value?.flushSaves?.()
}

async function selectChapter(id) {
  if (id === activeChapterId.value && workspaceView.value === 'writing') return
  if (selectionPreview.visible) discardSelectionPreview()
  if (workspaceView.value === 'writing') await saveManuscript({ createRevision: false, source: 'chapter-switch' })
  else await flushPlanningMemory()
  activeChapterId.value = id
  activeTab.value = 'manuscript'
  workspaceView.value = 'writing'
  versionsOpen.value = false
}

async function setWorkspaceView(view) {
  if (workspaceView.value === view) return
  try {
    if (workspaceView.value === 'writing') await saveManuscript({ createRevision: false, source: 'workspace-view-switch' })
    else await flushPlanningMemory()
    workspaceView.value = view
    projectMenuOpen.value = false
  } catch (error) {
    showToast(`切换工作区失败：${error.message}`)
  }
}

async function switchProject(projectId) {
  if (projectId === project.id || runningTask.value) {
    projectMenuOpen.value = false
    return
  }
  try {
    await flushPlanningMemory()
    await saveManuscript({ createRevision: false, source: 'project-switch' })
    const loaded = await appService.loadWorkspace(projectId)
    applyWorkspace(loaded)
    inlineRunId.value = ''
    inlineRunStatus.value = ''
    inlineRun.value = null
    inlinePanelOpen.value = false
    storyChangePanelOpen.value = false
    storyChangeTarget.value = null
    storyChangeResumeRunId.value = ''
    storyChangeResumeSetId.value = ''
    storyChangeRunStatus.value = ''
    await restoreInlineRun()
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
  newProjectDraft.style = ''
  newProjectOpen.value = true
}

async function openProjectTransfer(item = project) {
  if (projectTransferBusy.value || runningTask.value) return
  try {
    await flushPlanningMemory()
    await saveManuscript({ createRevision: false, source: 'before-project-transfer' })
    if (item.id && item.id !== project.id) {
      const loaded = await appService.loadWorkspace(item.id)
      applyWorkspace(loaded)
      transferProject.value = loaded.project
    } else {
      transferProject.value = { ...project }
    }
    projectActionId.value = ''
    projectMenuOpen.value = false
    projectTransferOpen.value = true
  } catch (error) {
    showToast(`打开导入导出失败：${error.message}`)
  }
}

async function openBookInCodex(item = project) {
  projectActionId.value = ''
  projectMenuOpen.value = false
  try {
    const result = await appService.openCodexProject(item.id)
    showToast(`《${item.title}》的本机绑定和任务说明已准备，并已在 Codex 中打开${result?.workspaceName ? ` · ${result.workspaceName}` : ''}`)
  } catch (error) {
    showToast(`打开 Codex 项目失败：${error.message}`)
  }
}

async function openWorkDesignSync(item = project) {
  try {
    if (item.id && item.id !== project.id) await switchProject(item.id)
    if (item.id && item.id !== project.id) throw new Error('请先结束当前运行，再切换到目标作品')
    projectActionId.value = ''
    projectMenuOpen.value = false
    workDesignSyncOpen.value = true
  } catch (error) {
    showToast(`打开设计同步失败：${error.message}`)
  }
}

async function refreshAfterWorkDesignSync() {
  const loaded = await appService.loadWorkspaceSnapshot(project.id)
  applyWorkspace(loaded)
  await planningCenterRef.value?.reload?.()
  await knowledgeCenterRef.value?.reload?.()
  externalChange.value = false
}

async function exportProjectFile(format) {
  if (projectTransferBusy.value || !project.id) return
  projectTransferBusy.value = true
  try {
    await flushPlanningMemory()
    await saveManuscript({ createRevision: false, source: 'before-project-export' })
    const result = await appService.exportProjectFile({ projectId: project.id, format })
    if (!result.cancelled) {
      const fileName = result.filePath.split(/[\\/]/).pop()
      showToast(`已导出 ${fileName}`)
    }
  } catch (error) {
    showToast(`导出失败：${error.message}`)
  } finally {
    projectTransferBusy.value = false
  }
}

async function importProjectFile() {
  if (projectTransferBusy.value || runningTask.value) return
  projectTransferBusy.value = true
  try {
    await flushPlanningMemory()
    await saveManuscript({ createRevision: false, source: 'before-project-import' })
    const result = await appService.importProjectFile()
    if (!result.cancelled) {
      applyWorkspace(result.workspace)
      projectTransferOpen.value = false
      transferProject.value = null
      showToast(result.mode === 'backup' ? `项目备份已恢复为《${result.workspace.project.title}》` : `文稿已导入为《${result.workspace.project.title}》`)
    }
  } catch (error) {
    showToast(`导入失败：${error.message}`)
  } finally {
    projectTransferBusy.value = false
  }
}

async function createNewProject() {
  if (!newProjectDraft.title || projectCreating.value) return
  projectCreating.value = true
  try {
    await flushPlanningMemory()
    await saveManuscript({ createRevision: false, source: 'project-create' })
    const loaded = await appService.createProject({ ...newProjectDraft })
    applyWorkspace(loaded)
    newProjectOpen.value = false
    showToast(loaded.codexWorkspaceError
      ? `《${loaded.project.title}》已建立，但 Codex 项目目录创建失败：${loaded.codexWorkspaceError}`
      : `《${loaded.project.title}》与 Codex 项目目录已建立，可以开始第一章`)
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
    default_execution_mode: projectExecutionMode(item),
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

async function requestProjectDraft(fieldKey, fieldLabel, executionMode = defaultExecutionMode.value) {
  const snapshot = () => draftDigest(editProjectDraft)
  const draftContext = {
    title: editProjectDraft.title,
    genre: editProjectDraft.genre,
    idea: editProjectDraft.idea,
    style: editProjectDraft.style,
  }
  const instructionText = `请为“${fieldLabel}”生成可直接填入项目信息表单的候选。必须以待保存题材“${draftContext.genre || '未指定'}”为准。只输出字段最终内容，不要解释任务、流程、候选机制或是否写入项目。当前未保存项目草稿：${JSON.stringify(draftContext)}`
  const assign = (text) => { editProjectDraft[fieldKey] = text }
  if (executionMode !== 'codex') {
    const generation = appService.startGeneration({
      task: 'planning_field', projectId: project.id, instruction: instructionText,
      projectDraftContext: draftContext,
      modelProfileId: modelSettings.routes.planning_field,
      planning: {
        sectionLabel: '项目信息', targetLabel: project.title, targetType: 'renderer_draft', targetId: project.id,
        fieldKey, fieldLabel, currentValue: editProjectDraft[fieldKey], nearbyContext: JSON.stringify(editProjectDraft),
        scopeType: 'project', scopeId: project.id,
      },
    })
    try { const result = await generation.promise; assign(result.text || ''); showToast(`${fieldLabel}候选已填入，尚未保存`) }
    catch (error) { showToast(`生成失败：${error.message}`) }
    return
  }
  const initialDigest = snapshot()
  await startInlineCodex({
    request: {
      projectId: project.id,
      task: 'planning_field',
      target: { kind: 'project_brief_draft', targetId: project.id, fieldKey, fieldLabel, draftDigest: initialDigest, draftContext },
      instruction: instructionText,
    },
    getDraftDigest: snapshot,
    getDraftValue: () => String(editProjectDraft[fieldKey] || ''),
    applyDraft: assign,
  })
}

function askArchiveProject(item) {
  projectActionId.value = ''
  requestConfirmation({
    title: `归档《${item.title}》？`,
    body: '项目会离开创作中的作品列表，正文、规划与版本历史都会完整保留。',
    note: '之后可以从项目架的“已归档”区域恢复。',
    confirmLabel: '归档项目',
    run: async () => {
      await flushPlanningMemory()
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
      await flushPlanningMemory()
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
    workspaceView.value = 'writing'
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
    workspaceView.value = 'writing'
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
  const chapterNo = chapter.chapter_no || chapter.chapterNo || 1
  requestConfirmation({
    title: `删除第 ${chapterNo} 章？`,
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
      if (workspaceView.value === 'outline') await planningCenterRef.value?.reload?.()
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

async function startChapterTitleChange() {
  if (!activeChapter.value) return
  try {
    await saveChapterTitle()
    startStoryChange({
      target: {
        kind: 'chapter_field',
        targetId: activeChapter.value.id,
        fieldKey: 'title',
        fieldLabel: `第 ${activeChapter.value.chapter_no} 章 · 标题`,
        currentValue: activeChapter.value.title,
      },
    })
  } catch (error) {
    showToast(`保存章节标题失败：${error.message}`)
  }
}

async function generateChapterTitle(mode = defaultExecutionMode.value) {
  if (!activeChapter.value) return
  try {
    if (isDirty.value) await saveManuscript({ createRevision: false, source: 'before-chapter-title-generation' })
    await saveChapterTitle()
    const chapter = activeChapter.value
    await startInlineCodex({
      request: {
        projectId: project.id,
        chapterId: chapter.id,
        task: 'planning_field',
        intent: 'draft',
        executionMode: mode === 'app_model' ? 'app_model' : 'codex',
        modelProfileId: mode === 'app_model' ? modelSettings.routes?.planning_field || '' : '',
        modelProfileName: mode === 'app_model' ? modelName('planning_field') : '',
        target: {
          kind: 'chapter_field',
          targetId: chapter.id,
          fieldKey: 'title',
          fieldLabel: '章节名',
          promptProfile: 'chapter_title',
          scopeType: 'chapter',
          scopeId: chapter.id,
        },
        instruction: [
          '结合本章已确认的章节卡、场景计划和当前正文，为这一章生成具有连载点击吸引力的章节名。',
          '先在内部各拟一个“身份反差”“现场冲突”“人物口吻”“悬念问题”方向的标题，再按具体性、好奇缺口、题材契合、人物声音和不泄底五项比较，只输出得分最高的一项。',
          '“金额＋动作＋时长”一类内容纪要不是合格章节名，例如“二百块借灶一小时”应当淘汰；也不要使用“新的开始”“暗流涌动”等可套用到任何章节的空泛标题。',
          '标题必须来自本章真实内容，不夸大不存在的冲突或回报。通常 6—18 个中文字符，可使用一个逗号、问号或叹号；不要带“第几章”、书名号、解释、评分或备选列表。',
        ].join('\n'),
      },
    })
  } catch (error) {
    showToast(`生成章节名失败：${error.message}`)
  }
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
      const updated = await appService.updateChapter({ id: chapterId, manuscript: content, expectedManuscript:activeChapter.value.manuscript || '' })
      replaceChapter(updated)
      if (createRevision || forceRevision) {
        await appService.createRevision({ chapterId, content, source })
      }
      lastSavedAt.value = new Date().toISOString()
      isDirty.value = activeChapter.value?.id === chapterId && editorText.value !== content
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

function updateStructuredScenePlan(scenePlan) {
  if (!activeChapter.value) return
  activeChapter.value.scenePlan = scenePlan
  if (scenePlanSaveTimer) window.clearTimeout(scenePlanSaveTimer)
  scenePlanSaveTimer = window.setTimeout(async () => {
    scenePlanSaveTimer = null
    try {
      const updated = await appService.updateChapter({ id: activeChapter.value.id, scenePlan })
      replaceChapter(updated)
      showToast('结构化场景计划已保存')
    } catch (error) { showToast(`场景计划保存失败：${error.message}`) }
  }, 700)
}

async function handleQualityRepairCandidate({ result, source, report }) {
  if (!result || !source || !activeChapter.value) return
  if (source.task === 'chapter') {
    candidate.original = editorText.value
    candidate.content = result.manuscript || ''
    candidate.title = '定向修复候选稿'
    candidate.subtitle = `根据质量报告中的 ${report.modelReview?.issues?.length || 0} 项问题生成。接受前请核对未涉及内容是否保持。`
    candidate.hint = '修复稿尚未写入正文，接受后才会保存为新版本。'
    candidate.language = 'markdown'
    candidate.task = 'chapter'
    candidate.candidateId = ''
    candidate.targetTab = 'manuscript'
    candidate.visible = true
    qualityCenterOpen.value = false
    return
  }
  const isCard = source.task === 'chapter_card'
  const generatedValue = JSON.stringify(isCard ? result.card : result.scenePlan)
  const originalValue = JSON.stringify(isCard ? activeChapter.value.card || {} : activeChapter.value.scenePlan || {})
  const pending = await appService.createPlanningCandidate({
    projectId: project.id,
    targetType: 'chapter',
    targetId: activeChapter.value.id,
    fieldKey: isCard ? 'card' : 'scenePlan',
    fieldLabel: isCard ? '章节卡' : '场景计划',
    originalValue,
    candidateValue: generatedValue,
    instruction: '根据质量报告定向修复',
    model: result.model,
  })
  candidate.original = JSON.stringify(isCard ? activeChapter.value.card || {} : activeChapter.value.scenePlan || {}, null, 2)
  candidate.content = JSON.stringify(isCard ? result.card : result.scenePlan, null, 2)
  candidate.title = `${isCard ? '章节卡' : '场景计划'}定向修复候选`
  candidate.subtitle = '接受后才会替换当前正式规划。'
  candidate.hint = '请确认修复没有改变未被质量报告指出的事实。'
  candidate.language = 'json'
  candidate.task = source.task
  candidate.candidateId = pending.id
  candidate.targetTab = isCard ? 'card' : 'scene'
  candidate.visible = true
  qualityCenterOpen.value = false
}

async function runCreativeTask(task, mode = defaultExecutionMode.value) {
  if (mode !== 'codex') return runGeneration(task)
  if (!activeChapter.value || runningTask.value) return
  try {
    if (workspaceView.value === 'writing' && isDirty.value) {
      await saveManuscript({ createRevision: true, source: `before-codex-inline-${task}` })
    }
    const intent = task === 'chapter' ? generationIntent.value : task === 'quality_review' ? 'analysis' : 'draft'
    const target = task === 'chapter'
      ? { kind: 'manuscript', targetId: activeChapter.value.id, cursorOffset: cursorOffset.value, fieldLabel: generationIntentLabel.value }
      : task === 'chapter_card'
        ? { kind: 'chapter_card', targetId: activeChapter.value.id, fieldLabel: '章节卡' }
        : task === 'scene_plan'
          ? { kind: 'scene_plan', targetId: activeChapter.value.id, fieldLabel: '场景计划' }
          : null
    if (!target) throw new Error(`就地 Codex 尚未识别任务：${task}`)
    await startInlineCodex({
      request: {
        projectId: project.id,
        chapterId: activeChapter.value.id,
        task,
        intent,
        target,
        instruction: instruction.value,
        targetLength: task === 'chapter' ? chapterTargetLength.value : 0,
      },
    })
  } catch (error) {
    showToast(`Codex 就地任务启动失败：${error.message}`)
  }
}

async function startInlineCodex(action = {}) {
  const request = action.request || action
  if (!project.id) return
  let run
  try {
    run = await appService.startInlineAgent({
      ...request,
      projectId: project.id,
      chapterId: request.chapterId || activeChapter.value?.id || '',
    })
  } catch (error) {
    showToast(`AI 任务启动失败：${error.message}`)
    return null
  }
  inlineRunId.value = run.id
  inlineRunStatus.value = run.status
  inlineRun.value = run
  inlineDraftDigest.value = request.target?.draftDigest || ''
  if (action.applyDraft || action.onAccepted || action.getDraftDigest || action.getDraftValue) {
    inlineBindings.set(run.id, {
      applyDraft: action.applyDraft,
      onAccepted: action.onAccepted,
      getDraftDigest: action.getDraftDigest,
      getDraftValue: action.getDraftValue,
    })
  }
  inlinePanelOpen.value = true
  const executionLabel = run.executionMode === 'codex' ? (run.modelRoutes?.agentProvider === 'qoder' ? 'Qoder' : 'Codex') : '任务模型'
  const targetKind = run.steps?.[0]?.input?.target?.kind || request.target?.kind || ''
  const scopeLabel = targetKind === 'planning_document_bundle' ? '这一页' : targetKind === 'planning_entity_bundle' ? '这张卡' : targetKind === 'planning_chapter_bundle' ? '这一章规划' : '当前目标'
  const batchLabel = targetKind === 'planning_document_bundle' ? '整页' : targetKind === 'planning_entity_bundle' ? '整卡' : targetKind === 'planning_chapter_bundle' ? '整章规划' : '就地'
  showToast(run.focusedExisting
    ? `已打开${scopeLabel}正在运行的${executionLabel}任务`
    : run.executionMode === 'codex'
      ? `${batchLabel} ${executionLabel} 会话已建立${batchLabel === '就地' ? '' : '，本次调用会一次返回所有字段'}`
      : `${batchLabel}生成已开始${batchLabel === '就地' ? '' : '，本次调用会一次返回所有字段'}`)
  return run
}

function startStoryChange({ target } = {}) {
  if (!target?.kind || !target?.targetId || !target?.fieldKey) {
    showToast('请先保存并选择一项具体设定')
    return
  }
  storyChangeTarget.value = { ...target }
  storyChangeResumeRunId.value = ''
  storyChangeResumeSetId.value = ''
  storyChangeRunStatus.value = ''
  storyChangePanelOpen.value = true
}

function startProjectFieldChange(fieldKey, fieldLabel) {
  const savedValue = String(project[fieldKey] || '')
  const draftValue = String(editProjectDraft[fieldKey] || '')
  if (savedValue !== draftValue) {
    showToast(`“${fieldLabel}”有尚未保存的修改，请先保存项目信息后再联动分析`)
    return
  }
  editProjectOpen.value = false
  startStoryChange({
    target: {
      kind: 'project',
      targetId: project.id,
      fieldKey,
      fieldLabel,
      currentValue: savedValue,
    },
  })
}

function openStoryChangeHistory() {
  if (!storyChangeResumeRunId.value || !['pending', 'waiting_approval', 'running', 'waiting_confirmation', 'paused'].includes(storyChangeRunStatus.value)) {
    storyChangeTarget.value = null
    storyChangeResumeRunId.value = ''
    storyChangeResumeSetId.value = ''
  }
  storyChangePanelOpen.value = true
}

function handleStoryChangeRunUpdated({ run, changeSet } = {}) {
  if (run?.id) storyChangeResumeRunId.value = run.id
  if (changeSet?.id) storyChangeResumeSetId.value = changeSet.id
  storyChangeRunStatus.value = run?.status || changeSet?.status || ''
}

async function refreshWorkspaceAfterStoryChange() {
  const view = workspaceView.value
  const chapterId = activeChapterId.value
  const loaded = await appService.loadWorkspace(project.id)
  applyWorkspace(loaded)
  if (loaded.chapters?.some((chapter) => chapter.id === chapterId)) activeChapterId.value = chapterId
  workspaceView.value = view
  if (['foundation', 'characters', 'world', 'outline'].includes(view)) {
    await planningCenterRef.value?.reload?.()
  }
}

async function handleInlineAccepted({ run, candidate: acceptedCandidate }) {
  const binding = inlineBindings.get(run.id)
  if (acceptedCandidate.artifactType === 'renderer_draft') {
    if (!binding?.applyDraft) {
      showToast('候选已确认；原编辑表单已关闭，请从侧栏复制内容后重新填入')
      return
    }
    binding.applyDraft(acceptedCandidate.payload?.text || '')
    binding.onAccepted?.(acceptedCandidate)
    showToast('Codex 候选已填入编辑器，尚未保存')
    return
  }
  const view = workspaceView.value
  const tab = activeTab.value
  const chapterId = activeChapterId.value
  const loaded = await appService.loadWorkspace(project.id)
  applyWorkspace(loaded)
  if (loaded.chapters.some((item) => item.id === chapterId)) activeChapterId.value = chapterId
  workspaceView.value = view
  activeTab.value = tab
  binding?.onAccepted?.(acceptedCandidate)
  showToast(acceptedCandidate.artifactType === 'planning_document_bundle'
    ? '整页候选已一次写入项目'
    : acceptedCandidate.artifactType === 'planning_entity_bundle'
      ? '整卡候选已一次写入项目'
      : acceptedCandidate.artifactType === 'planning_chapter_bundle'
        ? '整章规划候选已一次写入项目'
      : 'AI 候选已接受并写入项目')
}

function handleInlineRejected({ run }) {
  inlineRunStatus.value = run.status
  inlineRun.value = run
  inlineBindings.delete(run.id)
  showToast('已放弃本次 AI 候选，正式内容保持不变')
}

function handleInlineRunUpdated(run) {
  if (!run) return
  if (run.id !== inlineRunId.value && inlineBindings.has(inlineRunId.value)) {
    inlineBindings.set(run.id, inlineBindings.get(inlineRunId.value))
  }
  inlineRunId.value = run.id
  inlineRunStatus.value = run.status
  inlineRun.value = run
  if (run.status === 'cancelled') inlineBindings.delete(run.id)
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
    const intent = task === 'chapter' ? generationIntent.value : 'draft'
    const insertionOffset = Math.max(0, Math.min(cursorOffset.value, originalManuscript.length))
    if (task === 'chapter') {
      const readiness = await appService.qualityPreflight({ projectId: project.id, chapterId: activeChapter.value.id, intent, cursorOffset: insertionOffset })
      if (readiness.blocked) {
        showToast(`生成已暂停：${readiness.technicalErrors.map((item) => item.detail || item.label).join('；')}`)
        return
      }
      if (readiness.missingCount && !globalThis.confirm(`${readiness.summary}\n\n仍然继续生成正文吗？`)) return
    }
    const result = await executeGeneration({
      task,
      intent,
      cursorOffset: insertionOffset,
      projectId: project.id,
      chapterId: activeChapter.value.id,
      instruction: instruction.value,
      modelProfileId: modelSettings.routes[task],
    })
    if (task === 'chapter_card' || task === 'scene_plan') {
      const isCard = task === 'chapter_card'
      const currentValue = isCard ? JSON.stringify(activeChapter.value.card || {}) : JSON.stringify(activeChapter.value.scenePlan || {})
      const generatedValue = isCard ? JSON.stringify(result.card) : JSON.stringify(result.scenePlan || {})
      const pending = await appService.createPlanningCandidate({
        projectId: project.id,
        targetType: 'chapter',
        targetId: activeChapter.value.id,
        fieldKey: isCard ? 'card' : 'scenePlan',
        fieldLabel: isCard ? '章节卡' : '场景计划',
        originalValue: currentValue,
        candidateValue: generatedValue,
        instruction: instruction.value,
        model: result.model,
      })
      candidate.original = isCard ? JSON.stringify(activeChapter.value.card || {}, null, 2) : JSON.stringify(activeChapter.value.scenePlan || {}, null, 2)
      candidate.content = isCard ? JSON.stringify(result.card, null, 2) : JSON.stringify(result.scenePlan || {}, null, 2)
      candidate.title = isCard ? '章节卡候选' : '场景计划候选'
      candidate.subtitle = `生成来源：${executionLabel(result)}。确认后才会替换当前${isCard ? '章节卡' : '场景计划'}。`
      candidate.hint = `候选尚未写入${isCard ? '章节卡' : '场景计划'}，接受后才会成为正式规划。`
      candidate.language = 'json'
      candidate.task = task
      candidate.candidateId = pending.id
      candidate.targetTab = isCard ? 'card' : 'scene'
      candidate.visible = true
      showToast(`${isCard ? '章节卡' : '场景计划'}候选已生成，请确认差异`)
    } else if (task === 'chapter') {
      activeTab.value = 'manuscript'
      candidate.original = originalManuscript
      candidate.content = composeGenerationCandidate({ intent, original: originalManuscript, generated: result.manuscript || '', cursorOffset: insertionOffset })
      candidate.title = `${generationIntentLabel.value}候选稿`
      candidate.subtitle = `生成来源：${executionLabel(result)}。${intent === 'continue' ? '接受后会插入光标位置，并保留光标后的原文。' : '请在差异视图中确认后再写入正文。'}`
      candidate.hint = '候选稿尚未写入正文，接受后才会保存为新版本。'
      candidate.language = 'markdown'
      candidate.task = 'chapter'
      candidate.candidateId = ''
      candidate.targetTab = 'manuscript'
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
  if (event.type === 'retrying') {
    streamPreview.status = `第 ${event.attempt} 次请求暂未成功，${event.delayMs} ms 后自动重试…`
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
  cursorOffset.value = Number(selection.to || 0)
  if (selection.source === 'search') {
    selectionTools.visible = false
    return
  }
  selectionTools.text = selection.text || ''
  selectionTools.from = selection.from
  selectionTools.to = selection.to
  selectionTools.left = selection.coords ? (selection.coords.left + selection.coords.right) / 2 : 0
  selectionTools.top = selection.coords?.top || 0
  selectionTools.bottom = selection.coords?.bottom || 0
  selectionTools.visible = Boolean(selection.text && selection.to > selection.from)
  if (selectionTools.visible) selectionExecutionMode.value = defaultExecutionMode.value
}

function closeSelectionTools() {
  if (!selectionTools.visible) return
  selectionTools.visible = false
}

async function rewriteSelection(preset, executionMode = defaultExecutionMode.value) {
  if (!selectionTools.text || !activeChapter.value || runningTask.value || selectionPreview.visible) return
  const { from, to, text } = selectionTools
  const originalDocument = editorText.value
  const mode = preset?.id || String(preset || 'general')
  const modeLabel = preset?.name || String(preset || '局部重写')
  if (executionMode === 'codex') {
    try {
      await saveManuscript({ createRevision: true, source: 'before-codex-inline-rewrite', forceRevision: true })
      await startInlineCodex({
        request: {
          projectId: project.id,
          chapterId: activeChapter.value.id,
          task: 'rewrite',
          intent: 'rewrite',
          target: {
            kind: 'manuscript_selection', targetId: activeChapter.value.id,
            selectionFrom: from, selectionTo: to, fieldLabel: modeLabel, promptProfile: mode,
          },
          instruction: [instruction.value, `局部重写方式：${modeLabel}`].filter(Boolean).join('\n'),
        },
      })
      selectionTools.visible = false
    } catch (error) {
      showToast(`Codex 局部重写启动失败：${error.message}`)
    }
    return
  }
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
    selectionPreview.mode = modeLabel
    selectionPreview.originalDocument = originalDocument
    selectionPreview.originalText = text
    selectionPreview.replacementText = result.text || ''
    editorText.value = originalDocument.slice(0, from) + selectionPreview.replacementText + originalDocument.slice(to)
    selectionPreview.visible = true
    selectionTools.visible = false
    showToast(`${modeLabel}候选已生成，请接受或撤销 · ${executionLabel(result)}`)
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
  if (candidate.candidateId) {
    try {
      await appService.resolvePlanningCandidate({ candidateId: candidate.candidateId, decision: 'accepted' })
      const loaded = await appService.loadWorkspace(project.id)
      const updated = loaded.chapters.find((chapter) => chapter.id === activeChapter.value.id)
      replaceChapter(updated)
      activeTab.value = candidate.targetTab
      const label = candidate.task === 'chapter_card' ? '章节卡' : '场景计划'
      candidate.visible = false
      candidate.candidateId = ''
      showToast(`${label}候选已接受`)
    } catch (error) {
      showToast(`接受候选失败：${error.message}`)
    }
    return
  }
  editorText.value = candidate.content
  try {
    await saveManuscript({ createRevision: true, source: 'ai-generation-accepted', forceRevision: true })
    candidate.visible = false
    showToast('正文候选稿已接受并保存为新版本')
  } catch {
    // Keep the candidate context in place; saveState already exposes the failure.
  }
}

async function discardCandidate() {
  if (candidate.candidateId) {
    try {
      await appService.resolvePlanningCandidate({ candidateId: candidate.candidateId, decision: 'discarded' })
    } catch (error) {
      showToast(`放弃候选失败：${error.message}`)
      return
    }
  }
  candidate.visible = false
  const label = candidate.task === 'chapter_card' ? '章节卡' : candidate.task === 'scene_plan' ? '场景计划' : '正文'
  candidate.candidateId = ''
  showToast(`已放弃${label}候选，原稿保持不变`)
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
    await flushPlanningMemory()
    if (candidate.visible) await discardCandidate()
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
  generationHistoryOpen.value = false
  Object.assign(modelProfileSaveState, { state: 'idle', message: '' })
  settingsOpen.value = true
}

async function openGenerationHistory() {
  if (!project.id) return
  try {
    await flushPlanningMemory()
    if (workspaceView.value === 'writing') await saveManuscript({ createRevision: false, source: 'generation-history-open' })
    settingsOpen.value = false
    generationHistoryOpen.value = true
    await refreshGenerationHistory()
  } catch (error) {
    showToast(`打开生成记录失败：${error.message}`)
  }
}

async function refreshGenerationHistory() {
  if (!project.id || generationHistoryLoading.value) return
  generationHistoryLoading.value = true
  try {
    generationRecords.value = await appService.listGenerationRecords({ projectId: project.id, limit: 150 })
  } catch (error) {
    showToast(`读取生成记录失败：${error.message}`)
  } finally {
    generationHistoryLoading.value = false
  }
}

function planningSection(sectionLabel = '') {
  return { '故事基础': 'foundation', '人物与关系': 'characters', '世界观': 'world', '结构规划': 'outline' }[sectionLabel] || 'foundation'
}

function currentPlanningValue(center, planning = {}) {
  if (planning.targetType === 'document') return String(center.documents?.[planning.targetId]?.content?.[planning.fieldKey] ?? '')
  if (planning.targetType === 'entity') {
    const entity = [...(center.characters || []), ...(center.worldElements || []), ...(center.volumes || [])].find((item) => item.id === planning.targetId)
    return planning.fieldKey === 'title' ? String(entity?.title || '') : String(entity?.data?.[planning.fieldKey] ?? '')
  }
  const chapter = (center.chapters || []).find((item) => item.id === planning.targetId)
  if (planning.fieldKey === 'title') return String(chapter?.title || '')
  if (planning.fieldKey === 'card') return JSON.stringify(chapter?.card || {})
  if (planning.fieldKey === 'scenePlan') return String(chapter?.scenePlan || '')
  return String(chapter?.card?.[planning.fieldKey] ?? '')
}

async function presentRetriedGeneration(record, result) {
  const request = record.request || {}
  if (record.task === 'chapter') {
    const target = chapters.value.find((chapter) => chapter.id === request.chapterId) || activeChapter.value
    activeChapterId.value = target.id
    workspaceView.value = 'writing'
    activeTab.value = 'manuscript'
    candidate.original = target.manuscript || ''
    candidate.content = result.manuscript || ''
    candidate.title = '重试生成的正文候选稿'
    candidate.subtitle = `生成来源：${executionLabel(result)}。确认后才会写入第 ${target.chapter_no} 章。`
    candidate.hint = '重试不会覆盖原稿；请在差异视图中决定是否接受。'
    candidate.language = 'markdown'
    candidate.task = 'chapter'
    candidate.candidateId = ''
    candidate.targetTab = 'manuscript'
    candidate.visible = true
    generationHistoryOpen.value = false
    return
  }
  if (record.task === 'chapter_card' || record.task === 'scene_plan') {
    const target = chapters.value.find((chapter) => chapter.id === request.chapterId) || activeChapter.value
    const isCard = record.task === 'chapter_card'
    const originalValue = isCard ? JSON.stringify(target.card || {}) : target.scene_plan || ''
    const generatedValue = isCard ? JSON.stringify(result.card || {}) : result.scenePlan || ''
    const pending = await appService.createPlanningCandidate({
      projectId: project.id, targetType: 'chapter', targetId: target.id,
      fieldKey: isCard ? 'card' : 'scenePlan', fieldLabel: isCard ? '章节卡' : '场景计划',
      originalValue, candidateValue: generatedValue, instruction: request.instruction || '', model: result.model || {},
    })
    activeChapterId.value = target.id
    workspaceView.value = 'writing'
    activeTab.value = isCard ? 'card' : 'scene'
    Object.assign(candidate, {
      original: isCard ? JSON.stringify(target.card || {}, null, 2) : target.scene_plan || '',
      content: isCard ? JSON.stringify(result.card || {}, null, 2) : result.scenePlan || '',
      title: `${isCard ? '章节卡' : '场景计划'}重试候选`,
      subtitle: `生成来源：${executionLabel(result)}。确认后才会替换当前规划。`,
      hint: '候选尚未写入，接受前可以逐行检查差异。', language: isCard ? 'json' : 'markdown',
      task: record.task, candidateId: pending.id, targetTab: isCard ? 'card' : 'scene', visible: true,
    })
    generationHistoryOpen.value = false
    return
  }
  if (record.task === 'planning_field') {
    const planning = request.planning || {}
    if (!planning.targetType || !planning.targetId) throw new Error('这条旧规划记录缺少候选目标信息，请在规划页重新生成')
    const center = await appService.loadPlanningCenter(project.id)
    await appService.createPlanningCandidate({
      projectId: project.id, targetType: planning.targetType, targetId: planning.targetId,
      fieldKey: planning.fieldKey, fieldLabel: planning.fieldLabel,
      originalValue: currentPlanningValue(center, planning), candidateValue: result.text || '',
      instruction: request.instruction || '', model: result.model || {},
    })
    generationHistoryOpen.value = false
    workspaceView.value = planningSection(planning.sectionLabel)
    showToast(`${planning.fieldLabel || '规划'}重试候选已放入规划中心`)
    return
  }
  if (record.task === 'chapter_state_extract' || record.task === 'continuity_audit') {
    await appService.createKnowledgeCandidate({
      projectId: project.id, chapterId: request.chapterId, task: record.task,
      payload: record.task === 'chapter_state_extract' ? result.stateSnapshot : result.audit,
      model: result.model || {},
    })
    generationHistoryOpen.value = false
    workspaceView.value = 'knowledge'
    showToast(record.task === 'chapter_state_extract' ? '章后状态重试候选已放入知识中心' : '连续性审计重试候选已放入知识中心')
  }
}

async function retryGenerationRecord(record) {
  if (runningTask.value || retryingRecordId.value) return
  retryingRecordId.value = record.id
  runningTask.value = `retry:${record.task}`
  streamPreview.visible = true
  streamPreview.task = record.task
  streamPreview.status = '正在按原任务参数重新生成…'
  streamPreview.content = ''
  streamPreview.gateway = runtime.mode === 'go-service' ? 'go-service' : 'embedded'
  const generation = appService.retryGeneration(record.id, handleGenerationEvent)
  activeGeneration = generation
  try {
    const result = await generation.promise
    await presentRetriedGeneration(record, result)
    await refreshGenerationHistory()
    showToast('重试生成完成，已建立新的候选稿')
  } catch (error) {
    showToast(generationErrorMessage(error, '重试生成失败'))
    await refreshGenerationHistory()
  } finally {
    if (activeGeneration?.taskId === generation.taskId) activeGeneration = null
    streamPreview.visible = false
    generationCancelPending.value = false
    retryingRecordId.value = ''
    runningTask.value = ''
  }
}

async function refreshModelSettings() {
  const loaded = await appService.loadModelSettings()
  modelSettings.profiles = loaded.profiles
  modelSettings.routes = loaded.routes
}

async function saveModelProfile(profile) {
  Object.assign(modelProfileSaveState, { state: 'saving', message: '正在安全保存模型配置…' })
  try {
    await appService.saveModelProfile(profile)
    await refreshModelSettings()
    Object.assign(modelProfileSaveState, { state: 'success', message: '配置已保存，密钥与能力探测结果已更新。' })
    showToast('模型配置已保存')
  } catch (error) {
    Object.assign(modelProfileSaveState, { state: 'error', message: `保存失败：${error.message}` })
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
