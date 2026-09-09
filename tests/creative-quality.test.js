import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateQuality,
  buildReadinessReport,
  detectProseRhythmSignals,
  deterministicQualityChecks,
  normalizeModelReview,
  normalizeScenePlan,
  planningPromptProfile,
  qualityEvidenceExecution,
  renderScenePlan,
  urbanSuspenseDeterministicEvaluation,
  validateChapterCard,
  validateScenePlan,
} from '../electron/creative-quality.js'

const validCard = {
  goal: '取得病历证据', protagonistGoal: '找到病历修改记录', resistance: '权限与伤势限制行动',
  turningPoint: '保安识破假身份', payoff: '取得修改时间', cost: '身份暴露', ending: '保安喊出林砚真名',
  requiredScenes: [{ id: 'S1', title: '档案室', goal: '取得记录', result: '身份暴露但带走记录' }],
}

const validPlan = {
  schemaVersion: 1, summary: '潜入并暴露身份', legacyNotes: '',
  scenes: [{
    id: 'S1', title: '档案室', pov: '林砚', time: '午夜前', location: '医院档案室', presentCharacters: ['林砚'],
    entryState: '林砚持假证进入', goal: '复制修改记录', obstacle: '值班保安提前巡查', actionBeats: ['检索病历', '复制日志'],
    turn: '保安认出假证', exitState: '林砚带记录撤离且身份暴露', knowledgeChanges: ['确认病历被改'], continuityRisks: ['下一章延续腿伤'],
  }],
}

test('planning fields map to dedicated prompt profiles with a generic fallback', () => {
  assert.equal(planningPromptProfile({ fieldKey: 'premise' }), 'premise_expander')
  assert.equal(planningPromptProfile({ entityKind: 'character', fieldKey: 'relationships' }), 'relationship_tension')
  assert.equal(planningPromptProfile({ entityKind: 'world', fieldKey: 'hardRules' }), 'world_rule')
  assert.equal(planningPromptProfile({ scopeType: 'volume', fieldKey: 'goal' }), 'volume_plan')
  assert.equal(planningPromptProfile({ scopeType: 'outline', fieldKey: 'midpoint' }), 'outline_tree')
  assert.equal(planningPromptProfile({ scopeType: 'chapter', fieldKey: 'title' }), 'chapter_title')
  assert.equal(planningPromptProfile({ fieldKey: 'customField' }), 'generic')
})

test('legacy scene text is preserved without pretending it is structured', () => {
  const plan = normalizeScenePlan('场景一：后台对峙。')
  assert.equal(plan.scenes.length, 0)
  assert.equal(plan.legacyNotes, '场景一：后台对峙。')
  assert.match(renderScenePlan(plan), /旧版场景计划备注/)
})

test('chapter and scene contracts reject incomplete structures', () => {
  assert.equal(validateChapterCard(validCard).filter((item) => item.critical && !item.passed).length, 0)
  assert.ok(validateChapterCard({ goal: '空泛目标', requiredScenes: [] }).some((item) => item.critical && !item.passed))
  assert.equal(validateScenePlan(validPlan).filter((item) => item.critical && !item.passed).length, 0)
  assert.ok(validateScenePlan({ schemaVersion: 1, scenes: [{ id: 'S1' }] }).some((item) => item.id === 'scene-required-fields' && !item.passed))
  const polluted = structuredClone(validPlan)
  polluted.scenes[0].entryState = { location: '医院', injury: '肋骨旧伤' }
  assert.ok(validateScenePlan(polluted).some((item) => item.id === 'scene-required-fields' && !item.passed))
  polluted.scenes[0].entryState = '[object Object]'
  assert.ok(validateScenePlan(polluted).some((item) => item.id === 'scene-no-object-pollution' && !item.passed))
})

test('chapter deterministic checks reject a manuscript that stops before the hard ending', () => {
  const incomplete = deterministicQualityChecks({
    task: 'chapter',
    output: '林砚潜入档案室，找到了被修改的病历。走廊外传来保安的脚步声。'.repeat(3),
    chapter: { card: validCard, scenePlan: validPlan },
  })
  assert.equal(incomplete.find((item) => item.id === 'output-ending-match').passed, false)
  const complete = deterministicQualityChecks({
    task: 'chapter',
    output: `${'林砚潜入档案室并带走病历。'.repeat(8)}${validCard.ending}`,
    chapter: { card: validCard, scenePlan: validPlan },
  })
  assert.equal(complete.find((item) => item.id === 'output-ending-match').passed, true)
})

