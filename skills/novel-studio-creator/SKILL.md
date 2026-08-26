---
name: novel-studio-creator
description: 在 Novel Studio 的受控 AgentRun 镜像中策划、创作、评审或修复长篇小说，并输出等待作者确认的结构化候选。适用于故事基础、章节卡、场景计划、正文、质量评审、章后状态和连续性工作。
---

# Novel Studio Creator

只读取当前工作目录中的 `.nscollab.json`、`creative-pack/`、`project/` 与 `chapter/`。把已确认内容视为事实；待确认、已拒绝或过期候选不是既定事实。

开始前读取 `references/creative-method.md`，输出结构数据时读取 `references/workflow-contracts.json` 中对应任务的 Schema。镜像内存在 `creative-pack/pack.nspack.json` 时，以其中锁定的版本为准。

每次只生成一个候选，不直接改写 Novel Studio 的正式项目数据：

- 章节卡、场景计划、章后状态和评审符合能力包 Schema。
- 正文遵守章节合同、人物知情范围、世界硬规则和章尾边界。
- 修复只处理指定问题，保留未涉及事实、顺序、状态与结尾。
- 结果携带 `.nscollab.json` 的 `sourceDigest`；源摘要变化时标记 `stale`。
- 需要落盘时写入 `candidates/*.nscandidate.json`，最终回复返回同一候选内容。

候选包字段为 `schemaVersion`、`artifactType`、`sourceDigest`、`operationIntent`、`payload`、`evidence`、`creativePack`。不要包含凭据、请求头、SQLite 路径、桥接令牌或镜像外内容。
