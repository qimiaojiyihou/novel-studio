# 操作流程（与当前项目绑定 API 对应）

所有示例 JSON 中的大写 ID 是占位符。先 `status`，再读取完整资料。写操作通过 `--request-id` 提交 8—160 位英文字母、数字、下划线或连字符；例如 `suspense-ch03-revise-20260907-01`。不要两个不同动作共用一个 ID。

## 1. 读什么、从哪里续作

| 操作 | input | 用途 |
|---|---|---|
| `identity` | `{}` | 绑定项目、客户端、运行构建标识 |
| `snapshot` | `{}` | 正式项目、chapters、planning、knowledge、memories、styles、候选/运行/定稿摘要 |
| `request.get` | `{"requestId":"REQUEST_ID"}` | 回执丢失或重启后查询原幂等写请求；先查结果，不盲目换 ID 重做 |
| `chapter.get` | `{"chapterId":"CHAPTER_ID"}` | 本章完整正文和章节卡，不只截取首尾 |
| `revisions.list` | `{"chapterId":"CHAPTER_ID"}` | 旧稿版本 |
| `runs.list` | `{}` | 本书运行列表 |
| `run.get` | `{"runId":"RUN_ID"}` | 步骤、候选、冻结模型、错误和会话信息 |
| `run.events` | `{"runId":"RUN_ID","afterSequence":0,"limit":100}` | 增量事件；后续使用已读最大事件序号 |
| `approvals.list` | `{"status":"pending"}` | 当前审批；不等于自动同意 |
| `finalization.get` | `{"chapterId":"CHAPTER_ID"}` 或 `{"id":"FINALIZATION_ID"}` | 独立审稿、状态证据、定稿进度 |
| `finalization.correction-preview` | `{"chapterId":"CHAPTER_ID"}` | 只读对比已定稿正文、累计校正和受影响引句（proofread.1 起） |
| `finalization.manual-preview` | `{"chapterId":"CHAPTER_ID"}` | 只读获取当前保存稿的人工定稿预览（manual-finalize.1 起） |

snapshot 的规划条目可能含 `content_json`、`data_json`；解析后阅读。候选与运行摘要不是正式设定；必要时读取完整 run。正式来源摘要是 snapshot.sourceDigest；正文补丁摘要和定稿 stateDigest 是其他类型，不能互换。

## 2. 直接写入正式内容

作者已经给出明确内容并要求保存时，不必先启动模型候选。先读取 `snapshot` 与目标完整内容，提交对应写操作，并统一带上：

```json
{
  "sourceDigest": "刚读取的 snapshot.sourceDigest",
  "confirm": true,
  "reason": "记录作者本次实际要求"
}
```

一次写入成功后，下一项写入前重新读取 snapshot；不要连续复用旧摘要。项目元信息和故事种子用 `project.update`；正文、章名、完整章卡或场景计划用 `chapter.update`；故事基础/世界总设定/总纲整卡用 `planning.document.save`；人物、世界元素、分卷、关系、情节弧及节点用对应 `planning.*.update`；事实/时间线/伏笔用 `knowledge.item.create/update`；上下文预算用 `context.update`；项目/卷/章文风用 `prompt.style.save`。

完整直写矩阵如下。表中的“可写字段”之外，仍需带本节开头的 `sourceDigest`、`confirm:true`、`reason`；`projectId` 由专属绑定自动注入，不要用输入切换书籍。

