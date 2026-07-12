## ADDED Requirements

### Requirement: 规范化 key、itemsHash、liability 与 EIP-712 编码
系统 SHALL 按 design 中固定的 v1 domain、字段顺序和 `abi.encode` 公式派生 researchKey、requestKey、settlementKey、sourceId、itemsHash、settlementResultDigest 和 finalLiabilityHash，并 SHALL 使用固定 EIP-712 domain/type 定义 FundingVoucher、ActivationAuthorization、SettlementAuthorization 与 CloseAuthorization。Solidity、TypeScript 和部署验证器 MUST 共享同一组规范测试向量；原始业务字符串不得写入链上状态或事件。

#### Scenario: 规范测试向量一致
- **WHEN** Solidity、TypeScript 和独立验证器计算 design 中的 v1 示例
- **THEN** 所有 hash/digest MUST 分别等于 design 记录的 researchKey、requestKey、settlementKey、sourceId、itemsHash、settlementResultDigest、空/单 PAID finalLiabilityHash 和四类 EIP-712 digest

#### Scenario: 不同上下文相互隔离
- **WHEN** chainId、buyer、researchId、paymentIntentId、settlementId、source 或任一 item 字段不同
- **THEN** 对应 key/hash SHALL 不同，且跨 research 的 requestKey 不得碰撞

#### Scenario: 拒绝非规范或零 key
- **WHEN** items 未按 requestKey 升序、含重复/零 key，或调用使用错误 version/domain/字段顺序
- **THEN** 合约 SHALL 在状态写入和转账前拒绝调用

### Requirement: DataSourceRegistry 版本化支付边界
DataSourceRegistry SHALL 在 constructor 固定官方 USDC，并按非零 sourceId 保存单调递增 uint64 revision、非零 payout、六位 USDC units 的 maxUnitPrice 和 active 状态。Registry SHALL 在项目 Factory 部署后由初始 admin 一次性 `bindFactory`，要求 Factory code/registry/USDC 双向 wiring 正确，绑定后永不可更换；绑定前不得写 source 或配置运行角色。SOURCE_ADMIN_ROLE 每次更新 SHALL 使 revision 精确加一并发出完整变更事件；sourceId 和历史 revision 不得删除后复用。

#### Scenario: 一次性绑定正确 Factory
- **WHEN** 初始 admin 使用有 code 且 registry/USDC 读回匹配的项目 Factory 首次调用 bindFactory
- **THEN** Registry SHALL 永久保存 Factory 并发出绑定事件，后续 source/role 校验 SHALL 能跨合约检查敏感角色

#### Scenario: 拒绝错误或重复绑定
- **WHEN** 非 admin、零/无 code 地址、wiring 不匹配 Factory 或第二次 bindFactory 被提交
- **THEN** 调用 SHALL 回滚，绑定地址和全部 Registry 状态保持不变

#### Scenario: 登记有效 source
- **WHEN** SOURCE_ADMIN 使用有效 sourceId、payout 和 maxUnitPrice 登记新 source
- **THEN** Registry SHALL 创建 revision 1、active 的记录并发出事件

#### Scenario: 更新配置递增 revision
- **WHEN** SOURCE_ADMIN 更新 payout、maxUnitPrice 或 active
- **THEN** revision SHALL 精确加一，当前配置和历史事件 SHALL 可独立复核

#### Scenario: 拒绝无效或越权更新
- **WHEN** 非 SOURCE_ADMIN 调用，或参数包含零值、revision 溢出、重复新建 sourceId
- **THEN** Registry SHALL 回滚且记录保持不变

### Requirement: 签名 FundingVoucher 与确定性 Factory
ResearchEscrowFactory SHALL 使用 EIP-1167 + CREATE2，以 `(buyer, researchKey)` 作为唯一映射和 salt 输入，并 SHALL 只在 Registry 已一次性反向绑定本 Factory、initialDeployer 在 Factory/Registry 均无敏感角色后允许 createAndFund。createAndFund SHALL 要求 msg.sender 等于 voucher buyer，验证当前 FUNDING_SIGNER_ROLE 对 buyer、researchKey、budgetUnits、expectedExpiresAt、fundingDeadline、intentSigner 和 nonce 的有效 EIP-712 签名，并要求 voucher 未过期且 expectedExpiresAt 至少满足 Factory 的 MIN_ESCROW_TTL；clone SHALL 把 fundingDeadline 固化为不可变 activationCutoff。V1 intentSigner SHALL 为非零、`code.length == 0`、当前持有且只持有 INTENT_SIGNER_ROLE 的 EOA，并不得等于 buyer、funding signer、任何 Factory/Registry 敏感角色或协议地址；buyer 也不得持有项目敏感角色。

