import { inflateRawSync } from 'node:zlib'

const CHAPTER_HEADING = /^(第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节回卷部集](?:[：:\s·-].*)?|chapter\s+\d+(?:[：:\s·-].*)?)$/i

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decodeXml(value = '') {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function sanitizeXmlText(value = '') {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function normalizeChapters(chapters = []) {
  return chapters.map((chapter, index) => ({
    chapterNo: Number(chapter.chapter_no ?? chapter.chapterNo ?? index + 1),
    title: String(chapter.title || `第 ${index + 1} 章`).trim(),
    manuscript: String(chapter.manuscript || ''),
  })).sort((a, b) => a.chapterNo - b.chapterNo)
}

function chapterHeading(chapter) {
  return `第 ${chapter.chapterNo} 章 · ${chapter.title}`
}

function cleanChapterTitle(value = '') {
  return String(value)
    .trim()
    .replace(/^第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节回卷部集]\s*[：:\s·-]*/i, '')
    .replace(/^chapter\s+\d+\s*[：:\s·-]*/i, '')
    .trim()
}

function wordChapterHeading(chapter) {
  const title = cleanChapterTitle(chapter.title)
  return `第${chapter.chapterNo}章${title ? ` ${title}` : ''}`
}

function manuscriptParagraphs(value = '') {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\t \u3000]+/, '').replace(/[\t \u3000]+$/, ''))
    .filter(Boolean)
}

export function createTextManuscript(workspace) {
  const chapters = normalizeChapters(workspace.chapters)
  return [workspace.project.title, ...chapters.flatMap((chapter) => [chapterHeading(chapter), chapter.manuscript])]
    .join('\n\n').trimEnd() + '\n'
}

export function createMarkdownManuscript(workspace) {
  const chapters = normalizeChapters(workspace.chapters)
  const metadata = [workspace.project.genre, workspace.project.idea].filter(Boolean).join(' · ')
  return [
    `# ${workspace.project.title}`,
    metadata ? `> ${metadata}` : '',
    ...chapters.flatMap((chapter) => [`## ${chapterHeading(chapter)}`, chapter.manuscript]),
  ].filter((part, index) => part || index > 1).join('\n\n').trimEnd() + '\n'
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function createStoredZip(entries, date = new Date()) {
  const localParts = []
  const centralParts = []
  let offset = 0
  const stamp = dosDateTime(date)
  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function readZipEntry(buffer, requestedName) {
  let endOffset = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054B50) { endOffset = index; break }
  }
  if (endOffset < 0) throw new Error('Word 文件缺少 ZIP 目录')
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  let cursor = buffer.readUInt32LE(endOffset + 16)
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014B50) throw new Error('Word 文件目录损坏')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (name === requestedName) {
      if (uncompressedSize > 25 * 1024 * 1024) throw new Error('Word 文档正文超过 25 MB，请拆分后重试')
      if (buffer.readUInt32LE(localOffset) !== 0x04034B50) throw new Error('Word 文件内容索引损坏')
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = buffer.subarray(start, start + compressedSize)
      const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null
      if (!data) throw new Error(`Word 文件使用了暂不支持的压缩方式：${method}`)
      if (data.length !== uncompressedSize) throw new Error('Word 文件内容长度校验失败')
      return data
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`Word 文件缺少 ${requestedName}`)
}

function wordParagraph(text, style = 'Normal', { pageBreakBefore = false } = {}) {
  const breakXml = pageBreakBefore ? '<w:pageBreakBefore/>' : ''
  const runFont = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Songti SC" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:hint="eastAsia"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr>'
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${breakXml}</w:pPr><w:r>${runFont}<w:t xml:space="preserve">${escapeXml(sanitizeXmlText(text))}</w:t></w:r></w:p>`
}

function documentXml(workspace) {
  const paragraphs = [wordParagraph(workspace.project.title, 'Title')]
  normalizeChapters(workspace.chapters).forEach((chapter, index) => {
    paragraphs.push(wordParagraph(wordChapterHeading(chapter), 'Heading1', { pageBreakBefore: index > 0 }))
    for (const paragraph of manuscriptParagraphs(chapter.manuscript)) paragraphs.push(wordParagraph(paragraph))
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Songti SC" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:hint="eastAsia"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/><w:kinsoku/><w:overflowPunct/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="440" w:firstLineChars="200"/><w:jc w:val="both"/><w:kinsoku/><w:overflowPunct/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Songti SC" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:hint="eastAsia"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="282522"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="320"/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Songti SC" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:hint="eastAsia"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/><w:color w:val="282522"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/><w:outlineLvl w:val="0"/><w:jc w:val="left"/><w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Songti SC" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:hint="eastAsia"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="000000"/></w:rPr></w:style>
</w:styles>`

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="doNotCompress"/><w:themeFontLang w:val="zh-CN" w:eastAsia="zh-CN"/><w:compat><w:useFELayout/></w:compat></w:settings>`

export function createDocxManuscript(workspace, { date = new Date() } = {}) {
  const title = escapeXml(workspace.project.title)
  const isoDate = date.toISOString()
  return createStoredZip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'word/document.xml': documentXml(workspace),
    'word/styles.xml': STYLES_XML,
    'word/settings.xml': SETTINGS_XML,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Novel Studio</dc:creator><cp:lastModifiedBy>Novel Studio</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Novel Studio</Application></Properties>`,
  }, date)
}

