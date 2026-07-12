# Change: Research Daily Quota
## Why
研究创建会触发后台 Agent 和付费 mock 数据源调用，需要在公开演示阶段限制总流量并避免单钱包滥用。
## What Changes
- 增加基于 KV 的 UTC 自然日研究创建配额：单钱包 10 次，全局 100 次。
- `POST /api/research/start` 在创建研究前消费配额，超限返回 429 和清晰错误码。
- 新增登录态 `/api/quota` 给前端展示当前钱包和全局用量。
- `/research`、`/dashboard` 展示每日配额，首页可展示全局今日研究用量。
## Impact
- Affected specs: research-daily-quota
- Affected code: `lib/rate-limit/*`, `app/api/research/start`, `app/api/quota`, `/research`, `/dashboard`, homepage stats
