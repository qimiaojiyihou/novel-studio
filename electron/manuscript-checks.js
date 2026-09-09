// Editorial findings are evidence, never instructions to silently rewrite a draft.
export function checkManuscript(text = '', { targetLength = 0 } = {}) {
  const source = String(text)
  const findings = []
  const add = (id, severity, reason, from, to, blocking = false) => findings.push({
    id, severity, reason, from, to, evidence: source.slice(from, to), blocking,
  })
  if (!source.trim()) add('empty', 'high', '正文为空，请先写入正文。', 0, source.length, true)
  // Anchor to directive phrases, not ordinary character dialogue or short sentences.
  for (const match of source.matchAll(/(?:本章停在[^\n。]{0,180}(?:。|$)|下一章必须[^\n。]{0,180}(?:。|$)|我(?:将|会)按\s*Novel Studio[^\n。]{0,240}(?:。|$)|(?:^|\n)\s*```(?:json)?|\{\s*"manuscript"\s*:)/g)) {
    const prefix = source.slice(0, match.index)
    if (/^(本章停在|下一章必须)/.test(match[0]) && prefix.lastIndexOf('“') > prefix.lastIndexOf('”')) continue
    add('instruction-or-envelope', 'high', '疑似创作指令或传输格式混入；请核对原句，不会自动删除。', match.index, match.index + match[0].length)
  }
  const seen = new Map()
  for (const match of source.matchAll(/[^\n]+/g)) {
    const paragraph = match[0].trim()
    if (paragraph.length < 80) continue
    if (seen.has(paragraph)) add('duplicate-paragraph', 'high', '发现重复长段落，请确认是否为有意复现。', match.index, match.index + match[0].length)
    seen.set(paragraph, match.index)
  }
  const hanCount = [...source].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length
  if (targetLength > 0 && (hanCount < targetLength * .9 || hanCount > targetLength * 1.2)) {
    add('length', 'warning', `当前 ${hanCount} 中文字，目标约 ${targetLength} 字；可局部扩写、删减或保留。`, 0, 0)
  }
  return { schemaVersion: 1, hanCount, findings, blocked: findings.some(item => item.blocking),
    scope: '仅本地格式与明显异常检查；文学性、事实语义由独立审稿判断。' }
}
