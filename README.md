# MiniAgent

无框架 TypeScript coding agent 的最小切片。

## 在 Windows 终端运行

需要 Node.js 20 或更高版本。在 PowerShell 中运行以下命令：

```powershell
npm.cmd ci
npm.cmd run build
node dist/src/cli.js
```

输入问题并按 Enter。默认使用无需凭据或网络的 echo，每轮输出回答后继续读取下一轮。空行只输出提示，输入 `Q` 或 `q` 会以状态码 0 退出。标准输入结束时处理完已读入的问题。按 Ctrl-C 立即取消当前轮次并退出。

```powershell
"问题一", "", "问题二", "Q" | node dist/src/cli.js
npm.cmd test
```

## DeepSeek

先将已授权的 `DEEPSEEK_API_KEY` 注入当前进程环境，再在 PowerShell 中运行：

```powershell
$env:CODING_AGENT_PROVIDER = "deepseek"
node dist/src/cli.js
```

`DEEPSEEK_MODEL` 默认使用 `deepseek-flash`。每轮只发送当前问题，请求时限为 30 秒，覆盖响应体读取。成功时在标准错误记录 HTTP 状态、模型、耗时及脱敏后的响应标识。认证失败、超时、断连、无效 JSON 和响应结构错误各有稳定的错误类别。

在已有凭据的 PowerShell 会话中运行 `./scripts/smoke-deepseek.ps1` 可以构建并验证两轮真实云端问答。日常 `npm.cmd test` 使用回环 HTTP fixture。

文档：

- [Issue 001](docs/issues/0001-ts-coding-agent-one-shot-cli.md)
- [Plan One](docs/plans/0001-ts-coding-agent-one-shot-cli-plan.md)
