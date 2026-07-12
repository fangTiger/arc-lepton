# On-chain Research Escrow：Funded→Active RED 测试

## 范围

Task 4.7 只新增 RED 测试，不实现 activation。

## 测试设计

- 先通过 `createAndFund` 创建真实 Funded clone。
- 未来 activation ABI 固定为 `activate(ActivationAuthorization, bytes)`。
- 成功路径要求 relayer 可提交 buyer EOA/1271 签名，并把 Escrow 状态转为 Active。
- nonce replay、deadline 超出 `activationCutoff`、cutoff 后提交均必须拒绝。
- activation 后 `activeIntentSigner()` 固化为 voucher 中的 intentSigner，不随 Factory 后续 allowlist 轮换而替换。

## 当前 RED

当前 `ResearchEscrow` 尚无 activation 接口，聚焦测试失败于 `EvmError: Revert`，符合 4.7 预期。4.9 实现时应使这些测试转绿。
