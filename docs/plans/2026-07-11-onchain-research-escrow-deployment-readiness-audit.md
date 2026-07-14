# Onchain Research Escrow 13.2 授权前本地 readiness audit

## 范围与硬边界

当前 OpenSpec 进度：`onchain-research-escrow` 为 `100/107 tasks`。

本地收尾复核时，13.1–13.3 已根据用户逐阶段授权、`deploy-core-preflight-report.json`、`deploy-core-broadcast-summary.json` 和最终 manifest/verifier 证据关闭。本文档保留为 13.2 授权前 readiness audit 与 fail-closed 设计记录；它仍不是授权记录、不是 preflight 通过证明，也不替代 13.4 的 Explorer source/ABI exact-match 发布证据。

本文档只是 readiness audit，用于在用户授权后快速执行 13.2 preflight；它不是授权记录，不是 preflight 通过证明，也不是进入部署的许可。13.2 只能在 13.1 明确授权后执行：必须先由用户针对当次 `deploy_core_contracts` 的 chain、commit、地址、交易、预计 gas、资金影响和 requestDigest 给出明确同意，才能开始确认 clean Git commit、compiler settings、deployer balance、Factory/Registry Safe code、source payout、funding signer、intent signer EOA、settler、官方 USDC 和 public RPC finalized block。

本 audit 没有执行任何外部写入：不部署、不广播、不 source verify、不 grant/revoke、不角色移交、不花 test USDC。后续所有命令都必须 fail-closed；任一公开输入缺失、变更或不确定，都应停止并重新请求授权或补齐证据。

## 已本地验证的 gate 与用途

以下内容只说明本地工具 readiness，不说明真实 Arc Testnet 状态已通过：

| gate | node tests | 本地用途 |
| --- | --- | --- |
| `deployment-authorization-gate` | `contracts/scripts/deployment-authorization-gate.node-test.mjs` | 生成 `deploy_core_contracts`、`configure_sources_and_roles`、`smoke_usdc_spend` 三个逐阶段授权请求；计算稳定 requestDigest；拒绝复用旧授权、错阶段授权、篡改 request 或缺少必须展示给用户的字段。 |
| `deployment-evidence-package` | `contracts/scripts/deployment-evidence-package.node-test.mjs` | 组装部署、source、角色移交、manifest 与 Explorer exact-match 输入计划；扫描公开证据，拒绝 private key、provider key、credentialed RPC、本机路径和 raw signature。 |
| `deployment-preflight-gate` | `contracts/scripts/deployment-preflight-gate.node-test.mjs` | 在已有匹配授权后校验 git clean、commit、compiler settings、deployer balance、Factory/Registry Safe code、角色隔离、source payout、官方 USDC、RPC finality 和 secret hygiene；缺授权、错 digest、dirty tree、配置漂移或 RPC 凭据泄漏都 fail closed。 |
| `predeploy-commit-scope` | `contracts/scripts/predeploy-commit-scope.node-test.mjs` | 纯本地解析 `git status --short --untracked-files=all` 文本，输出 candidate/excluded/unknown 路径和 no-auto-stage/no-auto-commit/no-secrets 等 safety flags，帮助人工收敛 clean commit 候选范围；不执行 git、不暂存、不提交、不读取 env。 |
| `predeploy-stoplight` | `contracts/scripts/predeploy-stoplight.node-test.mjs` | 汇总 OpenSpec 剩余项、commit scope、Graphify 摘要、授权、clean commit、preflight、final manifest/verifier、rollout/E2E/rollback 证据，输出 `readyToDeploy=false` 与阻断原因；它只能阻止和解释，不能授权部署、不能 broadcast、不能替代任何最终证据。 |
| `deployment-next-action-checklist` | `contracts/scripts/deployment-next-action-checklist.node-test.mjs` | 将下一阶段授权请求、授权前展示项、授权后 13.2 preflight 清单和当前 blockers 输出为机器可读 checklist；authorization package、briefing 或模糊同意都不能让它放行 broadcast。 |
| `deployment-manifest` | `contracts/scripts/deployment-manifest.node-test.mjs` | 生成并校验 chainId 5042002 manifest，覆盖核心地址、构造参数、tx/block、artifact/runtime hash、官方 USDC 外部依赖、`3 + R` 拓扑和 dirty Git 拒绝。 |
| `rpc-deployment-verifier` | `contracts/scripts/rpc-deployment-verifier.node-test.mjs` | 使用公开 RPC 语义验证官方 USDC、native emitter、runtime hash、Factory/Registry wiring、initializer lock、clone implementation、完整 role graph、grant/revoke 事件和 deployer 零权限。 |
| `smoke-evidence-verifier` | `contracts/scripts/rpc-deployment-verifier.node-test.mjs` 覆盖 `contracts/scripts/smoke-evidence-verifier.mjs` | 校验 direct EOA buyer smoke 的 Arc 双接口语义、native gas 公式、六位/18 位 emitter 去重、余额差、Factory child lineage、payout 与敏感身份隔离。 |

