---
name: novel-studio-operator
description: 操作已绑定书籍的 Novel Studio 专属创作任务。用于读取和直接写入正式书稿、项目设定、规划、知识、上下文与文风，启动或续接 Codex/Qoder 创作、讨论和修改候选、核对审批、确认版本、独立审稿与章节定稿，以及处理双书并行的目标占用、过期候选和重启恢复。适用于外部专属作家任务，不适用于应用内部带 .nscollab.json 的 ACP 候选生成会话。
---

# Novel Studio 专属作家操作

你操作的是应用，不是在书籍归类目录里另写一套小说。正文、设定、候选和版本以 Novel Studio 的正式记录为准。用户本任务的最新创作要求优先；本 Skill 不规定题材、篇幅、模型或自动接受策略。

## 先辨认角色

- **外部专属作家任务**：工作区有 `.novel-studio-project.json` 和 `.novel-studio-operator.json`，使用下方操作入口。
- **内部 ACP 执行会话**：任务明确提供 AgentRun 镜像和 `.nscollab.json` 时，使用 `novel-studio-creator` 和该镜像；即使工作目录是同一本书，也不要调用本 Skill 的操作脚本或读取外部客户端凭据。内部会话负责产出候选，外部任务负责操作应用，避免递归启动模型。

## 新书工作区与首次绑定

