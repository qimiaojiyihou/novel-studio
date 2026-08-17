# Bundled Go service

正式桌面安装包会把按平台编译的 `novel-studio-service` 放在这个目录，并由 Electron 主进程启动。

开发时运行：

```bash
npm run build:go
```

当前服务提供：

- `GET /health`
- `GET /api/status`

后续将把长任务、模型进程管理、知识库和网页 API 逐步迁移到这里。
