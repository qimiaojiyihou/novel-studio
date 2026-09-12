# Qoder 外部创建规划实体交付

## 完成内容

项目绑定的外部创作接口新增四个写操作，Qoder 与 Codex 外部专属作家任务共用同一套能力：

- `planning.entity.create`：新建人物、世界元素/地点或分卷卡。
- `planning.relationship.create`：在同书人物卡之间新建人物关系。
- `planning.arc.create`：新建跨卷情节弧。
- `planning.arc-beat.create`：给情节弧新增分卷或章节节点。

这些操作直接复用界面已有的规划仓储和 IPC，不建立第二套数据。调用由客户端绑定确定项目，关联 ID 必须属于同一本书；写入进入项目队列，要求稳定 request-id，并记录 `confirm:true` 与实际 `reason`。响应丢失后使用原 request-id 会返回同一对象，不会重复创建。

Qoder 先通过 `status` / `snapshot` 读取正式项目，再按 `skills/novel-studio-operator/references/workflows.md` 的参数创建对象。人物、世界元素、地点和分卷建立后，可使用响应对象的 `id` 作为 `planning_entity_bundle` 的 targetId，让当前保存的 Qoder ACP 配置补全整张卡。情节弧与节点在创建时直接提交结构化字段。

## 接口与测试证据

- 主进程入口：`electron/creative-interface.js`。
- 外部操作脚本：`skills/novel-studio-operator/scripts/operate.mjs`。
- 操作说明：`skills/novel-studio-operator/SKILL.md` 与 `references/workflows.md`。
- 自动测试覆盖正式创建、快照更新、重复请求回放、未确认阻止、类型校验和跨书关联阻止。
- `npm run check` 通过。
- `npm test` 通过：306/306。
- `npm run build` 通过；保留 Vite 原有大 chunk 提醒。

## 安装与发布

运行构建标识：`creative-upgrade-2026.09.11-qoder-planning-create.1`。

- macOS arm64 DMG：`release-2026.09.11/qoder-planning-macos/Novel Studio-0.1.0-arm64.dmg`
  - SHA-256：`117960fe061b3733b332f5c3d7d4a3d51cef1fff918219433801b46732558701`
- macOS arm64 ZIP：`release-2026.09.11/qoder-planning-macos/Novel Studio-0.1.0-arm64-mac.zip`
  - SHA-256：`0e42e6bb19007e61b406fde2c1a03c22e86f36c1a602c615be482f8e1ce742a2`
- Windows x64：`release-2026.09.11/qoder-planning-windows-x64/Novel Studio Setup 0.1.0.exe`
  - SHA-256：`e64927aba733bf4b29e6d6a05327ad6e7e01e626893e13eb7a2bc68ede679b62`

macOS 新包已安装到 `/Applications/Novel Studio.app` 并启动。安装包与已安装应用的 `app.asar` SHA-256 均为 `2eb9f345a4980a038a9748729264130cb9cafc9dc0ca1a42f949f606146324a0`。运行中的外部接口返回上述新构建标识与原数据库路径。

安装前备份位于 `release-2026.09.11/backup-before-qoder-planning-20260911-0100/`，包含旧应用及 SQLite 在线备份。备份与安装后数据库检查均为 `ok`，项目、章节和规划实体数量分别保持 28、93、31；本次没有向真实书籍创建测试规划对象。

四个已有书籍工作区已由安装包内的受保护安装器更新，每个工作区更新 3 个受管理文件，并分别通过只读 identity 核对；作者自定义文件、书稿和客户端凭据未改写。
