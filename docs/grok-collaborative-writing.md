# Grok 与 GPT 协作创作

在「模型与项目设置」中编辑预置的「Grok / xAI」，填写 xAI API Key。默认接口为 https://api.x.ai/v1，预填模型为 grok-4.7，也支持自定义兼容接口与其他模型 ID。「测试连接」会探测基础文本、流式和 JSON 输出并读取账号模型目录；探测会产生少量模型调用。

在「创作助手」的工作流中选择「GPT / Grok 协作创作」。规划、正文、审稿、定向修稿各自有模型选择框。每个环节都支持已启用的 API 模型配置，或 Codex 中设置的 GPT 模型。要为不同环节选择不同的 GPT 版本，可添加多个 GPT 配置。默认优先使用已配置的 GPT API 进行规划和审稿，否则选择 Codex；正文与修稿默认选择 Grok。

流程：

1. 规划模型生成故事卡/章节卡，作者确认后写入规划。
2. 同一个规划模型展开场景计划，作者确认后写入。
3. 正文模型生成首稿，保留在候选区。
4. 审稿模型使用独立上下文检查首稿及正式设定，给出带原文证据的问题。
5. 作者勾选问题，由修稿模型仅根据所选问题修订；也可以跳过修稿，保留原稿。
6. 比较原稿与修稿，编辑候选并确认，正文才写入正式作品。原稿及审稿报告保留在运行记录中。

四个环节的配置选择按作品保存，启动时锁定具体模型 ID。API Key 不存入运行快照；删除、停用或改变模型接口会阻止当前运行继续，而非自动换模型。单纯修改配置中的模型 ID，不影响已启动运行锁定的 ID。密钥轮换继续使用当前配置的密钥。

本流程适用于小说章节与短故事。旧工作流、旧能力包和已经启动的运行保持原有步骤。协作流程的步骤快照与提示词上下文单独保存在运行记录中，不改写已安装能力包的内容。审稿后正式内容变化会阻止陈旧候选写入；失败可重试当前步骤。

Grok API 采用官方仍支持的 OpenAI 兼容 Chat Completions 文本接口，与现有流式处理和 Go 转发路径共用适配器。Grok 默认不附加采样参数，可在 JSON 请求配置中按实际模型能力覆盖。未配置 Grok 时明确报错，不生成模拟正文。

参考：
- https://docs.x.ai/developers/model-capabilities/legacy/chat-completions
- https://docs.x.ai/developers/models

## Grok Build ACP

「模型与项目设置 → Agent 提供方」可选择 Grok Build。应用自动检测 `~/.grok/bin/grok`、PATH 及常见本机安装目录，也可指定 CLI 路径。先在终端执行 `grok login`；后台 ACP 只使用 `cached_token` 本机认证，不自动打开网页登录，不从 API 配置提取密钥。Grok / xAI API 入口保持独立。

点击「测试 Grok Build ACP」或「刷新 Grok 模型列表」，读取当前账号的模型与思考强度。先切换模型，再按新会话返回的档位验证强度；目录读取失败保留已有选择。模型或强度不支持、回读不一致时停止本次调用，不自动改用其他模型或 API。CLI 登录权限、可用模型和额度由 Grok 账号决定。

每本书具有 `grok-projects/<书籍目录>`，目录用项目 ID 归属，同名书和改名书也能区分。每次运行具有独立 `grok-workspaces/<运行 ID>` 镜像及 ACP 会话，审稿另建会话。应用会恢复属于同一执行器的持久会话；切换执行器时关闭旧会话，保留已确认规划和候选。书库迁移包含这两类目录；删除书籍也清理对应归类目录。书籍菜单的「打开 Grok Build 书籍目录」可打开归类目录，终端进入后运行 `grok` 管理本书 CLI 会话。

协作流程的四个环节均可单独选择 Codex、Grok Build 或 API 模型配置。Codex 和 Grok Build 环节各有具体模型和思考强度选择，按作品保存；新运行锁定这些选择，并记录实际生效的模型与强度。API 模型仍使用各自配置的请求参数。正文和修稿可以使用不同 Grok 模型或强度，审稿报告只将作者勾选的问题传给修稿环节。

`npm run smoke:grok` 只测试本机登录、ACP 会话和目录，不发送生成请求。`npm run smoke:grok -- --generate` 额外执行一条虚构短句生成；可以用 `GROK_SMOKE_CLI`、`GROK_SMOKE_MODEL`、`GROK_SMOKE_EFFORT` 指定测试配置。测试只建立临时目录，结束时释放会话和进程，不写真实书库。

官方依据：
- https://docs.x.ai/build/cli/headless-scripting
- https://docs.x.ai/build/cli/reference
- https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md
