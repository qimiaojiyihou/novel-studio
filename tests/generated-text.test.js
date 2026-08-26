import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPlanningFieldText } from '../electron/generated-text.js'

test('planning candidates remove workflow preambles and exact field labels', () => {
  const output = '我将按 Novel Studio 长篇规划规范校准“目标读者”候选，保持只读，不修改真实项目。目标读者：18—35岁男性向网文读者，喜欢都市文娱和职业体验题材。'
  assert.equal(cleanPlanningFieldText(output, { fieldLabel: '目标读者' }), '18—35岁男性向网文读者，喜欢都市文娱和职业体验题材。')
})

test('planning candidates remove ACP transport warnings before workflow preambles', () => {
  const output = [
    'Warning: Falling back from WebSockets to HTTPS transport, stream disconnected before completion: tls handshake eof',
    '',
    '我将使用文娱网文创作技能校准这条核心冲突的长篇承载力，并严格只在受控镜像内处理候选。核心冲突：周砚必须在抓住翻红机会与兑现现实承诺之间持续作出选择。',
  ].join('\n')

  assert.equal(
    cleanPlanningFieldText(output, { fieldLabel: '核心冲突' }),
    '周砚必须在抓住翻红机会与兑现现实承诺之间持续作出选择。',
  )
})

test('planning cleanup preserves genuine first-person creative content', () => {
  const output = '我会成为这个行业最懂普通人的导演，先从一档无人看好的节目做起。'
  assert.equal(cleanPlanningFieldText(output, { fieldLabel: '人物欲望' }), output)
})
