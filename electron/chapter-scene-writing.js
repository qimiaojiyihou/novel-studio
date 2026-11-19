import { FORESHADOW_WRITING_RULE } from './chapter-handoff.js'
import { selectSceneForeshadows } from './scene-foreshadow.js'
import { fitSceneContext, sceneHistory } from './scene-context.js'
import { createHash } from 'node:crypto'
import { selectReferenceStyle, sentReferenceRules } from './reference-rules.js'
import { manuscriptCharacterCount } from './manuscript-checks.js'
import { selectSceneSample, voicePassage } from './reference-voice.js'

export function chapterWritingScenes(input, provider, step) {
  if (provider !== 'codex' || input.task !== 'chapter' || input.intent !== 'draft' ||
      step.candidateType !== 'manuscript' || step.input?.revision || step.input?.patchSource ||
      step.input?.conversationMode === 'discuss') return []
  const planned = input.chapter?.scenePlan?.scenes
  const scenes = planned?.length ? planned : input.chapter?.card?.requiredScenes
  return (Array.isArray(scenes) ? scenes : []).filter(Boolean).map(scene => typeof scene === 'string' ? { title: scene } : scene)
}

export function compileChapterScene({ input, scenes, index, previousEnding, preceding, precedingScenes, targetLength, lengthDraft, maxChars, displayTitle, outputSchema, foreshadows = [], previousManuscript, recallManuscript }) {
  const scene = scenes[index]
  const title = scene.title || `场景 ${index + 1}`
  const location = `第${index + 1}/${scenes.length}场 · ${title}`
  const final = index === scenes.length - 1
  const written = manuscriptCharacterCount(preceding)
  const budget = targetLength > 0 ? { chapterTarget: targetLength, written,
    target: Math.max(1, Math.round(targetLength / scenes.length * 0.45), Math.round((targetLength - written) / (scenes.length - index))) } : null
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
  // Select from complete accepted prose, then remove any foreign reference quote.
  const history = sceneHistory(preceding || '', precedingScenes)
  const redact = text => {
    for (const other of library?.samples || []) {
      if (other.text && other.text !== sample?.text) text = text.replaceAll(other.text, '〔前文引用略〕')
    }
    return text
  }
  const clues = selectSceneForeshadows(foreshadows, scene, chapter.chapter_no, previousManuscript, input.planningCenter?.characters?.map(c => c.title))
  const passage = recallManuscript?.(scene, clues)
  if (passage && clues.length < 3) clues.push(passage)
  const fitted = fitSceneContext({
    clues,
    system: '根据给出的本书材料写当前一场，用连续的小说正文回答。只写当前计划的动作和落点，承接前文，避免回放上一场。无需调用工具、读取文件或查找资料。只返回 JSON 对象，manuscript 字段放正文，不加标题、场次、写作说明或分隔符。' + FORESHADOW_WRITING_RULE,
    displayTitle, outputSchema, maxChars, repair: Boolean(lengthDraft),
    style: [...voice, ...styleSettings].join('\n'), history: redact(history),
    previous: redact((previousEnding || '').slice(-1800)),
    reference: voicePassage(sample ? [sample] : []),
    title: `《${input.project.title}》第${chapter.chapter_no}章《${chapter.title}》 · ${location}`,
    plan: '【本场计划】\n' + JSON.stringify(scene),
    instructions: [...writingRequirements,
      input.sceneInstruction && '【作者本次要求】\n' + input.sceneInstruction],
    directions: [
      budget && `【篇幅】全章目标 ${targetLength} 个中文字，已写 ${written} 字。本场以 ${budget.target} 个中文字为中心，标点、空格不计。把篇幅用在改变判断的经过、人物的反应和选择的后果；过场从简。`,
      final ? '【章末收束】从本场计划和前文找出本章有了着落的那件事。用人物当下做出的一个选择、动作、一句有后果的话或已经可见的变化把它写实。需要留白时停在那一刻。计划留给下一章的事仍留在那里，结尾避免重述感悟或罗列日后打算。'
        : '在本场计划的落点交给下一场，省去章末式总结。',
      lengthDraft && `【本场篇幅复核】上一稿实计 ${manuscriptCharacterCount(lengthDraft)} 个中文字。保留事件、口吻和落点，按上述本场字数调整叙事详略，返回完整的本场正文。\n${lengthDraft}`,
    ],
  })
  const messages = fitted.messages
  if (history !== (preceding || '')) fitted.diagnostics.shortened.push('earlierScenes')
  return { messages, recalledClues: fitted.clues.map(({ id, title, sourceNo, quote, kind = 'card' }) => ({ id, title, sourceNo, quote, kind })), contextDiagnostics: fitted.diagnostics, scene: { number: index + 1, count: scenes.length, title, budget },
    voiceSamples: fitted.referenceSent ? [{ title: sample.title, label: sample.label, use: sample.use, scenes: [location] }] : [],
    referenceRules: sentReferenceRules(messages), promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    estimatedChars: messages.reduce((n, m) => n + m.content.length, 0) }
}
