import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createZhuqueDetectionService, zhuqueRepairContext, ZHUQUE_ENDPOINT } from '../electron/zhuque-detection.js'

function fixture(fetchImpl, key = 'test-key') {
  const database = new DatabaseSync(':memory:')
  runMigrations(database)
  const time = '2026-09-25T00:00:00.000Z'
  const project = database.prepare('INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  project.run('book-a', '甲书', '测试', '', '', time, time)
  project.run('book-b', '乙书', '测试', '', '', time, time)
  const chapter = database.prepare(`INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, 1, ?, 'draft', '{}', '', ?, ?)`)
  chapter.run('chapter-a', 'book-a', '第一章', '甲书正文', time)
  chapter.run('chapter-b', 'book-b', '第一章', '乙书正文', time)
  return { database, service: createZhuqueDetectionService(database, { getApiKey: () => key, fetchImpl, now: () => time }) }
}

const success = {
  ok: true, status: 200,
  json: async () => ({ status: 'success', softmax_confidence: 0.82, ratio_confidence: 0.4,
    labels_ratio: { 0: 0.5, 1: 0.25, 2: 0.25 },
    segment_labels: [{ text: '正文', label: 1, conf: 0.82, order: 1 }],
    makers_models_usage: { total_tokens: 14 } }),
}

test('朱雀检测按章节调用接口并在正文修改后标记旧结果', async () => {
  const calls = []
  const { database, service } = fixture(async (url, options) => { calls.push({ url, options }); return success })
  try {
    const first = await service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    assert.equal(calls[0].url, ZHUQUE_ENDPOINT)
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key')
    assert.deepEqual(JSON.parse(calls[0].options.body), { text: '甲书正文', is_merge: false })
    assert.equal(first.stale, false)
    assert.match(first.manuscriptDigest, /^[a-f0-9]{64}$/)
    assert.deepEqual(service.requireFreshResult({ projectId: 'book-a', chapterId: 'chapter-a', expectedDigest: first.manuscriptDigest }), first)
    assert.match(zhuqueRepairContext(first).instruction, /检测标注片段/)
    assert.equal(zhuqueRepairContext(first).issues[0].evidence, '正文')
    assert.equal(first.segments[0].label, 1)
    assert.equal(first.billedTokens, 14)
    database.prepare('UPDATE chapters SET manuscript = ? WHERE id = ?').run('修改后的正文', 'chapter-a')
    assert.equal(service.getResult({ projectId: 'book-a', chapterId: 'chapter-a' }).stale, true)
    assert.throws(() => service.requireFreshResult({ projectId: 'book-a', chapterId: 'chapter-a', expectedDigest: first.manuscriptDigest }), /过期/)
    assert.equal(service.getResult({ projectId: 'book-b', chapterId: 'chapter-b' }), null)
  } finally { database.close() }
})

test('辅助改稿拒绝缺失和错误的检测来源摘要', async () => {
  const { database, service } = fixture(async () => success)
  try {
    assert.throws(() => service.requireFreshResult({ projectId: 'book-a', chapterId: 'chapter-a', expectedDigest: 'x' }), /尚无/)
    const result = await service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    assert.throws(() => service.requireFreshResult({ projectId: 'book-a', chapterId: 'chapter-a', expectedDigest: 'x' }), /已变化/)
    assert.throws(() => service.requireFreshResult({ projectId: 'book-b', chapterId: 'chapter-a', expectedDigest: result.manuscriptDigest }), /不属于此项目/)
  } finally { database.close() }
})

test('跨项目读取和提交被拒绝；重复点击共享同一次在途请求', async () => {
  let resolveFetch, callCount = 0
  const { database, service } = fixture(() => { callCount += 1; return new Promise(resolve => { resolveFetch = resolve }) })
  try {
    assert.throws(() => service.getResult({ projectId: 'book-b', chapterId: 'chapter-a' }), /不属于此项目/)
    await assert.rejects(service.detect({ projectId: 'book-b', chapterId: 'chapter-a' }), /不属于此项目/)
    const one = service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    const two = service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    assert.equal(callCount, 1)
    resolveFetch(success)
    assert.deepEqual(await one, await two)
  } finally { database.close() }
})

test('接口失败和缺失密钥不覆盖已保存的检测结果', async () => {
  let response = success
  const { database, service } = fixture(async () => response)
  try {
    await service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    response = { ok: false, status: 401, json: async () => ({ msg: '认证失败' }) }
    await assert.rejects(service.detect({ projectId: 'book-a', chapterId: 'chapter-a' }), /认证失败/)
    assert.equal(service.getResult({ projectId: 'book-a', chapterId: 'chapter-a' }).stale, false)
    const noKey = createZhuqueDetectionService(database, { getApiKey: () => '', fetchImpl: async () => success })
    await assert.rejects(noKey.detect({ projectId: 'book-b', chapterId: 'chapter-b' }), /API Key/)
  } finally { database.close() }
})

test('每章只保留最近一次成功检测，不保存历史记录', async () => {
  let ratio = 0.2
  const { database, service } = fixture(async () => ({
    ok: true, status: 200,
    json: async () => ({ status: 'success', ratio_confidence: ratio, segment_labels: [] }),
  }))
  try {
    await service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    ratio = 0.8
    const latest = await service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    assert.equal(latest.ratioConfidence, 0.8)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM zhuque_chapter_detections WHERE chapter_id = ?').get('chapter-a').count, 1)
    assert.equal(JSON.parse(database.prepare('SELECT result_json FROM zhuque_chapter_detections WHERE chapter_id = ?').get('chapter-a').result_json).ratioConfidence, 0.8)
  } finally { database.close() }
})

test('请求期间修改正文时结果保持过期，删除章节时结果随章节删除', async () => {
  let resolveFetch
  const { database, service } = fixture(() => new Promise(resolve => { resolveFetch = resolve }))
  try {
    const pending = service.detect({ projectId: 'book-a', chapterId: 'chapter-a' })
    database.prepare('UPDATE chapters SET manuscript = ? WHERE id = ?').run('新的正文', 'chapter-a')
    resolveFetch(success)
    assert.equal((await pending).stale, true)
    database.prepare('DELETE FROM chapters WHERE id = ?').run('chapter-a')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM zhuque_chapter_detections').get().count, 0)
  } finally { database.close() }
})
