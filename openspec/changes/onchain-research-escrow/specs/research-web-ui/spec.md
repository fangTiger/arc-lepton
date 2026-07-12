## MODIFIED Requirements

### Requirement: Research 创建与 Live 执行页面
系统 SHALL 提供受保护的 `/research` 页面；mock 与 legacy calldata backend SHALL 保持单步创建并进入 Live，Escrow backend SHALL 实现可恢复的 `prepare → approve → createAndFund(Funded) → buyer ActivationAuthorization → activating → running` 状态机，并在 running 后于同页展示持久 SSE Live 执行。

#### Scenario: mock 或 legacy calldata 创建研究请求
- **GIVEN** 已登录用户填写 topic 和 budget，当前为 mock 或 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata`
- **WHEN** 点击 start research
- **THEN** 页面 SHALL 按既有契约调用 `/api/research/start`，URL 更新为 `?id=<researchId>` 并切换到 Live 视图
- **AND** 不 SHALL 请求 voucher、approve、Escrow funding 或 activation 签名

#### Scenario: Escrow prepare 与非零资助
- **GIVEN** 已登录 buyer 选择 Escrow backend、填写合法 topic/budget 且 quota 可预留
- **WHEN** 点击 start research
- **THEN** 页面 SHALL 使用稳定 Idempotency-Key 调用 prepare，展示官方 USDC、Factory、预测 Escrow、budgetUnits、expectedExpiresAt、fundingDeadline、intentSigner 和 reserved quota
- **AND** buyer 确认后 SHALL 按需 approve 并调用 createAndFund，等待/验证 Funded receipt 后才进入 activation 步骤

#### Scenario: buyer 看清授权后签署激活
- **GIVEN** Escrow 已 Funded 且当前钱包/SIWE buyer/chain 与 prepare 一致
- **WHEN** UI 请求 ActivationAuthorization
- **THEN** UI SHALL 在签名前明确展示 Escrow、intent signer、授权预算、expiry、签名 deadline 和“intent signer + 独立 settler”信任边界
- **AND** start 返回 running 时 SHALL 进入 Live；返回 activating 时 SHALL 显示持久进度并轮询同一 operation，不重复签名或提交

#### Scenario: 钱包、会话或网络中途变化
- **GIVEN** funding 流程处于 approve、createAndFund、activation 或 start 任一步
- **WHEN** wallet account、SIWE buyer、chainId、Factory、voucher deadline 或 expected expiry 与 prepare 不再一致
- **THEN** UI SHALL 在下一次签名/广播前停止，显示可恢复错误，且不得用新账户继续旧 buyer 的流程

#### Scenario: funding 流程重载恢复
- **GIVEN** research 处于 funding、Funded、activating、running 或 finalizationState closing/manual
- **WHEN** 用户刷新页面、切换标签或重新登录同一 buyer
- **THEN** 页面 SHALL 从 research/detail/quota/链上事实恢复唯一阶段、tx 和下一安全动作
- **AND** 不 SHALL 创建第二条 research、quota reservation、clone、ActivationAuthorization 或 runner

#### Scenario: 展示 AgentEvent
- **GIVEN** research 正在 running
- **WHEN** `/api/research/[id]/stream` 推送或 replay 持久 AgentEvent
- **THEN** 页面 SHALL 展示带 UTC 时间戳的 agent log、tx feed 和 budget meter
- **AND** SSE 重连不 SHALL 启动第二 runner，pending settlement 不 SHALL 阻止 final 报告

### Requirement: Research 报告详情页
系统 SHALL 提供受保护的 `/research/[id]` 页面，展示 research 元数据、markdown 报告、数据源 tx 表；Escrow research 还 SHALL 分开展示 research status、activationPhase、finalizationState、Escrow/Factory/USDC、funding/activation/settlement/close 证据和可用退出动作。

#### Scenario: 查看完成报告
- **GIVEN** research 报告已完成
- **WHEN** 用户打开详情页
- **THEN** 页面 SHALL 立即渲染 report markdown，并列出本次工具调用 cost、requestKey、pending/confirmed/failed 状态和可用 tx hash
- **AND** settlement/close 尚未完成时 SHALL 如实显示 finalizationState，不得隐藏报告或把广播中表示为 confirmed

#### Scenario: 查看 funding 或人工恢复状态
- **GIVEN** Escrow research 处于 funding/Funded/activating/funding_expired 或 finalizationState manual
- **WHEN** owner 打开详情页
- **THEN** 页面 SHALL 展示已验证事实、失败阶段、可重试/取消/人工恢复入口及 Explorer 定位
- **AND** Funded 未 Active 时 SHALL 提供 cancelUnactivated，Active 时不得提供到期前 buyer 抽资动作

### Requirement: Dashboard 真实历史
系统 SHALL 使用真实 API 数据展示账户、统计和 research history；funding/funding_expired、report status 与资金 finalizationState SHALL 分开统计和展示，pending liability 不得冒充 settled spend。

#### Scenario: 查看 dashboard
- **GIVEN** 已登录用户有 mock、legacy 或 Escrow research 历史
- **WHEN** 打开 `/dashboard`
- **THEN** 页面 SHALL 展示账户、总 research、总调用、已完整对账花费、reserved quota 和 history 表
- **AND** 每条 Escrow history SHALL 区分 funding/running/报告终态与 finalizationState，funding_expired 不计入已运行/完成/取消/花费

### Requirement: 首页实时全局 stats
系统 SHALL 提供公开全局 stats API，并在首页轮询展示真实数据；Escrow funding/funding_expired 不 SHALL 计入 totalResearches/activeAgents，USDC spent 只 SHALL 统计 mock immediate 或完整链上对账的 confirmed payment。

#### Scenario: 首页 stats 更新
- **GIVEN** 有混合 backend 的 research、quota reservation 和 tx_log 数据
- **WHEN** 首页每秒轮询 `/api/stats/global`
- **THEN** stats 面板 SHALL 展示真实 totalResearches、totalCallsAcrossAllUsers、totalUsdcSpent 和 activeAgents
- **AND** funding/activating reservation SHALL 与已运行 research 分离，pending/reconcile payment 不得提前增加 totalUsdcSpent
