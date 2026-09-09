# 人工直接定稿

构建：`creative-upgrade-2026.09.07-manual-finalize.1`。沿用 schema v24，无真实书库迁移。

## 操作

人工修改正文后，点击“完成本章”，在顶部“本次定稿方式”选择“人工直接定稿（跳过审稿与交接）”，再点击“确认直接定稿”。打开面板前先完成当前编辑稿保存；说明选填，不需要声明仅改错字或含义不变。

人工直接定稿适用于首次定稿和实质改写后的再次定稿。完成后显示“已定稿·人工”及“未审稿 · 交接未更新”。再次改正文显示“修订待定稿”，可再次直接定稿；保存相同正文或另存版本不降级。

“审稿并交接”仍保留原完整流程，包括独立审稿、引句核对、模型锁定和正式交接确认。“定稿后校正”仍可在存在可沿用的原审稿时使用。人工直接定稿之后没有新审稿可供校正沿用；需补做时切换回完整流程。

## 数据边界

- 直接定稿只处理已保存正文，主进程重新核验项目与章节身份、正文摘要和预览指纹。空白正文拒绝提交；本地字数或文学提示不强迫作者调用模型。
- 明确的 confirm、skipReview、skipHandoff 和稳定请求 ID 必需；同请求重试返回已有记录，不重复生成版本。预览后内容或定稿改变时先刷新。
- 原子事务创建新的 revision 与 completed 定稿记录，审计位于 checks.manualFinalization。review/state 为空，reviewer.executionMode 为 manual，不创建 AgentRun、模型候选或知识候选。
- 历史审稿、历史交接、候选和版本保留。已有章节记忆标为 needs_review，不冒充新稿已确认交接；后续创作上下文明示人工定稿且未生成交接，以正文为准。更早的有效交接带章节号，不称作最新上一章状态。
- 同项目队列和现有目标占用校验仍有效。正在生成、待审批或暂停的冲突运行不会被自动取消或接受。正文来源变化照常使旧版本过期；旧交接依赖过期不降级较新的人工定稿。
- 之后补做完整审稿时创建新的定稿记录，不将人工定稿之前的同文旧审稿重新认作本次结果。备份沿用原 JSON 重映射，保留人工决定及历史链接。

## 专属任务接口

`finalization.manual-preview`（只读）：`{ chapterId }`。

`finalization.manual`（写入）：传入预览返回的 chapterId、sourceDigest、previewDigest，加 confirm:true、skipReview:true、skipHandoff:true；reason 选填，外层稳定 requestId 必填。此操作仅在作者明确选择该模式时使用，不作为模型报错、审稿耗时或分数不理想时的自动处理方式。

预览与确认分别映射主进程 `chapter:manual-preview` 和 `chapter:manual-confirm`。界面和外部专属任务使用同一受控实现，不直接写原始书库。

## 验证

- `npm run check`、`npm test`、`npm run build`。
- `tests/chapter-manual-finalization.test.js` 覆盖无审稿配置、实质改写、空稿、明确选择、旧源冲突、同目标竞争、跨项目、重复请求、重启回执、历史交接失效隔离、事务回滚、备份、后续完整审稿及运行占用。
- `tests/operator-skill.test.js` 核验允许清单、明确跳过的前置校验、说明选填和状态投影。
- `scripts/smoke-creative-upgrade.mjs --development --handoff-repair --proofreading --manual-finalization` 核验真实编辑器自动保存、可见预览过期反馈、空说明提交、重复编辑定稿、刷新状态、焦点、原校正流程及后续完整审稿入口。标准流程用 2 次本机 Mock，人工定稿新增调用为 0。
- 所有测试先核对 SQLite 或运行时返回的实际数据库路径位于独立临时目录，再写入模拟书籍；不运行真实模型、不修改真实书库。
