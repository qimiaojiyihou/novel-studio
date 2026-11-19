// Search the project's accepted clue cards, never the full chapter plan or a
// generated summary of it. Due dates break ties; they cannot create a match.
const tokenizer = new Intl.Segmenter('zh', { granularity: 'word' })
const generic = new Set('伏笔 规划 计划 作者 回收 埋入 兑现 发现 看到 出现 一个 一条 已经 仍然 需要 确认 线索 读者 当年 当时 对方 准备 再次 继续 原来 第一 人物 细节 什么 来到 他们 这个 那个 尚未 本章 后续'.split(' '))
const strings = value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : []
const short = (s, n) => typeof s === 'string' ? [...s.slice(0, n * 2)].slice(0, n).join('') : ''
const words = text => new Set([...tokenizer.segment(text.toLowerCase())].filter(s => s.isWordLike && s.segment.length >= 2 && !generic.has(s.segment)).map(s => s.segment))
// Imported free-text notes may cite a published scene and also outline future
// volumes. Only an explicit past observation is a candidate for source lookup.
function citedChapter(note) {
  const match = note.match(/(?:第(\d+)章|(首章|第一章))[，、：:\s]*(?:已见|已经出现|已出现|已写到|曾写到|曾出现|已有正文)/u)
  return match ? Number(match[1] || 1) : 0
}

function anchors(title, seed) {
  // Preserve distinctive compounds even when the dictionary splits a coined name.
  const set = words(title + ' ' + seed)
  for (const part of title.match(/[\p{Script=Han}]{3,}/gu) || []) {
    for (const width of [2, 3]) {
      for (let i = 0; i + width <= part.length; i++) {
        const gram = part.slice(i, i + width)
        if (!generic.has(gram) && !/[的了是在有与和]/u.test(gram)) set.add(gram)
      }
    }
  }
  return set
}

export function loadSceneForeshadows(db, projectId, chapterNo) {
  const rows = db.prepare(`SELECT k.id,k.title,k.content_json,k.knowledge_scope_json,k.evidence_json,
      origin.chapter_no AS candidate_chapter, revision_origin.chapter_no AS revision_chapter,k.source_id
    FROM knowledge_items k
    LEFT JOIN knowledge_item_candidates c ON c.id=k.source_id AND c.project_id=k.project_id
    LEFT JOIN chapters origin ON origin.id=c.chapter_id AND origin.project_id=k.project_id
    LEFT JOIN revisions rev ON rev.id=k.source_revision_id
    LEFT JOIN chapters revision_origin ON revision_origin.id=rev.chapter_id AND revision_origin.project_id=k.project_id
    WHERE k.project_id=? AND k.kind='foreshadow' AND k.status='open'
      AND (k.effective_from_chapter IS NULL OR k.effective_from_chapter<=?)
      AND (k.effective_to_chapter IS NULL OR k.effective_to_chapter>=?)
    ORDER BY k.position,k.id`).all(projectId, chapterNo, chapterNo)
  const byId = db.prepare('SELECT chapter_no FROM chapters WHERE project_id=? AND id=?')
  const items = []
  for (const row of rows) {
    const data = JSON.parse(row.content_json)
    const evidence = JSON.parse(row.evidence_json || '[]')
    const linked = data.sourceChapterId || data.chapterId || (row.source_id?.startsWith('chapter:') ? row.source_id.slice(8) : null)
    const linkedNo = linked && byId.get(projectId, linked)?.chapter_no
    const origins = [row.candidate_chapter, row.revision_chapter, linkedNo, data.sourceChapterNumber, data.chapterNo].map(Number).filter(n => n > 0)
    if (origins.some(n => n >= chapterNo) || (Number(data.payoffChapterNo) > 0 && Number(data.payoffChapterNo) <= chapterNo)) continue
    const legacy = String(data.text || '')
    const sourceNo = Number(data.sourceChapterNumber || row.candidate_chapter || row.revision_chapter || linkedNo || data.chapterNo) ||
      citedChapter(legacy)
    if (sourceNo >= chapterNo) continue
    const title = short(row.title.replace(/^(?:规划伏笔|待兑现|伏笔)[：:]\s*/u, ''), 64)
    // Legacy cards mix an observation with a multi-volume roadmap. Only the
    // observation belongs on the wire. A planning card is still an author note.
    const seed = short(data.seed || data.setup || legacy.split(/(?:计划埋入|中段变化|计划回收)[：:]/u)[0], 180).trim()
    const scope = JSON.parse(row.knowledge_scope_json || '{}')
    const observed = data.seed || data.setup ? seed : seed.split(/[。\n]/u).filter(line => !/计划|规划|尚未写|预定/u.test(line)).join(' ')
    const terms = anchors(title, observed)
    const payoff = short(data.payoff, 100)
    items.push({ payoff, id: row.id, title, seed, sourceNo, terms, due: Number(data.dueChapterNo) || 0,
      planned: /规划伏笔/.test(row.title) || Boolean(data.planningOnly) || data.occurred === false,
      knownTo: (Array.isArray(scope.characters) ? scope.characters : []).slice(0, 8).map(v => short(v, 30)),
      reader: scope.reader === true, evidence: [...(Array.isArray(evidence) ? evidence : []), data.evidence].filter(Boolean) })
  }
  return items
}

