export function sortShelfBooks(books, mode, readAt = () => 0) {
  const timestamp = value => {
    const parsed = typeof value === 'number' ? value : Date.parse(value || '')
    return Number.isFinite(parsed) ? parsed : 0
  }
  const addedAt = book => timestamp(book.added_at || book.updated_at)
  const activityAt = book => Math.max(timestamp(readAt(book)), addedAt(book))
  const time = mode === 'added' ? addedAt : mode === 'updated' ? book => timestamp(book.updated_at) : activityAt
  return [...books].sort((a, b) => {
    if (mode === 'title') return a.title.localeCompare(b.title, 'zh-CN')
    return time(b) - time(a) || addedAt(b) - addedAt(a) || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
  })
}
