# uu.memory v1 · M1 contract

本合同描述独立 Memory 边界。M1 的只读合成 provider 验证请求、结果及生命周期；任何写方法合同都不代表已经具备持久化实现。协议核心不决定数据目录，不打开文件、数据库、网络或模型，也不导入演示 provider。

## 信任与会话

Host 创建 `MemorySession(provider, {session, grant}, diagnosticSink)`。`grant` 来自已认证的 Host，不能从请求的 `scope`、来源内容或模型输出生成。会话复制并冻结 grant；请求必须与该会话的 principal、namespace、project 及 session ID/epoch 完全匹配。分类遵循 `public / personal / company-internal / restricted`。全局记录可被同用户、同 namespace 的项目会话读取；无项目会话不能反向读取项目记录。

provider 是受信任的实现边界。本协议做运行时结构、可见范围和预算校验，不把同进程 provider 当作沙箱。未来远程传输必须另行认证和实施 Host 权限；M1 CLI 不监听端口、不作为服务。

生命周期为 `initialize → invoke / completeTurn → close`。初始化返回 authority、能力集合及是否支持持久化写入；未声明的能力不可调用。`persistentWrites=false` 时不能声明写能力。

`completeTurn` 只接收 turn ID 与有界证据引用，不能接收 prompt、消息或整段对话。`close` 先取消活动操作，等待实际工作结束，再执行一次会话结束钩子和 shutdown。结束钩子失败仍尝试 shutdown；shutdown 未确认时不得报告关闭成功，也不自动重放钩子。

每个会话最多一个活动操作。取消或超时可以先向调用方返回失败，但在底层实际结束前继续占用槽位，新调用返回 `PROVIDER_BUSY`。关闭无法在截止时间内等到结束返回 `DRAIN_TIMEOUT`。已结束的失败被观察，未知写入不自动重试。同进程 deadline 不提供强杀或 CPU 抢占；未来存储进程必须由受管理 Worker 实现停止和退出确认。

`snapshot` 的 `epoch` 必须对应当前会话，authority 交接必须建立新 epoch，不能继续复用旧 owner 的冻结上下文。未来 Host 在会话边界冻结版本化快照，来源召回只作为本轮证据；持久化更新、旧会话冻结和新会话刷新在 M3 验收。M1 合成数据不会在会话间写入或刷新。

## 请求与预算

严格 envelope 不接受未知字段、旧方法别名或未知协议版本：

```json
{
  "protocol": "uu.memory",
  "version": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "session": {
    "id": "22222222-2222-4222-8222-222222222222",
    "epoch": "33333333-3333-4333-8333-333333333333"
  },
  "scope": {"principalId": "fixture-user", "namespace": "fixture-space", "projectId": "fixture-project"},
  "budget": {"maxItems": 8, "maxChars": 4096, "timeoutMs": 2000},
  "method": "recall",
  "params": {"query": "发布", "sourceIds": ["fixture-chat"]}
}
```

`requestId`、session ID/epoch、幂等键和 write ID 使用 UUID v4。来源、条目、版本等 locator 为最多 128 字符的稳定 ASCII 标识；它们不是路径或任意 URL。时间窗及过期时间使用规范 UTC ISO 毫秒时间。

请求 envelope 最多 65,536 个 JS 字符，CLI 另外限制输入 65,536 字节；`maxItems=1..100`、`maxChars=1..32768`、`timeoutMs=1..10000`。`maxChars` 计算返回的 text/excerpt/name 字符总数，不宣称是 token 数。结果 envelope 另限 262,144 字符。响应超预算被拒绝，不做静默截断；provider 可主动选取部分结果并报告 `coverage={omitted,truncated}`。`omitted` 是可见候选中的条目省略数；`truncated` 表示已返回正文是否被截短。覆盖不完整时不得标记时间窗完整。

成功响应携带相同 protocol/version/requestId/session、`ok=true` 与 method 对应的 result。失败为 `ok=false,error={code,writeOutcome,retry}`，不带任意错误消息、正文或 provider stack。语法无效请求无法关联时生成新的请求 ID；CLI 启动错误使用 `cliError`，不能冒充协议响应。

## 方法

