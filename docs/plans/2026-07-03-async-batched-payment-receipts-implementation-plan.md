# Async Batched Payment Receipts Implementation Plan

> **For worker:** REQUIRED SUB-SKILL: Use test-driven-development. Follow RED-GREEN-REFACTOR for every behavior change.

**Goal:** Make research answers stop waiting on ARC receipts and reduce chain traffic to at most one settlement transaction per research run.

**Architecture:** Keep direct paid API receipts on the existing synchronous path. Add a research-specific payment intent path that writes pending `tx_log` rows immediately, then asynchronously settles all pending rows for the same research with one ARC settlement receipt. Use durable database state, not in-memory state, as the source of truth for pending settlement and retry.

**Tech Stack:** Next.js 14 route handlers, Vitest, Drizzle/Vercel Postgres, viem, existing OpenSpec change `async-batched-payment-receipts`.

---

## Coordination Rules

- The controller owns planning. The worker owns implementation. The reviewer owns independent review.
- Do not revert user/controller edits.
- Do not commit unless the controller explicitly asks later.
- Keep direct `/api/data/*` payment behavior working unless the spec explicitly changes it.
- Keep follow-up Q&A off-chain.
- Every production-code edit needs a failing test first.
- After code changes, run the graphify rebuild command required by project instructions.

## Relevant Specs

- `openspec/changes/async-batched-payment-receipts/specs/arc-payment-receipts/spec.md`
- `openspec/changes/async-batched-payment-receipts/specs/research-agent-engine/spec.md`
- `openspec/changes/async-batched-payment-receipts/tasks.md`

## Task 1: Payment Intent And Settlement Storage

**Files:**
- Modify: `lib/db/tx-log-repo.ts`
- Modify: `lib/db/tx-log-repo-memory.ts`
- Modify: `lib/db/tx-log-repo-pg.ts`
- Modify: `lib/db/schema/tx-log.ts`
- Create: `lib/db/payment-settlement-repo.ts`
- Create: `lib/db/payment-settlement-repo-memory.ts`
- Create: `lib/db/payment-settlement-repo-pg.ts`
- Create: `lib/db/schema/payment-settlement.ts`
- Modify: `lib/db/schema/index.ts`
- Modify: `lib/db/index.ts`
- Test: `lib/db/tx-log-repo-memory.test.ts`
- Test: `lib/db/payment-settlement-repo-memory.test.ts`
- Test: `lib/db/index.test.ts`

**Step 1: Write failing tx_log storage tests**

Add tests that prove:
- `record(... txStatus: "pending")` can store a `settlementId` or equivalent settlement link.
- `listPendingByResearchId(address, researchId)` returns only pending rows for that owned research.
- `markResearchSettlementConfirmed(...)` updates all rows in a batch to `confirmed` with one shared txHash/chainId/blockNumber.
- `markResearchSettlementFailed(...)` updates all rows in a batch to `failed` with errorMessage.

Run:

```bash
pnpm vitest run lib/db/tx-log-repo-memory.test.ts
```

Expected RED: tests fail because the repo lacks settlement fields and batch methods.

**Step 2: Write failing settlement repo tests**

Create `lib/db/payment-settlement-repo-memory.test.ts` covering:
- `claimResearchSettlement(address, researchId, requestIds, totalAmount)` creates one pending/broadcasting settlement row.
- A second claim for the same `address + researchId` returns existing/in-progress instead of creating another claim.
- `confirmSettlement` stores txHash, chainId, blockNumber, status confirmed.
- `failSettlement` stores status failed, attempts increment or error preserved.
- `listRetryableSettlements()` returns failed or stale broadcasting rows, not confirmed rows.

Run:

```bash
pnpm vitest run lib/db/payment-settlement-repo-memory.test.ts
```

Expected RED: module missing.

**Step 3: Implement minimal storage**

Implement types and memory repos first. Recommended shapes:

