<template>
  <aside v-if="visible" class="inline-codex-panel" :class="{ 'is-minimized': minimized }" aria-label="AI 就地创作">
    <header class="inline-panel-head">
      <div><span class="panel-kicker">{{ panelKicker }}</span><h2>{{ targetLabel }}</h2></div>
      <div class="inline-panel-window-actions">
        <button
          v-if="!minimized"
          type="button"
          aria-label="缩小 AI 候选窗口"
          title="缩小窗口"
          @click="minimized = true"
        >−</button>
        <button
          v-else
          type="button"
          aria-label="展开 AI 候选窗口"
          title="展开窗口"
          @click="minimized = false"
        >□</button>
        <button type="button" aria-label="关闭 AI 候选窗口" title="关闭窗口" @click="emit('close')">×</button>
      </div>
    </header>

    <div v-if="minimized" class="inline-minimized-status">
      <span :class="`state-dot state-${run?.status || 'pending'}`"></span>
      <strong>{{ run ? statusLabel(run.status) : '正在读取状态' }}</strong>
      <span>{{ backendLabel }}</span>
      <button type="button" @click="minimized = false">查看候选</button>
    </div>

    <div v-else-if="loading" class="inline-panel-empty">正在读取运行状态…</div>
    <template v-else-if="run">
      <section class="inline-run-meta">
        <div><span>模型</span><strong>{{ modelLabel }}</strong></div>
        <div><span>后端</span><strong>{{ backendLabel }}</strong></div>
        <div><span>状态</span><strong :class="`state-${run.status}`">{{ statusLabel(run.status) }}</strong></div>
        <div><span>推理</span><strong>{{ run.modelRoutes?.codexReasoningEffort || 'high' }}</strong></div>
      </section>

      <div v-if="run.actualBackend === 'codex_exec'" class="inline-panel-notice">ACP 在首个输出前中断，本次使用只读 exec 兼容模式。</div>
      <div v-if="run.executionMode === 'codex' && sessionModelApprovalEnabled" class="inline-panel-notice">本项目模型调用已获本次应用会话授权；工具操作与正式写入仍需确认。</div>
      <div v-if="run.error || actionError" class="inline-panel-error">{{ actionError || run.error }}</div>

      <section v-if="pendingApproval" class="inline-approval">
        <span class="panel-kicker">APPROVAL</span>
        <h3>{{ pendingApproval.permission }}</h3>
        <pre>{{ JSON.stringify(pendingApproval.payload || {}, null, 2) }}</pre>
        <p v-if="pendingApproval.actionType === 'model_call'" class="approval-scope-note">会话免审只覆盖当前项目的模型调用，应用退出后自动失效。</p>
        <div><button type="button" @click="resolveApproval(false)">拒绝</button><button type="button" class="accent" @click="resolveApproval(true)">仅批准本次</button><button v-if="pendingApproval.actionType === 'model_call'" type="button" class="accent session" @click="approveProjectSession">本项目会话免审</button></div>
      </section>

      <details class="inline-trace">
        <summary><span>技术运行信息</span><small>{{ tokenUsage }}</small></summary>
        <div v-if="!trace.length" class="inline-panel-empty">等待状态更新…</div>
        <article v-for="event in trace" :key="`${event.sequence}-${event.type}`">
          <span>{{ eventLabel(event.type) }}</span>
          <p>{{ eventText(event) }}</p>
        </article>
      </details>

      <nav v-if="showConversation" class="inline-mobile-tabs" aria-label="创作工作区">
        <button type="button" :aria-pressed="mobileView === 'candidate'" @click="mobileView = 'candidate'">候选内容</button>
        <button type="button" :aria-pressed="mobileView === 'conversation'" @click="mobileView = 'conversation'; conversationCollapsed = false">创作对话</button>
      </nav>
      <div class="inline-workbench" :class="{ 'has-conversation': showConversation && !conversationCollapsed, 'chat-collapsed': showConversation && conversationCollapsed, 'mobile-conversation': mobileView === 'conversation' && showConversation }">
      <section
        v-if="streaming"
        ref="streamingCandidateElement"
        class="inline-candidate inline-streaming-candidate"
        aria-busy="true"
        @scroll="handleStreamingScroll"
      >
        <div class="inline-section-title candidate-version-head">
          <span>{{ streamingHeading }}</span>
          <small class="streaming-state"><i></i>{{ streamingAttempt > 1 ? `第 ${streamingAttempt}/3 次` : '实时输出' }}</small>
        </div>
        <div v-if="streamingText" class="inline-candidate-text inline-streaming-text">{{ streamingText }}</div>
        <div v-else class="inline-streaming-empty"><span></span>等待模型开始输出…</div>
      </section>

      <section v-else-if="selectedCandidate" class="inline-candidate" :class="{ 'is-manuscript': candidateIsManuscript }">
        <div class="inline-section-title candidate-version-head">
          <span>{{ candidateHeading }}</span>
          <label v-if="candidateOptions.length > 1">
            <span>查看版本</span>
            <select v-model="selectedCandidateId">
              <option v-for="option in candidateOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <small v-else>{{ candidateTypeLabel }}</small>
        </div>
        <div class="candidate-view-tools">
          <div v-if="candidateIsManuscript && !authorEditing" class="candidate-view-switch" aria-label="正文预览方式">
            <button type="button" :aria-pressed="manuscriptView === 'reading'" @click="manuscriptView = 'reading'">阅读</button>
            <button type="button" :aria-pressed="manuscriptView === 'diff'" @click="manuscriptView = 'diff'">差异对比</button>
          </div>
          <button v-if="['pending','accepted'].includes(selectedCandidate.status) && !candidateIsChapterCard" type="button" @click="toggleAuthorEditor">{{ authorEditing ? '对照原候选' : selectedCandidate.status === 'accepted' ? '作者修订' : '手动编辑' }}</button>
        </div>
        <details v-if="selectedCandidate.evidence?.localCheck?.findings?.length" class="local-checks"><summary>本地编辑提醒 · {{ selectedCandidate.evidence.localCheck.hanCount }} 中文字</summary><p v-for="(finding,index) in selectedCandidate.evidence.localCheck.findings" :key="index">{{ finding.reason }}</p></details>
        <div class="inline-candidate-preview" :class="{ 'is-diff': candidateIsManuscript && manuscriptView === 'diff' && !authorEditing }" tabindex="0" aria-label="候选内容预览">
          <CreativeCandidateEditor v-if="authorEditing && authorDraft" v-model="authorDraft" />
          <div v-else-if="candidateIsPlanningBundle" class="planning-bundle-candidate">
            <div class="bundle-candidate-toolbar">
              <p>一次调用生成了 {{ bundleFields.length }} 个字段。取消勾选的字段不会写入项目。</p>
              <div><button type="button" @click="selectAllBundleFields">全选</button><button type="button" @click="clearBundleFields">全不选</button></div>
            </div>
            <label v-for="field in bundleFields" :key="field.key" class="bundle-field" :class="{ selected: bundleSelectedKeys.includes(field.key) }">
              <input v-model="bundleSelectedKeys" type="checkbox" :value="field.key" />
              <span class="bundle-field-copy">
                <strong>{{ field.label }}</strong>
                <small v-if="field.originalValue">当前：{{ field.originalValue }}</small>
                <span>{{ field.candidateValue }}</span>
              </span>
            </label>
          </div>
          <div v-else-if="chapterCardPreview" class="chapter-card-candidate">
            <div class="bundle-candidate-toolbar">
              <span>章节卡约 {{ JSON.stringify(chapterCardDraft || selectedCandidate.payload).length }} 字符；约2000字正文建议300—600字，仅作参考。</span>
              <button type="button" @click="cardDetails = !cardDetails">{{ cardDetails ? '精简视图' : '展开详细规划' }}</button>
            </div>
            <header class="chapter-card-intro">
              <div>
                <span>CHAPTER CONTRACT</span>
                <h3>这一章要如何成立</h3>
              </div>
              <div class="chapter-card-intro-actions">
                <p v-if="chapterCardIssues.length">{{ chapterCardIssues[0] }}<template v-if="chapterCardIssues.length > 1">，另有 {{ chapterCardIssues.length - 1 }} 项待补充</template>。</p>
                <p v-else>{{ chapterCardDirty ? '手动修改尚未保存。' : '章节合同完整。先看变化、阻力和章末落点，再决定是否接受。' }}</p>
                <button v-if="chapterCardCanEdit" type="button" :disabled="busy" @click="chapterCardEditing = !chapterCardEditing">
                  {{ chapterCardEditing ? '完成编辑' : '编辑章节卡' }}
                </button>
              </div>
            </header>

            <div class="chapter-contract-fields" aria-label="章节合同内容">
              <article
                v-for="field in chapterCardPreview.fields.filter(item => cardDetails || chapterCardEditing || ['goal','protagonistGoal','resistance','ending'].includes(item.key))"
                :key="field.key"
                class="chapter-contract-field"
                :class="[`is-${field.emphasis || 'standard'}`, { 'is-missing': field.missing }]"
              >
                <header>
                  <span>{{ field.label }}</span>
                  <small>{{ field.hint }}</small>
                </header>
                <textarea
                  v-if="chapterCardEditing"
                  v-model="chapterCardDraft[field.key]"
                  :aria-label="field.label"
                  rows="3"
                  :placeholder="field.hint"
                  :disabled="busy"
                ></textarea>
                <p v-else>{{ field.value || '尚未生成' }}</p>
              </article>
            </div>

            <label v-if="chapterCardEditing">章末边界 <select v-model="chapterCardDraft.boundaryMode"><option value="semantic">约束事件与结束状态</option><option value="exact">指定原句，严格匹配</option></select></label>
            <section v-if="cardDetails || chapterCardEditing" class="chapter-scenes" aria-labelledby="chapter-scenes-heading">
              <header>
                <div><span>SCENE ROUTE</span><h3 id="chapter-scenes-heading">必要场景</h3></div>
                <small>{{ chapterCardPreview.scenes.length }} 个</small>
              </header>
              <div v-if="chapterCardPreview.scenes.length" class="chapter-scene-list">
                <article v-for="(scene, index) in chapterCardPreview.scenes" :key="`${scene.id}-${index}`" :class="{ 'is-missing': scene.missing }">
                  <span class="scene-number">{{ String(index + 1).padStart(2, '0') }}</span>
                  <div class="scene-copy">
                    <header>
                      <input
                        v-if="chapterCardEditing"
                        v-model="chapterCardDraft.requiredScenes[index].title"
                        :aria-label="`必要场景 ${index + 1} 名称`"
                        placeholder="场景名称"
                        :disabled="busy"
                      />
                      <h4 v-else>{{ scene.title }}</h4>
                      <small>{{ scene.id }}</small>
                      <button v-if="chapterCardEditing" type="button" :disabled="busy" @click="removeChapterScene(index)">删除场景</button>
                    </header>
                    <dl>
                      <div>
                        <dt>场景任务</dt>
                        <dd><textarea v-if="chapterCardEditing" v-model="chapterCardDraft.requiredScenes[index].goal" rows="2" :aria-label="`必要场景 ${index + 1} 任务`" placeholder="这个场景要完成什么" :disabled="busy"></textarea><template v-else>{{ scene.goal || '尚未生成' }}</template></dd>
                      </div>
                      <div>
                        <dt>离场结果</dt>
                        <dd><textarea v-if="chapterCardEditing" v-model="chapterCardDraft.requiredScenes[index].result" rows="2" :aria-label="`必要场景 ${index + 1} 离场结果`" placeholder="场景结束后发生了什么变化" :disabled="busy"></textarea><template v-else>{{ scene.result || '尚未生成' }}</template></dd>
                      </div>
                    </dl>
                  </div>
                </article>
              </div>
              <p v-else class="chapter-scenes-empty">还没有必要场景。章节卡至少需要一个能够改变局面的场景。</p>
              <button v-if="chapterCardEditing" type="button" class="chapter-scene-add" :disabled="busy || chapterCardPreview.scenes.length >= 6" @click="addChapterScene">
                {{ chapterCardPreview.scenes.length >= 6 ? '最多保留 6 个必要场景' : '＋ 添加必要场景' }}
              </button>
            </section>

            <div v-if="chapterCardDirty" class="chapter-card-edit-state" role="status">
              <div><strong>有未保存的手动修改</strong><span>{{ chapterCardIssues.length ? '补全必填内容后即可保存。' : '保存后会作为这一版章节卡的正式内容。' }}</span></div>
              <button type="button" :disabled="busy" @click="resetChapterCardChanges">撤销手动修改</button>
            </div>

            <details class="chapter-card-raw">
              <summary>查看技术数据 <span>会同步反映上方手动修改</span></summary>
              <pre>{{ JSON.stringify(chapterCardPreview.card, null, 2) }}</pre>
            </details>
          </div>
          <div v-else-if="candidateIsChapterCard" class="chapter-card-invalid" role="status">
            <strong>这份章节卡没有形成可读的结构</strong>
            <p>可以在下方要求 Codex 重新整理；原始内容仍保留，方便排查。</p>
            <pre>{{ JSON.stringify(pendingCandidate.payload || {}, null, 2) }}</pre>
          </div>
          <InlineManuscriptDiff v-else-if="candidateIsManuscript && manuscriptView === 'diff'" :original="sourceManuscript" :candidate="composedManuscript" />
          <div v-else-if="candidateIsManuscript" class="inline-manuscript-reading">{{ composedManuscript }}</div>
          <pre v-else-if="candidateIsJson">{{ JSON.stringify(pendingCandidate.payload || {}, null, 2) }}</pre>
          <div v-else class="inline-candidate-text">{{ candidateText }}</div>
        </div>
        <div class="candidate-decision-dock">
        <p v-if="authorDraftDirty" class="draft-note">手动修改尚未确认{{ authorEditing ? '，确认时将保存你的编辑。' : '；上方是原候选，确认时将保存你的编辑。' }}<button type="button" class="discard-author-draft" @click="resetAuthorDraft">撤销手动修改</button></p>
        <p v-if="selectedCandidate.artifactType === 'renderer_draft'" class="draft-note">接受后只填入当前编辑器，仍需点击原表单的保存按钮。</p>
        <p v-if="candidateIsStale" class="draft-note">{{ selectedCandidate.overrideReason || '这份候选已被更新版本替代，只可查看或继续修改。' }}</p>
        <p v-else-if="selectedCandidate.status === 'accepted'" class="draft-note accepted">{{ chapterCardDirty ? '当前手动修改还没有写入项目。' : '这一版已经写入项目；可以手动编辑，也可以在下方继续要求 Codex 修改。' }}</p>
        <label v-if="candidateCanResolve" class="candidate-note"><span>备注（可选）</span><input v-model.trim="reason" placeholder="记录接受或放弃的原因" /></label>
        <div v-if="candidateCanResolve" class="inline-candidate-actions">
          <button type="button" :disabled="busy" @click="rejectCandidate">放弃</button>
          <button type="button" class="accent" :disabled="busy || !candidateCanAccept" @click="acceptCandidate">{{ busy ? '处理中…' : candidateIsPlanningBundle ? `接受已选 ${bundleSelectedKeys.length} 项` : candidateIsChapterCard && chapterCardDirty ? '保存手改并接受' : '接受候选' }}</button>
        </div>
        <div v-else-if="chapterCardCanSaveAccepted" class="inline-candidate-actions">
          <button type="button" class="accent" :disabled="busy || chapterCardIssues.length > 0" @click="saveAcceptedChapterCard">{{ busy ? '保存中…' : '保存手动修改' }}</button>
        </div>
        <div v-if="selectedCandidate.status === 'accepted' && authorEditing && !candidateIsChapterCard" class="inline-candidate-actions"><button class="accent" :disabled="busy" @click="saveAuthorRevision">保存为作者修订版</button></div>
        </div>
      </section>

      <section v-if="showConversation" class="inline-conversation" :class="{ 'is-collapsed': conversationCollapsed }" aria-label="候选修改对话">
        <header class="conversation-head">
          <div>
            <span class="conversation-eyebrow">创作对话</span>
            <strong>{{ conversationScopeLabel }}</strong>
          </div>
          <div class="conversation-head-actions">
            <button
              type="button"
              class="conversation-collapse-toggle"
              :aria-expanded="!conversationCollapsed"
              @click="conversationCollapsed = !conversationCollapsed; if (conversationCollapsed) mobileView = 'candidate'"
            >{{ conversationCollapsed ? '展开对话' : '收起对话' }}</button>
          </div>
        </header>

        <div v-if="!conversationCollapsed" ref="conversationThreadElement" class="conversation-thread" aria-live="polite">
          <details class="conversation-options">
            <summary>{{ run.connectionReleasedAt || run.session?.status === 'closed' ? '连接已释放 · 发送时续接' : '同一创作对话' }} · 对话选项</summary>
            <p>{{ conversationReuseNote }}</p>
            <button type="button" :disabled="conversationBusy" @click="restartWithCurrentModel">使用新模型完全重新开始</button>
          </details>
          <article
            v-for="message in conversationMessages"
            :key="message.id"
            class="conversation-message"
            :class="[`is-${message.role}`, { 'is-working': message.kind === 'working' }]"
          >
            <span class="conversation-avatar" aria-hidden="true">{{ message.role === 'author' ? '你' : 'CX' }}</span>
            <div class="conversation-bubble">
              <header>
                <strong>{{ message.role === 'author' ? '你' : 'Codex' }}</strong>
                <small v-if="message.role === 'author' && message.parentVersion">基于第 {{ message.parentVersion }} 版</small>
                <small v-else>{{ message.title }}</small>
              </header>
              <p>{{ message.text }}</p>
              <button
                v-if="message.candidateId"
                type="button"
                :class="{ active: selectedCandidateId === message.candidateId }"
                @click="selectConversationCandidate(message.candidateId); mobileView = 'candidate'"
              >{{ selectedCandidateId === message.candidateId ? '正在查看这一版' : `查看第 ${message.version} 版` }}</button>
            </div>
          </article>
          <article v-for="message in discussionMessages" :key="message.id" class="conversation-bubble discussion-message">
            <strong>{{ message.role === 'user' ? '你 · 讨论' : 'Codex · 方案' }}</strong><p>{{ message.content }}</p>
            <button v-if="message.role === 'assistant'" type="button" @click="conversationMode = 'modify'; followupInstruction = '按此方案修改：\n' + message.content">按此方案修改</button>
          </article>
          <details v-if="candidateIsManuscript" class="protection-editor" @toggle="loadProtections">
            <summary>选择修改范围 / 保留这段</summary>
            <textarea :value="candidateText" readonly rows="7" aria-label="选择正文范围" @select="selectSource" />
            <button type="button" :disabled="selection.to <= selection.from" @click="modificationScope = 'selection'">仅修改选区</button>
            <button type="button" :disabled="selection.to <= selection.from" @click="protectSelection">保留这段</button>
            <p v-for="item in protectedPassages" :key="item.id">{{ item.text }} <button type="button" @click="removeProtection(item)">取消保护</button></p>
          </details>
        </div>

        <div v-if="!conversationCollapsed && canContinueConversation" class="conversation-composer">
          <div class="conversation-shortcuts">
            <label>本轮 <select v-model="conversationMode" :disabled="conversationBusy"><option value="modify">修改</option><option value="discuss">讨论（不替换内容）</option></select></label>
            <label v-if="candidateIsManuscript && conversationMode === 'modify'">范围 <select v-model="modificationScope" :disabled="conversationBusy"><option value="related">相关句段</option><option value="selection" :disabled="selection.to <= selection.from">当前选区</option><option value="scene" :disabled="selection.to <= selection.from">已圈选场景</option><option value="whole">整章重构</option></select></label>
          </div>
          <div class="conversation-shortcuts" aria-label="常用修改要求">
            <button
              v-for="item in quickInstructions"
              :key="item.label"
              type="button"
              :disabled="conversationBusy"
              @click="appendQuickInstruction(item.prompt)"
            >{{ item.label }}</button>
          </div>
          <label class="conversation-input">
            <span class="sr-only">告诉 Codex 希望怎样修改当前候选</span>
            <textarea
              v-model.trim="followupInstruction"
              rows="3"
              :disabled="conversationBusy"
              :placeholder="conversationPlaceholder"
              @keydown.meta.enter.prevent="submitRevision"
              @keydown.ctrl.enter.prevent="submitRevision"
            ></textarea>
            <small>{{ conversationMode === 'discuss' ? '只讨论，保留当前候选' : modificationScope === 'whole' && candidateIsManuscript ? '范围：整章重构，确认后才写入' : '仅修改相关内容，保留完整预览' }} · 第 {{ selectedCandidateVersion }} 版 · ⌘/Ctrl + Enter</small>
            <button type="button" class="accent" :disabled="conversationBusy || !followupInstruction" @click="submitRevision">
              {{ conversationBusy ? 'Codex 正在处理…' : conversationMode === 'discuss' ? '发送讨论' : '发送修改要求' }}
            </button>
          </label>
        </div>
        <p v-else-if="!conversationCollapsed" class="conversation-closed-note">{{ conversationBusy ? '正在处理本轮要求，完成后可继续讨论或修改。' : '这次对话已结束，历史版本仍会保留。需要继续修改时，从当前创作位置重新发起。' }}</p>
      </section>
      </div>

      <footer class="inline-panel-footer">
        <small>关闭窗口只隐藏面板，任务和历史会保留。</small>
        <button v-if="['running','waiting_approval'].includes(run.status)" type="button" @click="pause">暂停</button>
        <button v-if="run.status === 'paused'" type="button" @click="resume">恢复</button>
        <button v-if="retryableStep" type="button" @click="retry">重试步骤</button>
        <button v-if="canFinishConversation" type="button" @click="finishConversation">结束本次连接</button>
        <button v-if="!['completed','cancelled'].includes(run.status) && !canFinishConversation" type="button" class="danger" @click="cancel">取消运行</button>
      </footer>
    </template>
    <div v-else class="inline-panel-empty">这次就地任务还没有运行记录。</div>
  </aside>
