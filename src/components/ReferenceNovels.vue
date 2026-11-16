<template>
  <section class="reference-novels" aria-label="参考小说">
    <header class="reference-heading">
      <div><span class="eyebrow">REFERENCE LIBRARY</span><h2>参考小说</h2><p>选几本喜欢的小说，提炼表达习惯，形成这本书自己的文风。</p></div>
      <button type="button" :disabled="busy" @click="importBooks">{{ importing ? '正在读取…' : '＋ 导入小说' }}</button>
    </header>
    <p v-if="error" class="reference-error" role="alert">{{ error }} <button type="button" @click="load">刷新资料</button></p>
    <p v-if="notice" class="reference-notice" role="status">{{ notice }}</p>
    <p class="reference-hint">支持 TXT、Markdown、Word DOCX，可多选，每本最大 10 MB。参考资料按当前作品保存；点击分析后，会把选中书籍的抽样片段发送给所选模型。</p>
    <div v-if="!state" class="reference-empty">正在读取参考资料…</div>
    <template v-else>
      <div v-if="!state.books.length" class="reference-empty"><strong>从你喜欢的写法开始</strong><p>导入完整小说或精选片段，再为每本书注明想参考的部分，例如日常对白、动作描写、轻松语气。</p></div>
      <div v-else class="reference-books">
        <article v-for="book in bookDrafts" :key="book.id" class="reference-book" :class="{ muted: !book.enabled }">
          <div class="reference-book-top"><label class="reference-check"><input v-model="book.enabled" type="checkbox" :disabled="busy" /><span>参与分析</span></label><small>{{ book.char_count.toLocaleString() }} 字符</small></div>
          <label><span class="reference-label">书名</span><input v-model="book.title" :disabled="busy" maxlength="200" /></label>
          <label><span class="reference-label">想参考什么</span><textarea v-model="book.focus" :disabled="busy" rows="2" maxlength="500" placeholder="例如：对白自然、动作有细节；少用旁白解释，不参考升级节奏。" /></label>
          <footer><button type="button" :disabled="busy || !bookChanged(book)" @click="saveBook(book)">保存参考重点</button><button class="reference-subtle" type="button" :disabled="busy" @click="removeBook(book)">移除</button></footer>
        </article>
      </div>
      <section class="reference-analysis" aria-label="分析设置">
        <h3>提炼文风规范</h3>
        <label><span class="reference-label">偏好与需要改善的用词</span><textarea v-model="preference" :disabled="busy" rows="3" maxlength="1200" placeholder="例如：用词别扭、对白太像书面语，希望接近热门小说那种顺畅、自然的表达。也可以粘贴你觉得生硬的一两句。" /></label>
        <div class="reference-analyze-actions">
          <label class="reference-model"><span class="reference-label">分析模型</span><select v-model="modelId" :disabled="busy"><option value="">跟随规划模型</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option></select></label>
          <CreativeExecutionControl :default-mode="defaultMode" :app-model-label="modelLabel" action-label="分析并生成规范" busy-label="正在分析…" :busy="analyzing" :disabled="busy || !state.books.some(book => book.enabled) || booksDirty" @execute="analyze" />
          <button v-if="analyzing" type="button" @click="cancelAnalysis">停止分析</button>
          <button type="button" :disabled="busy || booksDirty || !state.books.some(book => book.enabled)" @click="previewSamples">查看抽样</button>
        </div>
        <p v-if="booksDirty" class="reference-hint">参考书资料有修改，先保存参考重点，再开始分析。</p>
        <p class="reference-hint">从各书前段、中段和后段抽样，重点分析语气、描写、对白、用词搭配与句子衔接。模型观察范围以样本为准。</p>
        <details v-if="samplePacket" class="reference-samples" open><summary>本次抽样 · {{ samplePacket.books.length }} 本书</summary><article v-for="book in samplePacket.books" :key="book.id"><h4>{{ book.title }}</h4><details v-for="part in book.excerpts" :key="part.position"><summary>{{ part.position }}</summary><pre>{{ part.text }}</pre></details></article></details>
      </section>
      <section class="reference-guide" aria-label="文风规范草稿">
        <div class="reference-guide-heading"><h3>文风规范</h3><span>{{ state.applied ? '已应用到本书' : '待确认应用' }}{{ dirty ? ' · 草稿未保存' : '' }}</span></div>
        <p v-if="outdated" class="reference-warning">参考书或参考重点已变化。请重新分析，或核对并保存现有规范后再应用。</p>
        <label><span class="reference-label">可直接编辑，确认后用于后续写作</span><textarea v-model="guideText" :disabled="busy" rows="18" maxlength="8000" placeholder="分析结果会出现在这里。你可以调整语气、描写、用词、对白和审稿检查项。" /></label>
        <div class="reference-guide-footer"><small>{{ guideText.length.toLocaleString() }} / 8,000 字符</small><div><button type="button" :disabled="busy || !guideText.trim()" @click="saveGuide">保存规范草稿</button><button class="reference-primary" type="button" :disabled="busy || !guideText.trim() || dirty || outdated || booksDirty" @click="applyGuide(false)">确认应用到本书</button><button v-if="state.applied" type="button" :disabled="busy" @click="applyGuide(true)">停用参考规范</button></div></div>
        <p class="reference-hint">应用后加入本书的项目文风，后续生成、续写、改稿与审稿会读取这份规范。可在「三级文风」和右侧编译预览中核对。</p>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { appService } from '../services/app-service.js'
