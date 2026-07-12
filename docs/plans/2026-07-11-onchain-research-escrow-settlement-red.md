# On-chain Research Escrow：有效 settleBatch RED

## 范围

Task 5.1 只新增有效 settlement RED 测试，不实现 production settlement。

## 测试覆盖

- 先创建并激活 Escrow。
- Registry 登记两个 source，批次支付两个 payout。
- intent signer 签署 `SettlementAuthorization`。
- settler 提交 `settleBatch`。
- 成功后验证 events、spent、accounted balance、Escrow/payout 余额、processed key 和 result summary。

## 当前 RED

当前聚焦测试失败于 `log != expected log`，因为 `ResearchEscrow` 尚未实现 settlement 事件与函数。
