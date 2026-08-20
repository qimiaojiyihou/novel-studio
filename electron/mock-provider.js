const now = () => new Date().toISOString()

export function generateMock({ task, project, chapter, planning = {}, instruction = '', selectedText = '', rewriteMode = '局部重写', modelProfile }) {
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
      scenePlan: `本章围绕“选择是否值得代价”展开。\n\n场景一｜机会出现\n目标：让主角拿到无法忽略的信息。\n阻力：信息来自一个不愿完整说明的人。\n行动：主角追问、试探，并发现对方提前准备了交换条件。\n变化：事情从旁观变成主角必须回应的邀请。\n\n场景二｜条件交换\n目标：让主角用一个承诺换取关键资源。\n阻力：承诺会影响下一阶段的自由度。\n行动：主角提出反条件，最后主动把代价写进承诺。\n变化：主角从被动接受变成承担后果。\n\n场景三｜具体落点\n目标：留下下一章可以直接承接的动作。\n阻力：新的消息打断原本的安排。\n行动：主角合上资料，起身去见一个尚未出现的人。\n变化：下一章的入口落在具体行动上。${custom}`,
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
    const suffix = rewriteMode === '润色'
      ? '语气收紧一些，让动作和信息自己推进。'
      : rewriteMode === '扩写'
        ? '补入一个可见动作和一个具体感官细节。'
        : '保留原有信息，但换一种更有张力的推进方式。'
    return {
      task,
      model,
      generatedAt: now(),
      text: `${source.replace(/[。！？；，,]$/, '')}。${suffix}`,
    }
  }

  return {
    task,
    model,
    generatedAt: now(),
    text: 'MockProvider 已完成当前任务。',
  }
}