授权整理材料也只属于本地安全材料：`deployment-authorization-package.mjs`、`deployment-authorization-handoff.md`、`deployment-authorization-briefing.mjs`、`deployment-next-action-checklist.mjs`、单阶段 briefing、nextAction checklist 和 requestDigest 只能帮助把公开 stage、chain、commit、address、gas、maxUsdcUnits 与交易/角色/资金影响整理给用户确认；它们不能替代 13.1 授权记录，不能替代 13.2 preflight 通过证明，不能替代 13.6 final public verifier，不能替代最终 manifest/verifier，不能替代 14.2–14.4 真实 rollout/E2E，也不能替代 14.9 live rollback。用户未回应或模糊同意必须停止；request/commit/address/gas/maxUsdcUnits 变化必须重新授权。

## 授权后 13.2 才能确认的项

只有 13.1 明确授权完成后，13.2 才能逐项确认并把结果写入当次 preflight 证据：

- clean Git commit：发布 commit 必须是 clean tree，对应授权 request 中的 commit；不能用当前 dirty 工作区替代。
- compiler settings：Solidity/Foundry 版本、optimizer、evmVersion、viaIR、metadata 等必须与 artifact 和授权请求一致。
- deployer balance：部署账户公开地址与最低 native gas 余额必须可复核，且 deployer 不得与最终敏感角色重叠。
- Factory/Registry Safe code：Factory governance Safe 与 Registry governance Safe 必须在目标链有 code，且不是 EOA 或错误地址。
- source payout：每个 source payout 必须公开、隔离、非协议地址，并与敏感角色和 smoke buyer 区分。
- funding signer：公开地址必须与角色配置一致，不能与 deployer、payout、settler、intent signer 等敏感身份混用。
- intent signer EOA：必须是 EOA、无 code，且不持有其它敏感角色。
- settler：公开地址必须与 SETTLER_ROLE 计划一致，并与 funding signer、intent signer、payout、deployer 等身份隔离。
- 官方 USDC：chainId 5042002 的官方 USDC 必须为权威配置，不能由 manifest 或 RPC 返回的替代 token 覆盖。
- public RPC finalized block：必须用公开 RPC 取得 finalized block、chainId 与必要读回；credentialed RPC 只能用于本地私有操作，不能进入公开证据。

## 13.2 授权前曾要求的公开输入

这些项目在进入 13.2 时必须由授权、preflight 和公开证据满足；当前 13.1–13.3 已关闭，但本节保留为历史审计清单，不能被复用为新的 source verify、rollout 或 rollback 授权：

- 用户对 `deploy_core_contracts` 的明确授权：必须针对本次 requestDigest、chain、commit、地址、预计交易、预计 gas 和 `maxUsdcUnits = 0` 明确授权；历史授权不得跨阶段复用。
- 真实公开地址值：缺少当次要展示的 deployer、Factory governance Safe、Registry governance Safe、source admin、funding signer、intent signer EOA、settler、source payout 等真实公开地址值。
- dry-run 预计地址/gas：缺少三个核心合约的 dry-run 预计地址/gas，以及 bind Registry to Factory 的 gas 估计。
- 公开 RPC finalized block：缺少用 public RPC 取得的 chainId 5042002 finalized block 与关键读回快照。
- clean-tree 发布 commit：当前工作区不是 clean-tree 发布状态；13.2 需要授权后确认 clean-tree 发布 commit，不能用未提交工作区作为最终部署来源。

## predeploy commit staging hazard

为了把后续 clean-tree 发布 commit 做成可复核证据，提交前不要使用 `git add .`。当前工作区包含源码、测试、OpenSpec、文档和 Graphify 产物，也包含不应进入发布 commit 的本地工作流/缓存/secret 边界。提交前必须先用 `git status --short --untracked-files=all` 复核候选文件，并只暂存源码、测试、OpenSpec、docs/contracts、docs/plans、README、package 和 CI 配置。

`contracts/scripts/predeploy-commit-scope.mjs` 可以把人工粘贴或管道输入的 short status 文本分类为 candidate、excluded 和 unknown：candidate 只表示路径属于源码/测试/OpenSpec/文档/CI 等可审查候选；excluded 会标注本地工作流、缓存、构建输出、vendored 依赖、broadcast artifact 或 secret env 边界；unknown 必须人工确认后才可决定是否进入候选集。该报告会显式携带 `noAutoStage`、`noAutoCommit`、`noSecrets`、`notAuthorizationRecord`、`notCleanCommitProof`、`notPreflightProof` 和 `notDeploymentPermission`，因此它不能替代用户 commit 范围确认，不能替代 clean-tree 证明，不能替代 13.1 授权记录，也不能替代 13.2 授权后 preflight。

