// Only infer a dialogue purpose from outcomes that people can pursue through
// the other person (recording a name, releasing a notice, etc.).
const outcomes = [
  {
    commit: /(?:填|写|记|签|登)(?:进|上|入|下|好)?(?:一个|个|自己的|他的|她的|领用人的|经手人的|真实的|那个人的)?(?:姓名|名字|人名|经手人|领用人|日期|金额|地址|电话)|落款|签字|署名/,
    withhold: /留(?:着)?空|空(?:着|白)|别填|不填|先不写|别写|不落款|别留名字|把(?:这|那)一页揭过去/,
    object: /领用单|借用单|交接单|申请单|清单|借条|收据|登记表|交接表|申请表|签到表|名册|账本|登记簿|签收单|回执|表格|单子/g,
    field: /姓名|名字|人名|领用人|经手人|日期|金额|地址|电话/g,
    implicit: /^(?:先|暂时|暂且|仍然|继续)?(?:留空|空着|不填|别填)$|(?:那|这|该)(?:一)?(?:格|栏)|(?:这|那)一页|(?:名字|姓名|日期|金额|地址|电话)(?:栏|那格|这格)/,
  },
  {
    commit: /贴出|张贴|公布|公示|公开|刊出|见报/,
    withhold: /撤下|撤回|压下|收回|暂缓发布|只供内部|只在内部|留在抽屉|压在抽屉/,
    object: /通告|公告|告示|名单|通知|声明|报道|启事/g,
    implicit: /这份|那份|将它|把它/,
  },
]

const wish = /^(?:但|而|可是|不过)?([\p{Script=Han}]{1,12}?)(?:却|则|只|也|又|偏)?(?:希望|盼着?|打算|想要?|要|求)(.+)$/u

function singleAnchor(text, pattern) {
  if (!pattern) return ''
  const names = new Set((text.match(pattern) || []).map(name => /^(?:名字|人名|经手人|领用人)$/.test(name) ? '姓名' : name))
  return names.size <= 1 ? [...names][0] || '' : null
}

// Keep the qualifier next to the noun (“一号库的领用单”, “去年那张回执”).
// Discard leading goal/action words, which do not identify the document.
function qualifiedObject(text, name) {
  if (!name) return name
  const keys = new Set()
  for (const occurrence of text.matchAll(new RegExp(name, 'gu'))) {
    const before = text.slice(0, occurrence.index).split(/[在把将让给从向，。；：]/u).at(-1)
    const qualifier = before.match(/([\p{Script=Han}\dA-Za-z-]{1,12}?)(?:的|那张|这张|那份|这份)$|([东西南北新旧甲乙丙丁]|[一二三四五六七八九十\d]+号(?:库|柜|站)?)$/u)
    const distinct = /(?:另一|另外一|另)(?:张|份|本)?$/.test(before)
    keys.add((distinct ? '另:' : qualifier ? (qualifier[1] || qualifier[2]) + ':' : '') + name)
  }
  return keys.size === 1 ? [...keys][0] : null
}

function desiredOutcome(frame, result) {
  const commit = frame.commit.test(result)
  const withhold = frame.withhold.test(result)
  if (commit === withhold || /(?:不要|不必|不再|不用|不希望|不能|别再|不留空|不空着)/.test(result)) return null
  let object = singleAnchor(result, frame.object)
  if (frame.field && object === '') {
    // Preserve unfamiliar form names too. Two different sheets can both have
    // a name field; matching just the field would manufacture a conflict.
    const form = /(?:在|把|让|将|^)([\p{Script=Han}]{1,6}(?:单|表|簿|册))(?=上|中|里|的|那|这|还|仍|留空|空着)/u.exec(result)
    if (form) object = form[1]
  }
  const field = singleAnchor(result, frame.field)
  if (object === null || field === null || !(object || field || frame.implicit.test(result))) return null
  const qualified = qualifiedObject(result, object)
  if (qualified === null) return null
  return { commit, object: qualified, field }
}

