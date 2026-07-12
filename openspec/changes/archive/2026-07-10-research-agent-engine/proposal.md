# Change: Agent 研究引擎
## Why
Phase 3 需要把 x402 mock 数据源串成可演示的核心产品能力：用户提交研究主题后，由 DeepSeek V4 通过 tool calling 选择数据源、产生扣费记录，并通过 SSE 实时输出研究过程和报告。

## What Changes
- 增加 DeepSeek OpenAI 兼容 client 和 dev mock fallback。
- 增加 `research` 表、Repository 三件套及 dev fallback。
- 增加 Agent loop：tool calling、预算控制、报告流式输出、取消/错误处理。
- 增加 in-memory event bus 和 research start/stream/detail/cancel API。
- 增加测试覆盖 LLM fallback、research repo、agent loop、API start 路由。

## Impact
- Affected specs: `research-agent-engine`
- Affected code: `lib/llm/*`, `lib/agent/*`, `lib/db/*`, `app/api/research/*`, `package.json`
