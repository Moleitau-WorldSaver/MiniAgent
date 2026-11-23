# Plan One：循环 CLI 与 DeepSeek 请求-响应链路

对应 Issue：[切片 1：完成循环 CLI 并接通 DeepSeek 请求-响应链路](../issues/0001-ts-coding-agent-one-shot-cli.md)

## 目标

按两个独立交付完成最小切片。

- **PR A** 交付一个不访问网络的 TypeScript CLI 循环。它可以持续读取问题、逐轮显示本地 provider 的回答，并在输入 `Q` 或 `q` 后以退出码 0 结束。
- **PR B** 复用 PR A 的 CLI 循环，把 provider 换成真实 DeepSeek API。它验证每一轮从输入、请求发送、响应接收、回答解析到终端显示的完整链路。

本计划不包含文件读写、代码编辑、命令执行、工具调用、流式输出、持久化或跨进程上下文。

## 实施前检查

### 涉及文件

- 工作区根目录：确认当前分支、最新 head、Node.js 版本和 npm 版本。
- `package.json`：若不存在则创建，若基线变化则只补充本计划需要的脚本和开发依赖。
- `tsconfig.json`：若不存在则创建，固定 TypeScript 编译目标、源目录和输出目录。
- `.gitignore`：若不存在则创建，忽略 `node_modules`、`dist`、测试临时文件和本地密钥文件。

### 改动要点

1. 确认 Node.js 支持原生 `fetch`、`readline` 和 `node:test`。
2. 确认仓库与分支的最新 head，并把结果填回 Issue 的基线部分。
3. 确认 DeepSeek API Key、账户额度和访问 `https://api.deepseek.com` 的网络出口。密钥只通过进程环境提供。
4. 如果现有基线与本计划中的文件或脚本冲突，先记录证据，再调整计划和 Issue，不直接覆盖已有入口。

### 检查命令

```bash
node --version
npm --version
git status --short
git branch --show-current
git rev-parse HEAD
```

完成门槛是检查结果已记录，且没有未识别的现有入口或测试被覆盖。

## Slice A：本地 CLI 循环

### A1. 建立最小 TypeScript 项目入口

#### 文件

- `package.json`
- `tsconfig.json`
- `.gitignore`
- `src/cli.ts`
- `src/provider.ts`

#### 改动要点

1. 在 `package.json` 增加 `build`、`start` 和 `test` 脚本。
2. 使用 TypeScript 编译到 `dist`，运行时只使用 Node 内置模块。
3. 在 `src/provider.ts` 定义最小 provider 接口。接口接收一条非空问题并返回一条可显示的文本回答。
4. 在 `src/cli.ts` 建立行读取循环。每读到一行先去除首尾空白。
5. 空行不调用 provider，只显示可读提示并继续等待下一行。
6. `Q` 和 `q` 作为退出指令，不调用 provider，关闭输入并以 0 退出。
7. 普通输入调用 provider，先等待该轮 Promise 完成，再显示回答，然后继续下一轮。单轮未完成时不并发处理下一行。
8. 处理标准输入结束和 Ctrl-C，确保进程可以结束且不写入任何密钥或任务文件。

#### 测试命令

```bash
npm run build
npm test
```

### A2. 增加本地 echo provider 和循环测试

#### 文件

- `src/providers/echo.ts`
- `src/provider-factory.ts`
- `test/cli.test.ts`
- `test/echo-provider.test.ts`

#### 改动要点

1. `echo` provider 返回可预测的非空文本，便于证明 CLI 确实完成了一次 provider 调用。
2. `provider-factory.ts` 提供本地 provider 选择，不访问网络。默认选择 `echo`，保证 PR A 在没有 API Key 和网络的环境中可运行。
3. CLI 只依赖 provider 接口，不依赖 echo provider 的具体实现。
4. 测试 CLI 的两个连续问题、两个回答的顺序、空行跳过、`Q` 退出和 `q` 退出。
5. 测试 provider 调用次数，证明退出指令不会产生额外请求。
6. 测试标准输入结束和 Ctrl-C 的退出行为，避免循环悬挂。

#### 测试命令

```bash
npm test
npm run build
printf '问题一\n问题二\nQ\n' | npm run start
printf '问题一\n问题二\nq\n' | npm run start
```

#### PR A 完成证据

- `npm test` 通过。
- `npm run build` 通过。
- 两条问题都产生对应的本地回答。
- 输入 `Q` 和 `q` 都以退出码 0 结束。
- 运行期间不需要网络和 `DEEPSEEK_API_KEY`。

PR A 到此冻结接口。PR B 只能替换或增加 provider，不改变 CLI 的输入循环和退出语义。

## Slice B：真实 DeepSeek 接入

### B1. 增加 DeepSeek 配置和 HTTP provider

#### 文件

- `src/config.ts`
- `src/providers/deepseek.ts`
- `src/provider-factory.ts`

#### 改动要点

