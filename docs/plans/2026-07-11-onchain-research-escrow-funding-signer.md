# 8.3 Funding signer 与 prepare runtime guard 计划

## 目标

实现 Escrow prepare 的真实本地签名闭环：prepare 必须在 durable runtime 条件满足时，原子创建 funding research + quota reservation，并返回字段与记录完全一致且可链上验证的 FundingVoucher signature。

## 范围

- `lib/research/prepare.ts`
  - 读取并校验 `ARC_RESEARCH_FUNDING_SIGNER_PRIVATE_KEY`。
  - 可选校验 `ARC_RESEARCH_FUNDING_SIGNER_ADDRESS` 与私钥派生地址一致。
  - 使用 `ArcLeptonResearchEscrowFactory` EIP-712 domain 签名 FundingVoucher。
  - 在任何 DB 写入前验证 funding signer 配置。
- `app/api/research/prepare/route.ts`
  - Escrow backend 下要求 `ARC_RESEARCH_WORKER_AUTH_SECRET`，否则返回 `503 DURABLE_DB_REQUIRED`。
  - 保持 `assertDurableDbAvailableForEscrow()` 在 prepare 前执行。
- `lib/db/research-repo-pg.ts` / memory repo
  - 同一 `prepareRequestId` 并发重试返回既有记录，不重复预留 quota。
  - PG 唯一键冲突回滚后读回既有记录。

## 非目标

- 不广播任何链上交易。
- 不实现 activation/start worker；后续 8.4–8.8 继续。
- 不改 legacy mock start 的 KV quota 行为。

## 验证

- prepare service 测试校验 EIP-712 signature 可由 funding signer 地址验证。
- prepare route 测试覆盖 missing worker auth / missing funding signer 时不创建 reservation。
- PG repo 测试覆盖 transaction 内 wallet/global quota reservation + funding research，以及并发唯一键 retry。
