import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildPredeployCommitScopeReport,
  runCli,
} from "./predeploy-commit-scope.mjs";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const SOURCE_PATH = resolve(ROOT, "contracts/scripts/predeploy-commit-scope.mjs");

const STATUS_FIXTURE = [
  " M app/api/research/start/route.ts",
  "A  contracts/src/escrow/ResearchEscrow.sol",
  "?? contracts/scripts/predeploy-commit-scope.mjs",
  "?? contracts/test/vectors/eip712-vectors.json",
  " M docs/plans/2026-07-11-onchain-research-escrow-deployment-readiness-audit.md",
  " M docs/contracts/onchain-research-escrow.md",
  " M openspec/changes/onchain-research-escrow/tasks.md",
  " M openspec/specs/research-agent-engine/spec.md",
  " M README.md",
  " M package.json",
  " M vitest.config.ts",
  " M .github/workflows/test.yml",
  " M graphify-out/GRAPH_REPORT.md",
  "?? .devos/tasks/onchain-research-escrow-1-1/progress.md",
  "?? cache/invariant/failures/ResearchEscrowInvariantsTest/invariant_spentNeverExceedsInitialBudget",
  "?? contracts/out/ResearchEscrow.sol/ResearchEscrow.json",
  "?? contracts/cache/solidity-files-cache.json",
  "?? contracts/lib/openzeppelin-contracts/package.json",
  "?? contracts/broadcast/DeployResearchEscrow.s.sol/5042002/run-latest.json",
  "?? .env.local",
  "?? scratch/manual-note.txt",
  " D docs/plans/obsolete.md",
].join("\n");

function byPath(report, path) {
  const entry = report.entries.find((candidate) => candidate.path === path);
  assert.ok(entry, `missing status entry for ${path}`);
  return entry;
}

test("classifies allowed predeploy commit candidates from git status text", () => {
  const report = buildPredeployCommitScopeReport(STATUS_FIXTURE);

  for (const path of [
    "app/api/research/start/route.ts",
    "contracts/src/escrow/ResearchEscrow.sol",
    "contracts/scripts/predeploy-commit-scope.mjs",
    "contracts/test/vectors/eip712-vectors.json",
    "docs/plans/2026-07-11-onchain-research-escrow-deployment-readiness-audit.md",
    "docs/contracts/onchain-research-escrow.md",
    "openspec/changes/onchain-research-escrow/tasks.md",
    "openspec/specs/research-agent-engine/spec.md",
    "README.md",
    "package.json",
    "vitest.config.ts",
    ".github/workflows/test.yml",
    "graphify-out/GRAPH_REPORT.md",
  ]) {
    assert.equal(byPath(report, path).classification, "candidate", `${path} should be candidate`);
  }

  assert.equal(report.summary.candidateCount, 13);
});

test("excludes local workflow, cache, build output, vendored dependency, broadcast and env paths", () => {
  const report = buildPredeployCommitScopeReport(STATUS_FIXTURE);

  for (const [path, reason] of [
    [".devos/tasks/onchain-research-escrow-1-1/progress.md", "local-workflow"],
    [
      "cache/invariant/failures/ResearchEscrowInvariantsTest/invariant_spentNeverExceedsInitialBudget",
      "invariant-failure-cache",
    ],
    ["contracts/out/ResearchEscrow.sol/ResearchEscrow.json", "foundry-output"],
    ["contracts/cache/solidity-files-cache.json", "foundry-cache"],
    ["contracts/lib/openzeppelin-contracts/package.json", "vendored-dependency"],
    ["contracts/broadcast/DeployResearchEscrow.s.sol/5042002/run-latest.json", "broadcast-artifact"],
    [".env.local", "secret-env"],
  ]) {
    const entry = byPath(report, path);
    assert.equal(entry.classification, "excluded", `${path} should be excluded`);
    assert.equal(entry.reason, reason, `${path} should explain exclusion`);
  }

  assert.equal(report.summary.excludedCount, 7);
});

test("keeps unknown paths out of the candidate set and summarizes status codes", () => {
  const report = buildPredeployCommitScopeReport(STATUS_FIXTURE);

  assert.equal(byPath(report, "scratch/manual-note.txt").classification, "unknown");
  assert.equal(byPath(report, "docs/plans/obsolete.md").deleted, true);
  assert.equal(report.summary.unknownCount, 2);
  assert.equal(report.summary.untrackedCount, 10);
  assert.equal(report.summary.stagedCount, 1);
  assert.equal(report.summary.unstagedCount, 11);
  assert.equal(report.summary.deletedCount, 1);
});

test("emits machine-readable safety flags and never grants authorization", () => {
  const report = buildPredeployCommitScopeReport(STATUS_FIXTURE);

  assert.deepEqual(report.safety, {
    noAutoStage: true,
    noAutoCommit: true,
    noSecrets: true,
    notAuthorizationRecord: true,
    notCleanCommitProof: true,
    notPreflightProof: true,
    notDeploymentPermission: true,
  });
});

test("CLI prints JSON from provided status text without executing git", async () => {
  const writes = [];
  const code = await runCli(
    ["node", "predeploy-commit-scope.mjs"],
    {
      stdout: { write: (chunk) => writes.push(chunk) },
      stderr: { write: (chunk) => writes.push(chunk) },
    },
    STATUS_FIXTURE,
  );

  assert.equal(code, 0);
  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.summary.candidateCount, 13);
  assert.equal(parsed.safety.noAutoCommit, true);
});

test("CLI rejects streams wrapper accessors without executing getters", async () => {
  let getterExecuted = false;
  let stderr = "";
  const streams = {
    stderr: { write: (chunk) => { stderr += chunk; } },
  };
  Object.defineProperty(streams, "stdout", {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error("super-secret-stream-getter");
    },
  });

  const code = await runCli(
    ["node", "predeploy-commit-scope.mjs"],
    streams,
    STATUS_FIXTURE,
  );

  assert.equal(code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
});

test("implementation is pure local parser and contains no shell, git, env, network or secret reads", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");

  for (const forbidden of [
    "child_process",
    "exec(",
    "spawn(",
    "git status",
    "process.env",
    ".env.local",
    "readFile",
    "fetch(",
    "http://",
    "https://",
  ]) {
    assert.equal(source.includes(forbidden), false, `source must not include ${forbidden}`);
  }
});
