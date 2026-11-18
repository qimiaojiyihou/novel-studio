// Offsets use JavaScript UTF-16 positions so a selected range round-trips exactly.
export function indexReferenceChapters(text) {
  const heading = /^[ \t　]*(?:#{1,6}[ \t]+([^\n]{1,120})|(第[ \t]*[零〇一二三四五六七八九十百千万两\d]+[ \t]*[章节回卷部集][^\n]{0,120}|chapter[ \t]+\d+[^\n]{0,120}))[ \t]*$/gim
  const chapters = []
  for (const match of text.matchAll(heading)) {
    if (chapters.length) chapters.at(-1).end = match.index
    else if (match.index > 0 && text.slice(0, match.index).trim()) chapters.push({ title: '开篇内容', start: 0, end: match.index })
    chapters.push({ title: (match[1] || match[2]).trim(), start: match.index, end: text.length })
  }
  return chapters.length ? chapters : [{ title: '全文（按段查看）', start: 0, end: text.length }]
}
