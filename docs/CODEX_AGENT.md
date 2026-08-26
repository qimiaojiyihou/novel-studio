# Codex Agent 集成

Novel Studio 把 Codex 作为独立 Agent 执行方式，而不是普通 OpenAI 模型配置。默认通道是随安装包发布并校验摘要的 `codex-acp` 1.6.2；ACP 在首个可观察输出前发生适配器、初始化、建会话或传输故障时，才进入只读 `codex exec` 兼容模式。首个输出后的故障保留原会话证据，等待作者主动重试。

每个 AgentRun 复用一个 ACP 会话。新章节、重新初始化项目或完全重新开始会创建新的 AgentRun。暂停会取消当前 turn 并保留会话；取消会关闭会话。

除创作助手的多步骤工作流外，故事字段、人物关系、世界元素、情节弧、章节规划、正文、选区重写、知识条目、连续性审计、质量评审、质量修复、提示词和文风都可以启动独立的轻量 AgentRun。项目保存默认执行方式，分裂按钮允许只覆盖本次调用；Codex 的运行轨迹、审批、候选和 Monaco 正文差异显示在当前页右侧侧栏，同时保留到创作助手历史。

Codex 只看到 `codex-workspaces/<agentRunId>`。镜像包含当前项目所需的故事基础、人物、世界、总纲、知识、连续性、当前章节和锁定能力包，不包含 SQLite、模型密钥、请求头、其他项目、应用日志或审批令牌。路径穿越、符号链接越界和 SQLite 路径会在进入审批前拒绝。

所有结果先进入候选区。作者确认后，Novel Studio repository 才在事务中写入正式项目；源摘要变化的候选会标记为 stale。尚未保存的关系、情节弧、知识、模板和文风表单使用 renderer draft，接受后只填入编辑器，仍需作者点击原表单保存。模型调用、镜像写入、命令、Web、MCP 与子 Agent 都按次审批，没有永久授权。

默认使用 ChatGPT 登录。存在 `CODEX_API_KEY` 或 `OPENAI_API_KEY` 时，设置页只显示“环境认证可用”，凭据不会写入 Novel Studio。设置页可查看适配器版本、CLI 版本、摘要状态、ACP 能力、会话状态和回退原因，并运行不写项目的连接测试。

## 构建

`npm run build:codex` 从锁定依赖生成当前平台 `resources/codex-runtime/<platform>-<arch>`，记录适配器与原生 CLI 的 SHA-256。`npm run build:app` 会先构建 Creative Pack、Codex 运行时和 Go 服务，再生成桌面安装包。
