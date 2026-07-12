## ADDED Requirements

### Requirement: 可审计的部署谱系与真实实例计数
系统 MUST 将项目部署拓扑表示为一个一次性反向绑定 Factory 的 `DataSourceRegistry`、一个锁定 initializer 的 `ResearchEscrow` implementation、一个绑定该 Registry/implementation/权威 USDC 的 `ResearchEscrowFactory`，以及由该 Factory 创建的 `ResearchEscrow` clones。证据 MUST 能从项目 deployer 追溯三个核心合约，证明 Registry↔Factory/USDC 双向 wiring，并从 Factory 创建交易、事件、CREATE2 salt、runtime code 和初始化参数追溯每个 clone。

#### Scenario: 核心合约归属于项目 deployer
- **WHEN** 三个核心合约在 Arc Testnet chain ID `5042002` 部署完成
- **THEN** 每个部署交易或创建 trace MUST 证明 creator 等于清单声明的 deployer，地址、交易、区块和合约类型 MUST 一一对应

#### Scenario: Registry 与 Factory 双向绑定
- **WHEN** 三个核心合约进入可配置状态
- **THEN** Registry bindFactory 交易/事件与 finalized 读回 MUST 证明它只绑定 manifest Factory，Factory.registry/USDC 与 Registry.factory/USDC MUST 双向一致且绑定不可再次修改

#### Scenario: clone 归属于固定 Factory 和 implementation
- **WHEN** 一个 clone 被纳入部署证据
- **THEN** 创建交易、Factory 事件、`(buyer, researchKey)` salt、预测/实际地址、初始化参数和 EIP-1167 runtime MUST 共同证明该 clone 由清单中的 Factory 创建并委托到清单中的固定 implementation

#### Scenario: R 只计算非零真实资助 clone
- **WHEN** 清单计算实例数 `R`
- **THEN** 每个计入 `R` 的 clone MUST 具有来自权威 USDC 的成功非零 `createAndFund` Transfer、正确的 Factory lineage 和有效 runtime；空实例、失败交易、零资助地址、外部 Factory 实例和仅预测地址 MUST NOT 计入 `R`

#### Scenario: 单列真实 settlement 数量
- **WHEN** 发布 `3 + R` 项目合约数量
- **THEN** 清单 MUST 同时报告 `fundedCloneCount = R` 与 `settledCloneCount`，后者只计算至少完成一笔非零、双授权、精确余额差 settlement 的唯一 clone，且 `settledCloneCount <= R`

### Requirement: 内置且独立验证 Arc Testnet 官方 USDC
部署 verifier MUST 在受审代码中把 chain ID `5042002` 的权威 USDC 地址固定为 `0x3600000000000000000000000000000000000000`，并把 Arc native USDC system emitter 固定为 `0xfffffffffffffffffffffffffffffffffffffffe`，不得从待验证 manifest、环境覆盖或部署脚本输出中取得这些期望值。发布证据 MUST 记录 Circle/Arc 官方来源、获取时间和来源摘要，并在指定 finalized 复核区块独立验证 USDC 地址、code、`decimals() == 6`、runtime hash，以及适用时的 proxy implementation。

#### Scenario: manifest 引用权威 USDC
- **WHEN** verifier 检查 `deployments/5042002.json`、Factory、Escrow 或 smoke
- **THEN** 所有 USDC 地址 MUST 精确等于内置权威地址，Factory/clone 读回值 MUST 一致，且该地址 MUST 有 code 并报告 6 位 decimals

#### Scenario: manifest 不能自行声明替代 token
- **WHEN** manifest 或环境配置提供另一个有 code 且 decimals 为 6 的 token
- **THEN** verifier MUST 判定失败，不得把该 token 的 Transfer、余额或 smoke 作为官方 test USDC 证据

#### Scenario: 权威依赖链上状态不可复核
- **WHEN** 权威 USDC 在复核区块无 code、runtime/proxy implementation 与证据不一致、decimals 不为 6，或独立官方来源缺失
- **THEN** 发布门禁 MUST 失败并停止部署证据发布，不得仅以 manifest 声明降级通过

### Requirement: ARC 5042002 完整机器可读 manifest
系统 MUST 将最终机器可读清单写入 `deployments/5042002.json`。清单 MUST 使用版本化 schema 和规范格式，完整记录网络、地址、交易、finalized 区块、构建输入、artifact hashes、构造/初始化参数、角色、外部依赖、clone 谱系和 smoke 定位，使独立验证器无需私有数据库即可复核公开事实。

