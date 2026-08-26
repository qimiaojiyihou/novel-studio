const META_PREAMBLE = /^(?:我(?:将|会|来|可以)|下面|以下|本次|作为|按(?:照)?).*(?:novel\s*studio|候选|真实项目|只读|规范|流程|生成|校准)/i
const TRANSPORT_WARNING = /^warning:\s*(?=.*(?:websockets?|https\s+transport|stream\s+disconnected|tls\s+handshake)).*$/i

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function cleanPlanningFieldText(value = '', { fieldLabel = '' } = {}) {
  const original = String(value || '').trim()
  if (!original) return ''
  let text = original
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .split(/\r?\n/)
    .filter((line) => !TRANSPORT_WARNING.test(line.trim()))
    .join('\n')
    .trim()

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sentence = text.match(/^([^。！？\n]{1,240}[。！？])\s*/)?.[1] || ''
    if (!sentence || !META_PREAMBLE.test(sentence)) break
    text = text.slice(sentence.length).trim()
  }

  if (fieldLabel) {
    text = text.replace(new RegExp(`^[“”"《》「」]?${escapeRegExp(fieldLabel)}[“”"《》「」]?\\s*[：:]\\s*`), '').trim()
  }
  return text || original
}
