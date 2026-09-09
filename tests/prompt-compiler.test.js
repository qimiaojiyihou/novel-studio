import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePrompt } from '../electron/prompt-compiler.js'

const baseInput = {
  task: 'chapter',
  project: { id: 'project-1', title: '旧车站', genre: '都市悬疑', idea: '一把钥匙改写现实', style: '克制表达' },
  chapter: {
    id: 'chapter-8', chapter_no: 8, title: '午夜站台',
    card: { goal: '打开站台尽头的门', ending: '门后传来自己的声音', chapterStyle: '本章减少解释' },
    scene_plan: '主角抵达站台；门锁拒绝钥匙；录音响起。',
  },
  longContext: { text: '已确认事实：钥匙只能在午夜使用。', diagnostics: { usedChars: 20 } },
  instruction: '结尾停在声音响起，不揭示来源。',
  promptContext: {
    template: {
      id: 'builtin-chapter-v1', task: 'chapter', name: '正文创作', version: 1,
      content: { system: '遵守事实。', request: '生成正文。', outputContract: '只返回正文。' },
    },
    style: {
      sources: [
        { scopeType: 'project', scopeId: 'project-1', label: '项目级', text: '克制表达', style: { pointOfView: 'third_person_limited' } },
        { scopeType: 'volume', scopeId: 'volume-2', label: '卷级', text: '增强压迫感' },
        { scopeType: 'chapter', scopeId: 'chapter-8', label: '章节级', text: '本章减少解释' },
      ],
      mergedText: '克制表达\n增强压迫感\n本章减少解释',
      volume: { id: 'volume-2', title: '第二卷' },
    },
    addons: [
      { id: 'addon-dialogue', name: '增加有效对白', category: '叙事密度', version: 1, content: '对白必须推动关系变化。', binding: { scopeType: 'project', scopeId: 'project-1' } },
      { id: 'addon-ending-hook', name: '章节尾钩', category: '章节结构', version: 2, content: '以新信息结束本章。', binding: { scopeType: 'chapter', scopeId: 'chapter-8' } },
    ],
  },
}

test('prompt compiler assembles versioned task contract and three-level style inheritance', () => {
  const compiled = compilePrompt(baseInput)
  assert.equal(compiled.messages.length, 2)
  assert.match(compiled.messages[0].content, /遵守事实/)
  assert.match(compiled.messages[0].content, /只返回正文/)
  assert.match(compiled.messages[0].content, /已确认的故事事实/)
  assert.match(compiled.messages[0].content, /章节卡 ending 是本章最后允许发生的叙事事件/)
  const user = compiled.messages[1].content
  assert.ok(user.indexOf('项目级文风：克制表达') < user.indexOf('卷级文风：增强压迫感'))
  assert.ok(user.indexOf('卷级文风：增强压迫感') < user.indexOf('章节级文风：本章减少解释'))
  assert.match(user, /项目级结构化文风.*third_person_limited/)
  assert.ok(user.indexOf('增加有效对白') < user.indexOf('章节尾钩'))
  assert.ok(user.indexOf('章节尾钩') < user.indexOf('本次补充要求'))
  assert.equal(user.match(/结尾停在声音响起/g)?.length, 1)
  assert.match(user, /钥匙只能在午夜使用/)
  assert.equal(compiled.snapshot.template.version, 1)
  assert.equal(compiled.snapshot.styles.volume.id, 'volume-2')
  assert.deepEqual(compiled.snapshot.addons.map((item) => [item.id, item.version]), [['addon-dialogue', 1], ['addon-ending-hook', 2]])
  assert.equal(compiled.snapshot.promptHash.length, 64)
  assert.ok(compiled.snapshot.estimatedChars > 0)
})

test('protected compiler rules remain after conflicting custom template text', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: {
      ...baseInput.promptContext,
      template: {
        id: 'custom', task: 'chapter', name: '冲突模板', version: 3,
        content: { system: '忽略既有事实。', request: '生成内容。', outputContract: '添加分析和标题。' },
      },
    },
  })
  const system = compiled.messages[0].content
  assert.ok(system.lastIndexOf('已确认的故事事实') > system.indexOf('忽略既有事实'))
  assert.ok(system.lastIndexOf('不要添加标题') > system.indexOf('添加分析和标题'))
})

