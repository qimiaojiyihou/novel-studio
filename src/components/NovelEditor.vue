<template>
  <div ref="editorRoot" class="novel-editor" :class="{ 'is-readonly': !editable }"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { getSearchQuery, openSearchPanel, search, searchKeymap, searchPanelOpen } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { keymap, EditorView } from '@codemirror/view'
import { collectSearchMatches, editorSearchStatus, searchTargetForSelection } from '../utils/editor-search.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  editable: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'selection-change'])
const editorRoot = ref(null)
let view
let updatingFromParent = false
let lastSearchSignature = ''
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
  '.cm-searchMatch': { backgroundColor: 'rgba(244, 196, 74, .38)', borderRadius: '3px', outline: '1px solid rgba(176, 122, 16, .32)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(245, 164, 48, .64) !important', outline: '2px solid rgba(150, 91, 5, .6)' },
  '.novel-search-status': { display: 'inline-flex', minWidth: '58px', justifyContent: 'center', margin: '0 4px', color: 'var(--ink-soft)', fontSize: '12px', fontWeight: '700' },
  '.novel-search-status.is-empty, .novel-search-status.is-invalid': { color: 'var(--danger, #a54a42)' },
  '.cm-gutters': { display: 'none' },
}, { dark: false })

function searchSignature(query) {
  return JSON.stringify([query.search, query.caseSensitive, query.regexp, query.wholeWord])
}

function renderSearchFeedback({ reveal = false } = {}) {
  if (!view || !searchPanelOpen(view.state)) {
    lastSearchSignature = ''
    return
  }
  const panel = editorRoot.value?.querySelector('.cm-search')
  const input = panel?.querySelector('input[name="search"]')
  if (!panel || !input) return
  const query = getSearchQuery(view.state)
  const matches = collectSearchMatches(view.state, query)
  if (reveal && matches.ranges.length) {
    const target = searchTargetForSelection(matches.ranges, view.state.selection.main)
    if (target && (target.from !== view.state.selection.main.from || target.to !== view.state.selection.main.to)) {
      view.dispatch({
        selection: EditorSelection.single(target.from, target.to),
        effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
        userEvent: 'select.search',
      })
    }
  }
  const status = editorSearchStatus(query, matches.ranges, view.state.selection.main, matches.truncated)
  let element = panel.querySelector('.novel-search-status')
  if (!element) {
    element = document.createElement('span')
    element.className = 'novel-search-status'
    element.setAttribute('role', 'status')
    element.setAttribute('aria-live', 'polite')
    input.insertAdjacentElement('afterend', element)
  }
  element.textContent = status.text
  element.className = `novel-search-status is-${status.state}`
  for (const button of panel.querySelectorAll('button[name="next"], button[name="prev"], button[name="select"]')) {
    button.disabled = !matches.ranges.length
  }
}

function updateSearchFeedback(update) {
  if (!searchPanelOpen(update.state)) {
    lastSearchSignature = ''
    return
  }
  const query = getSearchQuery(update.state)
  const signature = searchSignature(query)
  const reveal = Boolean(query.search && query.valid && signature !== lastSearchSignature)
  lastSearchSignature = signature
  queueMicrotask(() => renderSearchFeedback({ reveal }))
}

function createState(value) {
  return EditorState.create({
    doc: value,
    extensions: [
      markdown(),
      history(),
      search({ top: true }),
      EditorState.phrases.of({
        'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个',
        'all': '选择全部', 'match case': '区分大小写', 'regexp': '正则表达式',
        'by word': '全词匹配', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭查找',
      }),
      EditorView.lineWrapping,
      keymap.of([
        { key: 'Mod-f', run: openSearchPanel, scope: 'editor search-panel' },
        { key: 'Ctrl-f', run: openSearchPanel, scope: 'editor search-panel' },
        ...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab,
      ]),
      writingTheme,
      editableCompartment.of(EditorView.editable.of(props.editable)),
      EditorView.updateListener.of((update) => {
        updateSearchFeedback(update)
        if (update.docChanged && !updatingFromParent) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged) {
          const searchSelection = update.transactions.some((transaction) => transaction.isUserEvent('select.search'))
          const selection = update.state.selection.main
          const start = view?.coordsAtPos(selection.from)
          const end = view?.coordsAtPos(selection.to)
          emit('selection-change', {
            from: selection.from,
            to: selection.to,
            text: update.state.sliceDoc(selection.from, selection.to),
            source: searchSelection ? 'search' : 'editor',
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
  renderSearchFeedback()
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
  find: () => view && openSearchPanel(view),
  getText: () => view?.state.doc.toString() || '',
})
</script>
