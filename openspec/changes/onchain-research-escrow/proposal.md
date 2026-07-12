## Why

当前 ARC 模式只发送 0-value calldata receipt，能够证明记录上链，却不能证明用户预算被托管或 test USDC 实际支付给数据提供方。项目需要把已有的异步 payment intents 升级为可审计、可防重、可退款的真实链上支付，同时向评审提供清晰的 deployer、factory、implementation 和实例谱系。

## What Changes

- 新增 `DataSourceRegistry`、`ResearchEscrow` implementation 和 `ResearchEscrowFactory` 三个核心合约，由 Factory 为每个需要真实结算的 research 创建一个确定性 escrow clone，形成 `3 + R` 部署模型。
- 用户在 ARC 模式启动 research 前使用服务端签发的 funding voucher 原子创建并注入 test USDC，再通过 buyer EIP-712 签名激活；Escrow 只接受独立 intent signer 签名、由 settler 提交的批次。
- DataSourceRegistry 使用单调 revision；每个 payment intent 和链上 item 固定 revision、payout 与价格上限，防止配置更新在结算时重定向资金。
- 将 research settlement worker 从 EOA 自发 0-value calldata 改为合约调用，解析链上事件并与 `payment_settlement`、`tx_log` 进行幂等对账；直接 `/api/data/*` receipt 路径暂时保持现有行为。
- 新增 durable runner lease、持久 workflow outbox 和受保护的 Cron/queue worker，覆盖 activation、Agent 运行、settlement、reconcile、close/refund 及 serverless 崩溃恢复；Escrow backend 无持久数据库时 fail closed。
- 增加部署 manifest、源码验证、bytecode/角色读回、Factory 创建事件和真实 USDC `Transfer` smoke 证据，明确项目 deployer 与 Factory child lineage。
- 将 deployer、Factory governance、Registry admin、funding signer、allowlisted EOA intent signer 与 settler 权限分离，合约在 grant 和每次 settlement/close 动态强制敏感角色互斥，并验证完整成员集合。
- 保留 mock 模式和 follow-up Q&A 的既有离线行为。
- **BREAKING**：Escrow backend 下启动 research 调整为 prepare/quota reservation → voucher funding → buyer activation signature → durable start；原先仅提交 `topic + budgetUsdc` 即进入 running 的 ARC 流程不再适用。

## Capabilities

### New Capabilities

- `onchain-research-escrow`: 定义版本化数据源、签名授权、确定性 Escrow 创建、test USDC 托管、批量支付、防重、durable workflow、终态与退款行为。
- `contract-deployment-evidence`: 定义核心合约和 clone 的 deployer/factory 谱系、部署 manifest、源码验证、权限移交及可复现 smoke 证据。

### Modified Capabilities

- `arc-payment-receipts`: research 批量 settlement 从普通 calldata receipt 改为 Escrow 合约执行的真实 USDC 支付，并增加合约事件对账语义；直接付费 API 路径保持不变。
- `research-agent-engine`: ARC 模式下 research 启动与预算控制绑定已创建、已资助且归属当前钱包的 Escrow，同时保留报告生成不等待链上 settlement 的行为。
- `research-daily-quota`: 将 Escrow 流程的配额从 start 时直接消费改为 Postgres 原子 reservation → activation consume / 未激活 release，同时保持 wallet 10、global 100 的 UTC 日限额。
- `research-web-ui`: 将 Escrow backend 的创建 UI 改为可恢复的 prepare/funding/activation 状态机，并展示 quota reservation、资金 finalizationState 和公开链上证据；mock、legacy 与 follow-up 行为保持兼容。

## Impact

- Affected code: `lib/chain/*`, `lib/x402/*`, `lib/agent/*`, `lib/db/*`, `lib/db/schema/*`, `app/api/research/*`, research UI、wallet/TX feed、环境配置和 README。
- New code: `contracts/` Foundry 工程、Solidity 合约与测试、部署/验证/smoke 脚本、ABI 和 `deployments/5042002.json`。
- APIs: 增加 Escrow prepare/funding/activation 状态查询或等价端点；research start 增加 voucher、buyer 签名、quota reservation、expiry 和 Escrow 前置校验。
- Dependencies: Foundry、OpenZeppelin Contracts、Arc Testnet 官方 USDC 合约；前端和服务端继续使用 viem。
- Data: research、Postgres quota bucket/reservation、payment intent、durable event、runner lease、workflow outbox 与 settlement 需要保存 escrow/key、Registry snapshot、签名/事件定位和恢复状态。
- Runtime: 新增与 direct receipt 模式独立的 research settlement backend flag；Escrow backend 强制持久 Postgres 和受保护 worker。
- Security: 引入真实 token 托管、EIP-712、角色/签名身份、重入、重复结算、金额精度、expiry 和退款竞态，必须通过单元、fuzz、invariant、崩溃恢复、部署 smoke 与静态分析验证。
