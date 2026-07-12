# Change: Dev DB fallback and dashboard placeholder

## Why
本地未配置 Postgres 时，登录 verify 会直接触发 `@vercel/postgres` 缺连接串错误，导致开发环境无法跑通认证闭环。登录成功后当前会跳转到尚不存在的 `/dashboard`，用户会看到 404，体感上等同于登录失败。

## What Changes
- 为用户登录持久化新增 `UsersRepo` 抽象，并提供 Postgres 与本地内存两种实现。
- 本地和 Next 生产构建阶段缺少 DB env 时使用内存 users repo，生产运行时缺少 DB env 时直接失败。
- 将 verify 路由的用户 upsert 改为调用 `usersRepo.upsertOnLogin`。
- 新增受 middleware 保护的 `/dashboard` 终端风占位页面，展示账户、研究引擎状态、空研究列表和退出动作。

## Impact
- Affected specs: auth-dev-fallback
- Affected code: lib/db/*, app/api/auth/verify/route.ts, app/api/auth/verify.test.ts, app/dashboard/page.tsx