#### Scenario: 记录顶层链与发布身份
- **WHEN** 生成候选 manifest
- **THEN** 顶层 MUST 包含 schemaVersion、network、chainId `5042002`、公开 RPC 网络标识、证据生成时间、复核 finalized blockNumber/blockHash/timestamp、repository、source Git commit、clean-tree 证明、deployer 和证据生成器版本

#### Scenario: 记录全部项目和运行地址
- **WHEN** manifest 描述部署身份
- **THEN** MUST 完整列出 Registry、implementation、Factory、Registry bindFactory tx/event、deployer、Factory governance Safe、Registry governance Safe、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER，以及 smoke buyer、payout；每个地址 MUST 使用规范 EVM 地址格式并标明角色/合约类型

#### Scenario: 记录核心合约部署与 artifact 元数据
- **WHEN** 任一核心合约写入 manifest
- **THEN** 记录 MUST 包含名称、类型、地址、creator、deployment txHash、receipt status、blockNumber、blockHash、transactionIndex、完整限定 artifact 名称、源文件、原始及解码 constructor arguments、init code hash、creation bytecode hash、compiled deployed bytecode hash、链上 runtime bytecode hash、ABI hash、metadata hash、build-info hash 和 source bundle hash

#### Scenario: 记录编译和依赖输入
- **WHEN** manifest 记录构建身份
- **THEN** MUST 包含精确 Solidity compiler、Foundry 版本、optimizer/runs、viaIR、EVM version、metadata bytecode 设置、remappings、OpenZeppelin 版本/commit、依赖锁摘要和构建命令，不得只记录笼统版本范围

#### Scenario: 记录 clone 与资助元数据
- **WHEN** 一个 clone 计入 `R`
- **THEN** MUST 记录 clone、buyer、researchKey、Factory、implementation、Registry、USDC、salt、预测地址、voucher hash/nonce、原始及解码 initializer arguments、创建/资助 txHash、blockNumber、blockHash、Factory event logIndex、USDC funding Transfer logIndex、initialBudget、activationCutoff、expectedExpiresAt、runtime hash 和当前状态，且不得记录原始 researchId 或业务内容

#### Scenario: manifest 字段与链上事实不一致
- **WHEN** 任一地址、chain、receipt、区块、构造/初始化参数、code/hash、角色、事件或金额无法在 finalized 链上状态复核
- **THEN** verifier MUST fail closed，候选 manifest MUST NOT 被标记或发布为最终证据

### Requirement: clean commit 与可复现 artifact
最终部署及证据 MUST 源自无 tracked/untracked 修改、无 dirty submodule 的 clean Git commit。验证器 MUST 在隔离的 clean checkout 中使用 manifest 固定的工具链和依赖重新构建，并将重建产物与部署输入、链上代码和 manifest hash 逐项比较；当前工作目录已有 artifact 不得作为唯一构建依据。

#### Scenario: clean commit 可重复构建
- **WHEN** 独立验证器 checkout manifest commit 并执行固定构建命令
- **THEN** Registry、implementation 和 Factory 的 ABI、metadata、build-info、creation/deployed bytecode hash MUST 与 manifest 完全一致，重建 init code 加 constructor arguments MUST 对应实际部署交易输入

#### Scenario: dirty 或不可复现构建
- **WHEN** 部署前工作树/submodule 非 clean、commit 不存在、依赖未锁定，或隔离重建任一 hash 不一致
- **THEN** 部署/发布流程 MUST 在广播前或发布前失败，不得使用 `--force`、缓存 artifact 或手工修改 manifest 绕过

### Requirement: 核心源码 exact-match 与 clone runtime 验证
Registry、ResearchEscrow implementation 和 Factory MUST 在 Arc 区块浏览器或等价公开验证服务完成 exact-match 源码验证。验证输入 MUST 来自 manifest clean commit 的可复现构建；similar/partial match、仅上传 ABI 或本地推断 MUST NOT 视为源码验证成功。Clone MUST 通过标准 EIP-1167 runtime、implementation 目标和 Factory lineage 验证，不得冒充独立业务实现源码。

#### Scenario: 三个核心合约源码验证成功
- **WHEN** 部署证据被标记为可发布
- **THEN** manifest MUST 记录每个核心合约的公开验证 URL/标识、exact-match 状态、验证时间、compiler/build settings、constructor arguments 和 ABI hash，且它们 MUST 与可复现 artifact 及链上 runtime 一致