function sceneFocus(scene) {
  return [scene.title, scene.goal, scene.location, scene.obstacle, ...(Array.isArray(scene.actionBeats) ? scene.actionBeats : []),
    scene.turn, scene.entryState, scene.exitState, ...(Array.isArray(scene.knowledgeChanges) ? scene.knowledgeChanges : [])]
    .filter(v => typeof v === 'string').join(' ').toLowerCase()
}

export function selectSceneForeshadows(items, scene, chapterNo, previousManuscript, characterNames = []) {
  const focus = sceneFocus(scene)
  const actors = [...strings(characterNames), ...strings(scene.presentCharacters), scene.pov].filter(v => typeof v === 'string' && v)
  const explicit = new Set([...strings(scene.knowledgeIds), ...strings(scene.foreshadowIds)])
  const ranked = items.map(item => {
    const matches = [...item.terms].filter(term => focus.includes(term) && !actors.some(name => name.includes(term)))
      .sort((a,b) => b.length - a.length)
    const distinct = matches.filter((term, i) => !matches.slice(0,i).some(other => other.includes(term)))
    const direct = explicit.has(item.id)
    const named = item.title.length >= 2 && !actors.includes(item.title) && focus.includes(item.title.toLowerCase())
    const meaningful = named || distinct.some(t => t.length >= 3) || distinct.length >= 2
    const score = direct ? 1000 : meaningful ? (named ? 30 : 0) + distinct.reduce((n,t) => n + Math.min(8,t.length),0) : 0
    return { item, matches: distinct, score }
  }).filter(x => x.score).sort((a,b) => b.score - a.score ||
    Number(b.item.due === chapterNo) - Number(a.item.due === chapterNo) || a.item.id.localeCompare(b.item.id))
  return ranked.slice(0,3).map(({item,matches}) => {
    const prose = item.sourceNo && previousManuscript?.(item.sourceNo)
    let quote = ''
    if (prose) {
      const evidence = item.evidence.map(e => typeof e === 'string' ? e : e?.quote).find(q => q?.length >= 6 && prose.includes(q))
      if (evidence) quote = short(evidence, 120)
      else {
        const terms = [...new Set([...matches, ...words(item.title)])]
        let best = 0
        for (const paragraph of prose.split(/\n+/u)) {
          const hits = terms.filter(t => paragraph.includes(t))
          const score = hits.reduce((n,t) => n + t.length, 0)
          if (score <= best) continue
          best = score
          const start = Math.max(0, paragraph.indexOf(hits[0]) - 30)
          quote = short(paragraph.slice(start), 120)
        }
      }
      if (quote.trim() === prose.trim()) quote = '' // Never attach an entire historical chapter.
    }
    return { id: item.id, title: item.title, sourceNo: item.sourceNo || null, quote,
      text: JSON.stringify({ 线索: item.title, 类型: item.planned ? '作者规划' : '伏笔卡', 卡片摘记: item.seed || undefined,
        预定回收方式: item.due > 0 && item.due <= chapterNo ? item.payoff || undefined : undefined,
        知情: item.knownTo.length ? item.knownTo.join('、') : '人物知情未标记', 读者知情标记: item.reader || undefined,
        ...(quote && { 原文位置: `第${item.sourceNo}章`, 原文短引: quote }) }) }
  })
}

