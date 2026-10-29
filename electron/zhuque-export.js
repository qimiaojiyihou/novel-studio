const FORMATS = { txt: { name: '纯文本检测报告', extensions: ['txt'] }, json: { name: 'JSON 检测结果', extensions: ['json'] } }
const NOTICE = '检测标签、比例和置信度只作参考，不代表文本来源的确定性证明，不替代作者判断。'
const label = value => ({ 0: '人类', 1: 'AI', 2: '疑似 AI' })[value] || '未标注'
const percent = value => value === null || value === undefined ? '未返回' : `${(value * 100).toFixed(1)}%`
const filePart = value => [...String(value || '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim().replace(/[.\s]+$/g, '')].slice(0, 50).join('') || '未命名'

export function prepareZhuqueExport(database, getResult, input = {}, { now = () => new Date().toISOString() } = {}) {
  const format = String(input.format || 'txt').toLowerCase()
  if (!FORMATS[format]) throw new Error('请选择 TXT 或 JSON 检测结果格式')
  const chapter = database.prepare(`SELECT c.id,c.project_id,c.chapter_no,c.title,p.title AS project_title,p.work_format
    FROM chapters c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.project_id=?`).get(input.chapterId, input.projectId)
  if (!chapter) throw new Error('章节不存在或不属于此项目')
  const result = getResult({ projectId: input.projectId, chapterId: input.chapterId })
  if (!result) throw new Error('本章尚无朱雀检测结果，请先检测正文')
  if ((input.expectedDigest && input.expectedDigest !== result.manuscriptDigest)
    || (input.expectedCheckedAt && input.expectedCheckedAt !== result.checkedAt)) throw new Error('本章检测结果已更新，请关闭并重新打开检测结果后导出')
  // Explicit fields prevent credentials or unrelated private settings from ever
  // entering a report. Original text comes only from saved detection segments,
  // never from a newer manuscript that was not part of this detection.
  const report = {
    schemaVersion: 1, artifactType: 'novel-studio-zhuque-detection', provider: '腾讯云 EdgeOne 朱雀',
    project: { id: chapter.project_id, title: chapter.project_title, workFormat: chapter.work_format },
    chapter: { id: chapter.id, number: chapter.chapter_no, title: chapter.title },
    exportedAt: now(), checkedAt: result.checkedAt, manuscriptDigest: result.manuscriptDigest,
    stale: Boolean(result.stale),
    status: result.stale ? '旧稿结果：当前正文在检测后已修改' : '与当前已保存正文一致',
    ratioConfidence: result.ratioConfidence ?? null, softmaxConfidence: result.softmaxConfidence ?? null,
    labelsRatio: { human: result.labelsRatio?.human ?? null, ai: result.labelsRatio?.ai ?? null, suspected: result.labelsRatio?.suspected ?? null },
    billedTokens: result.billedTokens ?? null,
    segments: (result.segments || []).map(segment => ({ text: String(segment.text ?? ''), label: segment.label ?? null,
      labelText: label(segment.label), confidence: segment.confidence ?? null, order: segment.order ?? 0 })),
    notice: NOTICE,
  }
  const chapterName = chapter.work_format === 'short_story' ? chapter.title : `第${chapter.chapter_no}章 ${chapter.title}`
  const content = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : [
    '朱雀 AI 检测报告', `书名：${report.project.title}`, `章节：${chapterName}`,
    `检测时间：${report.checkedAt}`, `导出时间：${report.exportedAt}`, `结果状态：${report.status}`,
    `送检稿 SHA-256：${report.manuscriptDigest}`, '',
    '整体指标', `整体风险比例：${percent(report.ratioConfidence)}`, `整体风险置信度：${percent(report.softmaxConfidence)}`,
    `人类片段占比：${percent(report.labelsRatio.human)}`, `AI 片段占比：${percent(report.labelsRatio.ai)}`,
    `疑似 AI 片段占比：${percent(report.labelsRatio.suspected)}`, `本次计费 Token：${report.billedTokens ?? '未返回'}`,
    '', NOTICE, '', `分段明细（${report.segments.length} 段，按接口返回顺序）`,
    ...(report.segments.length ? report.segments.flatMap((segment, index) => [
      '', `片段 ${index + 1} · ${segment.labelText} · 置信度 ${percent(segment.confidence)} · 接口序号 ${segment.order}`,
      '原文：', segment.text,
    ]) : ['接口没有返回分段明细。']), '',
  ].join('\n')
  return { format, report, content, fileName: `${filePart(chapter.project_title)}-第${chapter.chapter_no}章.${format}` }
}

export async function exportZhuqueReport({ database, getResult, showSaveDialog, writeFile, now }, input = {}) {
  // Freeze the saved result before opening the dialog; an unrelated later
  // detection cannot silently replace the report the author chose to export.
  const snapshot = prepareZhuqueExport(database, getResult, input, { now })
  const choice = await showSaveDialog({ title: '导出朱雀 AI 检测结果', defaultPath: snapshot.fileName, filters: [FORMATS[snapshot.format]] })
  if (choice.canceled || !choice.filePath) return { cancelled: true }
  const filePath = choice.filePath.toLowerCase().endsWith(`.${snapshot.format}`) ? choice.filePath : `${choice.filePath}.${snapshot.format}`
  await writeFile(filePath, snapshot.content, 'utf8')
  return { cancelled: false, filePath, format: snapshot.format, checkedAt: snapshot.report.checkedAt, stale: snapshot.report.stale }
}
