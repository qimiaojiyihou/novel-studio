// Match evidence in the prose itself. The writing prompt has a separate vocabulary
// for matching an author's instructions to these same purposes.
const evidence = {
  旁白评说: [/说起来|要说|说来也巧|话说回来|说到底|倒也难怪|简单点说|确切[地的]说|可以说[，、]|也是[，、].{3,45}想必/, /毕竟|偏偏|算起来|谁叫/],
  人物盘算: [/盘算|权衡|掂量|琢磨|合计|算了笔账|思考.{0,8}(怎么|该不该)|在心中.{0,4}(衡量|做出评价)/, /划算|值不值|犯不着|舍不得|不如先/],
  熟人商量: [/要不咱|要不这样|说好了|商量|我负责|你负责/, /你先|我来|成交|那就这么|就这么定/],
  判断修正: [/原以为|本以为|看走眼|猜错|想岔|误会了/, /原来|竟然是|这才明白|弄错了/],
  留有余地: [/打圆场|解围|没拆穿|没点破|给.*台阶/, /岔开话题|装作没|顺着他的话|顺着她的话/],
  对白试探: [/试探|探口风|套话|旁敲侧击|不动声色地问/, /反问|没有正面回答|话锋一转|避而不答/],
  克制情绪: [/强忍|忍住|压下|强压|忍了又忍|把泪憋/, /没让.*看见|把话咽|攥紧|哽住/],
  关键转折: [/改变主意|当机立断|拿定主意|猛然意识到|终于下定决心|拍板道|打定主意/, /可就在这时|就在这时|忽然发现|这才意识到/],
  日常过渡: [/转眼|一晃|几天后|数日后|到了次日|第二天一早|接下来的几天|吃完饭[，、].{2,30}(接着|收拾)|过了没几天/, /日子一天天|等到.*时候|又过了|忙完了/],
  轻松打趣: [/打趣|调侃|开玩笑|揶揄|笑骂/, /噗嗤|乐了|笑出声|憋着笑/],
}

// Read successive quoted turns before splitting prose into fixed-size samples.
// A question alone is weak evidence: look for an offer followed by terms or assent.
const offer = /要不|能不能|可不可以|能帮|肯不肯|借我|我替你|我帮你|你帮我|我来(?:搬|拿|做|跑|送|接|付|守|值|开|修|顶|换)|我出(?:钱|力|车|人|一半)|我负责|你负责|你看.{1,14}(?:怎么样|行不行)|换我|算我一个/
const terms = /只要|条件是|除非|前提是|得先|你得|不过.{0,12}(?:得|要|先)|我可以.{0,15}(?:但|不过)|你先.{1,24}我|我.{1,20}[，,]你来|我.{1,20}[，,]你负责/
const assent = /^(?:那(?:就)?|嗯[，,])?(?:也行|行啊|行吧|行[，。！!]|成[，。！!]|好[，。！!]|好啊|可以[，。！!]|没问题|就这么办|一言为定|说定了|成交)|那就这么|我答应/
// A concrete undertaking can accept a condition without an explicit yes.
const undertaking = /^(?:那|嗯[，,])?(?:我|我们|咱们)(?:今晚|今早|明早|明天|这就|马上|现在就|一定会|保证|负责)/
const topicBreak = /^(?:对了[，,]|换个话题|说到别的)|(?:第二天|次日|几天后|话题一转|转过天)/

function negotiationSample(chunk, label) {
  const turns = Array.from(chunk.matchAll(/“([^“”\n]{1,350})”|「([^「」\n]{1,350})」|『([^『』\n]{1,350})』|"([^"\n]{1,350})"/gu), match => ({
    start: match.index, end: match.index + match[0].length, words: (match[1] ?? match[2] ?? match[3] ?? match[4]).trim(),
  }))
  function connected(a, b) {
    if (b.start - a.end > 100) return false
    const gap = chunk.slice(a.end, b.start)
    // A speech tag inside one line often splits one speaker's sentence into two quotes.
    if (!gap.includes('\n') && /(?:说|道|答|接着|继续)[^。！？]{0,8}[，,]$/u.test(gap.trim())) return false
    return !/(?:^|\n)\s*[*＊—-]{3,}\s*(?:\n|$)/u.test(gap) && !topicBreak.test(gap) && !topicBreak.test(b.words)
  }
  let best
  for (let i = 0; i < turns.length - 1; i++) {
    const proposal = turns[i]
    if (!offer.test(proposal.words) && !terms.test(proposal.words)) continue
    let hasTerms = terms.test(proposal.words)
    for (let j = i + 1; j < Math.min(i + 5, turns.length); j++) {
      const reply = turns[j]
      if (!connected(turns[j - 1], reply) || reply.end - proposal.start > 600) break
      const acceptedTerms = hasTerms && undertaking.test(reply.words)
      hasTerms ||= terms.test(reply.words)
      if (!assent.test(reply.words) && !acceptedTerms) continue
      let first = i
      // Include the initiating question and short reply when they lead into the offer.
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
        if (!connected(turns[k], turns[k + 1]) || reply.end - turns[k].start > 600) break
        if (/[？?]/u.test(turns[k].words)) { first = k; break }
        if (turns[k].words.length > 12) break
      }
      const text = chunk.slice(turns[first].start, reply.end)
      const score = 2 * Number(hasTerms) + Number(first < i) + Number(offer.test(proposal.words)) + Number(terms.test(reply.words))
      if (text.length >= 24 && (!best || score > best.score)) best = { text, label, score }
      break
    }
  }
  return best
}