Factory SHALL 为每个成功资助的 clone 发出 `ResearchEscrowCreated(address indexed buyer, bytes32 indexed researchKey, address indexed escrow, address implementation)` 与 `ResearchEscrowFunded(address indexed buyer, bytes32 indexed researchKey, address indexed escrow, uint256 budgetUnits, uint64 expectedExpiresAt, uint64 activationCutoff)`。每个 clone SHALL 暴露只读接口 `factory()`、`registry()`、`usdc()`、`buyer()`、`researchKey()`、`initialBudget()`、`expectedExpiresAt()`、`activationCutoff()`、`plannedIntentSigner()`、`activeIntentSigner()`、`spent()`、`accountedBalance()`、`activationNonceUsed(uint256)`、`processedRequestKey(bytes32)`、`processedSettlementKey(bytes32)` 和 `state()`；createAndFund 成功后的状态 SHALL 为 `EscrowState.Funded`。

#### Scenario: voucher 原子创建并全额资助
- **WHEN** buyer 提交未使用、签名有效且未过期的 voucher，并具有足够 USDC balance/allowance
- **THEN** Factory SHALL 在一笔交易中创建、初始化、登记 clone，并精确转入 budgetUnits，使 Escrow 进入 Funded

#### Scenario: 预测地址与实际地址一致
- **WHEN** 使用相同 buyer、researchKey 和 Factory 查询并随后 createAndFund
- **THEN** 实际 clone SHALL 等于预测地址，runtime SHALL 指向固定 implementation

#### Scenario: 跨 buyer 不可抢占
- **WHEN** 两个 buyer 使用相同 researchKey
- **THEN** `(buyer, researchKey)` SHALL 产生独立映射/地址，且任一 buyer 无法占用另一个 buyer 的 voucher 或实例

#### Scenario: 无效 voucher 不留状态
- **WHEN** buyer/预算/expiry/intentSigner/nonce 被篡改，签名者无角色，intentSigner 非 allowlisted EOA或与任一敏感身份重叠，fundingDeadline 已过，或 voucher 重放
- **THEN** createAndFund SHALL 全部回滚，不留下 clone、映射、事件或余额

### Requirement: 精确 USDC 身份与六位金额
Factory 和 Escrow SHALL 绑定 Arc Testnet 5042002 的 Circle 官方 USDC `0x3600000000000000000000000000000000000000`；部署验证器 SHALL 将该常量及 Circle 官方地址文档作为独立权威来源，而不是信任 manifest 自声明。预算、上限、支付和退款 SHALL 使用 uint256 六位 ERC-20 units；scale-8 数据只有能被 100 整除时才可转换。Arc 原生 gas/余额为 18 位，跨接口证据 MUST 使用 `1 unit6 = 10^12 units18` 精确换算，并固定区分 USDC contract 的 6 位 Transfer 与 `0xfffffffffffffffffffffffffffffffffffffffe` system emitter 的 18 位 Transfer；gas 只按 receipt 计算而不从 Transfer 推断。

#### Scenario: 精确 transferFrom 入账
- **WHEN** createAndFund 转入 budgetUnits
- **THEN** Factory 在同一调用执行上下文读取的 buyer `balanceOf` MUST 精确减少 budgetUnits 且 clone `balanceOf` MUST 精确增加 budgetUnits，否则交易回滚
- **AND** direct EOA buyer 的外部原生余额证据 MUST 满足 `nativeBefore18-nativeAfter18-actualGasDebit18 = budgetUnits6*10^12`，不得直接混比 18/6 位

#### Scenario: 拒绝不可精确金额
- **WHEN** 输入含超过六位的非零精度、指数、负数、零值或溢出
- **THEN** prepare/create/settlement SHALL 在广播前失败，不得截断或四舍五入

