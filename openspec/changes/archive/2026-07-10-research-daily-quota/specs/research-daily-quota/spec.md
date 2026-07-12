## ADDED Requirements

### Requirement: UTC daily research quota
系统 SHALL 对研究创建实行 UTC 自然日配额：每个钱包最多 10 次，所有钱包累计最多 100 次。

#### Scenario: Wallet reaches its daily limit
- **GIVEN** 某钱包当天已经成功创建 10 次研究
- **WHEN** 该钱包再次请求创建研究
- **THEN** 系统拒绝请求并返回 `429`
- **AND** 响应错误码为 `WALLET_LIMIT`

#### Scenario: Global daily limit is reached
- **GIVEN** 所有钱包当天累计已经成功创建 100 次研究
- **WHEN** 任意钱包再次请求创建研究
- **THEN** 系统拒绝请求并返回 `429`
- **AND** 响应错误码为 `GLOBAL_LIMIT`

#### Scenario: Quota resets at UTC midnight
- **GIVEN** 钱包和全局配额在某个 UTC 日期已经被使用
- **WHEN** 时间进入下一 UTC 日期
- **THEN** 用量从 0 重新开始计算

### Requirement: Authenticated quota status API
系统 SHALL 提供登录态 API 返回当前钱包配额和全局配额。

#### Scenario: Authenticated user requests quota
- **GIVEN** 用户已登录
- **WHEN** 请求 `GET /api/quota`
- **THEN** 返回 wallet/global 的 used、limit、remaining、resetAt

#### Scenario: Anonymous user requests quota
- **GIVEN** 用户未登录
- **WHEN** 请求 `GET /api/quota`
- **THEN** 返回 `401`

### Requirement: Terminal quota UI
研究创建页和 dashboard SHALL 以 Bloomberg 终端风格展示每日配额。

#### Scenario: Quota is available
- **GIVEN** 当前钱包和全局配额均未耗尽
- **WHEN** 用户打开 `/research`
- **THEN** 创建表单展示 wallet/global 用量、ASCII 进度条、距离重置时间和 mainnet 后放开提示

#### Scenario: Quota is exceeded
- **GIVEN** 当前钱包或全局配额已耗尽
- **WHEN** 用户打开 `/research`
- **THEN** `START RESEARCH` 按钮禁用并显示 `[ QUOTA EXCEEDED ]`
