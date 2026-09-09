import { contentDigest } from './chapter-finalization.js'

export function assertProtectedText(manuscript, protections = []) {
  let offset = 0
  for (const item of protections.filter(item => item.active !== 0).slice().sort((a, b) => a.start_offset - b.start_offset)) {
    const location = manuscript.indexOf(item.text, offset)
    if (!item.text || location < 0) throw new Error('修改触及受保护段落；请调整范围或明确取消保护。')
    offset = location + item.text.length
  }
}

export function applyTextPatches(source, result, { digest, scope = {}, protections = [] } = {}) {
  if (digest !== contentDigest(source) || result.sourceDigest !== digest) throw new Error('补丁来源已过期；请重新选择范围。当前结果仅供比较。')
  if (['selection', 'scene'].includes(scope.kind) && (!Number.isInteger(scope.from) || !Number.isInteger(scope.to) || scope.from < 0 || scope.to <= scope.from || scope.to > source.length)) throw new Error('请重新选择有效范围')
  if (!Array.isArray(result.patches) || !result.patches.length || result.patches.length > 100) throw new Error('局部修改应返回1—100项文本补丁')
  const patches = result.patches.slice().sort((a, b) => a.from - b.from)
  let previousEnd = -1
  for (const patch of patches) {
    if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.to <= patch.from || patch.to > source.length
      || typeof patch.before !== 'string' || typeof patch.after !== 'string' || source.slice(patch.from, patch.to) !== patch.before) {
      throw new Error('补丁原文或位置不匹配；请重新选择范围，修改范围未扩大。')
    }
    if (patch.from < previousEnd) throw new Error('补丁范围相互重叠')
    if (['selection', 'scene'].includes(scope.kind) && (patch.from < scope.from || patch.to > scope.to)) throw new Error('补丁超出当前选区或场景范围')
    if (protections.some(item => item.active !== 0 && patch.from < item.end_offset && patch.to > item.start_offset)) throw new Error('修改触及受保护段落；请调整范围或明确取消保护。')
    previousEnd = patch.to
  }
  let manuscript = source
  for (const patch of patches.slice().reverse()) manuscript = manuscript.slice(0, patch.from) + patch.after + manuscript.slice(patch.to)
  return { manuscript, patches, sourceDigest: digest }
}

export const TEXT_PATCH_SCHEMA = { type: 'object', additionalProperties: false, required: ['sourceDigest', 'patches'], properties: {
  sourceDigest: { type: 'string' }, patches: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false,
    required: ['from', 'to', 'before', 'after'], properties: { from: { type: 'integer' }, to: { type: 'integer' }, before: { type: 'string' }, after: { type: 'string' } } } },
} }
