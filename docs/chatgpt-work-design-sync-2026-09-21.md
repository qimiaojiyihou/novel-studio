# ChatGPT Work 设计同步

构建标识：`creative-upgrade-2026.09.21-work-sync.5`

## 目标

让 ChatGPT Work 中持续讨论并确认的小说设计，以可核对、可追踪的增量包同步到 Novel Studio。Work 对话是设计来源，Novel Studio 仍是正式书库；同步不依赖当前前台选中的书，也不直接操作原始 SQLite。

## 使用流程

1. 在作品菜单中选择“同步 ChatGPT Work 设计”。
2. 粘贴该书固定 ChatGPT Work 对话的任务 ID 或完整链接，并保存绑定。
3. 第一次选择“首次全量同步”，应用会生成用于汇总全部已确认设计的提示词；建立基线后，入口自动切换为“后续增量同步”。复制提示词并粘贴到同一个 Work 对话。
4. Work 按提示只返回一个 JSON 对象。把它粘回同步窗口，点击“检查更新”。
5. 核对新增、更新、绑定对象和冲突。勾选确认后写入 Novel Studio。
6. 下一轮继续在同一 Work 对话中设计；选择“后续增量同步”，新包使用新的 `packageVersion`，`baseVersion` 填上次成功版本。

首次全量和后续增量是互斥阶段：尚无成功版本时，增量入口保持禁用；基线成功写入后，全量入口显示“基线已建立”并停止重复使用。主进程同时校验阶段，即使绕过界面也不会把增量提示词误用于首次同步，或重复建立第二份全量基线。

## 可同步范围

- 项目题材、故事种子、项目文风；
- 故事基础、世界设定、故事总纲；
- 人物、世界元素、分卷；
- 人物关系；
- 章节标题、章节卡、场景计划；
- 情节弧和情节节点；
- 正式事实、时间线、伏笔。

正文、候选接受、审批、定稿、删除和全局模型设置不在同步包范围内。正文仍由 Novel Studio 的创作、候选确认和定稿流程处理。

## 包格式

```json
{
  "schemaVersion": 1,
  "packageVersion": "RW-20260921-001",
  "baseVersion": "",
  "sourceThreadId": "绑定的 Work 对话 ID 或链接",
  "projectId": "Novel Studio 项目 ID",
  "summary": "本轮已确认的设计变化",
  "project": { "genre": "", "idea": "", "style": "" },
  "documents": { "foundation": {}, "world": {}, "outline": {} },
  "entities": [
    { "ref": "character.protagonist", "kind": "character", "title": "人物名", "data": {} },
    { "ref": "volume.001", "kind": "volume", "title": "第一卷", "data": {} }
  ],
  "chapters": [
    { "ref": "chapter.001", "title": "第一章", "card": {}, "scenePlan": "" }
  ],
  "relationships": [
    { "ref": "relationship.a-b", "fromRef": "character.a", "toRef": "character.b", "label": "关系", "direction": "mutual", "trend": "stable", "status": "active" }
  ],
  "arcs": [
    { "ref": "arc.main", "title": "主线", "beats": [{ "ref": "beat.main.001", "label": "变化", "chapterRef": "chapter.001" }] }
  ],
  "knowledge": [
    { "ref": "fact.identity", "kind": "fact", "title": "身份事实", "content": {}, "status": "open" }
  ]
}
```

没有变化的顶层字段可省略。已有对象更新时继续使用第一次发布的 `ref`；未提供的项目字段和章节场景计划保持原值。规划文档、卡片和知识内容按字段合并，避免一次小改动清空其他字段。

## 数据保护

- 绑定校验：包中的项目和来源对话必须与当前书一致。
- 版本校验：`baseVersion` 必须连续，同一 `packageVersion` 不可承载不同内容。
- 预览校验：预览后书库发生变化会拒绝旧预览，需重新检查。
- 对象校验：关系和情节节点只能引用本包或既有映射中的本书对象。
- 幂等与恢复：成功包重复提交直接返回原结果；每项写入都有结果记录，应用中断后标记为可重新检查的失败记录。
- 正文保护：章节同步仅更新标题、卡片和场景计划，不传递或改写 manuscript。

## 跨电脑说明

Work 对话本身位于云端，但同步绑定和版本历史随 Novel Studio 书库保存。迁移到另一台电脑时，先按现有备份/恢复流程迁移书库；恢复后可继续使用原 Work 对话和版本链。Codex 专属任务仍需在新电脑上按本机路径重新生成，二者不是同一种绑定。

## 本机安装验证

- 已覆盖安装 `/Applications/Novel Studio.app`；安装包内回读构建标识 `creative-upgrade-2026.09.21-work-sync.5`，作品菜单保留“同步 ChatGPT Work 设计”。

## 兼容性修复（work-sync.3）

- ChatGPT Work 将“已确认且当前有效”的知识条目写成 `status: "confirmed"` 时，导入器会将其归一化为 Novel Studio 的 `open` 状态。
- 已经在旧构建中预览、部分写入并因该状态失败的同步包，可以在新版中直接再次确认写入；已完成的操作会跳过，只继续剩余条目。
- 新生成的同步提示词明确限定知识条目状态为 `open`、`resolved` 或 `archived`，并在预览阶段拦截其它未知状态。

## 中断恢复入口（work-sync.4）

- “最近版本”会为写入中断的同步包显示“继续写入”，恢复原差异预览并跳过已经完成的操作。
- 尚未确认的预览会显示“继续确认”，不必重新寻找或粘贴原始 JSON 同步包。

## 完整结构可见与设定决策（work-sync.5）

- ChatGPT Work 写入的自定义结构字段会在故事基础、世界设定、全书规划、人物卡、世界卡、分卷卡和知识条目中显示为“外接同步详细设定”。
- 字符串、数字、布尔值、数组和对象都可查看；结构化字段按 JSON 编辑，保存时保持原有数据类型。
- 同步提示词要求逐条保留现行设定决策，不再把决策台账压缩成摘要。已确认、暂定、待核对和为防止旧版回流而归档的决策均可保留。
- 设定决策沿用事实库，类别为“设定决策”，并保留决策编号、采用理由、关联模块、待确定问题与来源。
- 《现实遗物》已完成 `RW-20260921-001`（153 项）和 `RW-20260921-002`（205 项）写入。后者包含 175 条设定决策和 30 条伏笔；逐字段核对 2,080 个来源字段，缺失和内容差异均为 0。
- 写入后真实书库 `PRAGMA quick_check(1)` 为 `ok`；本书仍只有 1 个空白章节、正文 0 字，设计同步未改动正文。
- 本轮安装前在线备份：`release-2026.09.21/chatgpt-work-sync/backup-before-work-sync5/novel-studio.sqlite`。此前完整旧应用和安装审计仍保留在 `release-2026.09.21/chatgpt-work-sync/backup-before-20260921-014824/`。
- 备份和升级后 `PRAGMA quick_check` 均为 `ok`；五本未归档书籍、章节状态和正文摘要逐项一致。升级只更新迁移/应用设置相关表，并新增三张 Work 设计同步表。
- 已安装 `app.asar` 与测试构建逐字节一致，SHA-256 为 `ebad24fc2bc62556ada30153ca6228deb0b729834966d9fc8f031fbbedef5320`。
- DMG SHA-256：`fba9812ff66a602eab6219a29360b43c11779f17fda2b9e8d9f0d07b7e8dc077`；ZIP SHA-256：`cf044b896800c3f69bc0b436e484324a8d43936934665fbcafde85e5c1a10f4f`。
