# [切片 1] 完成循环 CLI 并接通 DeepSeek 请求-响应链路

实施计划：[Plan One：循环 CLI 与 DeepSeek 请求-响应链路](../plans/0001-ts-coding-agent-one-shot-cli-plan.md)

## 背景与用户目标

- 谁遇到了什么问题：当前工作区没有 coding agent 的可运行入口，用户无法从命令行持续提问、查看每轮回答并主动退出。
- 用户希望能完成什么：启动 CLI 后持续输入问题，逐轮看到返回内容，输入 `Q` 或 `q` 后退出；接入 DeepSeek 后，每一轮都能完成从请求发送到回答显示的完整链路。
- 当前实际行为：工作区为空，没有 package、源码、测试或 CLI。运行入口不存在。

## 基线与现有实现

- 检查时间、仓库与分支：2026-11-23；当前工作区 `/workspace/scratch/40d09e6a1d05`，尚未配置远程仓库或默认分支，仓库链接待补充。
- 已核对的提交：无提交；开始实现前再次确认最新 head。
- 已有代码、测试或 PR：无。
- 尚不确定、需要先验证的假设：
  - 运行环境提供 Node.js LTS，且可使用原生 `fetch` 和 Node 内置测试运行器。
  - 已申请可用的 DeepSeek API Key，且账户额度和网络出口允许访问 `https://api.deepseek.com`。
  - 首个切片使用 DeepSeek 的 OpenAI 兼容 Chat Completions 接口，默认模型名通过 `DEEPSEEK_MODEL` 配置，缺省值为 `deepseek-flash`。
  - 循环只在当前进程内运行，退出后不保存消息、配置或任务状态。

## 本次范围

- 交付 A 建立不依赖应用框架的 TypeScript 循环 CLI，持续读取问题，逐轮输出本地 provider 的回答，输入 `Q` 或 `q` 后以 0 退出。该交付不访问网络，可以独立运行和测试。
- 交付 B 在交付 A 的循环入口上接入真实 DeepSeek API，从 `DEEPSEEK_API_KEY` 读取 Bearer 密钥，从 `DEEPSEEK_MODEL` 读取模型名，逐轮完成请求发送、响应接收和回答输出。
- 两个交付都处理输入为空和退出指令。交付 B 另外处理认证失败、服务超时、非 2xx 响应和无法解析响应。
- 使用 Node 内置测试能力验证循环、`Q/q` 退出、交付 A 的本地 provider，以及交付 B 的 DeepSeek 请求头、请求体和响应解析。

### 明确不做

- 不做文件读写、代码编辑、命令执行、补丁应用或 Git 操作。
- 不做流式输出、任务队列、并发调度、跨进程状态或持久化。
- 不引入 React、LangChain、编排框架或供应商 SDK，不在本切片内扩展通用多供应商适配层。
- 不处理生产部署、密钥托管、权限系统和远程仓库接入。

## 依赖与兼容边界

- 前置 Issue / PR：无。需要先准备 DeepSeek API Key 和可访问 `api.deepseek.com` 的网络环境。
- 可并行的工作：DeepSeek 账户额度确认和 CLI 文案可以并行，完成后回填 smoke test 的实际模型名与响应字段。
- 必须复用或保持不变的身份、存储、权限和 API：密钥只从 `DEEPSEEK_API_KEY` 读取，不写入文件、日志或输出；请求使用 DeepSeek 的 Bearer 认证和 Chat Completions 响应结构。
- 旧数据、旧客户端和正在运行任务如何处理：当前无旧数据、旧客户端或长任务；进程结束即丢弃本次循环和响应。

## 建议实现顺序

1. 核对 Node.js、TypeScript 编译目标和现有测试入口，记录最新 head。
2. 创建 `package.json`、`tsconfig.json`、循环 CLI 入口和本地 provider，先完成可独立运行的交付 A。
3. 固定 CLI 与 provider 的最小接口，使用原生 `fetch` 实现 DeepSeek Bearer 认证、请求体、超时和响应解析，完成交付 B。
4. 增加 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 说明和真实 smoke test 命令，记录每轮请求到回答的结果。

不限定无关实现细节；若基线变化与计划冲突，先说明证据并调整。

## 验收与故障场景

- 正常产品路径：交付 A 执行 `npm run build` 后运行 `node dist/src/cli.js`，输入两个问题并分别看到回答，再输入 `Q` 或 `q` 后进程以 0 退出。交付 B 设置 `CODING_AGENT_PROVIDER=deepseek` 和 `DEEPSEEK_API_KEY` 后运行同一入口，每个问题都能看到对应的 DeepSeek 返回，输入 `Q` 或 `q` 后退出。
- 失败、权限不足、取消或重复操作：空输入不发起请求并给出可读提示；交付 B 遇到 401/403、超时、非 2xx 或无效响应时以非零退出并给出稳定错误类别；收到 Ctrl-C 时退出且不写入密钥或任务文件。
- 重启／重连／迁移：进程重启后不恢复历史；服务连接断开时当前请求失败并退出，下一次启动可重新请求；不需要迁移脚本。
- 兼容和回归：交付 A 运行 `npm test` 覆盖循环、输入处理和 `Q/q` 退出；交付 B 继续运行 `npm test` 覆盖 DeepSeek 成功响应、认证失败、超时和无效响应；两个交付都运行 `npm run build`。
- 环境和真实性：交付 A 使用本地 provider fixture，不依赖网络；交付 B 的 smoke test 必须访问 DeepSeek 云端，逐轮记录请求是否发出、HTTP 状态、实际模型名、执行时间、响应是否完整和脱敏响应标识，不把密钥写入日志。

