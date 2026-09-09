import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chapterCardEditIssues,
  chapterCardPresentation,
  composeInlineManuscriptCandidate,
  creativeRoutePresentation,
  draftDigest,
  projectExecutionMode,
} from '../src/utils/inline-creative.js'

test('renderer draft digests are stable and project execution defaults safely', () => {
  assert.equal(draftDigest({ b: 2, a: 1 }), draftDigest({ a: 1, b: 2 }))
  assert.notEqual(draftDigest({ a: 1 }), draftDigest({ a: 2 }))
  assert.equal(projectExecutionMode({ default_execution_mode: 'codex' }), 'codex')
  assert.equal(projectExecutionMode({ default_execution_mode: 'other' }), 'app_model')
})

test('current route presentation follows the project default before task-model routing', () => {
  assert.deepEqual(creativeRoutePresentation({
    project: { default_execution_mode: 'codex' },
    taskModelName: '小米 MiMo',
    taskModelDetail: 'mimo · API Key 已配置',
  }), {
    mode: 'codex',
    name: 'Codex',
    detail: 'Agent · ACP 优先 · exec 回退',
    fallbackName: '小米 MiMo',
  })
  assert.deepEqual(creativeRoutePresentation({
    project: { default_execution_mode: 'app_model' },
    taskModelName: '小米 MiMo',
    taskModelDetail: 'mimo · API Key 已配置',
  }), {
    mode: 'app_model',
    name: '小米 MiMo',
    detail: 'mimo · API Key 已配置',
    fallbackName: '',
  })
})

test('inline manuscript preview composes continue and selection candidates exactly like acceptance', () => {
  assert.equal(composeInlineManuscriptCandidate({
    source: '甲乙丙丁', artifactType: 'manuscript', payload: { manuscript: '新增' },
    action: { intent: 'continue', target: { cursorOffset: 2 } },
  }), '甲乙新增丙丁')
  assert.equal(composeInlineManuscriptCandidate({
    source: '甲乙丙丁', artifactType: 'manuscript_selection', payload: { text: '替换' },
    action: { intent: 'rewrite', target: { selectionFrom: 1, selectionTo: 3 } },
  }), '甲替换丁')
  assert.equal(composeInlineManuscriptCandidate({
    source: '旧稿', artifactType: 'manuscript', payload: { manuscript: '完整新稿' },
    action: { intent: 'repair', target: {} },
  }), '完整新稿')
})

test('chapter card candidates are translated into author-facing fields without changing their payload', () => {
  const payload = {
    goal: '完成第一次公开交付',
    protagonistGoal: '在收摊前完成十份订单',
    resistance: '资金不足且摊主拒绝借用设备',
    turningPoint: '观众提出现场验收',
    payoff: '第一份订单当场成交',
    cost: '主角公开承诺失败退款',
    ending: '订单倒计时开始跳动',
    requiredScenes: [{ id: 'S1', title: '借摊', goal: '获得操作位置', result: '拿到一小时试营业时间' }],
  }
  const presented = chapterCardPresentation(payload)
  assert.equal(presented.fields[0].label, '本章合同')
  assert.equal(presented.fields[0].value, payload.goal)
  assert.deepEqual(presented.scenes[0], {
    id: 'S1', title: '借摊', goal: '获得操作位置', result: '拿到一小时试营业时间', missing: false,
  })
  assert.equal(presented.missingCount, 0)
  assert.deepEqual(presented.card, payload)
})

test('chapter card presentation supports wrapped JSON and reports incomplete historical data', () => {
  const presented = chapterCardPresentation(JSON.stringify({
    card: { goal: '找到证据', requiredScenes: [{ title: '后台', goal: '找到名单' }] },
  }))
  assert.equal(presented.fields.find((field) => field.key === 'goal').value, '找到证据')
  assert.equal(presented.scenes[0].id, 'S1')
  assert.equal(presented.scenes[0].missing, true)
  assert.ok(presented.missingCount > 0)
  assert.equal(chapterCardPresentation('这不是 JSON'), null)
})

test('chapter card editor reports only author-fixable contract issues', () => {
  const incomplete = {
    goal: '完成首场交付', protagonistGoal: '', resistance: '资金不足', ending: '订单倒计时开始',
    requiredScenes: [{ id: 'S1', title: '借摊', goal: '拿到摊位', result: '' }],
  }
  assert.deepEqual(chapterCardEditIssues(incomplete), [
    '主角目标尚未填写',
    '必要场景 1 需要填写任务和离场结果',
  ])
  incomplete.protagonistGoal = '拿到一小时试营业时间'
  incomplete.requiredScenes[0].result = '摊主同意按成交分成'
  assert.deepEqual(chapterCardEditIssues(incomplete), [])
})