</template>

<script setup>
import CreativeCandidateEditor from './CreativeCandidateEditor.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { appendCodexStream, nextCodexStreamLength, recoverCodexStream, recoverCodexStreamAttempt, visibleCodexStream } from '../utils/codex-stream.js'
import { chapterCardEditIssues, chapterCardPresentation, composeInlineManuscriptCandidate, draftDigest } from '../utils/inline-creative.js'
import {
  buildInlineConversation,
  defaultInlineConversationCollapsed,
  inlineConversationScope,
  inlineConversationReuseNote as conversationReuseCopy,
} from '../utils/inline-conversation.js'
import InlineManuscriptDiff from './InlineManuscriptDiff.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  runId: { type: String, default: '' },
  currentDraftDigest: { type: String, default: '' },
  currentDraftValue: { type: String, default: undefined },
  sourceManuscript: { type: String, default: '' },
  currentChapterCard: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'accepted', 'rejected', 'updated'])
const run = ref(null)
const loading = ref(false)
const busy = ref(false)
const reason = ref('')
const followupInstruction = ref('')
const conversationMode = ref('modify')
const modificationScope = ref('related')
const selection = ref({ from: 0, to: 0 })
const protectedPassages = ref([])
function selectSource(event) { selection.value = { from: event.target.selectionStart, to: event.target.selectionEnd } }
async function loadProtections() {
  if (!candidateIsManuscript.value) return
  try { protectedPassages.value = await appService.listProtections({ projectId: run.value.projectId, chapterId: run.value.chapterId, candidateId: selectedCandidate.value.id }) } catch (e) { actionError.value = e.message }
}
async function protectSelection() {
  try { await appService.protectText({ projectId: run.value.projectId, chapterId: run.value.chapterId, candidateId: selectedCandidate.value.id, ...selection.value }); await loadProtections() } catch (e) { actionError.value = e.message }
}
async function removeProtection(item) {
  try { await appService.protectText({ projectId: run.value.projectId, id: item.id, action: 'remove' }); await loadProtections() } catch (e) { actionError.value = e.message }
}
const discussionMessages = computed(() => (run.value?.messages || []).filter(item => item.mode === 'discuss'))
const selectedCandidateId = ref('')
const bundleSelectedKeys = ref([])
const actionError = ref('')
const sessionModelApprovalEnabled = ref(false)
const minimized = ref(false)
const mobileView = ref('candidate')
const manuscriptView = ref('reading')
const streaming = ref(false)
const streamingSource = ref('')
const streamingOutput = ref('')
const streamingStepId = ref('')
const streamingAttempt = ref(1)
const streamingCandidateElement = ref(null)
const conversationThreadElement = ref(null)
const conversationCollapsed = ref(false)
const chapterCardEditing = ref(false)
const cardDetails = ref(false)
const chapterCardDraft = ref(null)
const chapterCardOriginal = ref(null)
const authorEditing = ref(false)
const authorDraft = ref(null)
const authorDraftId = ref('')
const authorDraftDirty = computed(() => Boolean(authorDraftId.value === selectedCandidate.value?.id && authorDraft.value && draftDigest(authorDraft.value) !== draftDigest(selectedCandidate.value.payload)))
function resetAuthorDraft() { authorDraft.value = JSON.parse(JSON.stringify(selectedCandidate.value.payload)) }
function toggleAuthorEditor() {
  if (authorDraftId.value !== selectedCandidate.value.id) {
    authorDraft.value = JSON.parse(JSON.stringify(selectedCandidate.value.payload))
    authorDraftId.value = selectedCandidate.value.id
  }
  authorEditing.value = !authorEditing.value
}
let agentCleanup = null
let codexCleanup = null
let approvalCleanup = null
let refreshTimer = null
let typewriterTimer = null
let refreshSequence = 0
let streamAutoFollow = true
let approvalProjectId = ''
let conversationLayoutRunId = ''