## PR 切片和回滚

- PR A：交付可独立运行的 TypeScript 循环 CLI、本地 provider、逐轮输出和 `Q/q` 退出；依赖无；测试 `npm test`、`npm run build` 和无网络循环命令。
- PR B：交付真实 DeepSeek Chat Completions 接入、环境变量读取、逐轮请求-响应链路和 `Q/q` 退出；依赖 PR A 的 CLI 与 provider 接口；测试 `npm test`、`npm run build` 和多轮真实 DeepSeek smoke test。
- 回滚或开关：删除 CLI 入口或回退对应提交即可；真实模型 smoke test 不作为默认测试，不设置运行时开关。

## 完成说明

- **A，离线 CLI。** [PR #3](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/3) 的 `42df18aece653bb0bf445e0ca0c6b1d9b710dcfe` 已通过合并提交 `12605ce18ab944290e00130e01795d91f0ebb8f6` 进入 `integration`。Windows Node 20.20.2 和 24.19.0 均通过 `npm.cmd run build` 和 `npm.cmd test`（9/9）。终端验证了两问、空行、`Q/q`、EOF 和 Windows ConPTY 积压取消。
- **B，DeepSeek。** [PR #4](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4) 待在 `integration` 复审合入。诊断修复后，Windows Node 20.20.2 和 24.19.0 均通过 `npm.cmd run build` 和 `npm.cmd test`（36/36）。回环 HTTP 覆盖两轮有序 POST、302/307、认证失败、正文超时、断连、响应校验和脱敏诊断。模型名包含空白或控制字符时，CLI 以 `invalid_response` 退出 1，单行记录 HTTP 状态和耗时。首轮 HTTP 500 同样以 1 退出，待处理的问题不会发送。两种失败均无回答。此前 Windows ConPTY 验证积压时只发出首轮 POST，Ctrl-C 中止连接并停止后续轮次。 [诊断复审](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4#issuecomment-7121966648)
- **B 启动配置回归。** 非法 `CODING_AGENT_PROVIDER` 只提示变量名和允许值 `echo`、`deepseek`。真实 CLI 子进程测试覆盖误填假凭据、含换行的非法值和缺少 DeepSeek 密钥。三个场景均退出 1、无 stdout、只有一行诊断且发出零请求。修复提交与测试结果见 [PR #4](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4)。
- **B 真实云端。** 最近一次审查用 Windows PowerShell 7.6.9 与 Node 24.19.0，在 `9e5332573abb6d6867f397315c50b89c5768eacc` 上运行原版 `./scripts/smoke-deepseek.ps1`。两轮 POST 均返回 HTTP 200、`deepseek-flash` 和非空回答，耗时 792 / 920 ms，脱敏 ID 为 `ea428984…` / `f637ca7c…`。`Q` 退出 0，调用方 provider 恢复。启动诊断修复后的运行提交待补真实云端 smoke。 [PR #4 复审记录](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4#issuecomment-7124712661)
- **历史验收。** PR #2 的 12 项测试和真实两轮记录归属原实现 `2b66e27`（记录提交 `de83a6471930e7c72c0eadf983480cb975bc907f`）。B 的早期 26 项测试和 791 / 781 ms 两轮云端结果归属 `3ff4f7c889b783a7a3ca676ed5ce5b19d783b76f`。
- **剩余验证。** B 合入后回填合并提交并核对 Issue #1 关闭状态。Windows 验收范围见 README，其他系统的终端和真实云端故障尚未验证。文件读写、工具调用、持久化和流式输出另行立项。

## 审查补记（2026-11-24，PR #2）

[PR #2](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/2) 的受审代码为 `de83a6471930e7c72c0eadf983480cb975bc907f`。相对 `integration` 的 `d2443e51`，实现提交 `2b66e27` 同时交付 A 与 B。当前整支待修复，A 与 B 还没有独立准入或回滚的提交边界。

- **A → B 的 CLI／provider 契约。** A 保持默认 echo、无需凭据、逐轮串行、空行不请求、`Q/q` 正常退出和 EOF 收尾。Ctrl-C 应在等待输入和等待 provider 时都及时结束；在途工作应收到取消通知，取消后停止回答、诊断和后续已排队请求。先在 A 验证这个行为，再对接 B 及后续 provider。当前受审 CLI 在 Windows 真实终端收到 Ctrl-C 后仍等待在途响应并输出迟到结果。
- **B 的请求生命周期与诊断。** 本地回环 HTTP 复测中，200 响应头到达后延迟发送响应体，当前请求超过配置的时限仍成功。时限与耗时应覆盖完整响应体，断连、超时、无效 JSON 与不符合结构的有效 JSON 应各自保留稳定类别。向终端和 smoke 记录输出脱敏后的响应标识，保留 HTTP 状态、模型和完整请求耗时。
- **分批准入和验收。** 提供可独立审查、构建、运行的 A，并统一 README 与 Issue 的入口命令。当前 `npm run start` 使用 `node dist/src/cli.js`，原验收段的 `node dist/cli.js` 在受审版本报 `MODULE_NOT_FOUND`。B 在已验证的 A 上叠加，保留可独立回滚的边界，补齐真实终端取消、回环 HTTP 响应体超时和断连、两轮请求以及脱敏输出断言。开发端已提交的 DeepSeek 云端两轮成功记录继续作为原实现的正向证据，修复后的验收需记录对应 SHA 和复测环境。
