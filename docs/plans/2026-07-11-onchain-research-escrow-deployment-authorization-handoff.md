# Onchain Research Escrow 部署核心合约授权交接包

## 当前状态

本地部署证据工具、授权 gate 与核心合约脚本已经准备到“可向用户请求授权”的门口；真实当次授权尚未取得，所以 OpenSpec 13.1 不完成，13.2 和 13.3 也不得视为完成。

本文只整理醒来后向用户索取授权时必须展示的公开范围。它不是授权记录，也不是部署指令；未取得用户针对当前 stage 的明确回复前，不得广播、不得执行 --broadcast、不得登记 source、不得 grant/revoke/移交角色、不得花费 test USDC。

目标链固定为 chainId 5042002。官方 USDC 固定为 `0x3600000000000000000000000000000000000000`。

## 阶段化授权表

| stage | 本阶段目的 | 预计交易/动作 | 资金影响 | 授权边界 |
| --- | --- | --- | --- | --- |
| deploy_core_contracts | 部署三个核心合约并完成一次性 Factory 绑定 | deploy DataSourceRegistry；deploy ResearchEscrow implementation；deploy ResearchEscrowFactory；bind Registry to Factory | deploy_core_contracts: maxUsdcUnits = 0 | 只覆盖核心部署与绑定，不覆盖 source、角色移交或 smoke |
| configure_sources_and_roles | 登记/更新 source，并完成 Factory/Registry 角色 grant/revoke/移交 | createSource/updateSource；Factory DEFAULT_ADMIN/FUNDING_SIGNER/INTENT_SIGNER/SETTLER grant；Registry DEFAULT_ADMIN/SOURCE_ADMIN grant；撤销 deployer admin | configure_sources_and_roles: maxUsdcUnits = 0 | 必须重新授权；不得复用部署授权 |
| smoke_usdc_spend | 执行会花费 test USDC 的公开 smoke | approve；createAndFund；activate；settleBatch；close/refund | smoke_usdc_spend 需要独立 test USDC 授权；maxUsdcUnits 必须在 smoke 计划中单列 | 必须在部署和配置之后另取授权，不能预授权 |

## deploy_core_contracts 醒来后必须向用户确认的公开字段

请求用户授权前，把当前候选 `deploy_core_contracts` 授权请求原样整理给用户，并至少列出：

- stage：`deploy_core_contracts`
- chainId 5042002
- clean commit：填入本次候选 commit
- requestDigest：填入由 authorization gate 对当前 request 计算出的 digest
- deployer 公开地址来源：`ARC_DEPLOYER`
- Factory governance 公开地址来源：`ARC_FACTORY_GOVERNANCE`
- Registry governance 公开地址来源：`ARC_REGISTRY_GOVERNANCE`
- Source admin 公开地址来源：`ARC_SOURCE_ADMIN`
- Funding signer 公开地址来源：`ARC_FUNDING_SIGNER`
- Intent signer 公开地址来源：`ARC_INTENT_SIGNER`
- Settler 公开地址来源：`ARC_SETTLER`
- 三个核心合约：
  - `DataSourceRegistry`
  - `ResearchEscrow implementation`
  - `ResearchEscrowFactory`
- 预计地址：registry、implementation、factory 的候选公开地址或 dry-run 预测结果
- 预计交易：
  - deploy `DataSourceRegistry`
  - deploy `ResearchEscrow implementation`
  - deploy `ResearchEscrowFactory`
  - bind Registry to Factory
- 预计 gas：填入当前 preflight/evidence package 的 deployCoreContracts gas 估计
- 资金影响：`deploy_core_contracts: maxUsdcUnits = 0`

为了避免人工整理授权单时漏字段，应优先用 `contracts/scripts/deployment-authorization-package.mjs` 从公开 deployment evidence package 生成三阶段授权包：运行 `node contracts/scripts/deployment-authorization-package.mjs evidence-package.json` 会只向 stdout 输出 JSON，包含 `deploy_core_contracts`、`configure_sources_and_roles`、`smoke_usdc_spend` 的 requestDigest、stageOrder、nextStage、manifestDigest、safety 边界、markdown briefings 和 `exactAuthorizationReplies`。这里的 `evidence-package.json` 只是公开 evidence package 路径示例，不是固定文件名；实际运行时必须替换为当次生成的公开 evidence package 路径，不得把示例路径当作固定文件名。输入必须是公开 evidence package，不得包含 secrets；该 package 工具会扫描整个公开 evidence package，即使 secret-shaped 字段不参与 requestDigest，也会 fail closed。package/briefing/exactAuthorizationReplies 输出只用于整理用户可确认材料，不能替代 13.1 授权记录，不能替代 13.2 preflight 通过证明，也不能替代最终 manifest/verifier 公开部署证据。

package 输出中的 `safety` 字段也必须按“负授权”理解：`safety.externalWritesAuthorized = false`、`safety.broadcastAllowed = false`、`safety.authorizedStages = []`、`safety.notAuthorizationRecord = true`、`safety.notPreflightProof = true`、`safety.notFinalManifestOrVerifierEvidence = true`、`safety.stageAuthorizationReuseAllowed = false`、`safety.noResponseOrAmbiguousApprovalStops = true`、`safety.inputChangeRequiresNewAuthorization = true`。这些机器可读字段只说明当前 package 不能做什么；它们不代表用户已授权任何 stage，不证明 13.2 preflight 已通过，也不证明 13.6 final manifest/verifier 已可发布。用户未回应或模糊同意时必须停止；request/commit/address/gas/maxUsdcUnits 改变后必须重新授权。

