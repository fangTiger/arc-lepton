## Context

当前系统的付费路径只把数据源调用写入 `tx_log`，`txHash` 由 `randomBytes(32)` 生成。前端 TX feed 会把该 mock hash 拼到 ARC explorer，并无条件展示 confirmed，导致用户看到不存在的交易。

第一版目标是“真实可查”，不是完整支付协议。应用已依赖 `viem`，也已有 `NEXT_PUBLIC_ARC_CHAIN_ID`、`NEXT_PUBLIC_ARC_RPC_URL` 和 explorer 配置，因此新增最少服务端配置即可完成真实广播。

## Goals / Non-Goals

**Goals:**
- 每次付费数据源调用在 `ARC_RECEIPT_MODE=arc` 时发送真实 ARC 测试网交易。
- 交易 calldata 包含可审计的 receipt payload：buyer、source、amount、researchId、requestId、timestamp。
- tx_log 保存链上状态，UI 只在 confirmed 时展示 explorer 链接和 confirmed。
- 开发环境可继续 mock，但 mock 必须明确标识，不得伪装成链上确认。
- 链上配置缺失或广播失败时 fail closed：记录 failed 状态并返回明确错误。

**Non-Goals:**
- 不实现真实 USDC 扣款、permit、meta transaction 或 x402 标准协议结算。
- 不引入合约部署作为第一版依赖。
- 不实现后台重试队列、事件索引器或多链抽象。

## Decisions

### Decision 1: 用 EOA calldata receipt 代替合约

后端 recorder 使用 `viem` wallet client 发送 0-value 交易，`to` 默认为 recorder 地址，也可由 `ARC_RECEIPT_TO_ADDRESS` 指定。`data` 为 UTF-8 JSON payload 转 hex，payload 带 `kind: "arc-lepton.receipt"`, `version: 1`, `buyer`, `source`, `amount`, `researchId`, `requestId`, `createdAt`。

理由：这能最快产生 explorer 可查的真实交易，不需要合约编译/部署/ABI 管理。后续如果要 event logs，可保留同一 service API，把底层发送方式替换成合约调用。

### Decision 2: payment service 统一链上与 tx_log

新增 `lib/chain/arc-receipt.ts` 负责构建 payload、发送交易、等待 receipt。新增或调整 `lib/x402/payment-recorder.ts` 作为业务入口：

1. 生成稳定 `requestId`。
2. 根据 `ARC_RECEIPT_MODE` 选择 `arc` 或 `mock`。
3. `arc` 成功后写入 `tx_log`，状态为 `confirmed`。
4. `arc` 失败后写入 `tx_log`，状态为 `failed`，并抛出可被 API/agent 展示的错误。
5. `mock` 写入 `tx_log`，状态为 `mock`。

`withPayment` 和 research agent 都调用同一个 payment recorder，避免两个路径产生不同语义。

### Decision 3: 扩展 tx_log 而不是新增表

现有 UI、wallet API、research detail 都围绕 `tx_log` 查询。直接扩展字段最小：

- `txStatus`: `mock | pending | confirmed | failed`
- `chainId`: number | null
- `blockNumber`: string | null
- `requestId`: string
- `errorMessage`: string | null

Postgres schema 添加 nullable/default 字段；memory repo 同步字段默认值。`txHash` 对 mock 仍存在，但状态为 `mock`。

### Decision 4: UI 以状态为真相

`AgentEvent.payment` 与 `TxLogRecord` 都增加 `txStatus`、`chainId`、`blockNumber`、`errorMessage`。`TxFeed` 只有在 `txStatus === "confirmed"` 且有 explorer base 时渲染可点击链接和 confirmed；mock 展示 `mock receipt`，failed 展示 `failed`。

## Risks / Trade-offs

- [Recorder 私钥泄漏] → 只使用服务端 env `ARC_RECORDER_PRIVATE_KEY`，不得暴露到 `NEXT_PUBLIC_*`，测试不得打印密钥。
- [ARC RPC 慢或不可用] → `ARC_RECEIPT_MODE=arc` 时 fail closed，API 返回 502，research 标记 failed；开发可切回 mock。
- [EOA calldata 不如合约 event 易索引] → 第一版满足 explorer 可查；后续可在 service 内替换为合约调用，不改上层 payment 入口。
- [数据库 schema 未迁移] → worker 必须运行 `pnpm db:generate` 或明确说明当前项目无迁移目录时如何用 `db:push` 同步。

## Migration Plan

1. 部署代码后，先保持 `ARC_RECEIPT_MODE=mock` 验证 UI 状态不再误导。
2. 配置 `ARC_RECORDER_PRIVATE_KEY`，确保 recorder 地址有 ARC 测试网 gas/native USDC。
3. 设置 `ARC_RECEIPT_MODE=arc`，运行一次 data source 或 research smoke。
4. 用 explorer 验证 txHash 存在，确认 TX feed 展示 confirmed。
5. 如 RPC/私钥有问题，切回 `ARC_RECEIPT_MODE=mock`，系统仍可开发演示但显示 mock。

## Open Questions

- `ARC_RECEIPT_TO_ADDRESS` 是否需要指定为固定审计地址？第一版默认 recorder self-send。
