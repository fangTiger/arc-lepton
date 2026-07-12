# Onchain Research Escrow 7.7 — backend switch / dual-write / funding UI flag

## Scope

建立 switch 阶段的显式配置层：`ARC_RESEARCH_SETTLEMENT_BACKEND=calldata|escrow`、dual-write/read-compare flag、funding UI flag，以及 contract migration 的回滚窗口 gate。真正 Escrow prepare/start 和钱包 UI 在 8.x/11.x。

## RED

- `lib/research/backend-config.test.ts`
  - backend 只接受 `calldata|escrow`，默认 `calldata`，非法值 fail closed。
  - funding UI 只有在 backend=escrow 且显式 flag 打开时启用。
  - dual-write/read-compare flag 显式解析。
  - contract migration 只有 stage=contract 且 rollback window closed 时允许。
- `app/api/research/config/route.test.ts`
  - API 返回 backend、fundingUiEnabled、dualWriteEnabled、contractMigrationAllowed。

## GREEN

- 新增 `lib/research/backend-config.ts`。
- `lib/db/index.ts` 复用该 backend parser，避免配置语义分叉。
- 新增只读 `GET /api/research/config`。

## Out of scope

- 不切换默认 backend。
- 不实现 prepare/start Escrow。
- 不执行 contract migration。