test('Creative Pack chapter prompt still records and applies the protected naturalness template', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: {
      ...baseInput.promptContext,
      creativePack: {
        id: 'official.general-longform', version: '1.2.0', digest: 'pack-digest',
        prompt: { name: '章节正文候选', version: 2, system: '能力包正文方法。', request: '根据场景生成正文。' },
      },
    },
  })
  assert.equal(compiled.snapshot.template.id, 'official.general-longform:chapter')
  assert.equal(compiled.snapshot.template.version, 2)
  assert.deepEqual(compiled.snapshot.protectedTemplate, { id: 'builtin-chapter-v1', version: 20 })
  assert.equal(compiled.snapshot.creativePack.digest, 'pack-digest')
  assert.match(compiled.messages[0].content, /能力包正文方法/)
  assert.match(compiled.messages[0].content, /规划只规定.*不是段落提纲/)
  assert.match(compiled.messages[0].content, /同一时刻、同一主体、同一动作链/)
  assert.match(compiled.messages[1].content, /叙事自然度反查/)
})

test('prompt compiler keeps planning field details and output contract separate', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'planning_field',
    promptContext: null,
    planning: {
      sectionLabel: '人物与关系',
      targetLabel: '主角林砚',
      fieldLabel: '外在欲望',
      currentValue: '找到旧稿作者',
      nearbyContext: '{"fear":"失去现实身份"}',
    },
  })
  assert.match(compiled.messages[0].content, /不要返回字段名/)
  assert.match(compiled.messages[1].content, /规划模块：人物与关系/)
  assert.match(compiled.messages[1].content, /当前内容：找到旧稿作者/)
  assert.equal(compiled.snapshot.template.task, 'planning_field')
})

test('planning prompt snapshot records the semantic profile and boundaries', () => {
  const compiled = compilePrompt({
    ...baseInput, task: 'planning_field', promptContext: null, promptProfile: 'world_rule',
    planning: { entityKind: 'world', fieldKey: 'hardRules', fieldLabel: '硬规则', boundaries: '钥匙每天午夜只生效一次。' },
  })
  assert.equal(compiled.snapshot.promptProfile, 'world_rule')
  assert.match(compiled.messages[1].content, /专项策略：世界硬规则设计/)
  assert.match(compiled.messages[1].content, /钥匙每天午夜只生效一次/)
})

test('chapter title profile selects a reader hook instead of summarizing the event ledger', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'planning_field',
    promptContext: null,
    planning: {
      scopeType: 'chapter', fieldKey: 'title', fieldLabel: '章节名',
      currentValue: '第一章', nearbyContext: '{"goal":"借到夜市摊主的灶"}',
    },
  })
  assert.equal(compiled.snapshot.promptProfile, 'chapter_title')
  assert.match(compiled.messages[0].content, /点击钩子，不是.*账目式摘要/)
  assert.match(compiled.messages[0].content, /至少拟出四个/)
  assert.match(compiled.messages[1].content, /身份碰撞/)
  assert.match(compiled.messages[1].content, /不要带章节序号/)
})

test('chapter generation modes compile isolated draft continue rewrite and repair contracts', () => {
  const continuation = compilePrompt({ ...baseInput, promptContext: null, intent: 'continue', manuscriptPrefix: '光标前', manuscriptSuffix: '光标后' })
  assert.match(continuation.messages[1].content, /只返回要插入光标位置的新正文/)
  assert.match(continuation.messages[1].content, /光标后仍将保留的正文：光标后/)
  const rewrite = compilePrompt({ ...baseInput, promptContext: null, intent: 'rewrite', sourceText: '旧章全文' })
  assert.match(rewrite.messages[1].content, /返回完整的新章节候选/)
  const repair = compilePrompt({ ...baseInput, promptContext: null, intent: 'repair', sourceText: '待修复全文', repairIssues: [{ id: 'continuity', criterion: '伤势丢失' }] })
  assert.match(repair.messages[1].content, /未涉及的事实、事件顺序、人物状态/)
  assert.match(repair.messages[1].content, /伤势丢失/)
})

