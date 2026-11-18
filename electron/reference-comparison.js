import { randomInt, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { voicePassage } from './reference-voice.js'
import { guideSection } from './reference-rules.js'

export function comparisonMessages({ project, brief, task, sourceText, rule, samples }) {
  const style = project.style || ''
  const section = guideSection(style)
  const baseStyle = section ? (style.slice(0, section.start) + style.slice(section.end)).trim() : style
  return [
    { role: 'system', content: '你是中文小说作者。只输出正文，不写标题、说明或点评。' },
    { role: 'user', content: [
      task === 'rewrite' ? '按要求修订下方片段，仅调整涉及的句子，其余原文逐字保留。' : '写一段300—600字的原创场景。',
      project.genre && `作品题材：${project.genre}`, baseStyle && `本书文风：${baseStyle}`,
      `场景与要求：${brief}`, sourceText && `原稿或前文：\n${sourceText}`,
      rule && `本次参考规则：\n${rule}`, voicePassage(samples),
    ].filter(Boolean).join('\n') },
  ]
}

export async function generateComparison(input, generate, progress = {}) {
  const order = progress.order || (input.samples?.length ? ['普通', '规则', '规则和选段'] : ['普通', '规则'])
  for (let i = progress.order ? 0 : order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const outputs = [...(progress.outputs || [])]
  await progress.save?.({ order, outputs, guidedSlot: order.indexOf('规则') })
  for (const variant of order.slice(outputs.length)) {
    const messages = comparisonMessages({ ...input, rule: variant === '普通' ? '' : input.rule, samples: variant === '规则和选段' ? input.samples : [] })
    const result = await generate(messages)
    const text = String(result || '').trim()
    if (!text || text.length > 12000) throw new Error('试写返回为空或超过12000字符，请重试')
    outputs.push(text)
    await progress.save?.({ order, outputs, guidedSlot: order.indexOf('规则') })
  }
  return { outputs, guidedSlot: order.indexOf('规则'), order }
}

export async function generateComparisonCodex(gateway, settings, messages, signal) {
  const mirrorRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-blind-trial-'))
  try {
    if (signal?.aborted) throw new Error('盲评已停止')
    const result = await gateway.runExecFallback({ agentRunId: randomUUID(), agentStepId: 'blind-trial',
      prompt: messages.map(message => message.content).join('\n\n'), mirrorRoot, ...settings, isolatedWriting: true, signal })
    return result.content
  } catch (error) {
    if (/model_not_found|model is not supported/i.test(error.message)) throw new Error(`当前 Codex 登录通道没有模型 ${settings.model} 的调用权限，请检查模型设置`)
    throw error
  } finally { await rm(mirrorRoot, { recursive: true, force: true }) }
}
