<template>
  <div ref="editorRoot" class="novel-editor" :class="{ 'is-readonly': !editable }"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { keymap, EditorView } from '@codemirror/view'

const props = defineProps({
  modelValue: { type: String, default: '' },
  editable: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'selection-change'])
const editorRoot = ref(null)
let view
let updatingFromParent = false
const editableCompartment = new Compartment()

const writingTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--ink)', height: '100%' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-body)', padding: '20px 0 120px' },
  '.cm-content': { maxWidth: '780px', margin: '0 auto', padding: '24px 36px', fontSize: '16px', lineHeight: '1.85', caretColor: 'var(--copper)' },
  '.cm-line': { padding: '0' },
  '.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, .cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--copper)', borderLeftWidth: '2px' },
  '.cm-search': { backgroundColor: 'var(--paper-deep)', border: '1px solid var(--line)', padding: '8px' },
  '.cm-gutters': { display: 'none' },
}, { dark: false })

function createState(value) {
  return EditorState.create({
    doc: value,
    extensions: [
      markdown(),
      history(),
      search(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      writingTheme,
      editableCompartment.of(EditorView.editable.of(props.editable)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !updatingFromParent) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged) {
          const selection = update.state.selection.main
          const start = view?.coordsAtPos(selection.from)
          const end = view?.coordsAtPos(selection.to)
          emit('selection-change', {
            from: selection.from,
            to: selection.to,
            text: update.state.sliceDoc(selection.from, selection.to),
            coords: start && end ? {
              left: Math.min(start.left, end.left),
              right: Math.max(start.right, end.right),
              top: start.top,
              bottom: Math.max(start.bottom, end.bottom),
            } : null,
          })
        }
      }),
    ],
  })
}

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: editorRoot.value })
})

watch(() => props.modelValue, (value) => {
  if (!view || value === view.state.doc.toString()) return
  updatingFromParent = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  updatingFromParent = false
})

watch(() => props.editable, (value) => {
  if (!view) return
  view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(value)) })
})

onBeforeUnmount(() => view?.destroy())

defineExpose({
  focus: () => view?.focus(),
  getText: () => view?.state.doc.toString() || '',
})
</script>
