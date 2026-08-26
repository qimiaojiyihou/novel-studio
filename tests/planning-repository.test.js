import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../electron/database-migrations.js'
import { createPlanningRepository } from '../electron/planning-repository.js'

function testRepository() {
  const database = new DatabaseSync(':memory:')
  let clock = 0
  let sequence = 0
  const now = () => `2026-08-20T12:00:${String(clock++).padStart(2, '0')}.000Z`
  runMigrations(database, { now })
  database.prepare(`
    INSERT INTO projects (id, title, genre, idea, style, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('project-1', '规划测试小说', '都市', '一个无法撤回的选择', '克制、具体', now(), now())
  database.prepare(`
    INSERT INTO chapters (id, project_id, chapter_no, title, status, card_json, scene_plan, manuscript, updated_at)
    VALUES (?, ?, 1, ?, 'draft', '{}', '', '', ?)
  `).run('chapter-1', 'project-1', '第一章', now())
  const repository = createPlanningRepository(database, {
    now,
    createId: (prefix) => `${prefix}-${++sequence}`,
  })
  return { database, repository }
}

test('planning center seeds project context and persists each document kind', () => {
  const { database, repository } = testRepository()
  const initial = repository.loadPlanningCenter('project-1')
  assert.equal(initial.documents.foundation.content.premise, '一个无法撤回的选择')
  assert.equal(initial.documents.foundation.content.tone, '克制、具体')
  assert.ok(initial.documents.world)
  assert.ok(initial.documents.outline)

  repository.saveDocument({
    projectId: 'project-1',
    kind: 'foundation',
    content: { ...initial.documents.foundation.content, coreConflict: '成功与承诺只能保住一个' },
  })
  const reopened = createPlanningRepository(database).loadPlanningCenter('project-1')
  assert.equal(reopened.documents.foundation.content.coreConflict, '成功与承诺只能保住一个')
  database.close()
})

test('foundation bundle is accepted atomically into documents and the main character card', () => {
  const { database, repository } = testRepository()
  const center = repository.applyFoundationBundle({
    projectId: 'project-1',
    foundation: { premise: '追查被修改的病历', storyPromise: '每章推进一层证据', coreConflict: '真相与身份安全冲突' },
    mainCharacter: { title: '林砚', role: '主角', identity: '调查者', desire: '找到修改者', need: '接受协作', fear: '失去证人' },
    world: { hardRules: '钥匙每天午夜只能使用一次', costs: '违规会永久锁门' },
    outline: { logline: '调查者追查病历', opening: '带伤返城', incitingIncident: '收到副本', climax: '打开地下室', ending: '听见自己的声音' },
  })
  assert.equal(center.documents.foundation.content.premise, '追查被修改的病历')
  assert.equal(center.documents.world.content.hardRules, '钥匙每天午夜只能使用一次')
  assert.equal(center.documents.outline.content.ending, '听见自己的声音')
  assert.equal(center.characters[0].title, '林砚')
  assert.equal(center.characters[0].data.role, '主角')
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()
})

test('foundation bundle rolls back every document and character when one write fails', () => {
  const { database, repository } = testRepository()
  database.exec(`
    CREATE TRIGGER reject_outline_bundle
    BEFORE UPDATE ON planning_documents
    WHEN NEW.kind = 'outline'
    BEGIN
      SELECT RAISE(ABORT, 'outline rejected');
    END
  `)

  assert.throws(() => repository.applyFoundationBundle({
    projectId: 'project-1',
    foundation: { premise: '不应留下的故事前提' },
    mainCharacter: { title: '不应留下的人物', role: '主角' },
    world: { hardRules: '不应留下的规则' },
    outline: { ending: '触发回滚' },
  }), /outline rejected/)

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_documents WHERE project_id = ?').get('project-1').count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_entities WHERE project_id = ?').get('project-1').count, 0)
  assert.equal(database.prepare('SELECT idea FROM projects WHERE id = ?').get('project-1').idea, '一个无法撤回的选择')
  database.close()
})

test('characters, world elements and volumes support create edit reorder and delete', () => {
  const { database, repository } = testRepository()
  const first = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '林默', data: { role: '主角' } })
  const second = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '周岚', data: { role: '对手' } })
  const updated = repository.updateEntity({ id: first.id, data: { desire: '重新回到台前' } })
  assert.equal(updated.data.role, '主角')
  assert.equal(updated.data.desire, '重新回到台前')

  const reordered = repository.reorderEntities({ projectId: 'project-1', kind: 'character', entityIds: [second.id, first.id] })
  assert.deepEqual(reordered.map((entity) => [entity.position, entity.title]), [[1, '周岚'], [2, '林默']])
  assert.throws(() => repository.reorderEntities({ projectId: 'project-1', kind: 'character', entityIds: [first.id] }), /排序列表/)

  const world = repository.createEntity({ projectId: 'project-1', kind: 'world', title: '旧车站', data: { category: '地点' } })
  const volume = repository.createEntity({ projectId: 'project-1', kind: 'volume', title: '第一卷', data: { goal: '拿到入场券' } })
  assert.equal(repository.loadPlanningCenter('project-1').worldElements[0].id, world.id)
  assert.equal(repository.loadPlanningCenter('project-1').volumes[0].id, volume.id)

  const remaining = repository.deleteEntity(second.id)
  assert.deepEqual(remaining.map((entity) => [entity.position, entity.id]), [[1, first.id]])

  database.prepare('UPDATE chapters SET card_json = ? WHERE id = ?').run(JSON.stringify({ volumeId: volume.id, chapterStyle: '增加对白' }), 'chapter-1')
  database.prepare(`
    INSERT INTO style_profiles VALUES ('style-volume', 'project-1', 'volume', ?, '第一卷文风', '{}', '压迫感', ?, ?)
  `).run(volume.id, '2026-08-20', '2026-08-20')
  database.prepare(`
    INSERT INTO prompt_bindings VALUES ('binding-volume', 'project-1', 'volume', ?, 'chapter', 'builtin-chapter-v1', 1, 1, ?, ?)
  `).run(volume.id, '2026-08-20', '2026-08-20')
  repository.deleteEntity(volume.id)
  assert.equal(JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json).volumeId, undefined)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM style_profiles WHERE scope_id = ?").get(volume.id).count, 0)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM prompt_bindings WHERE scope_id = ?").get(volume.id).count, 0)
  database.close()
})

test('relationship graph is editable and character deletion removes connected edges', () => {
  const { database, repository } = testRepository()
  const lin = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '林默', data: { role: '主角' } })
  const zhou = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '周岚', data: { role: '对手' } })
  const relationship = repository.createRelationship({
    projectId: 'project-1', fromCharacterId: lin.id, toCharacterId: zhou.id,
    label: '旧搭档', surface: '公开竞争', tension: '彼此掌握对方的旧失误', direction: 'mutual', trend: 'cooling',
  })
  assert.equal(relationship.fromCharacterName, '林默')
  assert.equal(relationship.toCharacterName, '周岚')
  assert.equal(repository.loadPlanningCenter('project-1').relationships.length, 1)
  assert.throws(() => repository.createRelationship({
    projectId: 'project-1', fromCharacterId: zhou.id, toCharacterId: lin.id, label: '重复关系',
  }), /已经存在关系/)

  const updated = repository.updateRelationship({ id: relationship.id, label: '竞争中的旧搭档', trend: 'hostile', status: 'changed' })
  assert.equal(updated.label, '竞争中的旧搭档')
  assert.equal(updated.trend, 'hostile')
  assert.equal(updated.status, 'changed')

  repository.deleteEntity(zhou.id)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM character_relationships').get().count, 0)
  database.close()
})

test('location view combines planned places with latest accepted character state', () => {
  const { database, repository } = testRepository()
  const lin = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '林默', data: { role: '主角' } })
  const station = repository.createEntity({
    projectId: 'project-1', kind: 'world', title: '旧车站',
    data: { category: '地点', summary: '城郊停用站房', rules: '末班车后封锁', connections: '通往北仓库' },
  })
  const timestamp = '2026-08-24T12:00:00.000Z'
  database.prepare(`
    INSERT INTO knowledge_candidates (id, project_id, chapter_id, task, payload_json, model_json, status, created_at, resolved_at)
    VALUES (?, ?, ?, 'chapter_state_extract', ?, '{}', 'accepted', ?, ?)
  `).run('state-location-1', 'project-1', 'chapter-1', JSON.stringify({
    summary: '', facts: [],
    characterStates: [
      { character: '林默', location: '旧车站', physical: '左手擦伤', emotional: '戒备' },
      { character: '周岚', location: '北仓库', physical: '', emotional: '平静' },
    ],
    relationshipChanges: [], timelineEvents: [], foreshadow: { setups: [], payoffs: [] }, openThreads: [],
  }), timestamp, timestamp)

  const locations = repository.loadPlanningCenter('project-1').locations
  const planned = locations.find((location) => location.id === station.id)
  assert.equal(planned.sourceType, 'planning')
  assert.equal(planned.occupants[0].characterId, lin.id)
  assert.equal(planned.occupants[0].physical, '左手擦伤')
  const observed = locations.find((location) => location.title === '北仓库')
  assert.equal(observed.sourceType, 'observed')
  assert.equal(observed.occupants[0].characterName, '周岚')
  database.close()
})

test('story arcs connect editable beats across volumes and chapters', () => {
  const { database, repository } = testRepository()
  const volumeOne = repository.createEntity({ projectId: 'project-1', kind: 'volume', title: '第一卷' })
  const volumeTwo = repository.createEntity({ projectId: 'project-1', kind: 'volume', title: '第二卷' })
  const world = repository.createEntity({ projectId: 'project-1', kind: 'world', title: '旧车站' })
  database.prepare('UPDATE chapters SET card_json = ? WHERE id = ?').run(JSON.stringify({ volumeId: volumeOne.id }), 'chapter-1')

  const arc = repository.createStoryArc({
    projectId: 'project-1', title: '失踪案真相', category: 'mystery', premise: '一封伪造的遗书',
    destination: '主角确认失踪者主动布局', colorKey: 'plum',
  })
  const opening = repository.createStoryArcBeat({
    arcId: arc.id, volumeId: volumeOne.id, chapterId: 'chapter-1', label: '遗书出现', changeText: '问题被公开提出。',
  })
  const reversal = repository.createStoryArcBeat({
    arcId: arc.id, volumeId: volumeTwo.id, label: '证词反转', changeText: '调查方向被迫改变。',
  })
  const loaded = repository.loadPlanningCenter('project-1').storyArcs[0]
  assert.equal(loaded.title, '失踪案真相')
  assert.equal(loaded.beats[0].chapterTitle, '第一章')
  assert.equal(loaded.beats[0].volumeTitle, '第一卷')
  assert.equal(loaded.beats[1].volumeTitle, '第二卷')

  assert.throws(() => repository.createStoryArcBeat({ arcId: arc.id, volumeId: world.id, label: '错误节点' }), /当前项目的分卷/)
  assert.throws(() => repository.createStoryArcBeat({ arcId: arc.id, volumeId: volumeTwo.id, chapterId: 'chapter-1', label: '错卷章节' }), /所属分卷/)

  const updatedArc = repository.updateStoryArc({ id: arc.id, status: 'active', destination: '真相改写所有人的利益关系' })
  assert.equal(updatedArc.status, 'active')
  const updatedBeat = repository.updateStoryArcBeat({ id: reversal.id, label: '第二份证词', changeText: '盟友成为嫌疑人。' })
  assert.equal(updatedBeat.label, '第二份证词')

  repository.deleteEntity(volumeOne.id)
  const detached = repository.loadPlanningCenter('project-1').storyArcs[0].beats.find((beat) => beat.id === opening.id)
  assert.equal(detached.volumeId, '')
  assert.equal(detached.chapterId, 'chapter-1')

  repository.deleteStoryArcBeat(reversal.id)
  assert.equal(repository.loadPlanningCenter('project-1').storyArcs[0].beats.length, 1)
  repository.deleteStoryArc(arc.id)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_arcs').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_arc_beats').get().count, 0)
  database.close()
})

test('field candidates are persistent, explicit and protected from stale overwrite', () => {
  const { database, repository } = testRepository()
  repository.loadPlanningCenter('project-1')
  const documentCandidate = repository.createCandidate({
    projectId: 'project-1',
    targetType: 'document',
    targetId: 'foundation',
    fieldKey: 'coreConflict',
    fieldLabel: '核心冲突',
    originalValue: '',
    candidateValue: '每次成功都会伤害旧承诺。',
    model: { name: 'MockProvider' },
  })
  assert.equal(repository.loadPlanningCenter('project-1').candidates.length, 1)
  repository.resolveCandidate({ candidateId: documentCandidate.id, decision: 'accepted' })
  assert.equal(repository.loadPlanningCenter('project-1').documents.foundation.content.coreConflict, '每次成功都会伤害旧承诺。')
  assert.equal(repository.loadPlanningCenter('project-1').candidates.length, 0)

  const character = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '林默', data: { desire: '' } })
  const stale = repository.createCandidate({
    projectId: 'project-1',
    targetType: 'entity',
    targetId: character.id,
    fieldKey: 'desire',
    originalValue: '',
    candidateValue: '赢得公开成功',
  })
  repository.updateEntity({ id: character.id, data: { desire: '保护自己的作品' } })
  assert.throws(
    () => repository.resolveCandidate({ candidateId: stale.id, decision: 'accepted' }),
    /当前字段已经修改/,
  )
  repository.resolveCandidate({ candidateId: stale.id, decision: 'discarded' })

  const chapterCandidate = repository.createCandidate({
    projectId: 'project-1',
    targetType: 'chapter',
    targetId: 'chapter-1',
    fieldKey: 'goal',
    originalValue: '',
    candidateValue: '让主角公开做出选择。',
  })
  repository.resolveCandidate({ candidateId: chapterCandidate.id, decision: 'accepted' })
  assert.equal(JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json).goal, '让主角公开做出选择。')

  const originalCard = JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json)
  const replacementCard = { goal: '赢得邀请', resistance: '旧承诺阻止他', requiredScenes: [{ id: 'scene-1', title: '后台对峙' }] }
  const cardCandidate = repository.createCandidate({
    projectId: 'project-1',
    targetType: 'chapter',
    targetId: 'chapter-1',
    fieldKey: 'card',
    fieldLabel: '章节卡',
    originalValue: JSON.stringify(originalCard),
    candidateValue: JSON.stringify(replacementCard),
  })
  repository.resolveCandidate({ candidateId: cardCandidate.id, decision: 'accepted' })
  assert.deepEqual(JSON.parse(database.prepare('SELECT card_json FROM chapters WHERE id = ?').get('chapter-1').card_json), replacementCard)

  const sceneCandidate = repository.createCandidate({
    projectId: 'project-1',
    targetType: 'chapter',
    targetId: 'chapter-1',
    fieldKey: 'scenePlan',
    fieldLabel: '场景计划',
    originalValue: '',
    candidateValue: '场景一：后台对峙。',
  })
  repository.resolveCandidate({ candidateId: sceneCandidate.id, decision: 'accepted' })
  assert.equal(database.prepare('SELECT scene_plan FROM chapters WHERE id = ?').get('chapter-1').scene_plan, '场景一：后台对峙。')
  database.close()
})

test('project deletion cascades through all planning records', () => {
  const { database, repository } = testRepository()
  repository.loadPlanningCenter('project-1')
  repository.createEntity({ projectId: 'project-1', kind: 'world', title: '规则' })
  const first = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '人物 A' })
  const second = repository.createEntity({ projectId: 'project-1', kind: 'character', title: '人物 B' })
  repository.createRelationship({ projectId: 'project-1', fromCharacterId: first.id, toCharacterId: second.id, label: '盟友' })
  const arc = repository.createStoryArc({ projectId: 'project-1', title: '主线' })
  repository.createStoryArcBeat({ arcId: arc.id, chapterId: 'chapter-1', label: '开端' })
  repository.createCandidate({
    projectId: 'project-1',
    targetType: 'document',
    targetId: 'foundation',
    fieldKey: 'premise',
    originalValue: '一个无法撤回的选择',
    candidateValue: '新的故事前提',
  })
  database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_documents').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_entities').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM planning_candidates').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM character_relationships').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_arcs').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM story_arc_beats').get().count, 0)
  database.close()
})
