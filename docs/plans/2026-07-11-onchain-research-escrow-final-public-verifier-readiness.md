# Onchain Research Escrow 13.6 final public RPC verifier readiness

日期：2026-07-11

范围：OpenSpec change `onchain-research-escrow` 的 13.6：

> 独立 verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke；任一不一致不得发布证据。

## 总结论

13.6 仍 pending。

本文档只是一份本地 readiness 清单，用于把最终 public verifier 的输入、输出和发布边界整理清楚。当前没有读取真实 public RPC、没有生成最终 `deployments/5042002.json`、没有发布最终 manifest、没有更新 README/docs/contracts 最终地址，也没有把候选 manifest 标记为可交付证据。

13.6 的独立公开 RPC verifier 必须在 13.3 部署、13.4 source/roles/exact-match 和 13.5 `smoke_usdc_spend` 全部真实完成后运行。它必须仅凭公开 RPC、权威 USDC 配置和 manifest 复核事实；不得依赖私有数据库、credentialed RPC、部署脚本内存状态、操作者口头说明或本地 mock evidence。候选 manifest、本地模拟 verifier、readiness 文档不能替代最终 public verifier；authorization package、handoff、briefing、requestDigest 也不是 verifier 成功结果。

任一不一致不得发布证据。只要 chainId、地址、role graph、source 配置、runtime hash、Explorer exact-match、smoke、clone count、settled count 或 finalized block 证据缺失、失败、unknown、非 finalized 或互相矛盾，就不得发布最终 manifest，不得更新 README/docs/contracts 最终地址，不得增加项目合约计数，不得宣称部署或 smoke 完成。

## 13.6 verifier 必须复核的公开事实

独立公开 RPC verifier 至少需要覆盖：

1. `deployments/5042002.json` schema、manifest digest、chainId `5042002`、network 标识、目标 commit、clean-tree 证明和 evidence generatedAt。
2. 权威 USDC 配置：内置官方 USDC `0x3600000000000000000000000000000000000000`、native emitter `0xfffffffffffffffffffffffffffffffffffffffe`、decimals=6、runtime/proxy implementation 和 finalized block 读回。
3. 三个核心合约：Registry、ResearchEscrow implementation、ResearchEscrowFactory 的部署 tx、creator、block、constructor/init 参数、runtime hash、artifact hash、ABI hash 和 Explorer exact-match。
4. Registry/Factory wiring：Registry.factory/USDC、Factory.registry/USDC/implementation、一次性 bindFactory 事件、initializer 锁和 clone implementation。
5. 角色 members/count/admin graph：Factory/Registry DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 的完整成员、role-admin、grant/revoke 事件重放、INTENT_SIGNER EOA code=0 和 deployer 零权限。
6. source revision/payout/maxUnitPrice/active：五个 source 的 sourceId、revision、payout、maxUnitPrice、active、事件和 finalized readback，payout 不得与敏感身份或协议地址重叠。
7. `3 + R` 拓扑：三个核心合约加上仅由项目 Factory 非零资助且 runtime/lineage 可复核的 clone；manifest 必须同时列出 `fundedCloneCount` 和 `settledCloneCount`，且 `settledCloneCount <= fundedCloneCount`。
8. smoke：`smoke_usdc_spend` 的 approve、createAndFund、activate、settleBatch、close/refund txHash、blockHash、logIndex、六位合约差额、18 位 native/gas、两类 emitter Transfer 去重、settlementResultDigest、finalLiabilityHash 和退款守恒。

## 发布边界

- 不能替代 13.6 真实 public verifier：本 readiness 只列清单，不访问 public RPC，不验证最终链上事实。
- 候选 manifest、本地模拟 verifier、readiness 文档不能替代最终 public verifier；本地 `rpc-deployment-verifier.node-test.mjs` 只能证明 verifier 逻辑的 fail-closed 行为。
- 最终 public verifier 必须默认 fail closed；任一字段 missing、unknown、RPC disagreement、非 finalized、Explorer exact-match 缺失、role graph 不一致、source revision drift、smoke 余额不守恒或计数不一致，都必须以非零状态停止发布。
- 在 13.6 成功前，不得发布最终 manifest，不得更新 README/docs/contracts 最终地址，不得把 Graphify readiness、rollout readiness、rollback drill 或 authorization package 输出当作最终证据。

## 当前仍缺

- 13.3 未部署 Registry、implementation、Factory。
- 13.4 未完成 Explorer exact-match、bindFactory、source 登记、role grant/revoke/移交和 deployer 撤权读回。
- 13.5 未执行 direct EOA buyer test USDC smoke。
- 没有最终 `deployments/5042002.json`，也没有 finalized block 上的公开 RPC 复核报告。

因此本文件不改变 `openspec/changes/onchain-research-escrow/tasks.md`；13.6 保持未完成。
