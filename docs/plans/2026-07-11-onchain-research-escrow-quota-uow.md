# Onchain Research Escrow 8.2 — prepare quota UoW tests

## Scope

补齐 Escrow prepare 的 Postgres-style quota reservation RED 覆盖：funding research 与 wallet/global UTC bucket reservation 必须在同一 repo UoW 内完成；同一 prepare 幂等重试不得重复预留；consume/release 只能精确完成一次。

## RED

- `lib/research/prepare.test.ts`
  - prepare 创建 funding record 时保存 `quotaDate`、15 分钟 `fundingDeadline`、24 小时 `expectedExpiresAt`，并确保 voucher 字段与持久字段一致。
  - 同 buyer/key/topic/budget 幂等重试返回同一 response，不重复占用 wallet quota。
  - wallet 第 11 个 prepare 返回 `WALLET_LIMIT`。
  - global 第 101 个 prepare 返回 `GLOBAL_LIMIT`。
  - `consumeQuotaReservation()` 与 `releaseQuotaReservation()` 并发只允许一个成功，后续重试不得重复消费或释放。

## GREEN

- `ResearchRepo` 新增 `createFundingWithQuotaReservation()`、`consumeQuotaReservation()`、`releaseQuotaReservation()`。
- memory repo 用同一对象维护 funding records 与 quota aggregate，模拟单 UoW。
- PG repo 用 `database.transaction()` 包住 wallet/global bucket reserve 与 funding insert；limit 超限抛出事务内错误并回滚。
- `research_quota_usage` 扩展 `consumed/reserved/used`，保留旧 shadow `consume/release` 兼容。

## Out of scope

- 8.3 仍需接入 FundingVoucher 签名。
- 8.7/8.8 再接入 ACTIVATE/RUN outbox 与链上对账后的 reservation consume。