// Search saved manuscripts on this run's project snapshot. Cache document
// frequencies across scenes and retries; never tokenize whole novels per scene.
const proseStopWords = new Set('本场 自己 以前 今日 如今 徒弟 师父 面前 是不是 打算 决定 为何 是否 这回 这次 这件 那件 一次 事情 怎么 什么 一起 地方 东西 过来 回去 记得 回忆 想起 一下 时候 没有 发现 曾经 只好 已是 起来 看看 当初 究竟 只想 重新 一边 知道 明白 这才 手里 身上 眼前 身边 旁边 先前 看见 见过 的是 哪一 看中 如何 那里 是个 这是 了些 了一 这种 只有 到底 过去 出来 人家 两人 一点 头回 一盆 方才'.split(' '))
export function createManuscriptRecall(previousChapters, characterNames = []) {
  const frequencies = new Map()
  const count = previousChapters.size
  const commonThreshold = Math.max(3, Math.ceil(count * 0.12))
  function frequency(term) {
    if (!frequencies.has(term)) {
      let found = 0
      for (const prose of previousChapters.values()) {
        if (prose?.includes(term) && ++found > commonThreshold) break
      }
      frequencies.set(term, found)
    }
    return frequencies.get(term)
  }
  return (scene, cards = []) => {
    const actors = [...characterNames, ...strings(scene.presentCharacters), scene.pov].filter(Boolean)
    const focus = sceneFocus(scene)
    const candidates = words(focus)
    // Object names in fiction are often split into individual characters.
    // Keep compounds inside content-word runs, never across particles or punctuation.
    for (const run of focus.match(/[\p{Script=Han}]+/gu) || []) {
      for (const part of run.split(/[的了是着一有在我你他她它们要把又向自己什么那这已只看想让从将和与后前再却就里很也都多少曾还得地过时如]/u)) {
        for (const width of [2, 3, 4]) {
          for (let i = 0; i + width <= part.length; i++) candidates.add(part.slice(i, i + width))
        }
      }
    }
    const terms = [...candidates].filter(term => !generic.has(term) && !proseStopWords.has(term) &&
      !actors.some(name => typeof name === 'string' && name.includes(term)) &&
      frequency(term) > 0 && frequency(term) <= commonThreshold)
    if (terms.length < 2) return null
    let best = null
    for (const [sourceNo, prose] of previousChapters) {
      if (!prose) continue
      const relevant = terms.filter(term => prose.includes(term))
      if (relevant.length < 2) continue
      for (const paragraph of prose.split(/\n+/u)) {
        const matches = relevant.filter(term => paragraph.includes(term))
        if (matches.length < 2) continue
        // Overlapping windows keep distant mentions from adding up to one clue.
        for (let start = 0; start < paragraph.length; start += 80) {
          let quote = short(paragraph.slice(start), 120).trim()
          if (start + quote.length < paragraph.length) {
            const complete = quote.match(/^.*[。！？][”」』]?/u)?.[0]
            if (complete && complete.length >= 40 && matches.every(term => !quote.includes(term) || complete.includes(term))) quote = complete
          }
          if (quote.length < 12 || quote === prose.trim()) continue
          const hits = []
          let unused = quote
          for (const term of matches.filter(t => quote.includes(t)).sort((a, b) => b.length - a.length || frequency(a) - frequency(b))) {
            if (!unused.includes(term) || hits.some(longer => longer.includes(term))) continue
            hits.push(term)
            unused = unused.replaceAll(term, ' ')
          }
          if (hits.length < 2 || cards.some(card => card.sourceNo === sourceNo && card.quote && paragraph.includes(card.quote))) continue
          const score = hits.reduce((total, term) => total + Math.min(term.length, 6) * Math.log(2 + count / frequency(term)), 0)
          if (!best || score > best.score) best = { score, sourceNo, quote }
          if (start + 120 >= paragraph.length) break
        }
      }
    }
    if (!best) return null
    const { sourceNo, quote } = best
    return { kind: 'manuscript', id: 'manuscript:' + sourceNo, title: '本书旧正文', sourceNo, quote,
      text: JSON.stringify({ 类型: '正文旁证', 原文位置: '第' + sourceNo + '章', 原文短引: quote,
        用途: '只核对旧事；此短引不代表该事尚未解决或在场人物知情。' }) }
  }
}
