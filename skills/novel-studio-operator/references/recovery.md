# 恢复、边界和常见误用

| 现象 / code | 正确动作 |
|---|---|
| `TARGET_BUSY` | 读取 details.runId 或 details.finalizationId，继续原任务。两个字段同属一章也会占用；不要取消旧任务来强行新建。 |
| `SOURCE_STALE` / stale 候选 | 重读正式来源和差异，只比较或复制；根据作者意图重新生成或定位，不绕过摘要校验。 |
| `IDEMPOTENCY_CONFLICT` | 同一 request-id 被用于不同参数。先 request.get 核对原动作；真正的新动作才使用新 ID。 |
| 网络超时 / 回执丢失 | 先 request.get 原 ID，检查 runs.list 和候选；不要换 ID 重复启动。 |
| `REQUEST_INTERRUPTED` | 使用 details 中原运行/定稿 ID 核查实际结果；保留已写入结果，显式恢复原任务。 |
| `CONFIRMATION_REQUIRED` | 核对是否已获作者授权，再填写真实 reason 与 confirm；不要用空泛“已授权”替代用户决定。 |
| `FINALIZATION_REQUIRED` | 这是定稿子运行，读取 finalization.get，通过 finalization.act 处理。 |
| `PROJECT_MISMATCH` / 本地绑定不一致 | 停止操作，核对书籍 ID 和本任务客户端；不改绑定文件来绕过检查。 |
| `UNAUTHENTICATED`、模型认证/权限失败 | 请用户在应用核验连接/配置；不读取其他客户端、管理 token 或替换供应商。 |
| 连接拒绝 | 核对 Novel Studio 是否运行。客户端每次调用重读端口；不要启动旧安装包或重启另一任务使用中的应用。 |
| paused / failed | 读取 run.get 的步骤错误，区分恢复、重试、审批与结构修复；不能只按状态名盲目重试。 |
| waiting_approval | 读取 approvals.list；只有明确覆盖本动作的授权才能 approval.resolve，否则交给作者。 |
| waiting_confirmation | 有候选等决定，不是模型还在生成。 |

## 状态证据修正：局部修，不重跑全章

读取完整 finalization.get，保存其 `source_digest`、`stateDigest` 和问题路径。对照该记录对应的锁定正文，给已有条目补原文引句，或经作者确认略去本章没有证据的条目。

`finalization.act` 示例：

```json
{
  "id":"FINALIZATION_ID",
  "action":"correct-state",
  "sourceDigest":"当前记录的source_digest",
  "stateDigest":"当前记录的stateDigest",
  "corrections":[
    {"key":"characterStates","index":0,"quote":"逐字复制当前锁定正文中的证据"}
  ],
  "confirm":true,
  "reason":"记录实际核对及作者确认"
}
```

条目删除用 `{key,index,remove:true}`。key 只取 facts、characterStates、relationshipChanges、timelineEvents、foreshadow.setups、foreshadow.payoffs、openThreads。index 是本次读取数组的索引，不用旧索引。多段不连续原句以换行分隔；不补省略号或自己编写证据。修正后再读取记录，确认新状态和证据问题；最后另做 accept-state。

## 接口边界

外部接口覆盖已存在目标的候选生成、章节创建、候选决定、运行续接/控制与定稿。以下并未开放为通用外部操作：全局模型目录刷新与配置写入、项目偏好设置、任意 IPC、原始 SQL、书籍改绑、规划实体新增/删除、关系/情节弧/提示词等纯 renderer_draft 的自动持久化、批量跨设定联动应用。

遇到边界先报告缺哪个操作。若需要 GUI，先与另一任务协调独占界面，并核实当前书籍；不要同时控制同一窗口，也不要直改 SQLite、调试端口或借管理绑定接口扩权。应用支持某个页面功能，不代表外部 API 已支持相同动作。

## 模型和内容判断

作者指定 GPT-6 极高时，新创作运行明确传 `gpt-6-astra` / `xhigh`，并核对 run 中冻结设置与实际配置。续接旧运行保持原模型，模型切换要新运行并告知作者。模型不可用应显示原错误，不自动改成 MiMo/DeepSeek。

模型通过检查只是工程成功。重复句、空洞反转、机械短句、无目的对白和指令泄漏仍需读完整成稿判断；有效短句、人物自嘲和不工整表达不应被机械删除。只有已确认的正式设定和定稿交接进入后续事实；未接受候选、讨论方案与模型解释均不是事实。
