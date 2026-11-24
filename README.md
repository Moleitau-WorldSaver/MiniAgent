# MiniAgent

无框架 TypeScript coding agent 的最小切片。

当前范围：

- 循环 CLI 问答
- `Q/q` 退出
- 真实 DeepSeek 请求到响应链路

## 开发

需要 Node.js 20 或更高版本。安装依赖并运行本地 provider：

```bash
npm install
npm test
npm run build
printf '问题一\n问题二\nQ\n' | npm run start
```

默认 provider 是不访问网络的 `echo`。空行会显示提示并继续等待，输入 `Q` 或 `q` 会以退出码 0 结束。

## DeepSeek

通过环境变量显式启用 DeepSeek。API Key 只从进程环境读取，不要写入仓库、命令历史或日志：

```bash
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-flash}" \
CODING_AGENT_PROVIDER=deepseek \
npm run start
```

每轮请求都会在标准错误输出脱敏链路证据，包括请求方法、地址、HTTP 状态、模型、响应标识、耗时和回答是否非空。认证失败、非 2xx、超时、网络错误和无效响应会以稳定错误类别退出。

在 PowerShell 中可以运行 `scripts/smoke-deepseek.ps1`。该脚本要求已有 `DEEPSEEK_API_KEY`，会发送两轮问题并以 `Q` 退出，不会打印密钥。

文档：

- [Issue 001](docs/issues/0001-ts-coding-agent-one-shot-cli.md)
- [Plan One](docs/plans/0001-ts-coding-agent-one-shot-cli-plan.md)
