# Creative Pack v1

Creative Pack 是声明式创作能力包，定义任务模板、Prompt Profile、结构 Schema、Agent 工作流、评测和参考方法，不包含可执行 JavaScript、Go 或 Shell，也不保存模型地址与凭据。

官方通用包源码位于 `creative-packs/general-longform`。运行 `npm run build:creative-packs` 会校验并封装 `.nspack.json`，同时从同一来源生成 `novel-studio-creator` Skill 的创作方法与工作流合同，避免两套提示词独立维护。

提示词编译顺序为：受保护事实与结构协议、项目锁定能力包、用户任务模板、三级文风、叠加提示词、本次要求、受保护输出合同。后置自定义内容不得削弱结构、候选确认、世界硬规则和章节边界。
