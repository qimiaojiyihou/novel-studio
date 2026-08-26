import { resolveRewritePreset } from './prompt-templates.js'
import { QUALITY_DIMENSIONS } from './creative-quality.js'

const now = () => new Date().toISOString()

export function generateMock({ task, project, chapter, planning = {}, instruction = '', selectedText = '', rewriteMode = '局部重写', modelProfile, evaluationCase = null }) {
  const title = project?.title || '未命名小说'
  const chapterTitle = chapter?.title || '新的章节'
  const idea = project?.idea || '一个普通人被迫走上改变命运的道路。'
  const custom = instruction.trim() ? `\n补充要求：${instruction.trim()}` : ''
  const model = {
    profileId: modelProfile?.id || 'mock-provider',
    provider: modelProfile?.provider || 'mock',
    name: modelProfile?.name || 'MockProvider',
    model: modelProfile?.model || 'mock-v0.1',
  }

  if (task === 'planning_field') {
    if (['documentBundle', 'entityBundle', 'chapterBundle'].includes(planning.fieldKey)) {
      let requestedFields = []
      try { requestedFields = JSON.parse(planning.nearbyContext || '{}').requestedFields || [] } catch { requestedFields = [] }
      const samples = {
        title: '周砚', role: '主动推进事业主线的核心主角', identity: '处于事业低谷、资源有限，却拥有可公开验证的职业技能',
        desire: '靠一次次亲手解决真实难题，取得稳定收入、行业认可和不可替代的位置',
        need: '学会把个人能力转化为可持续的合作与责任，而不是独自扛下所有问题',
        fear: '再次因为一次公开失败失去选择权，并连累愿意相信自己的人',
        flaw: '习惯先动手解决问题再解释，短期高效，却常让盟友误判他的计划与风险',
        secret: '曾主动放弃过一次足以改变职业轨迹的机会，真实原因只被一名旧同行知晓',
        arc: '从只证明自己有用，逐步走向建立团队、承担承诺，并主动定义自己的行业位置',
        voice: '说话短而具体，先问条件和结果；紧张时整理工具，回避情绪问题时会转向现场细节',
        relationships: '与关键伙伴从互相利用走向有限信任；与旧同行围绕三年前的选择保持未结张力',
        category: '会持续影响人物行动的核心设定', summary: '一个会限制选择并制造可验证后果的稳定事实',
        rules: '只有满足公开条件时才生效；失败不会被隐藏，而会立刻改变资源与关系',
        storyUse: '迫使主角在短期成果与长期承诺之间做出具体选择', connections: '连接主角、关键伙伴、行业组织与阶段性任务',
        constraints: '触发条件、使用次数和失败后果不得在后续章节临时改写',
        chapterRange: '第 1—45 章 / 约 18 万字', goal: '完成一个可以在卷末明确判断成败的事业目标',
        conflict: '资源、时间与对手共同施压，任何捷径都会增加后续代价', turn: '阶段性胜利暴露此前判断中的关键错误，迫使主角更换策略',
        ending: '兑现本卷核心回报，同时让成功产生一个必须在下一卷处理的新问题',
        volumeStyle: '延续项目文风，以短周期任务和现场行动推进，卷末收紧情绪与代价。',
        protagonistGoal: '主角主动取得一项能够改变当前局面的具体成果',
        resistance: '时间、资源和关键人物的保留共同阻止主角按原计划推进',
        turningPoint: '一次现场反馈证明原方案会造成更大损失，主角必须立即更换策略',
        payoff: '兑现前文的一项期待，并让成果获得现场人物的公开确认',
        cost: '主角为了完成交付增加现实投入，也欠下一个必须在后文偿还的承诺',
        chapterStyle: '减少解释，用现场动作、对话与即时反馈推进；章尾停在可直接承接的具体变化上',
        scenePlan: '场景一：主角带着明确目标进入现场，资源不足迫使他先争取开工条件；场景二：执行中出现会改变工序的阻力，主角依据已知线索调整策略；场景三：成果接受公开验收，同时落下现实代价和下一章行动入口。',
        audience: '偏好人物主动解决具体问题、重视成长反馈与长期因果兑现的中文长篇读者',
        lengthTarget: '约 120 万字，分 6 卷推进，每卷形成独立阶段目标与代价', pov: '第三人称限知，以主角为核心视角',
        premise: `${idea}，主角必须把意外获得的机会转化为一次可以公开验收的行动。`,
        coreConflict: '主角越接近事业自主权，越必须在个人控制、团队信任和现实责任之间作出不可撤回的选择',
        storyPromise: '持续提供具体任务、现场阻力、可验证成果与阶段翻盘，并让每次成功改变后续资源和关系',
        themes: '个人能力怎样转化为长期信用；接受帮助是否意味着失去主动权', tone: '轻松表层下保留现实压力，幽默来自人物与处境',
        endingDirection: '主角获得定义事业方向的权力，也接受成果不再只属于个人高光', boundaries: '不靠无代价巧合解决核心冲突；每项能力都必须经过行动与结果验收',
        era: '近现代平行世界，时间与现实同步，文化产业细节存在可追踪偏移', geography: '以核心城市为中心，工作地点、演出现场和行业机构通过明确交通与时间成本连接',
        society: '平台、公司、客户与观众共同分配机会，私人资源只提供入口，公开成果决定长期位置', powerSystem: '职业技能、作品记忆、团队资源和行业信用构成可积累但各有边界的能力体系',
        hardRules: '技能只能解决专业操作，不能自动提供资质、材料、客户或市场认可；现实损失必须由人物承担', costs: '超出体力、预算、工期或权限边界会造成返工、违约、关系受损和机会流失',
        dailyLife: '收入、通勤、排练、采购、合同和直播反馈持续影响人物选择', history: '原公司放弃主角的旧决定仍控制当前合约、公众评价和关键关系',
        logline: '处于事业低谷的主角获得连续解决现实难题的机会，为夺回选择权，他必须把个人本事变成经得起公开验收的作品与团队信用',
        opening: '主角缺少收入与资源，旧身份带来关注却不能换来稳定机会', incitingIncident: '一次必须当场完成并公开验收的职业任务进入他的生活',
        firstTurn: '主角主动接受条件并把结果放到公众面前，从此不能退回旁观位置', midpoint: '阶段胜利证明能力有效，却暴露个人包办已经成为更大项目的单点风险',
        crisis: '能力、档期或资源突然失效，因信息和权限过度集中导致团队交付受损', climax: '主角把关键高光交给更合适的人，自己承担协调、验收和总结果',
        thematicArc: '从必须让所有事离不开自己，走向让合适的人拥有完成事情所需的信息、权限与责任',
      }
      if (planning.fieldKey === 'documentBundle' && planning.scopeType === 'outline') {
        samples.ending = '主角建立不依赖个人无限兜底的事业与团队规则，得到选择权，也承担长期兑现承诺的责任'
      }
      if (planning.fieldKey === 'chapterBundle') {
        samples.goal = `让主角在“${chapterTitle}”中完成一个可验证的行动，并让结果改变下一章的选择空间`
        samples.ending = '停在新结果已经落地、主角必须立刻采取下一步行动的具体瞬间'
      }
      return {
        task,
        model,
        generatedAt: now(),
        text: JSON.stringify({ fields: Object.fromEntries(requestedFields.map((field) => [field.key, samples[field.key] || `${field.label}需要连接当前目标、现实阻力和后续可验证结果。`])) }),
      }
    }
    if (planning.fieldKey === 'foundationBundle') {
      return {
        task,
        model,
        generatedAt: now(),
        text: JSON.stringify({
          foundation: {
            premise: `${idea}，但每次接近目标都会迫使主角兑现更具体的旧承诺。`,
            storyPromise: '用人物行动持续推进目标、秘密与代价，并在每章留下可承接的状态变化。',
            coreConflict: '主角必须借助自己不信任的规则取得胜利，同时守住不愿交换的底线。',
            audience: '偏好人物主动推进与连续悬念的长篇读者', lengthTarget: '长篇连载', themes: '成功与承诺',
            tone: '克制、具体', endingDirection: '外部目标兑现，但人物必须承认选择造成的损失。', boundaries: '事实可追溯，关键规则不临时改写。',
          },
          mainCharacter: {
            title: '主角', role: '主角', identity: '被行业忽视、资源有限的行动者', desire: '取得不可被归因于运气的公开成功',
            need: '承认合作与承诺都需要自己承担后果', fear: '再次失去选择权', flaw: '习惯独自承担并隐瞒代价',
            secret: '三年前主动放弃过一次成名机会', arc: '从防御性旁观走向主动承担', voice: '短句、先观察再回应', relationships: '',
          },
          world: {
            era: '当代', geography: '核心城市与行业场所', society: '公开结果决定资源流向', powerSystem: '作品、声誉、合同与人际承诺',
            hardRules: '关键机会必须通过可追溯的公开结果兑现，私人承诺只能换入口，不能直接换胜利。',
            costs: '每次调用关系或规则都会压缩后续选择，并由具体人物承担。', dailyLife: '工作、通勤与行业沟通保持现实成本', history: '三年前的失败仍在影响当前关系。',
          },
          outline: {
            logline: '被行业遗忘的年轻人得到危险的回归机会，为证明自己仍有资格站在台前，必须在成功与旧承诺之间连续做出不可撤回的选择。',
            opening: '主角在边缘位置维持低风险生活。', incitingIncident: '一份与三年前有关的机会主动找上门。',
            firstTurn: '主角公开接受条件，失去继续旁观的资格。', midpoint: '阶段性胜利证明规则有效，也暴露承诺的真正代价。',
            secondTurn: '主角发现最终目标与保护旧关系不能同时完成。', climax: '主角主动选择承担损失并完成最终行动。',
            ending: '公开结果兑现，人物关系以新的边界继续。', thematicArc: '从把成功视为摆脱过去，到承认成功也意味着承担过去。',
          },
        }),
      }
    }
    const current = String(planning.currentValue || '').trim()
    const field = planning.fieldLabel || '当前设定'
    const samples = {
      premise: `一个长期被行业忽视的年轻创作者，意外得到进入故事中心的机会，却发现这次翻身要求他公开否定三年前保护过自己的人。`,
      coreConflict: '主角必须借助自己不信任的行业规则完成翻身，同时守住不愿拿来交换的旧承诺；每次上升都会让这两者更难兼得。',
      storyPromise: '读者将持续看到主角用具体作品和临场选择改写行业评价，并在每次成功后面对更昂贵、更私人化的代价。',
      logline: `被行业遗忘的年轻人拿到一次危险的回归机会，为证明自己仍有资格站在台前，他必须在成功与旧日承诺之间连续做出无法撤回的选择。`,
      desire: '取得一个任何人都无法再归因于运气的公开成功。',
      secret: '他曾主动放弃过一次成名机会，但没有告诉任何人真正的原因。',
      hardRules: '任何改变行业资源分配的机会都必须通过可追溯的公开结果兑现，私人承诺只能换来入口，不能直接换来胜利。',
      goal: `让主角在“${chapterTitle}”中完成一个可见行动，并因此失去继续旁观的资格。`,
      ending: '以一条改变下一章行动方向的新消息收束，同时让主角刚刚作出的承诺立即产生代价。',
    }
    const generated = samples[planning.fieldKey]
      || `${field}需要同时连接人物欲望、现实阻力和后续变化：先给出一个可见目标，再设置无法绕开的代价，最后留下能被后文验证的结果。`
    return {
      task,
      model,
      generatedAt: now(),
      text: current ? `${current.replace(/[。！？；]$/, '')}；进一步明确它会迫使人物采取可见行动，并在后续情节中留下可以兑现或反噬的结果。` : generated,
    }
  }

  if (task === 'chapter_card') {
    return {
      task,
      model,
      generatedAt: now(),
      card: {
        goal: `让主角在“${chapterTitle}”中主动做出一次不可逆的选择。`,
        protagonistGoal: '确认眼前的机会是否值得付出代价，并把选择变成行动。',
        resistance: '外部条件并不完整，关键人物只愿意交出一半真相。',
        requiredScenes: [
          { id: 'S1', title: '机会出现', goal: '把问题从传闻推到主角面前', result: '主角得到一个必须回应的具体邀请。' },
          { id: 'S2', title: '条件交换', goal: '让选择带上现实代价', result: '主角主动承诺一件短期内无法撤回的事。' },
          { id: 'S3', title: '具体落点', goal: '用动作结束章节', result: '一个新任务或新人物进入下一章。' },
        ],
        turningPoint: '主角意识到等待更多信息本身就是一种选择。',
        payoff: '兑现前文埋下的一个小线索。',
        cost: '主角失去原本可以从容旁观的位置。',
        ending: '停在一个具体动作或信息抵达的瞬间。',
      },
    }
  }

  if (task === 'scene_plan') {
    return {
      task,
      model,
      generatedAt: now(),
      scenePlan: {
        schemaVersion: 1,
        summary: `本章围绕“选择是否值得代价”展开。${custom}`,
        scenes: [
          {
            id: 'S1', title: '机会出现', pov: '主角', time: '夜晚', location: '工作室', presentCharacters: ['主角'],
            entryState: '主角仍把事件当作可以旁观的传闻。', goal: '拿到无法忽略的信息。', obstacle: '信息来自一个不愿完整说明的人。',
            actionBeats: ['检查资料来源', '追问信息缺口', '识别交换条件'], turn: '对方证明已经掌握主角的旧事。',
            exitState: '事情变成主角必须回应的具体邀请。', knowledgeChanges: ['主角确认邀请与三年前有关'], continuityRisks: [],
          },
          {
            id: 'S2', title: '条件交换', pov: '主角', time: '次日', location: '旧车站', presentCharacters: ['主角', '联络人'],
            entryState: '主角带着邀请进入车站，仍保留拒绝的可能。', goal: '用有限承诺换取关键资源。', obstacle: '承诺会压缩下一阶段的自由度。',
            actionBeats: ['提出反条件', '核对证据', '主动写下承诺'], turn: '联络人只交出一半资料。',
            exitState: '主角取得线索，也开始承担承诺的后果。', knowledgeChanges: ['线索指向新的见面对象'], continuityRisks: ['下一场必须保留承诺造成的限制'],
          },
          {
            id: 'S3', title: '具体落点', pov: '主角', time: '傍晚', location: '车站出口', presentCharacters: ['主角'],
            entryState: '主角带着不完整资料离开，行动自由已受限制。', goal: '确认下一步行动。', obstacle: '新消息打断原安排。',
            actionBeats: ['核对消息时间', '收好资料', '改变行程'], turn: '消息来自尚未出现的关键人物。',
            exitState: '主角起身去赴下一场约见。', knowledgeChanges: ['下一章行动地点确定'], continuityRisks: [],
          },
        ],
        legacyNotes: '',
      },
    }
  }

  if (task === 'chapter') {
    return {
      task,
      model,
      generatedAt: now(),
      manuscript: `夜里的工作室只开着一盏台灯，灯罩把桌面照成一块边界分明的亮处。${title}的第一份资料摊在那里，纸页边缘压着一枚没有署名的旧徽章。\n\n主角没有立刻伸手。他先看了一眼窗外，又看向门缝下那道忽明忽暗的光。有人来过，而且没有打算把这件事解释清楚。\n\n手机在桌边震了一下。屏幕上只有一句话：如果你想知道真相，明天八点，到旧车站来。\n\n他把消息看了两遍，随后打开抽屉，取出那本已经很久没有翻过的笔记。最后一页写着同一个地点，日期却比今天早了整整三年。\n\n主角合上笔记，把徽章放进外套口袋。门外的脚步声停在了楼梯口，他没有去开门，只拿起桌上的资料，关掉台灯，转身走向后门。${custom}\n\n【本次 Mock 生成基于：${idea}】`,
    }
  }

  if (task === 'rewrite') {
    const source = selectedText.trim() || '这段文字'
    const preset = resolveRewritePreset(rewriteMode)
    const suffixes = {
      dialogue: '他没有把话说满，只让下一句追问改变两人之间的距离。',
      show: '他停了一下，把没有说出口的判断压进手上的动作里。',
      inner_conflict: '他已经作出选择，手指却在最后一刻收紧，像是在替自己寻找另一个理由。',
      compress: '动作和结果紧接着发生，没有再给重复的解释留下位置。',
    }
    const suffix = suffixes[preset.id] || '保留原有信息，但换一种更有张力的推进方式。'
    return {
      task,
      model,
      generatedAt: now(),
      text: `${source.replace(/[。！？；，,]$/, '')}。${suffix}`,
    }
  }

  if (task === 'chapter_state_extract') {
    const evidence = String(chapter?.manuscript || '').trim().split(/\n+/).find(Boolean) || '本章正文尚未提供明确证据。'
    return {
      task,
      model,
      generatedAt: now(),
      stateSnapshot: {
        summary: `第${chapter?.chapter_no || 1}章中，人物完成了一次会影响后续选择的行动。`,
        facts: [{ subject: '主角', predicate: '完成', object: '本章核心行动', certainty: 'confirmed', evidence: evidence.slice(0, 120) }],
        characterStates: [{ character: '主角', location: '本章结束地点', physical: '无新增明确伤势', emotional: '保持警觉', possessions: [], knows: ['本章新获得的信息'] }],
        relationshipChanges: [],
        timelineEvents: [`第${chapter?.chapter_no || 1}章事件已经发生`],
        foreshadow: { setups: [], payoffs: [] },
        openThreads: ['本章行动造成的后续结果仍待处理'],
      },
    }
  }

  if (task === 'continuity_audit') {
    return {
      task,
      model,
      generatedAt: now(),
      audit: { issues: [], uncertain: ['Mock 模式未发现可由双向证据确认的连续性冲突。'] },
    }
  }

  if (task === 'quality_review') {
    return {
      task,
      model,
      generatedAt: now(),
      review: {
        scores: Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [dimension.id, 3])),
        issues: [{
          id: 'mock-review', severity: 'info', category: '运行模式', criterion: '真实模型质量',
          evidence: '当前结果由 MockProvider 生成。', repairInstruction: '配置真实模型后重新运行质量评审。',
        }],
        summary: 'Mock 评审只验证软件流程，不产生创作能力达标结论。',
        assertionScores: Object.fromEntries((evaluationCase?.assertions || []).map((assertion) => [assertion.id, 0])),
        assertionEvidence: Object.fromEntries((evaluationCase?.assertions || []).map((assertion) => [assertion.id, {
          candidateEvidence: 'Mock 输出不作为质量证据。', contraryEvidence: 'MockProvider', reasoning: '仅验证流程。',
        }])),
      },
    }
  }

  return {
    task,
    model,
    generatedAt: now(),
    text: 'MockProvider 已完成当前任务。',
  }
}