#### Scenario: 拒绝错误 token
- **WHEN** 5042002 配置不是权威 USDC，或 token 无 code、decimals 不为 6
- **THEN** 发布验证 SHALL 失败，Factory 不得投入使用

### Requirement: Funded 激活需要 buyer 授权
Escrow SHALL 使用 Funded、Active、Closed 状态。createAndFund 后 SHALL 保持 Funded，不能 settlement。clone SHALL 保存 FundingVoucher 中的 `plannedIntentSigner`，activate SHALL 验证 buyer 对 escrow、researchKey、buyer、intentSigner、initialBudget、expectedExpiresAt、nonce 和 deadline 的 EIP-712 签名，要求授权 intentSigner 等于 plannedIntentSigner，要求 `block.timestamp <= deadline <= activationCutoff`，重新验证 intentSigner 的 EOA allowlist/敏感角色互斥，并把 intentSigner 固化为本实例不可替换的支付授权者。

#### Scenario: buyer 签名激活
- **WHEN** settler 或任意 relayer 提交有效、未过期且未使用的 buyer ActivationAuthorization
- **THEN** Escrow SHALL 从 Funded 原子转为 Active，并记录不可变 intentSigner

#### Scenario: start 前恶意 settler 不能花款
- **WHEN** Escrow 尚为 Funded，settler 尝试 settleBatch 或 close Active research
- **THEN** Escrow SHALL 拒绝调用，budget 保持完整

#### Scenario: 未激活 buyer 取消退款
- **WHEN** buyer 在 Funded 状态调用 cancelUnactivated
- **THEN** Escrow SHALL 进入 Closed/unactivated_cancelled，并把实际 USDC 余额全部退给 buyer

#### Scenario: activation 与未激活取消竞态
- **WHEN** 有效 activate 与 buyer 的 cancelUnactivated 并发
- **THEN** 链上状态机 SHALL 只允许先执行者成功；若取消先成功，后续 activate 必须回滚且不得移动退款，若激活先成功，未激活取消必须回滚并进入 Active 正常终态流程

#### Scenario: 激活前状态必须干净
- **WHEN** activate 执行
- **THEN** spent SHALL 为零、无已处理 settlementKey/requestKey、accounted balance SHALL 等于 initialBudget，否则激活失败

### Requirement: prepare、quota 与 expiry 门禁
服务端 prepare SHALL 以稳定 Idempotency-Key 创建 funding research、原子预留 wallet/global quota，并保存 buyer、researchKey、prepared budgetUnits、expectedExpiresAt、fundingDeadline 和 intentSigner。reservation SHALL 只按 `reserved→released` 或 `reserved→activating→consumed|released` 条件转换；ACTIVATE 不确定时不得释放，终态不得再变。首版 funding window SHALL 为 15 分钟、最小 activation 提交窗口 2 分钟、Factory MIN_ESCROW_TTL 为 2 小时、默认 expectedExpiresAt 为 prepare 后 24 小时、start 最小剩余 TTL 为 60 分钟、创建新 intent 的最小 settlement 安全窗口 15 分钟；ActivationAuthorization deadline MUST 不晚于 fundingDeadline。

#### Scenario: prepare 签发精确 voucher
- **WHEN** 认证 buyer 首次使用 Idempotency-Key prepare
- **THEN** 系统 SHALL 保存唯一 funding 记录/配额 reservation，并签发字段与记录完全一致的 FundingVoucher

#### Scenario: prepare 幂等重试
- **WHEN** 同 buyer 使用相同 key 和相同 topic/budget 重试
- **THEN** 系统 SHALL 返回既有 research/voucher，不重复预留 quota

#### Scenario: prepare 作用域冲突
- **WHEN** 相同 key 被用于不同 buyer、topic 或 budget
- **THEN** 系统 SHALL 返回幂等冲突且不签发第二个 voucher

#### Scenario: funding 过期确定终态
- **WHEN** fundingDeadline 到达
- **THEN** 系统 SHALL 先 claim/reconcile 待处理 ACTIVATE；若链上已 Active则 SHALL consume reservation 并按 cancelRequestedAt 决定恢复唯一 RUN 或进入 cancelled/closing，只有证明未 Active且授权已不可能生效时才 SHALL 保留 funding_expired 并 release reservation
- **AND** funding_expired SHALL 不计入运行/完成/取消/花费统计

