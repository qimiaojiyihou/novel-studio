export const GUIDE_START = '【参考小说文风规范】'
export const GUIDE_END = '【参考小说文风规范结束】'
const cues = {
  对白: /对白|对话|说话|闲聊|商量|分工|谈条件|交谈|套话|问话|师徒|拌嘴/,
  详略: /详略|动作|试刀|训练|赶路|重复|过渡|日常|例行|反复检查|查清原因|开拍|略写/,
  冲突: /冲突|对峙|争执|交锋|威胁|选择|争取/,
  视角: /视角|线索|推理|猜测|误判|改口|重新判断|观察|知情/,
  情绪: /情绪|感情|喜悦|犹豫|紧张|害怕|失望/,
  改稿: /改稿|修稿|修订|润色|审稿/,
}
export function guideSection(style = '') {
  const start = style.indexOf(GUIDE_START)
  const end = style.indexOf(GUIDE_END, start + GUIDE_START.length)
  if (start < 0 || end < 0) return null
  return { start, end: end + GUIDE_END.length, text: style.slice(start + GUIDE_START.length, end).trim() }
}

export function withoutReferenceGuide(style = '') {
  const section = guideSection(style)
  return section ? (style.slice(0, section.start) + style.slice(section.end)).trim() : style
}

export function referenceRules(guide) {
  const lines = guide.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.flatMap(line => {
    const match = line.match(/^(?:[-*]\s*)?【(通用|对白|详略|冲突|视角|情绪|改稿)】\s*(.+)$/u)
    return match ? [{ tag: match[1], text: match[2] }] : []
  })
}
export function selectReferenceStyle(style, input) {
  const section = guideSection(style)
  if (!section) return style
  const rules = referenceRules(section.text)
  if (!rules.length) return style
  const chapter = input.chapter || {}
  const scene = [input.sceneInstruction ?? input.instruction, chapter.title, JSON.stringify(chapter.card ?? chapter.card_json ?? ''),
    JSON.stringify(chapter.scenePlan ?? chapter.scene_plan ?? ''), input.sourceText?.slice(0, 1500),
    ['rewrite','repair'].includes(input.intent) || ['rewrite','quality_review'].includes(input.task) ? '改稿' : ''].filter(Boolean).join('\n')
  const matches = rules.filter(rule => rule.tag !== '通用' && cues[rule.tag].test(scene))
  const common = rules.filter(rule => rule.tag === '通用')
  const selected = [...common.slice(0, 2), ...matches, ...common.slice(2)].slice(0, 4)
  const block = selected.length ? [GUIDE_START, ...selected.map(rule => `【${rule.tag}】${rule.text}`), GUIDE_END].join('\n') : ''
  return style.slice(0, section.start) + block + style.slice(section.end)
}

export function sentReferenceRules(messages) {
  const rules = new Set()
  for (const { content } of messages) {
    for (const match of content.matchAll(/【参考小说文风规范】([\s\S]*?)【参考小说文风规范结束】/gu)) {
      for (const line of match[1].trim().split(/\r?\n/)) if (line.trim()) rules.add(line.trim())
    }
  }
  return [...rules]
}
