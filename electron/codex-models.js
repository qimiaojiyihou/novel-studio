// Display names are hints, never evidence that an installed runtime supports a model.
export const CODEX_MODEL_HINTS = [{ value: 'gpt-6-astra', name: 'GPT-6 Astra' }]

export function modelDirectory(configOptions = [], refreshed = false) {
  const option = configOptions.find((item) => item.id === 'model')
  const live = (option?.options || []).flatMap((item) => item.options || [item])
  const entries = new Map(live.map((item) => [item.value, { ...item, status: 'available' }]))
  for (const hint of CODEX_MODEL_HINTS) {
    if (!entries.has(hint.value)) entries.set(hint.value, { ...hint, status: refreshed ? 'unsupported' : 'pending' })
  }
  return [...entries.values()]
}

export function sessionModelSnapshot(configOptions = []) {
  const find = (id) => configOptions.find((option) => option.id === id)
  return {
    model: find('model')?.currentValue || '',
    reasoningEffort: find('reasoning_effort')?.currentValue || '',
    fastMode: find('fast-mode')?.currentValue === true || find('fast-mode')?.currentValue === 'on',
    reasoningOptions: find('reasoning_effort')?.options || [],
    fastModeSupported: Boolean(find('fast-mode')),
    verified: Boolean(find('model')?.currentValue),
  }
}

export function execModelArgs({ model = '', reasoningEffort = '', fastMode = false } = {}) {
  return [
    ...(model ? ['--model', model] : []),
    ...(reasoningEffort ? ['-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : []),
    ...(fastMode ? ['-c', 'service_tier="fast"'] : []),
  ]
}
