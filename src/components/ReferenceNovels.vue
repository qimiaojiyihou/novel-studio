<template>
  <section class="reference-novels" aria-label="参考小说">
    <header class="reference-heading">
      <div><span class="eyebrow">REFERENCE LIBRARY</span><h2>参考小说</h2><p>选几本喜欢的小说，提炼表达习惯，形成这本书自己的文风。</p></div>
      <button type="button" :disabled="busy || !state || (importMode !== 'off' && (booksDirty || settingsDirty || dirty || state.pendingMerge))" @click="importBooks">{{ importing ? (importMode === 'off' ? '正在读取…' : '正在导入并分析…') : '＋ 导入小说' }}</button>
    </header>
    <label><span class="reference-label">导入参考小说后</span><select v-model="importMode" :disabled="busy" @change="rememberOptions">
      <option value="app_model">用分析模型生成规范草稿</option><option value="codex">用 Codex 生成规范草稿</option><option value="off">只导入并自动选段</option>
    </select></label>
    <p v-if="importMode !== 'off' && (booksDirty || settingsDirty || dirty || state?.pendingMerge)" class="reference-hint">请先保存当前编辑或处理待确认的合并稿，再导入并分析。</p>
    <p v-if="error" class="reference-error" role="alert">{{ error }} <button type="button" @click="load">刷新资料</button></p>
    <p v-if="notice" class="reference-notice" role="status">{{ notice }}</p>
    <p class="reference-hint">支持 TXT、Markdown、Word DOCX，可多选，每本最大 10 MB。导入时在本机自动选取写作样本。首次设置的底色和匹配本场用途的选段，会随正文写作和改稿发送给所选模型。</p>
    <div v-if="!state" class="reference-empty">正在读取参考资料…</div>
    <template v-else>
      <div v-if="!state.books.length" class="reference-empty"><strong>从你喜欢的写法开始</strong><p>导入完整小说或精选片段，再为每本书注明想参考的部分，例如日常对白、动作描写、轻松语气。</p></div>
      <div v-else class="reference-books">
        <article v-for="book in bookDrafts" :key="book.id" class="reference-book" :class="{ muted: !book.enabled }">
          <div class="reference-book-top"><label class="reference-check"><input v-model="book.enabled" type="checkbox" :disabled="busy" /><span>参与分析</span></label><small>{{ book.char_count.toLocaleString() }} 字符</small></div>
          <label><span class="reference-label">书名</span><input v-model="book.title" :disabled="busy" maxlength="200" /></label>
          <label><span class="reference-label">想参考什么</span><textarea v-model="book.focus" :disabled="busy" rows="2" maxlength="500" placeholder="例如：对白自然，关键场面写细，赶路和重复流程简略带过。" /></label>
          <div class="reference-book-options"><label><span class="reference-label">参考优先级</span><select v-model.number="book.priority" :disabled="busy"><option :value="2">主参考</option><option :value="1">同等参考</option><option :value="0">辅助参考</option></select></label><label><span class="reference-label">选样方式</span><select v-model="book.sample_mode" :disabled="busy"><option value="auto">自动抽样</option><option value="scenes">所选完整场景</option></select></label></div>
          <details class="reference-chosen-scenes"><summary>查看与调整选段（{{ book.excerpts.length }}）</summary><div v-for="(scene, index) in book.excerpts" :key="index"><label v-if="scene.use === '底色'" class="reference-check"><input type="radio" :name="'primary-' + book.id" :checked="scene.primary" :disabled="busy" @change="book.excerpts.forEach(s => s.primary = s === scene)" />固定底色</label><details><summary>{{ scene.label }} · {{ scene.text.length.toLocaleString() }} 字符</summary><p class="reference-excerpt-text">{{ scene.text }}</p></details><select :value="scene.use || '仅分析'" aria-label="选段用途" :disabled="busy" @change="scene.use = $event.target.value"><option>仅分析</option><option :disabled="scene.text.length > 600">底色</option><option v-for="purpose in purposes" :key="purpose" :disabled="scene.text.length > 600">{{ purpose }}</option></select><button type="button" :disabled="busy" @click="book.excerpts.splice(index, 1)">移除样本</button></div><button type="button" :disabled="busy" @click="fillExcerpts(book)">按用途自动补选</button><button type="button" :disabled="busy || book.excerpts.length >= 27" @click="pickerBookId = book.id">从章节选择场景</button></details>
          <footer><button type="button" :disabled="busy || !bookChanged(book)" @click="saveBook(book)">保存参考重点</button><button class="reference-subtle" type="button" :disabled="busy" @click="removeBook(book)">移除</button></footer>
        </article>
      </div>
      <ReferenceScenePicker v-if="pickerBook" :key="pickerBook.id" :project-id="project.id" :book="pickerBook" @selected="addScene" @close="pickerBookId = ''" />
      <section class="reference-analysis" aria-label="分析设置">
        <h3>提炼文风规范</h3>
        <label><span class="reference-label">参考分析提示词</span><select v-model="analysisPreset" :disabled="busy" @change="rememberOptions"><option value="reference-language">按选段提炼语言、对白与详略</option><option value="">常规分析</option></select></label>
        <label><span class="reference-label">偏好与需要改善的用词</span><textarea v-model="preference" :disabled="busy" rows="3" maxlength="1200" placeholder="例如：用词别扭、对白太像书面语，希望接近热门小说那种顺畅、自然的表达。也可以粘贴你觉得生硬的一两句。" /></label>
        <label><span class="reference-label">参考冲突时如何取舍</span><textarea v-model="conflictPolicy" :disabled="busy" rows="2" maxlength="1200" placeholder="例如：以甲书的对白和情绪为主，乙书补充环境描写；冲突场景加快，日常场景保留趣味。" /></label>
        <label><span class="reference-label">贴近参考文风 · 底色来源</span><select v-model="voiceBook" :disabled="busy"><option value="">关闭选段随稿发送</option><option v-for="book in voiceBooks" :key="book.id" :value="book.content_digest">{{ book.title }}</option></select></label>
        <label><span class="reference-label">补充选段用途</span><select v-model="voicePurpose" :disabled="busy"><option value="auto">按本场叙述功能匹配</option><option value="base">只用底色</option><option v-for="purpose in purposes" :key="purpose">{{ purpose }}</option></select></label><p class="reference-hint">首次导入时，第一本选出底色的参考小说会成为底色来源。正文写作和改稿使用一段底色，按本次要求、选区和章节安排最多再选一段。用途不明确时只用底色。可在上方更换来源或关闭随稿发送。已有参考书可点「按用途自动补选」，再保存参考重点。</p>
        <div><button type="button" :disabled="busy || !settingsDirty || booksDirty" @click="saveSettings">保存分析偏好</button><small v-if="settingsDirty" class="reference-hint"> 偏好有修改，保存后用于分析。</small></div>
        <div class="reference-analyze-actions">
          <label class="reference-model"><span class="reference-label">分析模型</span><select v-model="modelId" :disabled="busy"><option value="">跟随规划模型</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
          <CreativeExecutionControl :default-mode="defaultMode" :app-model-label="modelLabel" action-label="分析并生成规范" busy-label="正在分析…" :busy="analyzing" :disabled="busy || dirty || state.pendingMerge || !state.books.some(book => book.enabled) || booksDirty || settingsDirty" @execute="analyze" />
          <button v-if="analyzing" type="button" @click="cancelAnalysis">停止分析</button>
          <button type="button" :disabled="busy || booksDirty || settingsDirty || !state.books.some(book => book.enabled)" @click="previewSamples">查看抽样</button>
        </div>
        <p v-if="booksDirty" class="reference-hint">参考书资料有修改，先保存参考重点，再开始分析。</p>
        <p class="reference-hint">自动抽样与所选场景可混用，样本合计最多48,000字符。分析会说明各书取舍、适用场景、详略条件、人物因果与信息边界，观察范围以样本为准。</p>
        <details v-if="samplePacket" class="reference-samples" open><summary>本次抽样 · {{ samplePacket.books.length }} 本书</summary><article v-for="book in samplePacket.books" :key="book.id"><h4>{{ book.title }}</h4><details v-for="part in book.excerpts" :key="part.position"><summary>{{ part.position }}</summary><pre>{{ part.text }}</pre></details></article></details>
      </section>
      <section class="reference-guide" aria-label="文风规范草稿">
        <div class="reference-guide-heading"><h3>文风规范</h3><span>{{ state.applied ? (state.appliedText === guideText.trim() ? '已应用到本书' : '写作仍使用上次确认的规范') : '待确认应用' }}{{ dirty ? ' · 草稿未保存' : '' }}</span></div>
        <div v-if="state.pendingMerge" class="reference-analysis" aria-label="待确认的合并稿">
          <details><summary>对照原规范草稿</summary><p class="reference-excerpt-text">{{ state.guide.draft_text }}</p></details>
          <label><span class="reference-label">合并后的规范（可编辑）</span><textarea v-model="mergeText" rows="12" maxlength="8000" :disabled="busy" /></label>
          <div><button type="button" :disabled="busy || !mergeText.trim()" @click="reviewMerge(false)">保存合并稿</button> <button type="button" :disabled="busy" @click="reviewMerge(true)">保留原草稿</button></div>
        </div>
        <p v-if="outdated" class="reference-warning">参考书或参考重点已变化。请重新分析，或核对并保存现有规范后再应用。</p>
        <label v-if="!state.pendingMerge"><span class="reference-label">可直接编辑，确认后用于后续写作</span><textarea v-model="guideText" :disabled="busy || Boolean(state.pendingMerge)" rows="18" maxlength="8000" placeholder="分析结果会出现在这里。你可以调整语气、描写详略、用词、对白和审稿检查项。" /></label>
        <div v-if="!state.pendingMerge" class="reference-guide-footer"><small>{{ guideText.length.toLocaleString() }} / 8,000 字符</small><div><button type="button" :disabled="busy || state.pendingMerge || !guideText.trim()" @click="saveGuide">保存规范草稿</button><button class="reference-primary" type="button" :disabled="busy || state.pendingMerge || !guideText.trim() || dirty || outdated || booksDirty || settingsDirty" @click="applyGuide(false)">确认应用到本书</button><button v-if="state.applied" type="button" :disabled="busy" @click="applyGuide(true)">停用参考规范</button></div></div>
        <p class="reference-hint">应用后，带【通用】【对白】【详略】【冲突】【视角】【情绪】【改稿】标签的规则按场景选取，最多四条。旧版无标签规范沿用全文。可在生成记录的任务凭证中核对本次发送的规则。</p>
      </section>
      <ReferenceComparison :key="project.id" :project-id="project.id" :guide="state.guide?.draft_text" :history="state.comparisons" :model-id="modelId" :model-label="modelLabel" :disabled="busy || !canCalibrate" @changed="refreshComparisons" />
      <section class="reference-calibration" aria-label="试写校准">
        <h3>试写校准</h3><p class="reference-hint">保存规范后，分别试写日常与冲突场景。写下喜欢和需要调整的地方，再根据反馈校准规范。每类保留最新一段试写。</p>
        <p v-if="dirty || outdated || booksDirty || settingsDirty" class="reference-warning">请先保存参考资料与偏好，核对并保存当前规范，再开始试写。</p>
        <article v-for="trial in trialDrafts" :key="trial.kind" class="reference-trial">
          <h4>{{ trial.kind === 'daily' ? '日常互动' : '冲突与选择' }}</h4>
          <label><span class="reference-label">试写场景</span><textarea v-model="trial.brief" :disabled="busy" rows="2" maxlength="1200" /></label>
          <CreativeExecutionControl :default-mode="defaultMode" :app-model-label="modelLabel" action-label="生成试写片段" :busy="analyzing" :disabled="busy || !canCalibrate || !trial.brief.trim()" @execute="analyze($event, 'trial', trial)" />
          <template v-if="trial.text">
            <p v-if="!trialCurrent(trial)" class="reference-warning">这段试写使用的规范或参考资料已变化，请重新试写后再参与校准。</p>
            <label><span class="reference-label">试写片段</span><textarea v-model="trial.text" :disabled="busy" rows="7" maxlength="8000" /></label>
            <button type="button" :disabled="busy || !trialCurrent(trial) || !trialOutputChanged(trial)" @click="saveTrial(trial)">保存试写片段</button>
            <label><span class="reference-label">你的反馈</span><textarea v-model="trial.feedback" :disabled="busy || trialOutputChanged(trial)" rows="3" maxlength="1200" placeholder="例如：人物停顿自然，保留；端杯子的动作太碎，过渡压成一句。希望冲突更直接。" /></label>
            <button type="button" :disabled="busy || !trialCurrent(trial) || trialOutputChanged(trial) || !trial.feedback.trim()" @click="saveFeedback(trial)">保存反馈</button>
          </template>
        </article>
        <CreativeExecutionControl :default-mode="defaultMode" :app-model-label="modelLabel" action-label="根据反馈校准规范" :busy="analyzing" :disabled="busy || !canCalibrate || !hasSavedFeedback || trialsDirty" @execute="analyze($event, 'refine')" />
        <p v-if="trialsDirty" class="reference-hint">试写或反馈有修改，保存后再校准规范。</p>
        <p class="reference-hint">校准结果先进入规范草稿，确认应用后用于后续写作。反馈只用于对应试写条件，避免变成全书的绝对规则。</p>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { draftDigest } from '../utils/inline-creative.js'
