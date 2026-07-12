# Workflow Outbox and Durable Event RED Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 7.3 固化 Escrow backend 所需的 workflow outbox、runner lease/fencing 与 durable research event/checkpoint repo。

**Architecture:** 新增独立 repo 层：`WorkflowOutboxRepo` 保存 ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE operation、phase、受保护 payload digest、lease/fencing、retry/backoff、tx/error/log locator；`ResearchEventRepo` 保存可 replay 的单调 event/checkpoint。memory repo 用于 RED/GREEN 行为验证，PG schema/repo 同步接口；正式 migrator、advisory lock 和生产切换留给 7.4。

**Tech Stack:** TypeScript、Vitest、Drizzle schema、现有 db repo/lazy wrapper 模式。

---

### Task 1: RED — workflow outbox lease/fencing 测试

**Files:**
- Create: `lib/db/workflow-outbox-repo-memory.test.ts`

**Step 1: Write failing tests**

覆盖：

- `claimOperation()` 对同一 `operationKey` 幂等，只创建一个逻辑 operation。
- operation type 至少支持 `ACTIVATE | RUN | SETTLE | RECONCILE | CLOSE`。
- 新 claim 保存 `operationKey/researchId/escrowAddress/type/phase/payloadHash/protectedPayloadDigest/attempts/nextAttemptAt/leaseOwner/leaseExpiresAt/fencingToken/txHash/lastError/log locator`。
- 多 worker 同时/重复 claim：未过期 lease 返回 existing，不获得广播权。
- lease 过期后新 worker claim：`fencingToken` 单调增加，`attempts` 增加，旧 fence 的 checkpoint/phase 写入失败。
- `recordBroadcast()` 保存 `txHash/chainId/blockNumber`，不泄漏 protected payload 原文。
- `failAndRelease()` 保存脱敏 `lastError`、`nextAttemptAt`，释放 lease，之后到期可被新 worker claim。
- `complete()` 进入 terminal phase 后不可再次 claim/broadcast。

**Step 2: Run RED**

Run:

```bash
npm test -- lib/db/workflow-outbox-repo-memory.test.ts
```

Expected: fail，因为 repo/types 尚不存在。

### Task 2: RED — durable research event/checkpoint 测试

**Files:**
- Create: `lib/db/research-event-repo-memory.test.ts`

**Step 1: Write failing tests**

覆盖：

- `appendEvent()` 为同一 research 分配单调 `eventId`/`cursor`，按插入顺序 replay。
- `listByResearch(researchId, { afterCursor })` 支持冷启动/Last-Event-ID 式增量恢复。
- 相同 `dedupeKey` retry 返回既有事件，不产生逻辑重复事件。
- checkpoint 记录 `operationKey/attempt/fencingToken/payloadHash`，payload 可以重建 event，但公开字段不包含 protected payload 原文。

**Step 2: Run RED**

Run:

```bash
npm test -- lib/db/research-event-repo-memory.test.ts
```

Expected: fail，因为 repo/types 尚不存在。

### Task 3: GREEN — 最小 repo/schema 实现

**Files:**
- Create: `lib/db/workflow-outbox-repo.ts`
- Create: `lib/db/workflow-outbox-repo-memory.ts`
- Create: `lib/db/workflow-outbox-repo-pg.ts`
- Create: `lib/db/schema/workflow-outbox.ts`
- Create: `lib/db/research-event-repo.ts`
- Create: `lib/db/research-event-repo-memory.ts`
- Create: `lib/db/research-event-repo-pg.ts`
- Create: `lib/db/schema/research-event.ts`
- Modify: `lib/db/schema/index.ts`
- Modify: `lib/db/index.ts`

**Step 1: Implement workflow outbox**

最小字段：

- `operationKey`, `type`, `researchId`, `escrowAddress`
- `phase`
- `payloadHash`, `protectedPayloadDigest`
- `leaseOwner`, `leaseExpiresAt`, `fencingToken`
- `attempts`, `nextAttemptAt`, `lastError`
- `txHash`, `chainId`, `blockNumber`, `blockHash`, `logIndex`
- `createdAt`, `updatedAt`

最小方法：

- `claimOperation(input)`
- `recordCheckpoint(id, fencingToken, patch)`
- `recordBroadcast(id, fencingToken, patch)`
- `failAndRelease(id, fencingToken, patch)`
- `complete(id, fencingToken, patch?)`
- `findByOperationKey(operationKey)`
- `listDueOperations(query?)`

**Step 2: Implement durable events**

最小字段：

- `id`, `researchId`, `cursor`, `type`, `payload`, `payloadHash`
- `operationKey`, `attempt`, `fencingToken`, `dedupeKey`
- `createdAt`

最小方法：

- `appendEvent(input)`
- `listByResearch(researchId, query?)`
- `latestCheckpoint(researchId)`

### Task 4: Verification and records

Run:

```bash
npm test -- lib/db/workflow-outbox-repo-memory.test.ts lib/db/research-event-repo-memory.test.ts
npm run typecheck
npm test
git diff --check
openspec validate onchain-research-escrow --strict --no-interactive
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Update `.devos/tasks/onchain-research-escrow-7-3/` and mark OpenSpec task 7.3 complete only after review.
