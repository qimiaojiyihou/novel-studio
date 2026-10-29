export const COLLABORATIVE_WORKFLOW_ID = 'collaborative-writing'
export const COLLABORATIVE_STAGES = [
  { id: 'planning', label: '规划' }, { id: 'writing', label: '正文' },
  { id: 'review', label: '审稿' }, { id: 'repair', label: '定向修稿' },
]

// An application workflow: existing immutable Creative Packs keep their original
// contents. Steps and prompt contexts are frozen with each run as usual.
export function collaborativeWorkflow() {
  return { schemaVersion: 1, version: 1, id: COLLABORATIVE_WORKFLOW_ID, name: 'GPT / Grok 协作创作', steps: [
    { id: 'preflight', action: 'preflight' },
    { id: 'chapter-card', action: 'generate', task: 'chapter_card', candidateType: 'chapter_card', dependsOn: ['preflight'] },
    { id: 'confirm-card', action: 'checkpoint', dependsOn: ['chapter-card'] },
    { id: 'scene-plan', action: 'generate', task: 'scene_plan', candidateType: 'scene_plan', dependsOn: ['confirm-card'] },
    { id: 'confirm-scenes', action: 'checkpoint', dependsOn: ['scene-plan'] },
    { id: 'chapter-draft', action: 'generate', task: 'chapter', candidateType: 'manuscript', dependsOn: ['confirm-scenes'] },
    { id: 'review-draft', action: 'quality_review', task: 'quality_review', dependsOn: ['chapter-draft'] },
    { id: 'choose-repairs', action: 'review_checkpoint', dependsOn: ['review-draft'] },
    { id: 'repair-draft', action: 'generate', task: 'chapter', candidateType: 'manuscript', dependsOn: ['choose-repairs'] },
    { id: 'confirm-draft', action: 'checkpoint', dependsOn: ['repair-draft'] },
  ] }
}

export function collaborativeStage(run, step) {
  if (run.workflowId !== COLLABORATIVE_WORKFLOW_ID) return ''
  return ({ 'chapter-card': 'planning', 'scene-plan': 'planning', 'chapter-draft': 'writing',
    'review-draft': 'review', 'repair-draft': 'repair' })[step.key] || ''
}

export function lockCollaborativeModels(database, modelRoutes = {}) {
  const stageModels = {}, stageProfiles = {}, stageAgentSettings = {}
  for (const stage of COLLABORATIVE_STAGES) {
    const id = String(modelRoutes.stageModels?.[stage.id] || '')
    if (!id) throw new Error(`请为${stage.label}环节选择模型`)
    stageModels[stage.id] = id
    if (['codex', 'grok-build'].includes(id)) {
      const settings = modelRoutes.stageAgentSettings?.[stage.id] || {}
      stageAgentSettings[stage.id] = { model: String(settings.model || '').trim().slice(0, 256),
        reasoningEffort: String(settings.reasoningEffort || '').trim().slice(0, 64) }
      continue
    }
    const profile = database.prepare('SELECT * FROM model_profiles WHERE id=? AND enabled=1').get(id)
    if (!profile || !profile.base_url || !profile.model || (!['local', 'mock'].includes(profile.provider) && !profile.api_key_cipher)) {
      throw new Error(`${stage.label}模型尚未配置完整，请检查启用状态、接口、模型名称及 API Key`)
    }
    stageProfiles[stage.id] = { id, provider: profile.provider, model: profile.model, name: profile.name, baseUrl: profile.base_url }
  }
  return { ...modelRoutes, stageModels, stageProfiles, stageAgentSettings, reviewerProfileId: stageModels.review }
}

export function collaborativeExecution(run, step) {
  const stage = collaborativeStage(run, step)
  if (!stage) return run
  const profileId = run.modelRoutes.stageModels[stage]
  const isAgent = ['codex', 'grok-build'].includes(profileId)
  const agentSettings = run.modelRoutes.stageAgentSettings?.[stage]
  return { ...run, executionMode: isAgent ? 'codex' : 'app_model', modelRoutes: {
    ...run.modelRoutes, activeStage: stage, modelProfileId: isAgent ? '' : profileId,
    reviewerProfileId: stage === 'review' ? profileId : run.modelRoutes.reviewerProfileId,
    ...(isAgent ? { agentProvider: profileId === 'grok-build' ? 'grok' : 'codex',
      ...(agentSettings ? { codexModel: agentSettings.model, codexReasoningEffort: agentSettings.reasoningEffort } : {}),
      codexFastMode: false, codexAuthMethod: profileId === 'grok-build' ? 'cached_token' : run.modelRoutes.codexAuthMethod } : {}),
  } }
}

export function collaborativeProfile(run, profiles) {
  const stage = run?.modelRoutes?.activeStage || collaborativeStage(run || {}, run?.steps?.find(s => s.id === run.currentStepId) || {})
  const snapshot = run?.modelRoutes?.stageProfiles?.[stage]
  if (!snapshot) return null
  const current = profiles.find(p => p.id === snapshot.id && p.enabled)
  if (!current || current.baseUrl !== snapshot.baseUrl || current.provider !== snapshot.provider) throw new Error('本次运行的模型配置已删除、停用或接口已改变，请恢复配置或新建运行')
  return { ...current, model: snapshot.model, name: snapshot.name }
}

export function reviewedIssues(run) {
  const review = run.steps.find(s => s.key === 'review-draft')?.output?.review
  return (review?.issues || []).map((issue, index) => ({ ...issue, selectionId: String(index) }))
}

export function collaborativeRepairInput(run, step) {
  if (run.workflowId !== COLLABORATIVE_WORKFLOW_ID || step.key !== 'repair-draft') return null
  const original = run.candidates.find(c => c.stepId === run.steps.find(s => s.key === 'chapter-draft')?.id)
  if (!original || original.status !== 'pending') throw new Error('定向修稿缺少待确认原稿')
  const selected = new Set(step.input?.reviewIssueIds || [])
  const issues = reviewedIssues(run).filter(issue => selected.has(issue.selectionId))
  if (!issues.length) throw new Error('请选择至少一项审稿问题，或保留原稿')
  return { original, issues }
}