function differentOwners(a, b) {
  if (a.owner === b.owner) return a.sentence === b.sentence && /^(?:一个人?|一人)$/.test(a.owner)
  if (!/^(自己|他|她)$/.test(b.owner)) return true
  return a.owner === '他' && b.owner === '她' || a.owner === '她' && b.owner === '他'
}

// An explicit reversal of the very same object and action needs no vocabulary
// for the particular prop: “让末班船靠岸” and “让末班船先别靠岸”.
function reversedAction(a, b) {
  const action = /^(?:让|把|将)([^，,]{1,20}?)(?:先|暂时|暂且)?(?:别|不要|不再)([^，,]{1,10})$/u
  for (const [negative, positive] of [[a, b], [b, a]]) {
    const parts = action.exec(negative)
    if (parts && !/自己|各自/.test(parts[1]) &&
        negative[0].replace('将', '把') + parts[1] + parts[2] === positive.replace(/^将/, '把')) return true
  }
  return false
}

function sharedOutcome(a, b) {
  if (a.commit === b.commit || !differentOwners(a, b) || (a.field && b.field && a.field !== b.field)) return false
  const distance = b.sentence - a.sentence
  if (a.object && b.object) return a.object === b.object && distance <= 2
  // Ellipsis (“填名字，另一人要留空”) only binds in adjacent local context.
  return distance <= 1
}

export function opposedOutcomeGoals(target) {
  for (const paragraph of target.split(/[\n"]/u)) {
    const recent = new Map()
    let lastWish
    const sentences = paragraph.split(/[。！？!?；;]/u)
    for (const [sentence, text] of sentences.entries()) {
      const clauses = text.split(/[，,、]/u)
      for (const [index, clause] of clauses.entries()) {
        const found = wish.exec(clause.trim())
        if (!found || /[不没无莫别]$/.test(found[1])) continue
        const owner = found[1].replace(/^(?:值班的|值夜的|门房|库管)(?=.{2,})/u, '')
        // A time clause can separate the owner from the desired result:
        // “只盼……回来时，单上那一格还空着”.
        const result = /(?:时|时候|以后|之前|之后)$/.test(found[2]) ? clauses[index + 1] || '' : found[2]
        const currentWish = { owner, sentence, result }
        if (lastWish && sentence - lastWish.sentence <= 2 && differentOwners(lastWish, currentWish) &&
            reversedAction(lastWish.result, result)) return true
        lastWish = currentWish
        for (const frame of outcomes) {
          const outcome = desiredOutcome(frame, result)
          if (!outcome) continue
          const current = { ...outcome, owner, sentence }
          const previous = recent.get(frame)
          if (previous && sharedOutcome(previous, current)) return true
          recent.set(frame, current)
        }
      }
    }
  }
  return false
}

// Read an offered signature field followed by the other person's refusal to
// sign. Simply passing a sheet back (after signing, for instance) is ambiguous.
export function opposedSigningActions(scene) {
  let offered
  for (const clause of scene.split(/[。！？!?；;\n]/u)) {
    if (!clause.trim()) continue
    const touch = /^([\p{Script=Han}]{1,6}?)(?:把|将|指|点|递|翻|摊|推)/u.exec(clause.trim())
    if (!touch) { offered = null; continue }
    const object = singleAnchor(clause, outcomes[0].object)
    if (object === null) { offered = null; continue }
    const key = qualifiedObject(clause.trim().slice(touch[0].length).replace(/^[着了]/u, ''), object)
    if (offered && offered.owner !== touch[1] && (!key || offered.object === key) &&
        /(?:推回|推了回|合上|推还|退回|递回)/u.test(clause) &&
        /(?:没签|没写|没碰笔|笔也没接|原样|空着)/u.test(clause)) return true
    offered = key && /(?:签名|签字|姓名|领用人|经手人)(?:那|这|一|的)*(?:栏|格|处)/u.test(clause)
      ? { owner: touch[1], object: key } : null
  }
  return false
}
