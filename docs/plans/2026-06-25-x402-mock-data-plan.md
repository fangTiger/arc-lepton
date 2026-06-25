# x402 Mock Data Sources Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 5 个 x402 风格 mock 数据源、统一 payment HOC，以及 tx_log 记账与钱包统计接口。

**Architecture:** 复用现有 users repo fallback 结构，把 tx_log 做成 interface + memory + pg 三件套，并在 `lib/db/index.ts` 统一按 DB env 选择。API route 通过 `withPayment(source, amount, handler)` 先认证、再记账、再返回业务 JSON 和 x402 响应头。

**Tech Stack:** Next.js App Router API routes、Drizzle ORM、Vitest、现有 jose session JWT、Node crypto。

---

### Task 1: OpenSpec and tx_log repo tests

**Files:**
- Create: `openspec/changes/x402-mock-data-sources/*`
- Create: `lib/db/tx-log-repo-memory.test.ts`

**Steps:**
- 写 memory repo RED 测试：record 生成 id/txHash/createdAt，listByAddress 倒序+limit，totalSpentByAddress 汇总 decimal string。
- 跑 `pnpm vitest run lib/db/tx-log-repo-memory.test.ts`，预期因缺模块失败。
- 实现 `lib/db/schema/tx-log.ts`、`lib/db/tx-log-repo.ts`、`lib/db/tx-log-repo-memory.ts`、`lib/db/tx-log-repo-pg.ts`。
- 扩展 `lib/db/index.ts`，导出 `txLogRepo`，并更新 Drizzle schema 聚合。

### Task 2: Payment HOC

**Files:**
- Create: `lib/x402/with-payment.ts`
- Create: `lib/x402/with-payment.test.ts`

**Steps:**
- 写 RED 测试覆盖未登录 401、已登录调用 handler、响应头、tx_log 新记录。
- 实现 `withPayment`，捕获 `requireAuth` 抛出的 Response 并直接返回。
- 保持安全性：不加 dev bypass，不改变 `requireAuth`。

### Task 3: Mock data sources

**Files:**
- Create: `lib/data/mock-sources.ts`
- Create: `app/api/data/{whale-watch,sentiment,news,twitter-signals,kline-pattern}/route.ts`
- Create: `app/api/data/mock-sources.test.ts`

**Steps:**
- 写每个 source 至少 1 个 smoke RED 测试，验证 401 和已登录 JSON shape/payment。
- 实现基于 `token + YYYY-MM-DD + source` 的 hash PRNG，保证同天同 token 数据一致。
- 各 route 只解析 `?token=`，默认 `PEPE`，并通过 `withPayment` 包裹。

### Task 4: Wallet APIs and verification

**Files:**
- Create: `app/api/wallet/tx-log/route.ts`
- Create: `app/api/wallet/stats/route.ts`
- Create: `app/api/wallet/wallet-routes.test.ts`

**Steps:**
- 写 RED 测试覆盖 requireAuth、最近 50 条列表、totalSpentUsdc/totalCalls/lastResearchAt。
- 实现 route，从 `txLogRepo` 读取当前用户记录和总额。
- 运行 `pnpm typecheck`、`pnpm vitest run`、`pnpm build`。
- 重启 dev server，curl 未登录数据源应返回 401，日志不应出现 DB 连接错误。
