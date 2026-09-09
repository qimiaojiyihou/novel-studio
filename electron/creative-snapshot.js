import { creativeDigest, CreativeInterfaceError } from './creative-interface.js'

const parse = value => JSON.parse(value || '{}')
export function readCreativeSnapshot(db, projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id=? AND project_type='user' AND archived_at=''").get(projectId)
  if (!project) throw new CreativeInterfaceError('PROJECT_UNAVAILABLE', '绑定项目不存在或已归档')
  const rows = table => db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`).all(projectId)
  const chapters = rows('chapters').sort((a,b) => a.chapter_no-b.chapter_no).map(row => ({ ...row, card:parse(row.card_json), scenePlan:parse(row.scene_plan_json) }))
  const planning = { documents:rows('planning_documents'), entities:rows('planning_entities'), relationships:rows('character_relationships'), arcs:rows('story_arcs'),
    beats:db.prepare('SELECT b.* FROM story_arc_beats b JOIN story_arcs a ON a.id=b.arc_id WHERE a.project_id=? ORDER BY b.rowid').all(projectId) }
  const knowledge = rows('knowledge_items'), memories = rows('chapter_memories'), styleSamples = rows('author_style_samples')
  const styles = rows('style_profiles'), protections = rows('manuscript_protections')
  // Remove bookkeeping stamps: opening a UI center may sync derived records, but
  // it must not invalidate unchanged author text. New formal facts still invalidate.
  const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['updated_at','created_at','source_updated_at','active','last_used_at'].includes(key)).map(([key,item]) => [key,clean(item)])) : value
  const structuredStyles = styles.filter(row => Object.keys(parse(row.style_json)).length)
    .map(row => ({ scopeType:row.scope_type, scopeId:row.scope_id, style:parse(row.style_json) }))
  const sourceDigest = creativeDigest(clean({ project, chapters, planning, styles:structuredStyles, styleSamples, protections,
    knowledge:knowledge.filter(row => ['manual','ai'].includes(row.source_type)), memories:memories.filter(row => row.confirmed) }))
  const finalizations = rows('chapter_finalizations').map(row => ({ id:row.id, chapterId:row.chapter_id, status:row.status, sourceDigest:row.source_digest, reviewer:parse(row.reviewer_json), error:row.error,
    completedAt:row.completed_at, authorAmendment:parse(row.checks_json).authorAmendment || null, manualFinalization:parse(row.checks_json).manualFinalization || null }))
  const runs = db.prepare(`SELECT id,project_id AS projectId,chapter_id AS chapterId,status,workflow_id AS workflowId,
    actual_backend AS actualBackend,model_routes_json,updated_at AS updatedAt,error FROM agent_runs WHERE project_id=? ORDER BY rowid DESC LIMIT 100`).all(projectId)
    .map(({ model_routes_json, ...row }) => ({ ...row, modelRoutes:parse(model_routes_json) }))
  const candidates = db.prepare('SELECT id,run_id AS runId,chapter_id AS chapterId,artifact_type AS artifactType,status,source_digest AS sourceDigest FROM agent_candidates WHERE project_id=? ORDER BY rowid DESC LIMIT 100').all(projectId)
  return { project, sourceDigest, chapters, planning, knowledge, memories, styles, styleSamples, protections, finalizations, runs, candidates }
}