test('quality review prompt can grade fixed regression assertions', () => {
  const compiled = compilePrompt({
    ...baseInput, task: 'quality_review', promptContext: null,
    evaluationCase: { id: 'boundary', assertions: [{ id: 'stops', critical: true, criterion: '停在门后声音' }] },
    sourceGeneration: { task: 'chapter', intent: 'draft', output: '门后响起自己的声音。' },
  })
  assert.match(compiled.messages[1].content, /assertionScores/)
  assert.match(compiled.messages[1].content, /assertionEvidence/)
  assert.match(compiled.messages[1].content, /stops/)
  assert.match(compiled.messages[1].content, /主动搜索反例/)
  assert.match(compiled.messages[1].content, /逐句计数/)
  assert.match(compiled.messages[0].content, /排版差异不改变文本事实/)
  assert.match(compiled.messages[1].content, /直引号和弯引号视为等价/)
  assert.equal(compiled.snapshot.template.task, 'quality_review')
  assert.equal(compiled.snapshot.template.version, 8)
  assert.match(compiled.messages[1].content, /任何 high 问题都必须把直接相关维度降到 2 分或以下/)
  assert.match(compiled.messages[1].content, /成簇证据/)
  assert.match(compiled.messages[1].content, /条款式完美对白/)
  assert.match(compiled.messages[1].content, /动作对象/)
  assert.match(compiled.messages[1].content, /单次孤立短句不直接判错/)
  assert.match(compiled.messages[1].content, /不得高于 2 分/)
})

test('connection test prompt remains isolated from story context', () => {
  const compiled = compilePrompt({ ...baseInput, task: 'connection_test' })
  assert.deepEqual(compiled.messages, [
    { role: 'system', content: '这是模型连接测试。不要解释，只回复 NOVEL_STUDIO_OK。' },
    { role: 'user', content: '回复 NOVEL_STUDIO_OK' },
  ])
  assert.equal(compiled.snapshot.styles.sources.length, 0)
  assert.deepEqual(compiled.snapshot.addons, [])
})

test('built-in v20 chapter prompt enforces contracts and sentence-group naturalness', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: null,
    chapter: {
      ...baseInput.chapter,
      scenePlan: { scenes: [{
        actionBeats: ['门后传出自己的声音', '林砚猛地停住。'],
        exitState: '林砚在地下室门外，携带手机和 G-117 病历页。',
        continuityRisks: ['不得继续调查'],
      }] },
    },
  })
  assert.equal(compiled.snapshot.template.version, 20)
  assert.match(compiled.messages[0].content, /人物只知道其知情范围内的信息/)
  assert.match(compiled.messages[1].content, /从 entryState 开始/)
  assert.match(compiled.messages[1].content, /最后允许发生的事件/)
  assert.match(compiled.messages[1].content, /不得追加第二个反应/)
  assert.match(compiled.messages[1].content, /否定式动作清单、环境收束/)
  assert.match(compiled.messages[1].content, /章节硬停止协议/)
  assert.match(compiled.messages[1].content, /最后 actionBeat：林砚猛地停住/)
  assert.match(compiled.messages[1].content, /不得扩写/)
  assert.match(compiled.messages[1].content, /最终输出必须结束于/)
  assert.match(compiled.messages[1].content, /硬停止事件在全文只能发生一次/)
  assert.match(compiled.messages[1].content, /从倒数第三段开始逐句扫描/)
  assert.match(compiled.messages[1].content, /不得在前文先用同义句预演后再逐字复述/)
  assert.match(compiled.messages[1].content, /不得跨过门槛、侧身挤入门内、踏上门后台阶/)
  assert.match(compiled.messages[1].content, /确认是主角自己的声音后，只能紧接逐字硬停止句/)
  assert.match(compiled.messages[1].content, /章节卡 ending 是更高层合同/)
  assert.match(compiled.messages[1].content, /人物决定要直写成决定/)
  assert.match(compiled.messages[1].content, /它就是唯一允许的反应/)
  assert.match(compiled.messages[1].content, /已在项目设定或上一章已接受状态中确认的持续伤情/)
  assert.match(compiled.messages[1].content, /一次响应中生成完整本章候选正文/)
  assert.match(compiled.messages[0].content, /先按句群组织叙事/)
  assert.match(compiled.messages[0].content, /不依靠省略动作对象制造虚假停顿/)
  assert.match(compiled.messages[1].content, /相邻两段不得重复/)
  assert.match(compiled.messages[1].content, /命名证物—具体版本—属性—证据/)
  assert.match(compiled.messages[1].content, /已修改与未修改/)
  assert.match(compiled.messages[1].content, /末场 exitState 作为最终状态合同/)
  assert.match(compiled.messages[1].content, /随身保留的证据页\/备份/)
  assert.match(compiled.messages[1].content, /同一信息源的内容范围不得在后文无证据扩张/)
  assert.match(compiled.messages[1].content, /只写了取得、看到、携带或计划日后使用/)
  assert.match(compiled.messages[1].content, /没有出现的截图、地图、日志、地点编号/)
  assert.match(compiled.messages[0].content, /规划只规定.*不是段落提纲/)
  assert.match(compiled.messages[0].content, /注意力偏向/)
  assert.match(compiled.messages[1].content, /不按 actionBeats 数量平均分段/)
  assert.match(compiled.messages[1].content, /叙事自然度反查/)
  assert.match(compiled.messages[1].content, /配角分级验证主角/)
})