```ts
export type SettlementStatus = 'pending' | 'broadcasting' | 'confirmed' | 'failed'

export type PaymentSettlement = {
  id: string
  address: string
  researchId: string
  requestIds: string[]
  totalAmount: string
  status: SettlementStatus
  txHash: string | null
  chainId: number | null
  blockNumber: string | null
  attempts: number
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}
```

Then implement Postgres schema/repo following current Drizzle patterns. Use JSON/text for `requestIds` if no array helper is already used locally.

**Step 4: Verify**

Run:

```bash
pnpm vitest run lib/db/tx-log-repo-memory.test.ts lib/db/payment-settlement-repo-memory.test.ts lib/db/index.test.ts
pnpm typecheck
```

Expected GREEN: new storage tests pass, typecheck passes.

## Task 2: Research Payment Intent Recorder

**Files:**
- Modify: `lib/x402/payment-recorder.ts`
- Test: `lib/x402/payment-recorder.test.ts`

**Step 1: Write failing tests**

Add tests for a new research-specific API such as `recordResearchPaymentIntent()`:
- Creates a pending tx_log entry.
- Does not call `recordArcReceipt`.
- Requires valid requestId/idempotency key.
- Reuses existing pending/confirmed entries correctly for same scope.
- Throws conflict for same `address + requestId` with different source/amount/researchId.

Run:

```bash
pnpm vitest run lib/x402/payment-recorder.test.ts
```

Expected RED: new API missing.

**Step 2: Implement minimal intent recorder**

Add an exported function, for example:

```ts
export async function recordResearchPaymentIntent(input: PaymentReceiptInput, deps: PaymentRecorderDeps = {}) {
  // validate requestId
  // repo.claimRequest(...)
  // return pending/existing entry without calling recordArcReceipt
}
```

Keep existing `recordPaymentReceipt()` semantics for direct APIs.

**Step 3: Verify**

Run:

```bash
pnpm vitest run lib/x402/payment-recorder.test.ts lib/x402/with-payment.test.ts
```

Expected GREEN: new intent behavior passes and direct payment wrapper remains unchanged.

## Task 3: Batched ARC Settlement Service

**Files:**
- Modify: `lib/chain/arc-receipt.ts`
- Create: `lib/x402/payment-settlement.ts`
- Test: `lib/chain/arc-receipt.test.ts`
- Test: `lib/x402/payment-settlement.test.ts`

**Step 1: Write failing ARC payload tests**

Add tests for `buildResearchSettlementPayload()` and encoding:
- kind is `arc-lepton.research-settlement`
- includes buyer, researchId, totalAmount, itemCount, items, createdAt
- items include requestId, source, amount

Run:

```bash
pnpm vitest run lib/chain/arc-receipt.test.ts
```

Expected RED: settlement payload builder missing.

**Step 2: Write failing settlement service tests**

Cover:
- No pending rows means no ARC call.
- Multiple pending rows for one research produce exactly one ARC call.
- Success updates all pending rows to confirmed with shared txHash.
- Failure updates all pending rows to failed and preserves errorMessage.
- Concurrent claim returns in-progress/existing and does not rebroadcast.

Run:

```bash
pnpm vitest run lib/x402/payment-settlement.test.ts
```

Expected RED: service missing.

**Step 3: Implement settlement service**

Keep it small:
- Query pending entries by `address + researchId`.
- Claim a settlement row.
- Build payload and call ARC recorder once.
- Batch update tx_log rows.
- Return a structured summary for logs/tests.

Use dependency injection so tests can pass fake repos and fake ARC recorder.

**Step 4: Verify**

Run:

```bash
pnpm vitest run lib/chain/arc-receipt.test.ts lib/x402/payment-settlement.test.ts
pnpm typecheck
```

Expected GREEN.

## Task 4: Research Agent Integration

**Files:**
- Modify: `lib/agent/research-agent.ts`
- Test: `lib/agent/research-agent.test.ts`

**Step 1: Write failing tests**

Update mocks to expose `recordResearchPaymentIntent` and `settleResearchPayments`.

