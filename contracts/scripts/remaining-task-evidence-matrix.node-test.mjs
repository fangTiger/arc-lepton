import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  RemainingTaskEvidenceMatrixError,
  buildRemainingTaskEvidenceMatrix,
  runCli,
} from "./remaining-task-evidence-matrix.mjs";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const SOURCE_PATH = resolve(ROOT, "contracts/scripts/remaining-task-evidence-matrix.mjs");

const REMAINING_TASK_IDS = Object.freeze([
  "13.4",
  "14.2",
  "14.3",
  "14.4",
  "14.7",
  "14.8",
  "14.9",
]);

function validInput(overrides = {}) {
  return {
    openspec: {
      change: "onchain-research-escrow",
      totalTasks: 107,
      completeTasks: 100,
      remainingTaskIds: [...REMAINING_TASK_IDS],
    },
    evidence: {
      authorizationPackageDigest: `sha256:${"a".repeat(64)}`,
      deploymentAuthorizationHandoff: true,
      deploymentNextActionChecklist: true,
      predeployStoplight: true,
      specScenarioAudit: true,
      graphify: {
        rebuiltAfterLastCodeChange: true,
        nodes: 1307,
        edges: 2754,
        communities: 47,
      },
      finalAddressesAndCommit: false,
      finalManifest: false,
      publicVerifierReport: false,
      rolloutDeployment: false,
      successE2E: false,
      failureE2E: false,
      rollbackDrill: false,
    },
    ...overrides,
  };
}

function taskById(report, id) {
  const task = report.tasks.find((entry) => entry.id === id);
  assert.ok(task, `missing task ${id}`);
  return task;
}

test("current readiness evidence cannot complete any remaining external or live task", () => {
  const report = buildRemainingTaskEvidenceMatrix(validInput());

  assert.equal(report.openspec.change, "onchain-research-escrow");
  assert.equal(report.summary.totalRemaining, 7);
  assert.equal(report.summary.completeNow, 0);
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
    notTaskCompletionAuthority: true,
  });

  assert.deepEqual(report.tasks.map((entry) => entry.id), REMAINING_TASK_IDS);
  for (const task of report.tasks) {
    assert.equal(task.canMarkComplete, false, `${task.id} must stay incomplete`);
    assert.ok(task.authoritativeEvidenceRequired.length > 0, `${task.id} must list required evidence`);
    assert.ok(task.missingEvidence.length > 0, `${task.id} must list missing evidence`);
  }
});

test("readiness artifacts never substitute for authorization, preflight, final verifier, live E2E or rollback", () => {
  const report = buildRemainingTaskEvidenceMatrix(validInput());

  for (const id of ["13.4", "14.2", "14.3", "14.4", "14.9"]) {
    const task = taskById(report, id);
    assert.equal(task.canMarkComplete, false);
    assert.ok(
      task.readinessEvidenceAccepted.some((entry) => /readiness|handoff|package|stoplight|checklist/i.test(entry)),
      `${id} must record readiness-only evidence`,
    );
    assert.ok(
      task.missingEvidence.some((entry) => /授权|preflight|verifier|E2E|rollback|rollout|manifest|receipt|smoke|Explorer|exact-match|source/i.test(entry)),
      `${id} must keep authoritative evidence missing`,
    );
  }
});

test("Graphify rebuild alone does not complete 14.8 without final address commit manifest and verifier references", () => {
  const report = buildRemainingTaskEvidenceMatrix(validInput());
  const task = taskById(report, "14.8");

  assert.equal(task.canMarkComplete, false);
  assert.equal(task.classification, "local_readiness_only");
  assert.ok(task.readinessEvidenceAccepted.includes("Graphify rebuilt after latest local code change"));
  for (const phrase of ["最终地址", "最终 commit", "最终 manifest", "public verifier"]) {
    assert.ok(
      task.missingEvidence.some((entry) => entry.includes(phrase)),
      `14.8 must still require ${phrase}`,
    );
  }
});

test("14.7 remains incomplete while any external live final or rollback task is incomplete", () => {
  const report = buildRemainingTaskEvidenceMatrix(validInput({
    evidence: {
      ...validInput().evidence,
      specScenarioAudit: true,
      sourceAndRoleExecution: true,
      explorerExactMatch: true,
      smokeUsdcSpendEvidence: true,
      publicVerifierReport: true,
      finalManifest: true,
      finalAddressesAndCommit: true,
      rolloutDeployment: false,
      successE2E: true,
      failureE2E: true,
      rollbackDrill: true,
    },
  }));
  const task = taskById(report, "14.7");

  assert.equal(task.canMarkComplete, false);
  assert.ok(task.readinessEvidenceAccepted.includes("spec scenario audit document exists"));
  assert.ok(
    task.missingEvidence.some((entry) => entry.includes("14.2")),
    "14.7 must depend on rollout completion too",
  );
});

