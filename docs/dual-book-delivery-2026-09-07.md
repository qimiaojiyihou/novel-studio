# 双书创作接口交付记录

## 当前状态

实现、单元/并发测试、源码桌面测试与打包应用桌面测试已完成。作者明确同意“正常退出并更新应用”后，已正常退出旧进程，更新并启动 `.2`，完成真实双书绑定与只读身份验证，并创建两个用户专属创作任务。

当前运行 `/Applications/Novel Studio.app`，界面与主进程服务发现均核验为 `creative-upgrade-2026.09.07-dual-book.2`；原 `release/mac-arm64/Novel Studio.app` 启动入口也同步更新。没有强制结束进程，没有代替作者确认交接，没有启动真实模型创作测试。首次任务仅只读接手汇报，等待作者继续指令。

## 构建与项目身份

- 已安装与当前运行的旧应用均报告 `creative-upgrade-2026.09.07-finalize.1`，两份 asar 字节摘要不同，分别备份。
- 新构建：`creative-upgrade-2026.09.07-dual-book.2`（包含交接保存反馈修复）。
- 新应用：`release-2026.09.07/dual-book/mac-arm64/Novel Studio.app`。
- 悬疑：`project-d55c5ab7-f1d2-4461-84c5-36c947698de4`，精确书名《别让他接我回家》。3 章，前 2 章已定稿，第 3 章《她还等他回来吵》仍为草稿/交接待核对。
- 文娱：`project-3dd77038-9464-4b12-903c-5c7ee6d6dbee`，精确书名《我一个明星，会亿点手艺很正常吧》。1 章，《第一章 夜市上岗》，草稿。
- 两个现有 Codex 书籍目录内的 `.novel-studio-project.json` 已只读核验，ID 与真实库一致；悬疑目录仍保留旧目录名 `第二位家属`，不得用这个名称猜测身份。

## 实施范围

主进程持有项目能力凭据与接口；项目队列、持久化请求幂等、目标占用、跨项目资源验证；外部作者可以直接提交候选，也能启动现有 AgentRun；沿用 ACP/exec、模型锁定、正式确认与定稿。

新增只读进度接口不调用模型或失效更新。审批过期处理按指定项目/运行/审批范围执行。前台收到外部更新时提示刷新，不覆盖未保存正文；旧编辑缓冲保存时检查来源正文。运行事件携带项目身份，前台切换不会改变外部任务身份。

详见 [接口协议与客户端用法](./dual-book-creative-interface-2026-09-07.md)。

## 测试证据

- `npm run check`：通过。
- `npm test`：255 项通过，0 失败；其中 9 项新增接口测试。
- `npm run build`：通过；保留原有大块体积提示，没有为体积做无关重构。
- `git diff --check`：通过。没有提交或改动已有暂存区。
- 双书桌面：两次本机 Mock 生成确实同时在途；切书、跨书拒绝、重复请求、正式接受、外部提案、旧稿冲突、重启后令牌与回执恢复通过。
- 单书桌面：原有独立审稿、交接证据修正/确认、审批、键盘菜单及 1440/1080 宽度的 14 个页面布局检查通过。
- 打包应用已验证 `uiEntry=built`、schema v24、外键开启、Codex runtime 完整性 `verified`，ACP 1.6.2 / CLI 0.153.4。没有发出真实创作请求。
- 最终打包双书测试目录：`/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-dual-desktop-6bM0ir`。
- 最终打包单书测试目录：`/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-creative-smoke-zmqOFw`。
- 最终 `.app` 内主进程、接口、运行和审批代码已与当前工作区逐文件字节比对一致；两份旧应用的备份 asar 与原件也逐字节一致。
- 每个测试在首次 fixture 写入前查询 SQLite 或主进程返回的实际数据库路径，再核验位于独立测试目录。Mock 仅证明工程流程，不代表创作质量或真实模型速度。

## 已有备份

### 后续修复：交接修正按钮看似没有反应

用户再次报告 `finalize.1` 的“保存修正并本地重验”没有反应。经源代码和真实旧构建的打包脚本核对，按钮有两条缺少反馈的路径：没有修改时重验返回相同问题状态，没有保存结果说明；有修改但说明为空时按钮被静默禁用。

`.2` 在按钮附近显示错误与结果；空说明时聚焦输入框并保留全部修改；请求中显示“正在保存并重验”；成功时显示保存数量、剩余来源问题或最终确认指引。没有取消后端的原因必填、来源摘要和证据校验，也没有替作者修改真实交接。

`.2` 最终打包应用复测通过：交接修正/单书界面证据在 `/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-creative-smoke-qqpovZ`；双书并行/重启证据在 `/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-dual-desktop-aFBqwI`。包内构建标识和新增反馈文案已核验。

已先用新增桌面断言在 `.1` 复现失败，再验证 `.2` 通过无改动重验、缺少说明、成功保存、轮询保留表单与两次 Mock 调用总数。源码桌面证据目录：`/var/folders/st/d48pvkt57c7ghblm7cbbpy0c0000gn/T/novel-creative-smoke-7nRlzC`。`npm run check`、255 项测试、`npm run build` 重新通过。当时安装等待作者确认；后续正式安装情况见下文。

### 安装前的备份

目录：`release-2026.09.07/dual-book/backup-before-20260907-0253/`。

