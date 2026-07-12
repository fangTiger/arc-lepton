# On-chain Research Escrow：EIP-712 编码器实现计划

## 目标

Task 2.4 先把 Task 2.3 中 FundingVoucher、ActivationAuthorization、SettlementAuthorization、CloseAuthorization 的 EIP-712 domain/type/struct/digest 共享 RED 测试转绿，并在编码器层保留签名校验扩展点。

## 当前实现边界

- Solidity：新增 `ResearchEscrowEip712` library，固定 domain/type hash、struct hash 与 digest 计算。
- TypeScript：新增 `lib/chain/eip712.ts`，用 `viem` 计算同一组 domain/type/struct/digest。
- Node verifier：新增 `contracts/scripts/verify-eip712-vectors.mjs`，独立复核共享 fixture。

## 签名策略

Task 2.4 同步实现通用签名工具与聚焦测试：

- FundingVoucher 与 buyer ActivationAuthorization 可复用 `isValidFlexibleSignature`，底层使用 OpenZeppelin SignatureChecker 支持 EOA/ERC-1271。
- Settlement/Close 的 V1 intent signer 可复用 `isValidStrictEoaSignature`，要求 `code.length == 0` 且 OpenZeppelin ECDSA 恢复成功，拒绝 ERC-1271 contract signer 与 malleable signature。
- `isDeadlineLive` 与 `isAuthorizationWindowLive` 固化 deadline、issuedAt、maxLifetime、expiresAt 的基础边界，业务合约后续负责接入 nonce storage、role allowlist 和状态机。

本任务没有越界实现 Factory/Registry 状态机或实际部署广播。
