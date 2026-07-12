import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  PredeployStoplightError,
  buildPredeployStoplightReport,
  runCli,
} from "./predeploy-stoplight.mjs";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const SOURCE_PATH = resolve(ROOT, "contracts/scripts/predeploy-stoplight.mjs");

const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);

function validInput(overrides = {}) {
  return {
    openspec: {
      change: "onchain-research-escrow",
      totalTasks: 107,
      completeTasks: 95,
      remainingTasks: [
        "13.1 deploy_core_contracts authorization",
        "13.2 authorization-gated preflight",
        "13.3 core deployment broadcast",
        "13.6 final public verifier",
        "14.2 rollout",
        "14.9 rollback drill",
      ],
    },
    commitScope: {
      summary: {
        candidateCount: 13,
        excludedCount: 2,
        unknownCount: 1,
        stagedCount: 0,
        unstagedCount: 14,
        untrackedCount: 9,
        deletedCount: 1,
      },
      safety: {
        noAutoStage: true,
        noAutoCommit: true,
        noSecrets: true,
        notAuthorizationRecord: true,
        notCleanCommitProof: true,
        notPreflightProof: true,
        notDeploymentPermission: true,
      },
    },
    graphify: {
      source: "graphify-out/GRAPH_REPORT.md",
      nodes: 786,
      edges: 1568,
      communities: 34,
    },
    authorization: {
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      authorizationPackageDigest: `sha256:${"c".repeat(64)}`,
      ambiguousApproval: "",
      explicitAuthorization: null,
    },
    preflight: {
      cleanCommit: false,
      proofDigest: null,
    },
    finalEvidence: {
      manifest: false,
      publicVerifier: false,
      finalAddresses: false,
    },
    liveEvidence: {
      rollout: false,
      successE2E: false,
      failureE2E: false,
      rollback: false,
    },
    ...overrides,
  };
}

function expectStoplightError(fn, code, path) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof PredeployStoplightError);
      assert.equal(error.name, "PredeployStoplightError");
      assert.equal(error.code, code);
      assert.equal(error.path, path);
      return true;
    },
  );
}

test("blocks deployment when OpenSpec, commit scope, authorization and preflight are not ready", () => {
  const report = buildPredeployStoplightReport(validInput());

  assert.equal(report.readyToDeploy, false);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.goalCompleteAllowed, false);
  assert.deepEqual(report.safety, {
    noBroadcast: true,
    noDeploy: true,
    noAutoStage: true,
    noAutoCommit: true,
    noSecrets: true,
    notAuthorizationRecord: true,
    notPreflightProof: true,
    notFinalManifestOrVerifierEvidence: true,
    notLiveE2EOrRollbackEvidence: true,
  });

  for (const code of [
    "OPENSPEC_REMAINING_TASKS",
    "COMMIT_SCOPE_UNKNOWN",
    "COMMIT_SCOPE_EXCLUDED",
    "DEPLOY_AUTHORIZATION_MISSING",
    "CLEAN_COMMIT_MISSING",
    "PREFLIGHT_PROOF_MISSING",
    "FINAL_MANIFEST_MISSING",
    "FINAL_VERIFIER_MISSING",
    "LIVE_ROLLOUT_MISSING",
    "LIVE_E2E_MISSING",
    "ROLLBACK_EVIDENCE_MISSING",
  ]) {
    assert.ok(
      report.blockingReasons.some((reason) => reason.code === code),
      `report must include ${code}`,
    );
  }
});

test("authorization package and request digest are never treated as user approval", () => {
  const report = buildPredeployStoplightReport(validInput({
    authorization: {
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      authorizationPackageDigest: `sha256:${"d".repeat(64)}`,
      ambiguousApproval: "sounds good",
      explicitAuthorization: null,
    },
  }));

  assert.equal(report.authorization.status, "missing_explicit_authorization");
  assert.equal(report.authorization.requestDigest, DIGEST);
  assert.equal(report.authorization.authorizationPackageIsApproval, false);
  assert.equal(report.safety.notAuthorizationRecord, true);
  assert.ok(
    report.blockingReasons.some((reason) => reason.code === "AMBIGUOUS_APPROVAL"),
    "ambiguous approval must remain blocked",
  );
});