#### Scenario: start 验证精确资金与 TTL
- **WHEN** start 验证链上 Escrow
- **THEN** initialBudget MUST 等于 prepared budgetUnits 和 funding Transfer delta、expectedExpiresAt MUST 完全一致、剩余 TTL MUST 至少 60 分钟，并满足 buyer/Factory/code/USDC/Funded/干净状态

### Requirement: 双签名原子批量 settlement
settleBatch SHALL 仅允许当前 SETTLER_ROLE 提交，并 SHALL 验证本 Escrow 固化 intentSigner EOA 对 escrow、researchKey、settlementKey、itemsHash、total、itemCount、nonce、issuedAt 和 deadline 的 SettlementAuthorization。合约 SHALL 要求 `issuedAt <= block.timestamp <= deadline`、`deadline-issuedAt <= 5 minutes` 且 deadline 不晚于 expectedExpiresAt。每次调用 SHALL 动态要求 intentSigner 仍只持有 INTENT_SIGNER_ROLE、`intentSigner != msg.sender` 且不持有 Factory/Registry 的 settler/funding/source/admin role；settler 无法自行生成有效批次，intentSigner 无法直接广播。签名 close SHALL 执行相同时间与动态互斥检查。

#### Scenario: 激活后角色重叠使操作 fail closed
- **WHEN** governance 在 Escrow 激活后错误地把 intentSigner 授予 SETTLER/其他敏感角色，或把当前 settler 授予 INTENT_SIGNER_ROLE
- **THEN** 后续 settleBatch 与签名 close SHALL 回滚，不能由一个地址同时签名和广播；撤销冲突角色并恢复正确 allowlist 后才可重试

#### Scenario: 有效签名批次成功
- **WHEN** settler 提交有效 intent signer 签名、非空有序 items、计算 total 与参数一致且预算充足
- **THEN** Escrow SHALL 在一笔交易中完成全部支付、增加 spent 并记录结果摘要

#### Scenario: 任一授权或 item 无效则全批回滚
- **WHEN** settler/intent signer/签名 deadline/nonce/key/itemsHash/total/batch size 任一无效
- **THEN** 整个批次 SHALL 回滚，不产生部分状态、事件或付款

#### Scenario: 非 Active、到期或 Closed 禁止结算
- **WHEN** Escrow 非 Active、block.timestamp >= expectedExpiresAt 或已 Closed
- **THEN** settleBatch SHALL 失败并保留现有余额与 key 状态

### Requirement: Registry revision 与精确收款原子校验
每个 settlement item SHALL 包含 requestKey、sourceId、registryRevision、expectedPayout、maxUnitPrice 和 amount，并纳入 itemsHash/签名。Escrow SHALL 在同一交易读取 Registry，要求 revision/payout/max/active 完全匹配，且 0 < amount <= maxUnitPrice。

#### Scenario: Registry 配置匹配时付款
- **WHEN** item snapshot 与当前 Registry 完全一致
- **THEN** Escrow SHALL 只向 expectedPayout 支付 amount

#### Scenario: Registry 更新阻断旧 intent
- **WHEN** intent 创建后 Registry revision、payout、max 或 active 变化
- **THEN** settlement SHALL fail closed，不能静默使用新地址/边界

#### Scenario: 拒绝协议或自利 payout
- **WHEN** payout 为 buyer、Escrow、Factory、Registry、USDC、零地址，或当前持有任一 Factory/Registry 敏感角色
- **THEN** settlement SHALL 拒绝整个批次

#### Scenario: 精确验证付款余额差
- **WHEN** 每项 USDC transfer 执行
- **THEN** Escrow balance MUST 精确减少 amount 且 payout balance MUST 精确增加 amount；self-transfer、fee-on-transfer 或异常 token 行为 SHALL 回滚全批

### Requirement: settlementKey/requestKey 防重与恢复摘要
Escrow SHALL 拒绝零或已处理 settlementKey/requestKey，并为每个成功 settlementKey 保存 itemsHash、total、itemCount 和处理状态。失败交易不得消耗 key；批次与逐项事件 SHALL 将 settlementKey/requestKey 设为 indexed。

#### Scenario: 拒绝批内和跨批重复 key
- **WHEN** items 内重复 requestKey，或 settlementKey/requestKey 已成功处理
- **THEN** Escrow SHALL 回滚且不再次支付

