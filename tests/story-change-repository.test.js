import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createPlanningRepository } from '../electron/planning-repository.js'
import { createStoryChangeRepository } from '../electron/story-change-repository.js'

function fixture() {
  const database = new DatabaseSync(':memory:')
  let tick = 0
  let sequence = 0
  const now = () => `2026-08-26T09:00:${String(tick++).padStart(2, '0')}.000Z`
  const createId = (prefix) => `${prefix}-${++sequence}`
  runMigrations(database, { now })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES ('project-1', '午夜病历', '都市悬疑', '林砚追查被修改的医院病历', '克制、具体', ?, ?)
  `).run(now(), now())
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES ('chapter-1', 'project-1', 1, '第一章', 'draft', ?, '', ?, ?)
  `).run(
    JSON.stringify({ goal: '林砚找到午夜钥匙', endingHook: '午夜钥匙第一次失效' }),
    '林砚握着午夜钥匙进入地下室。午夜钥匙每天只能使用一次。',
    now(),
  )
  const planning = createPlanningRepository(database, { now, createId })
  planning.loadPlanningCenter('project-1')
  planning.saveDocument({
    projectId: 'project-1', kind: 'world',
    content: { hardRules: '午夜钥匙每天只能使用一次', costs: '第二次使用会永久锁门' },
  })
  planning.saveDocument({
    projectId: 'project-1', kind: 'outline',
    content: { climax: '林砚用午夜钥匙打开地下室', ending: '门后传出林砚自己的声音' },
  })
  const repository = createStoryChangeRepository(database, { now, createId })
  return { database, repository }
}

test('deterministic scan finds direct textual consumers and keeps manuscripts in review', () => {
  const { database, repository } = fixture()
  const changeSet = repository.createChangeSet({
    projectId: 'project-1',
    target: { kind: 'planning_document', targetId: 'world', fieldKey: 'hardRules' },
    proposedValue: '午夜钥匙每七天只能使用一次',
    instruction: '把钥匙冷却时间改成七天，并同步所有受影响内容。',
  })

  assert.equal(changeSet.status, 'draft')
  assert.equal(changeSet.items[0].impactLevel, 'required')
  assert.equal(changeSet.items[0].after, '午夜钥匙每七天只能使用一次')
  assert.ok(changeSet.items.some((item) => item.targetKey === 'chapter:chapter-1:manuscript' && item.impactLevel === 'review' && !item.selected))
  assert.ok(changeSet.items.some((item) => item.targetKey === 'planning_document:outline:climax'))
  assert.equal(repository.modelContext(changeSet.id).root.instruction, '把钥匙冷却时间改成七天，并同步所有受影响内容。')
  database.close()
})

test('a change set can explicitly exclude manuscripts from analysis and staleness checks', () => {
  const { database, repository } = fixture()
  const changeSet = repository.createChangeSet({
    projectId: 'project-1',
    target: { kind: 'planning_document', targetId: 'world', fieldKey: 'hardRules' },
    instruction: '只调整规划资料，不检查已写正文。',
    scope: { includeManuscript: false },
  })
  assert.equal(changeSet.items.some((item) => item.targetKind === 'manuscript'), false)
  assert.equal(repository.modelContext(changeSet.id).catalog.some((item) => item.manuscript), false)
  database.prepare("UPDATE chapters SET manuscript = '作者继续修改了正文' WHERE id = 'chapter-1'").run()
  assert.doesNotThrow(() => repository.modelContext(changeSet.id))
  assert.throws(() => repository.attachAnalysis({
    changeSetId: changeSet.id,
    analysis: {
      summary: '错误地返回正文。',
      items: [{ targetKey: 'chapter:chapter-1:manuscript', after: '不应接受', impactLevel: 'review' }],
    },
  }), /未知目标/)
  database.close()
})