test("a matching explicit authorization still cannot override dirty commit or missing preflight", () => {
  const report = buildPredeployStoplightReport(validInput({
    authorization: {
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      authorizationPackageDigest: null,
      ambiguousApproval: "",
      explicitAuthorization: {
        approved: true,
        stage: "deploy_core_contracts",
        chainId: 5042002,
        commit: COMMIT,
        requestDigest: DIGEST,
        approvedAt: "2026-07-11T00:00:00Z",
      },
    },
  }));

  assert.equal(report.authorization.status, "explicit_authorization_matched");
  assert.equal(report.readyToDeploy, false);
  assert.equal(report.broadcastAllowed, false);
  assert.ok(!report.blockingReasons.some((reason) => reason.code === "DEPLOY_AUTHORIZATION_MISSING"));
  assert.ok(report.blockingReasons.some((reason) => reason.code === "CLEAN_COMMIT_MISSING"));
  assert.ok(report.blockingReasons.some((reason) => reason.code === "PREFLIGHT_PROOF_MISSING"));
});

test("Graphify summary is recorded but cannot become final manifest or verifier evidence", () => {
  const report = buildPredeployStoplightReport(validInput());

  assert.deepEqual(report.graphify, {
    source: "graphify-out/GRAPH_REPORT.md",
    nodes: 786,
    edges: 1568,
    communities: 34,
    notFinalEvidence: true,
  });
  assert.ok(report.blockingReasons.some((reason) => reason.code === "FINAL_MANIFEST_MISSING"));
  assert.ok(report.blockingReasons.some((reason) => reason.code === "FINAL_VERIFIER_MISSING"));
});

test("rejects public stoplight accessors without executing getters", () => {
  const input = validInput();
  const openspec = input.openspec;
  let getterExecuted = false;
  Object.defineProperty(input, "openspec", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return openspec;
    },
  });

  expectStoplightError(
    () => buildPredeployStoplightReport(input),
    "INPUT_INVALID",
    "openspec",
  );
  assert.equal(getterExecuted, false);
});

test("rejects non-JSON-like public stoplight input shapes", () => {
  const hidden = validInput();
  Object.defineProperty(hidden, "openspec", {
    enumerable: false,
    value: hidden.openspec,
  });
  expectStoplightError(
    () => buildPredeployStoplightReport(hidden),
    "INPUT_INVALID",
    "openspec",
  );

  const symbolKeyed = validInput();
  symbolKeyed[Symbol("hidden")] = "must not be accepted";
  expectStoplightError(
    () => buildPredeployStoplightReport(symbolKeyed),
    "INPUT_INVALID",
    "$",
  );

  const arrayWithExtraKey = validInput();
  arrayWithExtraKey.openspec.remainingTasks.extra = "unexpected";
  expectStoplightError(
    () => buildPredeployStoplightReport(arrayWithExtraKey),
    "INPUT_INVALID",
    "openspec.remainingTasks.extra",
  );

  const sparseArray = validInput();
  delete sparseArray.openspec.remainingTasks[0];
  expectStoplightError(
    () => buildPredeployStoplightReport(sparseArray),
    "INPUT_INVALID",
    "openspec.remainingTasks[0]",
  );

  const classInstance = validInput();
  Object.setPrototypeOf(classInstance, { inherited: true });
  expectStoplightError(
    () => buildPredeployStoplightReport(classInstance),
    "INPUT_INVALID",
    "$",
  );

  const nullPrototype = validInput();
  Object.setPrototypeOf(nullPrototype, null);
  expectStoplightError(
    () => buildPredeployStoplightReport(nullPrototype),
    "INPUT_INVALID",
    "$",
  );

  const cyclic = validInput();
  cyclic.self = cyclic;
  expectStoplightError(
    () => buildPredeployStoplightReport(cyclic),
    "INPUT_INVALID",
    "self",
  );

  const nonFinite = validInput();
  nonFinite.graphify.nodes = Number.POSITIVE_INFINITY;
  expectStoplightError(
    () => buildPredeployStoplightReport(nonFinite),
    "INPUT_INVALID",
    "graphify.nodes",
  );
});

test("CLI prints JSON from provided stdin text without file, env, git, network or chain access", async () => {
  let stdout = "";
  let stderr = "";
  const streams = {
    stdin: [],
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
  };

  const code = await runCli(
    ["node", "predeploy-stoplight.mjs"],
    streams,
    JSON.stringify(validInput()),
  );

  assert.equal(code, 0);
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.readyToDeploy, false);
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
    ["node", "predeploy-stoplight.mjs"],
    streams,
    JSON.stringify(validInput()),
  );

  assert.equal(code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
});

test("implementation contains no shell, git, env, file path, network or secret reads", async () => {
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
    assert.ok(!source.includes(forbidden), `source must not include ${forbidden}`);
  }
});
