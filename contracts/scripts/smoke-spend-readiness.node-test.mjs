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

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("smoke spend readiness records 13.5 authorization and evidence boundaries", async () => {
  const readiness = await readReadiness();
  const requiredPhrases = [
    "13.5 smoke_usdc_spend readiness",
    "smoke_usdc_spend",
    "独立 test USDC 授权",
    "direct EOA buyer",
    "无 AA/paymaster",
    "approve → createAndFund → activate → settleBatch → close",
    "maxUsdcUnits",
    "nativeDelta18-gas18=budgetUnits6*10^12",
    "六位合约差额",
    "18 位 native/gas",
    "两类 emitter Transfer 去重",
    "buyer、payout、Factory、USDC、Escrow",
    "不能替代 13.5 真实 test USDC smoke",
    "部署授权或配置/角色授权不得替代 test USDC 花费授权",
    "authorization package、handoff、briefing、requestDigest 不是授权记录",
    "用户未回应或模糊同意必须停止",
    "request/commit/address/buyer/payout/gas/maxUsdcUnits 变化必须重新授权",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(readiness.includes(phrase), `smoke spend readiness must include phrase: ${phrase}`);
  }
});

test("smoke spend readiness keeps task 13.5 unchecked until real test USDC smoke exists", async () => {
  const [readiness, tasks] = await Promise.all([readReadiness(), readFile(TASKS_PATH, "utf8")]);

  assert.ok(readiness.includes("13.5 仍 pending"), "readiness must not claim 13.5 complete");
  assert.ok(
    tasks.includes(
      "- [ ] 13.5 经独立 test USDC 授权后，用 direct EOA buyer（无 AA/paymaster）执行 smoke；记录六位合约差额、18 位 native/gas/`*10^12` 公式、两类 emitter Transfer 去重、摘要和退款",
    ),
    "tasks.md must keep 13.5 unchecked",
  );
  assert.doesNotMatch(readiness, /13\.5 已完成|13\.5 complete/i, "readiness must not mark 13.5 complete");
});
