export const SCENE_PLAN_SCHEMA_VERSION = 1
export const QUALITY_RUBRIC_VERSION = 1

export const QUALITY_DIMENSIONS = Object.freeze([
  { id: 'planningAdherence', label: '规划遵循' },
  { id: 'causalProgression', label: '因果推进' },
  { id: 'sceneProgression', label: '场景变化' },
  { id: 'continuity', label: '连续性' },
  { id: 'characterAgencyVoice', label: '人物主动性与声音' },
  { id: 'suspenseEnding', label: '悬念与结尾' },
  { id: 'proseNaturalness', label: '文字自然度' },
])

const CHAPTER_CARD_FIELDS = Object.freeze([
  ['goal', '本章合同'],
  ['protagonistGoal', '主角目标'],
  ['resistance', '主要阻力'],
  ['turningPoint', '本章转折'],
  ['payoff', '本章回报'],
  ['cost', '本章代价'],
  ['ending', '结尾合同'],
])

function cleanText(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
}

function normalizeEndingTypography(value) {
  return cleanText(value).replace(/[\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f"'`]/g, '')
}

function quotedEndingContent(value) {
  return cleanText(value).match(/[\u2018\u201c\u300c\u300e"']([^\u2019\u201d\u300d\u300f"']+)[\u2019\u201d\u300d\u300f"']\s*$/)?.[1] || ''
}

function cleanList(value) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : []
}

export function emptyScenePlan(legacyNotes = '') {
  return {
    schemaVersion: SCENE_PLAN_SCHEMA_VERSION,
    summary: '',
    scenes: [],
    legacyNotes: cleanText(legacyNotes),
  }
}

export function normalizeScenePlan(value, legacyText = '') {
  let source = value
  if (typeof source === 'string' && source.trim()) {
    try { source = JSON.parse(source) } catch { return emptyScenePlan(source) }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return emptyScenePlan(legacyText)
  const scenes = Array.isArray(source.scenes) ? source.scenes.map((scene, index) => ({
    id: cleanText(scene?.id) || `S${index + 1}`,
    title: cleanText(scene?.title) || `场景 ${index + 1}`,
    pov: cleanText(scene?.pov),
    time: cleanText(scene?.time),
    location: cleanText(scene?.location),
    presentCharacters: cleanList(scene?.presentCharacters),
    entryState: cleanText(scene?.entryState),
    goal: cleanText(scene?.goal),
    obstacle: cleanText(scene?.obstacle),
    actionBeats: cleanList(scene?.actionBeats),
    turn: cleanText(scene?.turn),
    exitState: cleanText(scene?.exitState),
    knowledgeChanges: cleanList(scene?.knowledgeChanges),
    continuityRisks: cleanList(scene?.continuityRisks),
  })) : []
  return {
    schemaVersion: SCENE_PLAN_SCHEMA_VERSION,
    summary: cleanText(source.summary),
    scenes,
    legacyNotes: cleanText(source.legacyNotes || legacyText),
  }
}

export function renderScenePlan(value) {
  const plan = normalizeScenePlan(value)
  const parts = []
  if (plan.summary) parts.push(`场景计划摘要\n${plan.summary}`)
  for (const scene of plan.scenes) {
    parts.push([
      `${scene.id} · ${scene.title}`,
      `视角：${scene.pov || '待确定'}｜时间：${scene.time || '待确定'}｜地点：${scene.location || '待确定'}`,
      `出场人物：${scene.presentCharacters.join('、') || '待确定'}`,
      `进入状态：${scene.entryState || '待确定'}`,
      `目标：${scene.goal || '待确定'}`,
      `阻力：${scene.obstacle || '待确定'}`,
      `行动节拍：${scene.actionBeats.join('；') || '待确定'}`,
      `转向：${scene.turn || '待确定'}`,
      `离开状态：${scene.exitState || '待确定'}`,
      `信息变化：${scene.knowledgeChanges.join('；') || '无'}`,
      `连续性风险：${scene.continuityRisks.join('；') || '无'}`,
    ].join('\n'))
  }
  if (plan.legacyNotes) parts.push(`旧版场景计划备注\n${plan.legacyNotes}`)
  return parts.join('\n\n')
}

function check(id, label, passed, { critical = false, detail = '', severity = 'warning' } = {}) {
  return { id, label, passed: Boolean(passed), critical: Boolean(critical), severity, detail }
}

export function validateChapterCard(card = {}) {
  const checks = CHAPTER_CARD_FIELDS.map(([field, label]) => check(
    `card-${field}`,
    label,
    cleanText(card?.[field]),
    { critical: ['goal', 'protagonistGoal', 'resistance', 'ending'].includes(field), detail: `${label}需要是可执行、可验证的具体内容。` },
  ))
  const scenes = Array.isArray(card?.requiredScenes) ? card.requiredScenes : []
  checks.push(check('card-scene-count', '必要场景数量为 1–6 个', scenes.length >= 1 && scenes.length <= 6, { critical: true }))
  const ids = scenes.map((scene) => cleanText(scene?.id)).filter(Boolean)
  checks.push(check('card-scene-ids', '必要场景 ID 完整且唯一', ids.length === scenes.length && new Set(ids).size === ids.length, { critical: true }))
  checks.push(check('card-scene-contracts', '每个必要场景都有目标和结果', scenes.length > 0 && scenes.every((scene) => cleanText(scene?.goal) && cleanText(scene?.result)), { critical: true }))
  return checks
}

export function validateScenePlan(value) {
  const plan = normalizeScenePlan(value)
  const hasObjectPollution = /\[object Object\]|\[object Array\]|undefined|null/.test(JSON.stringify(plan))
  const checks = [
    check('scene-schema', '场景计划使用结构化格式', plan.schemaVersion === SCENE_PLAN_SCHEMA_VERSION, { critical: true }),
    check('scene-count', '包含 1–6 个有效场景', plan.scenes.length >= 1 && plan.scenes.length <= 6, { critical: true }),
    check('scene-no-object-pollution', '状态字段没有对象字符串污染', !hasObjectPollution, {
      critical: true,
      severity: 'high',
      detail: 'entryState、exitState 等文本字段必须直接返回字符串，不能返回对象、数组或 [object Object]。',
    }),
  ]
  const ids = plan.scenes.map((scene) => scene.id)
  checks.push(check('scene-ids', '场景 ID 完整且唯一', ids.length > 0 && new Set(ids).size === ids.length, { critical: true }))
  checks.push(check('scene-required-fields', '每场都有视角、进入状态、目标、阻力、转向和离开状态', plan.scenes.length > 0 && plan.scenes.every((scene) => (
    scene.pov && scene.entryState && scene.goal && scene.obstacle && scene.turn && scene.exitState
  )), { critical: true }))
  checks.push(check('scene-action-beats', '每场至少包含一个可见行动节拍', plan.scenes.length > 0 && plan.scenes.every((scene) => scene.actionBeats.length > 0), { critical: true }))
  let linked = plan.scenes.length > 0
  for (let index = 1; index < plan.scenes.length; index += 1) {
    const previous = plan.scenes[index - 1]
    const current = plan.scenes[index]
    if (!previous.exitState || !current.entryState) linked = false
  }
  checks.push(check('scene-state-chain', '后一场承接前一场离开状态', linked, { critical: true, detail: '确定性检查验证状态字段存在；具体语义承接由质量评审模型判断。' }))
  return checks
}

function planningHasContent(planningCenter, kinds) {
  const documents = planningCenter?.documents || {}
  return kinds.some((kind) => Object.values(documents[kind] || {}).some((value) => cleanText(value)))
}

export function buildReadinessReport({ project = {}, chapter = {}, planningCenter = {}, knowledgeCenter = {}, intent = 'draft', cursorOffset = 0 } = {}) {
  const cardChecks = validateChapterCard(chapter.card || {})
  const sceneChecks = validateScenePlan(chapter.scenePlan || chapter.scene_plan_json || chapter.scene_plan || '')
  const checks = [
    check('technical-scene-data', '结构化场景数据可读取', !chapter.scenePlanCorrupt, { critical: true, severity: 'high', detail: '结构化场景数据已损坏，请重新保存或恢复版本后再生成。' }),
    ...cardChecks,
    ...sceneChecks,
    check('context-character', '已有可用人物设定', planningHasContent(planningCenter, ['characters']) || (planningCenter?.entities || []).some((item) => item.kind === 'character'), { detail: '缺少人物资料时，模型更容易生成工具化角色。' }),
    check('context-world', '已有可用世界规则', planningHasContent(planningCenter, ['world']) || (planningCenter?.entities || []).some((item) => item.kind === 'world'), { detail: '缺少规则时，模型会采用保守的现实常识。' }),
    check('context-project', '项目题材和核心想法已填写', cleanText(project.genre) && cleanText(project.idea), { critical: true }),
  ]
  const manuscript = String(chapter.manuscript || '')
  if (intent === 'draft') checks.push(check('intent-draft-empty', '首稿模式用于空白正文', !manuscript.trim(), { critical: true, detail: '已有正文请选择续写或整章重写。' }))
  if (intent === 'continue') {
    const offset = Math.max(0, Math.min(Number(cursorOffset || 0), manuscript.length))
    checks.push(check('intent-continue-prefix', '光标前已有可承接正文', Boolean(manuscript.slice(0, offset).trim()), { critical: true }))
    checks.push(check('intent-continue-suffix', '光标后没有待保留正文', !manuscript.slice(offset).trim(), { detail: '仍可继续，但接受候选时会保留光标后的正文，需注意重复或衔接。', severity: 'info' }))
  }
  if (intent === 'rewrite') checks.push(check('intent-rewrite-source', '已有可供整章重写的正文', Boolean(manuscript.trim()), { critical: true }))
  const criticalPassed = checks.filter((item) => item.critical).every((item) => item.passed)
  const technicalErrors = checks.filter((item) => item.id.startsWith('technical-') && !item.passed)
  const missingCount = checks.filter((item) => !item.passed).length
  return {
    schemaVersion: 1,
    intent,
    checks,
    criticalPassed,
    blocked: technicalErrors.length > 0,
    technicalErrors,
    ready: criticalPassed,
    missingCount,
    summary: missingCount ? `发现 ${missingCount} 项缺失或风险；创作项可确认后继续。` : '章节规划和上下文已达到生成准备状态。',
  }
}

export function planningPromptProfile({ scopeType = '', entityKind = '', fieldKey = '' } = {}) {
  if (scopeType === 'chapter' && fieldKey === 'title') return 'chapter_title'
  if (fieldKey === 'premise') return 'premise_expander'
  if (fieldKey === 'storyPromise') return 'reader_promise'
  if (fieldKey === 'coreConflict') return 'core_conflict'
  if (entityKind === 'character' && fieldKey === 'relationships') return 'relationship_tension'
  if (entityKind === 'character') return 'character_card'
  if (entityKind === 'world' || ['hardRules', 'costs', 'rules', 'constraints', 'powerSystem'].includes(fieldKey)) return 'world_rule'
  if (entityKind === 'volume' || scopeType === 'volume') return 'volume_plan'
  if (scopeType === 'outline' || ['logline', 'opening', 'incitingIncident', 'firstTurn', 'midpoint', 'crisis', 'climax', 'ending', 'thematicArc'].includes(fieldKey)) return 'outline_tree'
  return 'generic'
}

function proseSentenceRecords(value = '') {
  const records = []
  String(value || '').split(/\n+/).forEach((paragraph, paragraphIndex) => {
    const source = paragraph.trim()
    if (!source) return
    const sentences = source.match(/[^。！？!?]+[。！？!?]?/g) || []
    sentences.forEach((raw, sentenceIndex) => {
      const text = raw
        .trim()
        .replace(/^[“”「」『』‘’"']+|[“”「」『』‘’"'。！？!?]+$/g, '')
        .trim()
      if (!text) return
      records.push({
        raw: raw.trim(),
        text,
        paragraphIndex,
        sentenceIndex,
        chineseLength: [...text].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length,
        dialogue: /^[“「『‘"']/.test(raw.trim()),
      })
    })
  })
  return records
}

function proseEvidence(records) {
  return records.map((item) => item.raw || item.text).filter(Boolean)
}

export function detectProseRhythmSignals(value = '') {
  const records = proseSentenceRecords(value)
  const shortRuns = []
  let activeRun = []
  const flushRun = () => {
    if (activeRun.length >= 3) {
      shortRuns.push({
        count: activeRun.length,
        excerpt: activeRun.map((item) => item.raw).join(''),
      })
    }
    activeRun = []
  }
  for (const record of records) {
    if (!record.dialogue && record.chineseLength > 0 && record.chineseLength <= 10) activeRun.push(record)
    else flushRun()
  }
  flushRun()

  const negativeFragments = records.filter((record) => (
    !record.dialogue
    && record.chineseLength <= 10
    && /^[\u3400-\u4dbf\u4e00-\u9fff]{1,8}(?:没有|没|不|未)[\u3400-\u4dbf\u4e00-\u9fff]{1,5}$/u.test(record.text)
  ))
  const abstractSummaries = records.filter((record) => (
    !record.dialogue
    && record.chineseLength <= 16
    && /^(?:这些|那些|这种|那种|这件事|那件事|这东西|那东西).{0,8}(?:不归|都归|不算|只算|不是|意味着|说明|证明)/u.test(record.text)
  ))
  const actionReactionPairs = []
  for (let index = 1; index < records.length; index += 1) {
    const current = records[index]
    const previous = records[index - 1]
    if (
      negativeFragments.includes(current)
      && !previous.dialogue
      && previous.chineseLength > 0
      && previous.chineseLength <= 12
    ) {
      actionReactionPairs.push({
        excerpt: `${previous.raw}${current.raw}`,
        paragraphIndex: current.paragraphIndex,
      })
    }
  }
  return {
    sentenceCount: records.length,
    shortRuns,
    negativeFragments: proseEvidence(negativeFragments),
    abstractSummaries: proseEvidence(abstractSummaries),
    actionReactionPairs,
  }
}

export function deterministicQualityChecks({ task = 'chapter', output = '', chapter = {}, targetLength = 0 } = {}) {
  if (task === 'chapter_card') {
    let card = output
    if (typeof output === 'string') {
      try { card = JSON.parse(output) } catch { return [check('output-json', '输出是有效 JSON', false, { critical: true })] }
    }
    return [check('output-json', '输出是有效 JSON', true, { critical: true }), ...validateChapterCard(card)]
  }
  if (task === 'scene_plan') {
    let plan = output
    if (typeof output === 'string') {
      try { plan = JSON.parse(output) } catch { return [check('output-json', '输出是有效 JSON', false, { critical: true })] }
    }
    return [check('output-json', '输出是有效 JSON', true, { critical: true }), ...validateScenePlan(plan)]
  }
  const text = cleanText(output)
  const ending = cleanText(chapter.card?.ending)
  const goal = cleanText(chapter.card?.goal)
  const scenes = normalizeScenePlan(chapter.scenePlan || chapter.scene_plan_json || chapter.scene_plan || '').scenes
  const finalBeat = cleanText(scenes.at(-1)?.actionBeats?.at(-1))
  const expectedStop = ending && goal && ending === goal && finalBeat && finalBeat !== ending
    ? finalBeat
    : (ending || finalBeat)
  const expectedDialogue = quotedEndingContent(expectedStop)
  const candidateDialogue = quotedEndingContent(text)
  const compactLength = [...String(output || '')].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(char)).length
  const normalizedTarget = Number(targetLength)
  const lengthRange = Number.isFinite(normalizedTarget) && normalizedTarget > 0
    ? { minimum: Math.floor(normalizedTarget * 0.9), maximum: Math.ceil(normalizedTarget * 1.2) }
    : null
  const endingMatches = Boolean(expectedStop) && (
    normalizeEndingTypography(text).endsWith(normalizeEndingTypography(expectedStop))
    || (Boolean(expectedDialogue) && candidateDialogue === expectedDialogue)
  )
  const rhythmSignals = task === 'chapter' || task === 'rewrite'
    ? detectProseRhythmSignals(text)
    : null
  const rhythmChecks = rhythmSignals ? [
    check('output-prose-short-runs', '正文没有连续机械短句', rhythmSignals.shortRuns.length === 0, {
      critical: false,
      severity: 'warning',
      detail: rhythmSignals.shortRuns.length
        ? `发现 ${rhythmSignals.shortRuns.length} 处连续短句；请判断每句是否都独立改变局势：${rhythmSignals.shortRuns.slice(0, 2).map((item) => item.excerpt).join('｜')}`
        : '',
    }),
    check(
      'output-prose-action-fragments',
      '动作对象和反应没有被拆成孤立短句',
      rhythmSignals.actionReactionPairs.length === 0 && rhythmSignals.negativeFragments.length < 2 && rhythmSignals.abstractSummaries.length === 0,
      {
        critical: false,
        severity: 'warning',
        detail: [
          ...rhythmSignals.actionReactionPairs.slice(0, 2).map((item) => item.excerpt),
          ...rhythmSignals.negativeFragments.slice(0, 2),
          ...rhythmSignals.abstractSummaries.slice(0, 2),
        ].filter(Boolean).join('｜'),
      },
    ),
  ] : []
  return [
    check('output-nonempty', '正文候选非空', text.length >= 100, { critical: true }),
    ...(lengthRange ? [check(
      'output-length-target',
      `正文纯中文字符数达到目标范围 ${lengthRange.minimum}–${lengthRange.maximum}`,
      compactLength >= lengthRange.minimum && compactLength <= lengthRange.maximum,
      {
        critical: false,
        severity: 'warning',
        detail: `当前 ${compactLength} 个纯中文字符，目标 ${Math.round(normalizedTarget)}。`,
      },
    )] : []),
    check('output-prose-only', '正文没有分析或提纲标记', !/(创作说明|写作分析|章节提纲|```)/.test(text), { critical: true }),
    check('output-ending-contract', '存在可供评审的章节结尾合同', Boolean(ending), { critical: true, detail: '具体是否越过结尾合同由质量评审模型判断。' }),
    ...(chapter.card?.boundaryMode === 'semantic' || chapter.boundaryMode === 'semantic' ? [] : [check('output-ending-match', '正文完整到达章节硬停止点', endingMatches, {
      critical: true,
      severity: 'high',
      detail: expectedStop ? `正文末尾须到达硬停止事件；对白内容及末尾标点必须一致，闭引号后不得续写：${expectedStop}` : '章节卡或场景计划缺少可验证的硬停止点。',
    })]),
    ...rhythmChecks,
  ]
}

function clampScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(1, Math.min(5, score)) : 1
}

export function normalizeModelReview(value = {}) {
  const scores = Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [dimension.id, clampScore(value?.scores?.[dimension.id])]))
  const issues = Array.isArray(value.issues) ? value.issues.map((issue, index) => ({
    id: cleanText(issue?.id) || `issue-${index + 1}`,
    severity: ['info', 'warning', 'high'].includes(issue?.severity) ? issue.severity : 'warning',
    category: cleanText(issue?.category) || '综合质量',
    criterion: cleanText(issue?.criterion || issue?.reason),
    evidence: cleanText(issue?.evidence?.quote || issue?.evidence),
    repairInstruction: cleanText(issue?.repairInstruction || issue?.suggestion),
    ...(issue?.scope || issue?.impactScope ? { impactScope: cleanText(issue.impactScope || issue.scope) } : {}),
    resolved: Boolean(issue?.resolved),
  })) : []
  const assertionScores = value.assertionScores && typeof value.assertionScores === 'object' && !Array.isArray(value.assertionScores)
    ? Object.fromEntries(Object.entries(value.assertionScores).map(([id, score]) => {
        const rawScore = score && typeof score === 'object' ? score.score : score
        return [id, Math.max(0, Math.min(2, Number(rawScore) || 0))]
      }))
    : {}
  const assertionEvidence = value.assertionEvidence && typeof value.assertionEvidence === 'object' && !Array.isArray(value.assertionEvidence)
    ? Object.fromEntries(Object.entries(value.assertionEvidence).map(([id, evidence]) => {
        if (typeof evidence === 'string') return [id, { candidateEvidence: cleanText(evidence), contraryEvidence: '', reasoning: '' }]
        return [id, {
          candidateEvidence: cleanText(evidence?.candidateEvidence || evidence?.evidence),
          contraryEvidence: cleanText(evidence?.contraryEvidence),
          reasoning: cleanText(evidence?.reasoning || evidence?.reason),
        }]
      }))
    : {}
  return { rubricVersion: QUALITY_RUBRIC_VERSION, scores, issues, summary: cleanText(value.summary), assertionScores, assertionEvidence }
}

function scoreAverage(scores = {}) {
  const values = QUALITY_DIMENSIONS.map((dimension) => Number(scores[dimension.id])).filter(Number.isFinite)
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

export function aggregateQuality({ deterministicChecks = [], modelReview = {}, humanReviews = [], execution = 'remote', repaired = false } = {}) {
  const normalized = normalizeModelReview(modelReview)
  const modelAverage = scoreAverage(normalized.scores)
  const humanAverages = humanReviews.map((review) => scoreAverage(review.scores || {})).filter((value) => value > 0)
  const humanAverage = humanAverages.length ? humanAverages.reduce((total, value) => total + value, 0) / humanAverages.length : 0
  const minimumModelScore = Math.min(...Object.values(normalized.scores))
  const humanMinimum = humanReviews.length
    ? Math.min(...humanReviews.flatMap((review) => Object.values(review.scores || {}).map(Number).filter(Number.isFinite)))
    : 0
  const criticalPassed = deterministicChecks.filter((item) => item.critical).every((item) => item.passed)
  const unresolvedHigh = normalized.issues.some((issue) => issue.severity === 'high' && !issue.resolved)
  const automaticPassed = execution === 'remote' && criticalPassed && modelAverage >= 3.8 && minimumModelScore >= 3 && !unresolvedHigh
  const humanPassed = humanReviews.length > 0 && humanAverage >= 3.8 && humanMinimum >= 3
  const finalPassed = automaticPassed && humanPassed
  return {
    rubricVersion: QUALITY_RUBRIC_VERSION,
    execution,
    criticalPassed,
    modelAverage: Number(modelAverage.toFixed(2)),
    humanAverage: Number(humanAverage.toFixed(2)),
    minimumModelScore,
    humanMinimum,
    unresolvedHigh,
    automaticPassed,
    humanPassed,
    finalPassed,
    verdict: finalPassed
      ? (repaired ? 'pass_after_repair' : 'pass_first_try')
      : automaticPassed && !humanReviews.length ? 'automatic_complete' : 'fail',
  }
}

export function qualityEvidenceExecution(sourceGeneration = {}, reviewerExecution = 'mock') {
  const sourceExecution = [...(sourceGeneration.events || [])].reverse().find((entry) => entry.execution)?.execution
    || (sourceGeneration.model?.provider === 'mock' ? 'mock' : 'unknown')
  return sourceExecution === 'remote' && reviewerExecution === 'remote' ? 'remote' : 'mock'
}

function sentenceUnits(value) {
  return cleanText(value)
    .split(/[。！？!?]+/)
    .map((item) => item.replace(/^[\s\n“”‘’"'：:，,；;]+|[\s\n“”‘’"'：:，,；;]+$/g, '').trim())
    .filter(Boolean)
}

function possessionKey(value) {
  const text = cleanText(value)
  if (/手机/.test(text)) return '手机'
  if (/工牌|工作证|巡检员证/.test(text)) return '工牌'
  if (/病历/.test(text) && /记录|副本|纸质/.test(text)) return '病历记录'
  if (/钥匙/.test(text)) return '钥匙'
  return text.replace(/[（(][^）)]*[）)]/g, '').trim()
}

function explicitPossessionRemoval(manuscript, key) {
  const escaped = cleanText(key).replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const action = '(?:交给|交出|递给|还给|归还|放回|塞回|存回|丢弃|扔掉|遗失|掉落|被[^。！？\\n]{0,12}(?:拿走|夺走|没收)|留在[^。！？\\n]{0,12}(?:身后|原地|房间|柜中)|消耗|用尽)'
  const removal = new RegExp(`${escaped}[^。！？\\n]{0,28}${action}|${action}[^。！？\\n]{0,28}${escaped}`)
  const negated = new RegExp(`(?:没有|没|未|并未|尚未)[^。！？\\n]{0,12}${action}`)
  return cleanText(manuscript).split(/[。！？\\n]+/).some((sentence) => {
    const compactSentence = sentence.replace(/\s+/g, '')
    return removal.test(compactSentence) && !negated.test(compactSentence)
  })
}

function missingPersistentPossessions(orderedChapters, statePayloads) {
  const missing = []
  for (let index = 1; index < statePayloads.length; index += 1) {
    const priorStates = Array.isArray(statePayloads[index - 1]?.characterStates) ? statePayloads[index - 1].characterStates : []
    const currentStates = Array.isArray(statePayloads[index]?.characterStates) ? statePayloads[index].characterStates : []
    for (const prior of priorStates) {
      const current = currentStates.find((state) => cleanText(state?.character) === cleanText(prior?.character))
      if (!current) continue
      const currentKeys = new Set((current.possessions || []).map(possessionKey).filter(Boolean))
      for (const possession of prior.possessions || []) {
        const key = possessionKey(possession)
        if (!key || currentKeys.has(key) || explicitPossessionRemoval(orderedChapters[index]?.manuscript, key)) continue
        missing.push(`第 ${index} 章到第 ${index + 1} 章：${cleanText(prior.character)}的“${key}”无交出/放回/遗失证据却从章后状态消失`)
      }
    }
  }
  return missing
}

export function urbanSuspenseDeterministicEvaluation({ chapters = [], stateSnapshots = [], hardRules = '' } = {}) {
  const orderedChapters = [...chapters].sort((left, right) => Number(left.chapter_no || left.chapterNo || 0) - Number(right.chapter_no || right.chapterNo || 0))
  const chapter2 = cleanText(orderedChapters[1]?.manuscript)
  const chapter3 = cleanText(orderedChapters[2]?.manuscript)
  const orderedStates = [...stateSnapshots].sort((left, right) => Number(left.chapterNo || left.chapter_no || 0) - Number(right.chapterNo || right.chapter_no || 0))
  const statePayloads = orderedStates.map((snapshot) => snapshot?.payload || snapshot?.stateSnapshot || snapshot || {})
  const chapter3State = JSON.stringify(statePayloads[2] || {})
  const earlierStates = JSON.stringify(statePayloads.slice(0, 2))
  const earlierManuscripts = orderedChapters.slice(0, 2).map((chapter) => cleanText(chapter.manuscript)).join('\n')
  const inventedRouteEvidence = /地下档案室-1F北侧楼梯/.test(chapter3) && !/地下档案室-1F北侧楼梯/.test(earlierManuscripts)
  const earlyKeyUse = /(?:将|把)?(?:特殊|古朴|铜制|金属)?钥匙[^。！？\n]{0,24}(?:插入|伸进|转动|旋转|试着开|开锁|打开)|(?:插入|伸进|转动|旋转)[^。！？\n]{0,16}钥匙/.test(chapter2)
  const chapter2EndingTail = chapter2.slice(-650)
  const chapter2ExitUnits = sentenceUnits(chapter2EndingTail).filter((unit) => (
    /(?:离开|溜出|冲出|逃出|撤离)[^。！？\n]{0,28}(?:仓库|后门|窄巷|夜色)|(?:仓库|后门|窄巷)[^。！？\n]{0,28}(?:离开|溜出|冲出|逃出|撤离)|(?:身影[^。！？\n]{0,20})?(?:融入|消失)[^。！？\n]{0,12}夜色/.test(unit)
  ))
  const repeatedChapter2Ending = chapter2ExitUnits.length > 1
  const missingPossessions = missingPersistentPossessions(orderedChapters, statePayloads)
  const missingRequiredReset = /主动复位/.test(cleanText(hardRules)) && !/主动复位|将?锁舌复位|把锁舌复位/.test(chapter3)
  const inferredHandSide = (
    /左手手指|左手指尖/.test(chapter3State) && !/(?:左手(?:的)?(?:手指|指尖)|左手[^。！？\n]{0,24}(?:锈边|割伤|割破)|(?:锈边|割伤|割破)[^。！？\n]{0,24}左手)/.test(chapter3)
  ) || (
    /右手手指|右手指尖/.test(chapter3State) && !/(?:右手(?:的)?(?:手指|指尖)|右手[^。！？\n]{0,24}(?:锈边|割伤|割破)|(?:锈边|割伤|割破)[^。！？\n]{0,24}右手)/.test(chapter3)
  ) || (/双手/.test(chapter3State) && !/双手/.test(chapter3))

  const successfulOpen = /(锁芯|锁舌|门锁)[^。！？\n]{0,40}(松开|释放|弹开|打开)|门(?:扇)?[^。！？\n]{0,20}开(?:了|出|一条缝)/.test(chapter3)
  const successCrack = successfulOpen && /钥匙柄[^。！？\n]{0,80}(裂|裂纹|一道纹)|钥匙[^。！？\n]{0,40}(裂开|裂纹)/.test(chapter3)
  const manuscriptSaysNotBroken = /(?:没|未|没有)断/.test(chapter3)
  const stateSaysBroken = /钥匙[^。；，\n]{0,40}(断裂|断开|断了|报废)|断裂报废/.test(chapter3State)
  const futureVoiceLeak = /(自己的声音|林砚的声音|门后[^。；，\n]{0,20}声音)/.test(earlierStates)

  const voiceMatch = /(是(?:他|林砚)(?:本人|自己)?的声音|他自己的声音|与(?:他|林砚)(?:本人|自己)?声音相同)/.exec(chapter3)
  const endingTail = voiceMatch ? chapter3.slice((voiceMatch.index || 0) + voiceMatch[0].length) : ''
  const endingUnits = sentenceUnits(endingTail)
  const exactStop = '林砚猛地停住'
  const exactStopIndex = chapter3.lastIndexOf(exactStop)
  const afterExactStop = exactStopIndex >= 0 ? chapter3.slice(exactStopIndex + exactStop.length).replace(/^[。！？!?\s]+/, '').trim() : ''
  const betweenVoiceAndStop = voiceMatch && exactStopIndex >= 0
    ? chapter3.slice((voiceMatch.index || 0) + voiceMatch[0].length, exactStopIndex)
    : ''
  const betweenVoiceAndStopUnits = sentenceUnits(betweenVoiceAndStop)
  const beforeVoice = voiceMatch ? chapter3.slice(0, voiceMatch.index || 0) : chapter3
  const crossedDoorBeforeVoice = /(?:侧身|挤|跨|迈|踏|走)[^。！？\n]{0,24}(?:进入|门内|门槛|第[一二三四五六七八九十\d]+级台阶)|(?:开始|继续)[^。！？\n]{0,12}(?:下楼|下行|深入)/.test(beforeVoice)
  const endingWithinBoundary = exactStopIndex >= 0
    ? Boolean(voiceMatch) && exactStopIndex >= (voiceMatch.index || 0) + voiceMatch[0].length && !afterExactStop && !betweenVoiceAndStopUnits.length && !crossedDoorBeforeVoice
    : Boolean(voiceMatch) && endingUnits.length <= 1

  const checks = [
    {
      id: 'cross-chapter-causality',
      score: inventedRouteEvidence ? 0 : 2,
      evidence: inventedRouteEvidence
        ? '第三章把“地下档案室-1F北侧楼梯”写成先前操作日志截图中的既有信息，但第一、二章正文均未建立这条地点证据。'
        : '未发现第三章把此前未建立的固定地点编号或导航记录伪装成既有线索。',
    },
    {
      id: 'key-sequence',
      score: earlyKeyUse ? 0 : 2,
      evidence: earlyKeyUse
        ? '第二章在取得特殊钥匙后已执行插入锁孔、转动或开锁动作，违反“第三章午夜首次使用”序列。'
        : '第二章未发现特殊钥匙的插锁、转动或开锁动作。',
    },
    {
      id: 'key-hard-rule',
      score: successCrack || missingRequiredReset ? 0 : 2,
      evidence: successCrack
        ? '第三章成功触发钥匙后仍新增钥匙柄裂纹；本次已确认规则没有授权该成功分支后果。'
        : missingRequiredReset
          ? '本次 hardRules 明确要求成功进入后主动复位，第三章正文没有出现锁舌复位动作。'
        : '未发现成功触发钥匙后新增未授权裂纹或套用其他条件分支后果。',
    },
    {
      id: 'chapter-ending-once',
      score: repeatedChapter2Ending ? 0 : 2,
      evidence: repeatedChapter2Ending
        ? `第二章尾段用 ${chapter2ExitUnits.length} 个句子重复完成离开仓库或消失在夜色中的结尾事件：${chapter2ExitUnits.join('｜')}`
        : '第二章尾段未发现先用同义句完成离场、随后再次复述章节结尾的情况。',
    },
    {
      id: 'state-evidence-boundary',
      score: manuscriptSaysNotBroken && stateSaysBroken || futureVoiceLeak || missingPossessions.length || inferredHandSide ? 0 : 2,
      evidence: manuscriptSaysNotBroken && stateSaysBroken
        ? '第三章正文明确钥匙没断，章后状态却记录为断裂或报废。'
        : futureVoiceLeak
          ? '第一或第二章章后状态提前记录了第三章门后的声音。'
          : missingPossessions.length
            ? missingPossessions.join('；')
            : inferredHandSide
              ? '第三章章后状态把正文未指定侧别或数量的“指尖/满手”具体化为左手、右手或双手。'
          : '未发现章后状态反转明确否定或提前写入门后声音。',
    },
    {
      id: 'final-ending-boundary',
      score: endingWithinBoundary ? 2 : 0,
      evidence: crossedDoorBeforeVoice
        ? '第三章在门后声音出现前已经跨过门槛、进入门内或开始下行，越过了“门后传声、门前停住”的边界。'
        : betweenVoiceAndStopUnits.length
          ? `首次确认是林砚声音与硬停止句之间仍有 ${betweenVoiceAndStopUnits.length} 个解释或动作单位：${betweenVoiceAndStopUnits.join('｜')}`
          : exactStopIndex >= 0
            ? afterExactStop
              ? `硬停止句“${exactStop}”后仍有正文：${afterExactStop.slice(0, 500)}`
              : `正文严格结束于硬停止句“${exactStop}”，且声音确认后直接停住。`
        : voiceMatch
          ? `首次确认是林砚声音后仍有 ${endingUnits.length} 个句子/动作单位；允许值不超过 1。尾段：${endingTail.slice(0, 500)}`
        : '第三章正文中没有定位到“是林砚自己的声音”这一结尾事件。',
    },
  ]
  return {
    scores: Object.fromEntries(checks.map((item) => [item.id, item.score])),
    evidence: Object.fromEntries(checks.map((item) => [item.id, item.evidence])),
    checks,
  }
}

export const URBAN_SUSPENSE_BENCHMARK = Object.freeze({
  id: 'urban-suspense-three-chapter-v1',
  name: '都市悬疑三章闭环',
  project: {
    title: '午夜病历',
    genre: '都市悬疑',
    idea: '调查者林砚追查一份被医院修改的病历。医生只是嫌疑人而非已确认凶手；林砚带伤行动。第一章开始时他尚未取得特殊钥匙，第二章取得钥匙，第三章才在午夜首次使用；钥匙每天午夜只能使用一次。第三章必须停在地下室门后第一次传出林砚自己的声音和一个即时反应，不能揭示来源或继续调查。',
    style: '第三人称限知，克制、具体，以行动、追问和可验证证据推进，不替读者解释悬念。',
  },
  evaluationAssertions: [
    { id: 'cross-chapter-causality', critical: true, criterion: '第二章直接承接第一章假身份暴露与取证结果，第三章直接承接第二章取得钥匙、伤情和地下室入口。' },
    { id: 'injury-continuity', critical: true, criterion: '林砚的受伤部位、严重程度和行动限制在三章之间一致；没有右侧变左侧、伤势消失或无因升级。' },
    { id: 'key-sequence', critical: true, criterion: '第一章林砚尚未持有或使用特殊钥匙；第二章明确取得但不使用；第三章午夜首次使用且只使用一次。' },
    { id: 'key-hard-rule', critical: true, criterion: '逐字服从本次运行已确认的钥匙 hardRules：触发条件、成功/失败分支和后果不可互换，也不得新增 hardRules 未定义的物件裂纹、损坏、警报或第二次机会。' },
    { id: 'chapter-ending-once', critical: true, criterion: '每章 ending 所定义的最后不可逆事件只完成一次；不得先用同义句提前完成离场、消失、关门、停步或最终反应，再在硬停止句中重复。' },
    { id: 'suspect-boundary', critical: true, criterion: '三章始终只确认医生修改过病历，没有把医生写成已确认凶手。' },
    { id: 'state-evidence-boundary', critical: true, criterion: '每章章后状态只记录该章正文已经发生或人物已经知道的内容，不提前写入未来章节计划或门后声音；必须保持正文的否定和物件状态，例如正文“没断”不得记录成“断裂报废”。' },
    { id: 'final-ending-boundary', critical: true, criterion: '第三章停在门后第一次传出林砚自己的声音或其后一个句子的一次即时感官/身体反应；之后不得再写第二个反应、否定式动作清单、环境收束、思考、录音、照明、调查、进入或撤离。必须引用从第一次确认“是他的声音”到全文结束的完整尾段并逐句计数。' },
    { id: 'prose-only', critical: false, criterion: '三章均为可直接阅读的小说正文，没有分析、提纲或创作说明。' },
  ],
  planningFields: [
    { scopeType: 'foundation', fieldKey: 'premise', fieldLabel: '故事前提' },
    { scopeType: 'foundation', fieldKey: 'coreConflict', fieldLabel: '核心冲突' },
    { scopeType: 'foundation', fieldKey: 'storyPromise', fieldLabel: '阅读承诺' },
    { scopeType: 'character', entityKind: 'character', fieldKey: 'desire', fieldLabel: '主角欲望' },
    { scopeType: 'world', entityKind: 'world', fieldKey: 'hardRules', fieldLabel: '世界硬规则' },
    { scopeType: 'outline', fieldKey: 'opening', fieldLabel: '开局常态' },
  ],
  chapters: [
    { title: '站台交接', contract: '林砚取得被修改的病历证据，但潜入医院使用的假身份被保安识破。' },
    { title: '仓库追踪', contract: '林砚在追踪病历来源时受伤并取得特殊钥匙，只能确认医生改过病历，不能确认医生是凶手。' },
    { title: '午夜地下室', contract: '林砚午夜使用唯一一次钥匙机会后走到地下室门前，门后第一次传出他自己的声音，林砚猛地停住。“林砚猛地停住”是正文最后一句。' },
  ],
})

export const PROMPT_EVAL_BENCHMARK = Object.freeze({
  id: 'prompt-eval-cases-v1',
  name: '12 项提示词回归基线',
  project: {
    title: '提示词评测隔离工作区',
    genre: '都市悬疑',
    idea: '用于逐项执行固定创作合同、连续性和输出边界断言的隐藏工作区。',
    style: '第三人称限知；使用具体行动、清晰因果与克制叙述。',
  },
  chapters: [{ title: '评测章节', contract: '严格停在当前评测案例指定的边界。' }],
})
