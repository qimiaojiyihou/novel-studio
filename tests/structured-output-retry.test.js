import assert from 'node:assert/strict'
import test from 'node:test'
import { StructuredOutputError } from '../electron/model-adapter.js'
import { runWithStructuredOutputRetry } from '../electron/structured-output-retry.js'

test('structured benchmark task retries only the failed generation and records retry lineage', async () => {
  const attempts = []
  const retryEvents = []
  const execution = await runWithStructuredOutputRetry({
    task: 'chapter_state_extract',
    payload: { instruction: '保留已确认事实' },
    runAttempt: async (attempt) => {
      attempts.push(attempt)
      if (attempt.attempt === 1) {
        const error = new StructuredOutputError('章后状态', '{"summary":')
        error.generationRecordId = 'generation-failed-json'
        throw error
      }
      return { generationRecordId: 'generation-valid-json', stateSnapshot: { facts: [] } }
    },
    onRetry: (event) => retryEvents.push(event),
  })

  assert.equal(attempts.length, 2)
  assert.equal(attempts[0].retryOfId, '')
  assert.equal(attempts[1].retryOfId, 'generation-failed-json')
  assert.match(attempts[1].payload.instruction, /保留已确认事实/)
  assert.match(attempts[1].payload.instruction, /上一次失败原因/)
  assert.match(attempts[1].payload.instruction, /上一次输出不是完整有效的结构化结果/)
  assert.match(attempts[1].payload.instruction, /不引用或续写上一次的损坏内容/)
  assert.deepEqual(attempts[1].payload.structuredRetry, { attempt: 2, deterministic: true })
  assert.equal(retryEvents.length, 1)
  assert.equal(execution.retryCount, 1)
  assert.equal(execution.retryOfId, 'generation-failed-json')
  assert.equal(execution.result.generationRecordId, 'generation-valid-json')
})

test('plain text tasks and non-parse failures are never retried', async () => {
  for (const [task, error] of [
    ['chapter', new StructuredOutputError('正文', '{')],
    ['chapter_state_extract', new Error('模型配置错误')],
  ]) {
    let attempts = 0
    await assert.rejects(
      runWithStructuredOutputRetry({
        task,
        runAttempt: async () => {
          attempts += 1
          throw error
        },
      }),
      error,
    )
    assert.equal(attempts, 1)
  }
})

test('structured parse retry honors an explicit two-retry benchmark budget', async () => {
  let attempts = 0
  await assert.rejects(
    runWithStructuredOutputRetry({
      task: 'quality_review',
      maxRetries: 2,
      runAttempt: async () => {
        attempts += 1
        const error = new StructuredOutputError('质量评审', '{')
        error.generationRecordId = `generation-${attempts}`
        throw error
      },
    }),
    StructuredOutputError,
  )
  assert.equal(attempts, 3)
})
