// Exact, bounded character diff. A large rewrite falls back to one complete
// changed range, never a truncated preview or a semantic safety verdict.
export function manuscriptDiff(before, after) {
  if (before === after) return []
  let prefix = 0, suffix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const a = before.slice(prefix, before.length - suffix), b = after.slice(prefix, after.length - suffix)
  const fallback = () => [{ from: prefix, to: before.length - suffix, before: a, after: b }]
  let frontier = new Map([[1, 0]]), work = 0
  const trace = []
  for (let d = 0; d <= Math.min(a.length + b.length, 300); d++) {
    trace.push(new Map(frontier))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1))
        ? frontier.get(k + 1) ?? 0 : (frontier.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; if (++work > 1000000) return fallback() }
      frontier.set(k, x)
      if (x < a.length || y < b.length) continue
      const edits = []
      for (let step = d; step >= 0; step--) {
        const v = trace[step], diagonal = x - y
        const previousK = diagonal === -step || (diagonal !== step && (v.get(diagonal - 1) ?? -1) < (v.get(diagonal + 1) ?? -1)) ? diagonal + 1 : diagonal - 1
        const previousX = v.get(previousK) ?? 0, previousY = previousX - previousK
        while (x > previousX && y > previousY) { edits.push(['equal', a[--x]]); y-- }
        if (step > 0) {
          if (x === previousX) edits.push(['insert', b[--y]])
          else edits.push(['delete', a[--x]])
        }
      }
      const ranges = []; let offset = prefix, range
      for (const [kind, text] of edits.reverse()) {
        if (kind === 'equal') { range = null; offset++; continue }
        if (!range) { range = { from: offset, to: offset, before: '', after: '' }; ranges.push(range) }
        if (kind === 'delete') { range.before += text; range.to = ++offset }
        else range.after += text
      }
      return ranges
    }
  }
  return fallback()
}