test('prose rhythm detector catches mechanical sentence splitting without banning normal short beats', () => {
  const mechanical = '火一着，直播间先替他紧张起来。周砚没看。锅里的声音倒没乱。这些东西不归厨艺管。女生伸手来接。周砚没松。'
  const signals = detectProseRhythmSignals(mechanical)
  assert.equal(signals.shortRuns.length, 1)
  assert.ok(signals.negativeFragments.includes('周砚没看。'))
  assert.ok(signals.negativeFragments.includes('周砚没松。'))
  assert.ok(signals.abstractSummaries.includes('这些东西不归厨艺管。'))
  assert.ok(signals.actionReactionPairs.some((item) => item.excerpt.includes('女生伸手来接。周砚没松。')))

  const checks = deterministicQualityChecks({
    task: 'chapter',
    output: `${mechanical.repeat(2)}${validCard.ending}`,
    chapter: { card: validCard, scenePlan: validPlan },
  })
  assert.equal(checks.find((item) => item.id === 'output-prose-short-runs').passed, false)
  assert.equal(checks.find((item) => item.id === 'output-prose-short-runs').critical, false)
  assert.equal(checks.find((item) => item.id === 'output-prose-action-fragments').passed, false)
})

test('prose rhythm detector preserves a concise beat when it changes the scene', () => {
  const signals = detectProseRhythmSignals('门开了。是周砚。林砚握着钥匙，等那道声音再次响起。')
  assert.equal(signals.shortRuns.length, 0)
  assert.equal(signals.negativeFragments.length, 0)
  assert.equal(signals.actionReactionPairs.length, 0)
})

test('chapter deterministic checks enforce an explicit manuscript length target', () => {
  const short = deterministicQualityChecks({
    task: 'chapter',
    output: `${'短正文。'.repeat(200)}${validCard.ending}`,
    chapter: { card: validCard, scenePlan: validPlan },
    targetLength: 3000,
  })
  const lengthCheck = short.find((item) => item.id === 'output-length-target')
  assert.equal(lengthCheck.passed, false)
  assert.equal(lengthCheck.critical, false)
  assert.match(lengthCheck.detail, /目标 3000/)
  const complete = deterministicQualityChecks({
    task: 'chapter',
    output: `${'字'.repeat(2990)}${validCard.ending}`,
    chapter: { card: validCard, scenePlan: validPlan },
    targetLength: 3000,
  })
  assert.equal(complete.find((item) => item.id === 'output-length-target').passed, true)
})

test('chapter hard ending treats Chinese quote glyphs as equivalent typography', () => {
  const card = {
    ...validCard,
    ending: '保安抬起眼睛说：‘你的预约码不对。’',
  }
  const checks = deterministicQualityChecks({
    task: 'chapter',
    output: `${'林砚带着证据走向出口。'.repeat(8)}保安抬起眼睛说：“你的预约码不对。”`,
    chapter: { card, scenePlan: validPlan },
  })
  assert.equal(checks.find((item) => item.id === 'output-ending-match').passed, true)

  const prefixedAttribution = deterministicQualityChecks({
    task: 'chapter',
    output: `${'林砚带着证据走向出口。'.repeat(8)}保安盯着屏幕，眉头锁紧，他抬起眼睛说：“你的预约码不对。”`,
    chapter: { card, scenePlan: validPlan },
  })
  assert.equal(prefixedAttribution.find((item) => item.id === 'output-ending-match').passed, true)

  const changedPunctuation = deterministicQualityChecks({
    task: 'chapter',
    output: `${'林砚带着证据走向出口。'.repeat(8)}保安抬起眼睛说：“你的预约码不对！”`,
    chapter: { card, scenePlan: validPlan },
  })
  assert.equal(changedPunctuation.find((item) => item.id === 'output-ending-match').passed, false)
})