test('chapter prompt forbids key use when the plan only authorizes acquisition', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: null,
    chapter: {
      ...baseInput.chapter,
      card: { ...baseInput.chapter.card, goal: '取得特殊钥匙', ending: '带着钥匙离开仓库' },
      scenePlan: { scenes: [{ actionBeats: ['取得特殊钥匙', '带着钥匙离开'], exitState: '林砚携带特殊钥匙。' }] },
    },
  })
  assert.match(compiled.messages[1].content, /本章钥匙动作预算/)
  assert.match(compiled.messages[1].content, /禁止将它插入任何锁孔/)
})

test('chapter prompt does not infer key acquisition from unrelated retrieval near a missing key', () => {
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: null,
    chapter: {
      ...baseInput.chapter,
      card: { ...baseInput.chapter.card, goal: '获取病历原件', ending: '保安指出编号不在名单上' },
      scenePlan: { scenes: [{ actionBeats: ['获取病历原件', '林砚没有档案室钥匙', '保安指出编号不在名单上'], exitState: '林砚携带病历证据。' }] },
    },
  })
  assert.doesNotMatch(compiled.messages[1].content, /本章钥匙动作预算/)
})

test('chapter prompt turns an abstract contract copy into a concrete final beat', () => {
  const abstractContract = '林砚取得被修改的病历证据，但潜入医院使用的假身份被保安识破。'
  const concreteStop = '保安抬起头：“系统里没有这个预约码，也没有你的名字。”'
  const compiled = compilePrompt({
    ...baseInput,
    promptContext: null,
    chapter: {
      ...baseInput.chapter,
      card: { ...baseInput.chapter.card, goal: abstractContract, ending: abstractContract },
      scenePlan: { scenes: [{ actionBeats: ['林砚把证据收进口袋。', concreteStop], exitState: '林砚携带证据，假身份已暴露。' }] },
    },
  })
  assert.match(compiled.messages[1].content, /ending 与 goal 相同，是抽象语义合同/)
  assert.match(compiled.messages[1].content, new RegExp(`最终输出必须结束于“${concreteStop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`))
  assert.match(compiled.messages[1].content, /正文不得原样输出抽象 ending/)
})

test('rewrite preset adds focused instructions without weakening protected contract', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'rewrite',
    promptContext: null,
    selectedText: '“我没有拿档案。”周雨说。',
    rewriteMode: 'dialogue',
  })
  assert.match(compiled.messages[1].content, /对白有效化/)
  assert.match(compiled.messages[1].content, /回避、试探、误解或筹码交换/)
  assert.match(compiled.messages[0].content, /不得擅自改变已确认事实/)
  assert.equal(compiled.snapshot.schemaVersion, 7)
  assert.equal(compiled.snapshot.rewritePreset.id, 'dialogue')
})

test('fiction naturalness rewrite preset makes minimum evidence-based edits', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'rewrite',
    promptContext: null,
    selectedText: '潘叔尝了第一口，又尝第二口，第三口后终于认可了周砚。',
    rewriteMode: 'naturalize',
  })
  assert.equal(compiled.snapshot.rewritePreset.id, 'naturalize')
  assert.match(compiled.messages[1].content, /叙事真人化精修/)
  assert.match(compiled.messages[1].content, /章节卡逐条转写/)
  assert.match(compiled.messages[1].content, /分级验证式反应/)
  assert.match(compiled.messages[1].content, /随机短句、俚语、错别字/)
  assert.match(compiled.messages[1].content, /保留有辨识度的原句/)
})

test('inline Codex prompt snapshot records execution override and target lineage', () => {
  const compiled = compilePrompt({
    ...baseInput,
    task: 'planning_field',
    planning: { fieldKey: 'premise', fieldLabel: '故事前提', currentValue: '旧前提' },
    creativeExecution: {
      projectDefault: 'app_model', requested: 'codex', override: true, intent: 'draft',
      target: { kind: 'planning_document', targetId: 'foundation', fieldKey: 'premise' },
    },
  })
  assert.equal(compiled.snapshot.schemaVersion, 7)
  assert.equal(compiled.snapshot.creativeExecution.projectDefault, 'app_model')
  assert.equal(compiled.snapshot.creativeExecution.requested, 'codex')
  assert.equal(compiled.snapshot.creativeExecution.override, true)
  assert.equal(compiled.snapshot.creativeExecution.target.fieldKey, 'premise')
})