import CreativeExecutionControl from './CreativeExecutionControl.vue'
import { voicePurposes } from '../../electron/reference-voice.js'
import ReferenceComparison from './ReferenceComparison.vue'
import ReferenceScenePicker from './ReferenceScenePicker.vue'
const purposes = Object.keys(voicePurposes)
const props = defineProps({ project: { type: Object, required: true }, modelSettings: { type: Object, default: () => ({}) } })
const emit = defineEmits(['toast', 'applied', 'codex-action', 'count'])
const state = ref(null), bookDrafts = ref([]), guideText = ref(''), guideSource = ref('')
const error = ref(''), notice = ref(''), preference = ref(''), conflictPolicy = ref(''), modelId = ref(''), samplePacket = ref(null), pickerBookId = ref('')
const importing = ref(false), saving = ref(false), analyzing = ref(false), trialDrafts = ref([])
let generation = null, epoch = 0, disposed = false
const analysisPreset = ref('reference-language'), importMode = ref('app_model'), mergeText = ref('')
function rememberOptions() {
  localStorage.setItem('reference-import:' + props.project.id, JSON.stringify({ importMode: importMode.value, analysisPreset: analysisPreset.value }))
}
const busy = computed(() => importing.value || saving.value || analyzing.value)
const profiles = computed(() => (props.modelSettings.profiles || []).filter(profile => profile.enabled !== false && profile.enabled !== 0))
const defaultMode = computed(() => props.project.default_execution_mode === 'codex' ? 'codex' : 'app_model')
const modelLabel = computed(() => profiles.value.find(profile => profile.id === (modelId.value || props.modelSettings.routes?.planning_field))?.name || '规划模型')
const dirty = computed(() => guideText.value !== (state.value?.guide?.draft_text || '') || guideSource.value !== (state.value?.guide?.source_digest || ''))
const outdated = computed(() => Boolean(guideText.value && guideSource.value !== state.value?.sourceDigest))
const booksDirty = computed(() => bookDrafts.value.some(bookChanged))
const voiceBook = ref(''), voicePurpose = ref('auto')
const voiceBooks = computed(() => (state.value?.books || []).filter(b => b.enabled && b.excerpts.some(s => s.use === '底色')))
const settingsDirty = computed(() => voicePurpose.value !== (state.value?.settings?.voicePurpose || 'auto') || voiceBook.value !== (state.value?.settings?.voiceBook || '') || preference.value !== (state.value?.settings?.preference || '') || conflictPolicy.value !== (state.value?.settings?.conflictPolicy || ''))
const pickerBook = computed(() => bookDrafts.value.find(book => book.id === pickerBookId.value))
const canCalibrate = computed(() => Boolean(state.value?.guide?.draft_text) && !state.value?.pendingMerge && !dirty.value && !outdated.value && !booksDirty.value && !settingsDirty.value)
const hasSavedFeedback = computed(() => state.value?.comparisons.some(row => row.verdict && row.guide_digest === state.value.guideDigest && row.source_digest === state.value.sourceDigest) || state.value?.trials.some(trial => trial.guide_digest === state.value.guideDigest && trial.source_digest === state.value.sourceDigest && trial.author_feedback.trim()))
const trialsDirty = computed(() => trialDrafts.value.some(trial => trial.text && (trialOutputChanged(trial) || trial.feedback !== (storedTrial(trial.kind)?.author_feedback || ''))))
function bookFields(book) { return [book.title, book.focus, Boolean(book.enabled), book.priority, book.sample_mode, book.excerpts] }
function bookChanged(book) {
  const original = state.value?.books.find(item => item.id === book.id)
  return original && JSON.stringify(bookFields(book)) !== JSON.stringify(bookFields(original))
}
function storedTrial(kind) { return state.value?.trials.find(trial => trial.kind === kind) }
function trialCurrent(trial) { return trial.guideDigest === state.value?.guideDigest && trial.sourceDigest === state.value?.sourceDigest }
function trialOutputChanged(trial) { const row = storedTrial(trial.kind); return trial.text !== (row?.output_text || '') || trial.brief !== (row?.brief || '') }
function accept(value, { replaceGuide = true, replaceSettings = false, savedBookId = '', savedTrialKind = '' } = {}) {
  const unsavedBooks = bookDrafts.value.filter(book => book.id !== savedBookId && bookChanged(book))
  const unsavedTrials = trialDrafts.value.filter(trial => trial.kind !== savedTrialKind && (trialOutputChanged(trial) || trial.feedback !== (storedTrial(trial.kind)?.author_feedback || '')))
  if (voiceBook.value && !value.books.some(book => book.enabled && book.content_digest === voiceBook.value && book.excerpts.some(sample => sample.use === '底色'))) voiceBook.value = ''
  if (state.value?.pendingMerge?.id !== value.pendingMerge?.id) mergeText.value = value.pendingMerge?.text || ''
  state.value = value
  emit('count', value.books.length)
  bookDrafts.value = value.books.map(book => unsavedBooks.find(draft => draft.id === book.id) || ({ ...book, enabled: Boolean(book.enabled), excerpts: book.excerpts.map(sample => ({ ...sample })) }))
  if (replaceGuide) { guideText.value = value.guide?.draft_text || ''; guideSource.value = value.guide?.source_digest || '' }
  if (replaceSettings) { voicePurpose.value = value.settings.voicePurpose || 'auto'; voiceBook.value = value.settings.voiceBook || ''; preference.value = value.settings.preference; conflictPolicy.value = value.settings.conflictPolicy }
  trialDrafts.value = ['daily', 'conflict'].map(kind => {
    const old = unsavedTrials.find(trial => trial.kind === kind)
    if (old) return old
    const row = value.trials.find(trial => trial.kind === kind)
    return { kind, text: row?.output_text || '', feedback: row?.author_feedback || '', guideDigest: row?.guide_digest || '', sourceDigest: row?.source_digest || '',
      brief: row?.brief || (kind === 'daily' ? '两位熟人在一件小事上各有打算，用自然对白与适量生活细节呈现关系和趣味。' : '一方想争取机会，另一方提出条件。让人物根据可知信息选择和行动，在关键转折处展开细节。') }
  })
}
function valid(projectId, token) { return !disposed && props.project.id === projectId && token === epoch }
async function load() {
  const projectId = props.project.id, token = ++epoch
  try { const value = await appService.loadReferenceNovels({ projectId }); if (valid(projectId, token)) { accept(value, { replaceSettings: true }); error.value = '' } }
  catch (e) { if (valid(projectId, token)) error.value = e.message }
}
async function operation(work) {
  const projectId = props.project.id, token = epoch
  error.value = ''; notice.value = ''; saving.value = true
  try { const value = await work(projectId); if (valid(projectId, token) && value) return value }
  catch (e) { if (valid(projectId, token)) error.value = e.message }
  finally { if (valid(projectId, token)) saving.value = false }
}
async function refreshComparisons() {
  const projectId = props.project.id, token = epoch
  try {
    const next = await appService.loadReferenceNovels({ projectId })
    if (valid(projectId, token)) state.value.comparisons = next.comparisons
  } catch (e) { if (valid(projectId, token)) error.value = e.message }
}
async function importBooks() {
  const project = props.project.id, token = epoch
  importing.value = true
  const result = await operation(projectId => appService.importReferenceNovels({ projectId, analyzeWith: importMode.value, analysisPreset: analysisPreset.value, modelProfileId: modelId.value }))
  if (!valid(project, token)) return
  if (result && !result.cancelled) {
    if (voiceBook.value === (state.value?.settings.voiceBook || '')) voiceBook.value = result.settings.voiceBook || ''
    accept(result, { replaceGuide: Boolean(result.generatedDraft) })
    notice.value = `已导入 ${result.added} 本${result.skipped.length ? `，跳过 ${result.skipped.length} 本重复内容` : ''}`
    if (result.generatedDraft) notice.value += result.pendingMerge ? '。已结合原草稿生成合并稿，请对照后保存。' : '。文风规范草稿已保存，可核对后应用。'
    if (result.analysisError) error.value = '书籍已导入，分析未完成：' + result.analysisError
  }
  importing.value = false
}
async function fillExcerpts(book) {
  const samples = await operation(projectId => appService.browseReferenceNovel({ projectId, bookId: book.id, autoSelect: true }))
  if (!samples) return
  const existing = book.excerpts.filter(s => s.use && s.use !== '仅分析')
  const additions = samples.filter(sample => !existing.some(s => s.use === sample.use || s.text === sample.text))
    .slice(0, Math.max(0, 24 - existing.length))
  book.excerpts.push(...additions)
  notice.value = additions.length ? `已补选 ${additions.length} 段，保存参考重点后生效。` : '没有找到适合补充的新用途选段。'
}
async function saveBook(book) {
  const value = await operation(projectId => appService.updateReferenceNovel({ projectId, ...book, excerpts: book.excerpts.map(sample => ({ ...sample })) }))
  if (value) { accept(value, { replaceGuide: false, savedBookId: book.id }); samplePacket.value = null; notice.value = '参考重点已保存' }
}
async function removeBook(book) {
  if (!window.confirm(`移除参考小说《${book.title}》？已生成的文风规范会继续保留。`)) return
  const value = await operation(projectId => appService.deleteReferenceNovel({ projectId, id: book.id }))
  if (value) { accept(value, { replaceGuide: false }); samplePacket.value = null }
}
function addScene(sample) {
  if (!pickerBook.value) return
  const writing = Boolean(sample.use && sample.use !== '仅分析')
  const count = pickerBook.value.excerpts.filter(s => Boolean(s.use && s.use !== '仅分析') === writing).length
  if (count >= (writing ? 24 : 3)) { error.value = writing ? '写作样本最多24个' : '分析场景最多3个'; return }
  pickerBook.value.excerpts.push(sample); pickerBookId.value = ''; notice.value = '场景已加入，保存参考重点后参与分析'
}
async function saveSettings() {
  const value = await operation(projectId => appService.saveReferenceSettings({ projectId, voiceBook: voiceBook.value, voicePurpose: voicePurpose.value, preference: preference.value, conflictPolicy: conflictPolicy.value, revision: state.value.guide?.settings_revision || 0 }))
  if (value) { accept(value, { replaceGuide: false, replaceSettings: true }); samplePacket.value = null; notice.value = '分析偏好已保存' }
}
async function previewSamples() {
  const value = await operation(projectId => appService.referenceAnalysisPacket({ projectId }))
  if (value) samplePacket.value = value
}
async function reviewMerge(discardMerge) {
  const value = await operation(projectId => appService.saveReferenceGuide({ projectId, revision: state.value.guide.revision, mergeId: state.value.pendingMerge.id, text: mergeText.value, discardMerge }))
  if (value) { accept(value); notice.value = discardMerge ? '已保留原规范草稿' : '合并稿已保存，可核对后应用到本书' }
}
async function saveGuide() {
  const value = await operation(projectId => appService.saveReferenceGuide({ projectId, text: guideText.value,
    sourceDigest: state.value.sourceDigest, revision: state.value.guide?.revision || 0 }))
  if (value) { accept(value); notice.value = '规范草稿已保存，可确认应用到本书' }
}
async function applyGuide(disable) {
  const value = await operation(projectId => appService.applyReferenceGuide({ projectId, disable,
    revision: state.value.guide?.revision, expectedStyle: state.value.projectStyle }))
  if (value) { accept(value, { replaceGuide: !disable }); emit('applied', { style: value.projectStyle }); notice.value = disable ? '参考规范已停用' : '规范已应用，后续写作会使用本书文风'; emit('toast', notice.value) }
}
async function saveTrial(trial) {
  const value = await operation(projectId => appService.saveReferenceTrial({ projectId, kind: trial.kind, brief: trial.brief, text: trial.text,
    guideDigest: trial.guideDigest, sourceDigest: trial.sourceDigest, revision: storedTrial(trial.kind)?.revision || 0 }))
  if (value) { accept(value, { replaceGuide: false, savedTrialKind: trial.kind }); notice.value = '试写片段已保存，可以填写反馈' }
}
async function saveFeedback(trial) {
  const value = await operation(projectId => appService.saveReferenceTrial({ projectId, kind: trial.kind, feedbackOnly: true, feedback: trial.feedback, revision: storedTrial(trial.kind)?.revision || 0 }))
  if (value) { accept(value, { replaceGuide: false, savedTrialKind: trial.kind }); notice.value = '试写反馈已保存，可根据反馈校准规范' }
}
async function analyze(executionMode, mode = 'analysis', trial = null) {
  const projectId = props.project.id, token = epoch, kind = trial?.kind || '', brief = trial?.brief || ''
  error.value = ''; notice.value = ''; analyzing.value = true; pickerBookId.value = ''
  try {
    const preset = mode === 'analysis' ? analysisPreset.value : ''
    const packet = await appService.referenceAnalysisPacket({ projectId, mode, kind, brief, analysisPreset: preset })
    if (!valid(projectId, token)) return
    if (packet.books) samplePacket.value = packet
    if (mode === 'trial' && trial.text && !window.confirm('生成新的试写片段会替换这类场景的上次试写和反馈，继续？')) return
    const currentTrial = () => trialDrafts.value.find(item => item.kind === kind)
    const fill = text => {
      if (mode === 'trial') Object.assign(currentTrial(), { text, feedback: '', guideDigest: packet.guideDigest, sourceDigest: packet.sourceDigest })
      else { guideText.value = text; guideSource.value = packet.sourceDigest }
    }
    const guideRevision = state.value.guide?.revision || 0, trialRevision = storedTrial(kind)?.revision || 0
    if (executionMode === 'codex') {
      const snapshot = () => draftDigest({ guide: guideText.value, books: bookDrafts.value, preference: preference.value, conflictPolicy: conflictPolicy.value, trials: trialDrafts.value, projectId: props.project.id })
      emit('codex-action', {
        request: { projectId, task: 'planning_field', intent: 'analysis', instruction: packet.instruction,
          target: { kind: mode === 'trial' ? 'reference_trial_draft' : 'reference_style_draft', targetId: projectId, fieldKey: mode === 'trial' ? kind : 'referenceGuide', fieldLabel: mode === 'trial' ? '文风试写片段' : mode === 'refine' ? '根据反馈校准文风规范' : '参考小说文风规范', draftDigest: snapshot() } },
        getDraftDigest: snapshot, getDraftValue: () => mode === 'trial' ? currentTrial()?.text || '' : guideText.value,
        applyDraft: async text => { if (valid(projectId, token)) {
          if (mode !== 'trial' && state.value.guide?.draft_text) {
            const value = await operation(() => appService.saveReferenceGuide({ projectId, text, mode, analysisPreset: preset, inputDigest: packet.inputDigest, sourceDigest: packet.sourceDigest, revision: guideRevision }))
            if (value) { accept(value); notice.value = '已生成合并稿，请对照后保存' }
            return
          }
          fill(text); notice.value = mode === 'trial' ? '试写候选已填入，请保存试写片段后填写反馈' : '候选已填入，请核对并保存规范草稿' } },
      })
      return
    }
    generation = appService.startGeneration({ task: 'planning_field', intent: 'analysis', projectId,
      modelProfileId: modelId.value || props.modelSettings.routes?.planning_field,
      referenceStyleAnalysis: true, referenceAnalysisPreset: preset, referenceMode: mode, referenceKind: kind, referenceBrief: brief, referenceInputDigest: packet.inputDigest, referenceSourceDigest: packet.sourceDigest,
      planning: { targetType: 'renderer_draft', fieldKey: mode === 'trial' ? kind : 'referenceGuide', fieldLabel: mode === 'trial' ? '文风试写片段' : '参考小说文风规范', scopeType: 'project', scopeId: projectId } })
    const result = await generation.promise
    if (!valid(projectId, token)) return
    if (result.cancelled) { notice.value = '本次生成已停止'; return }
    const text = result.text?.trim()
    if (!text) throw new Error('模型没有返回内容，请切换模型后重试')
    if (mode === 'trial' || !state.value.guide?.draft_text) fill(text)
    const value = mode === 'trial'
      ? await appService.saveReferenceTrial({ projectId, kind, brief, text, guideDigest: packet.guideDigest, sourceDigest: packet.sourceDigest, revision: trialRevision })
      : await appService.saveReferenceGuide({ projectId, text, mode, analysisPreset: preset, inputDigest: packet.inputDigest, sourceDigest: packet.sourceDigest, revision: guideRevision })
    if (valid(projectId, token)) {
      accept(value, { replaceGuide: mode !== 'trial', savedTrialKind: kind })
      notice.value = mode === 'trial' ? '试写片段已保存，可以填写反馈' : value.pendingMerge ? '已生成合并稿，请对照后保存' : '分析完成，规范草稿已保存。核对后可应用到本书'
    }
  } catch (e) { if (valid(projectId, token)) error.value = e.message }
  finally { if (valid(projectId, token)) { generation = null; analyzing.value = false } }
}
function cancelAnalysis() { void generation?.cancel() }
watch(() => props.project.id, () => {
  void generation?.cancel(); generation = null; state.value = null; samplePacket.value = null; pickerBookId.value = ''
  bookDrafts.value = []; trialDrafts.value = []
  importing.value = false; saving.value = false; analyzing.value = false; preference.value = ''; conflictPolicy.value = ''; notice.value = ''; error.value = ''
  let options = {}
  try { options = JSON.parse(localStorage.getItem('reference-import:' + props.project.id) || '{}') } catch {}
  importMode.value = ['off', 'codex', 'app_model'].includes(options.importMode) ? options.importMode : defaultMode.value
  analysisPreset.value = options.analysisPreset === '' ? '' : 'reference-language'
  guideText.value = ''; guideSource.value = ''; mergeText.value = ''; modelId.value = ''
  void load()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; epoch++; void generation?.cancel() })
