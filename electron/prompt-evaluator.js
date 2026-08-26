function cleanScore(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(2, number)) : 0
}

export function validatePromptEvalSuite(value) {
  if (!value || Number(value.schemaVersion) !== 1 || !Array.isArray(value.cases)) throw new Error('提示词评测集格式无效')
  const ids = value.cases.map((item) => String(item?.id || '').trim())
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('提示词评测案例 ID 缺失或重复')
  for (const item of value.cases) {
    if (!Array.isArray(item.assertions) || !item.assertions.length) throw new Error(`评测案例 ${item.id} 没有断言`)
    const assertionIds = item.assertions.map((assertion) => String(assertion?.id || '').trim())
    if (assertionIds.some((id) => !id) || new Set(assertionIds).size !== assertionIds.length) throw new Error(`评测案例 ${item.id} 的断言 ID 缺失或重复`)
  }
  return value
}

function hasAssertionEvidence(value) {
  if (typeof value === 'string') return Boolean(value.trim())
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Boolean(String(value.candidateEvidence || value.evidence || '').trim() && String(value.reasoning || value.reason || '').trim())
}

export function scorePromptEvalCase(caseDefinition, assertionScores = {}, {
  execution = 'remote',
  assertionEvidence = {},
  requireEvidence = false,
  scoreOverrides = {},
  blockingIssues = [],
} = {}) {
  const assertions = (caseDefinition?.assertions || []).map((assertion) => ({
    id: assertion.id,
    critical: Boolean(assertion.critical),
    criterion: String(assertion.criterion || ''),
    evidence: assertionEvidence?.[assertion.id] || null,
    score: Math.min(
      cleanScore(assertionScores?.[assertion.id]),
      Object.hasOwn(scoreOverrides || {}, assertion.id) ? cleanScore(scoreOverrides[assertion.id]) : 2,
      requireEvidence && !hasAssertionEvidence(assertionEvidence?.[assertion.id]) ? 0 : 2,
    ),
  }))
  const average = assertions.length
    ? assertions.reduce((total, assertion) => total + assertion.score, 0) / assertions.length
    : 0
  const criticalPassed = assertions.filter((assertion) => assertion.critical).every((assertion) => assertion.score === 2)
  const unresolvedHigh = (Array.isArray(blockingIssues) ? blockingIssues : [])
    .some((issue) => issue?.severity === 'high' && !issue?.resolved)
  const passed = execution === 'remote' && criticalPassed && average >= 1.6 && !unresolvedHigh
  return {
    caseId: String(caseDefinition?.id || ''),
    execution,
    assertions,
    average: Number(average.toFixed(2)),
    criticalPassed,
    unresolvedHigh,
    passed,
    verdict: execution === 'remote' ? (passed ? 'pass' : 'fail') : 'mock_only',
  }
}

export function aggregatePromptEvalResults(results = []) {
  const valid = Array.isArray(results) ? results : []
  const remote = valid.length > 0 && valid.every((result) => result.execution === 'remote')
  const average = valid.length ? valid.reduce((sum, result) => sum + Number(result.average || 0), 0) / valid.length : 0
  const passed = remote && valid.length > 0 && valid.every((result) => result.passed)
  return {
    caseCount: valid.length,
    execution: remote ? 'remote' : 'mock',
    average: Number(average.toFixed(2)),
    passed,
    verdict: remote ? (passed ? 'pass' : 'fail') : 'mock_only',
  }
}