import { draftDigest } from '../utils/inline-creative.js'
import CreativeExecutionControl from './CreativeExecutionControl.vue'
const props = defineProps({ project: { type: Object, required: true }, modelSettings: { type: Object, default: () => ({}) } })
const emit = defineEmits(['toast', 'applied', 'codex-action', 'count'])
const state = ref(null), bookDrafts = ref([]), guideText = ref(''), guideSource = ref('')
const error = ref(''), notice = ref(''), preference = ref(''), modelId = ref(''), samplePacket = ref(null)
const importing = ref(false), saving = ref(false), analyzing = ref(false)
let generation = null, epoch = 0, disposed = false
const busy = computed(() => importing.value || saving.value || analyzing.value)
const profiles = computed(() => (props.modelSettings.profiles || []).filter(profile => profile.enabled !== false && profile.enabled !== 0))
const defaultMode = computed(() => props.project.default_execution_mode === 'codex' ? 'codex' : 'app_model')
const modelLabel = computed(() => profiles.value.find(profile => profile.id === (modelId.value || props.modelSettings.routes?.planning_field))?.name || '规划模型')
const dirty = computed(() => guideText.value !== (state.value?.guide?.draft_text || '') || guideSource.value !== (state.value?.guide?.source_digest || ''))
const outdated = computed(() => Boolean(guideText.value && guideSource.value !== state.value?.sourceDigest))
const booksDirty = computed(() => bookDrafts.value.some(bookChanged))
function bookChanged(book) {
  const original = state.value?.books.find(item => item.id === book.id)
  return original && (book.title !== original.title || book.focus !== original.focus || Boolean(book.enabled) !== Boolean(original.enabled))
}
function accept(value, replaceGuide = true, savedBookId = '') {
  const unsavedBooks = replaceGuide ? [] : bookDrafts.value.filter(book => book.id !== savedBookId && bookChanged(book))
  state.value = value
  emit('count', value.books.length)
  bookDrafts.value = value.books.map(book => unsavedBooks.find(draft => draft.id === book.id) || ({ ...book, enabled: Boolean(book.enabled) }))
  if (replaceGuide) { guideText.value = value.guide?.draft_text || ''; guideSource.value = value.guide?.source_digest || '' }
}
function valid(projectId, token) { return !disposed && props.project.id === projectId && token === epoch }
async function load() {
  const projectId = props.project.id, token = ++epoch
  try { const value = await appService.loadReferenceNovels({ projectId }); if (valid(projectId, token)) { accept(value); error.value = '' } }
  catch (e) { if (valid(projectId, token)) error.value = e.message }
}
async function operation(work) {
  const projectId = props.project.id, token = epoch
  error.value = ''; notice.value = ''; saving.value = true
  try { const value = await work(projectId); if (valid(projectId, token) && value) return value }
  catch (e) { if (valid(projectId, token)) error.value = e.message }
  finally { if (valid(projectId, token)) saving.value = false }
}
async function importBooks() {
  importing.value = true
  const result = await operation(projectId => appService.importReferenceNovels({ projectId }))
  if (result && !result.cancelled) {
    accept(result, false)
    notice.value = `已导入 ${result.added} 本${result.skipped.length ? `，跳过 ${result.skipped.length} 本重复内容` : ''}`
  }
  importing.value = false
}
async function saveBook(book) {
  const value = await operation(projectId => appService.updateReferenceNovel({ projectId, ...book }))
  if (value) { accept(value, false, book.id); samplePacket.value = null; notice.value = '参考重点已保存' }
}
async function removeBook(book) {
  if (!window.confirm(`移除参考小说《${book.title}》？已生成的文风规范会继续保留。`)) return
  const value = await operation(projectId => appService.deleteReferenceNovel({ projectId, id: book.id }))
  if (value) { accept(value, false); samplePacket.value = null }
}
async function previewSamples() {
  const projectId = props.project.id, token = epoch
  await operation(async () => { const packet = await appService.referenceAnalysisPacket({ projectId, preference: preference.value }); if (valid(projectId, token)) samplePacket.value = packet })
}
async function saveGuide() {
  const value = await operation(projectId => appService.saveReferenceGuide({ projectId, text: guideText.value,
    sourceDigest: state.value.sourceDigest, revision: state.value.guide?.revision || 0 }))
  if (value) { accept(value); notice.value = '规范草稿已保存，可确认应用到本书' }
}
async function applyGuide(disable) {
  const value = await operation(projectId => appService.applyReferenceGuide({ projectId, disable,
    revision: state.value.guide?.revision, expectedStyle: state.value.projectStyle }))
  if (value) { accept(value, !disable); emit('applied', { style: value.projectStyle }); notice.value = disable ? '参考规范已停用' : '规范已应用，后续写作会使用本书文风'; emit('toast', notice.value) }
}
async function analyze(mode) {
  const projectId = props.project.id, token = epoch
  error.value = ''; notice.value = ''; analyzing.value = true
  try {
    const packet = await appService.referenceAnalysisPacket({ projectId, preference: preference.value })
    if (!valid(projectId, token)) return
    samplePacket.value = packet
    if (guideText.value.trim() && !window.confirm('生成新规范会替换当前规范草稿，已应用的文风会保留到下次确认应用。继续分析？')) return
    if (mode === 'codex') {
      const snapshot = () => draftDigest({ guide: guideText.value, books: bookDrafts.value, preference: preference.value, projectId: props.project.id })
      emit('codex-action', {
        request: { projectId, task: 'planning_field', intent: 'analysis', instruction: packet.instruction,
          target: { kind: 'reference_style_draft', targetId: projectId, fieldKey: 'referenceGuide', fieldLabel: '参考小说文风规范', draftDigest: snapshot() } },
        getDraftDigest: snapshot, getDraftValue: () => guideText.value,
        applyDraft: text => { if (valid(projectId, token)) { guideText.value = text; guideSource.value = packet.sourceDigest; notice.value = '候选已填入，请核对并保存规范草稿' } },
      })
      return
    }
    const revision = state.value.guide?.revision || 0
    generation = appService.startGeneration({ task: 'planning_field', intent: 'analysis', projectId,
      modelProfileId: modelId.value || props.modelSettings.routes?.planning_field,
      referenceStyleAnalysis: true, referencePreference: preference.value, referenceSourceDigest: packet.sourceDigest,
      planning: { targetType: 'renderer_draft', fieldKey: 'referenceGuide', fieldLabel: '参考小说文风规范', scopeType: 'project', scopeId: projectId } })
    const result = await generation.promise
    if (!valid(projectId, token)) return
    if (result.cancelled) { notice.value = '本次分析已停止'; return }
    const text = result.text?.trim()
    if (!text) throw new Error('模型没有返回规范，请切换模型后重试')
    guideText.value = text
    guideSource.value = packet.sourceDigest
    const value = await appService.saveReferenceGuide({ projectId, text, sourceDigest: packet.sourceDigest, revision })
    if (valid(projectId, token)) { accept(value); notice.value = '分析完成，规范草稿已保存。核对后可应用到本书' }
  } catch (e) { if (valid(projectId, token)) error.value = e.message }
  finally { if (valid(projectId, token)) { generation = null; analyzing.value = false } }
}
function cancelAnalysis() { void generation?.cancel() }
watch(() => props.project.id, () => {
  void generation?.cancel(); generation = null; state.value = null; samplePacket.value = null
  importing.value = false; saving.value = false; analyzing.value = false; preference.value = ''; notice.value = ''; error.value = ''
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
.reference-analysis,.reference-guide{display:grid;gap:14px;padding-top:20px;border-top:1px solid var(--ns-border,#bdcfd2)}.reference-novels h3{margin:0;font-size:19px}.reference-analyze-actions{display:flex;align-items:end;flex-wrap:wrap;gap:12px}.reference-model{flex:1;min-width:180px}.reference-guide-heading span{font-size:12px;color:var(--ns-accent,#41766e)}
.reference-guide-footer{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center}.reference-guide-footer>div{display:flex;gap:8px;flex-wrap:wrap}.reference-guide-footer small{color:var(--ns-text-muted,#657e87)}.reference-novels .reference-primary{background:var(--ns-accent,#41766e);color:white}
.reference-error,.reference-warning{background:#fff5e7;color:#85522a;padding:12px 15px;border-radius:8px;font-size:13px;line-height:1.7;margin:0}.reference-notice{padding:12px 15px;background:var(--ns-accent-soft,#e2efeb);border-radius:8px;line-height:1.7;margin:0;font-size:13px}
.reference-empty{padding:24px;border:1px dashed var(--ns-border,#bdcfd2);border-radius:12px;color:var(--ns-text-muted,#657e87);line-height:1.8}.reference-empty strong{color:var(--ns-text,#29444b)}.reference-empty p{margin-bottom:0;font-size:13px}
.reference-samples{padding:13px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px}.reference-samples summary{cursor:pointer;font-size:13px;line-height:1.8}.reference-samples h4{font-size:14px;margin:16px 0 5px}.reference-samples pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 var(--font-ui,sans-serif);max-height:240px;overflow:auto}
@media(max-width:600px){.reference-heading{flex-direction:column}.reference-heading button{width:100%}.reference-guide-heading{flex-wrap:wrap}}
</style>
