import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-smoke-spend-readiness.md",
);
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");
const SUMMARY_PATH = resolve(
  ROOT,
  "cache/deployment-candidates/2026-07-13T01-18-06-735Z/smoke-stage-broadcast-summary.json",
);
const VERIFICATION_PATH = resolve(
  ROOT,
  "cache/deployment-candidates/2026-07-13T01-18-06-735Z/smoke-stage-verification.json",
);

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("smoke spend readiness records completed 13.5 authorization and evidence", async () => {
  const readiness = await readReadiness();
  const requiredPhrases = [
    "13.5 smoke_usdc_spend readiness",
    "13.5 已完成",
    "smoke_usdc_spend",
    "独立 test USDC 授权",
    "sha256:2e16a8bab60e776a8ae04f7509878143950418f1429e66c8587bb60df8962553",
    "direct EOA buyer",
    "无 AA/paymaster",
    "approve → createAndFund → activate → settleBatch → close",
    "maxUsdcUnits",
    "smoke-stage-broadcast-summary.json",
    "smoke-stage-verification.json",
    "0x00457075A5989Da633410B1F7A92851313177A85",
    "spent：`100`",
    "budgetRefund：`900`",
    "escrow USDC：`0`",
    "payout received：`100`",
    "nativeDelta18-gas18=budgetUnits6*10^12",
    "六位合约差额",
    "18 位 native/gas",
    "两类 emitter Transfer 去重",
    "buyer/payout/Factory/USDC/Escrow",
    "authorization package、handoff、briefing、requestDigest 不是授权记录",
    "request/commit/address/buyer/payout/gas/maxUsdcUnits 变化必须重新授权",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(readiness.includes(phrase), `smoke spend readiness must include phrase: ${phrase}`);
  }
});

test("smoke spend readiness keeps task 13.5 checked after verified smoke", async () => {
  const [readiness, tasks, summaryRaw, verificationRaw] = await Promise.all([
    readReadiness(),
    readFile(TASKS_PATH, "utf8"),
    readFile(SUMMARY_PATH, "utf8"),
    readFile(VERIFICATION_PATH, "utf8"),
  ]);
  const summary = JSON.parse(summaryRaw);
  const verification = JSON.parse(verificationRaw);

  assert.ok(
    tasks.includes(
      "- [x] 13.5 经独立 test USDC 授权后，用 direct EOA buyer（无 AA/paymaster）执行 smoke；记录六位合约差额、18 位 native/gas/`*10^12` 公式、两类 emitter Transfer 去重、摘要和退款",
    ),
    "tasks.md must keep 13.5 checked",
  );
  assert.doesNotMatch(readiness, /13\.5 仍 pending|13\.5 保持未完成/i, "readiness must not keep 13.5 pending");
  assert.equal(summary.escrow, "0x00457075A5989Da633410B1F7A92851313177A85");
  assert.equal(summary.checks.allReceiptsSucceeded, true);
  assert.equal(summary.checks.escrowClosed, true);
  assert.equal(summary.checks.spentMatches, true);
  assert.equal(summary.checks.refundMatches, true);
  assert.equal(summary.checks.payoutIncreasedBySettlement, true);
  assert.deepEqual(verification.failed, []);
  assert.equal(verification.escrow, "0x00457075A5989Da633410B1F7A92851313177A85");
  assert.equal(verification.checks.escrowClosed, true);
  assert.equal(verification.checks.spentMatches, true);
  assert.equal(verification.checks.refundMatches, true);
  assert.equal(verification.checks.escrowEmpty, true);
  assert.equal(verification.checks.payoutReceivedSettlement, true);
  assert.equal(verification.checks.rolesMatch, true);
});
