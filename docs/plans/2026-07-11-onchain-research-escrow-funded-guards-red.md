# On-chain Research Escrow：Funded 会计与防越权 RED

## 范围

Task 4.8 继续扩展 Funded→Active 前置 RED 测试，不实现生产逻辑。

## 测试覆盖

- Funded clone 初始 `spent == 0`。
- Funded clone 初始 `accountedBalance == initialBudget`。
- activation 前 requestKey/settlementKey 均未处理。
- 即使 caller 具备 `SETTLER_ROLE`，Funded 状态也不能 settlement。
- 即使具备 intent signer 签名，Funded 状态也不能执行 Active close。

## 当前 RED

聚焦测试失败于未来 accounting/activation 接口缺失；两个 Funded 负向资金动作测试当前因缺接口回滚而通过，后续实现 settlement/close 后必须继续通过。
