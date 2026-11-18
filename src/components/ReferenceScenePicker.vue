<template>
  <section class="reference-picker" aria-label="完整场景选样">
    <header><div><h3>从《{{ book.title }}》选择场景</h3><p>短选段可用于写作底色或特定表达目的；完整场景可用于分析。</p></div><button type="button" @click="emit('close')">关闭选样</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="picker-row"><label>查找章节<input v-model="query" placeholder="章节名或序号" @keydown.enter.prevent="loadList(0)" /></label><button type="button" :disabled="busy" @click="loadList(0)">查找</button></div>
    <div class="picker-row"><label>选择章节<select v-model="chapterId" :disabled="busy" @change="loadChapter(0)"><option v-for="chapter in catalog.chapters" :key="chapter.index" :value="chapter.index">{{ chapter.index + 1 }} · {{ chapter.title }}</option></select></label><button type="button" :disabled="busy || !catalog.page" @click="loadList(catalog.page - 1)">上一组</button><span>{{ catalog.page + 1 }} / {{ catalog.pageCount }}</span><button type="button" :disabled="busy || catalog.page + 1 >= catalog.pageCount" @click="loadList(catalog.page + 1)">下一组</button></div>
    <template v-if="preview">
      <label>章节原文<textarea ref="original" :value="preview.text" readonly rows="9" /></label>
      <div class="picker-row"><button type="button" :disabled="busy || preview.length > 12000 || preview.offset > 0" @click="useWhole">使用本章</button><button type="button" :disabled="busy" @click="useSelection">使用选中段落</button><button type="button" :disabled="busy || !preview.offset" @click="loadChapter(Math.max(0, preview.offset - 16000))">前一段原文</button><button type="button" :disabled="busy || !preview.hasNext" @click="loadChapter(preview.offset + preview.text.length)">后一段原文</button></div>
      <small>本章 {{ preview.length.toLocaleString() }} 字符，当前显示 {{ preview.offset + 1 }}—{{ preview.offset + preview.text.length }}。每个样本最多 12,000 字符，可在原文中选择一段完整场景。</small>
    </template>
    <label>场景名称<input v-model="label" maxlength="100" placeholder="例如：第十二章，第一次当面争执" /></label>
    <label>所选完整场景<textarea v-model="text" rows="7" maxlength="12000" placeholder="选中的原文会填到这里，也可以粘贴这本书中的连续原文。" /></label>
    <label>写作用途<select v-model="use"><option>仅分析</option><option>底色</option><option v-for="purpose in purposes" :key="purpose">{{ purpose }}</option></select></label>
    <small v-if="use !== '仅分析'">每段最多600字符。选对白可从提出条件截到对方回应，选过渡可保留跳过过程前后的两句。</small>
    <footer><small>{{ text.length.toLocaleString() }} / 12,000 字符</small><button type="button" :disabled="busy || !text.trim() || (use !== '仅分析' && text.trim().length > 600)" @click="add">加入选样</button></footer>
  </section>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { appService } from '../services/app-service.js'
import { voicePurposes } from '../../electron/reference-voice.js'
const purposes = Object.keys(voicePurposes), use = ref('仅分析')
const props = defineProps({ projectId: String, book: Object })
const emit = defineEmits(['selected', 'close'])
const query = ref(''), catalog = ref({ chapters: [], page: 0, pageCount: 1 }), chapterId = ref(0)
const preview = ref(null), original = ref(null), label = ref(''), text = ref(''), error = ref(''), busy = ref(false)
let epoch = 0, disposed = false
async function request(input) {
  const token = ++epoch
  busy.value = true; error.value = ''
  try {
    const value = await appService.browseReferenceNovel({ projectId: props.projectId, bookId: props.book.id, ...input })
    if (!disposed && epoch === token) return value
  } catch (e) { if (!disposed && epoch === token) error.value = e.message }
  finally { if (!disposed && epoch === token) busy.value = false }
}
async function loadList(page = 0) {
  const value = await request({ query: query.value, page })
  if (!value) return
  catalog.value = value; preview.value = null
  if (value.chapters.length) { chapterId.value = value.chapters[0].index; await loadChapter(0) }
}
async function loadChapter(offset) {
  const value = await request({ chapter: chapterId.value, offset })
  if (value) preview.value = value
}
function useWhole() { text.value = preview.value.text.trim(); label.value = preview.value.title }
function useSelection() {
  const value = original.value.value.slice(original.value.selectionStart, original.value.selectionEnd).trim()
  if (!value || value.length > 12000) { error.value = '请先在章节原文中选中1—12000字符的连续场景'; return }
  text.value = value; label.value = preview.value.title; error.value = ''
}
function add() { emit('selected', { label: label.value.trim() || preview.value?.title || '完整场景', text: text.value.trim(), use: use.value }) }
onMounted(loadList)
onBeforeUnmount(() => { disposed = true; epoch++ })
</script>
<style scoped>
.reference-picker{display:grid;gap:14px;padding:20px;border:1px solid var(--ns-accent,#41766e);border-radius:12px;background:var(--ns-surface,#fff)}
header,footer,.picker-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}header{align-items:start;justify-content:space-between}h3{margin:0;font-size:18px}p,small{color:var(--ns-text-muted,#657e87);font-size:12px;line-height:1.8}label{display:grid;gap:7px;font-size:12px;flex:1;min-width:150px}input,textarea,select{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:var(--ns-surface,#fff);padding:11px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px;line-height:1.7}textarea{resize:vertical}button{font:inherit;padding:9px 13px;border:1px solid var(--ns-border,#bdcfd2);border-radius:8px;background:var(--ns-surface,#fff);color:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--ns-accent,#41766e);outline-offset:2px}footer{justify-content:space-between}.picker-row label{min-width:200px}
</style>