`exactAuthorizationReplies` 只允许渲染公开的 `stage`、`chainId`、`commit`、`requestDigest`、`estimatedGas`、`maxUsdcUnits` 六个字段，便于用户逐字复制确认；它不得包含 deployer、buyer、payout、私钥、RPC credential 或任何签名材料。即使公开输入中出现 authorizationText 或伪造的 exact reply，也不能把它解释成授权记录，package 必须重新按当前 requestDigest 生成展示文本并保持 `authorizedStages = []`。

如只需要渲染单个 stage request，可使用 `contracts/scripts/deployment-authorization-briefing.mjs` 中的 `buildAuthorizationBriefing(request)`；也可以把单个公开 request 或 `{ requests: [...] }` 保存为公开 JSON 后运行 `node contracts/scripts/deployment-authorization-briefing.mjs request.json`，由 CLI 只向 stdout 输出 markdown。上述 package/briefing 工具都是纯本地工具：不读 env、不访问网络、不执行 shell、不广播交易，只把公开字段转为用户可确认材料，并对 private key、mnemonic、credentialed URL、raw signature 等可疑字段 fail closed。对应本地门禁为 `contracts/scripts/deployment-authorization-package.node-test.mjs` 与 `contracts/scripts/deployment-authorization-briefing.node-test.mjs`。

只有用户明确同意这一组 chain、commit、地址、requestDigest、交易和资金影响后，才可继续进入 13.2 的 clean commit、compiler settings、deployer 余额、Safe/role/RPC 等部署前检查。用户未回应、模糊回应或只同意“继续看看”时，本阶段仍未授权。

## 后续独立授权说明

`configure_sources_and_roles` 只能在核心部署完成、地址和链上读回明确后再次请求。请求时必须展示全部 source 配置、payout、maxUnitPrice、active 状态、所有 grant/revoke 差异、deployer 撤权动作、预计 gas、`configure_sources_and_roles: maxUsdcUnits = 0` 和新的 requestDigest。不得复用部署授权。

`smoke_usdc_spend` 只能在部署、source、角色移交都完成并复核后再次请求。请求时必须展示 buyer、payout、Escrow、Factory、USDC、approve/createAndFund/activate/settleBatch/close 的顺序、每步最大 USDC units、预计 gas、direct EOA buyer/no AA/no paymaster 边界，以及该阶段单独的 requestDigest。部署授权或配置/角色授权都不得替代 test USDC 支出授权。

任一阶段授权后，只要 chain、commit、地址、角色差异、交易 calldata、预计 gas、maxUsdcUnits 或 requestDigest 变化，旧授权立即失效，必须重新展示变更并取得新的明确授权。

## 明确禁止事项

- 未取得当前 stage 明确授权前，不得广播任何交易，不得执行 --broadcast。
- 不得复用部署授权到配置/角色阶段；不得复用配置/角色授权到 smoke_usdc_spend；不得把历史聊天、CI、环境开关或缓存记录解释成当前授权。
- 不得读取、复制、记录或落盘私钥、助记词、keystore、认证 token、带凭据 RPC URL、完整 env dump。
- 不得保存原始 Funding/Activation/Settlement/Close 签名；公开材料只允许保存 digest、恢复地址、已上链交易定位和公开配置。
- 不得在授权前运行会登记 source、grant/revoke/移交角色、approve、createAndFund、settleBatch、close/refund 或花费 test USDC 的命令。
- 不得在部署失败或 RPC 状态不确定时盲目重播；必须先查链上公开事实，再决定是否需要新的授权。

## 下一步待填清单

醒来后准备 `deploy_core_contracts` 授权请求时，先填充以下公开项：

- 当前 Git commit 与 clean-tree 证明。
- 当前 `deploy_core_contracts` requestDigest。
- `ARC_DEPLOYER` 对应公开地址。
- `ARC_FACTORY_GOVERNANCE` 对应公开地址。
- `ARC_REGISTRY_GOVERNANCE` 对应公开地址。
- `ARC_SOURCE_ADMIN` 对应公开地址。
- `ARC_FUNDING_SIGNER` 对应公开地址。
- `ARC_INTENT_SIGNER` 对应公开地址。
- `ARC_SETTLER` 对应公开地址。
- 三个核心合约的 dry-run 预计地址：`DataSourceRegistry`、`ResearchEscrow implementation`、`ResearchEscrowFactory`。
- deployCoreContracts 预计 gas、公开 RPC 网络标识、Foundry/Solidity/compiler settings 摘要。
- 明确向用户提问：“是否授权在 chainId 5042002、上述 commit、地址、交易和 maxUsdcUnits = 0 范围内执行 deploy_core_contracts？”

最终提醒：本交接包只支持醒来后更清晰地索取授权；当前不勾 13.1、不勾 13.2、不勾 13.3。