</script>

<style scoped>
.reference-novels{display:grid;gap:22px;min-width:0;color:var(--ns-text,#29444b)}
.reference-heading,.reference-guide-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.reference-heading h2{margin:7px 0;font-family:var(--font-display,serif);font-size:26px}.reference-heading p{margin:0;line-height:1.7;color:var(--ns-text-muted,#657e87)}
.reference-novels button,.reference-novels input,.reference-novels select,.reference-novels textarea{font:inherit}
.reference-novels button{padding:10px 14px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px;background:var(--ns-surface,#fff);color:inherit;cursor:pointer;white-space:normal}
.reference-novels button:disabled{opacity:.5;cursor:default}.reference-novels :focus-visible{outline:2px solid var(--ns-accent,#41766e);outline-offset:3px}
.reference-novels label{display:grid;gap:7px}.reference-label{font-size:12px;font-weight:600;color:var(--ns-text-muted,#657e87)}
.reference-novels input:not([type=checkbox]),.reference-novels textarea,.reference-novels select{box-sizing:border-box;width:100%;min-width:0;padding:11px 12px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px;color:inherit;background:var(--ns-surface,#fff);line-height:1.7}
.reference-novels textarea{resize:vertical}.reference-hint{font-size:12px;line-height:1.8;color:var(--ns-text-muted,#657e87);margin:0}
.reference-books{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(245px,100%),1fr));gap:12px}.reference-book{display:grid;gap:12px;padding:17px;border:1px solid var(--ns-border,#bdcfd2);border-radius:12px;border-top:3px solid var(--ns-accent,#41766e);background:var(--ns-surface,#fff)}.reference-book.muted{border-top-color:var(--ns-border,#bdcfd2)}
.reference-book-top,.reference-book footer{display:flex;justify-content:space-between;align-items:center;gap:8px}.reference-book-top small{color:var(--ns-text-muted,#657e87);font-size:11px}.reference-novels .reference-check{display:flex;align-items:center;font-size:12px}.reference-check input{accent-color:var(--ns-accent,#41766e)}
.reference-novels .reference-subtle{border:0;background:transparent;color:var(--ns-text-muted,#657e87)}
.reference-analysis,.reference-guide,.reference-calibration{display:grid;gap:14px;padding-top:20px;border-top:1px solid var(--ns-border,#bdcfd2)}.reference-novels h3{margin:0;font-size:19px}.reference-analyze-actions{display:flex;align-items:end;flex-wrap:wrap;gap:12px}.reference-model{flex:1;min-width:180px}.reference-guide-heading span{font-size:12px;color:var(--ns-accent,#41766e)}
.reference-guide-footer{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center}.reference-guide-footer>div{display:flex;gap:8px;flex-wrap:wrap}.reference-guide-footer small{color:var(--ns-text-muted,#657e87)}.reference-novels .reference-primary{background:var(--ns-accent,#41766e);color:white}
.reference-error,.reference-warning{background:#fff5e7;color:#85522a;padding:12px 15px;border-radius:8px;font-size:13px;line-height:1.7;margin:0}.reference-notice{padding:12px 15px;background:var(--ns-accent-soft,#e2efeb);border-radius:8px;line-height:1.7;margin:0;font-size:13px}
.reference-empty{padding:24px;border:1px dashed var(--ns-border,#bdcfd2);border-radius:12px;color:var(--ns-text-muted,#657e87);line-height:1.8}.reference-empty strong{color:var(--ns-text,#29444b)}.reference-empty p{margin-bottom:0;font-size:13px}
.reference-samples{padding:13px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px}.reference-samples summary{cursor:pointer;font-size:13px;line-height:1.8}.reference-samples h4{font-size:14px;margin:16px 0 5px}.reference-samples pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 var(--font-ui,sans-serif);max-height:240px;overflow:auto}
@media(max-width:600px){.reference-heading{flex-direction:column}.reference-heading button{width:100%}.reference-guide-heading{flex-wrap:wrap}}
.reference-book-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.reference-chosen-scenes summary{cursor:pointer}.reference-chosen-scenes>div,.reference-chosen-scenes>button{margin-top:9px}.reference-excerpt-text{white-space:pre-wrap;overflow-wrap:anywhere}.reference-chosen-scenes>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;font-size:12px;align-items:center}.reference-trial{display:grid;gap:12px;padding:18px;border:1px solid var(--ns-border,#bdcfd2);border-radius:10px;background:var(--ns-surface,#fff)}.reference-trial h4{margin:0}.reference-trial>button{justify-self:start}
</style>
