// Shared by the host finalizer and its evidence form. No model calls or storage.
export const COMPACT_HANDOFF_MODE = 'delta-v1'
export const HANDOFF_SECTIONS = [
  ['facts', '本章新事实'], ['characterStates', '人物状态变化'],
  ['relationshipChanges', '关系变化'], ['timelineEvents', '关键事件'],
  ['foreshadow.setups', '新埋伏笔'], ['foreshadow.payoffs', '已回收伏笔'],
  ['openThreads', '后续承接'],
]

export const COMPACT_HANDOFF_CONTRACT = `你是章节交接记录员。当前任务只提取本章有原文依据、会影响后续创作的变化，不评价文采，也不重述整个故事。
返回一个 JSON 对象：summary（简短交接摘要）、facts、characterStates、relationshipChanges、timelineEvents、foreshadow（setups、payoffs 两个数组）、openThreads。所有数组元素为对象，每项带 evidence 字符串，逐字复制当前正文的一段短引句；多处不连续证据用换行分隔，不添加引号、解释或省略号。无变化的类别返回空数组。
facts 使用 subject、predicate、object、certainty（confirmed/reported/suspected）、evidence；人物说法、猜测保留 reported/suspected，不当成已证实事实。
characterStates 使用 character、location、physical、emotional、possessions、knows、evidence。只记录本章改变的状态；未提及的字段用空字符串或空数组，含义是本章未更新，不表示历史状态消失。possessions 仅记录关键证物或影响后续行动的物品变更，knows 仅记录本章明确新增的知情内容。
relationshipChanges 使用 text、evidence；timelineEvents 使用 time、event、participants、consequence、evidence；伏笔和 openThreads 使用 text、evidence。悬而未决的问题仍是问题，不推断谜底，不编造下一章事件。
不要复制前章人物全量清单或无变化的旧事实，不逐一登记毛巾、餐具等日常道具，除非其在本章承担关键证据或行动作用。同一变化只在最适合的类别记录，其他类别不要重复扩写。
通常总计 6—12 项、摘要约 100—180 字就够；这是精简建议，不是配额。信息少时更少，确有重要变化时可超出，优先保留关键因果、知情变化与承接点。只返回交接 JSON，不返回解释、流程承诺或正文改写。`

export function handoffItems(state, key) {
  const value = key.split('.').reduce((object, part) => object?.[part], state)
  return Array.isArray(value) ? value : []
}

export function evidenceQuote(item) {
  return typeof item?.evidence === 'string' ? item.evidence : item?.evidence?.quote || ''
}

export function hasSourceEvidence(evidence, manuscript) {
  const quote = typeof evidence === 'string' ? evidence : evidence?.quote
  if (typeof quote !== 'string' || !quote.trim()) return false
  if (manuscript.includes(quote)) return true
  const fragments = quote.split(/\r?\n/).map(part => part.trim()).filter(Boolean)
  return fragments.length > 1 && fragments.every(part => manuscript.includes(part))
}

export function stateEvidenceIssues(state, manuscript) {
  const issues = []
  if (!state || typeof state !== 'object' || Array.isArray(state)) return [{ path: '', message: '章后状态应为对象' }]
  if (typeof state.summary !== 'string' || !state.summary.trim()) issues.push({ path: 'summary', message: '章后状态缺少交接摘要' })
  for (const [key, label] of HANDOFF_SECTIONS) {
    const value = key.split('.').reduce((object, part) => object?.[part], state)
    if (!Array.isArray(value)) { issues.push({ path: key, message: `${label}（${key}）应为数组` }); continue }
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !hasSourceEvidence(item.evidence, manuscript)) {
        issues.push({ path: `${key}.${index}`, key, index, message: `${label}第 ${index + 1} 项（${key}[${index}]）缺少当前定稿中的证据原句` })
      }
    })
  }
  return issues
}

export function handoffItemText(item) {
  if (typeof item === 'string') return item
  if (!item) return ''
  const list = values => (Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value : [value?.item, value?.state, value?.text].filter(Boolean).join('：')).filter(Boolean).join('、')
  if (item.character) return [item.character, item.location, item.physical, item.emotional,
    list(item.possessions) ? `关键物品：${list(item.possessions)}` : '', list(item.knows) ? `新增知情：${list(item.knows)}` : ''].filter(Boolean).join('；')
  if (item.object) return [item.subject, item.predicate, item.object].filter(Boolean).join(' ')
  if (item.event) return [item.time, item.event, Array.isArray(item.participants) ? item.participants.join('、') : item.participants, item.consequence].filter(Boolean).join('；')
  return item.text || item.summary || item.thread || item.change || item.state || item.description || item.name || item.title || ''
}

// Corrections address only an existing evidence field or explicitly omit an item.
// The host checks manuscript/state digests before calling this helper.
export function correctStateEvidence(state, corrections = []) {
  if (!Array.isArray(corrections) || corrections.length > 1000) throw new Error('交接修正列表格式有误')
  const next = structuredClone(state), audit = [], seen = new Set(), removals = []
  for (const correction of corrections) {
    const { key, index } = correction || {}
    const path = `${key}.${index}`
    if (!HANDOFF_SECTIONS.some(([name]) => name === key) || !Number.isInteger(index) || index < 0
      || index >= handoffItems(state, key).length || seen.has(path)) throw new Error('交接条目定位有误或重复，请刷新后重试')
    seen.add(path)
    const original = handoffItems(state, key)[index]
    if (correction.remove === true) {
      removals.push({ key, index }); audit.push({ path, action: 'omit', before: original })
    } else {
      if (typeof correction.quote !== 'string' || !original || typeof original !== 'object' || Array.isArray(original)) throw new Error('请填写证据原句，或明确移除此项')
      if (evidenceQuote(original) === correction.quote) continue
      handoffItems(next, key)[index].evidence = correction.quote
      audit.push({ path, action: 'evidence', before: original.evidence || '', after: correction.quote })
    }
  }
  for (const { key, index } of removals.sort((a, b) => b.index - a.index)) handoffItems(next, key).splice(index, 1)
  return { state: next, changes: audit }
}
