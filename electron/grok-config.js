export function grokConfigValue(value) {
  return String(value && typeof value === 'object' ? value.value ?? '' : value ?? '')
}

export function grokConfigOptions(options = []) {
  return options.filter(o => ['model', 'reasoning_effort'].includes(o.id)).map(o => ({
    id: o.id, name: o.name || o.id, type: 'select', currentValue: grokConfigValue(o.currentValue),
    options: (o.options || []).flatMap(item => item.options || [item]).map(item => ({
      value: grokConfigValue(item.value), name: item.name || grokConfigValue(item.value),
    })),
  }))
}

export function grokChoices(options, id) {
  return grokConfigOptions(options).find(o => o.id === id)?.options || []
}

export function grokModelSnapshot(options) {
  const normalized = grokConfigOptions(options)
  const model = normalized.find(o => o.id === 'model')
  return { provider: 'grok', model: model?.currentValue || '',
    modelName: model?.options.find(o => o.value === model.currentValue)?.name || model?.currentValue || '',
    reasoningEffort: normalized.find(o => o.id === 'reasoning_effort')?.currentValue || '',
    fastMode: false, verified: Boolean(model?.currentValue), source: 'acp_config_readback' }
}
