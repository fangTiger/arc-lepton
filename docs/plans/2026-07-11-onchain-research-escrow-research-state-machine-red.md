# Research State Machine RED Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 7.1 固化 research schema/repo 的四维状态表和合法转换，先用 RED 测试暴露旧单状态模型缺口，再做不涉及真实迁移脚本的最小 repo/schema 实现。

**Architecture:** 在 `ResearchRepo` 层增加 research status、activationPhase、finalizationState、quotaReservationState 四个维度及条件转换方法；memory repo 作为最小可执行实现，PG repo 和 Drizzle schema 只补字段/类型与同名接口，正式 migrator、journal、advisory lock 留给 7.4。旧 mock/legacy `create()` 继续保持单步 running 行为。

**Tech Stack:** TypeScript、Vitest、Drizzle schema types、现有 memory/pg repository abstraction。

---

### Task 1: RED — 四维状态字段与合法转换测试

**Files:**
- Modify: `lib/db/research-repo-memory.test.ts`
- Modify: `lib/db/schema/research.ts`

**Step 1: Write failing tests**

新增测试覆盖：

- funding research 初始四元组：`funding / none / none / reserved`。
- 无 clone 过期：`funding_expired / expired / none / released`。
- 无 clone 主动取消：`cancelled / cancelled / none / released`。
- Funded 过期待 buyer 退款：`funding_expired / expired / none / released`。
- Funded 的 cancelUnactivated receipt 对账后：`cancelled / cancelled / closed / released`；若此前已 `funding_expired`，status 保持 `funding_expired`。
- ACTIVATE 后才观察到取消：`cancelled / active / closing→closed / consumed`。
- Active 正常启动：`running / active / open / consumed`。
- 非法回边必须失败且不改记录：`released→reserved`、`consumed→activating`、`closed→closing`、`active→funded`、terminal research status 回到 running。

**Step 2: Run RED**

Run: `npm test -- lib/db/research-repo-memory.test.ts`

Expected: fail，因为旧 repo 没有四维状态字段、funding create 或条件转换 API。

### Task 2: GREEN — 最小 repo/schema 实现

**Files:**
- Modify: `lib/db/research-repo.ts`
- Modify: `lib/db/research-repo-memory.ts`
- Modify: `lib/db/research-repo-pg.ts`
- Modify: `lib/db/schema/research.ts`
- Modify if needed: serializers using `startedAt`

**Step 1: Extend types**

增加：

- `ResearchStatus = 'funding' | 'funding_expired' | 'running' | 'completed' | 'failed' | 'cancelled'`
- `ResearchActivationPhase = 'none' | 'funded' | 'activating' | 'active' | 'expired' | 'cancelled'`
- `ResearchFinalizationState = 'none' | 'open' | 'closing' | 'closed' | 'manual'`
- `QuotaReservationState = 'none' | 'reserved' | 'activating' | 'consumed' | 'released'`

**Step 2: Add minimal methods**

新增 repo 方法：

- `createFunding(input)`：创建 `funding/none/none/reserved`。
- `transitionLifecycle(id, expected, next)`：按四维状态做条件更新，并拒绝非法单维回边。

**Step 3: Preserve legacy behavior**

旧 `create()` 仍返回 running research，用于 mock/legacy；建议默认 `activationPhase='active'`、`finalizationState='open'`、`quotaReservationState='consumed'`。

**Step 4: Run focused test**

Run: `npm test -- lib/db/research-repo-memory.test.ts`

Expected: pass.

### Task 3: Verification and records

Run:

- `npm test -- lib/db/research-repo-memory.test.ts lib/db/index.test.ts`
- `npm test -- lib/db/research-repo-memory.test.ts app/api/research/start/route.test.ts app/api/research/[id]/route.test.ts app/api/research/route.test.ts app/api/research/[id]/cancel/route.test.ts`
- `npm run typecheck`
- `git diff --check`
- `openspec validate onchain-research-escrow --strict --no-interactive`

Update `.devos/tasks/onchain-research-escrow-7-1/` and only mark task 7.1 complete after reviewer/root review.
