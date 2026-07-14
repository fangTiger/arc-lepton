import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-source-role-readiness.md",
);
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("source role readiness records 13.4 authorization and evidence boundaries", async () => {
  const readiness = await readReadiness();
  const requiredPhrases = [
    "13.4 source/roles/exact-match readiness",
    "configure_sources_and_roles",
    "Explorer exact-match source/ABI",
    "一次性 bindFactory",
    "Registry/Factory 双向 wiring",
    "五个 source",
    "grant/revoke",
    "deployer 撤权",
    "finalized block",
    "部署授权不得替代配置/角色移交授权",
    "authorization package、handoff、briefing、requestDigest 不是授权记录",
    "source-role-readiness-report.mjs",
    "readyToRequestConfigureAuthorization=true",
    "readyToExecuteExternalWrites=false",
    "sourceVerifyAllowed=false",
    "roleChangeAllowed=false",
    "taskCompleteAllowed=false",
    "候选 manifest 或本地 readiness 不得替代 13.4 真实执行证据",
    "deployments/5042002.json.sourceVerification",
    "sha256:f575600e834861c57a53d0c3394ed741732e0e4b43575904a3848c17ad68d39f",
    "sourceCodePresent/abiPresent/isFullyVerified/url",
    "用户未回应或模糊同意必须停止",
    "request/commit/address/source/role/gas 变化必须重新授权",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(readiness.includes(phrase), `source/role readiness must include phrase: ${phrase}`);
  }
});

test("source role readiness marks 13.4 complete after Explorer exact-match evidence exists", async () => {
  const [readiness, tasks] = await Promise.all([readReadiness(), readFile(TASKS_PATH, "utf8")]);

  assert.ok(readiness.includes("13.4 已完成"), "readiness must claim 13.4 complete");
  assert.ok(
    tasks.includes(
      "- [x] 13.4 对三个核心合约完成 exact-match source/ABI 验证，先一次性 bindFactory 并读回双向 wiring，再登记五个 source、完成角色移交/deployer撤权并从 finalized block 复核",
    ),
    "tasks.md must check 13.4",
  );
  assert.doesNotMatch(readiness, /Explorer exact-match source\/ABI 尚未完成/, "readiness must not keep old exact-match blocker");
});