| 正式内容 | 操作 | 可写字段与规则 |
|---|---|---|
| 书名、题材、故事种子、项目文风、默认执行方式 | `project.update` | `title?`, `genre?`, `idea?`, `style?`, `default_execution_mode?`；至少一项。故事种子就是 `idea`，项目文风就是 `style` |
| 章名、正文、章节卡、场景计划 | `chapter.update` | `id`, `title?`, `manuscript?`, `expectedManuscript?`, `card?`, `scenePlan?`；`card` 为完整对象，`scenePlan` 为文本或完整对象 |
| 章节顺序 | `chapters.reorder` | `chapterIds`；提交本书全部章节 ID 的目标顺序，不传局部子集 |
| 故事基础、世界总设定、总纲 | `planning.document.save` | `kind`, `content`；kind 从 snapshot 中现有 planning document 读取，`content` 为合并后的完整对象 |
| 人物、世界元素/地点、分卷 | `planning.entity.update` | `id`, `title?`, `data?`；`data` 为对象并与原字段合并 |
| 人物/世界元素/分卷排序 | `planning.entities.reorder` | `kind:"character"|"world"|"volume"`, `entityIds`；提交同 kind 全部 ID 的目标顺序 |
| 人物关系 | `planning.relationship.update` | `id`, `fromCharacterId?`, `toCharacterId?`, `label?`, `surface?`, `tension?`, `direction?`, `trend?`, `status?` |
| 情节弧 | `planning.arc.update` | `id`, `title?`, `category?`, `premise?`, `destination?`, `status?`, `colorKey?` |
| 情节弧节点 | `planning.arc-beat.update` | `id`, `volumeId?`, `chapterId?`, `label?`, `changeText?`；关联对象必须属于本书 |
| 事实、时间线、伏笔 | `knowledge.item.create` | `kind:"fact"|"timeline"|"foreshadow"`, `title`, `content?`, `status?` |
| 已有知识条目 | `knowledge.item.update` | `id`, `title?`, `content?`, `status?`, `effectiveFromChapter?`, `effectiveToChapter?`, `knowledgeScope?` |
| 知识条目排序 | `knowledge.items.reorder` | `kind:"fact"|"timeline"|"foreshadow"`, `itemIds`；提交同 kind 全部 ID 的目标顺序 |
| 连续性检查处理 | `knowledge.check.resolve` | `id`, `expectedStatus`, `status`；`expectedStatus` 必须是刚读取值 |
| 上下文预算 | `context.update` | `maxContextChars?` 8000—200000，`recentChapterCount?` 0—20，`relevantChapterCount?` 0—20，`knowledgeLimit?` 0—100，`chapterSummaryChars?` 200—4000 |
| 分层文风 | `prompt.style.save` | `scopeType:"project"|"volume"|"chapter"`, `scopeId`, `text?`, `style?`；scopeId 必须是本项目、分卷或章节的实际 ID |
| 认可片段 | `authoring.sample.save` | 新增：`chapterId` 或正文候选的 `candidateId`、`text`、`manuscriptDigest`，可带 `reason`,`active`；更新：`id` 加可改字段；删除：`id`,`action:"delete"` |
| 正文保护范围 | `authoring.protection.save` | 新增：`chapterId` 或 `candidateId`、`from`,`to`,`manuscriptDigest`；移除：`id`,`action:"remove"` |

新增对象也属于正式写入：章节使用 `chapter.create`；人物/世界元素/分卷使用 `planning.entity.create`；人物关系、情节弧和节点分别使用 `planning.relationship.create`、`planning.arc.create`、`planning.arc-beat.create`。准确字段见第 3、4 节。由模型生成内容时走 `run.*` 和候选确认，不把直写接口当成绕过候选的模型通道。

`planning.document.save` 和 `chapter.update.card` 接收完整整卡，提交前合并并保留原字段；`planning.entity.update.data` 是字段合并。更新正文时同时传刚读取的 `expectedManuscript`，防止前台尚未保存的旧缓冲覆盖。`chapter.update` 不直接设置 completed；定稿状态仍由定稿流程产生。

处理连续性检查时使用 `knowledge.check.resolve`，除项目摘要外还传刚读取条目的 `expectedStatus` 和目标 `status`；状态已经被另一端处理时会返回过期错误。

