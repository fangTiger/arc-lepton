## Context

项目在该变更前只有认证、钱包上下文和独立的 x402 mock 数据源，尚未形成“用户提交主题—Agent 选择数据源—预算扣减—实时展示—报告持久化”的完整研究流程。本变更需要跨越 LLM 适配、Agent 循环、数据存储、进程内事件分发和 Next.js API，并同时支持无外部服务的本地开发体验与生产环境的失败显式化。

## Goals / Non-Goals

**Goals:**

- 通过 OpenAI 兼容客户端接入 DeepSeek，并为非生产环境提供确定性的 mock fallback。
- 让 Agent 在用户预算内选择并调用现有数据工具，持续输出工具、预算和报告事件。
- 持久化 research 生命周期，并通过统一 Repository 接口支持 Postgres 与内存实现。
- 提供 start、detail、stream、cancel API，确保资源归属和取消信号与登录钱包绑定。
- 允许客户端订阅 SSE 实时事件，并在短期断线重连时 replay 已产生的事件。

**Non-Goals:**

- 不实现分布式任务队列、跨进程事件总线或长期事件存档。
- 不实现真实数据源、真实 USDC 支付或完整 x402 协议结算。
- 不保证 LLM 输出本身可复现；测试通过依赖注入与 mock client 验证控制流。
- 不在该变更中实现追问、多模型路由或复杂的 Agent 规划框架。

## Decisions

### Decision 1: 使用薄适配层封装 DeepSeek OpenAI 兼容 API

`lib/llm/deepseek.ts` 统一创建客户端并选择模型。生产环境缺少 key 时立即失败，非生产环境返回具备同一调用接口的 mock client。这样业务层只依赖窄接口，测试无需访问外网，也避免把供应商配置分散到 API 和 Agent 模块中。

替代方案是直接在每个调用点初始化 OpenAI SDK；该方案配置重复、难以稳定测试，因此不采用。

### Decision 2: Agent 循环显式管理工具、预算和终态

`runResearchAgent()` 使用 async generator 输出结构化 `AgentEvent`。每轮解析 tool calls，执行已注册的本地工具，写入扣费记录并更新预算；预算不足、无可执行工具或达到调用上限后进入报告生成。完成、失败和取消分别写入 research 终态，避免 API、UI 与数据库各自推断状态。

替代方案是引入通用 Agent framework；在 hackathon 范围内会增加依赖和隐式状态，且无法明显改善五个固定工具的控制流，因此采用显式循环。

### Decision 3: Repository 接口隔离持久化实现

`ResearchRepo` 定义创建、查询、状态转换、花费累计和报告保存能力；生产优先使用 Postgres，缺少数据库的开发环境使用内存实现。状态更新使用条件更新方法避免已取消或已完成任务被迟到结果覆盖。

替代方案是由 Agent 直接调用 Drizzle；这会让 Agent 测试依赖数据库并使开发 fallback 难以保持一致，因此不采用。

### Decision 4: 进程内事件总线负责实时分发与短期 replay

事件总线按 `researchId` 保存事件、订阅者、runner claim 和 `AbortController`，终态后保留有限时间再清理。SSE 路由先 replay 历史，再订阅新增事件；runner claim 防止多个订阅者重复启动同一任务。

该方案适合单进程演示，但不是跨实例可靠消息系统。相比引入 Redis Streams 或外部队列，它能以更低复杂度满足当前实时 UI；横向扩展能力作为后续工作处理。

### Decision 5: API 层统一执行认证与资源归属校验

start API 只接受通过校验的 topic 与 budget，并将认证钱包地址写入 research；detail、stream 和 cancel 均要求当前地址拥有该记录。取消通过共享 `AbortController` 传播到 Agent 与流式响应，避免仅更新数据库而后台仍继续消耗资源。

## Risks / Trade-offs

- [Serverless 实例切换导致事件和取消状态丢失] → research 终态和报告以数据库为准；当前事件总线仅承诺进程内实时体验，后续可迁移到持久队列。
- [多个请求竞争运行同一 research] → 使用 runner claim 和条件状态更新，终态事件只能发布一次。
- [LLM 返回未知工具或超预算调用] → 工具使用固定注册表，执行前检查名称、参数、预算和调用上限。
- [客户端断线造成事件遗漏] → 在 TTL 内 replay 进程内历史，详情 API 从持久化 research 恢复最终报告和状态。
- [开发 fallback 掩盖生产配置错误] → mock client 仅允许非生产环境，生产缺少 key 时 fail closed。

## Migration Plan

1. 先部署 research schema 和 Repository，确认 Postgres 与内存实现满足同一测试契约。
2. 启用 DeepSeek 客户端和 Agent 循环，再开放 start/detail API。
3. 接入事件总线、stream 与 cancel 路由，验证 SSE replay 和取消终态。
4. 部署后以一次完整 research smoke 验证创建、工具调用、预算、报告与恢复流程。
5. 回滚时停止新建 research，并回退 API/Agent 代码；新增表可保留，不影响已有认证与数据源接口。

## Open Questions

- 跨实例部署需要 Redis Streams、队列还是数据库 outbox，留待后续扩展时决定。
- 事件长期审计是否进入独立持久表，取决于真实使用量和恢复需求。