test('readiness is a soft creative gate but distinguishes generation intent risks', () => {
  const planningCenter = { documents: {}, entities: [{ kind: 'character' }, { kind: 'world' }] }
  const ready = buildReadinessReport({
    project: { genre: '都市悬疑', idea: '追查病历' }, chapter: { card: validCard, scenePlan: validPlan, manuscript: '' }, planningCenter, intent: 'draft',
  })
  assert.equal(ready.criticalPassed, true)
  const occupiedDraft = buildReadinessReport({
    project: { genre: '都市悬疑', idea: '追查病历' }, chapter: { card: validCard, scenePlan: validPlan, manuscript: '已有正文' }, planningCenter, intent: 'draft',
  })
  assert.equal(occupiedDraft.checks.find((item) => item.id === 'intent-draft-empty').passed, false)
  const continuation = buildReadinessReport({
    project: { genre: '都市悬疑', idea: '追查病历' }, chapter: { card: validCard, scenePlan: validPlan, manuscript: '前文\n后文' }, planningCenter, intent: 'continue', cursorOffset: 2,
  })
  assert.equal(continuation.checks.find((item) => item.id === 'intent-continue-suffix').passed, false)
  assert.equal(continuation.checks.find((item) => item.id === 'intent-continue-suffix').critical, false)
  const corrupted = buildReadinessReport({
    project: { genre: '都市悬疑', idea: '追查病历' }, chapter: { card: validCard, scenePlan: validPlan, scenePlanCorrupt: true, manuscript: '' }, planningCenter, intent: 'draft',
  })
  assert.equal(corrupted.blocked, true)
  assert.equal(corrupted.technicalErrors[0].id, 'technical-scene-data')
})

test('quality gate separates mock, automatic completion and human final verdicts', () => {
  const checks = [{ id: 'critical', critical: true, passed: true }]
  const scores = { planningAdherence: 4, causalProgression: 4, sceneProgression: 4, continuity: 4, characterAgencyVoice: 4, suspenseEnding: 4, proseNaturalness: 4 }
  assert.equal(aggregateQuality({ deterministicChecks: checks, modelReview: { scores }, execution: 'mock' }).automaticPassed, false)
  assert.equal(aggregateQuality({ deterministicChecks: checks, modelReview: { scores: { ...scores, continuity: 2 } }, execution: 'remote' }).verdict, 'fail')
  const automatic = aggregateQuality({ deterministicChecks: checks, modelReview: { scores }, execution: 'remote' })
  assert.equal(automatic.verdict, 'automatic_complete')
  assert.equal(automatic.finalPassed, false)
  const final = aggregateQuality({ deterministicChecks: checks, modelReview: { scores }, humanReviews: [{ scores }], execution: 'remote' })
  assert.equal(final.verdict, 'pass_first_try')
  assert.equal(final.finalPassed, true)
  assert.equal(aggregateQuality({ deterministicChecks: checks, modelReview: { scores }, humanReviews: [{ scores }], execution: 'remote', repaired: true }).verdict, 'pass_after_repair')
})

test('model review preserves assertion evidence and object-form scores', () => {
  const review = normalizeModelReview({
    scores: { planningAdherence: 4, causalProgression: 4, sceneProgression: 4, continuity: 4, characterAgencyVoice: 4, suspenseEnding: 4, proseNaturalness: 4 },
    assertionScores: { boundary: { score: 2 } },
    assertionEvidence: { boundary: { candidateEvidence: '结尾原文', contraryEvidence: '未发现', reasoning: '只有一次反应' } },
  })
  assert.equal(review.assertionScores.boundary, 2)
  assert.deepEqual(review.assertionEvidence.boundary, {
    candidateEvidence: '结尾原文', contraryEvidence: '未发现', reasoning: '只有一次反应',
  })
})

test('quality evidence is remote only when both creation and review used real models', () => {
  const remoteSource = { events: [{ type: 'execution', execution: 'remote' }], model: { provider: 'deepseek' } }
  assert.equal(qualityEvidenceExecution(remoteSource, 'remote'), 'remote')
  assert.equal(qualityEvidenceExecution(remoteSource, 'mock'), 'mock')
  assert.equal(qualityEvidenceExecution({ events: [{ type: 'execution', execution: 'mock' }], model: { provider: 'deepseek' } }, 'remote'), 'mock')
  assert.equal(qualityEvidenceExecution({ model: { provider: 'deepseek' } }, 'remote'), 'mock')
})

