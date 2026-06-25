## 1. Repository Retention

- [ ] 1.1 Add failing tests for memory research and tx_log repositories deleting records older than a cutoff while retaining boundary/newer records.
- [ ] 1.2 Extend `ResearchRepo` and `TxLogRepo` interfaces with cutoff deletion methods.
- [ ] 1.3 Implement memory repository deletion methods and keep existing list/count behavior correct.
- [ ] 1.4 Implement Postgres repository deletion methods using Drizzle `delete(...).where(lt(...))` and return deleted counts.

## 2. Cron Endpoint

- [ ] 2.1 Add failing route tests for unauthorized requests, valid `CRON_SECRET`, cutoff calculation, and returned delete counts.
- [ ] 2.2 Implement `/api/cron/purge-old-research-history` with `Authorization: Bearer <CRON_SECRET>` verification.
- [ ] 2.3 Add `vercel.json` cron config for `/api/cron/purge-old-research-history` at `0 16 * * *`.

## 3. Verification

- [ ] 3.1 Run focused repository and cron route tests.
- [ ] 3.2 Run full `pnpm typecheck`, `pnpm exec vitest run`, and `pnpm build`.
- [ ] 3.3 Update task statuses and confirm implementation matches `research-history-retention` spec scenarios.