Add tests:
- Tool calls emit `tool_result.payment.txStatus === "pending"` with `txHash === null`.
- Tool calls do not use `recordPaymentReceipt`.
- Final event is emitted before settlement promise resolves.
- Settlement is triggered after `completeIfRunning` succeeds.
- If settlement fails after final, research stays completed.

Run:

```bash
pnpm vitest run lib/agent/research-agent.test.ts
```

Expected RED.

**Step 2: Implement minimal integration**

In `executeTool()`, replace `recordPaymentReceipt()` with `recordResearchPaymentIntent()`.

After research completion:
- Trigger `settleResearchPayments({ address, researchId })`.
- Do not await it in the user-visible path if it would block `final`.
- Catch/log errors in Chinese, and keep report completed.

Be careful with cancellation:
- If cancelled before final, do not schedule a normal settlement unless spec/test requires settlement of already-created intents.
- If final already emitted, settlement failure should not flip research to failed.

**Step 3: Verify**

Run:

```bash
pnpm vitest run lib/agent/research-agent.test.ts app/api/research/[id]/stream/route.test.ts
pnpm typecheck
```

Expected GREEN.

## Task 5: API And UI Status

**Files:**
- Modify: `components/research/types.ts`
- Modify: `components/research/TxFeed.tsx`
- Modify: `components/research/AgentLogStream.tsx` only if needed
- Modify: `app/api/research/[id]/route.ts`
- Modify: `app/api/wallet/tx-log/route.ts`
- Modify: `app/research/[id]/ResearchDetailClient.tsx`
- Test: `components/research/TxFeed.test.tsx`
- Test: `components/research/AgentLogStream.test.tsx` only if event text changes
- Test: `app/api/research/[id]/route.test.ts`
- Test: `app/api/wallet/wallet-routes.test.ts`
- Test: `app/api/research/[id]/follow-ups/route.test.ts`

**Step 1: Write failing tests**

Cover:
- Pending payment displays `pending settlement`, no explorer link.
- Confirmed shared settlement txHash can appear on multiple logical rows.
- Wallet/detail APIs serialize settlement fields if added.
- Follow-up POST does not create payment intent or settlement.

Run targeted tests:

```bash
pnpm vitest run components/research/TxFeed.test.tsx app/api/research/[id]/route.test.ts app/api/wallet/wallet-routes.test.ts app/api/research/[id]/follow-ups/route.test.ts
```

Expected RED where new behavior is missing.

**Step 2: Implement UI/API changes**

Prefer minimal UI changes:
- `paymentStatusLabel('pending')` should return `pending settlement`.
- `shortHash(null)` can remain `not broadcast`.
- Only confirmed + txHash gets explorer link.
- If settlement id/status fields are added, serialize them consistently.

**Step 3: Verify**

Run targeted tests again, then:

```bash
pnpm typecheck
```

Expected GREEN.

## Task 6: Docs, OpenSpec Tasks, And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `openspec/changes/async-batched-payment-receipts/tasks.md`

**Step 1: Update docs**

README should explain:
- research agent writes pending intents immediately
- research settlement uses at most one ARC transaction per research
- direct paid API requests still use real-time receipt path
- pending/failed/confirmed display semantics

**Step 2: Mark OpenSpec tasks**

Only mark a task `[x]` if the implementation and tests actually satisfy it.

**Step 3: Final verification**

Run:

```bash
openspec validate async-batched-payment-receipts --strict
pnpm vitest run lib/db/tx-log-repo-memory.test.ts lib/db/payment-settlement-repo-memory.test.ts lib/x402/payment-recorder.test.ts lib/x402/payment-settlement.test.ts lib/chain/arc-receipt.test.ts lib/agent/research-agent.test.ts components/research/TxFeed.test.tsx app/api/research/[id]/route.test.ts app/api/wallet/wallet-routes.test.ts app/api/research/[id]/follow-ups/route.test.ts
pnpm typecheck
pnpm build
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected GREEN or a clear report of any environment-only blocker.
