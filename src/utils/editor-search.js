export const MAX_EDITOR_SEARCH_MATCHES = 10000

export function collectSearchMatches(state, query, limit = MAX_EDITOR_SEARCH_MATCHES) {
  if (!query?.valid) return { ranges: [], truncated: false }
  const cursor = query.getCursor(state)
  const ranges = []
  while (ranges.length <= limit) {
    const result = cursor.next()
    if (result.done) break
    ranges.push({ from: result.value.from, to: result.value.to })
  }
  return { ranges: ranges.slice(0, limit), truncated: ranges.length > limit }
}

export function searchTargetForSelection(ranges = [], selection = {}) {
  if (!ranges.length) return null
  const sameStart = ranges.find((range) => range.from === selection.from)
  if (sameStart) return sameStart
  return ranges.find((range) => range.from >= Number(selection.head ?? selection.to ?? 0)) || ranges[0]
}

export function editorSearchStatus(query, ranges = [], selection = {}, truncated = false) {
  if (!query?.search) return { text: '输入关键词', state: 'idle' }
  if (!query.valid) return { text: '正则表达式无效', state: 'invalid' }
  if (!ranges.length) return { text: '未找到', state: 'empty' }
  const current = ranges.findIndex((range) => range.from === selection.from && range.to === selection.to)
  const total = `${ranges.length}${truncated ? '+' : ''}`
  return { text: current >= 0 ? `${current + 1} / ${total}` : `共 ${total} 处`, state: 'found' }
}