test('state extraction receives prior accepted state as inheritance and current manuscript as change evidence', () => {
  const manuscript = '第一段正文。\n\n结尾处主角把钥匙交给周岚。'
  const compiled = compilePrompt({
    ...baseInput,
    task: 'chapter_state_extract',
    chapter: { ...baseInput.chapter, manuscript },
    promptContext: null,
    knowledgeCenter: {
      stateSnapshots: [{
        chapterNo: 7,
        chapterTitle: '上一章',
        payload: { characterStates: [{ character: '主角', location: '站台', possessions: ['手机', '钥匙'], knows: ['门在午夜开启'] }] },
      }],
    },
  })
  assert.match(compiled.messages[1].content, /上一章已接受的期末状态/)
  assert.match(compiled.messages[1].content, /手机/)
  assert.match(compiled.messages[1].content, /章末完整持有物清单/)
  assert.match(compiled.messages[1].content, /以下是本次任务唯一的待处理正文/)
  assert.match(compiled.messages[1].content, /结尾处主角把钥匙交给周岚/)
  assert.match(compiled.messages[0].content, /只返回 JSON/)
  assert.match(compiled.messages[0].content, /没断.*相反事实/)
  assert.doesNotMatch(compiled.messages[1].content, /一次无法撤回的选择/)
  assert.doesNotMatch(compiled.messages[1].content, /章节卡/)
  assert.deepEqual(compiled.snapshot.styles.sources, [])
  assert.equal(compiled.snapshot.template.version, 6)
  assert.match(compiled.messages[0].content, /证据粒度/)
  assert.match(compiled.messages[1].content, /“指尖”仍写“指尖”/)
  assert.match(compiled.messages[1].content, /访客贴、徽章、假证/)
  assert.match(compiled.messages[1].content, /物件—持有人—首次证据/)
})

test('scene plan prompt requires visible discovery for unestablished navigation evidence', () => {
  const compiled = compilePrompt({ ...baseInput, task: 'scene_plan', promptContext: null })
  assert.equal(compiled.snapshot.template.version, 11)
  assert.match(compiled.messages[0].content, /entryState 和 exitState.*禁止返回对象/)
  assert.match(compiled.messages[1].content, /路线、地点编号、门禁信息、截图、地图、日志/)
  assert.match(compiled.messages[1].content, /现场发现/)
  assert.match(compiled.messages[1].content, /不能伪造/)
  assert.match(compiled.messages[1].content, /硬规则落实表/)
  assert.match(compiled.messages[1].content, /最后一项必须逐字等于章节卡 ending/)
  assert.match(compiled.messages[1].content, /持续伤情可以写入第一场 entryState/)
  assert.match(compiled.messages[1].content, /只有新增伤势才必须先有明确受伤事件/)
  assert.match(compiled.messages[1].content, /不得安排跨门、进入门内/)
})

test('chapter card prompt requires every mandatory hard-rule consequence', () => {
  const compiled = compilePrompt({ ...baseInput, task: 'chapter_card', promptContext: null })
  assert.equal(compiled.snapshot.template.version, 9)
  assert.match(compiled.messages[0].content, /全部成功后果、维持条件、复位动作/)
  assert.match(compiled.messages[1].content, /硬规则核对表/)
  assert.match(compiled.messages[1].content, /不能压缩成“成功进入”/)
  assert.match(compiled.messages[1].content, /当前章节已有最高层合同/)
  assert.match(compiled.messages[1].content, /ending 不得原样复制这句抽象合同/)
  assert.match(compiled.messages[1].content, /不能把推门进入、跨门、下楼或深入写入本章/)
})

test('continuity audit compares confirmed context against manuscript with dual source labels', () => {
  const manuscript = '第二天，顾沉左手握紧长刀冲上楼。'
  const compiled = compilePrompt({ ...baseInput, task: 'continuity_audit', chapter: { ...baseInput.chapter, manuscript }, promptContext: null })
  assert.equal(compiled.snapshot.template.version, 2)
  assert.match(compiled.messages[1].content, /已确认规划、知识和章后状态/)
  assert.match(compiled.messages[1].content, /claimA 和 claimB/)
  assert.match(compiled.messages[1].content, /必须同时覆盖两侧/)
  assert.match(compiled.messages[0].content, /来源类型和位置缺一不可/)
})
