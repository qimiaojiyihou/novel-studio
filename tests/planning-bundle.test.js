import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPlanningChapterBundleTarget,
  buildPlanningDocumentBundleTarget,
  buildPlanningEntityBundleTarget,
  normalizePlanningChapterBundleCandidate,
  normalizePlanningDocumentBundleCandidate,
  normalizePlanningEntityBundleCandidate,
  planningBundleSchema,
  planningEntityBundleSchema,
} from '../electron/planning-bundle.js'

test('planning chapter bundle targets all blank chapter planning fields as one result', () => {
  const target = buildPlanningChapterBundleTarget({
    id: 'chapter-1', chapter_no: 1, title: '第一次直播',
    card_json: JSON.stringify({ goal: '完成首场公开交付', protagonistGoal: '', resistance: '', ending: '收到节目邀请' }),
    scene_plan: '',
  }, { fieldKeys: ['goal', 'protagonistGoal', 'resistance', 'ending', 'scenePlan'] })

  assert.equal(target.kind, 'planning_chapter_bundle')
  assert.equal(target.targetId, 'chapter-1')
  assert.deepEqual(target.fieldKeys, ['protagonistGoal', 'resistance', 'scenePlan'])
  assert.match(target.fieldLabel, /第 1 章《第一次直播》/)

  const candidate = normalizePlanningChapterBundleCandidate({
    structuredOutput: { fields: {
      protagonistGoal: '拿到摊主的正式委托',
      resistance: '设备故障与围观质疑同时出现',
      scenePlan: '场景一争取开工；场景二排除故障；场景三公开验收。',
    } },
  }, target)
  assert.equal(candidate.chapterId, 'chapter-1')
  assert.deepEqual(candidate.fields.map((field) => field.key), ['protagonistGoal', 'resistance', 'scenePlan'])
})

test('planning document bundle targets only blank fields on the selected page', () => {
  const target = buildPlanningDocumentBundleTarget({
    kind: 'world',
    content: {
      era: '近现代平行世界', geography: '', society: '', powerSystem: '',
      hardRules: '技能不能代替现实资源', costs: '', dailyLife: '', history: '',
    },
  }, { fieldKeys: ['era', 'geography', 'society', 'hardRules', 'costs'] })

  assert.equal(target.kind, 'planning_document_bundle')
  assert.equal(target.targetId, 'world')
  assert.equal(target.promptProfile, 'world_rule')
  assert.deepEqual(target.fieldKeys, ['geography', 'society', 'costs'])
  assert.equal(target.fields.some((field) => field.key === 'era'), false)
})

test('planning document bundle schema and candidate enforce one exact page result', () => {
  const target = buildPlanningDocumentBundleTarget({
    kind: 'outline',
    content: { logline: '', opening: '主角处于事业低谷', incitingIncident: '', firstTurn: '', midpoint: '', crisis: '', climax: '', ending: '', thematicArc: '' },
  }, { fieldKeys: ['logline', 'opening', 'incitingIncident'] })
  const schema = planningBundleSchema(target)
  assert.deepEqual(schema.properties.fields.required, ['logline', 'incitingIncident'])

  const candidate = normalizePlanningDocumentBundleCandidate({
    structuredOutput: { fields: { logline: '失意艺人靠真实交付夺回选择权', incitingIncident: '一次职业直播任务进入生活' } },
  }, target)
  assert.equal(candidate.documentKind, 'outline')
  assert.deepEqual(candidate.fields.map((field) => field.key), ['logline', 'incitingIncident'])
  assert.throws(() => normalizePlanningDocumentBundleCandidate({
    structuredOutput: { fields: { logline: '一句话' } },
  }, target), /缺少字段：诱发事件/)
})

test('planning entity bundle targets only blank fields and generic card titles', () => {
  const target = buildPlanningEntityBundleTarget({
    id: 'character-1',
    kind: 'character',
    title: '人物 2',
    data: {
      role: '主角',
      identity: '',
      desire: '取得公开成功',
      need: '', fear: '', flaw: '', secret: '', arc: '', voice: '', relationships: '',
    },
  }, { fieldKeys: ['title', 'role', 'identity', 'desire', 'need'] })

  assert.equal(target.kind, 'planning_entity_bundle')
  assert.equal(target.promptProfile, 'character_card')
  assert.deepEqual(target.fieldKeys, ['title', 'identity', 'need'])
  assert.equal(target.fields.find((field) => field.key === 'title').originalValue, '人物 2')
  assert.equal(target.fields.some((field) => field.key === 'role'), false)
  assert.equal(target.fields.some((field) => field.key === 'desire'), false)
})

test('planning entity bundle schema and candidate enforce the exact requested field set', () => {
  const target = buildPlanningEntityBundleTarget({
    id: 'character-1', kind: 'character', title: '林砚',
    data: { role: '主角', identity: '', desire: '', need: '接受合作', fear: '失去证人', flaw: '独断', secret: '隐瞒旧案', arc: '学会协作', voice: '短句', relationships: '与医生互相试探' },
  }, { fieldKeys: ['identity', 'desire'] })
  const schema = planningEntityBundleSchema(target)
  assert.deepEqual(schema.properties.fields.required, ['identity', 'desire'])
  assert.equal(schema.properties.fields.additionalProperties, false)

  const candidate = normalizePlanningEntityBundleCandidate({
    structuredOutput: { fields: { identity: '带伤返城的调查者', desire: '查清病历被谁修改' } },
  }, target)
  assert.equal(candidate.entityId, 'character-1')
  assert.deepEqual(candidate.fields.map((field) => field.key), ['identity', 'desire'])
  assert.equal(candidate.fields[0].candidateValue, '带伤返城的调查者')

  assert.throws(() => normalizePlanningEntityBundleCandidate({
    text: JSON.stringify({ fields: { identity: '调查者' } }),
  }, target), /缺少字段：外在欲望/)
  assert.throws(() => normalizePlanningEntityBundleCandidate({
    text: JSON.stringify({ fields: { identity: '调查者', desire: '查案', apiKey: 'unexpected' } }),
  }, target), /未请求字段/)
})

test('a fully completed card reports that no batch generation is needed', () => {
  assert.throws(() => buildPlanningEntityBundleTarget({
    id: 'character-1', kind: 'character', title: '林砚',
    data: {
      role: '主角', identity: '调查者', desire: '查案', need: '合作', fear: '失去证人',
      flaw: '独断', secret: '旧案', arc: '学会协作', voice: '短句', relationships: '互相试探',
    },
  }), /没有需要补全/)
})
