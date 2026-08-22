import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelGateway } from '../electron/model-gateway.js'

test('model gateway exposes prepared parameters to the main process without returning them to renderer results', async () => {
  const gateway = createModelGateway({ getGoRuntime: () => ({ status: 'stopped', baseUrl: '', authToken: '' }) })
  let preparedParameters
  const result = await gateway.generate({
    task: 'chapter',
    project: { title: '参数边界测试', genre: '都市', idea: '一次选择', style: '克制' },
    chapter: { chapter_no: 1, title: '第一章', card: {}, scene_plan: '' },
    modelProfile: { id: 'local-default', provider: 'local', name: '本地模型', baseUrl: '', model: '' },
    mockDelayMs: 0,
  }, {
    taskId: 'prepared-parameters-test',
    onPrepared: (prepared) => { preparedParameters = prepared.parameters },
  })
  assert.equal(preparedParameters.temperature, 0.78)
  assert.equal(Object.hasOwn(result, 'requestParameters'), false)
  assert.ok(result.manuscript)
})
