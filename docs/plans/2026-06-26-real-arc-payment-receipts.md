# Real ARC Payment Receipts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让每次付费数据源调用在 ARC receipt 模式下产生真实、explorer 可查的 ARC 测试网交易，并让 UI 准确展示 confirmed/mock/failed 状态。

**Architecture:** 第一版不引入合约，使用服务端 recorder 通过 `viem` 发送 0-value、带结构化 calldata 的 ARC 交易作为 receipt。新增统一 payment recorder 连接链上发送与 `tx_log`，`withPayment` 和 research agent 共用它；开发模式保留 mock，但 UI 不再把 mock 当 confirmed。

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest, Drizzle, Vercel Postgres, viem, wagmi.

---

## Context

OpenSpec change: `openspec/changes/real-arc-payment-receipts`

关键文件：
- `lib/db/tx-log-repo.ts`
- `lib/db/tx-log-repo-memory.ts`
- `lib/db/tx-log-repo-pg.ts`
- `lib/db/schema/tx-log.ts`
- `lib/x402/with-payment.ts`
- `lib/agent/research-agent.ts`
- `components/research/types.ts`
- `components/research/TxFeed.tsx`
- `app/api/wallet/tx-log/route.ts`
- `app/api/wallet/stats/route.ts`
- `app/api/research/[id]/route.ts`

必须遵守：
- 先写 RED 测试，再实现。
- 不打印、不提交私钥。
- `ARC_RECEIPT_MODE=arc` 时 fail closed；不能生成 confirmed mock。
- `ARC_RECEIPT_MODE` 未设置或为 `mock` 时允许开发 mock，但状态必须是 `mock`。
- 用户指定 worker/reviewer 使用 `gpt-5.4` + `xhigh`。

## Task 1: Extend tx_log Model

**Files:**
- Modify: `lib/db/tx-log-repo.ts`
- Modify: `lib/db/tx-log-repo-memory.ts`
- Modify: `lib/db/tx-log-repo-pg.ts`
- Modify: `lib/db/schema/tx-log.ts`
- Modify: `lib/db/tx-log-repo-memory.test.ts`
- Modify: existing tests that mock `txLogRepo.record`

**Step 1: Write the failing tests**

Update `lib/db/tx-log-repo-memory.test.ts` to assert:
- `record({ address, source, amount })` returns `txStatus: "mock"` by default.
- `record` accepts `txHash`, `txStatus: "confirmed"`, `chainId`, `blockNumber`, `requestId`.
- `record` accepts `txStatus: "failed"` and `errorMessage`.

**Step 2: Run RED**

Run:
```bash
pnpm vitest run lib/db/tx-log-repo-memory.test.ts
```

Expected: FAIL because the fields/types do not exist yet.

**Step 3: Implement**

Update `TxLogEntry` and `TxLogRepo.record` input to support:

```ts
export type TxStatus = 'mock' | 'pending' | 'confirmed' | 'failed'

export type TxLogRecordInput = {
  address: string
  source: string
  amount: string
  txHash?: string
  txStatus?: TxStatus
  chainId?: number | null
  blockNumber?: string | null
  requestId?: string
  errorMessage?: string | null
}
```

Defaults:
- `txHash`: generated mock hash
- `txStatus`: `mock`
- `chainId`: null
- `blockNumber`: null
- `requestId`: generated UUID
- `errorMessage`: null

Update Postgres schema fields as nullable/default where practical.

**Step 4: Run GREEN**

Run:
```bash
pnpm vitest run lib/db/tx-log-repo-memory.test.ts
```

Expected: PASS.

## Task 2: ARC Receipt Service

**Files:**
- Create: `lib/chain/arc-receipt.ts`
- Create: `lib/chain/arc-receipt.test.ts`
- Create: `lib/x402/payment-recorder.ts`
- Create: `lib/x402/payment-recorder.test.ts`

**Step 1: Write RED tests**

`arc-receipt.test.ts` should cover:
- `buildReceiptPayload` includes `kind`, `version`, `buyer`, `source`, `amount`, `requestId`.
- `encodeReceiptPayload` returns `0x...`.
- `recordArcReceipt` throws config error when mode is `arc` and private key/RPC/chainId is missing.
- With mocked `viem` clients, arc success calls `sendTransaction` and `waitForTransactionReceipt`, returning txHash, chainId, blockNumber, `confirmed`.
- Receipt failure returns/throws failed status.

`payment-recorder.test.ts` should cover:
- mock mode writes tx_log with `mock`.
- arc success writes tx_log with `confirmed`.
- arc failure writes tx_log with `failed` and throws a payment error.

**Step 2: Run RED**

Run:
```bash
pnpm vitest run lib/chain/arc-receipt.test.ts lib/x402/payment-recorder.test.ts
```

Expected: FAIL because modules do not exist.

**Step 3: Implement**

Use existing env helpers from `lib/constants.ts` where appropriate, but keep secret env access server-only in `lib/chain/arc-receipt.ts`.

Use `viem`:
- `createPublicClient`
- `createWalletClient`
- `http`
- `parseAbi` not needed for EOA calldata
- `privateKeyToAccount` from `viem/accounts`
- `stringToHex`
- `isAddress`

`recordArcReceipt` should send:

