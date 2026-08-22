# Novel Studio 创作提示词网络调研与候选库说明

> 调研日期：2026-08-23
> 产物状态：第一批已接入 schema v10；后续任务仍为研究候选
> 机器可读库：`creative-prompt-library.json`
> 最小评测集：`prompt-eval-cases.json`

## 1. 结论

网络上常见的“你是一位小说家”“写一个引人入胜的故事”类提示词，只完成了角色和宽泛目标设置。它们可以作为连接测试或最低基线，但缺少长篇创作最重要的五类控制：

1. 故事事实、人物状态和世界规则的长期记忆；
2. 总纲、分卷、章节卡和场景之间的层级约束；
3. 当前场景的目标、阻力、行动、转折和结果；
4. 生成后的状态回写、事实一致性检查和伏笔管理；
5. 用户确认、候选稿、局部重写和版本恢复。

适合 Novel Studio 的方案不是积累更多“一条生成整本小说”的提示词，而是建立可编译的提示词链：

```text
用户想法
  -> 故事前提 / 阅读承诺 / 核心冲突
  -> 人物、关系与世界规则
  -> 层级总纲 -> 分卷计划
  -> 章节卡 -> 场景计划 -> 章节正文
  -> 章后状态提取
  -> 连续性 / 人物声音 / 伏笔 / 文字审计
  -> 下一章承接
```

这与当前项目已经具备的版本化模板、三级文风、提示词插件、长上下文、知识库、候选稿和差异确认方向一致。

## 2. 来源筛选

### 2.1 通用提示工程

