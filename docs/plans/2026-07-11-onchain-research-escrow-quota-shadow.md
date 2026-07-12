# Onchain Research Escrow 7.9 — quota shadow dual-write/read-compare

## Scope

为 research quota 增加 Postgres shadow dual-write/read-compare：KV 仍为当前主 writer，Postgres shadow 接收同一 wallet/global bucket 写入并比较结果；不一致时 fail closed。

## RED

- `lib/rate-limit/research-quota.test.ts`
  - 开启 shadow 后，`consumeQuota()` 同时写 KV 与 `researchQuotaRepo`。
  - wallet/global 计数一致时仍遵守 wallet=10/global=100。
  - shadow 计数不一致时返回 `QUOTA_SHADOW_MISMATCH` 并回滚 KV/PG。

## GREEN

- 增加 `ResearchQuotaRepo` memory/PG 接口与 index 暴露。
- `consumeQuota()` 在 `ARC_RESEARCH_QUOTA_SHADOW_ENABLED=true` 时执行 shadow dual-write/read-compare。

## Out of scope

- 不切换主 writer 到 Postgres。
- 不实现 bucket 边界调度器；只提供 shadow 基础能力。
