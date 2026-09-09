export const foundationFields = [
  { key: 'audience', label: '目标读者', hint: '这本书主要写给谁', placeholder: '例如：喜欢事业升级与轻悬疑的网文读者', type: 'input' },
  { key: 'lengthTarget', label: '篇幅目标', hint: '总字数、卷数或连载节奏', placeholder: '例如：120 万字，6 卷，每卷一个事业阶段', type: 'input' },
  { key: 'pov', label: '叙事视角', hint: '视角和时态约束', placeholder: '例如：第三人称限知，主要跟随主角', type: 'input' },
  { key: 'premise', label: '故事前提', hint: '谁在什么局面下必须做什么', placeholder: '用两三句话说清故事成立的起点', type: 'textarea', wide: true },
  { key: 'coreConflict', label: '核心冲突', hint: '全书持续施压的两难', placeholder: '主角想要什么，为什么越接近目标代价越大', type: 'textarea', wide: true },
  { key: 'storyPromise', label: '阅读承诺', hint: '读者会持续得到什么体验', placeholder: '例如：每次事业胜利都会揭开一层旧事，并带来更具体的现实代价', type: 'textarea', wide: true },
  { key: 'themes', label: '主题母题', hint: '反复被人物选择检验的问题', placeholder: '例如：成功是否值得拿旧承诺交换', type: 'textarea' },
  { key: 'tone', label: '氛围基调', hint: '故事整体的情绪温度', placeholder: '例如：轻松表层下保持现实压力，关键选择不回避代价', type: 'textarea' },
  { key: 'endingDirection', label: '结局方向', hint: '不必写细节，先确定终点性质', placeholder: '主角最终得到什么、失去什么、变成怎样的人', type: 'textarea' },
  { key: 'boundaries', label: '创作边界', hint: '全书必须遵守或避免的规则', placeholder: '不使用的套路、必须保留的设定、不可越过的表达边界', type: 'textarea' },
]

export const worldOverviewFields = [
  { key: 'era', label: '时代与时间', hint: '年代、时间尺度与现实偏移', placeholder: '故事发生在何时，和现实世界有何不同', type: 'textarea' },
  { key: 'geography', label: '空间结构', hint: '主要区域、距离和移动成本', placeholder: '核心城市、地点层级以及它们如何相互连接', type: 'textarea' },
  { key: 'society', label: '社会与秩序', hint: '权力如何分配，普通人如何生活', placeholder: '阶层、组织、行业规则和公开秩序', type: 'textarea' },
  { key: 'powerSystem', label: '能力与资源体系', hint: '人物可以调用什么力量', placeholder: '能力、技术、资源或行业筹码的获取方式', type: 'textarea' },
  { key: 'hardRules', label: '硬规则', hint: '剧情中始终成立的世界事实', placeholder: '写成能判断真假的规则，避免只写氛围词', type: 'textarea', wide: true },
  { key: 'costs', label: '代价与限制', hint: '使用能力或破坏规则会发生什么', placeholder: '明确代价由谁承担、何时兑现', type: 'textarea' },
  { key: 'dailyLife', label: '日常质感', hint: '让世界在非剧情时也能运转', placeholder: '衣食住行、交流方式、工作与娱乐', type: 'textarea' },
  { key: 'history', label: '共同历史', hint: '仍在影响现在的过去', placeholder: '只记录会改变人物选择和当前秩序的历史', type: 'textarea', wide: true },
]

