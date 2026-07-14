import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const ROLLBACK_DRILL_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-rollback-drill.md",
);

async function readRollbackDrill() {
  return readFile(ROLLBACK_DRILL_PATH, "utf8");
}

test("rollback drill records the current OpenSpec progress", async () => {
  const drill = await readRollbackDrill();

  assert.ok(drill.includes("100/107 tasks"), "rollback drill must mention 100/107 tasks");
  assert.doesNotMatch(drill, /9[3-7]\/107 tasks/, "rollback drill must not mention stale 93-97/107 progress");
});

test("rollback drill keeps 14.5 local regression separate from remaining live blockers", async () => {
  const drill = await readRollbackDrill();

  assert.ok(drill.includes("14.2–14.4"), "rollback drill must leave real rollout/E2E blockers at 14.2–14.4");
  assert.ok(
    drill.includes("14.5 已有本地回归证据"),
    "rollback drill must document that 14.5 has local regression evidence",
  );
  assert.ok(
    drill.includes("不替代真实 rollout/E2E/rollback"),
    "rollback drill must keep local 14.5 evidence from replacing real rollout/E2E/rollback evidence",
  );
  assert.doesNotMatch(
    drill,
    /14\.3–14\.5：成功 E2E、失败 E2E、direct `\/api\/data\/\*` mock\/arc \+ calldata rollback \+ mock\/history\/follow-up\/stats\/quota\/list 全量回归/,
    "rollback drill must not list 14.5 as an unfinished blocker",
  );
});

test("rollback drill requires final public verifier evidence before 14.9 live evidence", async () => {
  const drill = await readRollbackDrill();

  assert.ok(
    drill.includes("13.6 独立公开 RPC verifier"),
    "rollback drill must require the 13.6 independent public RPC verifier before live rollback",
  );
  assert.ok(
    drill.includes("最终 deployments/5042002.json manifest"),
    "rollback drill must require the final deployments/5042002.json manifest before live rollback",
  );
  assert.ok(
    drill.includes("候选 manifest、本地模拟 verifier、mock evidence、14.5 本地回归证据都不能替代 14.9 live rollback 证据"),
    "rollback drill must forbid substituting candidate/local/mock/14.5 evidence for 14.9 live rollback evidence",
  );
  assert.ok(
    drill.includes("本报告未执行部署或广播"),
    "rollback drill must explicitly record that this local report did not deploy or broadcast",
  );
});

test("rollback drill treats authorization package and handoff as non-authorization safety material", async () => {
  const drill = await readRollbackDrill();
  const requiredPhrases = [
    "deployment-authorization-package.mjs",
    "deployment-authorization-handoff.md",
    "deployment-authorization-briefing.mjs",
    "briefing",
    "requestDigest",
    "不能替代 13.1 授权记录",
    "不能替代 13.6 final public verifier",
    "不能替代最终 manifest/verifier",
    "不能替代 14.9 live rollback",
    "不能替代真实回滚授权",
    "用户未回应或模糊同意必须停止",
    "request/commit/address/gas/maxUsdcUnits 变化必须重新授权",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(drill.includes(phrase), `rollback drill must include authorization safety phrase: ${phrase}`);
  }
});

test("rollback drill includes a live rollback execution runbook before real environment use", async () => {
  const drill = await readRollbackDrill();
  const requiredPhrases = [
    "## 真实回滚执行 Runbook",
    "停止新 voucher",
    "关闭 funding UI",
    "prepare 不再签发 FundingVoucher",
    "拒绝新的 activation/start",
    "不得停止既有 worker drain",
    "切回 calldata/mock",
    "ARC_RESEARCH_SETTLEMENT_BACKEND=calldata",
    "worker auth",
    "durable DB",
    "Cron/queue",
    "RPC/outbox SLA",
    "Funded 样本",
    "cancelUnactivated",
    "quota release",
    "Active 样本",
    "SETTLE/RECONCILE/CLOSE",
    "refundExpired",
    "manual recovery",
    "操作者",
    "原因",
    "evidence digest",
    "不能伪造 closed",
    "不替代真实 14.9 live rollback 证据",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(drill.includes(phrase), `rollback runbook must include phrase: ${phrase}`);
  }
});
