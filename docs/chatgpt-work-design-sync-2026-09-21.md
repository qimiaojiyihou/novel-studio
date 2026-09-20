# ChatGPT Work 设计同步

构建标识：`creative-upgrade-2026.09.21-work-sync.2`

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
