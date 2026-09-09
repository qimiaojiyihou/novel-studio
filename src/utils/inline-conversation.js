const CANDIDATE_STATUS_COPY = {
  pending: '已生成，等待你确认。',
  accepted: '已经写入项目，仍可继续修改。',
  rejected: '已放弃，保留在版本历史中。',
  stale: '已被后续修改替代，可继续查看和比较。',
  cancelled: '已取消，保留在版本历史中。',
}

function versionLabel(version) {
  return version === 1 ? '首版候选' : `第 ${version} 版修改稿`
}

export function buildInlineConversation({ steps = [], candidates = [], runStatus = '' } = {}) {
  const orderedCandidates = Array.isArray(candidates) ? candidates : []
  const candidateVersions = new Map(orderedCandidates.map((candidate, index) => [candidate.id, index + 1]))
  const candidateByStep = new Map(orderedCandidates.map((candidate) => [candidate.stepId, candidate]))
  const messages = []

  for (const step of Array.isArray(steps) ? steps : []) {
    const revision = step?.input?.revision
    if (revision?.instruction) {
      messages.push({
        id: `${step.id}:author`,
        role: 'author',
        kind: 'instruction',
        round: Number(revision.round || step.position || 0),
        text: revision.instruction,
        parentCandidateId: revision.parentCandidateId || '',
        parentVersion: candidateVersions.get(revision.parentCandidateId) || 0,
      })
    }

    const candidate = candidateByStep.get(step.id)
    if (candidate) {
      const version = candidateVersions.get(candidate.id) || 1
      messages.push({
        id: `${candidate.id}:codex`,
        role: 'codex',
        kind: 'candidate',
        version,
        candidateId: candidate.id,
        status: candidate.status,
        title: versionLabel(version),
        text: CANDIDATE_STATUS_COPY[candidate.status] || '已生成，可在上方查看。',
      })
      continue
    }

    if (revision && ['pending', 'waiting_approval', 'running'].includes(runStatus)
      && ['pending', 'waiting_approval', 'running'].includes(step.status)) {
      messages.push({
        id: `${step.id}:codex-working`,
        role: 'codex',
        kind: 'working',
        version: orderedCandidates.length + 1,
        title: `正在生成第 ${orderedCandidates.length + 1} 版`,
        text: '正在根据你的要求整理修改稿…',
      })
    }
  }

  return messages
}

export function inlineConversationScope({ artifactType = '', targetKind = '', fieldLabel = '', conversationScope = null } = {}) {
  if (conversationScope?.kind === 'planning') return '本书规划对话'
  if (conversationScope?.kind === 'chapter') return '本章创作对话'
  if (conversationScope?.kind === 'review') return '独立审稿'
  if (conversationScope?.kind === 'audit') return '独立检查'
  if (artifactType === 'manuscript_selection' || targetKind === 'manuscript_selection') return '当前选区'
  if (artifactType === 'manuscript' || targetKind === 'manuscript') return '当前正文候选'
  if (['planning_document_bundle', 'planning_entity_bundle', 'planning_chapter_bundle'].includes(artifactType)) return fieldLabel || '当前整组候选'
  return fieldLabel || '当前候选'
}

export function inlineConversationReuseNote({ conversationScope = null } = {}) {
  if (conversationScope?.kind === 'planning') return '本书的设定与规划在同一对话内续接；只补充变化内容，较长对话中的新创作目标会自动换新。'
  if (conversationScope?.kind === 'chapter') return '本章的章节卡、场景计划和正文在同一对话内续接；切换章节会自动隔离。'
  if (conversationScope?.kind === 'review') return '本次审稿使用独立上下文，不继承创作讨论。'
  if (conversationScope?.kind === 'audit') return '本次检查使用独立上下文，不继承创作讨论。'
  return '继续修改沿用当前候选对话；切换模型时会新建对话并保留原有历史。'
}

export function defaultInlineConversationCollapsed({ artifactType = '' } = {}) {
  return ['manuscript', 'manuscript_selection'].includes(artifactType)
}
