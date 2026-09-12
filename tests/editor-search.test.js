import assert from 'node:assert/strict'
import test from 'node:test'
import { SearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState } from '@codemirror/state'
import { collectSearchMatches, editorSearchStatus, searchTargetForSelection } from '../src/utils/editor-search.js'

test('editor search reports no match instead of appearing unresponsive', () => {
  const state = EditorState.create({ doc: '第一段正文\n第二段正文' })
  const query = new SearchQuery({ search: '蓝边' })
  const matches = collectSearchMatches(state, query)
  assert.deepEqual(matches, { ranges: [], truncated: false })
  assert.deepEqual(editorSearchStatus(query, matches.ranges, state.selection.main), { text: '未找到', state: 'empty' })
})

test('editor search counts matches and keeps a refined query on the current occurrence', () => {
  const state = EditorState.create({ doc: '蓝边盘放左边，蓝边盘放右边', selection: EditorSelection.single(0, 1) })
  const query = new SearchQuery({ search: '蓝边' })
  const matches = collectSearchMatches(state, query)
  assert.deepEqual(matches.ranges, [{ from: 0, to: 2 }, { from: 7, to: 9 }])
  assert.deepEqual(searchTargetForSelection(matches.ranges, state.selection.main), { from: 0, to: 2 })
  assert.deepEqual(editorSearchStatus(query, matches.ranges, EditorSelection.single(0, 2).main), { text: '1 / 2', state: 'found' })
})
