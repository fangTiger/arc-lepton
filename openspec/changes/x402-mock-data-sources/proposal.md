# Change: x402 mock data sources and tx_log accounting

## Why
Phase 2 需要后端提供可重复演示的付费数据源，并把每次调用记入 tx_log，支撑 dashboard 后续展示调用历史、总花费和最近研究时间。当前系统只有用户登录持久化，缺少数据源计费、支付凭证响应头和钱包统计接口。

## What Changes
- 新增 `tx_log` Drizzle schema、repository interface、Postgres 实现和本地 memory fallback。
- 新增 `withPayment` HOC，在 API route 中执行 `requireAuth`、记账并返回 x402 风格支付响应头。
- 新增 5 个确定性 mock 数据源端点：whale-watch、sentiment、news、twitter-signals、kline-pattern。
- 新增钱包端点：最近 tx_log 列表和统计汇总。

## Impact
- Affected specs: x402-mock-data
- Affected code: lib/db/*, lib/db/schema/*, lib/x402/*, app/api/data/*, app/api/wallet/*, drizzle.config.ts