1. 从 `DEEPSEEK_API_KEY` 读取密钥。缺少密钥时在启动或首次选择 DeepSeek provider 时给出明确错误，不把密钥写入错误文本。
2. 从 `DEEPSEEK_MODEL` 读取模型名，未设置时使用 Issue 约定的默认模型 `deepseek-flash`。
3. 使用原生 `fetch` 请求 `https://api.deepseek.com/chat/completions`。
4. 请求头包含 `Content-Type: application/json` 和 `Authorization: Bearer <key>`。
5. 请求体只包含当前最小切片需要的模型名、当前问题和非流式请求设置。每次输入对应一次请求。
6. 解析 DeepSeek Chat Completions 响应中的模型、响应标识和 assistant 文本。缺失必要字段时报告响应解析错误。
7. 为请求设置超时，并把网络错误、401/403、其他非 2xx 和无效 JSON 映射为稳定错误类别。
8. 在 `provider-factory.ts` 增加显式 provider 选择，例如 `CODING_AGENT_PROVIDER=echo|deepseek`。默认仍为 `echo`，避免 PR A 的行为被环境中偶然存在的密钥改变。

#### 测试命令

```bash
npm run build
npm test
```

### B2. 用本地 HTTP fixture 验证完整请求-响应链路

#### 文件

- `test/deepseek-provider.test.ts`
- `test/cli.test.ts`

#### 改动要点

1. 使用 Node 内置 `http.createServer` 建立本地 fixture，不访问 DeepSeek 云端。
2. fixture 记录请求方法、路径、Authorization、请求体和请求次数，并返回符合 DeepSeek Chat Completions 结构的固定响应。
3. 验证 provider 使用 POST、正确路径、Bearer 认证、配置的模型名和当前用户问题。
4. 验证 provider 返回非空 assistant 文本，并把模型和响应标识保留在可供 smoke test 记录的结果中。
5. 验证 401/403、非 2xx、超时和无效 JSON 都会失败，不会把密钥写进错误或测试输出。
6. 验证 CLI 连续处理两轮 DeepSeek provider 调用，再由 `Q/q` 退出。

#### 测试命令

```bash
npm test
npm run build
```

### B3. 执行真实 DeepSeek smoke test

#### 文件

- `README.md`
- `scripts/smoke-deepseek.sh` 或等价的可审阅命令说明

#### 改动要点

1. 文档说明如何通过环境变量运行 DeepSeek provider，禁止把 API Key 写入仓库、命令历史示例或日志。
2. smoke test 输入至少两个问题，再输入 `Q`，证明循环可以连续完成多轮请求。
3. 每轮记录请求是否发出、请求地址、HTTP 状态、实际模型名、响应标识、耗时和回答是否非空。记录内容必须脱敏。
4. 不对回答措辞做固定字符串断言，只验证真实云端响应结构、非空回答和完整请求-响应链路。
5. 真实 smoke test 失败时保留错误类别、HTTP 状态和时间，不重试到改变结果，也不把密钥输出。

#### 测试命令

```bash
printf '你是谁？请用一句中文回答\n请回答一个简单问题\nQ\n' | \
  env DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
      DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-flash}" \
      CODING_AGENT_PROVIDER=deepseek \
      npm run start
```

实际执行时使用已经安全注入的环境变量，不在终端记录真实密钥。若采用 `scripts/smoke-deepseek.sh`，脚本只负责环境检查、调用 CLI 和输出脱敏证据，不实现第二套请求逻辑。

#### PR B 完成证据

- 本地 fixture 测试证明请求方法、路径、认证、模型、问题和响应解析正确。
- 真实 smoke test 证明至少两轮请求都得到非空 DeepSeek 回答。
- 证据包含每轮 HTTP 状态、模型、响应标识和耗时。
- 输入 `Q` 或 `q` 后进程以 0 退出。

## 最终整体验收

### 文件核对

- `package.json`：脚本可以构建、测试和启动。
- `tsconfig.json`：构建输出可由 Node 执行。
- `src/cli.ts`：只负责循环、输入处理、输出和退出。
- `src/provider.ts`：保持 PR A 冻结的最小接口。
- `src/providers/echo.ts`：本地无网络 provider。
- `src/providers/deepseek.ts`：真实 DeepSeek HTTP provider。
- `src/provider-factory.ts`、`src/config.ts`：显式选择 provider 和读取环境配置。
- `test/`：覆盖循环、退出、fixture 请求和失败场景。
- `README.md`、`scripts/smoke-deepseek.sh`：只说明和执行真实 smoke test，不复制请求实现。

### 最终命令

```bash
npm test
npm run build
printf '问题一\n问题二\nQ\n' | npm run start
```

之后再执行一次真实 DeepSeek smoke test，并把实际结果回填到对应 Issue 的“完成说明”。

### 回滚

- PR A 回滚：回退 PR A 提交，删除 CLI 入口和项目骨架即可。
- PR B 回滚：回退 PR B 提交，provider 选择恢复为 `echo`，PR A 的本地 CLI 仍可运行。
- 不增加运行时开关以外的部署机制，不保留未验收的半成品路径。

## 完成条件

只有以下证据全部存在时，才把 Issue 标记为完成。

1. PR A 的构建、自动化测试和两轮本地循环记录存在。
2. PR A 的 `Q/q` 退出记录存在，退出码为 0。
3. PR B 的 DeepSeek fixture 测试通过，且没有泄漏密钥。
4. PR B 的真实 smoke test 至少完成两轮请求，并保存脱敏链路证据。
5. Issue 的完成说明填入最终提交、实际命令、实际结果、目标分支和剩余未验证项。