const step = computed(() => run.value?.steps?.find(item => item.id === run.value.currentStepId) || run.value?.steps?.at(-1) || null)
const orderedCandidates = computed(() => run.value?.candidates || [])
const selectedCandidate = computed(() => orderedCandidates.value.find((item) => item.id === selectedCandidateId.value)
  || [...orderedCandidates.value].reverse().find((item) => item.status === 'pending')
  || orderedCandidates.value.at(-1) || null)
const pendingCandidate = selectedCandidate
const selectedStep = computed(() => run.value?.steps?.find((item) => item.id === selectedCandidate.value?.stepId) || step.value)
const candidateIsStale = computed(() => selectedCandidate.value?.status === 'stale')
const candidateIsPlanningBundle = computed(() => ['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(selectedCandidate.value?.artifactType))
const bundleFields = computed(() => Array.isArray(selectedCandidate.value?.payload?.fields) ? selectedCandidate.value.payload.fields : [])
const candidateCanResolve = computed(() => selectedCandidate.value?.status === 'pending')
const pendingApproval = computed(() => run.value?.approvals?.find((item) => item.status === 'pending') || null)
const retryableStep = computed(() => [...(run.value?.steps || [])].reverse().find((item) => ['failed', 'interrupted'].includes(item.status) && item.attemptCount < 3) || null)
const targetLabel = computed(() => step.value?.input?.target?.fieldLabel || ({ chapter_card: '章节卡', scene_plan: '场景计划', chapter: '正文', rewrite: '局部重写', continuity_audit: '连续性审计', quality_review: '质量评审' }[step.value?.task] || '就地创作'))
const panelKicker = computed(() => {
  const targetKind = step.value?.input?.target?.kind
  const bundleLabel = targetKind === 'planning_document_bundle' ? 'PAGE' : targetKind === 'planning_entity_bundle' ? 'CARD' : targetKind === 'planning_chapter_bundle' ? 'CHAPTER' : ''
  if (run.value?.executionMode === 'app_model') return bundleLabel ? `AI · ${bundleLabel} BATCH` : 'AI · INLINE'
  const agent = run.value?.modelRoutes?.agentProvider === 'qoder' ? 'QODER' : 'CODEX'
  return bundleLabel ? `${agent} · ${bundleLabel} SESSION` : `${agent} · INLINE`
})
const modelLabel = computed(() => run.value?.executionMode === 'app_model'
  ? run.value?.modelRoutes?.appModelName || run.value?.modelRoutes?.planning_field || run.value?.modelRoutes?.modelProfileId || '规划任务模型'
  : run.value?.modelRoutes?.agentProvider === 'qoder' ? run.value?.modelRoutes?.codexModel || 'Qoder Auto' : run.value?.modelRoutes?.codexModel || 'Codex 默认模型')
const backendLabel = computed(() => ({ codex_acp: 'Codex ACP', codex_exec: 'Codex exec', qoder_acp: 'Qoder ACP', app_model: '任务模型' }[run.value?.actualBackend]
  || (run.value?.executionMode === 'app_model' ? '等待任务模型' : '等待 ACP')))
const trace = computed(() => (run.value?.events || []).filter((item) => ['status', 'plan', 'tool_call', 'tool_result', 'usage', 'failed', 'completed'].includes(item.type)).slice(-24))
const tokenUsage = computed(() => {
  const usage = [...(run.value?.events || [])].reverse().find((item) => item.type === 'usage')?.payload || {}
  const total = usage.totalTokens || usage.total_tokens || (Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0))
  return total ? `${total} tokens` : '受控项目镜像'
})
const candidateIsManuscript = computed(() => ['manuscript', 'manuscript_selection'].includes(selectedCandidate.value?.artifactType))
const candidateIsChapterCard = computed(() => selectedCandidate.value?.artifactType === 'chapter_card')
const chapterCardPreview = computed(() => candidateIsChapterCard.value
  ? chapterCardPresentation(chapterCardDraft.value || selectedCandidate.value?.payload)
  : null)
const chapterCardIssues = computed(() => candidateIsChapterCard.value ? chapterCardEditIssues(chapterCardDraft.value || selectedCandidate.value?.payload) : [])
const chapterCardDirty = computed(() => Boolean(candidateIsChapterCard.value && chapterCardDraft.value && chapterCardOriginal.value
  && draftDigest(chapterCardDraft.value) !== draftDigest(chapterCardOriginal.value)))
const chapterCardCanEdit = computed(() => candidateIsChapterCard.value
  && ['pending', 'accepted'].includes(selectedCandidate.value?.status)
  && !streaming.value)
const chapterCardCanSaveAccepted = computed(() => selectedCandidate.value?.status === 'accepted' && chapterCardDirty.value)
const candidateCanAccept = computed(() => selectedCandidate.value?.status === 'pending'
  && (!candidateIsPlanningBundle.value || bundleSelectedKeys.value.length > 0)
  && (!candidateIsChapterCard.value || chapterCardIssues.value.length === 0))
const candidateIsChapterTitle = computed(() => selectedStep.value?.input?.target?.kind === 'chapter_field'
  && selectedStep.value?.input?.target?.fieldKey === 'title')
const candidateIsJson = computed(() => !['planning_field', 'renderer_draft', 'manuscript_selection', 'planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(selectedCandidate.value?.artifactType) && selectedCandidate.value?.artifactType !== 'manuscript')
const candidateText = computed(() => selectedCandidate.value?.payload?.text || selectedCandidate.value?.payload?.manuscript || '')
const streamingText = computed(() => visibleCodexStream(streamingOutput.value))
const streamingHeading = computed(() => {
  if (streamingAttempt.value > 1) return streamingText.value ? '正在重新整理候选' : '正在进行结构校准'
  return streamingText.value ? '正在生成候选' : '正在准备候选'
})
const composedManuscript = computed(() => composeInlineManuscriptCandidate({
  source: props.sourceManuscript,
  artifactType: selectedCandidate.value?.artifactType,
  payload: selectedCandidate.value?.payload,
  action: selectedStep.value?.input,
}))
const candidateTypeLabel = computed(() => ({ planning_field: '字段候选', planning_document_bundle: '整页候选', planning_entity_bundle: '整卡候选', planning_chapter_bundle: '整章规划候选', renderer_draft: '编辑器草稿', manuscript: '完整正文', manuscript_selection: '选区替换', chapter_card: '章节合同', scene_plan: '结构化场景卡', chapter_state: '章后状态', continuity_audit: '审计报告', quality_review: '质量报告' }[selectedCandidate.value?.artifactType] || selectedCandidate.value?.artifactType || ''))
const candidateHeading = computed(() => ({ pending: '待确认候选', accepted: '已接受版本', rejected: '已放弃版本', stale: '历史候选', cancelled: '已取消候选' }[selectedCandidate.value?.status] || '候选版本'))
const candidateOptions = computed(() => orderedCandidates.value.map((candidate, index) => ({
  id: candidate.id,
  label: `第 ${index + 1} 版 · ${{ pending: '待确认', accepted: '已接受', rejected: '已放弃', stale: '历史', cancelled: '已取消' }[candidate.status] || candidate.status}`,
})))
const selectedCandidateVersion = computed(() => Math.max(1, orderedCandidates.value.findIndex((candidate) => candidate.id === selectedCandidate.value?.id) + 1))
const conversationBusy = computed(() => busy.value || ['pending', 'waiting_approval', 'running'].includes(run.value?.status))
const conversationWasFinished = computed(() => (run.value?.events || []).some((event) => event.type === 'inline_conversation_finished'))
const latestCandidateStatus = computed(() => orderedCandidates.value.at(-1)?.status || '')
const showConversation = computed(() => Boolean(selectedCandidate.value)
  && run.value?.workflowId === 'inline-action'
  && run.value?.executionMode === 'codex')
const canContinueConversation = computed(() => Boolean(selectedCandidate.value)
  && run.value?.workflowId === 'inline-action'
  && run.value?.executionMode === 'codex'
  && run.value?.status !== 'cancelled'
  && !streaming.value
  && !(run.value?.status === 'completed' && ['rejected', 'cancelled'].includes(latestCandidateStatus.value))
  && !pendingApproval.value)
const canFinishConversation = computed(() => run.value?.workflowId === 'inline-action'
  && run.value?.status === 'waiting_confirmation'
  && !orderedCandidates.value.some((candidate) => candidate.status === 'pending'))
const conversationMessages = computed(() => buildInlineConversation({
  steps: run.value?.steps || [],
  candidates: orderedCandidates.value,
  runStatus: run.value?.status || '',
}))
const conversationScopeLabel = computed(() => inlineConversationScope({
  artifactType: selectedCandidate.value?.artifactType || '',
  targetKind: selectedStep.value?.input?.target?.kind || '',
  fieldLabel: selectedStep.value?.input?.target?.fieldLabel || targetLabel.value,
  conversationScope: selectedStep.value?.input?.conversationScope || null,
}))
const conversationReuseNote = computed(() => conversationReuseCopy({
  conversationScope: selectedStep.value?.input?.conversationScope || null,
}))
const quickInstructions = computed(() => {
  if (candidateIsManuscript.value) return [
    { label: '去工整感', prompt: '只修改实际存在的工整病灶：不要按章节卡逐条扩写，不要让每段和每个动作平均用力；保留有辨识度的原句、事实和章节结尾。' },
    { label: '补情绪暗线', prompt: '让视角人物没有说出口的顾虑通过注意力偏移、选择、自我辩护或语言失误影响场景，不直接命名情绪，也不要在动作后解释含义。' },
    { label: '打散完美对白', prompt: '保留人物立场和信息结果，让每个人带着自己的目的说话；允许答非所问、打断、停顿、改口和边做事边说，删除轮流总结局势或完整念条款的对白。' },
    { label: '减少说明', prompt: '删除读者已经能从动作、对白和结果推断出的复述；专业过程只保留会改变判断或结果的高信号细节。' },
  ]
  if (candidateIsChapterTitle.value) return [
    { label: '加强反差', prompt: '保留本章真实事件，改用人物身份、处境或预期之间的反差制造吸引力；不要写成事件摘要。' },
    { label: '增加悬念', prompt: '把标题改成具体但没有完全说破的悬念钩子，让读者想知道接下来如何兑现；不要虚构正文里没有的危险。' },
    { label: '更像网文', prompt: '提高连载网文章节名的点击感和人物声音，简短、有记忆点，避免文艺空话和账目式概括。' },
    { label: '保留事件换说法', prompt: '保留当前标题指向的核心事件，只更换切入角度和措辞，使它更有冲突、反差或人物口吻。' },
  ]
  if (candidateIsChapterCard.value) return [
    { label: '收紧合同', prompt: '压缩章节卡的解释，只保留本章必须发生的具体变化、阻力、代价和唯一章末落点。' },
    { label: '补足因果', prompt: '检查主角目标、阻力、转折、回报和代价是否前后相因；补足缺失环节，不增加与项目冲突的新设定。' },
    { label: '减少过度规划', prompt: '删去正文层面的动作清单和台词预演，给实际写作保留人物反应与现场细节的空间。' },
    { label: '检查章末边界', prompt: '把章末落点收紧为一个明确事件，确保必要场景不会提前完成或越过这个事件。' },
  ]
  if (candidateIsPlanningBundle.value) return [
    { label: '补足因果', prompt: '补足各字段之间的因果关系，让后续内容可以直接执行。' },
    { label: '压缩表述', prompt: '压缩重复表述，保留所有已确认事实和关键约束。' },
    { label: '保持设定', prompt: '检查并保持项目已有设定，不新增未经确认的核心事实。' },
    { label: '提高可执行性', prompt: '把抽象描述改成可观察、可行动、可验证的内容。' },
  ]
  return [
    { label: '更具体', prompt: '把表述写得更具体，补上能够观察或验证的细节。' },
    { label: '更简洁', prompt: '删去重复和空泛表述，保留核心信息。' },
    { label: '保持原设定', prompt: '保留已确认事实，只修改表达和当前要求涉及的部分。' },
    { label: '检查冲突', prompt: '检查与项目现有设定是否冲突，并修正冲突内容。' },
  ]
})
const conversationPlaceholder = computed(() => candidateIsManuscript.value
  ? '例如：技能应该有等级之分；把主角收到技能时的反应写出来，但不要过度惊讶。'
  : candidateIsChapterTitle.value
    ? '例如：保留借灶这件事，但突出过气明星与夜市摊主的身份反差。'
    : '告诉 Codex 哪些内容要保留、删除、补充或调整。')

watch(streamingText, async () => {
  if (!streamAutoFollow) return
  await nextTick()
  const element = streamingCandidateElement.value
  if (element) element.scrollTop = element.scrollHeight
})
watch(() => props.runId, () => {
  minimized.value = false
  mobileView.value = 'candidate'
  manuscriptView.value = 'reading'
  run.value = null
  selectedCandidateId.value = ''
  approvalProjectId = ''
  conversationLayoutRunId = ''
  resetStreaming()
  void refresh()
}, { immediate: true })
watch(() => selectedCandidate.value?.id, () => {
  authorEditing.value = false
  authorDraft.value = null
  authorDraftId.value = ''
  bundleSelectedKeys.value = candidateIsPlanningBundle.value ? bundleFields.value.map((field) => field.key) : []
  resetChapterCardDraft()
}, { immediate: true })
watch(() => props.currentChapterCard, () => {
  if (selectedCandidate.value?.status === 'accepted' && !chapterCardEditing.value && !chapterCardDirty.value) resetChapterCardDraft()
}, { deep: true })
watch(() => conversationMessages.value.length, async () => {
  await nextTick()
  if (conversationThreadElement.value) conversationThreadElement.value.scrollTop = conversationThreadElement.value.scrollHeight
})
watch(() => props.visible, (visible) => { if (visible) { minimized.value = false; void refresh({ background: true }) } })
onMounted(() => {
  agentCleanup = appService.onAgentEvent(handleAgentEvent)
  codexCleanup = appService.onCodexEvent(handleCodexEvent)
  approvalCleanup = appService.onApprovalEvent((event) => {
    if (event?.agentRunId === props.runId) scheduleRefresh(0, { refreshApproval: true })
  })
})
onBeforeUnmount(() => {
  agentCleanup?.()
  codexCleanup?.()
  approvalCleanup?.()
  if (refreshTimer) clearTimeout(refreshTimer)
  stopTypewriter()
})

async function refresh(options = {}) {
  if (!props.runId) { run.value = null; return }
  const sequence = ++refreshSequence
  const showInitialLoading = !options.background && !run.value
  if (showInitialLoading) loading.value = true
  try {
    const refreshedRun = await appService.getAgentRun(props.runId)
    if (sequence !== refreshSequence || !refreshedRun) return
    run.value = refreshedRun
    const latestPending = [...(run.value?.candidates || [])].reverse().find((candidate) => candidate.status === 'pending')
    if (latestPending) selectedCandidateId.value = latestPending.id
    else if (!(run.value?.candidates || []).some((candidate) => candidate.id === selectedCandidateId.value)) {
      selectedCandidateId.value = run.value?.candidates?.at(-1)?.id || ''
    }
    if (conversationLayoutRunId !== run.value.id && selectedCandidate.value) {
      conversationCollapsed.value = defaultInlineConversationCollapsed({ artifactType: selectedCandidate.value.artifactType })
      conversationLayoutRunId = run.value.id
    }
    const activeStepId = run.value?.currentStepId || run.value?.steps?.find((item) => ['pending', 'running'].includes(item.status))?.id || ''
    const activeStepHasCandidate = Boolean(activeStepId && run.value?.candidates?.some((candidate) => candidate.stepId === activeStepId))
    const runIsGenerating = ['pending', 'running'].includes(run.value?.status) && !activeStepHasCandidate
    if (runIsGenerating && !streaming.value) beginStreaming(activeStepId)
    if (runIsGenerating && !streamingSource.value) {
      const recovered = recoverCodexStream(run.value?.events || [], activeStepId)
      streamingAttempt.value = recoverCodexStreamAttempt(run.value?.events || [], activeStepId)
      streamingSource.value = recovered
      streamingOutput.value = recovered
    }
    if (!runIsGenerating) resetStreaming()
    if (run.value?.executionMode === 'codex' && run.value?.projectId && (options.refreshApproval || approvalProjectId !== run.value.projectId)) {
      approvalProjectId = run.value.projectId
      sessionModelApprovalEnabled.value = Boolean((await appService.getSessionModelApproval(run.value.projectId)).enabled)
    } else if (run.value?.executionMode !== 'codex') {
      sessionModelApprovalEnabled.value = false
    }
    if (!options.preserveError) actionError.value = ''
    emit('updated', run.value)
  } catch (error) {
    if (sequence === refreshSequence) actionError.value = error.message
  } finally {
    if (sequence === refreshSequence) loading.value = false
  }
}

function beginStreaming(agentStepId = '') {
  if (agentStepId && streamingStepId.value && streamingStepId.value !== agentStepId) {
    stopTypewriter()
    streamingSource.value = ''
    streamingOutput.value = ''
  }
  streamingStepId.value = agentStepId || streamingStepId.value
  streaming.value = true
  streamAutoFollow = true
}

function resetStreaming() {
  stopTypewriter()
  streaming.value = false
  streamingSource.value = ''
  streamingOutput.value = ''
  streamingStepId.value = ''
  streamingAttempt.value = 1
  streamAutoFollow = true
}

function stopTypewriter() {
  if (!typewriterTimer) return
  clearInterval(typewriterTimer)
  typewriterTimer = null
}

function startTypewriter() {
  if (typewriterTimer) return
  typewriterTimer = setInterval(() => {
    const remaining = streamingSource.value.length - streamingOutput.value.length
    if (remaining <= 0) {
      stopTypewriter()
      return
    }
    const nextLength = nextCodexStreamLength(streamingOutput.value.length, streamingSource.value.length)
    streamingOutput.value = streamingSource.value.slice(0, nextLength)
  }, 24)
}

function flushTypewriter() {
  stopTypewriter()
  streamingOutput.value = streamingSource.value
}

function scheduleRefresh(delay = 120, options = {}) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refresh({ background: true, ...options })
  }, delay)
}

