<template>
  <div v-if="visible" class="review-backdrop" role="presentation">
    <section class="review-panel" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <header class="review-header">
        <div>
          <span class="eyebrow copper">CANDIDATE REVIEW</span>
          <h2 id="review-title">{{ title }}</h2>
          <p>{{ subtitle }}</p>
        </div>
        <div class="review-stats">
          <span>原稿 {{ original.length }} 字</span>
          <span>候选 {{ candidate.length }} 字</span>
        </div>
      </header>
      <div ref="diffRoot" class="diff-editor" aria-label="原稿与候选稿差异"></div>
      <footer class="review-footer">
        <span class="review-hint">{{ hint }}</span>
        <div class="review-actions">
          <button class="outline-button" @click="$emit('discard')">放弃候选稿</button>
          <button class="primary-button" @click="$emit('accept')">接受候选稿</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup>
import * as monaco from 'monaco-editor'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  original: { type: String, default: '' },
  candidate: { type: String, default: '' },
  title: { type: String, default: '正文候选稿' },
  subtitle: { type: String, default: '逐行检查 AI 生成内容，再决定是否写入正文。' },
  hint: { type: String, default: '候选稿尚未写入正文，接受后才会保存为新版本。' },
  language: { type: String, default: 'markdown' },
})

defineEmits(['accept', 'discard'])

const diffRoot = ref(null)
let diffEditor
let originalModel
let candidateModel

function createDiffEditor() {
  if (!diffRoot.value || diffEditor) return
  originalModel = monaco.editor.createModel(props.original, props.language)
  candidateModel = monaco.editor.createModel(props.candidate, props.language)
  diffEditor = monaco.editor.createDiffEditor(diffRoot.value, {
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    lineNumbers: 'on',
    folding: false,
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', monospace",
    padding: { top: 18, bottom: 18 },
  })
  diffEditor.setModel({ original: originalModel, modified: candidateModel })
}

watch(() => props.visible, (visible) => {
  if (visible) nextTick(createDiffEditor)
})

watch(() => props.original, (value) => {
  if (originalModel && originalModel.getValue() !== value) originalModel.setValue(value)
})

watch(() => props.candidate, (value) => {
  if (candidateModel && candidateModel.getValue() !== value) candidateModel.setValue(value)
})

watch(() => props.language, (language) => {
  if (originalModel) monaco.editor.setModelLanguage(originalModel, language)
  if (candidateModel) monaco.editor.setModelLanguage(candidateModel, language)
})

onMounted(() => {
  if (props.visible) createDiffEditor()
})

onBeforeUnmount(() => {
  diffEditor?.dispose()
  originalModel?.dispose()
  candidateModel?.dispose()
})
</script>
