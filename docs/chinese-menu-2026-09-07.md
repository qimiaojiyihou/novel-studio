# 原生菜单中文化

构建：`creative-upgrade-2026.09.07-menu-zh.1`，基于当前 `dual-book.2` 工作区，保留全部暂存、未暂存与新增文件。

## 改动

- 新增 `electron/application-menu.js`，为应用、文件、编辑、视图和窗口菜单显式配置中文标签。
- 关于、服务、隐藏、退出、撤销、重做、剪切、复制、粘贴、全选、朗读、重载、缩放、全屏和窗口管理继续使用 Electron 原生 role 与默认快捷键，没有替换成自行实现的点击处理。
- 应用品牌保留 `Novel Studio`。macOS“服务”下由操作系统或第三方提供的服务名称仍由系统管理。
- 主进程在创建窗口前设置菜单。没有改动书库 schema、模型路由、候选、审批、定稿或双书接口。

## 验证

- `npm run check`、`npm test`（257 项通过）、`npm run build`、`git diff --check` 通过。
- 新增菜单单元测试覆盖 macOS、Windows、Linux 的中文标签和原生角色。Windows/Linux 为模板测试，未进行对应平台桌面实测。
- 新增 `scripts/smoke-application-menu.mjs`：首先查询实际数据库路径并断言独立临时目录，然后读取运行中原生菜单并验证缩放从 0 增到 0.5、还原至 0；没有模型请求或真实书稿写入。
- 已在旧 `.2` 安装包上验证新菜单测试失败，实际返回 `File/Edit/View/Window`；在新包验证通过。派发菜单动作使用 Electron `MenuItem.click(event, focusedWindow, focusedWebContents)`，不能遗漏第三个参数。
- 新包菜单测试证据：`/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-menu-smoke-SQwmFH/menus.json`。
- 新包双书隔离、Mock 并行、来源冲突和重启恢复测试通过：`/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-dual-desktop-9RNbZD`，仅 2 次模拟请求。
- GitNexus 当前未索引本仓库，未使用其他仓库的图；采用本地调用点核查、最小改动及隔离测试作为验证，没有创建提交或改变已有暂存区。

## 安装与数据保护

- 当前安装与运行：`/Applications/Novel Studio.app`。旧启动入口 `release/mac-arm64/Novel Studio.app` 同步更新。两份安装结果的 `app.asar` 与测试包逐字节一致。
- 新包：`release-2026.09.07/menu-zh/mac-arm64/Novel Studio.app`。
- 备份：`release-2026.09.07/menu-zh/backup-before-menu-zh-1/`，包含完整 SQLite 在线备份、两份旧应用、退出和更新后的审计报告。旧进程正常退出，没有强制终止真实应用。
- 更新后 `quick_check=ok`、`manuscriptsUnchanged=true`，没有新增表。旧表中仅当前项目和 9 个内置提示词记录的 `updated_at` 更新，其余内容及全表摘要不变，包括书稿、设定、版本、候选、运行、定稿与客户端绑定。
- 两个原有专属客户端分别只读调用 `identity` 成功，仍返回自己的固定项目和新构建。
- 已通过实际安装应用的原生无障碍菜单核验顶部“文件、编辑、视图、窗口”及应用下拉菜单“关于 Novel Studio、服务、隐藏 Novel Studio、隐藏其他应用、显示全部、退出 Novel Studio”。