#### Scenario: 失败批次可安全重试
- **WHEN** 批次在任何校验或 token 调用处回滚
- **THEN** settlementKey 和所有新 requestKey SHALL 保持未处理

#### Scenario: 广播后 DB 崩溃恢复
- **WHEN** 链上已成功但 worker 未保存 txHash/确认
- **THEN** 补偿 worker SHALL 从部署区块扫描 indexed event，校验链上摘要和 Transfer 后恢复 DB，不得再次广播

### Requirement: durable workflow 与生产 fail-closed
Escrow backend SHALL 依赖持久数据库、workflow outbox 和受保护的 Cron/queue worker。ACTIVATE、RUN、SETTLE、RECONCILE、CLOSE operation SHALL 具有唯一 operationKey、phase、带单调 fencing token 的 lease、attempt、nextAttemptAt、payload hash、txHash/error 和链上定位；每次 checkpoint、intent 或 phase 写入 SHALL 条件校验当前 fence，过期旧 worker 恢复后不得继续产生副作用。广播前可重放授权 SHALL 只保存在受保护 payload 中，日志/事件/诊断字段只能暴露 digest。进程内调用只能作为低延迟优化。

#### Scenario: 无持久依赖拒绝 Escrow
- **WHEN** production 缺少 Postgres、迁移或 worker 鉴权配置
- **THEN** prepare/start SHALL 返回 DURABLE_DB_REQUIRED，且不得创建 voucher 或接受资金流程

#### Scenario: no-intent research 仍关闭
- **WHEN** Active research 完成/取消但没有 payment intent
- **THEN** 同一 DB 事务 SHALL 创建 CLOSE operation，不能因缺少 settlement row 遗忘退款

#### Scenario: operation lease 崩溃恢复
- **WHEN** worker 在 activation/settlement/close 广播前、广播后、确认写 DB 前或下一阶段入队前崩溃
- **THEN** lease 到期后其他 worker SHALL 根据 operationKey、链上 key/事件和 txHash 状态恢复，不重复副作用

### Requirement: durable Agent runner 与取消
Escrow research SHALL 使用 DB runner lease；SSE/globalThis 不得作为唯一 runner claim。每个付费工具步骤 SHALL 在执行前持久化稳定 paymentIntentId/toolOrdinal 并从其生成 requestKey，不得直接使用临时 LLM call.id。取消 SHALL 持久化 cancelRequestedAt 并写 finalization outbox。

#### Scenario: 多实例只能一个 runner
- **WHEN** 多个实例尝试执行同一 research
- **THEN** 只有 lease owner SHALL 运行 Agent/工具，其他实例只读取持久事件或状态

#### Scenario: 付费 intent 后 lease 丢失
- **WHEN** runner 在至少一个 intent 后崩溃且 lease 过期
- **THEN** V1 SHALL 不自动重跑 Agent，而是标记安全失败、结算既有 intents 并关闭退款

#### Scenario: durable cancellation 阻止新 intent
- **WHEN** cancel API 写入 cancelRequestedAt
- **THEN** runner SHALL 在下一次 LLM/工具/intent 前停止，closing 屏障 SHALL 阻止并发新增 intent

### Requirement: 签名关闭、closing 屏障与退款
完成/失败/取消 SHALL 保留面向用户的 research 终态，并先在同一数据库事务把独立 finalizationState 原子切为 closing、阻止新 intent；所有既有 intents 按 design canonical liability tuple 恰好终态化后，intent signer SHALL 签署包含 closeReason、finalLiabilityHash、spent、nonce、issuedAt 和 deadline 的 CloseAuthorization，settler 方可 close，成功后合约事件/状态 SHALL 保存该 hash 且 finalizationState SHALL 为 closed。buyer 在 Active 到期前不得单方面抽资。

#### Scenario: 正常签名关闭
- **WHEN** closing 屏障已建立、pending intents 为零且 CloseAuthorization 有效
- **THEN** Escrow SHALL 要求 finalLiabilityHash 非零，进入不可逆 Closed，记录 closeReason/finalLiabilityHash，并把 budgetRefund/excessRefund 退给 buyer

