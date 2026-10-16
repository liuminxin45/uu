# Eight-layer context core · M1b

`@uu/core/context` 是纯计算入口：不导入 Memory 实现或 Node 内置模块，不访问文件、网络、数据库、环境变量、模型、日志或产品配置。PHD 与未来其他宿主都直接消费这一个版本；依赖方向是 Host → uu。

## 已迁入

- `UuInvocation/UuPromptPlan/UuLayers` 等类型。
- `compileUuPrompt/uuSection`：八层、三段拼装、profile、去重、资料及历史预算、覆盖清单。
- `uuInspectionCommand/renderUuInspection`：明确命令识别、八层状态检查和常见凭据遮盖。
- `normalizeUuContextReference/mapUuContext`：仅保留来源引用，保持顺序并限制读取并发。实际读取由传入的 Host 回调执行。

| 语义层 | 内容 | 拼接段 |
|---|---|---|
| L1 identity | 身份 | stable |
| L2 tools | 工具指导 | stable |
| L3 external-memory | 外部记忆 | volatile |
| L4 instructions | 宿主业务指令 | context |
| L5 memory | 长期记忆 | volatile |
| L6 user | 用户偏好 | volatile |
| L7 skills | 技能索引 | volatile |
| L8 project | 项目上下文 | context |

实际段顺序为 `identity/tools → instructions/project → skills/memory/user/external-memory`；八层清单始终可见，空层与 inference 禁用层有明确状态。新问题、召回结果和历史不能改变冻结的指令前缀。来源资料和历史只进入本轮数据，不能提升为可执行指令。预算仍按字符计算，当前用户请求及 required 资料不静默截断。

## 留在 Host

业务原件、授权和项目范围确认、Memory RPC、技能发现、文件读取、产品 AgentBundle 字段映射、配置和凭据、诊断与功能统计、Codex 子进程及原生会话控制都归宿主管理。本阶段迁移既有上下文能力，不新增执行循环、数据库或第二个会话存储。

`UuPromptPresentation` 和 `UuInspectionPresentation` 只提供展示文案。默认没有产品名称或专用 RPC；PHD 自己提供原有清单说明、检查介绍及原生 AGENTS 说明，以保持当前指令和报告逐字一致。这些文案属于受信任的 Host 配置，不能取自召回资料或用户正文。原生执行内核的基础指令不包含在 uu 的宿主检查中。

## 消费与验证

```ts
import {compileUuPrompt, renderUuInspection} from '@uu/core/context';

const plan = compileUuPrompt({profile:'conversation', turn:{text:'合成问题'}});
const inspection = renderUuInspection(plan, false);
```

CLI 演示：`npm run uu -- context inspect --fixture ./fixtures/context-demo.json --full`。仅读取显式合成夹具，不调用模型；正文只写入用户请求的 stdout 检查报告，不进入 stderr 诊断。真实业务的数据取值和授权不能靠这份夹具验收替代。

`fixtures/context-parity.json` 是从迁移前 PHD 提交 `06a722c560a611926fe574b3d3827a5f9a26ac9b` 的纯编译器生成的九组合成基线：三种 profile、空层原因、跨回合稳定前缀、预算损失与错误。测试比较完整 plan 的 JSON 字节、summary/full 检查文本及错误码。夹具不进入正常包，没有保留旧编译器或运行时 fallback。

PHD 删除原来的 `types/prompt/inspection/context-references/bundle` 本地模块。业务 AgentBundle 映射移到 Host 适配；所有消费者直接引用新包，禁止将旧路径恢复为转发层。原有安装版尚未被本阶段替换；源码和隔离包验收不能宣称正式安装已迁入。