function parseParagraphsFromDocx(buffer) {
  const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8')
  return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g), (match) => {
    const body = match[1]
    const style = body.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || 'Normal'
    const text = Array.from(body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g), (textMatch) => decodeXml(textMatch[1])).join('')
    return { style, text }
  }).filter((paragraph) => paragraph.text.trim())
}

function splitParagraphs(paragraphs, fallbackTitle) {
  let title = fallbackTitle
  const chapters = []
  let current = null
  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim()
    if (/^title$/i.test(paragraph.style) && title === fallbackTitle) { title = text; continue }
    const heading = /^(heading\s*1|heading1|标题\s*1)$/i.test(paragraph.style) || CHAPTER_HEADING.test(text)
    if (heading) {
      current = { title: text, manuscriptParts: [] }
      chapters.push(current)
      continue
    }
    if (!current) { current = { title: '第一章', manuscriptParts: [] }; chapters.push(current) }
    current.manuscriptParts.push(text)
  }
  return {
    title,
    chapters: chapters.map((chapter, index) => ({
      title: chapter.title || `第 ${index + 1} 章`,
      manuscript: chapter.manuscriptParts.join('\n\n'),
    })),
  }
}

function splitText(text, fallbackTitle, { markdown = false } = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  let title = fallbackTitle
  const chapters = []
  let current = null
  const hasChapterHeadings = lines.some((line) => {
    const trimmed = line.trim()
    const markdownHeading = markdown ? trimmed.match(/^(#{1,6})\s+(.+)$/) : null
    return Boolean((markdownHeading && markdownHeading[1].length >= 2) || CHAPTER_HEADING.test(markdownHeading?.[2]?.trim() || trimmed))
  })
  let plainTitleRead = false
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const markdownHeading = markdown ? trimmed.match(/^(#{1,6})\s+(.+)$/) : null
    if (markdownHeading?.[1] === '#' && chapters.length === 0) { title = markdownHeading[2].trim(); continue }
    const headingText = markdownHeading?.[2]?.trim() || trimmed
    if ((markdownHeading && markdownHeading[1].length >= 2) || CHAPTER_HEADING.test(headingText)) {
      current = { title: headingText, manuscriptLines: [] }
      chapters.push(current)
      continue
    }
    if (!current && hasChapterHeadings) {
      if (!trimmed || (markdown && /^>\s*/.test(trimmed))) continue
      if (!markdown && !plainTitleRead) {
        title = trimmed
        plainTitleRead = true
      }
      continue
    }
    if (!current) { current = { title: '第一章', manuscriptLines: [] }; chapters.push(current) }
    current.manuscriptLines.push(rawLine)
  }
  return {
    title,
    chapters: chapters.map((chapter, index) => ({
      title: chapter.title || `第 ${index + 1} 章`,
      manuscript: chapter.manuscriptLines.join('\n').trim(),
    })),
  }
}

export function parseManuscript(content, { format, fallbackTitle = '导入的小说' } = {}) {
  if (format === 'docx') return splitParagraphs(parseParagraphsFromDocx(Buffer.from(content)), fallbackTitle)
  if (format === 'markdown' || format === 'md') return splitText(Buffer.isBuffer(content) ? content.toString('utf8') : content, fallbackTitle, { markdown: true })
  if (format === 'txt') return splitText(Buffer.isBuffer(content) ? content.toString('utf8') : content, fallbackTitle)
  if (format === 'json') {
    const value = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : content)
    if (value?.format === 'novel-studio-project') return { backup: value }
    const project = value.project || value
    if (!Array.isArray(value.chapters || project.chapters)) throw new Error('JSON 中没有 chapters 数组')
    return {
      title: String(project.title || fallbackTitle),
      genre: String(project.genre || ''),
      idea: String(project.idea || ''),
      style: String(project.style || ''),
      chapters: normalizeChapters(value.chapters || project.chapters).map((chapter) => ({ title: chapter.title, manuscript: chapter.manuscript })),
    }
  }
  throw new Error(`不支持的导入格式：${format}`)
}

export function manuscriptExport(workspace, format, options = {}) {
  if (format === 'txt') return createTextManuscript(workspace)
  if (format === 'markdown' || format === 'md') return createMarkdownManuscript(workspace)
  if (format === 'docx') return createDocxManuscript(workspace, options)
  throw new Error(`不支持的导出格式：${format}`)
}