#### Scenario: clone code 指向正确 implementation
- **WHEN** verifier 对任一计数 clone 调用 `eth_getCode`
- **THEN** code MUST 非 `0x`、runtime hash MUST 与 manifest 一致、最小代理目标 MUST 等于固定 implementation，并且 Factory 创建事件和 CREATE2 地址 MUST 匹配

#### Scenario: 源码或 runtime 验证不完整
- **WHEN** 任一核心合约不是 exact-match，任一项目地址 code 为空/hash 不一致，或 clone 指向其他 implementation
- **THEN** 发布 MUST 失败，该地址和相关 clone MUST NOT 计入可交付项目合约数量

### Requirement: 完整角色成员集合与 role-admin 图
部署证据 MUST 对 Factory/Registry 的每个敏感角色记录 role identifier、role-admin、完整成员集合、成员数量及全部 grant/revoke 证明，而不是只抽查声明地址。证明 MUST 使用 AccessControlEnumerable 读回，或从每个合约部署区块完整重放 RoleGranted/RoleRevoked 并与 finalized 状态交叉核对。

#### Scenario: 角色矩阵完整且相互隔离
- **WHEN** 角色移交完成
- **THEN** Factory governance、Registry governance、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER 和 SETTLER 的成员集合与 design 矩阵 MUST 完全一致；Factory 与 Registry governance MUST 分离，funding signer、intent signer EOA、settler 和 SOURCE_ADMIN MUST 不拥有彼此或 admin 角色
- **AND** verifier MUST 证明每个 INTENT_SIGNER 成员 `eth_getCode == 0x`，并模拟/读取 grant 约束确认任意双敏感角色重叠会失败

#### Scenario: deployer 已完全撤权
- **WHEN** 初始配置与角色移交交易 finalized
- **THEN** 完整成员证明 MUST 显示 deployer 不持有任何 DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 或等价 runtime role，并记录对应 grant/revoke txHash、blockNumber 和 logIndex

#### Scenario: 记录 role-admin 图
- **WHEN** verifier 检查任一敏感角色
- **THEN** manifest 声明的 `getRoleAdmin`/等价关系、admin 成员集合和链上读回 MUST 完全一致，且 MUST 能证明谁有权新增或撤销每类成员

#### Scenario: 存在隐藏或额外成员
- **WHEN** 事件重放、枚举数量或 finalized 读回发现 manifest 未列出的 admin、source admin、funding signer 或 settler，或 role-admin 图不一致
- **THEN** 权限验证与整个发布门禁 MUST 失败，不得只验证 deployer 已撤权后继续发布

### Requirement: 外部链上写入必须逐阶段取得用户明确授权
部署工具 MUST 在任何不可逆外部写入前展示 chainId、目标地址、clean commit、待广播交易、角色变化、预计 gas 和最大 test USDC 数量，并分别对“部署核心合约”“配置及移交角色”“执行会花费 test USDC 的 smoke”取得用户当次明确授权。三个阶段的授权 MUST 相互独立，不得合并、预授权、从环境变量推断或把用户对前一步的同意沿用到后一步。

#### Scenario: 部署前单独授权
- **WHEN** 工具准备广播 Registry、implementation 或 Factory 部署交易
- **THEN** MUST 先获得明确覆盖 chainId `5042002`、三个 artifact、deployer、预计地址和目标 commit 的部署授权；未授权时不得广播任何部署交易

#### Scenario: source 配置、角色配置和移交前再次授权
- **WHEN** 核心部署完成并准备登记/更新 source payout、maxUnitPrice、active，或 grant/revoke 角色、撤销 deployer、移交 admin
- **THEN** MUST 展示全部 source 配置与完整 grant/revoke 差异并另行取得配置/角色移交授权；部署授权不得替代该授权

#### Scenario: 花费 test USDC 前再次授权
- **WHEN** 准备执行 approve、createAndFund、非零 settlement 或 close/refund smoke
- **THEN** MUST 展示 buyer、payout、Escrow、每步最大 USDC units 和交易顺序并另行取得 test USDC 花费授权；部署或角色授权不得替代该授权

#### Scenario: 参数变化或重试需要新授权
- **WHEN** 已授权后 chain、commit、地址、角色差异、交易 calldata、最大 gas/USDC 范围改变，或失败后需要广播替代交易
- **THEN** 旧授权 MUST 失效，工具 MUST 重新展示变更并取得新的明确授权

