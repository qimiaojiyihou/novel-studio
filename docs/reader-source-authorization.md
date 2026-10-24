# 阅读站书源授权

## 用户使用方式

“网络书架 → 管理书源 → 登录配置”显示真实能力和状态：

- 支持自动回传：点击“准备自动授权”，复制生成的专属地址访问原站。服务方按协议完成回传后，授权加密保存，原阅读页自动更新。入口不自动打开新标签；重复准备复用同一待处理任务。
- 旧书源：原站登录与阅读站互相独立。领取密钥/Cookie 后填写一次，空字段保留已存值。保存后直接复用，仅在过期时更新。现有“番茄小说2”属于此类；它只有领取密钥动作，没有声明登录回调，不能把打开页面当作授权成功。
- 存在 `loginCheckJs` 的书源保存后自动验证，也可点击“验证已保存授权”；检查脚本须返回布尔值。只保存了密钥、检查规则缺失或返回值不符，均不会显示“已登录”。“上次验证通过”附实际验证时间，不承诺未来一直有效。
- iframe/不同浏览器隔离导致回调页没有原账号会话时，回调页不会匿名写入。可显式复制该页的完整“授权回执”，返回原阅读页的“回到原页面后未自动完成？”粘贴；不用拆开填写 Token/Cookie。回执含登录凭据，只粘贴到自己发起的对应授权任务，不应转发。
- 关闭面板/退出/取消会停止轮询并取消当前等待；超时、服务重启、原阅读登录会话失效、书源停用或规则变化后，需要重新准备。已有正式书籍和原授权配置不会因取消等待而删除。

## 服务方接入：fragment-v1（Novel Studio 扩展）

这不是通用 OAuth 客户端，也不会自动抓取任意站点的 Cookie。服务方需明确支持此协议，且用户需登录/授权自己的账号。旧 Legado JSON 未声明此扩展时保持一次手动保存模式。

在书源 JSON 增加以下字段（其余搜索、目录、正文规则照常提供）：

```json
{
  "loginUi": [{"name": "密钥", "type": "password"}],
  "novelStudioAuth": {
    "protocol": "fragment-v1",
    "authorizeUrl": "https://books.example.org/authorize",
    "parameters": {"token": "密钥"},
    "redirectParameter": "redirect_uri",
    "stateParameter": "state",
    "cookie": false
  },
  "loginCheckJs": "JSON.parse(java.ajax(source.bookSourceUrl + '/session-check')).authenticated === true"
}
```

授权入口须为 HTTPS，处于书源同域或用户明确配置的 `novelStudioAllowedOrigins` 内。参数映射仅指向 `loginUi` 已声明的非按钮字段；`cookie:true` 才接收 Cookie，且仅用于该书源域名。示例检查接口须自行实现真实凭据校验；上面的示例不意味着某个现有番茄服务已经提供该接口。

阅读站给入口追加 `redirect_uri`、一次性 `state`、公开源 ID `novel_source` 和任务 ID `novel_flow`。服务方完成登录后跳转到给定回调地址，所有凭据放在 fragment，**不要放 URL 查询参数**：

```text
https://READER_HOST/source-auth-callback#sourceId=SOURCE_ID&flowId=FLOW_ID&state=STATE&params=URL_ENCODED_JSON
```

`params` 是 `encodeURIComponent(JSON.stringify({token:实际授权值}))`。`SOURCE_ID/FLOW_ID/STATE` 原样来自入口参数；Cookie 可作为独立片段字段 `cookie` 传递，仅限明确声明接收 Cookie 的书源。回调脚本立即清除地址栏片段，再以同源 JSON POST 调用 `/api/network/sources/:sourceId/auth/callback`。

回调必须有阅读站已认证账号，且与发起账号、源、版本、任务匹配；原始登录会话也必须仍有效。回调页不依赖 `window.opener`、不使用任意来源的 postMessage、不放开跨域写入或第三方 Cookie 限制。回执没有会话时仅保留在页面内存供显式复制，页面离开即清除。

## 接口和保护

- `GET /api/network/sources/:id/auth`：仅返回字段是否已存、回传能力和验证状态，不返回密钥/Cookie。
- `POST .../auth/begin`：准备一次 10 分钟任务；同一账号/书源的等待任务复用，地址只返回给该账号。
- `POST .../auth/flow`：用 `flowId` 查询状态；每 2 秒查询，仅在面板打开且页面可见时运行。
- `DELETE .../auth/flow`：携带 `flowId` 取消对应任务；旧取消请求不影响后来新建的任务。
- `POST .../auth/callback`：`{sourceId,flowId,state,params,cookie?}`；账号/源/版本/会话/时效/字段均检查；同回执重试仅回放结果，不重复保存。变化的回执拒绝覆盖。
- `POST .../auth/verify`：通过受限 QuickJS 和既有同域/公网请求校验执行检查；脚本异常不把包含凭据的异常正文回显。并发修改授权时，旧验证不覆盖新配置。
- Cookie 与字段先完整校验再一次性加密保存，坏字段/坏 Cookie 不产生部分写入。凭据沿用每账号每书源 AES-GCM 存储，内存授权任务有总量上限，未结束任务不持久化到书稿数据库。