- `novel-studio.before.sqlite`：真实库在线备份，权限 0600，`PRAGMA quick_check` 为 `ok`。
- `before.json`：每个表的记录数与完整行摘要，所有现有书籍的章节身份、状态、正文摘要；不存储明文密钥。
- `read-only-verification.json`：真实库复核 `manuscriptsUnchanged=true`、`changedTables=[]`、`addedTables=[]`。
- `Novel Studio.installed-before.app`：`/Applications` 中的旧应用副本。
- `Novel Studio.running-before.app`：当前 release 目录运行应用副本。

备份含私人书库数据，不应提交到仓库或公开分享。若作者在等待期间保存了新修正，更新前创建新的备份与摘要，后续比对以新备份为基线，不覆盖此副本。

## 安装、绑定与数据验收（已完成）

- 正常退出旧应用：先通过应用退出菜单完成保存关窗，再发送正常退出快捷键退出无窗口的主进程；确认旧 PID 已结束，没有使用强制终止。
- 最新备份目录：`release-2026.09.07/dual-book/backup-install-20260907-v2/`。含真实库完整在线备份、`before.json`、退出后复核 `after-quit.json`、安装绑定后复核 `after-update.json`，以及两份可恢复旧应用 `Novel Studio.installed-before.app` / `Novel Studio.running-before.app`。
- `/Applications` 和旧 release 启动入口均安装已测试 `.2`；两份安装结果的 `app.asar` 与测试通过的构建逐字节相同。当前 UI 使用 `/Applications` 中的应用，保留浅色界面，书库路径仍是 `/Users/weiqifeng/Library/Application Support/novel-studio/novel-studio.sqlite`，schema v24、外键开启。
- 退出后全表摘要不变。更新绑定后 `quick_check=ok`、`manuscriptsUnchanged=true`。仅新增 `creative_clients` 和 `creative_requests`；旧表仅 `app_settings.active_project_id` 与 9 个内置 `prompt_templates` 的 `updated_at` 改变，值和模板内容不变。其余旧表完整行摘要相同，包括项目设定、章节、版本、候选、运行、审批及定稿历史。
- `suspense-author` 与 `entertainment-author` 已通过管理端按固定 ID 和精确书名绑定；分别读取 `identity` / `snapshot`，返回对应书籍、章节和构建 `.2`，没有调用模型。凭据位于用户数据目录下 `creative-interface/clients/`，正文或文档不保存令牌。
- 悬疑第 3 章当前定稿为 `finalize-13ea3e98-04a5-4705-b318-94185d623d9e`，仍是 `waiting_state_correction`，保留 4 处待核对来源，原审稿模型锁定 `gpt-6-astra / xhigh`。更新没有替作者处理这 4 处，也没有重新生成。

## 两个用户专属创作任务

测试与正式绑定结果已先汇报，再创建任务；两个保存项目均经 `list_projects` 重新核验为非 Git 项目，使用 `local` 环境。

- 悬疑任务：`01a0781c-d415-7803-a2d0-a79c3758ec07`，Codex 保存项目 `ad45c470-3ee9-4fe5-99dc-08536bbf809c`（历史目录名“第二位家属”）。
- 文娱任务：`01a0781c-e91e-7cb1-b343-90095511d832`，Codex 保存项目 `d2d5c386-76b8-4ea6-95da-b8009e7ca792`。
- 初始提示携带固定书籍 ID、各自凭据路径、接口文档与客户端用法、当前章节/定稿进度、原有创作约束、来源检查与幂等/审批要求。初次只读进度并汇报，等待用户继续；没有授权自动续写、接受候选、恢复模型或修改交接。
- 两任务的初始只读接手均已完成，`wait_threads` 确认状态 `idle`，各自已汇报进度并等待用户。悬疑任务指出第 3 章四条人物状态的证据来源待核验；文娱任务指出历史候选来源过期及现有草稿中混入创作说明等问题，均未擅自处理。首次任务完成后再次核验书库，报告 `after-task-readonly.json` 仍为书稿不变，仅启动时间戳变化及两个接口扩展表。

## 原定交付顺序（供复核）

1. 正常退出旧应用，确认没有未保存编辑或真实模型仍在执行；不强行取消作者的交接。
2. 重新只读审计真实库并生成新在线备份。安装测试过的新应用，核验实际构建标识和数据库路径。
3. 用接口管理端绑定 `suspense-author` 和 `entertainment-author`，同时核对固定 ID 与精确书名。只添加绑定元数据，不运行创作。
4. 两份凭据分别读取 `identity`、`snapshot`，验证切书无关；比对安装前后书稿/设定/历史摘要，单独解释新增接口表及衍生缓存变化。
5. 先汇报测试与正式绑定结果，再使用 Codex 任务管理工具创建两个用户可继续交互的任务。现有保存项目均不是 Git 仓库，应使用 `local`，不是工作树或临时子 Agent。
6. 每个新任务携带自己的固定 ID、专属凭据路径、协议文档、当前进度与原有创作约束。只负责自己的小说，不修改应用代码、不直接访问 SQLite、不操纵公共窗口、不读取其他客户端或管理凭据。
7. 初始仅只读核验和汇报，等待作者继续指令；正式写入需要作者针对候选/交接的确认。创建真实模型测试须另行获批。

创建前重新调用 `list_projects` 核验保存项目：悬疑上次 ID `ad45c470-3ee9-4fe5-99dc-08536bbf809c`，文娱上次 ID `d2d5c386-76b8-4ea6-95da-b8009e7ca792`。任务名称不作为 Novel Studio 的绑定标识。
