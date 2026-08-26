export const GENRE_OPTIONS = [
  '都市悬疑',
  '都市情感',
  '现代言情',
  '古代言情',
  '玄幻',
  '仙侠',
  '奇幻',
  '科幻',
  '历史',
  '武侠',
  '文娱',
  '现实题材',
  '末世',
  '游戏',
  '无限流',
  '轻小说',
]

export const STYLE_PRESETS = [
  {
    id: 'neutral',
    label: '自然通用',
    description: '清楚、耐读、不抢故事',
    text: '语言自然克制，表达清楚具体；以人物行动和对白推进，避免空泛概括与过度修饰。',
  },
  {
    id: 'suspense',
    label: '紧凑悬疑',
    description: '线索推进，信息克制',
    text: '节奏紧凑，叙述冷静克制；用行动、对白和可验证线索推进，少解释，章末保留明确悬念。',
  },
  {
    id: 'light',
    label: '轻松自然',
    description: '口语鲜活，人物好相处',
    text: '语言口语自然，节奏轻快；重人物互动和即时反应，幽默来自性格与处境，不刻意抖机灵。',
  },
  {
    id: 'emotional',
    label: '细腻情感',
    description: '关系变化，感受具体',
    text: '叙述细腻但不过度抒情；通过细节、停顿和人物选择呈现情绪，让关系变化落在具体场景中。',
  },
  {
    id: 'fast',
    label: '爽快利落',
    description: '目标明确，回报及时',
    text: '节奏明快，句子利落；目标、阻力和回报清晰，用连续行动制造推进感，减少重复解释和无效停留。',
  },
  {
    id: 'cinematic',
    label: '电影画面',
    description: '场面可见，转场清晰',
    text: '强调可见可听的场景细节，控制视角与镜头距离；用动作和空间关系组织段落，让转场清楚、有画面感。',
  },
]

function cleanFragment(value) {
  return String(value || '')
    .trim()
    .replace(/^[，。；;,.、\s]+|[，。；;,.、\s]+$/g, '')
}

function withPrefix(value, prefix) {
  const content = cleanFragment(value)
  if (!content) return ''
  return content.startsWith(prefix) ? content : `${prefix}${content}`
}

export function buildIdeaSentence({ protagonist, incitingEvent, goal, stakes } = {}) {
  const parts = [
    cleanFragment(protagonist),
    cleanFragment(incitingEvent),
    withPrefix(goal, '必须'),
    withPrefix(stakes, '否则'),
  ].filter(Boolean)

  return parts.length ? `${parts.join('，')}。` : ''
}