## 验证

`tests/reader-source-authorization.test.js` 覆盖回传、回放、加密、跨账号拒绝、取消/超时/重启/停用/版本变化/会话撤销、坏输入原子性、验证失效、秘密错误脱敏和 HTTP 会话/Origin 保护。

`npm run smoke:reader-authorization` 用实际临时数据库路径核对和模拟回调，验证手机 320px、自动保存、原页状态更新、片段清除、空密钥输入框、零自动新标签及隔离会话回执路径。`npm run smoke:reader-network` 回归现有手动密钥、导入、收藏、正文与账号隔离。上述测试不登录真实站点，不证明某个未接入协议的第三方登录服务已经可自动回传。

## v7 生产更新验收

已通过 1Panel 更新 `https://txt.zhijianku.com/`；本次只更新阅读服务，不覆盖桌面应用。全量 438 项测试通过，静态检查、前端构建及两组手机冒烟通过。原有批量删除冒烟增加等待列表刷新，消除“成功提示先出现、列表稍后刷新”的断言竞态，未更改删除业务逻辑。

更新包 `novel-reader-source-authorization-v7.tar.gz` SHA256：`77eda2e7530cd75c47253639f027fa1b5db7fda5a006c93518cc85690f2a5d0b`。部署前在线 SQLite、代码和 `.env` 备份于服务器 `/opt/novel-reader/deployment-backups/source-authorization-v7/`，目录 0700，数据库与 `.env` 0600；旧镜像 `novel-reader-novel-reader:before-source-authorization-v7` 保留回滚能力。

部署后除短期登录会话表外，所有既有业务表逐表摘要与更新前备份一致：3 个账号、1 本书、5 个章节、28 条发布记录、735 个账号书源条目（每账号 245 个），收藏/私人授权/初始化/检测结果均保留；外键零异常，`quick_check=ok`。容器 healthy，仅映射 `127.0.0.1:3080`；匿名正文/管理接口 401，数据库文件 404，授权回调静态页与模块 200。核心模块 SHA256 与本地测试源码一致。

线上只读打开“番茄小说2”登录配置，确认显示“尚未保存授权”“此书源尚未提供自动回传；保存一次后复用”，未代用户登录或保存真实凭据，也未向生产默认目录加入模拟书源。自动回传和验证的端到端证据来自独立临时数据库中的模拟服务。

## v9 本地改造：动态请求头与登录过期

此节已随 v9 于 2026-10-16 部署，不改变上面的 v7 历史验收记录。处理方式、备份与上线验证详见 `reader-source-repair-2026-10-16.md`。

- 可选扩展 `novelStudioLoginRequired:true` 明确要求登录；仅有 `loginUrl` 不等于每次搜索必须登录。未配置时直接提示登录，不批量请求原站。
- 动态 `header` 可以用 `source.getLoginInfoMap()`、`source.getVariable()`、`cookie.getCookie()` 和受限脚本接口生成请求头；Credential 不进入默认包或公开 API。全局默认包继续排除含内置私人凭据的规则。
- `GET .../auth` 只返回 `hasCookie`、`hasVariable`、字段 `hasValue` 和授权状态，不再直接返回可能含 token 的 `source.variable`。客户端按这些标记显示已保存，输入框保持空白。
- 上游登录过期使用源专属 422，`{code:"SOURCE_LOGIN_REQUIRED",sourceId,loginRequired:true,error}`；它不是阅读站账号的 401。页面可打开对应源配置，保存后由用户重试。普通 403 不自动等同于凭据过期。
- Cookie、参数和源变量都参与验证状态指纹。旧验证或旧请求的结果不覆盖后来保存的凭据；回传继续保留一次性 state、账号/源/版本/会话绑定及重放保护。
- 私有请求头只发送到精确原始书源来源；允许访问外域不放行原域授权，CookieJar 仍按所属书源隔离。服务端不记录凭据到诊断日志，TLS 和 DNS 检查保留。
- 使用固定 `READER_ADMIN_TOKEN` 派生加密密钥。变更此值会使旧授权及书籍规则变量需要重新建立；部署更新应保留 `.env` 并先做 SQLite 在线备份。书籍变量位于独立新表，不改稿件表结构。

通用 H5 原站 Cookie 自动收集仍取决于登录服务支持回传；本轮没有增加服务器内置浏览器或移动原生容器。测试只覆盖临时数据库与模拟提供方，不代表真实番茄等站点已经通过登录测试。
