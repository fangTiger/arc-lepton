# Payment Intent Snapshot RED Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 7.2 固化 ARC Escrow payment intent 的持久快照字段、canonical key 派生和幂等复用语义。

**Architecture:** 以 `tx_log` 作为 V1 payment intent 载体，在现有 pending intent 之上补齐 canonical `paymentIntentId/toolOrdinal/requestKey`、source/Registry 快照、六位 `amountUnits`、payload hash 与 Escrow 绑定字段。runner 如何分配 durable lease/outbox 留给 7.3；本任务只要求调用方已提供 canonical paymentIntentId/toolOrdinal 时，repo 能稳定保存并复用同一 intent。

**Tech Stack:** TypeScript、Vitest、Drizzle schema、现有 `MemoryTxLogRepo`/`PgTxLogRepo`、`lib/chain/canonical.ts`、`lib/chain/amounts.ts`。

---

### Task 1: RED — tx_log payment intent 快照测试

**Files:**
- Modify: `lib/db/tx-log-repo-memory.test.ts`
- Modify: `lib/x402/payment-recorder.test.ts`

**Step 1: Write failing tests**

新增测试覆盖：

- `MemoryTxLogRepo.claimResearchPaymentIntent()` 保存 pending intent，字段包括：
  - `paymentIntentId`
  - `toolOrdinal`
  - `requestId` 与 `requestKey`，且 `requestId === requestKey`
  - `sourceId`
  - `registryRevision`
  - `expectedPayout`
  - `maxUnitPrice`
  - `registryReadBlock`
  - `amountUnits`
  - `payloadHash`
  - `escrowAddress`
  - `researchKey`
  - `backend='escrow'`
  - `version=1`
- `requestKey` 必须由 `requestKey(researchKey, paymentIntentId)` 派生，`sourceId` 必须由 `sourceId(source)` 派生。
- 相同 `(address,researchId,toolOrdinal,paymentIntentId)` retry 复用同一 row，不创建第二个 requestKey。
- 相同 `(address,researchId,toolOrdinal)` 但 paymentIntentId/source/amount/Registry snapshot/Escrow 绑定不同必须冲突。
- `amountUnits` 必须由 scale-8 decimal 精确换算为六位 units，不能截断。
- `recordResearchPaymentIntent()` 在提供 escrow snapshot 时只写 pending intent，不调用 ARC recorder，并返回 `tool_result.payment` 可用的 `requestKey/escrowAddress`。

**Step 2: Run RED**

Run:

```bash
npm test -- lib/db/tx-log-repo-memory.test.ts lib/x402/payment-recorder.test.ts
```

Expected: fail，因为 repo 尚无 `claimResearchPaymentIntent()`，entry 类型/schema 也没有 payment intent 快照字段。

### Task 2: GREEN — 最小 tx_log/repo/payment-recorder 实现

**Files:**
- Modify: `lib/db/tx-log-repo.ts`
- Modify: `lib/db/tx-log-repo-memory.ts`
- Modify: `lib/db/tx-log-repo-pg.ts`
- Modify: `lib/db/schema/tx-log.ts`
- Modify: `lib/db/index.ts`
- Modify: `lib/x402/payment-recorder.ts`
- Modify if needed: `components/research/types.ts`

**Step 1: Extend types**

在 `TxLogEntry` 上增加 nullable snapshot 字段；旧 mock/confirmed 直接 receipt 路径默认全部为 `null`，避免破坏 legacy API。

新增 `TxLogResearchPaymentIntentInput`，要求调用方提供：

- `address`
- `researchId`
- `source`
- `amount`
- `paymentIntentId`
- `toolOrdinal`
- `researchKey`
- `escrowAddress`
- `registryRevision`
- `expectedPayout`
- `maxUnitPrice`
- `registryReadBlock`
- `payload`

**Step 2: Canonical derivation**

- `requestKey = canonical.requestKey(researchKey, paymentIntentId)`
- `sourceId = canonical.sourceId(source)`
- `amountUnits = parseScale8DecimalToUnits6(amount).toString()`
- `payloadHash = keccak256(toBytes(stableStringify(payload)))`

**Step 3: Repo behavior**

- `claimResearchPaymentIntent(input)` inserts pending row with `requestId=requestKey` and full snapshot.
- Unique/idempotent scope remains address+requestId；on replay, compare every immutable snapshot field.
- Any mismatch throws `PaymentIdempotencyConflictError` with `requestId=requestKey` and existing row.

**Step 4: Payment recorder behavior**

- `recordResearchPaymentIntent()` accepts optional escrow snapshot fields. If absent, keep old pending `claimRequest()` behavior for legacy tests.
- If present, call `claimResearchPaymentIntent()` and return the pending/scoped row.

### Task 3: Verification and records

Run:

```bash
npm test -- lib/db/tx-log-repo-memory.test.ts lib/x402/payment-recorder.test.ts
npm test -- lib/agent/research-agent.test.ts lib/x402/payment-settlement.test.ts app/api/wallet/wallet-routes.test.ts 'app/api/research/[id]/route.test.ts'
npm run typecheck
npm test
git diff --check
openspec validate onchain-research-escrow --strict --no-interactive
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Update `.devos/tasks/onchain-research-escrow-7-2/` and mark OpenSpec task 7.2 complete only after review.
