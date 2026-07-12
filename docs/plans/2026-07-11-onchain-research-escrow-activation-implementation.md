# On-chain Research Escrow：activate 与 cancelUnactivated 实现

## 范围

Task 4.9 实现 Funded→Active activation 与 Funded→Closed unactivated cancel。

## 实现摘要

- Factory 在创建 clone 时传入 FundingVoucher 的 intentSigner，Escrow 保存为 `plannedIntentSigner`。
- `activate` 验证 buyer 签名、authorization 字段、nonce、deadline/cutoff、activation 前会计干净性和 intent signer 动态角色隔离。
- activation 成功后状态变为 Active，`activeIntentSigner` 固化。
- `cancelUnactivated` 只允许 buyer 在 Funded 状态调用，并把当前 USDC 余额全部退回 buyer。
- cancel 与 activation 的先后竞态由状态机保证：先成功者改变状态，后续路径回滚。

## 验证

- Factory CREATE2：5/5 passed。
- FundingVoucher：12/12 passed。
- createAndFund：7/7 passed。
- balance delta：6/6 passed。
- activation/cancel：14/14 passed。