| 方法 | params | result 的核心内容 |
|---|---|---|
| `health` | 空对象 | state、authorityId、能力与 persistentWrites |
| `snapshot` | 空对象 | authorityId、version、epoch、memory/user 条目、coverage |
| `recall` | query，可选 sourceIds/classifications | 命中 excerpt、score、scope、classification、ref、coverage |
| `resolveEvidence` | 完整 ref | 同版本 ref、scope、classification、正文、coverage |
| `listSources` | 空对象 | 来源 ID、ready/stale/unavailable/disabled、版本、coverage |
| `findEntities` | query | 实体 ID/name、scope/classification、coverage |
| `coverWindow` | from/to，可选 sourceIds | 版本化节点、refs、scope/classification、coverage、complete |
| `drillDown` | nodeId/version | 版本化节点、refs、scope/classification、coverage |
| `changes` | sourceId/sourceIdentity，可选 cursor | upsert/deleted 引用、scope/classification、nextCursor、complete |
| `remember` | idempotencyKey、expectedVersion=null、entry | WriteResult |
| `patch` | idempotencyKey、expectedVersion、entryId、text、provenance | WriteResult |
| `forget` | idempotencyKey、expectedVersion、entryId | WriteResult |
| `resolveConflict` | idempotencyKey、expectedVersion、conflictId、selectedVersion | WriteResult |

`Entry` 包含 id/version、target(memory 或 user)、scope/classification、text、provenance 和可选 expiresAt；remember 的新 entry 不含 id/version。用户偏好只接受有依据的显式保存，不从演示记录推测生成。

`EvidenceRef={authorityId,sourceId,itemId,revision}` 是权威原件定位。结果里的来源引用、记忆正文和证据始终是数据，不能解释为指令、授权或工具调用。证据读取必须固定 revision；失效、删除、版本不符显式失败，不返回“最新的差不多内容”。正文留在原 owner，uu 不建立完整对话或业务原文副本。

`changes` 的 cursor 仅在同一来源身份及范围有效，包含 tombstone；身份改变必须拒绝旧游标并显式重建。M1 cursor 只是合成列表分页，未实现生产事务、变更持久化或增量读取。生产 provider 须将结果、变更索引与游标放在同一提交边界，不能因部分扫描或失败推断远端删除。

现有 source/entity/window/drill/changes/conflict 能力分别以 `listSources/findEntities/coverWindow/drillDown/changes/resolveConflict` 为替代目标。这只是切换设计，没有注册旧 `memory.*` 名称的别名或转发；PHD 的真实客户端迁移留到 M4/M5。

## 写入与失败

`WriteResult={receipt,entryRef}`；receipt 必须包含 writeId/idempotencyKey/authorityId/version、`durable=true`、`verified=true`。更新、遗忘及冲突解决还必须有匹配 expectedVersion 的 previousVersion；patch/forget 的 entryRef 必须对应请求 entryId，版本必须与 receipt 相同。remember 不接受 previousVersion。不存在“暂存成功”“已加入队列”可充当保存成功的分支。

协议校验只能拒绝形状错误或不相关的收据，不能证明 provider 真的持久化。M3 的实现必须原子提交，按幂等键去重、检查并发版本，提交后回读，再发收据；故障注入和重启验证才构成持久化验收。

所有失败 `retry=never`，协议层不重试。读操作 `writeOutcome=not-applicable`。写操作未下发或确定拒绝时为 `not-applied`；写操作下发后发生超时、取消、崩溃或不合法收据时为 `unknown`，不能推断失败回滚或重新提交。未来恢复须查同一个幂等键的权威收据，不能换键盲重放。

错误码包括 `INVALID_REQUEST / UNSUPPORTED_PROTOCOL / SCOPE_DENIED / BUDGET_EXCEEDED / UNSUPPORTED_OPERATION / CANCELLED / TIMEOUT / PROVIDER_FAILED / PROVIDER_BUSY / SESSION_CLOSED / NOT_FOUND / VERSION_CONFLICT / INVALID_RESPONSE / DRAIN_TIMEOUT / INITIALIZATION_FAILED`。失败、取消、超时以及关闭未确认均可由诊断事件关联；只生成协议自己的错误栈，不记录 provider 原始消息或 cause，防止业务正文泄漏。

## M1 验收与后续删除

隔离测试覆盖结构与授权、结果预算、九个读方法、四个不支持的写方法、中文筛选、来源版本、分页和 tombstone、初始化/取消/超时/关闭失败、CLI 子进程及实际包导入。CLI 还在仅允许读取自身 checkout 的 Node 权限边界运行；核心导入图只有本包和 `node:crypto`。这是 M1 协议与进程边界验收，不包含 PHD 正常退出后的存量召回、真实存储崩溃恢复、完整规模、正式安装或切换。

M2 的旧 schema reader 只进入迁移工具，不能进入本包、注册常驻 provider 或提供自动回退；M6 必须删除活动实现。当前没有 reader、旧库副本、双写器、旧 RPC 别名或兼容开关。未来数据路径由统一 storage/path 配置提供，继续遵守现有 C/E 盘唯一受管根，不在家目录或源码内创建业务数据根。
