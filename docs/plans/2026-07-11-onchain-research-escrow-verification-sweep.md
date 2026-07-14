# On-chain research escrow 本地验证记录

日期：2026-07-11

范围：OpenSpec `onchain-research-escrow` 任务 14.6 的本地验证矩阵。所有命令均为本地执行；未部署、未广播、未读取私钥、未花费 test USDC。

## 合约验证

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run contracts:tooling:test` | 通过，486/486 | 覆盖授权门禁、preflight gate、部署证据、文档门禁、manifest、verifier 与 tooling 配置；最新本地复核已包含 deployment authorization handoff placeholder boundary、deployment authorization handoff machine-readable safety flags、deployment authorization briefing JSON-like input hygiene、deployment authorization exact reply template、deployment evidence package JSON-like input hygiene、deployment evidence approval marker hygiene、deployment manifest JSON-like input hygiene、deployment authorization gate JSON-like input hygiene、deployment authorization record field hygiene、deployment authorization package JSON-like input hygiene、deployment authorization package exact replies、graphify final evidence authorization safety scope、authorization package misuse safety、deployment readiness authorization package handoff non-authorization safety、deployment readiness predeploy commit staging hazards、predeploy commit scope candidate/exclusion gate、predeploy stoplight deployment blocked gate、predeploy stoplight JSON-like input hygiene、deployment next action checklist authorization boundary、deployment next action checklist exact reply、deployment next action checklist secret hygiene、deployment authorization input gap report、deployment authorization request draft exact schema/secret boundary、deployment write plan freeze local-only digest boundary、deployment write plan freeze null-prototype input hygiene、deployment gate/tooling null-prototype input hygiene、remaining task evidence matrix authority boundary、source role readiness authorization boundary、source role readiness report、smoke spend readiness authorization boundary、smoke evidence verifier JSON-like input hygiene、RPC verifier envelope input hygiene、local smoke runner input/harness getter hygiene、artifact consistency wrapper input getter hygiene、Slither wrapper input getter hygiene、deployment/predeploy CLI streams wrapper input getter hygiene、CLI stream helper wrapper shape hygiene、final evidence publication gate、final public verifier readiness publication boundary、rollout authorization package handoff non-authorization safety、rollback authorization package handoff non-authorization safety 与 rollback drill final public verifier gate、rollback live execution runbook。 |
| `npm run contracts:fmt` | 通过 | `forge fmt --check`。 |
| `npm run contracts:build` | 通过 | Foundry 尝试写 `~/.foundry/cache/signatures` 被沙箱拒绝，但退出码为 0；输出若干 `asm-keccak256` note。 |
| `npm run contracts:test:unit` | 通过，167/167 | Foundry unit profile。 |
| `npm run contracts:test:fuzz` | 通过，4/4 | Fuzz profile，1024 runs。 |
| `npm run contracts:test:invariant` | 通过，6/6 | Invariant profile，256 runs；旧 invariant failure cache 因 bytecode 变化被忽略，当前退出码为 0。 |
| `npm run contracts:coverage` | 通过 | Total Lines 92.48%、Statements 94.21%、Branches 77.53%、Funcs 96.07%。 |
| `npm run contracts:artifacts:check` | 通过 | artifact digest `527968e38b07ad1d0a1d5587af061c460576cea59fd9137420fefc67601ee8b4`；build-info sha256 `47239bdab1916831b0ed6a1aaaa6a122f1d9659b39142e6a3956528e69957c81`。 |
| `VIRTUAL_ENV=.venv PATH=.venv/bin:$PATH npm run contracts:slither` | 通过 | 初次 `npm run contracts:slither` 因 PATH 无 `slither` 失败；使用项目 `.venv` 后检测到 Slither `0.11.5` 并通过。Slither 报 13 个非阻断 findings：calls-loop、timestamp、cyclomatic-complexity、low-level-calls、naming-convention。 |

## Web / 后端验证

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | `tsc --noEmit`。 |
| `npm test -- --run` | 通过，76 files / 485 tests | Vitest。 |
| `npm run build` | 通过 | Next.js build 成功；字体下载失败被跳过；MetaMask/WalletConnect optional dependency warning；构建阶段使用内存 repo/KV fallback。 |

## 迁移 dry-run

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `node scripts/db-migrate.mjs --dry-run` | 通过 | 只打印 expand/backfill up SQL；不连接数据库。 |
| `node scripts/db-migrate.mjs --down --dry-run` | 通过 | 只打印手动 downgrade 保留说明；不连接数据库。 |

## OpenSpec 与 Graphify

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `openspec validate onchain-research-escrow --strict --no-interactive` | 通过 | Change valid。 |
| `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` | 通过 | 最新 `GRAPH_REPORT.md` 摘要：1307 nodes、2754 edges、47 communities detected。 |

## 最新本地复核

- `npm run contracts:tooling:test` 486/486：本轮继续推进后复跑通过，新增覆盖 deployment authorization handoff placeholder boundary、deployment authorization handoff machine-readable safety flags、deployment authorization briefing JSON-like input hygiene、deployment authorization exact reply template、deployment evidence package JSON-like input hygiene、deployment evidence approval marker hygiene、deployment manifest JSON-like input hygiene、deployment authorization gate JSON-like input hygiene、deployment authorization record field hygiene、deployment authorization package JSON-like input hygiene、deployment authorization package exact replies、graphify final evidence authorization safety scope、authorization package misuse safety、deployment readiness authorization package handoff non-authorization safety、deployment readiness predeploy commit staging hazards、predeploy commit scope candidate/exclusion gate、predeploy stoplight deployment blocked gate、predeploy stoplight JSON-like input hygiene、deployment next action checklist authorization boundary、deployment next action checklist exact reply、deployment next action checklist secret hygiene、deployment authorization input gap report、deployment authorization request draft exact schema/secret boundary、deployment write plan freeze local-only digest boundary、deployment write plan freeze null-prototype input hygiene、deployment gate/tooling null-prototype input hygiene、remaining task evidence matrix authority boundary、source role readiness authorization boundary、source role readiness report、smoke spend readiness authorization boundary、smoke evidence verifier JSON-like input hygiene、RPC verifier envelope input hygiene、local smoke runner input/harness getter hygiene、artifact consistency wrapper input getter hygiene、Slither wrapper input getter hygiene、deployment/predeploy CLI streams wrapper input getter hygiene、CLI stream helper wrapper shape hygiene、final evidence publication gate、final public verifier readiness publication boundary、rollout authorization package handoff non-authorization safety、rollback authorization package handoff non-authorization safety 与 rollback drill final public verifier gate、rollback live execution runbook，确认 `evidence-package.json` 只作为公开 evidence package 路径示例，不替代 13.1 授权记录、13.2 preflight 通过证明、13.2 前 clean commit 候选范围的人工确认、13.4 source/roles/exact-match 真实执行证据、13.5 真实 test USDC smoke、13.6 final public verifier、最终 manifest/verifier 公开部署证据、14.2–14.4 真实 rollout/E2E 或 14.9 live rollback 证据；authorization package、handoff 文档、briefing、deployment evidence package、authorization gate、requestDigest、authorization request draft、deployment write plan freeze、predeploy commit scope report、predeploy stoplight report、deployment next action checklist、deployment authorization input gap report、remaining task evidence matrix authority boundary、13.5 smoke_usdc_spend readiness、13.6 final public RPC verifier readiness、14.8 Graphify/final evidence readiness 与 final evidence publication gate 的机器可读/文档 `safety` 边界也明确 package/briefing/evidence-package/gate/requestDigest/report/checklist/matrix/input-gap-report/request-draft/write-plan-freeze/final-publication-gate 不是授权记录，不能跨阶段复用，不能替代真实回滚授权，用户未回应或模糊同意必须停止，request/commit/address/buyer/payout/source/role/gas/maxUsdcUnits 变化必须重新授权。

## 未覆盖边界

- 本记录不替代 13.4 Explorer exact-match/source 任务关闭，也不替代 14.2–14.4 的生产 DB/worker 切流、真实成功/失败 E2E，或 14.9 live rollback 证据。13.1–13.3 的授权/preflight/deployment 证据、13.5 smoke 与 13.6 public verifier 的公开证据已另存。
- 本记录不替代 14.2–14.4 的真实 rollout、成功 E2E、失败 E2E，也不替代 14.9 rollback live 演练；14.5 本地回归矩阵由专门文档记录。
- `pnpm --version` 在当前 workspace 输出 `packages field missing or empty`，因此本轮 Web/后端验证使用 `npm run`。