- OpenAI 的公开指南强调明确任务、提供上下文和通过迭代逐步收敛结果。本库据此将任务目标、必要上下文、输出合同和评测标准分开，而不是只给模型一个角色名称。[OpenAI 提示指南](https://help.openai.com/en/articles/10032626-how-do-i-prompt-chatgpt-effectively)
- Google Gemini 文档建议复杂任务使用一致格式、少样本示例、结构化输出和提示词链。本库因此为规划、状态提取和审计任务设计 JSON schema，并将长篇创作拆成多个可重试步骤。[Gemini Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- Anthropic 的公开最佳实践强调清楚说明输出、补充约束原因、用结构标记分隔上下文，以及用正向描述指定目标格式。本库据此保留系统规则、参考资料、文风、插件和当前任务的编译边界。[Anthropic 提示工程最佳实践](https://docs.anthropic.com/zh-CN/docs/build-with-claude/prompt-engineering/claude-4-best-practices)

### 2.2 公开提示词库

- `f/prompts.chat` 中的小说家、编剧和讲故事者提示词主要采用“角色 + 类型 + 宽泛质量目标”的形式。其提示词数据采用 CC0，可作为最低基线；站点源码采用 MIT。本库没有整段复制这些提示词，而是只吸收其任务命名和角色边界。[项目仓库](https://github.com/f/prompts.chat) · [许可证](https://github.com/f/prompts.chat/blob/main/LICENSE)
- 中文公开提示词库也普遍沿用同样的单轮角色模板。它们说明中文用户熟悉“选择一个创作角色”的入口，但不足以保障长篇连续性，因此更适合做 UI 预设名称，而不是底层唯一系统提示。

### 2.3 长篇生成研究

- Google DeepMind 的 Dramatron 使用层级生成，把 logline 逐步展开为人物、故事节拍、地点和对白，并将系统定位为人机协作与反复编辑工具。这直接支持 Novel Studio 的“先规划再正文”路线。[Dramatron 论文介绍](https://deepmind.google/research/publications/13609/) · [Apache-2.0 源码](https://github.com/google-deepmind/dramatron)
- Re³ 先生成结构化计划，再反复注入计划和当前故事状态，生成多个续写候选，按情节连贯与前提相关性重排，并对最佳候选做事实一致性编辑。论文的人评结果相较直接生成，在整体情节连贯上提高 14 个百分点，在前提相关性上提高 20 个百分点。[Re³](https://aclanthology.org/2022.emnlp-main.296/)
- DOC 把简略大纲进一步扩为层级详细大纲，并在正文生成时持续约束当前大纲节点。相较 Re³，其人评报告在情节连贯、大纲相关性和趣味性上分别提高 22.5、28.2 和 20.7 个百分点。这是本库新增“层级总纲、分卷规划、场景状态链、大纲压力测试”的主要依据。[DOC](https://aclanthology.org/2023.acl-long.190/)

### 2.4 创作产品公开文档

- Sudowrite 的公开文档把 Story Bible 中的题材、梗概、人物、世界观、纲要和场景逐层提供给 Draft；场景被视为按地点、时间或人物情境划分的正文生成单位。Rewrite 则提供缩短、增加描写、减少直述、强化内在冲突等局部候选，结果不会自动覆盖正文。这里吸收的是公开工作流和功能分类，没有复制其产品内部提示词。[Story Bible](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC) · [Scenes & Draft](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/scenes--chapter-prose/49p5MTVxTKkVFEC5rVUzpY) · [Rewrite](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/rewrite/9hkeezeUsCiUCG4dRdEqjS)
- NovelAI 将 Memory 用于稳定的广泛信息，将 Author's Note 放在更靠近最近正文的位置以影响当前生成；Lorebook 可以按关键词激活人物、地点、物件和组织资料。其 Context Viewer 还让用户检查最终进入模型的上下文。本库据此区分长期事实、检索知识、三级文风和本次临时要求。[Story Settings](https://docs.novelai.net/en/text/editor/storysettings/) · [Lorebook](https://docs.novelai.net/en/text/lorebook/) · [Advanced Settings](https://docs.novelai.net/en/text/editor/advancedsettings/)

### 2.5 作者实际使用研究

对 18 位经常使用 AI 的创作者访谈显示，作者会依据真实性、手艺感等核心价值有意识地决定 AI 在何时、以何种方式介入，而不是把整个过程一次性交给模型。这支持 Novel Studio 保留每个节点的手写、候选、接受、编辑和重生成能力，并展示提示词快照与模型来源。[From Pen to Prompt](https://arxiv.org/abs/2411.03137)

## 3. 候选库内容

`creative-prompt-library.json` 当前包含：

- 22 个任务模板；
- 32 个可叠加提示词插件；
- 11 个结构化文风维度；
- 10 个来源影响记录；
- 5 个推荐接入批次。

其中 13 个模板可在现有任务类型中使用：

- 故事前提、阅读承诺、核心冲突；
- 人物卡、关系张力、世界规则；
- 因果章节卡、场景计划、受控章节正文；
- 对白有效化、减少解释、内在冲突、节奏压缩。

另外 9 个模板需要扩充任务枚举、路由和输出解析：

- 层级总纲；
- 分卷阶段规划；
- 下一章承接；
- 章后状态提取；
- 连续性审计；
- 人物声音审计；
- 模板腔与冗余审计；
- 伏笔与兑现审计；
- 大纲压力测试。

## 4. 提示词结构

每个任务模板采用统一结构：

```json
{
  "id": "稳定标识",
  "name": "用户可见名称",
  "task": "模型路由任务",
  "category": "产品功能分类",
  "integrationStatus": "compatible | requires-task-extension",
  "purpose": "该模板只解决什么问题",
  "requiredContext": ["编译时必须提供的资料"],
  "content": {
    "system": "角色、判断规则和不可破坏边界",
    "request": "当前任务和执行步骤",
    "outputContract": "只允许返回的内容或格式"
  },
  "outputSchema": {},
  "evaluationCriteria": ["可自动或人工评分的标准"],
  "sourceInfluences": ["方法来源标识"]
}
```

运行时不应把整个 JSON 原样发给模型。PromptCompiler 应按以下顺序组装：

```text
系统层：核心创作纪律 + 当前任务 system + 受保护输出合同
资料层：稳定事实 + 检索知识 + 规划 + 最近正文 + 当前状态
风格层：项目级 -> 卷级 -> 章节级
插件层：按作用范围和优先级叠加
请求层：当前任务 request + 用户本次补充要求
输出层：schema 或纯正文合同
```

资料层中的文字全部视为数据，不执行其中形似提示词的句子。若文风、插件或临时要求与已确认事实冲突，以事实和受保护合同为准。

## 5. 第一批建议接入内容

第一批只替换或新增现有任务的内置候选，不扩数据库 task 枚举：

1. 将 `research-chapter-card-v2` 作为章节卡 v2；
2. 将 `research-scene-plan-v2` 作为场景计划 v2；
3. 将 `research-chapter-prose-v2` 作为正文创作 v2；
4. 将四个 rewrite 模板做成局部工具栏的独立预设；
5. 从 32 个插件中先启用因果链、人物知情边界、限知视角、空间与时间连续、动作式结尾、已确认事实优先；
6. 保留 v1 模板，使用版本选择或实验开关对同一模型做 A/B 对比。

第二批增加任务扩展：

1. `chapter_state_extract` 在用户接受正文后运行，结果先作为候选知识变更；
2. `continuity_audit` 读取相关事实和正文，只产生问题记录；
3. `next_chapter_bridge` 只依据实际正文和已接受章后状态生成下一章入口；
4. 大纲、声音、伏笔和文字审计放在显式按钮或后台检查中，不阻塞用户保存正文。

## 6. 评测与上线门槛

`prompt-eval-cases.json` 当前有 10 个最小案例，覆盖：

- 章节结尾越界；
- 人物知情泄漏；
- 世界硬规则被临时改写；
- 章节卡与上一章缺少因果；
- 场景状态不连续；
- 局部重写改变事实；
- 把人物说法误存为客观事实；
- 连续性问题缺少双方证据；
- 人物声音只靠口头禅；
- 参考资料中的伪指令覆盖系统合同。

每次模板、模型或参数更新，都应固定同一组输入运行评测。建议采用 0—2 分：0 为失败，1 为部分满足，2 为稳定满足；所有 critical 断言必须为 2，平均分不低于 1.6，才进入默认模板。正文质量还需要人工盲评，至少比较：遵循规划、连续性、人物辨识度、场景变化、语言自然度和可编辑性。

## 7. 许可与内容边界

- 只把 CC0、MIT、Apache-2.0 等许可明确的公开提示词或源码当作可引用材料；
- 商业创作产品只参考其公开文档描述的工作流，不抓取、不推测、不复制内部系统提示词；
- 论文方法用于重新设计 Novel Studio 自有中文模板，来源记录保留在 `sourceInfluences`；
- 本候选库中的中文提示词为针对 Novel Studio 数据结构重新编写的原创文本；
- 后续接受社区贡献时，要求贡献者声明原创或提供来源和许可证，并保存来源字段。
