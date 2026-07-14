import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const AUDIT_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-spec-scenario-audit.md",
);
const GRAPH_REPORT_PATH = resolve(ROOT, "graphify-out/GRAPH_REPORT.md");
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");
const VERIFICATION_SWEEP_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-verification-sweep.md",
);

async function readAudit() {
  return readFile(AUDIT_PATH, "utf8");
}

async function readVerificationSweep() {
  return readFile(VERIFICATION_SWEEP_PATH, "utf8");
}

function currentGraphSummary(graphReport) {
  const match = graphReport.match(/- (?<nodes>\d+) nodes · (?<edges>\d+) edges · (?<communities>\d+) communities detected/);
  assert.ok(match?.groups, "graph report must include the summary line");
  return match.groups;
}

test("spec scenario audit records current progress and keeps 14.7 incomplete", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "100/107 tasks",
    "不建议勾选 14.7",
    "14.7 仍未完成",
    "13.4、14.2–14.4、14.7–14.9",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("spec scenario audit includes the latest readiness evidence paths", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "docs/plans/2026-07-11-onchain-research-escrow-deployment-readiness-audit.md",
    "contracts/scripts/deployment-readiness-audit.node-test.mjs",
    "docs/plans/2026-07-11-onchain-research-escrow-rollout-e2e-readiness.md",
    "contracts/scripts/rollout-e2e-readiness.node-test.mjs",
      "docs/plans/2026-07-11-onchain-research-escrow-graphify-final-evidence-readiness.md",
      "contracts/scripts/graphify-final-evidence-readiness.node-test.mjs",
      "docs/plans/2026-07-11-onchain-research-escrow-final-public-verifier-readiness.md",
      "contracts/scripts/final-public-verifier-readiness.node-test.mjs",
      "13.5 test USDC smoke completion",
      "13.6 final public RPC verifier completion",
      "manifestDigest 为 `2b403150a6564bdf1b754f194de1512a1867e6e3590d5cef54487edac07ddf2d`",
      "verifierStatus 为 `passed`",
      "node --test contracts/scripts/deployment-readiness-audit.node-test.mjs contracts/scripts/rollout-e2e-readiness.node-test.mjs contracts/scripts/graphify-final-evidence-readiness.node-test.mjs",
      "12/12 pass",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("spec scenario audit graphify summary matches the current graph report", async () => {
  const audit = await readAudit();
  const graphReport = await readFile(GRAPH_REPORT_PATH, "utf8");
  const { nodes, edges, communities } = currentGraphSummary(graphReport);

  assert.ok(graphReport.includes(`${nodes} nodes`), "graph report must include current node count");
  assert.ok(graphReport.includes(`${edges} edges`), "graph report must include current edge count");
  assert.ok(graphReport.includes(`${communities} communities detected`), "graph report must include current community count");
  assert.ok(audit.includes(`${nodes} nodes`), "audit must include current node count");
  assert.ok(audit.includes(`${edges} edges`), "audit must include current edge count");
  assert.ok(audit.includes(`${communities} communities detected`), "audit must include current community count");
});

test("spec scenario audit keeps 14.8 blocked while recognizing the local Graphify rebuild", async () => {
  const audit = await readAudit();

  assert.ok(
    !audit.includes("未在最终代码修改后重建 Graphify"),
    "audit must not say Graphify has not been rebuilt after final code changes",
  );

  for (const phrase of [
    "14.8：当前本地 Graphify 已重建",
    "最终地址",
    "最终 commit",
    "manifest",
    "verifier",
    "14.8 仍未完成",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("spec scenario audit and verification sweep include the latest contracts tooling recheck", async () => {
  const audit = await readAudit();
  const verificationSweep = await readVerificationSweep();

  for (const [label, text] of [
    ["audit", audit],
    ["verification sweep", verificationSweep],
  ]) {
    for (const phrase of [
      "最新本地复核",
      "`npm run contracts:tooling:test` 486/486",
      "deployment authorization handoff placeholder boundary",
      "deployment authorization handoff machine-readable safety flags",
      "deployment authorization briefing JSON-like input hygiene",
      "deployment authorization exact reply template",
      "deployment evidence package JSON-like input hygiene",
      "deployment evidence approval marker hygiene",
      "deployment manifest JSON-like input hygiene",
      "deployment authorization gate JSON-like input hygiene",
      "deployment authorization record field hygiene",
      "deployment authorization package JSON-like input hygiene",
      "deployment authorization package exact replies",
      "graphify final evidence authorization safety scope",
      "authorization package misuse safety",
      "deployment readiness authorization package handoff non-authorization safety",
      "deployment readiness predeploy commit staging hazards",
      "predeploy commit scope candidate/exclusion gate",
      "predeploy stoplight deployment blocked gate",
      "predeploy stoplight JSON-like input hygiene",
      "deployment next action checklist authorization boundary、deployment next action checklist exact reply、deployment next action checklist secret hygiene",
      "deployment authorization input gap report",
      "deployment authorization request draft exact schema/secret boundary",
      "deployment write plan freeze local-only digest boundary",
      "deployment gate/tooling null-prototype input hygiene",
      "remaining task evidence matrix authority boundary",
      "source role readiness authorization boundary、source role readiness report",
      "smoke spend readiness authorization boundary",
      "smoke evidence verifier JSON-like input hygiene",
      "RPC verifier envelope input hygiene",
      "local smoke runner input/harness getter hygiene",
      "artifact consistency wrapper input getter hygiene",
      "Slither wrapper input getter hygiene",
      "deployment/predeploy CLI streams wrapper input getter hygiene",
      "CLI stream helper wrapper shape hygiene",
      "final evidence publication gate",
      "final public verifier readiness publication boundary",
      "rollout authorization package handoff non-authorization safety",
      "rollback authorization package handoff non-authorization safety",
      "rollback drill final public verifier gate、rollback live execution runbook",
    ]) {
      assert.ok(text.includes(phrase), `${label} must mention ${phrase}`);
    }
  }
});

test("remaining external/live tasks are still unchecked", async () => {
  const tasks = await readFile(TASKS_PATH, "utf8");

  for (const taskId of [
    "13.4",
    "14.2",
    "14.3",
    "14.4",
    "14.7",
    "14.8",
    "14.9",
  ]) {
    assert.match(
      tasks,
      new RegExp(`- \\[ \\] ${taskId.replace(".", "\\.")} `),
      `${taskId} must remain unchecked`,
    );
  }

  for (const taskId of ["13.1", "13.2", "13.3", "13.5", "13.6"]) {
    assert.match(
      tasks,
      new RegExp(`- \\[x\\] ${taskId.replace(".", "\\.")} `),
      `${taskId} must be checked`,
    );
  }
});

test("spec scenario audit does not contain obvious secret-shaped material", async () => {
  const audit = await readAudit();

  for (const forbidden of [
    /sk-[A-Za-z0-9_-]{20,}/,
    /https?:\/\/[^/\s:@]+:[^/\s@]+@/,
    /\b(?:private[_-]?key|mnemonic|credentialed[_-]?rpc)\s*[:=]\s*['"][^'"]+['"]/i,
  ]) {
    assert.doesNotMatch(audit, forbidden, `audit must not contain ${forbidden}`);
  }
});
