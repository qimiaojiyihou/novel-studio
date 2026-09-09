# 小说创作与叙事真人化 Skill 调研记录

更新日期：2026-08-27

## 调研目的

本次调研针对 Novel Studio 第一章反复重写后出现的四类问题：规划痕迹过重、段落平均用力、描写与对白过度完整、人物情绪没有进入选择。目标不是收集更多泛用提示词，而是筛选能进入“生成—评审—最小修复—回归测试”闭环的小说方法。

## 采用的来源与判断

### Noah Duck：从识别到局部修复

来源：<https://x.com/noahduck283/status/2069030402048893317>

采用：把 AI 痕迹分为材料、思考过程和默认文风三层；写前先锁定文体、作者意图、读者认知、语气与事实边界；修复按“识别—删除—声音校准—局部重写—复查”执行。尤其采用“越位”判断：叙述不要替读者预设误解，再长篇纠正。

不直接采用：面向文章排版的段落规则、固定禁词和统一句长。这些规则机械套到小说会损伤节奏和人物声音。

### chaserr/novel-craft：小说专用去 AI 痕迹

来源：<https://github.com/chaserr/novel-craft/blob/main/skills/zh-novel-polish/SKILL.md>

采用：同一情绪只表达一次；动作已经传达情绪时删除命名式复述；对白允许省略、打断、转移和未完成，避免角色成为作者的说明工具。

### alt-code-ai/agent：场景压力与叙事距离

来源：<https://github.com/alt-code-ai/agent/blob/main/skills/fiction-writing-story-development/SKILL.md>

采用：说明性信息应在戏剧压力下出现；内心只在它让行动复杂化时展开；篇幅分配是一种叙事判断，不按场景清单或字数平均分配；一个细节最好同时承担人物、冲突或环境功能。

### 中文网文工作流 Skills

来源：<https://github.com/imerzzhu/ai-novel-writing-skills>、<https://www.skills.sh/wgwtest/novel-writing/novel-writing>、<https://github.com/Fly143/ultimate-novel-creation-skill>

采用：规划、起草、审查、润色和定稿分阶段；正文生成前读取故事圣经、时间线、人物状态和伏笔；生成后回写章后状态。Novel Studio 现有 Creative Pack、AgentRun、候选确认和连续性中心继续承担这些职责。

不直接采用：一次性把题材、大纲、正文、审查全部塞进一个超长提示词。长篇项目需要可恢复步骤、候选确认和版本血缘。

### 通用 Humanizer 与社区经验

来源：<https://github.com/op7418/Humanizer-zh>、<https://github.com/ryanmaule/humanize/blob/main/SKILL.md>、<https://www.reddit.com/r/WritingWithAI/comments/1rz2sdu/the_1_mistake_i_see_authors_make_with_ai_prompts/>、<https://www.reddit.com/r/WritingWithAI/comments/1rh6xvp/stop_asking_ai_to_write_me_a_chapter_a_prompt/>

采用：保留原作者声音，执行最小有效编辑；生成要求应说明视角、情绪真相、场景感觉和必须保留的未决项，而不只给主题。社区帖子作为经验线索，不作为质量结论。

不直接采用：把句式波动、罕见词比例或某个“AI 分数”设为硬门槛。它们可以帮助定位，但小说质量仍要结合上下文证据和人工盲评。

## 落地到 Novel Studio 的规则

1. `chapter` 生成提示词加入小说自然度保护层，版本升级到 v19；
2. `quality_review` 加入成簇证据、自然度封顶和最小修复范围，版本升级到 v7；
3. 新增“叙事真人化精修 / 去工整感”重写预设；
4. 正文快速修改入口增加去工整感、情绪暗线、打散完美对白和减少说明；
5. `prompt-eval-cases.json` 新增正文自然度案例，检查选择性注意、规划转写、配角自主性、压力下对白和意义复述；
6. Creative Pack 与 Codex Skill 共享同一份创作方法，避免应用模型与 Codex 使用两套规则。

## 有效性验收

自动评审只证明规则可执行。真实有效性还需要在同一章节、同一 Creative Pack、相同事实合同下保存首稿，比较优化前后版本：

- 章节卡逐条转写是否减少；
- 配角是否拥有独立利益和现实条件；
- 对白是否减少完整汇报和条款宣读；
- 情绪是否进入注意、动作和选择；
- 人工盲评的文字自然度与人物声音是否提升；
- 连续性、世界规则和章节结尾是否保持。

若自然度提高但事实或结尾被破坏，该版本仍判定失败。Mock 只验证流程，不计入创作质量结论。