test('urban suspense deterministic checks catch branch, state, and ending regressions', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚尚未取得特殊钥匙。' },
      { chapter_no: 2, manuscript: '林砚拿到钥匙。午夜还没到。' },
      {
        chapter_no: 3,
        manuscript: '午夜，锁芯弹开，门开了一条缝。钥匙柄多了一道裂纹，但没断。门后说：“先确认。”是他的声音。林砚僵住。门外起了风，他仍站着。',
      },
    ],
    stateSnapshots: [
      { chapterNo: 1, payload: { summary: '尚未拿到钥匙' } },
      { chapterNo: 2, payload: { summary: '拿到但未使用钥匙' } },
      { chapterNo: 3, payload: { summary: '钥匙断裂报废' } },
    ],
  })
  assert.equal(result.scores['key-hard-rule'], 0)
  assert.equal(result.scores['state-evidence-boundary'], 0)
  assert.equal(result.scores['final-ending-boundary'], 0)
  assert.equal(result.scores['cross-chapter-causality'], 2)
  assert.match(result.evidence['final-ending-boundary'], /允许值不超过 1/)

  const clean = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚尚未取得特殊钥匙。' },
      { chapter_no: 2, manuscript: '林砚拿到钥匙，但没有使用。' },
      { chapter_no: 3, manuscript: '午夜，锁芯弹开，门开了一条缝。门后说：“先确认。”是他的声音。林砚僵住。' },
    ],
    stateSnapshots: [
      { chapterNo: 1, payload: { summary: '尚未拿到钥匙' } },
      { chapterNo: 2, payload: { summary: '拿到但未使用钥匙' } },
      { chapterNo: 3, payload: { summary: '钥匙当天失效，但没有断裂' } },
    ],
  })
  assert.deepEqual(clean.scores, {
    'cross-chapter-causality': 2,
    'key-sequence': 2,
    'key-hard-rule': 2,
    'chapter-ending-once': 2,
    'state-evidence-boundary': 2,
    'final-ending-boundary': 2,
  })
})

test('urban suspense ending check rejects a paraphrased exit before the exact stop', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚取得病历后冲出档案室。' },
      {
        chapter_no: 2,
        manuscript: '夜风卷起尘土。他沿着窄巷踉跄前行，身影逐渐融入夜色。林砚将钥匙和证据藏好，忍着肋下剧痛，从仓库后门溜出，消失在夜色中。',
      },
      { chapter_no: 3, manuscript: '门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
  })
  assert.equal(result.scores['chapter-ending-once'], 0)
  assert.match(result.evidence['chapter-ending-once'], /重复完成/)
})

test('urban suspense final boundary rejects entering before the voice and explanation before the stop', () => {
  const entered = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '第一章。' },
      { chapter_no: 2, manuscript: '林砚取得钥匙但未使用。' },
      { chapter_no: 3, manuscript: '午夜，他打开门，侧身挤入门内，踏上第一级台阶。门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
  })
  assert.equal(entered.scores['final-ending-boundary'], 0)
  assert.match(entered.evidence['final-ending-boundary'], /跨过门槛/)

  const explained = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '第一章。' },
      { chapter_no: 2, manuscript: '林砚取得钥匙但未使用。' },
      { chapter_no: 3, manuscript: '门后第一次传出他自己的声音。那音色确切无疑，他听见更多模糊音节。林砚猛地停住。' },
    ],
  })
  assert.equal(explained.scores['final-ending-boundary'], 0)
  assert.match(explained.evidence['final-ending-boundary'], /硬停止句之间/)
})

test('urban suspense key sequence rejects any second-chapter key operation', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚尚未取得特殊钥匙。' },
      { chapter_no: 2, manuscript: '林砚取得古朴钥匙。他将钥匙插入金属箱锁孔，转动后打开了箱子。' },
      { chapter_no: 3, manuscript: '午夜，他用钥匙打开地下室门。门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
  })
  assert.equal(result.scores['key-sequence'], 0)
  assert.match(result.evidence['key-sequence'], /第二章/)
})

