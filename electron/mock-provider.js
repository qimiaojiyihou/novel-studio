const now = () => new Date().toISOString()

export function generateMock({ task, project, chapter, instruction = '' }) {
  const title = project?.title || '未命名小说'
  const chapterTitle = chapter?.title || '新的章节'
  const idea = project?.idea || '一个普通人被迫走上改变命运的道路。'
  const custom = instruction.trim() ? `\n补充要求：${instruction.trim()}` : ''

  if (task === 'chapter_card') {
    return {
      task,
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
      generatedAt: now(),
      scenePlan: `本章围绕“选择是否值得代价”展开。\n\n场景一｜机会出现\n目标：让主角拿到无法忽略的信息。\n阻力：信息来自一个不愿完整说明的人。\n行动：主角追问、试探，并发现对方提前准备了交换条件。\n变化：事情从旁观变成主角必须回应的邀请。\n\n场景二｜条件交换\n目标：让主角用一个承诺换取关键资源。\n阻力：承诺会影响下一阶段的自由度。\n行动：主角提出反条件，最后主动把代价写进承诺。\n变化：主角从被动接受变成承担后果。\n\n场景三｜具体落点\n目标：留下下一章可以直接承接的动作。\n阻力：新的消息打断原本的安排。\n行动：主角合上资料，起身去见一个尚未出现的人。\n变化：下一章的入口落在具体行动上。${custom}`,
    }
  }

  if (task === 'chapter') {
    return {
      task,
      generatedAt: now(),
      manuscript: `夜里的工作室只开着一盏台灯，灯罩把桌面照成一块边界分明的亮处。${title}的第一份资料摊在那里，纸页边缘压着一枚没有署名的旧徽章。\n\n主角没有立刻伸手。他先看了一眼窗外，又看向门缝下那道忽明忽暗的光。有人来过，而且没有打算把这件事解释清楚。\n\n手机在桌边震了一下。屏幕上只有一句话：如果你想知道真相，明天八点，到旧车站来。\n\n他把消息看了两遍，随后打开抽屉，取出那本已经很久没有翻过的笔记。最后一页写着同一个地点，日期却比今天早了整整三年。\n\n主角合上笔记，把徽章放进外套口袋。门外的脚步声停在了楼梯口，他没有去开门，只拿起桌上的资料，关掉台灯，转身走向后门。${custom}\n\n【本次 Mock 生成基于：${idea}】`,
    }
  }

  return {
    task,
    generatedAt: now(),
    text: 'MockProvider 已完成当前任务。',
  }
}
