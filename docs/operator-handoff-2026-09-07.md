# 专属创作任务操作交接补齐

## 两种角色

- `novel-studio-creator`：应用内部 ACP 候选执行会话，只操作当前 AgentRun 镜像。
- `novel-studio-operator`：外部专属作家任务，先核对本书绑定，再通过现有本地 API 读取、生成、续改、处理候选和定稿。

本次未调整创作模型、提示词文学规则、审批策略或数据 Schema。新增 operator 是现有 API 的操作入口及说明，不是第二套存储或生成后端。

## 已安装到现有书籍工作区

| 任务 | 工作区尾名 | 绑定客户端 | 项目 ID |
|---|---|---|---|
| 《别让他接我回家》专属创作 | 第二位家属 | suspense-author | project-d55c5ab7-f1d2-4461-84c5-36c947698de4 |
| 《我一个明星，会亿点手艺很正常吧》专属创作 | 我一个明星,会亿点手艺很正常吧 | entertainment-author | project-3dd77038-9464-4b12-903c-5c7ee6d6dbee |

两者均位于 `~/Library/Application Support/novel-studio/codex-projects/`。目录名保留，正式标题以 API 返回为准。不要按目录名新建同名书籍。

安装内容：

- `.agents/skills/novel-studio-operator/SKILL.md`
- `references/workflows.md`、`references/recovery.md`
- `scripts/operate.mjs`、自包含副本 `scripts/creative-client.mjs`
- `.novel-studio-operator.json`：项目 ID、客户端 ID、工作区和客户端文件路径，不含 token。
- `NOVEL-STUDIO-OPERATOR.md`：入口说明。
- `NOVEL-STUDIO-TASK.md`：在 Codex 中新建本书专属任务时使用的首次消息。
- `.installed-files.json`：受管理文件摘要，重复安装不覆盖作者自定义修改。

现有工作区的 AGENTS.md、README、书稿和客户端凭据均保持原状。源代码的书籍 AGENTS 生成器已增加双角色引导，随下次应用打包更新生效；这次没有为更新生成器重启或替换正在使用的应用。当前两个任务已收到明确的 Skill 文件路径，直接读取即可使用。新任务接手本书时也可显式让其读此路径，不必依赖旧任务的聊天记忆。

## 使用

从对应书籍工作区：

```sh
node .agents/skills/novel-studio-operator/scripts/operate.mjs status
node .agents/skills/novel-studio-operator/scripts/operate.mjs OPERATION --input /绝对路径/request.json --request-id 稳定请求ID
```

首个命令只调用 identity、snapshot，不触发模型或决定。第二个命令的操作与参数见 Skill 的 workflows；写操作必须有稳定请求 ID，正式决定另需符合作者授权的确认及原因。

当前接口不支持的页面操作已明确列入 recovery，避免外部任务用原始 SQL、管理接口或共享窗口并发来补洞。内部 ACP 角色即使在同一书籍工作目录，也不应使用 operator；主进程的镜像访问权限仍是实际隔离边界。

## 维护和打包

源码安装入口：

```sh
node scripts/install-operator-skill.mjs --workspace /已核对的书籍工作区 --client /本书客户端文件 --project 实际项目ID
```

跨电脑迁移和新书首次创建优先使用完整初始化脚本：

```sh
node scripts/setup-operator-workspace.mjs --workspace /已核对的书籍工作区
```

目标电脑需保持 Novel Studio 运行。脚本按本机系统目录重新生成客户端与绑定，并写入 `NOVEL-STUDIO-TASK.md`；随后在 Codex 打开的本书项目中新建用户专属任务，以该文件作为首次消息。客户端文件、`server.json`、`.novel-studio-operator.json` 和旧 task/thread ID 不跨电脑复制。

安装前读工作区 descriptor 和应用 identity，校验项目及客户端；只创建/更新受管理文档和脚本。目标文件有作者修改或包含符号链接时保留现状并报错。Skill、完整初始化脚本、安装脚本与原始客户端已加入 extraResources；打包版使用 Resources/scripts 下的入口，自带所需文件，不依赖开发仓库。

## 验证与交付边界

- 自动测试覆盖：接口允许列表同步、跨书阻止、只读状态、内部镜像角色、确认记录、请求 ID/不自动重试、自定义文件保护、幂等安装、跨电脑本机重绑、任务说明生成、跨平台目录发现和打包后自包含安装。
- `npm run check`、`npm test`（315/315）、`npm run build` 通过；其中 operator 专项 19 项，构建保留原有大 bundle 提醒。
- skill-creator 的 `quick_validate.py` 已使用具备 PyYAML 的隔离 Python 环境运行，结果为 `Skill is valid!`。
- 两本现有书的安装、身份及状态读取成功，均连接 `creative-upgrade-2026.09.07-menu-zh.1`。
- 已向两个现有专属任务发送只读接手交接；明确保留其最新作者要求，不追加创作指令，不以交接授权接受候选或生成。
- 本次没有真实创作调用，没有修改正式书稿、候选状态、运行、审批、绑定或数据库，也没有新增任务或重启应用。