`contracts/scripts/predeploy-stoplight.mjs` 用于把当前“还不能部署”的理由做成机器可读总闸口。它记录 Graphify 摘要和 requestDigest，但将 authorization package、handoff、briefing、commit scope report、Graphify report、preflight 输入、final evidence readiness、rollout/E2E/rollback readiness 全部标记为非授权/非最终证据；只要缺少当次明确授权、clean commit、13.2 preflight、最终 manifest/verifier、真实 rollout/E2E 或 rollback evidence，就必须保持 `broadcastAllowed=false`。该脚本不执行 git、不读 env、不连 RPC、不 source verify、不生成最终 manifest、不部署也不广播。

`contracts/scripts/deployment-next-action-checklist.mjs` 用于把下一步该做什么拆成可复核 checklist：未匹配明确授权时输出 `nextAction=request_explicit_authorization`；授权匹配但 clean commit 或 preflight 证明缺失时输出 `nextAction=run_authorized_preflight`；即使授权和 preflight 输入都齐，也仍保持 `broadcastAllowed=false`，只提示进入 13.3 前还需要阶段边界和人工核对。该 checklist 不读取 env、不执行 git/RPC/shell、不部署、不广播，也不是授权记录或 preflight 证明。

以下路径需要作为提交范围警戒处理：

- `.devos/`：本地任务工作流记录，可能包含 worker/reviewer 过程材料；除非项目方明确要求把它作为审计附件发布，否则不得用 `git add .` 顺手纳入 clean commit。
- `cache/invariant/failures/`：本地 invariant/fuzz 失败缓存，只能作为调试输入；不得纳入最终 deployment commit 或 manifest evidence。
- `contracts/out/`、`contracts/cache/`、`contracts/lib/`：Foundry build cache、输出和 vendored lib 目录已由 `.gitignore` 排除；部署 evidence 必须来自 clean checkout 的可复现构建，而不是这些本地目录。
- `.env*`：本地 secret 配置边界，任何 private key、mnemonic、credentialed RPC、token 或 raw signature 都不得进入 Git、manifest、日志或公开 evidence package。

## 授权后的建议命令顺序

以下是用户授权后的 fail-closed 顺序；任何一步失败或输入变化，都必须回到授权展示或补证，不得 --broadcast。

1. 生成/展示 deploy_core_contracts requestDigest：用 `deployment-authorization-gate` 基于当前公开输入生成 request，并用 `deployment-next-action-checklist` 复核授权前必须展示的 stage、chainId、commit、expected addresses、transactions、estimatedGas、`maxUsdcUnits = 0` 和 requestDigest。
2. 用户授权：只有用户明确同意该组公开输入后，才记录 13.1 授权事实；模糊回复、历史授权、CI 结果或缓存都不能替代。
3. `deployment-preflight-gate` 输入校验：在授权 request 与 authorization 完全匹配后，校验 clean Git commit、compiler settings、deployer balance、Factory/Registry Safe code、source payout、funding signer、intent signer EOA、settler、官方 USDC 与 public RPC finalized block。
4. evidence package/manifest/verifier dry-run：构建 evidence package，生成 manifest，运行 verifier dry-run；只允许读取公开输入和本地 fixture，不得执行 `--broadcast`、不得 source verify、不得 grant/revoke、不得角色移交、不得花 test USDC。
5. 才能进入 13.3：只有 13.2 的授权后 preflight 证据全部通过，并且输入没有变化，才能请求进入 13.3 的真实部署步骤；13.3 仍需要遵守外部写入授权和失败后先查链上再决策的规则。

## 不替代的后续任务

本 readiness audit 不替代 13.3–13.6：它没有部署 Registry/implementation/Factory，没有 exact-match source/ABI 验证，没有 bindFactory 或角色读回，没有 source 登记，没有 test USDC smoke，也没有独立公开 RPC verifier 对最终 manifest 的复核。

本 readiness audit 不替代 14.2–14.4：它没有生产 DB/worker 切流，没有成功 E2E，也没有失败 E2E。

本 readiness audit 不替代 14.9：它没有执行回滚演练，也没有证明 calldata/mock 回退、已 Funded 取消、已 Active 结算关闭或到期退出流程。

## secret hygiene

- 不得读取、复制、输出或落盘 private key、mnemonic、keystore、token、credentialed RPC、完整 env 或 raw signature。
- 公开证据只允许保存 digest、公开地址、公开 RPC 读回、交易定位、hash、compiler settings 摘要和非敏感配置。
- 文档、manifest、evidence package、日志和测试输出不得包含 raw Funding/Activation/Settlement/Close signature；如需证明签名相关事实，只记录 digest、恢复地址和链上交易定位。
- 若任何工具输出疑似 secret-shaped material，立即停止发布证据，清理本地测试产物，并在不回显秘密的前提下报告 gate 失败。
