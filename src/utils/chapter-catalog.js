export function chapterSummary(chapter) {
  const { id, project_id, chapter_no, title, status, updated_at, finalized_version_id,
    finalization_correction, finalization_manual } = chapter
  return { id, project_id, chapter_no, title, status, updated_at, finalized_version_id,
    finalization_correction, finalization_manual,
    characterCount: chapter.characterCount ?? Array.from(chapter.manuscript || '').length, detailLoaded: false }
}

// Keep only a small working set of full manuscripts in renderer memory.
export function boundChapterDetails(chapters, recentIds, currentId, limit = 8) {
  const count = Math.max(1, limit)
  const otherIds = count > 1 ? recentIds.filter(id => id !== currentId).slice(-(count-1)) : []
  const keep = new Set([...otherIds, currentId])
  return chapters.map(chapter => keep.has(chapter.id) || chapter.detailLoaded === false ? chapter : chapterSummary(chapter))
}
