import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createKnowledgeRepository } from '../electron/knowledge-repository.js'

function testRepository() {
  const database = new DatabaseSync(':memory:')
  let clock = 0
  let sequence = 0
  const now = () => `2026-08-20T13:00:${String(clock++).padStart(2, '0')}.000Z`
  runMigrations(database, { now })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('project-1', '连续性测试小说', '幻想悬疑', '一个会改写现实的旧稿', '克制、具体', now(), now())
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run('chapter-1', 'project-1', 1, '第一章', JSON.stringify({ goal: '确认旧稿的第一条规则' }), '', '', now())
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run('chapter-2', 'project-1', 2, '第二章', JSON.stringify({ goal: '让代价落到主角身上', ending: '主角决定继续追查' }), '', '', now())
  const repository = createKnowledgeRepository(database, {
    now,
    createId: (prefix) => `${prefix}-${++sequence}`,
  })
  return { database, repository }
}

test('knowledge center syncs confirmed planning and chapter sources', () => {
  const { database, repository } = testRepository()
  const center = repository.loadKnowledgeCenter('project-1')
  assert.ok(center.facts.some((item) => item.title === '故事前提'))
  assert.equal(center.timeline.length, 2)
  assert.ok(center.checks.some((check) => check.kind === 'missing-scene-plan'))

  const fact = repository.createItem({
    projectId: 'project-1',
    kind: 'fact',
    title: '旧稿规则',
    content: { key: 'old-draft-rule', value: '只能由原作者修改' },
  })
  const reopened = repository.loadKnowledgeCenter('project-1')
  assert.ok(reopened.facts.some((item) => item.id === fact.id))
  database.close()
})

test('manual edits are preserved when planning sources sync again', () => {
  const { database, repository } = testRepository()
  const initial = repository.loadKnowledgeCenter('project-1')
  const premise = initial.facts.find((item) => item.title === '故事前提')
  const edited = repository.updateItem({
    id: premise.id,
    title: '手工修订的故事前提',
    content: { statement: '用户补充了一个必须保留的因果条件' },
  })
  assert.equal(edited.sourceType, 'manual')
  const reopened = repository.loadKnowledgeCenter('project-1')
  assert.ok(reopened.facts.some((item) => item.id === premise.id && item.title === '手工修订的故事前提'))
  database.close()
})

test('foreshadow checks and fact conflicts can be resolved', () => {
  const { database, repository } = testRepository()
  repository.createItem({
    projectId: 'project-1',
    kind: 'foreshadow',
    title: '车站钥匙',
    content: { seed: '主角拿到一把没有来源的钥匙', dueChapterNo: 1 },
  })
  repository.createItem({ projectId: 'project-1', kind: 'fact', title: '规则 A', content: { key: 'door', value: '只能夜间打开' } })
  repository.createItem({ projectId: 'project-1', kind: 'fact', title: '规则 B', content: { key: 'door', value: '只能白天打开' } })
  const center = repository.loadKnowledgeCenter('project-1')
  const overdue = center.checks.find((check) => check.kind === 'overdue-foreshadow')
  const conflict = center.checks.find((check) => check.kind === 'conflicting-fact')
  assert.ok(overdue)
  assert.ok(conflict)
  repository.resolveCheck({ id: overdue.id, status: 'resolved' })
  assert.equal(repository.loadKnowledgeCenter('project-1').checks.find((check) => check.id === overdue.id).status, 'resolved')
  const reopened = repository.resolveCheck({ id: overdue.id, status: 'open' })
  assert.equal(reopened.status, 'open')
  const refreshed = repository.loadKnowledgeCenter('project-1')
  assert.equal(refreshed.checks.filter((check) => check.kind === 'overdue-foreshadow').length, 1)
  assert.equal(refreshed.checks.find((check) => check.id === overdue.id).status, 'open')
  database.close()
})

test('project deletion cascades knowledge and continuity data', () => {
  const { database, repository } = testRepository()
  repository.createItem({ projectId: 'project-1', kind: 'timeline', title: '事件', content: { event: '发生' } })
  repository.loadKnowledgeCenter('project-1')
  database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM knowledge_items').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM continuity_checks').get().count, 0)
  database.close()
})

test('AI state and audit outputs stay pending until the author accepts them', () => {
  const { database, repository } = testRepository()
  const state = repository.createCandidate({
    projectId: 'project-1',
    chapterId: 'chapter-1',
    task: 'chapter_state_extract',
    payload: {
      summary: '主角确认旧稿规则，并决定继续追查。',
      facts: [{ subject: '主角', predicate: '知道', object: '旧稿只能由原作者修改', certainty: 'confirmed', evidence: '他终于确认了规则。' }],
      characterStates: [{ character: '主角', location: '工作室', physical: '', emotional: '警觉', possessions: ['旧稿'], knows: ['旧稿规则'] }],
      relationshipChanges: [], timelineEvents: ['当夜确认规则'],
      foreshadow: { setups: ['旧稿页码异常'], payoffs: [] },
      openThreads: ['原作者身份'],
    },
    model: { provider: 'local' },
  })
  assert.equal(state.status, 'pending')
  assert.equal(repository.loadKnowledgeCenter('project-1').stateSnapshots.length, 0)
  let center = repository.resolveCandidate({ id: state.id, status: 'accepted' })
  assert.equal(center.stateSnapshots.length, 1)
  assert.equal(center.stateSnapshots[0].payload.openThreads[0], '原作者身份')

  const audit = repository.createCandidate({
    projectId: 'project-1',
    chapterId: 'chapter-2',
    task: 'continuity_audit',
    payload: {
      issues: [{ severity: 'critical', category: '人物知情', claimA: '第一章主角没有见过钥匙', claimB: '第二章主角认出钥匙主人', location: '第二章中段', minimalFix: '补一处获得信息的动作' }],
      uncertain: ['钥匙是否有照片证据'],
    },
  })
  center = repository.loadKnowledgeCenter('project-1')
  assert.equal(center.checks.filter((check) => check.origin === 'ai').length, 0)
  center = repository.resolveCandidate({ id: audit.id, status: 'accepted' })
  const aiCheck = center.checks.find((check) => check.origin === 'ai')
  assert.ok(aiCheck)
  assert.equal(aiCheck.kind, 'ai-continuity')
  assert.match(aiCheck.detail, /证据 A/)
  assert.match(aiCheck.detail, /最小修改/)
  assert.equal(center.counts.pendingCandidates, 0)
  database.close()
})
