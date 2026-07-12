# Onchain Research Escrow 8.1 — prepare API

## Scope

实现 Escrow prepare API 的第一层本地能力：认证 buyer、稳定 `Idempotency-Key`、同 scope 幂等重试、跨 buyer/topic/budget 冲突、6 位 USDC budget 校验、canonical `researchKey`、CREATE2 预测地址，并保证 prepare 只创建 funding 状态、不启动 Agent。

## RED

- `app/api/research/prepare/route.test.ts`
  - 未登录请求不得创建 funding。
  - 缺少 `Idempotency-Key` 返回 `IDEMPOTENCY_KEY_REQUIRED`。
  - prepare 返回 funding 状态、`budgetUnits`、`researchKey`、预测 Escrow、15 分钟 funding deadline、24 小时 expected expiry。
  - 同 buyer/key/topic/budget 重试返回同一响应且不重复创建。
  - 同 key 跨 buyer/topic/budget 返回 `PREPARE_IDEMPOTENCY_CONFLICT`。
  - `0.01000001` 这类无法精确表示为 6 位 USDC units 的预算被拒绝。
- `lib/chain/escrow-address.test.ts`
  - TypeScript 预测公式与 viem CREATE2 对 OpenZeppelin EIP-1167 init code 的计算一致。

## GREEN

- 新增 `lib/research/prepare.ts`，集中处理 prepare scope、budget 规范化、`researchKey`、预测地址、funding window 和 response shape。
- 新增 `/api/research/prepare`，仅 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 启用，并复用 `DURABLE_DB_REQUIRED` guard。
- 扩展 research repo/schema 暴露 prepare/funding 派生字段和 `findByPrepareRequestId()`，为 8.2/8.3 的 Postgres UoW 铺路。

## Out of scope

- 尚不签发真实 FundingVoucher signature；`fundingSignature` 明确为 `null`，8.3 接入 funding signer。
- 尚不实现 Postgres 同事务 quota reservation；8.2/8.3 继续完成。
- 不做链上部署、广播、approve、createAndFund 或任何外部写入。
