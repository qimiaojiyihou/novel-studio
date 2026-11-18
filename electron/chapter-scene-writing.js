import { createHash } from 'node:crypto'
import { selectReferenceStyle, sentReferenceRules } from './reference-rules.js'
import { selectSceneSample, voicePassage } from './reference-voice.js'

export function chapterWritingScenes(input, provider, step) {
  if (provider !== 'codex' || input.task !== 'chapter' || input.intent !== 'draft' ||
      step.candidateType !== 'manuscript' || step.input?.revision || step.input?.patchSource ||
      step.input?.conversationMode === 'discuss') return []
  const planned = input.chapter?.scenePlan?.scenes
  const scenes = planned?.length ? planned : input.chapter?.card?.requiredScenes
  return (Array.isArray(scenes) ? scenes : []).filter(Boolean).map(scene => typeof scene === 'string' ? { title: scene } : scene)
}

export function compileChapterScene({ input, scenes, index, previousEnding, preceding, targetLength }) {
  const scene = scenes[index]
  const title = scene.title || `场景 ${index + 1}`
  const location = `第${index + 1}/${scenes.length}场 · ${title}`
  const chapter = input.chapter
  const sceneInput = { ...input, chapter: { ...chapter, card: {}, scenePlan: { scenes: [scene] } },
    sourceText: '', instruction: input.sceneInstruction || '' }
  const library = input.promptContext?.voiceLibrary
  const sample = selectSceneSample(library, input, scene)
  const styles = input.promptContext?.style?.sources || []
  const voice = [...new Set([input.project.style, ...styles.map(s => s.text)].filter(Boolean)
    .map(style => selectReferenceStyle(style, sceneInput)))]
  const styleSettings = styles.filter(s => Object.keys(s.style || {}).length).map(s => JSON.stringify(s.style))
  const writingRequirements = input.promptContext?.addons?.map(addon => addon.content).filter(Boolean) || []
  let prior = [previousEnding, preceding].filter(Boolean).join('\n\n')
  for (const s of library?.samples || []) {
    if (s.text && s.text !== sample?.text) prior = prior.replaceAll(s.text, '〔前文引用略〕')
  }
  const messages = [
    { role: 'system', content: '根据给出的本书材料写当前一场，用连续的小说正文回答。只写当前计划的动作和落点，承接前文，避免回放上一场。无需调用工具、读取文件或查找资料。只返回 JSON 对象，manuscript 字段放正文，不加标题、场次、写作说明或分隔符。' },
    { role: 'user', content: [
      `《${input.project.title}》第${chapter.chapter_no}章《${chapter.title}》 · ${location}`,
      voice.length || styleSettings.length ? '【本书文风】\n' + [...voice, ...styleSettings].join('\n') : '',
      '【本场计划】\n' + JSON.stringify(scene),
      prior && '【本书前文】\n' + prior,
      ...writingRequirements,
      input.sceneInstruction && '【作者本次要求】\n' + input.sceneInstruction,
      voicePassage(sample ? [sample] : []),
      targetLength > 0 && `全章共 ${scenes.length} 场，目标约 ${targetLength} 个中文字。本场参考篇幅约 ${Math.round(targetLength / scenes.length)} 字，随情节详略调整。`,
    ].filter(Boolean).join('\n\n') },
  ]
  return { messages, scene: { number: index + 1, count: scenes.length, title },
    voiceSamples: sample ? [{ title: sample.title, label: sample.label, use: sample.use, scenes: [location] }] : [],
    referenceRules: sentReferenceRules(messages), promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    estimatedChars: messages.reduce((n, m) => n + m.content.length, 0) }
}
