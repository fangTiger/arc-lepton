## Context

当前研究历史由 `researchRepo` 抽象读写：本地未配置 DB 时使用内存 `MemoryResearchRepo`，生产配置 `DATABASE_URL` 或 `POSTGRES_URL` 后使用 Postgres `research` 表。报告正文存放在 `research.report_md`，数据源调用流水存放在 `tx_log` 表。详情接口按研究开始/完成时间范围读取同地址的流水，因此清理旧研究时也需要清理足够旧的流水，避免无界增长。

Vercel Cron 通过 `vercel.json` 配置，并以 UTC cron 表达式触发生产部署上的 HTTP GET。官方建议用 `CRON_SECRET`，Vercel 调用时会自动带 `Authorization: Bearer <CRON_SECRET>`，路由必须校验该 header。

## Goals / Non-Goals

**Goals:**

- 每天北京时间 00:00 左右自动清理 10 天以前的研究历史。
- 删除 `startedAt` 早于截止时间的研究报告，并删除 `createdAt` 早于同一截止时间的交易流水。
- 支持 Postgres 和内存 fallback 两种仓储实现，测试可覆盖两者的保留语义。
- 清理入口必须受 `CRON_SECRET` 保护，未授权请求不能删除数据。

**Non-Goals:**

- 不做用户可配置保留天数，先固定 10 天。
- 不提供前端管理界面或手动删除单条历史。
- 不做长期归档导出；过期数据直接删除。

## Decisions

1. **使用 Vercel Cron + App Router route handler**

   方案：新增 `app/api/cron/purge-old-research-history/route.ts`，在 `vercel.json` 中配置 `{"path": "/api/cron/purge-old-research-history", "schedule": "0 16 * * *"}`。由于 Vercel Cron 时区固定 UTC，`0 16 * * *` 对应北京时间每天 00:00。

   备选：在请求时判断本地时区并用 `0 0 * * *`。不采用，因为 Vercel Cron 不支持时区，容易实际变成 UTC 零点。

2. **把清理能力放在仓储接口中**

   方案：给 `ResearchRepo` 增加 `deleteStartedBefore(cutoff: Date)`，给 `TxLogRepo` 增加 `deleteCreatedBefore(cutoff: Date)`。Cron route 只负责鉴权、计算截止时间和调用仓储，不直接写 SQL。

   备选：在 cron route 中直接操作 Drizzle 表。暂不采用，因为会绕过本地 fallback，测试也会更脆。

3. **截止时间按触发时间减 10 天计算**

   方案：每次运行取 `now - 10 * 24h` 作为 cutoff。研究的判断字段是 `startedAt`，流水判断字段是 `createdAt`。重复执行删除同一范围是幂等的。

   备选：按自然日边界删除，例如保留最近 10 个北京时间自然日。暂不采用，需求只说“前 10 天”，按 10 * 24h 简洁且可测试。

4. **返回清理统计**

   方案：route 返回 JSON：`{ ok: true, cutoff, deletedResearches, deletedTxLogs }`。这方便 Vercel Logs 中确认实际删除量。

## Risks / Trade-offs

- [Risk] 删除操作不可恢复。→ 通过固定 10 天 cutoff、单元测试边界、返回统计降低误删风险。
- [Risk] `tx_log` 没有 `research_id`，只能按时间删除。→ 当前详情页也是按研究时间窗匹配流水，因此使用相同时间策略；未来若引入 `research_id` 可改为级联删除。
- [Risk] Hobby 计划 Cron 可能在指定小时内任意时间触发。→ 需求是“每天凌晨”，小时级误差可接受；删除逻辑按运行时刻计算，重复运行幂等。
- [Risk] 未配置 `CRON_SECRET` 会导致清理无法执行。→ route 在缺失 secret 时返回 401，部署说明中要求新增 `CRON_SECRET`。

## Migration Plan

1. 实现仓储删除接口和测试。
2. 新增受保护 cron route 和 route 测试。
3. 新增 `vercel.json` cron 配置。
4. 在 Vercel 项目环境变量中添加 `CRON_SECRET`，至少 16 字符随机值。
5. 部署后在 Vercel Cron Jobs 和 Runtime Logs 中确认每日调用。

Rollback：删除 `vercel.json` 中的 cron 配置并重新部署即可停止自动清理；如需禁用但保留代码，可移除或清空 `CRON_SECRET`，route 会拒绝执行。
