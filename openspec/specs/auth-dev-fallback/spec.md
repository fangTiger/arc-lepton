# auth-dev-fallback Specification

## Purpose
定义开发环境缺少持久数据库时的认证用户 repository 回退、会话兼容边界，以及登录用户访问受保护 dashboard 时的占位与真实数据展示行为。
## Requirements
### Requirement: Dev users repository fallback
认证系统 SHALL 在本地开发环境没有 DB 连接串时使用进程内 users repository，使登录流程不依赖外部 Postgres。

#### Scenario: 本地没有 DB 环境变量
- **WHEN** `DATABASE_URL` 和 `POSTGRES_URL` 都未配置
- **AND** 当前不是生产运行时
- **THEN** 系统使用 in-memory users repo
- **AND** 启动日志包含 `⚠ Using in-memory users repo (dev fallback). Data lost on restart.`
- **AND** 同一进程内的登录 upsert 可以被后续查询和计数读取

#### Scenario: 生产运行时没有 DB 环境变量
- **WHEN** `DATABASE_URL` 和 `POSTGRES_URL` 都未配置
- **AND** 当前是生产运行时
- **THEN** 系统 SHALL 抛出配置错误并拒绝静默使用内存 repo

#### Scenario: 配置了 DB 环境变量
- **WHEN** `DATABASE_URL` 或 `POSTGRES_URL` 已配置
- **THEN** 系统使用 Postgres users repo
- **AND** verify 成功时 SHALL upsert 登录地址并更新 `lastLoginAt`

### Requirement: Protected dashboard placeholder
认证成功后的 `/dashboard` SHALL 渲染一个 Bloomberg Terminal 风格的内部占位页面，而不是 404。

#### Scenario: 已认证用户访问 dashboard
- **WHEN** 用户带有效会话访问 `/dashboard`
- **THEN** 页面显示 `> AUTHENTICATED`
- **AND** 页面展示真实地址、Arc Testnet 链标签、余额、研究引擎状态和空研究列表
- **AND** 页面提供不会跳转到 404 的 `START NEW RESEARCH` 动作
- **AND** 页面提供 `DISCONNECT` 动作触发 logout

#### Scenario: 未认证用户访问 dashboard
- **WHEN** 用户未带有效会话访问 `/dashboard`
- **THEN** middleware SHALL 将请求重定向到 `/login`