test('urban suspense deterministic checks reject invented route evidence and silently dropped inventory', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚用手机拍下病历修改记录，把工牌塞进胸前口袋。' },
      { chapter_no: 2, manuscript: '林砚取得纸质病历和黄铜钥匙，手机与工牌没有交出或遗失。' },
      { chapter_no: 3, manuscript: '他打开操作日志截图，看见“地下档案室-1F北侧楼梯”。门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
    stateSnapshots: [
      { chapterNo: 1, payload: { characterStates: [{ character: '林砚', possessions: ['手机', '工牌（设备科临时巡检员）'] }] } },
      { chapterNo: 2, payload: { characterStates: [{ character: '林砚', possessions: ['纸质病历记录', '黄铜钥匙'] }] } },
      { chapterNo: 3, payload: { characterStates: [{ character: '林砚', possessions: ['纸质病历记录', '黄铜钥匙'] }] } },
    ],
  })
  assert.equal(result.scores['cross-chapter-causality'], 0)
  assert.equal(result.scores['state-evidence-boundary'], 0)
  assert.match(result.evidence['cross-chapter-causality'], /第一、二章正文均未建立/)
  assert.match(result.evidence['state-evidence-boundary'], /手机/)
  assert.match(result.evidence['state-evidence-boundary'], /工牌/)
})

test('urban suspense state boundary accepts an explicitly returned possession', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚将 G-117 病历页收进外套内袋。' },
      { chapter_no: 2, manuscript: '林砚将 G-117 病历页放回柜中，关上柜门。' },
      { chapter_no: 3, manuscript: '门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
    stateSnapshots: [
      { chapterNo: 1, payload: { characterStates: [{ character: '林砚', possessions: ['G-117病历页'] }] } },
      { chapterNo: 2, payload: { characterStates: [{ character: '林砚', possessions: [] }] } },
      { chapterNo: 3, payload: { characterStates: [{ character: '林砚', possessions: [] }] } },
    ],
  })
  assert.equal(result.scores['state-evidence-boundary'], 2)
})

test('urban suspense state boundary rejects unsupported hand-side precision', () => {
  const result = urbanSuspenseDeterministicEvaluation({
    chapters: [
      { chapter_no: 1, manuscript: '林砚仍在调查。' },
      { chapter_no: 2, manuscript: '林砚取得钥匙。' },
      { chapter_no: 3, manuscript: '牌下是锁孔，锈边割指尖。他摸墙前行，湿灰沾了满手。门后第一次传出他自己的声音。林砚猛地停住。' },
    ],
    stateSnapshots: [
      { chapterNo: 1, payload: { characterStates: [{ character: '林砚', possessions: [] }] } },
      { chapterNo: 2, payload: { characterStates: [{ character: '林砚', possessions: ['钥匙'] }] } },
      { chapterNo: 3, payload: { characterStates: [{ character: '林砚', physical: '左手手指割伤，双手沾满湿灰', possessions: ['钥匙'] }] } },
    ],
  })
  assert.equal(result.scores['state-evidence-boundary'], 0)
  assert.match(result.evidence['state-evidence-boundary'], /未指定侧别或数量/)
})

test('urban suspense key check follows the current run active-reset rule', () => {
  const chapters = [
    { chapter_no: 1, manuscript: '林砚尚未取得钥匙。' },
    { chapter_no: 2, manuscript: '林砚取得钥匙但没有使用。' },
    { chapter_no: 3, manuscript: '午夜，他转动钥匙，门开了。他进入门内。门后第一次传出他自己的声音。林砚猛地停住。' },
  ]
  const failed = urbanSuspenseDeterministicEvaluation({ chapters, hardRules: '若操作成功，由持钥人进入后主动复位锁舌。' })
  assert.equal(failed.scores['key-hard-rule'], 0)
  assert.match(failed.evidence['key-hard-rule'], /没有出现锁舌复位/)

  chapters[2].manuscript = '午夜，他转动钥匙，门开了。他进入门内，把锁舌复位。门后第一次传出他自己的声音。林砚猛地停住。'
  const passed = urbanSuspenseDeterministicEvaluation({ chapters, hardRules: '若操作成功，由持钥人进入后主动复位锁舌。' })
  assert.equal(passed.scores['key-hard-rule'], 2)
})
