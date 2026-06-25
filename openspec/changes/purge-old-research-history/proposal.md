# Change: Purge Old Research History

## Why

研究报告和调用流水如果无限保留，会让演示环境数据库持续增长，也会把过期钱包历史暴露在产品界面里。需要一个自动保留策略，按天清理 10 天以前的历史记录。

## What Changes

- 增加研究历史保留能力：每天凌晨自动删除 10 天以前的研究报告。
- 清理任务同时删除对应时间范围内的研究报告和关联交易流水，避免孤儿流水继续出现在详情页。
- 增加一个内部清理 API，供 Vercel Cron 调用；非授权请求不能触发清理。
- 在无数据库的本地 fallback 中提供同等清理语义，方便测试和本地演示。

## Capabilities

### New Capabilities

- `research-history-retention`: 定义研究历史按 10 天保留、每日自动清理和手动触发保护的行为。

### Modified Capabilities

- 无。

## Impact

- Affected specs: `research-history-retention`
- Affected code: `lib/db/research-repo*`, `lib/db/tx-log-repo*`, `app/api/cron/*`, `vercel.json`, tests
- Affected systems: Vercel Cron、Postgres research/tx_log 数据、开发环境内存 fallback