function handleCodexEvent(event) {
  if (event?.agentRunId !== props.runId) return
  if (event.type === 'text_delta') {
    beginStreaming(event.agentStepId || '')
    streamingSource.value = appendCodexStream(streamingSource.value, event.text || '')
    startTypewriter()
    return
  }
  scheduleRefresh(160)
}

async function finalizeStreaming() {
  flushTypewriter()
  await refresh({ background: true })
  resetStreaming()
  scheduleRefresh(180)
}

function handleAgentEvent(event) {
  if (event?.agentRunId !== props.runId) return
  if (['run_started', 'inline_revision_started'].includes(event.type)) {
    resetStreaming()
    beginStreaming(event.payload?.stepId || '')
    scheduleRefresh(80)
    return
  }
  if (event.type === 'structured_retry') {
    resetStreaming()
    streamingAttempt.value = Math.max(2, Math.min(3, Number(event.payload?.attempt) || 2))
    beginStreaming(event.payload?.stepId || '')
    scheduleRefresh(80)
    return
  }
  if (event.type === 'candidate_created') {
    void finalizeStreaming()
    return
  }
  if (['run_failed', 'run_cancelled', 'discussion_completed'].includes(event.type)) resetStreaming()
  scheduleRefresh(80)
}

function handleStreamingScroll(event) {
  const element = event.currentTarget
  streamAutoFollow = element.scrollHeight - element.scrollTop - element.clientHeight < 72
}
async function resolveApproval(approved) {
  if (!pendingApproval.value) return
  try {
    actionError.value = ''
    await appService.resolveApproval({ id: pendingApproval.value.id, approved, reason: approved ? '' : '作者拒绝本次调用' })
    await refresh()
  } catch (error) { actionError.value = error.message }
}
async function approveProjectSession() {
  if (!pendingApproval.value || !run.value?.projectId) return
  try {
    actionError.value = ''
    await appService.setSessionModelApproval({ projectId: run.value.projectId, enabled: true })
    sessionModelApprovalEnabled.value = true
    await appService.resolveApproval({ id: pendingApproval.value.id, approved: true, note: '作者授权当前项目在本次应用会话内自动批准模型调用' })
    await refresh()
  } catch (error) { actionError.value = error.message }
}
async function acceptCandidate() {
  if (!selectedCandidate.value || busy.value || !candidateCanAccept.value) return
  busy.value = true
  const candidate = selectedCandidate.value
  try {
    actionError.value = ''
    run.value = await appService.confirmAgentCandidate({
      runId: run.value.id,
      candidateId: candidate.id,
      reason: reason.value,
      currentDraftDigest: props.currentDraftDigest,
      ...(candidateIsChapterCard.value && chapterCardDirty.value ? { editedPayload: cloneChapterCard(chapterCardDraft.value) } : {}),
      ...(authorDraftId.value === candidate.id && authorDraft.value ? { editedPayload: authorDraft.value } : {}),
      ...(candidateIsPlanningBundle.value ? { applyOptions: { fieldKeys: [...bundleSelectedKeys.value] } } : {}),
    })
    const acceptedCandidate = run.value.candidates.find((item) => item.id === candidate.id) || candidate
    if (candidateIsChapterCard.value) useSavedChapterCard(acceptedCandidate)
    emit('accepted', { run: run.value, candidate: acceptedCandidate })
    reason.value = ''
  } catch (error) { actionError.value = error.message } finally { busy.value = false }
}
async function rejectCandidate() {
  if (!selectedCandidate.value || busy.value || !candidateCanResolve.value) return
  busy.value = true
  const candidate = selectedCandidate.value
  try {
    actionError.value = ''
    run.value = await appService.rejectAgentCandidate({ runId: run.value.id, candidateId: candidate.id, reason: reason.value })
    emit('rejected', { run: run.value, candidate })
    reason.value = ''
  } catch (error) {
    const message = error.message
    await refresh({ preserveError: true })
    actionError.value = message
  } finally { busy.value = false }
}
async function runControl(action) {
  try { actionError.value = ''; run.value = await action(); emit('updated', run.value) }
  catch (error) { actionError.value = error.message }
}
async function submitRevision() {
  if (!followupInstruction.value || !selectedCandidate.value || conversationBusy.value) return
  if (!confirmLegacyRules()) return
  busy.value = true
  resetStreaming()
  beginStreaming()
  try {
    actionError.value = ''
    run.value = await appService.continueInlineAgent({
      runId: run.value.id,
      legacyRuleChoice: run.value.legacySnapshot ? 'continue' : undefined,
      parentCandidateId: selectedCandidate.value.id,
      instruction: followupInstruction.value,
      mode: conversationMode.value,
      scope: { kind: modificationScope.value, ...(['selection', 'scene'].includes(modificationScope.value) ? selection.value : {}) },
      currentDraftDigest: props.currentDraftDigest,
      ...(props.currentDraftValue === undefined ? {} : { currentDraftValue: props.currentDraftValue }),
    })
    followupInstruction.value = ''
    emit('updated', run.value)
  } catch (error) { resetStreaming(); actionError.value = error.message } finally { busy.value = false }
}
function appendQuickInstruction(prompt) {
  const existing = followupInstruction.value.trim()
  followupInstruction.value = existing ? `${existing}\n${prompt}` : prompt
}
function selectConversationCandidate(candidateId) {
  if (!orderedCandidates.value.some((candidate) => candidate.id === candidateId)) return
  selectedCandidateId.value = candidateId
}
function cloneChapterCard(value) {
  try { return JSON.parse(JSON.stringify(value || {})) } catch { return {} }
}
function normalizedChapterCardDraft(value) {
  const presented = chapterCardPresentation(value)
  if (!presented) return null
  return {
    ...cloneChapterCard(presented.card),
    requiredScenes: presented.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      goal: scene.goal,
      result: scene.result,
    })),
  }
}
function resetChapterCardDraft() {
  if (!candidateIsChapterCard.value || !selectedCandidate.value) {
    chapterCardDraft.value = null
    chapterCardOriginal.value = null
    chapterCardEditing.value = false
    return
  }
  const formalCard = props.currentChapterCard && Object.keys(props.currentChapterCard).length
    ? props.currentChapterCard
    : null
  const source = selectedCandidate.value.status === 'accepted' && formalCard
    ? formalCard
    : selectedCandidate.value.payload
  const draft = normalizedChapterCardDraft(source)
  chapterCardDraft.value = cloneChapterCard(draft)
  chapterCardOriginal.value = cloneChapterCard(draft)
  chapterCardEditing.value = false
}
function resetChapterCardChanges() {
  chapterCardDraft.value = cloneChapterCard(chapterCardOriginal.value)
}
function nextChapterSceneId() {
  const ids = new Set((chapterCardDraft.value?.requiredScenes || []).map((scene) => String(scene.id || '').trim()))
  let index = 1
  while (ids.has(`S${index}`)) index += 1
  return `S${index}`
}
function addChapterScene() {
  if (!chapterCardDraft.value || (chapterCardDraft.value.requiredScenes || []).length >= 6) return
  if (!Array.isArray(chapterCardDraft.value.requiredScenes)) chapterCardDraft.value.requiredScenes = []
  chapterCardDraft.value.requiredScenes.push({
    id: nextChapterSceneId(),
    title: `必要场景 ${chapterCardDraft.value.requiredScenes.length + 1}`,
    goal: '',
    result: '',
  })
}
function removeChapterScene(index) {
  if (!Array.isArray(chapterCardDraft.value?.requiredScenes)) return
  chapterCardDraft.value.requiredScenes.splice(index, 1)
}
function useSavedChapterCard(candidate) {
  const saved = normalizedChapterCardDraft(candidate?.payload || chapterCardDraft.value)
  chapterCardDraft.value = cloneChapterCard(saved)
  chapterCardOriginal.value = cloneChapterCard(saved)
  chapterCardEditing.value = false
}
async function saveAcceptedChapterCard() {
  if (!selectedCandidate.value || busy.value || !chapterCardCanSaveAccepted.value || chapterCardIssues.value.length) return
  busy.value = true
  const candidateId = selectedCandidate.value.id
  try {
    actionError.value = ''
    run.value = await appService.confirmAgentCandidate({
      runId: run.value.id,
      candidateId,
      reason: reason.value || '作者手动修改章节卡',
      editedPayload: cloneChapterCard(chapterCardDraft.value),
    })
    const savedCandidate = run.value.candidates.findLast((candidate) => candidate.evidence?.parentCandidateId === candidateId && candidate.evidence?.authorRevision)
      || run.value.candidates.find((candidate) => candidate.id === candidateId)
    selectedCandidateId.value = savedCandidate.id
    useSavedChapterCard(savedCandidate)
    emit('accepted', { run: run.value, candidate: savedCandidate, manualEdit: true })
    reason.value = ''
  } catch (error) { actionError.value = error.message } finally { busy.value = false }
}
async function finishConversation() {
  await runControl(() => appService.finishInlineAgent(run.value.id))
}
async function saveAuthorRevision() {
  if (busy.value || !authorDraft.value) return
  busy.value = true
  try {
    const parentId = selectedCandidate.value.id
    run.value = await appService.confirmAgentCandidate({ runId: run.value.id, candidateId: parentId, editedPayload: authorDraft.value, reason: '作者手动修订' })
    const revised = run.value.candidates.findLast(item => item.evidence?.parentCandidateId === parentId && item.evidence?.authorRevision)
    if (revised) { selectedCandidateId.value = revised.id; emit('accepted', { run: run.value, candidate: revised, manualEdit: true }) }
  } catch (error) { actionError.value = error.message } finally { busy.value = false }
}
async function restartWithCurrentModel() {
  if (!globalThis.confirm(`本对话锁定 ${modelLabel.value}。完全重新开始将保留历史，使用设置中当前模型建立新对话。继续吗？`)) return
  busy.value = true
  try {
    const original = run.value, action = selectedStep.value.input
    await appService.cancelAgentRun(original.id)
    const created = await appService.startInlineAgent({ ...action, projectId: original.projectId, chapterId: original.chapterId, executionMode: 'codex', freshStart: true })
    run.value = created
    emit('updated', created)
  } catch (error) { actionError.value = error.message } finally { busy.value = false }
}
async function pause() { await runControl(() => appService.pauseAgentRun(run.value.id)) }
function confirmLegacyRules() {
  return !run.value.legacySnapshot || run.value.modelRoutes?.legacyRuleChoice === 'continue' || globalThis.confirm('旧运行缺少完整冻结信息。继续使用其锁定的历史能力包规则？取消后可使用“完全重新开始”，基于正式内容采用当前配置。')
}
async function resume() { if (confirmLegacyRules()) await runControl(() => appService.resumeAgentRun({ runId: run.value.id, legacyRuleChoice: 'continue' })) }
async function retry() { if (confirmLegacyRules()) await runControl(() => appService.retryAgentStep({ runId: run.value.id, stepId: retryableStep.value.id, legacyRuleChoice: 'continue' })) }
async function cancel() { await runControl(() => appService.cancelAgentRun(run.value.id)) }
function selectAllBundleFields() { bundleSelectedKeys.value = bundleFields.value.map((field) => field.key) }
function clearBundleFields() { bundleSelectedKeys.value = [] }
function statusLabel(value) { return ({ pending: '待开始', waiting_approval: '等待审批', running: '执行中', waiting_confirmation: '等待确认', paused: '已暂停', interrupted: '已中断', completed: '已完成', rejected: '已拒绝', stale: '已过期', cancelled: '已取消', failed: '失败' }[value] || value) }
function eventLabel(value) { return ({ plan: '计划', tool_call: '工具', tool_result: '结果', usage: '用量', status: '状态', failed: '错误', completed: '完成' }[value] || value) }
function eventText(event) {
  const payload = event.payload || {}
  if (event.type === 'status') {
    if (Array.isArray(payload.availableCommands)) return `ACP 会话能力已加载（${payload.availableCommands.length} 项）`
    const threadStatus = payload?._meta?.codex?.threadStatus?.type
    if (threadStatus) return ({ active: 'ACP 会话正在工作', idle: 'ACP 会话已空闲' }[threadStatus] || `ACP 会话：${threadStatus}`)
    if (String(event.summary || '').startsWith('system:')) return 'Codex 已接收受控创作任务'
    return String(payload.status || payload.message || payload.sessionUpdate || event.summary || '状态已更新').slice(0, 180)
  }
  return String(event.summary || payload.text || payload.delta || payload.status || payload.message || JSON.stringify(payload)).slice(0, 500)
}
</script>

