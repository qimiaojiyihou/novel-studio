export const GENERATION_INTENTS = Object.freeze(['draft', 'continue', 'rewrite', 'repair'])

export function composeGenerationCandidate({ intent = 'draft', original = '', generated = '', cursorOffset = 0 } = {}) {
  const source = String(original || '')
  const candidate = String(generated || '')
  if (intent !== 'continue') return candidate
  const offset = Math.max(0, Math.min(Number(cursorOffset || 0), source.length))
  return source.slice(0, offset) + candidate + source.slice(offset)
}
