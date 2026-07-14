import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-final-public-verifier-readiness.md",
);
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");
const DIGEST_PATH = resolve(
  ROOT,
  "cache/deployment-candidates/2026-07-13T01-18-06-735Z/final-deployment-manifest-digest.json",
);
const REPORT_PATH = resolve(
  ROOT,
  "cache/deployment-candidates/2026-07-13T01-18-06-735Z/final-public-verifier-report.json",
);

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("final public verifier readiness records completed 13.6 evidence and publication boundaries", async () => {
  const readiness = await readReadiness();
  const requiredPhrases = [
    "13.6 final public RPC verifier readiness",
    "13.6 已通过",
    "独立公开 RPC verifier",
    "仅凭公开 RPC、权威 USDC 配置和 manifest",
    "deployments/5042002.json",
    "final-deployment-manifest.json",
    "final-public-verifier-report.json",
    "final-deployment-manifest-digest.json",
    "2b403150a6564bdf1b754f194de1512a1867e6e3590d5cef54487edac07ddf2d",
    "0x313a284",
    "51618436",
    "verifierStatus：`passed`",
    "3 + R",
    "totalProjectContracts=4",
    "fundedCloneCount",
    "settledCloneCount",
    "smoke_usdc_spend",
    "finalized block",
    "角色 members/count/admin graph",
    "deployer 零权限",
    "source revision/payout/maxUnitPrice",
    "14.2–14.4、14.7–14.9 仍需各自",
    "任一不一致不得发布证据",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(readiness.includes(phrase), `final public verifier readiness must include phrase: ${phrase}`);
  }
});

test("final public verifier readiness keeps task 13.6 checked after public verifier succeeds", async () => {
  const [readiness, tasks, digestRaw, reportRaw] = await Promise.all([
    readReadiness(),
    readFile(TASKS_PATH, "utf8"),
    readFile(DIGEST_PATH, "utf8"),
    readFile(REPORT_PATH, "utf8"),
  ]);
  const digest = JSON.parse(digestRaw);
  const report = JSON.parse(reportRaw);

  assert.ok(
    tasks.includes(
      "- [x] 13.6 独立 verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke；任一不一致不得发布证据",
    ),
    "tasks.md must keep 13.6 checked",
  );
  assert.doesNotMatch(readiness, /13\.6 仍 pending|13\.6 保持未完成/i, "readiness must not keep 13.6 pending");
  assert.equal(digest.manifestDigest, "2b403150a6564bdf1b754f194de1512a1867e6e3590d5cef54487edac07ddf2d");
  assert.equal(digest.blockTag, "0x313a284");
  assert.equal(digest.deploymentTopology.totalProjectContracts, 4);
  assert.equal(digest.deploymentTopology.researchCloneR, 1);
  assert.equal(digest.cloneCounts.funded, 1);
  assert.equal(digest.cloneCounts.settled, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.chainId, 5042002);
  assert.equal(report.blockTag, "0x313a284");
  assert.equal(report.deploymentTopology.totalProjectContracts, 4);
  assert.equal(report.deploymentTopology.settledResearchClones, 1);
});