- 当前版 Novel Studio 新建书籍时会立即在 Electron `userData/codex-projects/` 下生成书籍工作区和 `.novel-studio-project.json`；启动时也会补建旧版本遗漏的目录。macOS 默认根目录是 `~/Library/Application Support/novel-studio/codex-projects/`，Windows 默认根目录是 `%APPDATA%\novel-studio\codex-projects\`。
- 目录名只是经过 Windows 兼容清洗的归类名称：非法字符会被替换，系统保留名会加前缀，同名目录可能带项目摘要，书籍更名后目录也不会随之改名。始终读取 descriptor 的 `projectId`，再与应用项目列表和客户端 `identity` 三方核对；不要按目录名或模糊书名绑定。
- 只有 `.novel-studio-project.json` 表示书籍工作区已准备好，不代表专属作家任务已经绑定。开发/管理任务需为这个精确项目创建独立客户端，再运行打包资源中的 `scripts/install-operator-skill.mjs`，生成 `.novel-studio-operator.json` 和本 Skill 副本；普通作家任务不使用管理绑定接口。
- descriptor 缺失时先确认正在运行的构建标识并正常重启新版应用，让启动修复补建。若界面明确报告目录创建错误，保留已建立的书籍数据并报告路径/权限错误；不要手写 descriptor、复制另一书的绑定文件或另建同名书籍。

## 另一台电脑与专属任务生成

- 书库备份可迁移，`.novel-studio-operator.json`、客户端文件、`server.json` 和任务 ID 不可跨电脑复用。它们含本机绝对路径或本机回环服务身份；目标电脑必须安装同版或更新版 Novel Studio，导入书库并运行应用后重新生成。
- 推荐在 Novel Studio 的作品菜单选择“准备并打开 Codex 专属任务”。应用会按 descriptor 的精确项目 ID 在目标电脑创建本机客户端、安装本 Skill、刷新 `.novel-studio-operator.json`，并生成 `NOVEL-STUDIO-TASK.md` 后打开本书 Codex 项目。此步骤不改书稿、不调用模型。
- 若界面入口失败，从目标电脑的应用资源目录运行 `node scripts/setup-operator-workspace.mjs --workspace "书籍工作区绝对路径"`。脚本会自动发现 Windows `%APPDATA%`、macOS `~/Library/Application Support` 或 Linux `$XDG_CONFIG_HOME` 下的本机创作接口；应用必须正在运行。
- 在目标电脑的 Codex 项目中新建一个用户可继续交互的任务，以 `NOVEL-STUDIO-TASK.md` 为首次消息，或直接要求“按本书启动说明接手”。新任务会读取本目录 `AGENTS.md` 与本 Skill，首次只读核验后等待作者继续。每本书单独创建一个任务；不要从另一书 fork，也不要复制第一台电脑的 task/thread ID。

## ChatGPT Work 设计同步

- ChatGPT Work 对话不直接读写本机书库。需要长期保留 Work 里的设计讨论时，在 Novel Studio 的作品菜单选择“同步 ChatGPT Work 设计”，按精确项目绑定该 Work 对话的任务 ID 或链接。
- 绑定后，第一次选择“首次全量同步”，让 Work 汇总对话中全部已确认且仍有效的设计并建立基线；成功后入口自动切换为“后续增量同步”。复制应用生成的提示词发给同一个 Work 对话，Work 只返回 schemaVersion 1 的 JSON 包；把完整 JSON 粘回应用，先检查差异，再由作者确认写入。
- 同步包只处理设计层：项目题材/故事种子/项目文风、故事基础/世界设定/总纲、人物/世界元素/分卷、人物关系、章节卡/场景计划、情节弧/节点、事实/时间线/伏笔。它不写正文、不接受候选、不定稿，也不执行删除。
- 每个包使用新的 packageVersion，并以上次成功版本作为 baseVersion；ref 在同一对象的后续包中保持不变。来源对话、项目 ID、基线版本、预览摘要和项目来源摘要均由应用校验。首次成功写入后不可把该项目换绑到另一段 Work 对话。
- 已存在的同名唯一对象会在预览中显示“绑定并更新”；同名多项、跨项目引用、缺失引用或前台在预览后发生变化时停止写入。中断后保留逐项结果，重启会标记为“写入中断”，重新检查后再继续。
- 这套 Work 同步与书籍 Codex 专属任务相互补充：Work 负责讨论并发布结构化设计增量，Codex 专属任务继续通过本 Skill 操作应用、生成候选和创作正文。不要把 Work 对话当成另一台电脑上的本地操作客户端。

## 首次接手或恢复

1. 读取本文件，再读取 [操作流程](references/workflows.md)。遇到错误按 [恢复与接口边界](references/recovery.md) 查对应状态。
2. 从书籍工作区运行：

   ```sh
   node .agents/skills/novel-studio-operator/scripts/operate.mjs status
   ```

   入口会核对工作区、绑定文件和运行中应用返回的项目 ID。标题和目录名可能不同，ID 才是归属依据。绑定缺失或不匹配时停在身份核验，保留现状。
3. 对照用户最新要求核对书名、目标章节、字数口径、视角、模型和推理强度。已有任务继续原进度，不因为收到交接说明而重建项目或重新生成。
4. 使用 `snapshot` 获取正式资料，使用 `chapter.get` 阅读目标章、相邻章和有关设定；必要时 `run.get`、`finalization.get` 读取已有任务。先决定续改、处理候选还是新建一次运行。
5. 向用户简短说明绑定的书和续作位置。不要把纯工程测试、候选生成或接受编辑稿说成“已完成定稿”。

## 固定操作入口

```sh
node .agents/skills/novel-studio-operator/scripts/operate.mjs OPERATION --input /绝对路径/request.json --request-id 稳定请求ID
```

- 读操作可省略 input 和 request-id。写操作必须有稳定的请求 ID；同一次请求的超时查询/重试沿用原 ID，新动作使用新 ID。
- 请求 JSON 用文件编辑工具生成，避免 shell 拼接正文或凭据。临时请求存放在任务自己的临时目录，不存进书稿目录。
- 脚本在内部读取本书客户端凭据，不打印 token。不要打开或输出客户端文件内容，不使用管理绑定接口。
- 两个专属任务各用自己的入口和目标 ID，不切换共享 GUI 来定位书籍，不修改另一书的配置，不重启其他任务正在使用的应用。

## 写入与模型边界

- 用户要求“使用 Novel Studio / Codex / Qoder 创作”时，通过 `run.start-inline` 或现有运行的 `run.continue` 生成。新增人物、地点、分卷、关系或情节弧时，先使用对应的 `planning.*.create` 建立正式规划对象，再用返回 ID 启动整卡生成或继续编排。不要把自己在当前聊天里写的文章伪称为应用生成。
- 作者已经明确给出内容并要求保存时，使用对应的 `project.update`、`chapter.update`、`planning.*`、`knowledge.*`、`context.update`、`prompt.style.save` 或 `authoring.*` 直接写入。每次先读 snapshot，把当前 `sourceDigest` 连同 `confirm:true` 和实际 `reason` 提交；一次成功写入后，下一次写入前重新读取。不要因接口已开放而跳过作者确认，也不要把项目摘要当作正文摘要。
- 模型调用、工具操作和正式写入是不同权限。已有授权仅在其明确范围内有效；没有授权的审批交给用户。`confirm:true` 和 reason 是决定记录，不是凭空产生的授权。
- 未确认候选可讨论、比较、修改；只有获准接受后才调用 `candidate.resolve`。接受正文只是更新编辑稿，定稿走独立流程。
- 若作者要求参考朱雀 AI 检测改稿，先对目标章节调用只读 `zhuque.get`。结果为 null 或 `stale:true` 时让作者在应用内重新检测；使用返回的 `manuscriptDigest` 启动 `task:"chapter"`、`intent:"repair"`、`target.kind:"manuscript"` 的 `run.start-inline`，并将摘要放进 `target.zhuqueDigest`。应用会从本机读取结果并加入模型提示，不从任务输入接受伪造的检测分数；模型只产出候选，作者确认后才写入。
- 作者明确选择跳过审稿和交接时，可走操作流程中的“人工直接定稿”，不限于错字校正。不因审稿耗时或出错自行选择此模式；完成后注明未审稿、交接未更新。
- 所有 ID、摘要、字段名、版本和证据来自刚读取的应用数据；文档示例中的占位符需要替换，不编造。
- 持续处理当前用户请求，但不因目标占用、文学评分或短字数而自动取消任务、清空历史、接受候选、整章循环重写或改用其他模型。

## 每次交接保留什么

简短记录：书籍项目 ID、最新作者要求、目标章 ID、runId/候选 ID/定稿 ID、最近 request-id 与事件游标、已确认内容和下一步。不要记录 token、原始 ACP 会话 ID，或把讨论、过期候选当成正式故事事实。未来新任务先重新核验应用状态，再续作。