#### Scenario: 用户拒绝或未回应
- **WHEN** 任一阶段未获得明确授权
- **THEN** 工具 MUST 停止该阶段及后续外部写入，仅可保留不含机密的本地 dry-run/候选验证结果

### Requirement: 身份隔离的真实 Funded 到关闭 smoke
部署证据 MUST 包含至少一个由项目 Factory 创建的非零资助 clone，在 chain ID `5042002` 上按 `approve → createAndFund(Funded) → buyer-signed activate(Active) → intent-signed + settler-submitted settleBatch → intent-signed + settler-submitted close/refund` 完整执行。Smoke SHALL 固定使用 code 为空且仅持有 INTENT_SIGNER_ROLE 的 EOA intent signer，因此 settlement/close 可用 ECDSA recovery 复核；buyer/funding signer 的 ERC-1271 兼容性另由本地测试覆盖。项目事件或交易成功状态不能替代权威 USDC Transfer、精确余额差、签名者和合约状态读回。

#### Scenario: smoke 身份严格隔离
- **WHEN** smoke 开始
- **THEN** deployer、Factory governance、Registry governance、SOURCE_ADMIN、funding signer、intent signer、settler、buyer 和 payout MUST 按 design 角色矩阵使用相互隔离的地址；payout MUST 额外不同于所有上述身份、Escrow、Factory、Registry、implementation 和 USDC，buyer MUST 不持有项目管理/签名/runtime role

#### Scenario: 非零资助后保持 Funded
- **WHEN** buyer 使用有效 funding voucher 完成 approve 和 createAndFund
- **THEN** 权威 USDC MUST 产生 buyer 到 clone、金额等于 initialBudget 的非零 Transfer；Factory 调用内观察的 buyer 余额 MUST 精确减少、clone 余额 MUST 精确增加同一金额，clone MUST 读回为 Funded 且 spent 为零
- **AND** smoke MUST 使用 direct EOA buyer，`tx.from == buyer` 且 buyer 为实际 gas payer，不得使用 AA/paymaster/sponsorship；原生 18 位余额 MUST 满足 `nativeBefore18-nativeAfter18-gasUsed*effectiveGasPrice = initialBudgetUnits6*10^12`
- **AND** verifier MUST 使用可复核 transaction state diff，或 block N-1/N 与整块交易/system event 扫描排除同区块其他 buyer 余额变化；不得直接混比六位 `balanceOf` 与 18 位 gas

#### Scenario: buyer 签名激活
- **WHEN** relayer/settler 提交 buyer 的有效 ActivationAuthorization
- **THEN** 签名恢复地址 MUST 等于 smoke buyer，授权字段/nonce/deadline MUST 与 manifest 摘要一致，clone MUST 从 Funded 变为 Active 并固化独立 intent signer，且激活不得移动 USDC

#### Scenario: 双授权 settlement 与精确付款
- **WHEN** 当前 SETTLER 提交独立 intent signer 签署的非零 SettlementAuthorization
- **THEN** verifier MUST 证明调用方拥有 SETTLER_ROLE、签名恢复为固化 intent signer、Registry revision/config 和结果摘要匹配；权威 USDC MUST 产生 clone 到隔离 payout 的 Transfer，clone 余额 MUST 精确减少、payout 余额 MUST 精确增加 amount，且不存在影响这两个地址差额的未计入同区块 Transfer

#### Scenario: 签名 close 与精确退款
- **WHEN** 当前 SETTLER 提交 intent signer 签署的 CloseAuthorization 且存在非零未使用预算
- **THEN** 签名字段、按 design canonical liabilities 独立重算的 finalLiabilityHash、PAID result/spent、nonce/issuedAt/deadline、5 分钟 lifetime 和 EOA 签名者 MUST 验证成功；Close 事件/状态 MUST 保存同一 hash
- **AND** 权威 USDC MUST 产生 clone 到 buyer 的非零退款 Transfer，clone 余额 MUST 精确减少至零、buyer 余额 MUST 精确增加 refund，且 `initialBudget = spent + budgetRefund`

