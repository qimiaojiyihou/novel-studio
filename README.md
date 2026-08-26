# Novel Studio

Novel Studio 是本地优先的长篇小说创作桌面应用，使用 Vue 3、JavaScript、Vite 与 Electron，并可随安装包运行独立 Go 模型服务。它支持 DeepSeek、MiMo、GPT、Kimi、自定义 OpenAI 兼容模型，以及 ACP 优先、exec 回退的 Codex Agent。

当前创作链路覆盖故事规划、人物关系、世界观、情节弧、章节卡、结构化场景计划、正文与局部重写、知识连续性、质量评审、提示词、三级文风和人工确认。每个项目可把“应用模型路由”或 Codex 设为默认创作方式；全部创作入口都支持单次覆盖。模型输出不会直接覆盖已接受内容。

## 开发

```bash
npm install
npm run dev
```

常用检查：

```bash
npm run check
npm test
npm run build
```

桌面发行构建：

```bash
npm run build:app
```

Codex 的信任边界、审批与回退规则见 `docs/CODEX_AGENT.md`；Creative Pack 格式见 `docs/CREATIVE_PACK.md`。开源发行版不附带本地正文模型，外部模型和 Codex 能力仍可使用。
