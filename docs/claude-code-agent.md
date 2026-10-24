# Claude Code 创作执行器

Claude Code 与 Codex、Qoder 并列，属于创作 Agent，而非普通 Claude API 模型。内部沿用旧版 `executionMode: codex` 兼容标记，以 `agentProvider: claude` 区分提供方，实际后端为 `claude_sdk`。

## 使用

1. 安装官方 Claude Code，终端执行 `claude auth login` 完成登录。
2. Novel Studio → 模型与任务路由 → Agent 提供方 → Claude Code。
3. CLI 路径可留空自动检测（支持 PATH、`~/.local/bin`、`~/.bun/bin` 等），或填写实际可执行文件路径。
   npm/bun 安装产生的脚本符号链接会解析到真实入口，并使用应用自带的 Node 运行时启动，避免启动台启动时依赖终端 PATH。
4. 选择本机登录，或环境 API Key。后者要求启动应用的进程环境中有 `ANTHROPIC_API_KEY`；不将 Key 写入数据库或传给渲染器。本机登录模式排除继承的 API Key，避免意外切换计费方式。
5. 点击“测试 Claude Code SDK / 刷新模型”。诊断仅读取本机认证元数据和模型目录，不发送模型请求，目录也不保证账号实际模型权限。
6. 选择 Claude Code 默认模型与思考强度。模型目录和可用强度优先取 CLI 能力信息；较旧 CLI 未提供能力信息时，列出 SDK 档位供实际调用验证。支持模型默认、low、medium、high、xhigh、max；具体可用性以选中模型和服务返回为准。Claude 的强度单独保存，切换提供方不会覆盖 Codex 的推理设置。
7. 保存 Agent 设置。章节生成、续写、选段重写、设定与规划、整页/整卡生成、朱雀辅助改稿、审稿、章后状态、连续性审计及根设定联动沿用现有入口。项目默认创作方式需选择创作 Agent；单次按钮下拉也可覆盖。

已有运行记录固定提供方、模型和思考强度，不因全局设置切换而转发给另一家。Claude Code SDK 支持流式输出、结构化候选、会话 ID 续接及取消；失败不会自动切换到 Codex/Qoder。候选确认、正文保护、版本与旧稿过期检查仍由 Novel Studio 处理。

## 每本书独立项目

每本书在当前书库的 `claude-projects/书名/` 下有稳定目录，以项目 ID 识别。同名书分开，改书名保留原目录；新书立即建立，旧书在启动时补建。CLI 的 `cwd` 使用本书目录，因此 Claude Code 的会话按书归类；每次创作仍使用 `claude-workspaces/AgentRun ID/` 独立镜像，续接保持同一个会话 ID。

书籍菜单的“打开 Claude Code 书籍目录”会在文件管理器中显示该目录，不依赖桌面应用的私有项目注册接口。这里的项目是 Claude Code 的本地工作目录，并非 claude.ai 云端 Projects。目录内有 `CLAUDE.md`、`AGENTS.md` 和项目描述；不会复制正式书稿。迁移书库时同时迁移 Claude 项目和任务镜像。

## 文件与权限

CLI 工作目录为本书归类目录，额外目录仅包含当前任务镜像，不将真实书库根目录作为额外访问目录。禁用用户/项目 settings、插件和外部 MCP 自动加载。本机 CLI 认证模式仅从用户 settings 的 env 中提取认证令牌、服务地址和模型映射白名单，直接传给 CLI 子进程，不保存到书库、日志或前端；不加载用户权限、钩子或任意环境配置。自定义服务默认禁用可选的提示词缓存字段，兼容不接受新缓存协议的网关，官方 API 保持默认行为。

只开放精确文件 Read/Write/Edit；不开放 shell、子 Agent 或目录递归扫描。PreToolUse 对包括默认自动允许的读取在内的每次文件操作做真实路径、符号链接和数据库保护检查；镜像写入仍需应用内逐次审批。SDK 的 StructuredOutput 工具只负责返回候选 JSON，由钩子和权限回调明确允许。镜像文件写入不等同于确认写入正文。

这是应用层工具限制，不是通用 OS 沙箱；系统管理员策略、官方 CLI 的认证与会话文件由 CLI 自行维护。SDK/CLI 版本升级后需重跑权限和会话回归测试。

## 开发验证

```sh
node --test tests/claude-agent-gateway.test.js tests/qoder-agent-gateway.test.js tests/codex-agent-gateway.test.js
node scripts/smoke-claude-sdk.mjs
# 可选：两个虚构小样请求，消耗当前账号额度，不发送用户书稿
node scripts/smoke-claude-sdk.mjs --live --effort low
# 两本临时虚构书，真实生成、独立项目、候选存储和改稿续接
node scripts/smoke-claude-creative.mjs --live --model sonnet --effort medium
npm run check
npm run build
```

SDK 固定版本为 `@anthropic-ai/claude-agent-sdk@0.3.310`，本机 Claude CLI 独立安装更新。模型目录来自 CLI，不在代码中硬编码模型版本。凭据无效或模型权限不足时显示官方错误，重新登录或调整认证/模型后重试。订阅及 API 计费以 Anthropic 账号规则为准。

官方资料：<https://code.claude.com/docs/en/headless>、<https://code.claude.com/docs/en/agent-sdk/permissions>。