```ts
walletClient.sendTransaction({
  account,
  to: receiptToAddress,
  value: 0n,
  data: encodeReceiptPayload(payload),
  chain,
})
```

Then wait:

```ts
publicClient.waitForTransactionReceipt({ hash })
```

`receiptToAddress` defaults to recorder account address if `ARC_RECEIPT_TO_ADDRESS` is unset.

**Step 4: Run GREEN**

Run:
```bash
pnpm vitest run lib/chain/arc-receipt.test.ts lib/x402/payment-recorder.test.ts
```

Expected: PASS.

## Task 3: Integrate Payment Flow

**Files:**
- Modify: `lib/x402/with-payment.ts`
- Modify: `lib/x402/with-payment.test.ts`
- Modify: `lib/agent/research-agent.ts`
- Modify: `lib/agent/research-agent.test.ts`
- Modify: `components/research/types.ts`

**Step 1: Extend withPayment RED tests**

Assert:
- handler ctx includes `txStatus`.
- response headers include `X-Payment-Tx-Status`.
- failed payment returns 502 and does not call handler.

Run:
```bash
pnpm vitest run lib/x402/with-payment.test.ts
```

Expected: FAIL.

**Step 2: Implement withPayment**

Replace direct `txLogRepo.record` with `recordPaymentReceipt`.

Headers:
- `X-Payment-Tx`
- `X-Payment-Tx-Status`
- `X-Payment-Amount`
- `X-Payment-Source`

On payment failure return JSON:

```json
{ "error": "PAYMENT_RECEIPT_FAILED" }
```

Status: `502`.

**Step 3: Extend research-agent RED tests**

Assert `tool_result.payment` includes:
- `txStatus`
- `chainId`
- `blockNumber`

Add a failure test where payment recorder throws and research status becomes `failed`.

Run:
```bash
pnpm vitest run lib/agent/research-agent.test.ts
```

Expected: FAIL.

**Step 4: Implement research-agent**

Use `recordPaymentReceipt` in `executeTool`. Include `researchId` and tool call id/request id context where possible. On payment failure, emit `{ type: "error" }`, update research failed, and stop.

**Step 5: Run GREEN**

Run:
```bash
pnpm vitest run lib/x402/with-payment.test.ts lib/agent/research-agent.test.ts
```

Expected: PASS.

## Task 4: UI And API Status Truth

**Files:**
- Modify: `components/research/TxFeed.tsx`
- Modify: `components/research/types.ts`
- Modify: `app/api/wallet/tx-log/route.ts`
- Modify: `app/api/wallet/stats/route.ts` if needed
- Modify: `app/api/research/[id]/route.ts`
- Modify: related component/API tests
- Modify: `.env.example`
- Modify: `README.md`

**Step 1: Write RED tests**

Add/extend tests to verify:
- confirmed payment shows `confirmed` and explorer link.
- mock payment shows `mock receipt` and no confirmed text.
- failed payment shows `failed` and no confirmed text.
- wallet tx-log serialization includes txStatus, chainId, blockNumber, requestId, errorMessage.

Run targeted tests discovered in this repo, likely:
```bash
pnpm vitest run app/research/ResearchPageClient.test.tsx app/research/[id]/ResearchDetailClient.test.tsx app/api/wallet/wallet-routes.test.ts
```

Expected: FAIL until UI/API updated.

**Step 2: Implement**

Update display logic:
- `confirmed`: explorer link enabled, status `confirmed`.
- `mock`: no explorer link, status `mock receipt`.
- `failed`: no explorer link, status `failed`.
- `pending`: no confirmed wording, status `pending`.

Update env docs:

```env
ARC_RECEIPT_MODE=mock
ARC_RECORDER_PRIVATE_KEY=
ARC_RECEIPT_TO_ADDRESS=
```

**Step 3: Run GREEN**

Run the same targeted UI/API tests.

Expected: PASS.

## Task 5: Full Verification

**Files:**
- Modify: `openspec/changes/real-arc-payment-receipts/tasks.md`
- Maybe update: `graphify-out/*` via graphify rebuild

**Step 1: Run targeted tests**

Run:
```bash
pnpm vitest run lib/db/tx-log-repo-memory.test.ts lib/chain/arc-receipt.test.ts lib/x402/payment-recorder.test.ts lib/x402/with-payment.test.ts lib/agent/research-agent.test.ts app/api/wallet/wallet-routes.test.ts
```

Expected: PASS.

**Step 2: Run typecheck**

Run:
```bash
pnpm typecheck
```

Expected: PASS.

**Step 3: Run build**

Run:
```bash
pnpm build
```

Expected: PASS.

**Step 4: Validate OpenSpec**

Run:
```bash
openspec validate real-arc-payment-receipts --strict
```

Expected: valid.

**Step 5: Graphify rebuild**

Run:
```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graph rebuild completes. If graphify import is unavailable, report that fallback.

**Step 6: Optional live ARC smoke**

Only run if `ARC_RECEIPT_MODE=arc`, `NEXT_PUBLIC_ARC_RPC_URL`, `NEXT_PUBLIC_ARC_CHAIN_ID`, and `ARC_RECORDER_PRIVATE_KEY` are configured:
- Start app or call payment recorder through a one-off script.
- Capture txHash.
- Verify with ARC explorer/RPC that tx exists.

If private key is missing, state that implementation is ready but live broadcast was not executed.
