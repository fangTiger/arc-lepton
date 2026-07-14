import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-graphify-final-evidence-readiness.md",
);
const GRAPH_REPORT_PATH = resolve(ROOT, "graphify-out/GRAPH_REPORT.md");
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

function currentGraphSummary(graphReport) {
  const match = graphReport.match(/- (?<nodes>\d+) nodes · (?<edges>\d+) edges · (?<communities>\d+) communities detected/);
  assert.ok(match?.groups, "graph report must include the summary line");
  return match.groups;
}

test("graphify readiness documents local 14.8 scope and graph report evidence", async () => {
  const readiness = await readReadiness();
  const graphReport = await readFile(GRAPH_REPORT_PATH, "utf8");
  const { nodes, edges, communities } = currentGraphSummary(graphReport);

  for (const phrase of [
    "14.8 本地完成记录",
    "14.8 已完成",
    "graphify-out/GRAPH_REPORT.md",
    `${nodes} nodes`,
    `${edges} edges`,
    `${communities} communities detected`,
    "降级阅读报告",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }

  assert.ok(graphReport.includes(`${nodes} nodes`), "graph report must document current node count");
  assert.ok(graphReport.includes(`${edges} edges`), "graph report must document current edge count");
});

test("graphify readiness documents impact graph scope", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "deployment manifest",
    "verifier",
    "smoke",
    "preflight",
    "authorization",
    "README",
    "docs/contracts",
    "contracts/scripts",
    "openspec tasks",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("graphify readiness includes authorization package and handoff safety scope", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "deployment-authorization-package.mjs",
    "deployment-authorization-handoff.md",
    "machine-readable safety flags",
    "safety.broadcastAllowed = false",
    "safety.authorizedStages = []",
    "notAuthorizationRecord",
    "notPreflightProof",
    "notFinalManifestOrVerifierEvidence",
    "noResponseOrAmbiguousApprovalStops",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("graphify readiness records final address commit and source verification closure", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "最终地址",
    "最终 commit",
    "chainId 5042002",
    "tx hash",
    "block",
    "runtime/code hash",
    "sourceVerification",
    "不得使用 placeholder",
    "不得 --broadcast",
    "Explorer source/ABI exact-match",
    "role grant/revoke",
    "test USDC",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("graphify readiness marks task 14.8 complete without exposing secrets", async () => {
  const readiness = await readReadiness();
  const tasks = await readFile(TASKS_PATH, "utf8");

  assert.match(tasks, /- \[x\] 14\.8 /, "14.8 must be checked");

  for (const forbidden of [
    /sk-[A-Za-z0-9_-]{20,}/,
    /0x[a-fA-F0-9]{64}/,
    /https?:\/\/[^/\s:@]+:[^/\s@]+@/,
  ]) {
    assert.doesNotMatch(readiness, forbidden, `readiness must not contain ${forbidden}`);
  }
});