test('analyzed changes apply atomically, preserve manuscript revision, and revert as one group', () => {
  const { database, repository } = fixture()
  const draft = repository.createChangeSet({
    projectId: 'project-1',
    target: { kind: 'planning_document', targetId: 'world', fieldKey: 'hardRules' },
    instruction: '改成每七天使用一次。',
  })
  const analyzed = repository.attachAnalysis({
    changeSetId: draft.id,
    analysis: {
      summary: '钥匙冷却规则从一天变为七天，需同步大纲、章节卡与正文。',
      items: [
        {
          targetKey: 'planning_document:world:hardRules',
          after: '午夜钥匙每七天只能使用一次',
          impactLevel: 'required',
          reason: '根规则修改。',
        },
        {
          targetKey: 'planning_document:outline:climax',
          after: '林砚等待七天冷却结束后，用午夜钥匙打开地下室',
          impactLevel: 'suggested',
          reason: '高潮使用钥匙，必须满足新冷却规则。',
        },
        {
          targetKey: 'chapter:chapter-1:manuscript',
          after: '林砚握着午夜钥匙进入地下室。午夜钥匙每七天只能使用一次。',
          impactLevel: 'review',
          reason: '正文写明了旧规则。',
          selected: true,
        },
      ],
    },
  })
  assert.equal(analyzed.status, 'waiting_confirmation')
  assert.equal(analyzed.counts.total, 3)

  const applied = repository.applyChangeSet({ changeSetId: draft.id })
  assert.equal(applied.status, 'applied')
  assert.equal(JSON.parse(database.prepare("SELECT content_json FROM planning_documents WHERE project_id = 'project-1' AND kind = 'world'").get().content_json).hardRules, '午夜钥匙每七天只能使用一次')
  assert.match(database.prepare("SELECT manuscript FROM chapters WHERE id = 'chapter-1'").get().manuscript, /每七天/)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM revisions WHERE chapter_id = 'chapter-1' AND source LIKE 'before-story-change:%'").get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_snapshots WHERE change_set_id = ?').get(draft.id).count, 3)

  const reverted = repository.revertChangeSet(draft.id)
  assert.equal(reverted.status, 'reverted')
  assert.equal(JSON.parse(database.prepare("SELECT content_json FROM planning_documents WHERE project_id = 'project-1' AND kind = 'world'").get().content_json).hardRules, '午夜钥匙每天只能使用一次')
  assert.match(database.prepare("SELECT manuscript FROM chapters WHERE id = 'chapter-1'").get().manuscript, /每天只能使用一次/)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM revisions WHERE chapter_id = 'chapter-1'").get().count, 2)
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()
})

test('source changes mark a pending change set stale instead of overwriting newer work', () => {
  const { database, repository } = fixture()
  const draft = repository.createChangeSet({
    projectId: 'project-1',
    target: { kind: 'planning_document', targetId: 'world', fieldKey: 'hardRules' },
    proposedValue: '午夜钥匙每七天只能使用一次',
  })
  repository.attachAnalysis({
    changeSetId: draft.id,
    analysis: { items: [{ targetKey: 'planning_document:world:hardRules', after: '午夜钥匙每七天只能使用一次' }] },
  })
  const row = database.prepare("SELECT content_json FROM planning_documents WHERE project_id = 'project-1' AND kind = 'world'").get()
  const content = JSON.parse(row.content_json)
  content.hardRules = '用户刚刚改成每三天一次'
  database.prepare("UPDATE planning_documents SET content_json = ? WHERE project_id = 'project-1' AND kind = 'world'").run(JSON.stringify(content))

  assert.throws(() => repository.applyChangeSet({ changeSetId: draft.id }), /已被修改/)
  assert.equal(repository.getChangeSet(draft.id).status, 'stale')
  assert.equal(JSON.parse(database.prepare("SELECT content_json FROM planning_documents WHERE project_id = 'project-1' AND kind = 'world'").get().content_json).hardRules, '用户刚刚改成每三天一次')
  database.close()
})

test('deleting a project cascades change sets, items, and snapshots', () => {
  const { database, repository } = fixture()
  const draft = repository.createChangeSet({
    projectId: 'project-1',
    target: { kind: 'planning_document', targetId: 'world', fieldKey: 'hardRules' },
    proposedValue: '新规则',
  })
  database.prepare("DELETE FROM projects WHERE id = 'project-1'").run()
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_sets WHERE id = ?').get(draft.id).count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_items').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_change_snapshots').get().count, 0)
  database.close()
})
