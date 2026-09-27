export const CHAPTER_PAGE_SIZE = 25

export function chapterPageIndexFor(chapters, chapterId, pageSize = CHAPTER_PAGE_SIZE) {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  return index < 0 ? 0 : Math.floor(index / pageSize)
}

export function chapterPages(chapters, pageSize = CHAPTER_PAGE_SIZE) {
  const pages = []
  for (let start = 0; start < chapters.length; start += pageSize) {
    const group = chapters.slice(start, start + pageSize)
    pages.push({
      index: pages.length,
      label: `${group[0].chapter_no}–${group[group.length - 1].chapter_no} 章`,
      chapters: group,
    })
  }
  return pages
}