export const outlineFields = [
  { key: 'logline', label: '总纲一句话', hint: '主角、目标、阻力与代价', placeholder: '一句话说清全书的行动链', type: 'textarea', wide: true },
  { key: 'opening', label: '开局常态', hint: '变化发生前，主角困在哪里', placeholder: '建立人物当前生活与缺口', type: 'textarea' },
  { key: 'incitingIncident', label: '诱发事件', hint: '让主角不能继续维持原状', placeholder: '具体事件如何进入人物生活', type: 'textarea' },
  { key: 'firstTurn', label: '第一次转向', hint: '主角主动进入主线', placeholder: '哪一个选择让故事正式不可逆', type: 'textarea' },
  { key: 'midpoint', label: '中点变化', hint: '认知、目标或权力关系翻转', placeholder: '主角发现此前理解错了什么', type: 'textarea' },
  { key: 'crisis', label: '危机与最低点', hint: '旧办法彻底失效', placeholder: '失去什么，为什么不能回到开局', type: 'textarea' },
  { key: 'climax', label: '高潮选择', hint: '人物用最终选择回答主题', placeholder: '主角做什么，而不只是发生了什么', type: 'textarea' },
  { key: 'ending', label: '结局兑现', hint: '外部结果与人物变化', placeholder: '承诺兑现到什么程度，留下什么余味', type: 'textarea' },
  { key: 'thematicArc', label: '主题变化线', hint: '人物对核心问题的答案如何改变', placeholder: '从开局信念写到结局信念', type: 'textarea', wide: true },
]

export const entityFields = {
  character: [
    { key: 'role', label: '故事角色', hint: '主角、对手、导师、盟友等', placeholder: '这个人在结构中承担什么作用', type: 'input' },
    { key: 'identity', label: '身份与处境', hint: '公开身份和当前生活状态', placeholder: '职业、资源、社会位置与眼下困境', type: 'textarea' },
    { key: 'desire', label: '外在欲望', hint: '人物会主动追逐的可见目标', placeholder: '必须能转化为行动', type: 'textarea' },
    { key: 'need', label: '内在需要', hint: '人物尚未承认的变化方向', placeholder: '他真正需要学会、放下或接受什么', type: 'textarea' },
    { key: 'fear', label: '恐惧与底线', hint: '人物最想避免的损失', placeholder: '什么会让他改变策略甚至背叛原则', type: 'textarea' },
    { key: 'flaw', label: '缺陷与惯性', hint: '反复制造问题的应对方式', placeholder: '不要只写性格词，写它如何造成后果', type: 'textarea' },
    { key: 'secret', label: '秘密与知情范围', hint: '他隐瞒什么、知道什么', placeholder: '秘密何时可能暴露，谁已经接近真相', type: 'textarea' },
    { key: 'arc', label: '人物弧', hint: '从开局状态到结局状态', placeholder: '信念、关系或行动方式如何改变', type: 'textarea', wide: true },
    { key: 'voice', label: '说话与行为辨识度', hint: '语言节奏、习惯动作和回避方式', placeholder: '让人物不依赖名字也能被认出', type: 'textarea' },
    { key: 'speechPurpose', label: '说话目的', hint: '可选：此人说话常在争取或掩饰什么', type: 'textarea', optional: true },
    { key: 'socialMask', label: '社交面具', hint: '可选：对外形象与真实顾虑的距离', type: 'textarea', optional: true },
    { key: 'languageHabits', label: '语言习惯', hint: '可选：惯用词、停顿、回避与改口', type: 'textarea', optional: true },
    { key: 'speechTaboos', label: '语言禁区', hint: '可选：哪些事不主动说、对谁不说', type: 'textarea', optional: true },
    { key: 'relationships', label: '关键关系', hint: '对象、表面关系、真实张力', placeholder: '每行写一段关系及其当前变化方向', type: 'textarea', wide: true },
  ],
  world: [
    { key: 'category', label: '设定类型', hint: '地点、组织、规则、物件或历史', placeholder: '例如：地点', type: 'input' },
    { key: 'summary', label: '核心说明', hint: '这个设定是什么', placeholder: '用具体事实说明，而不是百科式介绍', type: 'textarea', wide: true },
    { key: 'rules', label: '成立规则', hint: '它如何运作、什么情况下失效', placeholder: '列出剧情必须遵守的判断条件', type: 'textarea' },
    { key: 'storyUse', label: '剧情用途', hint: '它会迫使人物做什么', placeholder: '与冲突、选择和结果建立联系', type: 'textarea' },
    { key: 'connections', label: '关联对象', hint: '人物、地点、组织和事件', placeholder: '写清它与其他设定的连接', type: 'textarea' },
    { key: 'constraints', label: '连续性约束', hint: '后文不可随意改变的事实', placeholder: '记录容易写错的边界与例外', type: 'textarea', wide: true },
  ],
  volume: [
    { key: 'chapterRange', label: '章节范围', hint: '预计覆盖的章节或字数', placeholder: '例如：第 1—45 章 / 18 万字', type: 'input' },
    { key: 'goal', label: '本卷目标', hint: '卷末可以判断成败的目标', placeholder: '主角在这一阶段具体要完成什么', type: 'textarea' },
    { key: 'conflict', label: '主要阻力', hint: '持续施压的对手与条件', placeholder: '为什么不能用一个动作解决', type: 'textarea' },
    { key: 'arc', label: '阶段变化', hint: '人物、关系和局势如何移动', placeholder: '从卷首状态到卷末状态', type: 'textarea', wide: true },
    { key: 'turn', label: '卷中转折', hint: '改变原计划的关键发现或失败', placeholder: '让后半卷必须使用新策略', type: 'textarea' },
    { key: 'ending', label: '卷末兑现', hint: '回报、代价与下卷入口', placeholder: '完成什么，又制造了什么更大问题', type: 'textarea' },
    { key: 'volumeStyle', label: '卷级文风', hint: '只在本卷生效的节奏与氛围', placeholder: '继承项目文风，并说明本卷需要覆盖的部分', type: 'textarea', wide: true },
  ],
}

