<template>
  <div ref="root" class="inline-manuscript-diff" aria-label="当前正文与 Codex 候选差异"></div>
</template>

<script setup>
import * as monaco from 'monaco-editor'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  original: { type: String, default: '' },
  candidate: { type: String, default: '' },
})

const root = ref(null)
let editor
let originalModel
let candidateModel

onMounted(() => {
  originalModel = monaco.editor.createModel(props.original, 'markdown')
  candidateModel = monaco.editor.createModel(props.candidate, 'markdown')
  editor = monaco.editor.createDiffEditor(root.value, {
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: false,
    renderOverviewRuler: false,
    minimap: { enabled: false },
    wordWrap: 'on',
    lineNumbers: 'off',
    folding: false,
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineHeight: 24,
    padding: { top: 10, bottom: 10 },
  })
  editor.setModel({ original: originalModel, modified: candidateModel })
})

watch(() => props.original, (value) => {
  if (originalModel && originalModel.getValue() !== value) originalModel.setValue(value)
})
watch(() => props.candidate, (value) => {
  if (candidateModel && candidateModel.getValue() !== value) candidateModel.setValue(value)
})

onBeforeUnmount(() => {
  editor?.dispose()
  originalModel?.dispose()
  candidateModel?.dispose()
})
</script>

<style scoped>
.inline-manuscript-diff { box-sizing: border-box; height: 100%; min-height: 0; overflow: hidden; border: 1px solid var(--ns-border); border-radius: 8px; background: white; }
</style>
