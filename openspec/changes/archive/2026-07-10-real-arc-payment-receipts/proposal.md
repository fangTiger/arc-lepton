## Why

当前 TX feed 展示的是本地生成的 mock txHash，用户点击 ARC explorer 时交易不存在，容易误导真实支付状态。现在需要把每次付费数据源调用写入 ARC 测试网，至少产生一笔 explorer 可查的真实 receipt 交易。

## What Changes

- 新增 ARC 测试网 receipt 记录能力：后端用服务端 recorder signer 发送一笔带结构化 calldata 的 ARC 测试网交易，写入 buyer、source、amount、researchId/requestId，并等待交易 receipt。
- 扩展 `tx_log` 记录链上状态：保存真实 txHash、chainId、blockNumber、txStatus、requestId 和失败原因。
- 修改 x402/payment 记账路径：优先真实上链；未配置链上环境时保留 mock/dev fallback，但不得显示为 confirmed。
- 修改研究事件流和 TX feed：只有链上 receipt confirmed 时才展示 confirmed 和 explorer 链接；mock/failed 状态必须明确展示。
- 新增合约、部署脚本、链上写入服务、TDD 覆盖和手工验收说明。

## Capabilities

### New Capabilities
- `arc-payment-receipts`: 每次付费工具调用产生可查询的 ARC 测试网 receipt 交易，并把链上状态同步到应用 tx_log 与 UI。

### Modified Capabilities
- `x402-mock-data`: 付费数据源仍可在开发环境 mock，但 mock txHash 不再被视为真实链上确认。
- `research-agent-engine`: Agent 工具调用的 payment 事件需要携带真实链上状态，而不是无条件 confirmed。

## Impact

- Affected code: `lib/x402/*`, `lib/agent/*`, `lib/db/*`, `lib/db/schema/*`, `components/research/*`, `app/api/data/*`, `app/api/wallet/*`
- New code: `lib/chain/*`
- Dependencies: 复用现有 `viem`
- Runtime config: 复用 `NEXT_PUBLIC_ARC_CHAIN_ID`、`NEXT_PUBLIC_ARC_RPC_URL`、`NEXT_PUBLIC_ARC_EXPLORER_URL`，新增 `ARC_RECORDER_PRIVATE_KEY`、`ARC_RECEIPT_TO_ADDRESS`、`ARC_RECEIPT_MODE`
