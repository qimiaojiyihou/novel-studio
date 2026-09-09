import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { aggregatePromptEvalResults, scorePromptEvalCase, validatePromptEvalSuite } from '../electron/prompt-evaluator.js'

const caseDefinition = {
  id: 'boundary', title: '边界', assertions: [
    { id: 'critical', critical: true, criterion: '停在边界' },
    { id: 'secondary', critical: false, criterion: '只有正文' },
  ],
}

test('prompt eval suite requires unique cases and assertions', () => {
  assert.equal(validatePromptEvalSuite({ schemaVersion: 1, cases: [caseDefinition] }).cases.length, 1)
  assert.throws(() => validatePromptEvalSuite({ schemaVersion: 1, cases: [{ ...caseDefinition, assertions: [] }] }), /没有断言/)
})

test('repository prompt eval suite includes fiction naturalness and sentence-group regressions', () => {
  const suite = validatePromptEvalSuite(JSON.parse(readFileSync(
    new URL('../research/prompt-eval-cases.json', import.meta.url),
    'utf8',
  )))
  assert.equal(suite.cases.length, 12)
  const naturalness = suite.cases.find((item) => item.id === 'eval-fiction-naturalness')
  assert.ok(naturalness)
  assert.deepEqual(
    naturalness.assertions.filter((item) => item.critical).map((item) => item.id),
    ['pov-selective-attention', 'no-card-transcription', 'meaning-once'],
  )
  const sentenceGroups = suite.cases.find((item) => item.id === 'eval-sentence-group-continuity')
  assert.ok(sentenceGroups)
  assert.deepEqual(
    sentenceGroups.assertions.filter((item) => item.critical).map((item) => item.id),
    ['action-object-complete', 'sentence-group-continuity', 'no-abstract-summary'],
  )
})

test('prompt eval release gate requires all critical scores and a 1.6 average', () => {
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }).passed, true)
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 1, secondary: 2 }).passed, false)
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }, { execution: 'mock' }).verdict, 'mock_only')
  assert.equal(aggregatePromptEvalResults([
    scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }),
    scorePromptEvalCase({ ...caseDefinition, id: 'second' }, { critical: 2, secondary: 2 }),
  ]).passed, true)
})

test('prompt eval can require evidence, apply deterministic overrides, and block high issues', () => {
  const evidence = {
    critical: { candidateEvidence: '正文停在门后第一声。', contraryEvidence: '未发现', reasoning: '结尾后只有一个反应。' },
    secondary: { candidateEvidence: '全文是正文。', contraryEvidence: '未发现', reasoning: '没有说明性标记。' },
  }
  const passed = scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }, {
    assertionEvidence: evidence,
    requireEvidence: true,
  })
  assert.equal(passed.passed, true)
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }, {
    assertionEvidence: evidence,
    requireEvidence: true,
    scoreOverrides: { critical: 0 },
  }).passed, false)
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }, {
    assertionEvidence: evidence,
    requireEvidence: true,
    blockingIssues: [{ severity: 'high', resolved: false }],
  }).unresolvedHigh, true)
  assert.equal(scorePromptEvalCase(caseDefinition, { critical: 2, secondary: 2 }, {
    assertionEvidence: { secondary: evidence.secondary },
    requireEvidence: true,
  }).assertions.find((item) => item.id === 'critical').score, 0)
})