#### Scenario: liability 集合不完整则不得关闭
- **WHEN** liabilities 含零/重复/遗漏 requestKey、未知 terminalState、PAID 缺少匹配链上 result、VOID 已发生副作用、UNPAYABLE 未经 manual 审批，或 PAID amount 总和不等于 spent
- **THEN** intent signer/worker SHALL 拒绝生成 CloseAuthorization，settler不得关闭；链上已有签名字段不匹配时 SHALL 回滚

#### Scenario: cancel 与 intent 创建竞态
- **WHEN** cancel/close 与新 payment intent 并发
- **THEN** 同一事务锁/条件更新 SHALL 只允许 finalizationState 切为 closing 或 intent 创建之一成功，不能遗漏 liability

#### Scenario: 到期无许可退款
- **WHEN** block.timestamp >= expectedExpiresAt 且 Escrow 未 Closed
- **THEN** 任意账户 SHALL 能关闭，但全部余额只能发送给 buyer

#### Scenario: creation pause 不阻断退出或既有签名 settlement
- **WHEN** Factory creation/activation 被暂停
- **THEN** 新 voucher 实例/激活 SHALL 被阻止，既有 Active Escrow 的签名 settlement、close、Funded 取消和到期退款 SHALL 保持可用

### Requirement: excess recovery 与会计不变量
直接转入 USDC SHALL 只增加 excess，不扩大 initialBudget 或可结算额度。Active 时内部 accountedBalance SHALL 等于 initialBudget - spent，实际余额 SHALL 不小于 accountedBalance，excess SHALL 等于实际余额 - accountedBalance；结算上限只能使用 accountedBalance。close SHALL 分开记录 budgetRefund/excessRefund。Closed 后再次转入的 excess SHALL 可由任意账户触发 recoverExcess，但接收方固定 buyer。

#### Scenario: close 时实际余额清零
- **WHEN** close 或到期退款成功
- **THEN** 该交易完成时 Escrow USDC balance SHALL 为零，且 initialBudget SHALL 等于 spent + budgetRefund

#### Scenario: Closed 后 excess 可恢复
- **WHEN** Closed 地址之后收到 USDC
- **THEN** 任意账户可调用 recoverExcess 将当前余额发送 buyer，状态/closeReason/预算不改变

#### Scenario: admin 不可 sweep
- **WHEN** 任意 admin/settler 尝试把 Escrow 余额转给非 buyer
- **THEN** Escrow SHALL 拒绝调用

### Requirement: 角色分离、完整枚举与不可升级 V1
Factory/Registry SHALL 使用 AccessControlEnumerable 或等价完整事件重放。deployment key、Factory DEFAULT_ADMIN、Registry DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 和 buyer 的权限 SHALL 符合 design 角色矩阵；除 constructor 可让 deployment key 在无外部 funding 的 bootstrap 阶段临时持有两份 DEFAULT_ADMIN 外，grant 路径与运行时 SHALL 强制敏感角色互斥。发布前 deployment key SHALL 不持有任何 admin/runtime role，Factory implementation 在 V1 不可更换。

#### Scenario: 单一运行密钥不能支付
- **WHEN** 只有 settler 或只有 intent signer 被攻破
- **THEN** 攻击者 SHALL 无法同时生成有效批次并提交支付

#### Scenario: admin 不能替换既有 intent signer
- **WHEN** governance 修改未来 funding signer/settler 配置
- **THEN** 已激活 Escrow 固化的 intent signer SHALL 不变

#### Scenario: 完整角色集合可验证
- **WHEN** 部署 verifier 检查敏感角色
- **THEN** 成员集合、数量、role-admin 图和 grant/revoke 历史 SHALL 与 manifest 完全一致，不得存在隐藏 admin/signer/settler

### Requirement: 审计事件与只读接口
Registry、Factory 和 Escrow SHALL 发出足以重建 source revision、child lineage、资助/激活、settlement 摘要/逐项付款、close/refund/excess recovery 的结构化事件，并提供地址预测、实例配置、状态、spent、余额分类和 key/result 摘要读接口。

#### Scenario: 事件可完整对账
- **WHEN** funding、activation、settlement、close 或 recovery 成功
- **THEN** 事件字段 SHALL 与状态、USDC Transfer 和数据库 operation snapshot 一致

#### Scenario: 回滚不留下成功证据
- **WHEN** 任一操作回滚
- **THEN** 链上 SHALL 不保留成功事件、状态变化或已处理 key
