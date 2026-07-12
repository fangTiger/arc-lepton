# Change: Research Web UI
## Why
Phase 4 需要把 Phase 3 的研究 Agent 能力呈现成可录制演示的核心界面：创建研究、实时 SSE 执行、报告详情、dashboard 历史和首页实时统计。

## What Changes
- 增加 `/research` 创建与 Live 执行双模式页面。
- 增加 `/research/[id]` 报告详情页，支持 markdown 渲染和 tx 数据源表。
- 重做 `/dashboard`，接真实钱包统计和 research 历史。
- 增加公开 `/api/stats/global` 和当前用户 `/api/research` 列表端点。
- 首页 stats 改为轮询真实全局数据。
- 增加 `react-markdown` 与 `remark-gfm`，保持 Bloomberg 终端风格。

## Impact
- Affected specs: `research-web-ui`
- Affected code: `app/research/*`, `components/research/*`, `app/dashboard/page.tsx`, `app/page.tsx`, `app/api/research/route.ts`, `app/api/stats/global/route.ts`