认可片段用 `authoring.sample.save`，保护范围用 `authoring.protection.save`。新增时除项目 `sourceDigest` 外，还传目标正文的 `manuscriptDigest`；offset 使用 JavaScript UTF-16 位置。全局模型、供应商、密钥、项目改绑和删除操作不属于书籍内容直写。

## 3. 生成 / 重写一章

已有章节直接使用原 chapterId。仅在用户要求新增章节时，使用 `chapter.create`，input 为 `{"title":"章节名","confirm":true,"reason":"作者要求新增一章"}`，保留返回 ID。

新一次就地正文任务 `run.start-inline`：

```json
{
  "task": "chapter",
  "chapterId": "CHAPTER_ID",
  "intent": "rewrite",
  "target": {"kind": "manuscript", "targetId": "CHAPTER_ID"},
  "instruction": "在这里写本次作者要求、应保留内容和明确修改范围",
  "targetLength": 3200,
  "executionMode": "codex",
  "codexModel": "gpt-6-astra",
  "codexReasoningEffort": "xhigh"
}
```

这里的 3200 和 GPT-6 / xhigh 只是示例：沿用当前作者要求。`targetLength` 是目标值，不等于最少字数设置；“至少 3000 字”等要求还应在 instruction 写清并在生成后核验。这个 API 没有全局字数设置操作，不要声称已修改全局设置。

先读 `run.get` 核对冻结模型和实际后端，等待审批或输出；一轮发起后以返回的 runId 跟进，不连续点生成。ACP/exec 由应用控制，不以应用模型替代用户指定 Codex。已有运行模型被冻结；改变 Codex 聊天任务模型不会自动改变应用调用的模型。

## 4. 规划与整卡

新书规划缺少对象时，先建立正式对象并保存返回 ID。每项都是写操作，需要稳定 request-id、`confirm:true` 和记录用户要求的 `reason`：

| 操作 | 主要 input | 返回值用途 |
|---|---|---|
| `planning.entity.create` | `kind:"character"|"world"|"volume", title, data?, confirm:true, reason` | 新建人物卡、世界元素/地点或分卷卡；返回对象的 `id` 后续作为 entityId。地点使用 `kind:"world"`，并在 `data.category` 标明“地点”等类别 |
| `planning.relationship.create` | `fromCharacterId, toCharacterId, label, surface?, tension?, direction?, trend?, status?, confirm:true, reason` | 在同书的两个人物卡之间建立关系；返回对象的 `id` |
| `planning.arc.create` | `title, category?, premise?, destination?, status?, colorKey?, confirm:true, reason` | 新建跨卷情节弧；返回对象的 `id` 后续作为 arcId |
| `planning.arc-beat.create` | `arcId, volumeId?, chapterId?, label, changeText?, confirm:true, reason` | 给情节弧增加分卷/章节节点；返回对象的 `id` |

可选枚举：关系 direction 为 `mutual/from_to/to_from`，trend 为 `warming/stable/cooling/hostile`，status 为 `active/changed/ended`；情节弧 category 为 `main/character/relationship/mystery/world/other`，status 为 `planned/active/resolved/paused`，colorKey 为 `copper/pine/slate/ochre/plum`。所有关联 ID 先从本书 snapshot 或前一步返回值取得，不能引用另一书的对象。

例如先创建人物卡：

```json
{
  "kind": "character",
  "title": "人物名",
  "data": {"role": "主角", "goal": "当前目标"},
  "confirm": true,
  "reason": "作者要求为新书建立主角"
}
```

创建后重新读 snapshot 核对正式规划。需要让模型补全或改写卡片时，把创建响应中的 `id` 放入 target.targetId，使用同一个 `run.start-inline`，换 task/target。模型运行会采用 Novel Studio“模型与任务路由”里当前保存的 ACP 提供方；选择 Qoder 时会锁定 Qoder 模型。目标字段从现有规划结构/任务声明读取，不根据中文标签猜英文键。