export const chapterPlanFields = [
  { key: 'goal', label: '本章合同', hint: '这一章必须完成的变化', placeholder: '章末回看时能明确判断是否完成', type: 'textarea', wide: true },
  { key: 'protagonistGoal', label: '主角目标', hint: '进入本章时主动想完成什么', placeholder: '写成可见行动', type: 'textarea' },
  { key: 'resistance', label: '主要阻力', hint: '谁或什么持续阻止行动', placeholder: '阻力要能迫使人物调整策略', type: 'textarea' },
  { key: 'turningPoint', label: '本章转折', hint: '信息、关系或局势的不可逆变化', placeholder: '转折之后不能照原计划继续', type: 'textarea' },
  { key: 'payoff', label: '本章回报', hint: '兑现给读者的进展或答案', placeholder: '回应此前期待，不必一次解释完', type: 'textarea' },
  { key: 'cost', label: '本章代价', hint: '取得进展后失去什么', placeholder: '让成功也改变后续选择空间', type: 'textarea' },
  { key: 'ending', label: '结尾合同', hint: '下一章可以直接承接的动作或问题', placeholder: '停在具体变化上，而不是泛泛悬念', type: 'textarea', wide: true },
  { key: 'chapterStyle', label: '章节级文风', hint: '只覆盖当前章节的表达要求', placeholder: '例如：减少解释，以对话与现场动作推进', type: 'textarea', wide: true },
  { key: 'scenePlan', label: '场景计划', hint: '按场景写目标、阻力、行动和变化', placeholder: '每个场景都要改变人物或局势', type: 'textarea', wide: true, tall: true, special: true },
]

export const sectionMeta = {
  foundation: { eyebrow: 'STORY DNA', title: '故事基础', description: '把一个想法变成全书持续成立的创作合同。' },
  characters: { eyebrow: 'CAST FILES', title: '人物与关系', description: '记录人物欲望、秘密、变化和彼此之间的真实张力。' },
  world: { eyebrow: 'WORLD LEDGER', title: '世界观', description: '把世界写成会约束行动的规则，而不是只供浏览的百科。' },
  outline: { eyebrow: 'STORY SPINE', title: '结构规划', description: '从全书转折到分卷和章节合同，建立可执行的故事骨架。' },
}
