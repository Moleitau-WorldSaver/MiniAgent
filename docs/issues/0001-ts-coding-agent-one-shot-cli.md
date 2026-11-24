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

## 审查补记（2026-11-24，分拆交付复审）

- **当前基线。** [PR #2](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/2) 的 `f273b0cdf7107900891e2e61fcb0c34df8f820d4` 最后一笔只追加文档。整支暂缓，A、B 分别以 [PR #3](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/3) 的 `a79a8540345ec0c4b67ad943f8081d6a1d663599` 和 [PR #4](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4) 的 `3ff4f7c889b783a7a3ca676ed5ce5b19d783b76f` 为复审对象。A 面向 `integration` 的 `d2443e51f6e616ae472fdb4f771ea4f76d8e7b69`，B 的基线就是 A。A 先独立达到验收门槛。A 合入后把 B 指向 `integration`，核对共同祖先、实际 diff 与可独立回滚的提交边界，再审 B。
- **共享入口与取消。** 构建后执行 `node dist/src/cli.js`。CLI 串行等待每轮回答。EOF 完成已经读到的有效输入，`Q/q` 正常退出。Ctrl-C 应立即停止分发和输出，向在途 provider 传播取消。异步 provider 收到 `AbortSignal` 后应及时结束。验收同时覆盖少量排队、高水位积压、空闲及在途取消。Windows ConPTY 复测中，大量排队使 Ctrl-C 延后，B 使用原生 fetch 的回环用例在观察窗内仍继续发送请求。修复后 B 应验证服务端没有收到后续 POST。
- **云端选择和请求次数。** 只有本次运行显式选择 DeepSeek 才发送问题。smoke 脚本的临时 provider 和模型配置限于本次运行，成功或失败后调用方原有值和未设置状态都应保留。每条有效输入只发送一次请求，3xx 按非 2xx 处理。回环验收同时断言 HTTP 状态、请求次数和退出码。
- **失败和成功证据。** 请求时限和耗时覆盖完整响应体。失败记录保留稳定类别、已知 HTTP 状态和耗时，完整正文的 JSON 语法错误与结构错误分别归类。记录中不得包含凭据、认证头、上游错误正文或完整响应 ID。
- **证据归属。** 审查端在 Windows Node 24.19.0 / 20.20.2 上独立核对 A 9/9、B 26/26 及各自构建，真实云端证据由开发端提供。开发端在 2026-11-24 10:07（北京时间）用 Windows PowerShell 在 `3ff4f7c889b783a7a3ca676ed5ce5b19d783b76f` 上运行 `./scripts/smoke-deepseek.ps1`，两轮 DeepSeek 均返回 HTTP 200 和非空答案，模型 `deepseek-flash`，完整耗时 791 / 781 ms，脱敏 ID `dd0d9798…` / `99903ce8…`，退出 0。旧记录 `2b66e27` 只对应 PR #2 的原实现。B 若修复改变启动脚本、请求或诊断，补最终 head 的对应 smoke 证据。 [开发端验收](https://github.com/Moleitau-WorldSaver/MiniAgent/pull/4)

## 建议实现顺序

1. 核对 Node.js、TypeScript 编译目标和现有测试入口，记录最新 head。
2. 创建 `package.json`、`tsconfig.json`、循环 CLI 入口和本地 provider，先完成可独立运行的交付 A。
3. 固定 CLI 与 provider 的最小接口，使用原生 `fetch` 实现 DeepSeek Bearer 认证、请求体、超时和响应解析，完成交付 B。
4. 增加 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 说明和真实 smoke test 命令，记录每轮请求到回答的结果。

不限定无关实现细节；若基线变化与计划冲突，先说明证据并调整。

## 验收与故障场景

- 正常产品路径：交付 A 运行 `node dist/cli.js`，输入两个问题并分别看到回答，再输入 `Q` 或 `q` 后进程以 0 退出。交付 B 配置 `DEEPSEEK_API_KEY` 后运行同一入口，每个问题都能看到对应的 DeepSeek 返回，输入 `Q` 或 `q` 后退出。
- 失败、权限不足、取消或重复操作：空输入不发起请求并给出可读提示；交付 B 遇到 401/403、超时、非 2xx 或无效响应时以非零退出并给出稳定错误类别；收到 Ctrl-C 时退出且不写入密钥或任务文件。
- 重启／重连／迁移：进程重启后不恢复历史；服务连接断开时当前请求失败并退出，下一次启动可重新请求；不需要迁移脚本。
- 兼容和回归：交付 A 运行 `npm test` 覆盖循环、输入处理和 `Q/q` 退出；交付 B 继续运行 `npm test` 覆盖 DeepSeek 成功响应、认证失败、超时和无效响应；两个交付都运行 `npm run build`。
- 环境和真实性：交付 A 使用本地 provider fixture，不依赖网络；交付 B 的 smoke test 必须访问 DeepSeek 云端，逐轮记录请求是否发出、HTTP 状态、实际模型名、执行时间、响应是否完整和脱敏响应标识，不把密钥写入日志。

## PR 切片和回滚

- PR A：交付可独立运行的 TypeScript 循环 CLI、本地 provider、逐轮输出和 `Q/q` 退出；依赖无；测试 `npm test`、`npm run build` 和无网络循环命令。
- PR B：交付真实 DeepSeek Chat Completions 接入、环境变量读取、逐轮请求-响应链路和 `Q/q` 退出；依赖 PR A 的 CLI 与 provider 接口；测试 `npm test`、`npm run build` 和多轮真实 DeepSeek smoke test。
- 回滚或开关：删除 CLI 入口或回退对应提交即可；真实模型 smoke test 不作为默认测试，不设置运行时开关。

## 完成说明

- 最终提交：待实现后填写。
- 测试命令与结果：待实现后分别填写 PR A 的 `npm test`、`npm run build` 和循环退出结果，以及 PR B 的 `npm test`、`npm run build` 和多轮真实 DeepSeek smoke test 结果。
- 完成证据：PR A 附带一次终端记录，证明连续输入两个问题后分别得到回答，输入 `Q` 或 `q` 后以 0 退出。PR B 附带脱敏的请求方法、请求地址、HTTP 状态、响应模型、响应标识、耗时和回答内容，证明每轮请求都完成了从发送到显示的链路。
- 已合入目标分支：待远程仓库和目标分支确定后填写。
- 未验证项及后续 Issue：待确认 API Key、账户额度、网络出口和 Node.js 支持版本。文件编辑、工具调用、跨进程上下文保存和流式输出不属于本切片，另行立项。
