function sourceMap(sources = []) {
  return new Map((Array.isArray(sources) ? sources : [])
    .filter((source) => source?.targetKey)
    .map((source) => [source.targetKey, source.digest || '']))
}

export function buildContextDelta({ currentContext, previousSnapshot, conversationScopeKey, previousStepId = '' } = {}) {
  const items = Array.isArray(currentContext?.items) ? currentContext.items : []
  const previousSources = Array.isArray(previousSnapshot?.contextSources) ? previousSnapshot.contextSources : []
  if (!conversationScopeKey || previousSnapshot?.conversationScopeKey !== conversationScopeKey || !items.length || !previousSources.length) return null

  const previous = sourceMap(previousSources)
  const changed = items.filter((item) => previous.get(item.targetKey) !== item.digest)
  const unchangedCount = items.length - changed.length
  const text = changed.length
    ? [
        '【本轮上下文增量】',
        '同一创作对话中已发送且未变化的正式上下文继续有效。本轮只补充以下新增或变化内容：',
        ...changed.map((item) => item.text),
      ].join('\n')
    : '【本轮上下文增量】\n同一创作对话中的正式上下文没有变化；继续沿用已发送内容，只执行本轮新任务。'

  return {
    text,
    sources: Array.isArray(currentContext?.sources) ? currentContext.sources : [],
    items,
    diagnostics: {
      ...(currentContext?.diagnostics || {}),
      reuseMode: 'delta',
      previousStepId,
      changedSourceCount: changed.length,
      omittedUnchangedSourceCount: unchangedCount,
    },
  }
}