test("claimed authoritative evidence still cannot make the local matrix a task completion authority", () => {
  const report = buildRemainingTaskEvidenceMatrix(validInput({
    evidence: {
      authorizationPackageDigest: `sha256:${"b".repeat(64)}`,
      deploymentAuthorizationHandoff: true,
      deploymentNextActionChecklist: true,
      predeployStoplight: true,
      specScenarioAudit: true,
      graphify: {
        rebuiltAfterLastCodeChange: true,
        nodes: 1307,
        edges: 2754,
        communities: 47,
      },
      sourceAndRoleExecution: true,
      explorerExactMatch: true,
      smokeUsdcSpendEvidence: true,
      finalAddressesAndCommit: true,
      finalManifest: true,
      publicVerifierReport: true,
      rolloutDeployment: true,
      successE2E: true,
      failureE2E: true,
      graphifyFinalReferences: true,
      openspecStrictValidate: true,
      rollbackDrill: true,
    },
  }));

  assert.equal(report.summary.authoritativeEvidenceSatisfiedCount, 7);
  assert.equal(report.summary.completeNow, 0);
  assert.equal(report.summary.blockedCount, 7);
  assert.equal(report.goalCompleteAllowed, false);
  assert.equal(report.safety.notTaskCompletionAuthority, true);
  for (const task of report.tasks) {
    assert.equal(task.authoritativeEvidenceSatisfied, true, `${task.id} should classify claimed evidence separately`);
    assert.equal(task.canMarkComplete, false, `${task.id} must still require human/OpenSpec completion authority`);
    assert.deepEqual(task.missingEvidence, []);
  }
});

test("unknown, missing or duplicate remaining task ids fail closed", () => {
  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(validInput({
      openspec: {
        ...validInput().openspec,
        remainingTaskIds: [...REMAINING_TASK_IDS, "15.1"],
      },
    })),
    (error) => error instanceof RemainingTaskEvidenceMatrixError
      && error.code === "REMAINING_TASKS_MISMATCH"
      && error.path === "openspec.remainingTaskIds",
  );

  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(validInput({
      openspec: {
        ...validInput().openspec,
        remainingTaskIds: REMAINING_TASK_IDS.filter((id) => id !== "13.4"),
      },
    })),
    (error) => error instanceof RemainingTaskEvidenceMatrixError
      && error.code === "REMAINING_TASKS_MISMATCH"
      && error.path === "openspec.remainingTaskIds",
  );

  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(validInput({
      openspec: {
        ...validInput().openspec,
        remainingTaskIds: [...REMAINING_TASK_IDS.slice(0, -1), "13.4"],
      },
    })),
    (error) => error instanceof RemainingTaskEvidenceMatrixError
      && error.code === "REMAINING_TASKS_MISMATCH"
      && error.path === "openspec.remainingTaskIds",
  );
});

test("secret-shaped evidence fields fail closed without echoing sensitive values", () => {
  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(validInput({
      evidence: {
        ...validInput().evidence,
        suspicious: "sk-this-value-must-not-appear-in-errors-1234567890",
      },
    })),
    (error) => {
      assert.ok(error instanceof RemainingTaskEvidenceMatrixError);
      assert.equal(error.code, "SENSITIVE_VALUE_REJECTED");
      assert.ok(error.path.endsWith("evidence.suspicious"));
      assert.ok(!error.message.includes("sk-this-value"));
      return true;
    },
  );
});

test("null-prototype evidence matrix input containers fail closed as non-plain objects", () => {
  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(Object.assign(Object.create(null), validInput())),
    (error) =>
      error instanceof RemainingTaskEvidenceMatrixError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  assert.throws(
    () => buildRemainingTaskEvidenceMatrix(validInput({
      evidence: Object.assign(Object.create(null), validInput().evidence),
    })),
    (error) =>
      error instanceof RemainingTaskEvidenceMatrixError
      && error.code === "INPUT_INVALID"
      && error.path === "input.evidence",
  );
});

test("CLI reads stdin JSON and prints the local evidence matrix", async () => {
  let stdout = "";
  let stderr = "";
  const streams = {
    stdin: [],
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
  };

  const code = await runCli(
    ["node", "remaining-task-evidence-matrix.mjs"],
    streams,
    JSON.stringify(validInput()),
  );

  assert.equal(code, 0);
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.summary.totalRemaining, 7);
  assert.equal(report.summary.completeNow, 0);
  assert.equal(report.goalCompleteAllowed, false);
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
    ["node", "remaining-task-evidence-matrix.mjs"],
    streams,
    JSON.stringify(validInput()),
  );

  assert.equal(code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
});

test("implementation stays local-only and has no deployment or secret primitives", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");

  for (const forbidden of [
    "process.env",
    "child_process",
    "exec(",
    "spawn(",
    "fork(",
    "fetch(",
    "http://",
    "https://",
    ".env.local",
    "git status",
    "--broadcast",
    "forge",
    "rpcUrl",
    "privateKey",
    "readFile",
  ]) {
    assert.ok(!source.includes(forbidden), `source must not include ${forbidden}`);
  }

  assert.doesNotMatch(source, /\bcast\b/, "source must not invoke cast");
});