#### Scenario: smoke 可由公开 RPC 独立复核
- **WHEN** 独立验证器只使用 manifest、公开 RPC 和公开源码验证结果复核 smoke
- **THEN** 每步 txHash/status/blockHash/logIndex、Factory/Escrow 事件、USDC contract 的六位 Transfer、Arc system emitter 的 18 位 Transfer、前后余额、签名者、nonce、状态和金额守恒 MUST 全部一致
- **AND** verifier MUST 按 emitter/decimals 区分并交叉核对两类 Transfer，不能把同一次移动双计；需要区块级余额差时 MUST 排除同区块其他变化、单列 18 位 gas debit/refund，或使用可复核 transaction state diff

### Requirement: 外部依赖与项目合约分开计数
Manifest MUST 将项目部署合约与外部依赖分别列示。Deployer EOA、治理/管理 Safe、权威 USDC、区块浏览器、RPC 和其他预先存在的第三方合约 MUST NOT 被声明为项目合约或纳入 `3 + R`。

#### Scenario: 外部依赖不增加项目数量
- **WHEN** 评审计算项目部署合约数量
- **THEN** MUST 只包含三个通过验证的核心合约和 `R` 个通过非零资助/lineage/runtime 验证的 clones，并排除所有 EOA、Safe 与外部依赖

#### Scenario: 外部依赖来源可复核
- **WHEN** 部署或 smoke 使用 USDC、native system emitter、Safe、公开 RPC 或验证服务
- **THEN** manifest externalDependencies MUST 记录名称、地址或公开标识、chainId、权威来源、复核区块和适用的 code/hash，同时明确标记为非项目部署

### Requirement: 失败即停止发布的证据门禁
独立 verifier MUST 默认 fail closed，并对 manifest schema、clean/reproducible build、chain/finality、交易/区块、code/hash、constructor/init、Factory wiring、权威 USDC、完整角色、源码验证、`3 + R` 计数和 smoke 全流程逐项输出机器可读结果。任何必填检查失败、缺失、超时或无法确定 MUST 使总结果失败。

#### Scenario: 全部门禁通过后发布
- **WHEN** 所有强制检查在 finalized 数据上通过
- **THEN** verifier MUST 输出成功报告及 manifest digest，系统方可把 manifest/README/部署报告标记为最终并宣称部署、角色移交或真实 USDC smoke 已完成

#### Scenario: 任一检查失败或不确定
- **WHEN** 任一强制检查返回 fail、missing、unknown、RPC disagreement、非 finalized、源码未 exact-match 或余额无法守恒
- **THEN** verifier MUST 以非零状态退出，MUST NOT 发布最终 manifest、更新最终地址文档、增加项目合约计数或作出完成声明；候选产物必须明确标记失败且不得覆盖上一份有效证据

#### Scenario: finalized 区块发生重组或事实变化
- **WHEN** 发布前复核发现 blockHash、receipt、code、角色或 proxy implementation 相对候选证据变化
- **THEN** 候选证据 MUST 失效并从 finalized 数据重新生成、重新验证；若需要新链上交易，还 MUST 重新取得对应阶段用户授权

### Requirement: 机密、未消费签名与审批证据不得泄露
部署、验证和 smoke 工具 MUST 仅通过进程环境或受控 secret provider 读取 private key、mnemonic、keystore、认证 token 和带凭据 RPC。所有仓库文件、manifest、日志、dry-run、CI artifacts 和用户授权记录 MUST 采用公开字段白名单；不得持久化机密、完整环境、带凭据 URL或尚未上链消费的可重放 Funding/Activation/Settlement/Close 原始签名。

#### Scenario: 正常生成公开证据
- **WHEN** 工具使用机密完成签名和广播
- **THEN** 持久化产物 MUST 只包含公开地址、已上链交易输入/定位、签名摘要与恢复地址、角色读回、公开配置和 hashes；用户授权证明 MUST 只记录阶段、时间、公开范围和审批标识，不得复制敏感会话内容

#### Scenario: 发现疑似机密或未消费签名
- **WHEN** 待写字段或日志包含 private key、mnemonic、keystore、认证 token、带凭据 RPC、完整环境值或可重放的未消费签名
- **THEN** 生成过程 MUST 在落盘/上传前失败，错误消息只能指出字段和机密类型，不得回显原值，且失败产物 MUST NOT 发布

#### Scenario: CI 或自动化不能替代用户审批
- **WHEN** CI、cron、部署脚本或缓存中存在签名能力、历史批准记录或环境开关
- **THEN** 它们 MUST NOT 被解释为当前部署、角色移交或 test USDC 花费授权；缺少当次明确用户授权时不得广播
