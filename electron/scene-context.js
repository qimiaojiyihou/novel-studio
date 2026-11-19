import { codexPromptText } from './codex-agent-gateway.js'

// These bound the text the application controls, including the schema and title.
// UTF-8 bytes also bound the worst-case byte-token input without a model tokenizer.
const MAX_CHARS = 24_000
const MAX_BYTES = 48_000
const HISTORY_WINDOW = 6_000

function tail(text, size) {
  const start = Math.max(0, text.length - size)
  return text.slice(start + (/^[\uDC00-\uDFFF]/u.test(text.slice(start, start + 1)) ? 1 : 0))
}

function head(text, size) {
  return text.slice(0, size).replace(/[\uD800-\uDBFF]$/u, '')
}

// Copy only actual prose. The ends of older scenes give continuity without
// treating unexecuted plans as facts or summarizing them in another model call.
export function sceneHistory(text, scenes = []) {
  if (text.length <= HISTORY_WINDOW) return text
  const recent = tail(text, 4_600)
  const cut = text.length - recent.length
  let position = 0
  const earlier = []
  for (const [index, prose] of scenes.entries()) {
    position += prose.length
    if (position > cut) break
    earlier.push({ index, prose })
    position += 2
  }
  const count = Math.min(6, earlier.length)
  const endings = Array.from({ length: count }, (_, i) => {
    const { index, prose } = earlier[Math.round(i * (earlier.length - 1) / Math.max(1, count - 1))]
    return `第${index + 1}场末尾原文：${tail(prose, 150)}`
  })
  return [...endings, '〔本章较早正文已节选〕', recent].join('\n\n')
}

export function fitSceneContext({ title, plan, instructions, directions, system, style, previous, history, reference, clues = [], maxChars, displayTitle, outputSchema, repair }) {
  const budgetChars = Math.min(MAX_CHARS, maxChars > 0 ? maxChars : MAX_CHARS)
  const slots = { style, previous, history, reference }
  let sentClues = clues
  const inputs = { ...slots }
  const messages = () => [{ role: 'system', content: system }, { role: 'user', content: [
    title,
    slots.style && '【本书文风】\n' + slots.style,
    plan,
    (slots.previous || slots.history) && '【本书前文】\n' + [slots.previous, slots.history].filter(Boolean).join('\n\n'),
    sentClues.length && '【本场相关旧线索】卡片是作者备忘。只按本场可见证据推进，保留人物知情边界；原文短引仅核对前情。\n' + sentClues.map(c => c.text).join('\n'),
    ...instructions, slots.reference, ...directions,
  ].filter(Boolean).join('\n\n') }]
  const wire = () => codexPromptText({ messages: messages(), displayTitle, outputSchema })
  const fits = text => text.length <= budgetChars && Buffer.byteLength(text) <= MAX_BYTES
  if (!fits(wire())) {
    // Reserve a voice cue and immediate continuity while fitting the larger
    // optional blocks. The matched quotation is always sent intact or omitted.
    const compact = (key, size) => {
      const value = inputs[key]
      if (size >= value.length) return value
      if (key === 'style') return head(value, Math.floor(size / 2)) + '〔节选〕' + tail(value, Math.floor(size / 2))
      return '〔节选〕' + tail(value, size)
    }
    for (const [key, size] of [['style', 500], ['previous', 300], ['history', 800]]) slots[key] = compact(key, size)
    while (sentClues.length > 1 && !fits(wire())) sentClues = sentClues.slice(0, -1)
    if (!fits(wire())) slots.reference = ''
    if (!fits(wire())) sentClues = []
    if (!fits(wire())) {
      throw Object.assign(new Error('本场计划、作者要求或待调整正文过长，连同必要的衔接内容已超过单场预算。请精简本场要求或拆分场景。'),
        { name: repair ? 'SceneRepairContextTooLarge' : 'SceneContextTooLarge' })
    }
    for (const key of ['history', 'style', 'previous']) {
      const reserved = slots[key]
      slots[key] = inputs[key]
      if (fits(wire())) continue
      slots[key] = reserved
      let low = 0, high = Math.min(inputs[key].length - 1, budgetChars)
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        slots[key] = compact(key, mid)
        if (fits(wire())) low = mid + 1
        else high = mid - 1
      }
      slots[key] = high >= 0 ? compact(key, high) : reserved
    }
  }
  const text = wire()
  return { messages: messages(), clues: sentClues, referenceSent: Boolean(slots.reference), diagnostics: {
    budgetChars, usedChars: text.length, usedBytes: Buffer.byteLength(text), budgetBytes: MAX_BYTES,
    shortened: [...Object.keys(slots).filter(key => slots[key] !== inputs[key]), ...(sentClues.length < clues.length ? ['clues'] : [])],
  } }
}
