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

function proseWindows(text, chapters) {
  const windows = []
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
  return windows
}

export function selectImportExcerpts(text, chapters) {
  const windows = proseWindows(text, chapters)
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
