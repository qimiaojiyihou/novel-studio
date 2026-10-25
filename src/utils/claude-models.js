function versionedClaudeName(value = '') {
  const id = String(value).replace(/\[1m\]$/i, '')
  const match = id.match(/^claude-([a-z][a-z-]*?)-(\d+(?:-\d+)*)$/i)
  if (!match) return ''
  const parts = match[2].split('-')
  if (parts.length > 1 && /^\d{8}$/.test(parts.at(-1))) parts.pop()
  const family = match[1].split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
  return `${family} ${parts.join('.')}`
}

export function claudeModelPresentation(item) {
  const originalName = item.name || item.displayName || item.value
  const fromId = versionedClaudeName(item.resolvedModel) || versionedClaudeName(item.value)
  // Older CLIs omit resolvedModel but put the version in the human-readable
  // description. Never manufacture a version from a stable family alias.
  const fromDescription = !item.resolvedModel && String(item.description || '').match(/\b([A-Z][a-zA-Z-]*)\s+(\d+(?:\.\d+)*)\b/)
  const versionLabel = fromId || (fromDescription ? `${fromDescription[1]} ${fromDescription[2]}` : '')
  const suffix = originalName?.match(/\([^)]*\)/)?.[0] || ''
  const name = versionLabel
    ? item.value === 'default' ? `默认（${versionLabel}）` : `${versionLabel}${suffix ? ` ${suffix}` : ''}`
    : `${originalName}${item.pending ? ' · 版本待读取' : item.resolvedModel ? ' · 自定义映射' : ''}`
  return { ...item, name, versionLabel, versionSource: fromId ? 'model_id' : versionLabel ? 'cli_description' : '' }
}

// Stable CLI aliases provide a usable picker before metadata arrives; versioned
// names and future models always come from the current CLI directory.
export function claudeModelDirectory(configOptions = []) {
  const entries = new Map()
  for (const item of (configOptions.find(option => option.id === 'model')?.options || []).flatMap(item => item.options || [item])) {
    if (typeof item.value !== 'string' || !item.value || entries.has(item.value)) continue
    entries.set(item.value, claudeModelPresentation(item))
  }
  return entries.size ? [...entries.values()] : [
    { value: 'sonnet', name: 'Claude Sonnet', pending: true },
    { value: 'opus', name: 'Claude Opus', pending: true },
    { value: 'haiku', name: 'Claude Haiku', pending: true },
  ].map(claudeModelPresentation)
}