<style scoped>
.protection-editor{padding:12px;border:1px solid #aac4c9;border-radius:8px;color:#37565f}.protection-editor textarea{box-sizing:border-box;width:100%;min-height:180px;max-height:340px;resize:vertical;overflow:auto;background:white;color:#263e45;line-height:1.8;padding:12px;border:1px solid #aac4c9}.local-checks{padding:10px 14px;background:#fff6e6;color:#6b542c;font-size:13px;line-height:1.6}.conversation-head-actions{flex-wrap:wrap}
.inline-codex-panel { position: fixed; z-index: 115; top: 82px; right: 16px; bottom: 16px; width: min(1320px, calc(100vw - 32px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--ns-border-strong); background: var(--ns-surface); color: var(--ns-text); box-shadow: var(--ns-shadow-lg); container-type: inline-size; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.inline-codex-panel.is-minimized { top: auto; bottom: 24px; width: min(390px, calc(100vw - 48px)); height: auto; }
.inline-panel-head { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 8px 16px 8px 20px; border-bottom: 1px solid #394146; }
.inline-panel-head > div:first-child { display: flex; align-items: baseline; gap: 14px; min-width: 0; }
.inline-panel-head h2 { margin: 0; overflow: hidden; font-family: Georgia, 'Songti SC', serif; font-size: 20px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.inline-panel-window-actions { display: flex; align-items: center; gap: 2px; margin-left: 18px; }
.inline-panel-head button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; background: transparent; color: #bfc2bf; font-size: 21px; line-height: 1; cursor: pointer; }
.inline-panel-head button:hover { border-color: #596267; background: #293034; color: #f4ede4; }
.inline-panel-head button:focus-visible,.inline-minimized-status button:focus-visible { outline: 2px solid #d06a4a; outline-offset: 2px; }
.is-minimized .inline-panel-head { align-items: center; padding: 14px 16px; }
.is-minimized .inline-panel-head h2 { margin-top: 2px; max-width: 210px; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
.is-minimized .panel-kicker { font-size: 8px; }
.inline-minimized-status { display: flex; align-items: center; gap: 8px; padding: 11px 16px 13px; color: #929ca0; font-size: 10px; }
.inline-minimized-status strong { color: #e5ddd2; font-size: 11px; }
.inline-minimized-status button { margin-left: auto; padding: 7px 10px; border: 1px solid #97533f; background: #7e4334; color: #fff6ec; font-size: 10px; cursor: pointer; }
.state-dot { width: 7px; height: 7px; border-radius: 50%; background: #899397; box-shadow: 0 0 0 3px rgba(137,147,151,.12); }
.state-dot.state-running,.state-dot.state-waiting_approval,.state-dot.state-waiting_confirmation { background: #d06a4a; box-shadow: 0 0 0 3px rgba(208,106,74,.14); }
.state-dot.state-completed { background: #73a28e; box-shadow: 0 0 0 3px rgba(115,162,142,.14); }
.panel-kicker { color: #d06a4a; font-size: 10px; font-weight: 700; letter-spacing: .18em; }
.inline-run-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: #394146; border-bottom: 1px solid #394146; }
.inline-run-meta div { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 8px 14px; background: #252c30; }
.inline-run-meta span { flex: 0 0 auto; color: #8f999e; font-size: 9px; letter-spacing: .08em; }
.inline-run-meta strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.inline-panel-notice,.inline-panel-error { margin: 7px 16px 0; padding: 7px 10px; border-left: 3px solid #c57b43; background: #2d3336; font-size: 11px; line-height: 1.4; }
.inline-panel-error { border-color: #c0523a; color: #f0b6a8; }
.inline-approval { flex: 0 1 auto; min-height: 100px; max-height: 40%; overflow: auto; margin: 14px 18px 0; padding: 15px; border: 1px solid #6c5a4e; background: #2c2c2a; }
.inline-approval h3 { margin: 6px 0 10px; font-size: 14px; }
.inline-approval pre,.inline-candidate pre { max-height: 190px; overflow: auto; white-space: pre-wrap; font-size: 11px; }
.inline-approval > div,.inline-candidate-actions,.inline-panel-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.inline-approval button,.inline-candidate-actions button,.inline-panel-footer button { padding: 8px 11px; border: 1px solid #596267; background: transparent; color: #e8dfd2; cursor: pointer; }
.inline-approval button.accent,.inline-candidate-actions button.accent { border-color: #bd563c; background: #bd563c; color: white; }
.inline-approval button.session { border-color: #687e78; background: #465f58; }
.approval-scope-note { margin: 10px 0; color: #aaa397; font-size: 10px; line-height: 1.5; }
.inline-trace { flex: 0 0 auto; max-height: 34%; overflow: auto; padding: 8px 16px; border-bottom: 1px solid #394146; }
.inline-trace summary { display: flex; justify-content: space-between; color: #9ea7aa; font-size: 11px; cursor: pointer; list-style: none; }
.inline-trace summary::-webkit-details-marker { display: none; }
.inline-trace summary::before { content: '＋'; margin-right: 7px; color: #d06a4a; }
.inline-trace[open] summary::before { content: '－'; }
.inline-trace summary small { margin-left: auto; }
.inline-section-title { display: flex; justify-content: space-between; color: #aeb4b6; font-size: 11px; letter-spacing: .08em; }
.inline-trace article { display: grid; grid-template-columns: 54px 1fr; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #343c40; }
.inline-trace article span { color: #d06a4a; font-size: 10px; }
.inline-trace article p { margin: 0; color: #c5c8c6; font-size: 12px; line-height: 1.55; white-space: pre-wrap; }
.inline-workbench { flex: 1 1 0; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); overflow: hidden; }
.inline-workbench.has-conversation { grid-template-columns: minmax(0, 1fr) 360px; }
.inline-workbench.chat-collapsed { grid-template-rows: minmax(0, 1fr) auto; }
.inline-mobile-tabs { display: none; }
.inline-candidate { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 16px 22px 0; background: var(--ns-surface); color: var(--ns-text); }
.inline-candidate-preview { flex: 1 1 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.inline-candidate-preview.is-diff { overflow: hidden; }
.inline-candidate-preview:focus-visible { outline: 2px solid var(--ns-accent); outline-offset: -2px; }
.candidate-version-head { flex: 0 0 auto; flex-wrap: wrap; gap: 8px; min-height: 32px; }
.candidate-view-tools { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; gap: 8px; padding: 6px 0 10px; }
.candidate-view-tools:empty { display: none; }
.candidate-view-tools button,.conversation-options button,.protection-editor button { padding: 6px 10px; border: 1px solid var(--ns-border); border-radius: 7px; color: var(--ns-text-soft); background: var(--ns-surface); font-size: 12px; cursor: pointer; }
.candidate-view-switch { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--ns-surface-muted); }
.candidate-view-switch button { border-color: transparent; background: transparent; }
.candidate-view-switch button[aria-pressed='true'] { color: var(--ns-accent-hover); background: white; box-shadow: var(--ns-shadow-sm); }
.inline-manuscript-reading { width: 100%; max-width: 42em; margin: 0 auto; padding: 20px 18px 48px; color: var(--ns-text); white-space: pre-wrap; overflow-wrap: anywhere; font: 17px/1.9 var(--font-body); }
.candidate-decision-dock { flex: 0 0 auto; padding: 12px 0; border-top: 1px solid var(--ns-border); }
.candidate-decision-dock:empty { display: none; }
.candidate-decision-dock .draft-note { margin: 0 0 8px; line-height: 1.5; }
.discard-author-draft { margin-left: 8px; padding: 3px 6px; border: 1px solid var(--ns-border); border-radius: 5px; color: var(--ns-text-muted); background: white; font-size: 11px; cursor: pointer; }
.candidate-decision-dock .candidate-note { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
.candidate-note span { flex: 0 0 auto; }
.candidate-note input { min-width: 0; }
.inline-candidate .local-checks { flex: 0 0 auto; max-height: 100px; overflow: auto; }
.candidate-version-head { align-items: center; }
.candidate-version-head label { display: flex; align-items: center; gap: 7px; letter-spacing: 0; }
.candidate-version-head label span { color: #85796e; font-size: 10px; }
.candidate-version-head select { max-width: 160px; padding: 5px 7px; color: #4b433c; border: 1px solid #c7b9a7; background: #fffaf1; font-size: 10px; }
.inline-candidate-text { max-width: 90ch; margin: 12px auto 0; white-space: pre-wrap; font-family: Georgia, 'Songti SC', serif; font-size: 16px; line-height: 1.85; }
.planning-bundle-candidate { display: grid; gap: 10px; margin-top: 14px; }
.bundle-candidate-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 12px; border: 1px solid #d5c8b8; background: rgba(255,255,255,.48); }
.bundle-candidate-toolbar p { margin: 0; color: #756b62; font-size: 11px; line-height: 1.5; }
.bundle-candidate-toolbar > div { display: flex; flex: 0 0 auto; gap: 5px; }
.bundle-candidate-toolbar button { padding: 5px 8px; color: #755748; border: 1px solid #c9aa98; background: #fffaf1; font-size: 9px; cursor: pointer; }
.bundle-field { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; padding: 12px 14px; border: 1px solid #d6cabb; background: rgba(255,255,255,.42); cursor: pointer; }
.bundle-field.selected { border-color: #bd8068; border-left: 3px solid #bd563c; background: #fffaf1; }
.bundle-field > input { margin: 4px 0 0; accent-color: #bd563c; }
.bundle-field-copy { display: grid; gap: 6px; min-width: 0; }
.bundle-field-copy strong { color: #4c433c; font: 13px var(--font-display); }
.bundle-field-copy small { overflow: hidden; color: #95887c; font-size: 9px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.bundle-field-copy > span { color: #39332e; font: 13px/1.7 var(--font-body); white-space: pre-wrap; }
.chapter-card-candidate { width: min(980px, 100%); margin: 16px auto 8px; }
.chapter-card-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 4px 2px 16px 18px; border-left: 3px solid #648d83; border-bottom: 1px solid #d9cec0; }
.chapter-card-intro > div { display: grid; gap: 4px; }
.chapter-card-intro .chapter-card-intro-actions { justify-items: end; gap: 9px; }
.chapter-card-intro span,.chapter-scenes > header span { color: #6d8d85; font-size: 8px; font-weight: 700; letter-spacing: .18em; }
.chapter-card-intro h3,.chapter-scenes h3 { margin: 0; color: #393630; font: 18px/1.25 var(--font-display); }
.chapter-card-intro p { max-width: 42ch; margin: 0; color: #7b7269; font-size: 10px; line-height: 1.55; text-align: right; }
.chapter-card-intro-actions button { padding: 6px 10px; color: #496a62; border: 1px solid #88a79f; background: rgba(255,255,255,.42); font-size: 9px; cursor: pointer; }
.chapter-card-intro-actions button:hover { border-color: #5f8d82; background: #edf5f1; }
.chapter-contract-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-right: 1px solid #d9cec0; border-bottom: 1px solid #d9cec0; border-left: 1px solid #d9cec0; }
.chapter-contract-field { min-width: 0; padding: 16px 18px 18px; border-top: 1px solid #d9cec0; background: rgba(255,255,255,.34); }
.chapter-contract-field:nth-child(even) { border-left: 1px solid #d9cec0; }
.chapter-contract-field.is-primary,.chapter-contract-field.is-ending { grid-column: 1 / -1; border-left: 0; }
.chapter-contract-field.is-primary { border-top: 0; background: rgba(239,246,242,.72); }
.chapter-contract-field.is-ending { position: relative; background: rgba(249,239,229,.74); }
.chapter-contract-field.is-ending::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background: #b88067; }
.chapter-contract-field header { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
.chapter-contract-field header span { color: #4f635e; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.chapter-contract-field header small { color: #998e83; font-size: 8px; text-align: right; }
.chapter-contract-field p { margin: 10px 0 0; color: #38342f; font: 13px/1.75 var(--font-body); white-space: pre-wrap; }
.chapter-contract-field textarea { box-sizing: border-box; width: 100%; min-height: 78px; margin-top: 10px; padding: 10px 11px; resize: vertical; color: #38342f; border: 1px solid #b9ccc6; outline: none; background: rgba(255,255,255,.72); font: 12px/1.65 var(--font-body); }
.chapter-contract-field textarea:focus,.scene-copy input:focus,.scene-copy textarea:focus { border-color: #5f8d82; box-shadow: 0 0 0 2px rgba(95,141,130,.13); }
.chapter-contract-field.is-primary p,.chapter-contract-field.is-ending p { font-size: 14px; }
.chapter-contract-field.is-missing { background: #fbf1e9; }
.chapter-contract-field.is-missing p,.chapter-scene-list article.is-missing dd { color: #a06954; font-style: italic; }
.chapter-scenes { margin-top: 22px; }
.chapter-scenes > header { display: flex; align-items: flex-end; justify-content: space-between; padding: 0 2px 9px; border-bottom: 1px solid #cfc4b6; }
.chapter-scenes > header > div { display: grid; gap: 3px; }
.chapter-scenes > header > small { color: #887f77; font-size: 9px; }
.chapter-scene-list { counter-reset: scene; }
.chapter-scene-list > article { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 14px; padding: 15px 2px; border-bottom: 1px solid #ddd3c7; }
.scene-number { display: grid; place-items: center; align-self: start; width: 32px; height: 32px; color: #55796f; border: 1px solid #91aaa3; border-radius: 50%; font-size: 9px; font-weight: 700; letter-spacing: .06em; }
.scene-copy { min-width: 0; }
.scene-copy > header { display: flex; align-items: baseline; gap: 9px; }
.scene-copy > header input { flex: 1 1 auto; min-width: 120px; padding: 6px 8px; color: #3c3832; border: 1px solid #b9ccc6; outline: none; background: rgba(255,255,255,.7); font: 12px var(--font-display); }
.scene-copy h4 { margin: 0; color: #3c3832; font: 14px/1.35 var(--font-display); }
.scene-copy > header small { color: #9a9087; font-size: 8px; letter-spacing: .08em; }
.scene-copy > header button { margin-left: auto; padding: 4px 7px; color: #a2604d; border: 1px solid #d4b4a7; background: transparent; font-size: 8px; cursor: pointer; }
.scene-copy dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 22px; margin: 9px 0 0; }
.scene-copy dl > div { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 8px; }
.scene-copy dt { color: #8b8076; font-size: 9px; line-height: 1.6; }
.scene-copy dd { margin: 0; color: #48423c; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
.scene-copy dd textarea { box-sizing: border-box; width: 100%; min-height: 58px; padding: 7px 8px; resize: vertical; color: #48423c; border: 1px solid #c4d2ce; outline: none; background: rgba(255,255,255,.66); font: 10px/1.55 var(--font-body); }
.chapter-scenes-empty { margin: 0; padding: 18px; color: #9b6955; border-bottom: 1px solid #dccbbe; background: #fbf1e9; font-size: 11px; line-height: 1.6; }
.chapter-scene-add { width: 100%; padding: 10px; color: #55796f; border: 0; border-bottom: 1px solid #cfc4b6; background: rgba(239,246,242,.55); font-size: 9px; cursor: pointer; }
.chapter-scene-add:disabled { color: #9a9d99; cursor: default; }
.chapter-card-edit-state { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 18px; padding: 11px 13px; border-left: 3px solid #d09272; background: #f8ece3; }
.chapter-card-edit-state > div { display: grid; gap: 3px; }
.chapter-card-edit-state strong { color: #774f40; font-size: 10px; }
.chapter-card-edit-state span { color: #8e776c; font-size: 9px; }
.chapter-card-edit-state button { flex: 0 0 auto; padding: 6px 8px; color: #815846; border: 1px solid #d0aa97; background: rgba(255,255,255,.46); font-size: 8px; cursor: pointer; }
.chapter-card-raw { margin-top: 18px; border: 1px solid #d8cdbf; background: rgba(255,255,255,.26); }
.chapter-card-raw summary { padding: 10px 13px; color: #756d65; font-size: 9px; cursor: pointer; list-style: none; }
.chapter-card-raw summary::-webkit-details-marker { display: none; }
.chapter-card-raw summary::before { content: '＋'; display: inline-block; width: 18px; color: #63877e; }
.chapter-card-raw[open] summary::before { content: '－'; }
.chapter-card-raw summary span { margin-left: 8px; color: #a0968c; }
.chapter-card-raw pre { box-sizing: border-box; max-height: 260px; margin: 0; padding: 14px 16px; border-top: 1px solid #ddd3c7; background: #f2eadf; color: #5a514a; font-size: 10px; line-height: 1.55; }
.chapter-card-invalid { margin: 18px auto; padding: 18px; color: #6d4739; border: 1px solid #d4b4a7; background: #fbeee7; }
.chapter-card-invalid strong { font: 14px var(--font-display); }
.chapter-card-invalid p { margin: 7px 0 12px; font-size: 10px; line-height: 1.55; }
.chapter-card-invalid pre { color: #584c44; }
.inline-streaming-candidate { display: block; overflow: auto; overscroll-behavior: contain; }
.inline-streaming-candidate .candidate-version-head { position: sticky; top: -16px; padding-block: 12px; background: var(--ns-surface); }
.streaming-state { display: flex; align-items: center; gap: 7px; color: #80756c; letter-spacing: .04em; }
.streaming-state i { width: 6px; height: 6px; border-radius: 50%; background: #bd563c; box-shadow: 0 0 0 3px rgba(189,86,60,.12); }
.inline-streaming-text::after { content: ''; display: inline-block; width: 2px; height: 1em; margin-left: 4px; background: #bd563c; vertical-align: -.12em; animation: stream-caret 1s steps(1,end) infinite; }
.inline-streaming-empty { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 180px; color: #94887d; font: 12px/1.5 var(--font-body); }
.inline-streaming-empty span { width: 7px; height: 7px; border-radius: 50%; background: #bd563c; box-shadow: 0 0 0 4px rgba(189,86,60,.1); }
@keyframes stream-caret { 0%,48% { opacity: 1; } 49%,100% { opacity: 0; } }
.draft-note { color: #8a5b43; font-size: 12px; }
.draft-note.accepted { color: #4e7166; }
.candidate-note { display: block; margin: 14px 0; font-size: 11px; }
.candidate-note span { display: block; margin-bottom: 5px; }
.candidate-note input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #c7b9a7; background: #fffaf1; }
.inline-candidate-actions button { color: #303538; border-color: #b5a898; }
.inline-candidate-actions button.accent { color: white; }
.inline-conversation { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-left: 1px solid var(--ns-border); background: var(--ns-surface-soft); }
.inline-conversation.is-collapsed { flex: 0 0 auto; max-height: none; }
.conversation-head { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border-bottom: 1px solid var(--ns-border); }
.conversation-head > div { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 9px; min-width: 0; }
.conversation-head strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.conversation-eyebrow { color: #d28a70; font-size: 9px; font-weight: 700; letter-spacing: .16em; }
.conversation-head-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 7px; }
.conversation-session-badge { flex: 0 0 auto; padding: 4px 7px; color: #a9b3b5; border: 1px solid #4d595e; border-radius: 999px; font-size: 8px; letter-spacing: .06em; }
.conversation-collapse-toggle { padding: 4px 8px; color: #c3cecf; border: 1px solid #526066; border-radius: 999px; background: transparent; font-size: 8px; cursor: pointer; }
.conversation-collapse-toggle:hover { color: white; border-color: #718b84; }
.conversation-thread { position: relative; flex: 1 1 0; min-height: 0; overflow: auto; padding: 12px 14px; overscroll-behavior: contain; }
.conversation-options { margin-bottom: 14px; color: var(--ns-text-muted); font-size: 12px; line-height: 1.6; }
.conversation-options summary,.protection-editor summary { cursor: pointer; }
.discussion-message { margin: 10px 0; }
.protection-editor { margin: 16px 0; }
.protection-editor p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.conversation-message { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; margin-bottom: 10px; }
.conversation-avatar { position: relative; z-index: 1; display: grid; place-items: center; width: 22px; height: 22px; color: #e9e2d9; border: 1px solid #6a7377; border-radius: 50%; background: #30383c; font-size: 8px; font-weight: 700; }
.conversation-message.is-author .conversation-avatar { color: white; border-color: #9e6957; background: #815343; }
.conversation-bubble { min-width: 0; padding: 9px 11px; border: 1px solid #465157; background: #2c3438; }
.conversation-message.is-author .conversation-bubble { border-color: #5b5550; background: #353433; }
.conversation-bubble header { display: flex; align-items: center; gap: 8px; }
.conversation-bubble header strong { font-size: 10px; }
.conversation-bubble header small { color: #909a9d; font-size: 8px; }
.conversation-bubble p { margin: 5px 0 0; color: #d4d5d1; font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.conversation-bubble button { margin-top: 7px; padding: 4px 7px; color: #c5d7d2; border: 1px solid #59726b; background: transparent; font-size: 8px; cursor: pointer; }
.conversation-bubble button.active { color: white; background: #536f67; }
.conversation-message.is-working .conversation-bubble p::after { content: '•••'; margin-left: 5px; color: #d28a70; letter-spacing: .1em; animation: conversation-pulse 1.2s infinite; }
.conversation-composer { flex: 0 0 auto; max-height: 54%; overflow: auto; padding: 12px 14px; border-top: 1px solid var(--ns-border); background: var(--ns-surface-muted); }
.conversation-shortcuts { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; }
.conversation-shortcuts label { display: flex; align-items: center; gap: 5px; font-size: 12px; }
.conversation-shortcuts select { min-width: 0; max-width: 170px; padding: 5px; font-size: 12px; }
.conversation-shortcuts button { flex: 0 0 auto; padding: 5px 8px; color: #aeb9bb; border: 1px solid #4b575c; border-radius: 999px; background: transparent; font-size: 8px; cursor: pointer; }
.conversation-shortcuts button:hover { color: #edf3f1; border-color: #718b84; }
.conversation-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 10px; }
.conversation-input textarea { box-sizing: border-box; grid-column: 1 / -1; width: 100%; height: 96px; min-height: 72px; max-height: 180px; padding: 10px 11px; resize: vertical; color: var(--ns-text); border: 1px solid var(--ns-border); outline: none; background: white; font: 14px/1.6 var(--font-ui); }
.conversation-input textarea:focus { border-color: #7b9b92; box-shadow: 0 0 0 2px rgba(123,155,146,.12); }
.conversation-input small { align-self: center; color: #879095; font-size: 8px; line-height: 1.4; }
.conversation-input button { align-self: center; padding: 8px 11px; color: white; border: 1px solid #5f887e; background: #5f887e; cursor: pointer; }
.conversation-input button:disabled,.conversation-shortcuts button:disabled { cursor: default; opacity: .45; }
.conversation-closed-note { margin: 0; padding: 12px 18px; color: #8f999d; font-size: 10px; line-height: 1.5; }
@keyframes conversation-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
.inline-panel-footer { flex: 0 0 auto; align-items: center; padding: 10px 16px; border-top: 1px solid var(--ns-border); }
.inline-panel-footer > small { margin-right: auto; color: var(--ns-text-muted); font-size: 11px; }
.inline-panel-footer .danger { color: #e69a86; }
.inline-panel-empty { padding: 28px; color: #90999d; text-align: center; }
@media (max-width: 860px) {
  .inline-codex-panel { top: 58px; right: 12px; bottom: 12px; width: calc(100vw - 24px); }
  .inline-codex-panel.is-minimized { right: 12px; bottom: 12px; width: min(390px, calc(100vw - 24px)); }
  .inline-run-meta { grid-template-columns: 1fr 1fr; }
  .inline-candidate { padding: 18px; }
  .chapter-card-intro { display: grid; gap: 10px; }
  .chapter-card-intro p { text-align: left; }
  .chapter-card-intro .chapter-card-intro-actions { justify-items: start; }
  .chapter-contract-fields { grid-template-columns: 1fr; }
  .chapter-contract-field,.chapter-contract-field:nth-child(even) { grid-column: 1; border-left: 0; }
  .scene-copy dl { grid-template-columns: 1fr; }
  .chapter-card-edit-state { align-items: flex-start; flex-direction: column; }
  .conversation-head { padding-inline: 14px; }
  .conversation-thread { padding-inline: 18px 14px; }
  .conversation-thread::before { left: 28px; }
  .conversation-composer { padding-inline: 14px; }
  .conversation-input { grid-template-columns: 1fr; }
  .conversation-input button { width: 100%; }
}
@container (max-width: 950px) {
  .inline-mobile-tabs { display: flex; flex: 0 0 auto; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--ns-border); }
  .inline-mobile-tabs button { border: 1px solid transparent; border-radius: 7px; padding: 7px 14px; background: transparent; color: var(--ns-text-soft); cursor: pointer; }
  .inline-mobile-tabs button[aria-pressed='true'] { color: var(--ns-accent-hover); border-color: var(--ns-border-strong); background: var(--ns-accent-soft); }
  .inline-workbench.has-conversation,.inline-workbench.chat-collapsed { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .inline-workbench:not(.mobile-conversation) .inline-conversation { display: none; }
  .inline-workbench.mobile-conversation .inline-candidate { display: none; }
  .inline-conversation { border-left: 0; }
  .conversation-composer { max-height: 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .inline-codex-panel { transition: none; }
  .inline-streaming-candidate { scroll-behavior: auto; }
  .inline-streaming-text::after { animation: none; }
}
</style>