| 内容 | task | target |
|---|---|---|
| 章节卡 | `chapter_card` | `{kind:"chapter_card", targetId:chapterId}` |
| 场景计划 | `scene_plan` | `{kind:"scene_plan", targetId:chapterId}` |
| 章节名 / 章节规划单字段 | `planning_field` | `{kind:"chapter_field", targetId:chapterId, fieldKey, fieldLabel}` |
| 本章规划整卡 | `planning_field` | `{kind:"planning_chapter_bundle", targetId:chapterId}` |
| 故事基础 / 世界总设定 / 总纲字段 | `planning_field` | `{kind:"planning_document", targetId:实际文档kind, fieldKey, fieldLabel}` |
| 上述文档整卡 | `planning_field` | `{kind:"planning_document_bundle", targetId:实际文档kind}` |
| 人物 / 世界元素 / 分卷字段 | `planning_field` | `{kind:"planning_entity", targetId:entityId, fieldKey, fieldLabel}` |
| 人物等整卡 | `planning_field` | `{kind:"planning_entity_bundle", targetId:entityId}` |

章节目标同时传顶层 chapterId。默认补空白；明确要求改已有字段时根据目标支持传 `includeFilled:true`，并说明保留内容。人物卡优先沿用该卡的已有创作运行，不逐字段建新对话。服务器对同章运行采用章节级锁，比“单字段”更严格。

## 5. 讨论与修改

读取 run，选择实际 parentCandidateId，再发 `run.continue`：

```json
{
  "runId": "RUN_ID",
  "parentCandidateId": "CANDIDATE_ID",
  "mode": "discuss",
  "instruction": "这段动机是否成立？先讨论，不生成替换稿。"
}
```

修改用 `mode:"modify"`。默认 scope 为 `{kind:"related"}`，指定选区或场景用 `{kind:"selection",from:起点,to:终点}` / `{kind:"scene",from:起点,to:终点}`；明确整章重构用 `{kind:"whole"}`。讨论不应创建正文替换候选；修改后检查新候选再接受。

局部范围需要原文位置和来源校验；索引遵循 JavaScript 字符串 UTF-16 偏移，不用肉眼字数代替偏移。位置按 parentCandidate 的实际正文计算，应用负责冻结补丁来源；若已接受候选与最新正式稿不同，旧运行会拒绝直接续改，应读取新稿后按作者要求启动新修改。定位不确定时先讨论或请作者选区，禁止把定位失败自动升级为整章重写。保留保护段落并核对未选中内容。

`run.finish` 释放本次连接，保留历史；再次修改优先 `run.continue`。`run.pause` 中断当前生成，`run.resume` 恢复，`run.retry` 需要实际失败 stepId。`run.cancel` 终止运行，不等于关闭面板。完全重新开始只有在用户明确要求后使用 `freshStart:true` 新开运行；占用的旧目标先让用户决定如何处理。

## 6. 候选确认

先 `run.get`，阅读完整候选、差异、原稿与异常。正文候选检查重复输出、指令混入、字数、叙事自然度、事实冲突。字数不足保留候选并做有目的的增补，不循环整章生成。

获准接受后调用 `candidate.resolve`：

```json
{"runId":"RUN_ID","candidateId":"CANDIDATE_ID","accept":true,"confirm":true,"reason":"记录作者实际确认的决定"}
```

放弃是 `accept:false`；不要为解锁自动放弃。手动编辑候选可传符合该候选 Schema 的 `editedPayload`，先核对 payload 结构。接受后重新 `chapter.get` / `snapshot` 核验正式内容与版本，不只凭成功回执。

`candidate.propose` 仅在用户明确要导入外部草稿时使用：需要 task、target、payload 和刚读取的 snapshot.sourceDigest。它只入候选，不调用 Codex；不要把它当成应用模型生成入口。定稿子运行候选走下面的定稿流程，不用 candidate.resolve。