function proseWindows(text, chapters) {
  const windows = []
  let negotiation
  const seen = new Set()
  const count = Math.min(chapters.length, 96)
  for (let i = 0; i < count; i++) {
    const chapter = chapters[Math.round(i * (chapters.length - 1) / Math.max(count - 1, 1))]
    const length = chapter.end - chapter.start
    const spans = Math.min(Math.ceil(length / 4800), Math.max(1, Math.floor(96 / count)))
    for (let j = 0; j < spans; j++) {
      const offset = Math.floor(Math.max(0, length - 4800) * j / Math.max(spans - 1, 1))
      let chunk = text.slice(chapter.start + offset, Math.min(chapter.end, chapter.start + offset + 4800))
      if (offset) {
        const boundary = chunk.match(/[。！？!?][”」』"]*|\n/u)
        if (!boundary) continue
        chunk = chunk.slice(boundary.index + boundary[0].length)
      }
      else if (chunk.split('\n', 1)[0].replace(/^#+\s*/, '').trim() === chapter.title) chunk = chunk.slice(chunk.indexOf('\n') + 1)
      if (offset + 4800 < length) chunk = chunk.replace(/[^。！？!?\n]*$/u, '')
      const exchange = negotiationSample(chunk, '自动选段 · ' + chapter.title)
      if (exchange && (!negotiation || exchange.score > negotiation.score)) negotiation = exchange
      let passage = ''
      function collect() {
        const value = passage.trim()
        passage = ''
        if (value.length < 32 || !/[。！？!?]/.test(value) || seen.has(value)) return
        if ((value.match(/^\s*(?:\d+\.|[^\n：:]{1,8}[：:])/gm) || []).length >= 3) return
        seen.add(value)
        windows.push({ text: value, label: '自动选段 · ' + chapter.title })
      }
      // Consecutive matches preserve original whitespace and exact quotations.
      for (const match of chunk.matchAll(/[^。！？!?\n]+(?:[。！？!?]+[”’」』"]*)?|[\n]+|[。！？!?]+/gu)) {
        const part = match[0]
        if (part.length > 600 || /https?:\/\/|求月票|求推荐票|加入书签|本章未完/.test(part)) { collect(); continue }
        if (passage.length + part.length > 400) collect()
        passage += part
        if (passage.length >= 210 && /[。！？!?\n][”’」』"]*$/.test(part)) collect()
      }
      collect()
    }
  }
  return { windows, negotiation }
}

export function selectImportExcerpts(text, chapters) {
  const { windows, negotiation } = proseWindows(text, chapters)
  if (!windows.length) return []
  const ranks = windows.map(sample => {
    const quotes = (sample.text.match(/[“「『]/g) || []).length
    const base = Math.min(sample.text.length, 230) / 80 + (quotes === 1 || quotes === 2 ? 2 : 0) +
      Math.min((sample.text.match(/[。！？]/g) || []).length, 4) / 4
    const scored = Object.entries(evidence).map(([use, cues]) => ({
      use, score: cues.reduce((sum, cue, i) => sum + (cue.test(sample.text) ? 2 - i : 0), 0),
    }))
    return { sample, base, scored }
  })
  // Reserve the strongest functional passages first when another base is available.
  const strongest = rank => Math.max(...rank.scored.map(item => item.score))
  const base = ranks.reduce((a, b) => b.base - strongest(b) > a.base - strongest(a) ? b : a)
  const result = [{ ...base.sample, use: '底色', primary: true }]
  const taken = new Set([base])
  const purposes = new Set()
  if (negotiation && negotiation.text !== base.sample.text) {
    result.push({ text: negotiation.text, label: negotiation.label, use: '熟人商量' })
    purposes.add('熟人商量')
    for (const rank of ranks) if (negotiation.text === rank.sample.text) taken.add(rank)
  }
  const candidates = ranks.flatMap(rank => rank.scored.filter(item => item.score >= 2)
    .map(item => ({ ...item, rank }))).sort((a, b) => b.score - a.score || b.rank.base - a.rank.base)
  for (const { use, rank } of candidates) {
    if (taken.has(rank) || purposes.has(use)) continue
    taken.add(rank)
    purposes.add(use)
    result.push({ ...rank.sample, use })
  }
  return result
}
