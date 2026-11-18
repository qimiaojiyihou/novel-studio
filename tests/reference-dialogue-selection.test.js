import test from 'node:test'
import assert from 'node:assert/strict'
import { indexReferenceChapters } from '../electron/reference-chapters.js'
import { selectImportExcerpts } from '../electron/reference-auto-excerpts.js'

const opening = '第一章 雨停之后\n' + '树叶上的水还在往下落，路边的棚子已经撤了。阿棠从站牌底下走出来，鞋边沾了一圈细沙。'.repeat(5)
const pick = text => selectImportExcerpts(text, indexReferenceChapters(text)).find(s => s.use === '熟人商量')

test('keeps the inquiry, short answer, proposed terms and accepted amendment across prose windows', () => {
  const inquiry = '「你那辆车明早有人用吗？」'
  const deal = '「也行，不过你得在七点前还回来。」'
  const scene = [inquiry, '「没有。」老贺正忙着擦轮圈，头也没抬。', '「借我骑一趟，只要赶得上早市，我回来替你捎菜。」', '老贺把锁从梁上摘下来。', deal, '「对了，你家那盏灯修好了没有？」'].join('\n\n')
  const text = opening + '\n' + scene
  const sample = pick(text)
  assert.equal(sample?.text, scene.slice(0, scene.indexOf(deal) + deal.length))
  assert.ok(text.includes(sample.text) && sample.text.length <= 600)
})

test('factual questions and answers, chapter changes and unrelated scene breaks are not negotiation', () => {
  const question = '“能不能借我半天？回头我把车擦干净。”'
  const reply = '“好，明天我们再过来。”'
  for (const passage of ['“雨停了吗？”\n“刚停。”\n“路上还有人吗？”\n“没有。”',
    question + '\n第二章 新住处\n' + reply, question + '\n***\n' + reply,
    question + '\n次日清晨，门前终于安静了。\n' + reply,
    '“能不能借我半天？回头我把车擦干净。”他接着说，“好，我知道你在忙。”',
    '“我出门的时候街口已经空了，一直走到这儿也没看到人。”\n“好，那我知道了。”']) {
    assert.equal(pick(opening + '\n' + passage), undefined)
  }
})

test('a concrete undertaking in a later turn can accept a counteroffer', () => {
  const exchange = '“能不能借我推车运点木料？”\n“可以借，不过你得先把仓库门口的纸板推走。”\n“我现在就去清门口。”'
  assert.equal(pick(opening + '\n' + exchange)?.text, exchange)
})

test('keeps refusal and follow-up together and rejects routine questions or a scene change', () => {
  const sample = fragment => {
    const text = opening + '\n' + fragment
    return selectImportExcerpts(text, indexReferenceChapters(text)).find(s => s.use === '对白试探')?.text
  }
  const prelude = '矿灯在轨道边闪了一下，门里有人咳嗽。'
  const scene = '「昨晚谁拿了钥匙？」\n「你问这个干什么？」\n「我问的是最后签字的人。」\n「是我签的。」'
  assert.equal(sample(prelude + '\n' + scene), scene)
  const narrated = '“你等谁呢？”\n“走累了。”她随口扯谎，手还攥着那张字条。\n“那你怎么一直盯着门口？”'
  assert.equal(sample(narrated), narrated)
  const deflection = '“昨晚送信的是谁？”\n“邮费我付过了。”\n“我问的是谁送的信。”\n“是我妹妹。”'
  assert.equal(sample(deflection), deflection)
  for (const unrelated of ['“什么时候走？”\n“六点整。”\n“那在哪里上车？”',
    '“昨晚谁值班？”\n“我不清楚。”\n“明早要带水吗？”',
    '“昨晚谁值班？”\n“无可奉告。”\n***\n“那你怎么不签字？”',
    '“昨晚谁值班？”\n“无可奉告。”\n第二章 签收\n“那你怎么不签字？”']) assert.equal(sample(unrelated), undefined)
})