运行停在工具或正式写入审批时，先用 `approvals.list` 读取本书待审批项并向作者展示实际动作。作者明确决定后用 `approval.resolve`，输入 `{"id":"APPROVAL_ID","approved":true|false,"confirm":true,"reason":"作者本次实际决定"}`。该操作只处理这一项审批，不建立全局免审策略；过期或其他项目的审批会被拒绝。

## 7. 完成本章

### 人工直接定稿（作者明确选择跳过审稿与交接时）

支持首次定稿和人工改写后的再次定稿，不要求只改错字或含义不变。先核对当前已保存正文，再调用 `finalization.manual-preview`。提交 `finalization.manual` 时传入该预览的 `chapterId`、`sourceDigest`、`previewDigest`，以及 `confirm:true`、`skipReview:true`、`skipHandoff:true`，使用稳定 request-id。`reason` 选填，不代写“已审稿”等结论。

它只创建正文版本与人工定稿记录，不调用模型、不生成交接、不接受旧候选。旧交接保留历史但不作为本版当前交接；后续以正文为准。返回 completed 后报告“已人工定稿，本次未审稿、交接未更新”，不声称质量审查通过。原有运行占用目标时保留并交由作者处理。需要补做审稿与交接时仍使用下方标准流程。

### 审稿并交接

1. 当前正文已保存并核验后 `finalization.start`：`{"chapterId":"CHAPTER_ID","targetLength":3200}`。默认读取应用已有独立评审配置；缺配置时请用户选择，不临时猜供应商。
2. 本接口先执行本地检查并延迟模型审稿。读取返回记录与 checks，存在结构问题先处理。启动审稿用 `finalization.act`：`{"id":"FINALIZATION_ID","action":"start-review"}`，这一步会产生模型调用，遵守现有授权。
3. 用 finalization.get 跟进，按实际状态核对 review_run_id / state_run_id，不把等待确认当成卡死。需要接受评审意见并继续时 `action:"accept-review", confirm:true, reason:实际决定`。也可以修订正文；旧定稿随来源变化过期。
4. 章后状态待确认时逐项读 evidence，并对照该定稿锁定正文。`waiting_state_correction` 的处理见恢复文档；不要因缺证据重写正文。
5. 审核通过并获准确认后：`{"id":"FINALIZATION_ID","action":"accept-state","confirm":true,"reason":"记录实际核对与作者确认"}`。
6. 再读 finalization.get 和 chapter.get。只有实际 status 为 completed 才报告“已定稿”。可稍后定稿，但把待办清楚保留下来。

## 8. 进度与交接

### 定稿后文字校正（proofread.1 起）

作者仅要求错字、标点、排版校正时，先保存获准的正文改动，再读取 `finalization.correction-preview`。完整核对 `changes`、相对于原审稿的 `cumulativeChanges`、`issues` 和 `dependencyIssues`；少量字数不代表语义没变。事实、剧情或其他依赖变化时仍走完整审稿。

只有作者确认累计修改未改变剧情、事实及交接含义后，才用 `finalization.correct`，传入预览返回的 `chapterId`、`baseFinalizationId`、`sourceDigest`、`stateDigest`、`previewDigest`，加 `confirm:true`、`meaningUnchanged:true` 和实际校正说明 `reason`。`corrections` 仅含受影响引句的 `{key,index,quote}`；这里不允许移除或改写交接事实。外层仍使用稳定 `--request-id`。

此操作不写正文、不调用模型，只确认已有保存稿并更新交接来源，留存原审稿和校正差异。完成后重新读取章节及定稿；应报告“已定稿·已校正，沿用原审稿”，不声称新稿已重新通过模型评审。未受作者授权时停在预览，不代替作者勾选确认。

### 运行进度

同一目标只跟进一个活跃运行。读事件使用游标和有界轮询；状态不变时适度退避，不忙循环、不启动第二个生成。输出阶段性进度：正在生成 / 等待批准 / 待接受候选 / 等待证据修正 / 已定稿。工具报错应保留 code、details 中的 runId 或定稿 ID；不要暴露凭据。
