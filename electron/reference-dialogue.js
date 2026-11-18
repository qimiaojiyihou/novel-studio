const topicBreak = /^(?:对了[，,]|换个话题|说到别的)|(?:第二天|次日|几天后|话题一转|转过天)/

export function dialogueTurns(chunk) {
  return Array.from(chunk.matchAll(/“([^“”\n]{1,350})”|「([^「」\n]{1,350})」|『([^『』\n]{1,350})』|"([^"\n]{1,350})"/gu), match => ({
    start: match.index, end: match.index + match[0].length, words: (match[1] ?? match[2] ?? match[3] ?? match[4]).trim(),
  }))
}

export function connected(chunk, a, b) {
  if (b.start - a.end > 100) return false
  const gap = chunk.slice(a.end, b.start)
  // A speech tag inside one line often splits one speaker's sentence into two quotes.
  if (!gap.includes('\n') && /(?:说|道|答|接着|继续)[^。！？]{0,8}[，,]$/u.test(gap.trim())) return false
  return !/(?:^|\n)\s*[*＊—-]{3,}\s*(?:\n|$)/u.test(gap) && !topicBreak.test(gap) && !topicBreak.test(b.words)
}

// Scene openings are boundaries for goal inference. Keep “明早交接” and
// “昨晚借过钥匙” inside the scene when they describe deadlines or backstory.
export function sceneUnits(text) {
  return text.split(/\n\s*\n|(?:^|(?<=[。！？!?；;，,\n”」]))\s*(?:第[二三四五六七八九十\d]+天|次日|翌日|隔(?:天|日)|几天后|数日后|与此同时|镜头(?:转到|切到)|场景切换|另一边[，,]|(?:在)?(?:[一二三四五六七八九十\d]+号|[东西南北])(?:库房?|仓库|车间)(?:里|内)[，,]|(?:在|来到|转到)另一个(?:县|市|镇|村|车间|剧团))/u)
}

function precedingSpeakerAction(scene, previousEnd, start) {
  // The last clause before a quotation identifies a visible speaker/action.
  const context = scene.slice(previousEnd, start).trim().replace(/[：:]$/, '')
  const clause = context.split(/[。！？!?；;\n]/u).at(-1)?.trim() || ''
  return clause.match(/^([\p{Script=Han}]{1,8}?)(?:把|将|拿|递|推|缩|收|指|抬|低|问|答|说|摇|点|放|转|合|摊|按|抽|翻|拔)/u)?.[1] || ''
}

// Use the kind of information asked for and a concrete, incompatible reply.
// “陈姐六点送的” still answers who; an unrelated action alone proves nothing.
function deflectedReply(question, answer) {
  if (!/[？?]/u.test(question) || /还有|还有谁|几点|何时|多久|什么时候/.test(question)) return false
  if (!/谁|哪位|叫什么|什么名字|哪一个人/.test(question)) return false
  return /^(?:(?:那|这|最后一|末|早|晚)?(?:班)?(?:船|车)|衣裳|衣服|东西|包裹|钥匙|快递|末班船|末班车)?(?:[零〇两一二三四五六七八九十\d]{1,4}(?:点|时|分钟)|明早|天亮|下班前|马上|一会儿|等会儿)(?:[半钟左右前后才就能会再到还送开走回发取来给了的]{0,12})[。！!…]?$/.test(answer) &&
    !/(?:是|姓|叫|师傅|老师|[姐哥叔姨婶伯爷爸妈]|来的|送的|拿的|我|本人)/.test(answer)
}

export function hasDeflectedExchange(scene) {
  const turns = dialogueTurns(scene)
  return turns.some((reply, i) => {
    if (!i || !deflectedReply(turns[i - 1].words, reply.words)) return false
    const question = turns[i - 1]
    if (!connected(scene, question, reply)) return false
    const first = precedingSpeakerAction(scene, turns[i - 2]?.end || 0, question.start)
    const second = precedingSpeakerAction(scene, question.end, reply.start)
    return Boolean(first && second && first !== second && !/^(?:自己|接着|又|然后)$/.test(second))
  })
}
