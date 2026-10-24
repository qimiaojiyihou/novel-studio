# Claude Code 真实生成联调记录

日期：2026-10-24（Asia/Shanghai）。只使用临时虚构文本和内存数据库，没有打开真实书库，没有写入正式书稿。模型名称以下游 CLI 返回为准。

## 已验证

- CLI `auth status` 返回已登录。现有配置使用用户 settings 中的认证令牌和自定义服务地址，复用该配置发出真实请求；未输出或保存令牌。
- 普通文本生成返回“测试候选”。结构化生成返回 `{"text":"测试候选"}`。
- `smoke-claude-sdk.mjs --live --effort low` 成功：模型报告为 `claude-sonnet-4-6`，同一会话第二轮返回 `{"text":"第二版候选"}`，`contextReuse` 为 `delta`，会话 ID 保持一致。
- `smoke-claude-creative.mjs --live --model sonnet --effort medium` 经真实 `AgentRuntime → AgentGatewayRouter → ClaudeAgentGateway → SDK/CLI`，为两本虚构书各生成一份正文候选。
- 两本书的书籍工作目录独立、会话 ID 不同。CLI 以书籍目录作为 cwd，每次运行使用独立镜像。
- 两份候选均进入 `pending` / `waiting_confirmation`，实际后端为 `claude_sdk`，模型快照记录 `claude-sonnet-4-6`，SDK 请求传入 `effort: medium`；原正文仍为空，没有执行确认写入。思考强度是请求配置记录，不代表从模型内部读取到了实际思考量。

样本甲候选片段：

> 雨水顺着站台屋檐滴落，李明缩着肩膀等末班车。就在他低头躲雨的瞬间，脚尖碰到一个湿透的信封。

样本乙候选片段：

> 雨夜的站台空无一人，检票口的灯忽明忽暗。林沉提着行李准备离开时，脚尖踢到了什么——一封信，牛皮纸的封面被雨水洇湿了半边。

## 未完成的真实验证

完整创作脚本第三次请求（对样本甲正文进行第二轮改稿）返回 HTTP 403，错误为 `billing_error / insufficient balance`。因此完整创作脚本整体返回失败，未声称完整改稿链路通过。基础 SDK 的同会话二次修改此前已成功。遇到余额错误后停止继续发送模型请求。

需要补充当前自定义服务额度后，再运行上述创作脚本验证完整改稿。此次未验证所有模型、所有思考强度档位、外部桌面客户端项目注册或实际作者书稿。

## 联调中修正

1. 隔离 settings 时同时丢失了用户配置中的 CLI 认证。现在仅提取认证、服务地址和模型映射白名单，不加载用户钩子、插件和权限。
2. 自定义服务拒绝新增缓存字段 `cache_control.scope`。对自定义服务禁用可选提示词缓存，官方 API 保持原行为。
3. SDK 的 `StructuredOutput` 被通用文件工具权限回调误拦截。现在在结构化任务中明确允许该输出工具。
4. CLI 返回的余额错误文字含“Failed to authenticate”。现在优先识别 `billing_error` 并提示服务余额不足。

## 本地验证

- 全量回归：529 项通过，1 项跳过，0 失败；其中 HTTP 测试需在允许监听本机回环端口的环境执行。
- 补充余额错误处理后的定向回归：31 项通过，0 失败（Claude 执行器、项目目录、书库迁移）。
- `npm run check`、`npm run check:claude`、`npm run build` 通过。
- 尚未重新打包、覆盖安装、提交或推送这些改动。
