// Shared by the editor, storage and every model executor. Missing values are
// legacy novels; the existing project_type field is reserved for user/benchmark.
export const WORK_FORMATS = ['novel', 'short_story']
export const isShortStory = project => project?.work_format === 'short_story'
export const workFormatLabel = project => isShortStory(project) ? '短故事' : '小说'

export function shortStoryWordCount(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 800 || count > 12000) throw new Error('短故事目标字数请填写 800—12000 之间的整数')
  return count
}

export function shortStoryGuidance(project) {
  if (!isShortStory(project)) return ''
  return `【作品形式：短故事】\n这是一篇独立短故事，全文目标约 ${project.target_word_count || 8000} 中文字。现有“章节卡”字段用于整篇故事卡，“场景计划”覆盖全文。围绕一个核心冲突展开开端、发展、转折与结局，人物与支线数量服从篇幅。首稿与整篇重写应完成核心冲突的收束；续写应从当前落点推进到结局。已指定结局与本次作者要求优先；开放式结尾也要完成本篇的情节或情感落点。避免把它写成长篇第一章、连载预告或为下一章强留悬念。规划及评审也按完整短篇判断。`
}
