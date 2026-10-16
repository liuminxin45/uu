# uu · independent context and Memory core

独立于产品宿主的八层上下文核心、Memory 协议与 provider 生命周期。M1 已完成 Memory 协议；M1b 从 PHD 迁入现有上下文编译器、类型、检查报告和通用引用处理。产品通过 `@uu/core/context` 使用同一份实现，不能反向依赖产品的 RPC、配置、数据库或 UI。

仓库：[liuminxin45/uu](https://github.com/liuminxin45/uu)。本工程不导入 PHD、Electron、React，不读取用户配置或业务数据目录。当前 Memory 仅有合成只读实现，没有接入存量、数据库、持久化写入、模型调用或后台服务。夹具、演示 provider、CLI 和迁移 reader 均不进入正常核心包。

## 启动与验证

使用现有 nvm Node **24.19.0**，不另装运行时。依赖仅用于开发；协议核心没有运行时依赖。

```powershell
npm ci --ignore-scripts
npm run verify
npm run uu -- doctor
npm run uu -- protocol
npm run uu -- context inspect --fixture ./fixtures/context-demo.json
npm run uu -- context inspect --fixture ./fixtures/context-demo.json --full
npm run uu -- memory snapshot --fixture ./fixtures/demo.json
npm run uu -- memory recall --fixture ./fixtures/demo.json --query 发布
```

构建后也可从任意目录用现有 Node 启动本工程 `bin/uu.mjs`，同时传入夹具绝对路径。CLI 必须显式指定夹具，不读取默认记忆路径或环境变量。文件只允许在仓库 `fixtures` 内，或带 `.uu-m1-isolated.json` 标记的系统临时 `uu-m1-*` 子目录内；拒绝目录联接及符号链接重定向。

`memory request --fixture <path>` 从标准输入读取一个协议 JSON 请求，最多 64 KiB、等待最多 5 秒。成功结果或协议失败写入 stdout；启动、参数或夹具错误返回独立的 `cliError`，失败退出码为 1。stderr 仅含关联 ID、阶段、耗时和错误码，不含查询、记忆、用户身份或正文。

写方法已定义合同，但演示 provider 只支持九个读方法。四个写方法均返回 `UNSUPPORTED_OPERATION` 与 `writeOutcome=not-applied`，不会返回伪造收据或产生文件。

## 工程边界

| 目录 | 职责 | 进入正常协议包 |
|---|---|---|
| `src/context` | 八层类型、纯编译、检查、引用标准化和有界读取调度 | 是，独立无 IO 入口 |
| `src` 其余模块 | Memory 协议校验、授权、预算、会话和 provider 生命周期 | 是，编译为 JS 与声明 |
| `test-support`、`fixtures` | 明确标记的合成数据与只读演示实现 | 否 |
| `tools/uu.ts`、`bin` | 本次 M1 的 checkout CLI | 否 |
| `tests` | 协议、生命周期故障、进程、权限和包消费验收 | 否 |

`@uu/core` 当前为私有 Git 依赖包；入口为 `.`、`./protocol` 和 `./context`。消费者按完整 Git commit 固定版本，Git 安装的 prepare 在 Node 24.19.0 下生成 JS 与声明；不需要本机另一个源码 checkout 或绝对路径。上下文消费者直接使用 `./context`，避免加载 Memory 生命周期的 Node 依赖。支持 Node 24 的同步 CommonJS 消费，并为 PHD 的旧 Node 类型解析模式提供声明映射；没有旧包名或旧本地模块的兼容出口。

[上下文合同](docs/CONTEXT.md) 定义宿主边界与迁移一致性。[Memory 协议](docs/PROTOCOL.md) 定义身份、版本、预算、收据及关闭语义。[M1 验收记录](docs/validation/m1-2026-10-16/validation.json) 保留该阶段的历史范围。

后续按 PHD 的 `docs/UU_MEMORY_ROADMAP.md` 推进：M2 才接入迁移专用只读 reader；M3 才验证隔离持久化写入。新 reader 必须与正常包隔离，并于 M6 删除。M5 前不切正式 owner，M5 后立即完成 M6；不保留旧 API 别名、双写、常驻双读或自动回退。

## 参考

设计参考固定版本 Hermes 的 [Memory Provider 生命周期](https://github.com/NousResearch/hermes-agent/blob/3b2f971133e4e011022ccf33dc6dc1c9050563d8/website/docs/developer-guide/memory-provider-plugin.md) 与 [精炼记忆和用户资料](https://github.com/NousResearch/hermes-agent/blob/3b2f971133e4e011022ccf33dc6dc1c9050563d8/tools/memory_tool.py)。本工程没有复制 Hermes 或 PHD 的存储实现。Codex 原生执行循环、会话与沙箱继续由现有内核管理。
