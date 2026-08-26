const STRUCTURED_TASKS = new Set([
  'chapter_card',
  'scene_plan',
  'chapter_state_extract',
  'continuity_audit',
  'quality_review',
])

export function isStructuredOutputError(error) {
  return error?.name === 'StructuredOutputError'
}

export function structuredRetryPayload(payload = {}, attempt = 2, failureReason = '') {
  const correction = [
    `这是结构化输出的第 ${attempt} 次尝试。`,
    failureReason ? `上一次失败原因：${failureReason}` : '',
    '上一次输出不是完整有效的结构化结果。请根据相同上下文重新生成完整结果，不引用或续写上一次的损坏内容。',
    '输出必须从 { 开始、以 } 结束，所有对象和数组闭合，字符串正确转义；不使用 Markdown 代码围栏，不添加解释，不省略或截断。',
  ].join('\n')
  return {
    ...payload,
    instruction: [payload.instruction, correction].filter(Boolean).join('\n'),
    structuredRetry: { attempt, deterministic: true },
  }
}

export async function runWithStructuredOutputRetry({
  task,
  payload = {},
  maxRetries = 1,
  runAttempt,
  onRetry = () => {},
}) {
  let retryCount = 0
  let retryOfId = ''
  let failureReason = ''
  while (true) {
    const attempt = retryCount + 1
    const attemptPayload = attempt === 1 ? payload : structuredRetryPayload(payload, attempt, failureReason)
    try {
      const result = await runAttempt({ attempt, payload: attemptPayload, retryOfId })
      return { result, retryCount, retryOfId }
    } catch (error) {
      const canRetry = STRUCTURED_TASKS.has(task)
        && isStructuredOutputError(error)
        && retryCount < maxRetries
      if (!canRetry) throw error
      retryCount += 1
      retryOfId = String(error.generationRecordId || '')
      failureReason = String(error.message || '')
      await onRetry({ error, retryCount, retryOfId, nextAttempt: retryCount + 1 })
    }
  }
}
