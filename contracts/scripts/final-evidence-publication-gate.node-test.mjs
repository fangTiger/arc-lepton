import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FinalEvidencePublicationGateError,
  buildFinalEvidencePublicationGate,
  runCli,
} from "./final-evidence-publication-gate.mjs";

const change = "onchain-research-escrow";
const chainId = 5042002;
const stage = "final_evidence_publication";
const commit = "0123456789abcdef0123456789abcdef01234567";
const manifestDigest = `sha256:${"0123456789abcdef".repeat(4)}`;

const addresses = {
  registry: "0x1234567890abcdef1234567890abcdef12345678",
  implementation: "0x2234567890abcdef1234567890abcdef12345678",
  factory: "0x3234567890abcdef1234567890abcdef12345678",
};

function validInput(overrides = {}) {
  return {
    change,
    chainId,
    stage,
    commit,
    manifestDigest,
    graphify: {
      nodes: 1307,
      edges: 2753,
      communities: 47,
      reportPath: "graphify-out/GRAPH_REPORT.md",
    },
    documents: {
      readmeCommit: commit,
      contractDocsCommit: commit,
      manifestCommit: commit,
      verifierCommit: commit,
      paths: [
        "README.md",
        "docs/contracts/onchain-research-escrow.md",
        "deployments/5042002.json",
      ],
    },
    coreContracts: {
      registry: addresses.registry,
      implementation: addresses.implementation,
      factory: addresses.factory,
    },
    finalEvidence: {
      finalManifestPresent: true,
      publicVerifierPassed: true,
      exactMatchVerified: true,
      roleGraphVerified: true,
      sourceConfigVerified: true,
      smokeVerified: true,
      finalizedBlockVerified: true,
      readmeReferencesFinalAddresses: true,
      docsReferencesFinalAddresses: true,
      verifierReferencesFinalAddresses: true,
      graphifyCheckedAfterFinalCode: true,
    },
    counts: {
      fundedCloneCount: 2,
      settledCloneCount: 1,
    },
    ...overrides,
  };
}

function missingPaths(report) {
  return report.missingInputs.map((entry) => entry.path);
}

test("complete public final evidence inputs only allow requesting publication review", () => {
  const report = buildFinalEvidencePublicationGate(validInput());

  assert.equal(report.change, change);
  assert.equal(report.chainId, chainId);
  assert.equal(report.stage, stage);
  assert.equal(report.readyToPublishFinalEvidence, true);
  assert.equal(report.nextAction, "request_final_evidence_publication_review");
  assert.deepEqual(report.missingInputs, []);
  assert.equal(report.readyToExecuteExternalWrites, false);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.sourceVerifyAllowed, false);
  assert.equal(report.roleChangeAllowed, false);
  assert.equal(report.taskCompleteAllowed, false);
  assert.equal(report.finalEvidencePublicationAllowed, false);
  assert.deepEqual(report.safety, {
    notAuthorizationRecord: true,
    notPreflightProof: true,
    notFinalManifestOrVerifierEvidence: true,
    requiresFinalPublicVerifierEvidence: true,
    requiresFreshHumanReview: true,
    noSecrets: true,
    noResponseOrAmbiguousApprovalStops: true,
  });
});

test("drifted final evidence fields keep publication review unready", () => {
  const report = buildFinalEvidencePublicationGate(validInput({
    graphify: {
      nodes: 1306,
      edges: 2753,
      communities: 47,
      reportPath: "graphify-out/GRAPH_REPORT.md",
    },
    documents: {
      ...validInput().documents,
      readmeCommit: "1123456789abcdef0123456789abcdef01234567",
    },
    finalEvidence: {
      ...validInput().finalEvidence,
      smokeVerified: false,
    },
    counts: {
      fundedCloneCount: 1,
      settledCloneCount: 2,
    },
  }));

  assert.equal(report.readyToPublishFinalEvidence, false);
  assert.equal(report.nextAction, "collect_final_evidence_publication_inputs");
  const paths = missingPaths(report);
  assert.ok(paths.includes("graphify.nodes"));
  assert.ok(paths.includes("documents.readmeCommit"));
  assert.ok(paths.includes("finalEvidence.smokeVerified"));
  assert.ok(paths.includes("counts.settledCloneCount"));
  assert.equal(report.finalEvidencePublicationAllowed, false);
});

test("document paths and core addresses are strict public inputs", () => {
  const report = buildFinalEvidencePublicationGate(validInput({
    documents: {
      ...validInput().documents,
      paths: ["README.md", "deployments/5042002.json"],
    },
    coreContracts: {
      registry: addresses.registry,
      implementation: "0x0000000000000000000000000000000000000000",
      factory: "not-an-address",
    },
  }));

  assert.equal(report.readyToPublishFinalEvidence, false);
  const paths = missingPaths(report);
  assert.ok(paths.includes("documents.paths"));
  assert.ok(paths.includes("coreContracts.implementation"));
  assert.ok(paths.includes("coreContracts.factory"));
});

test("unsafe JSON-like shapes fail closed without executing accessors", () => {
  let getterExecuted = false;
  const accessorInput = validInput();
  Object.defineProperty(accessorInput.graphify, "nodes", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return 1307;
    },
  });

  assert.throws(
    () => buildFinalEvidencePublicationGate(accessorInput),
    (error) => {
      assert.ok(error instanceof FinalEvidencePublicationGateError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "input.graphify.nodes");
      assert.equal(getterExecuted, false);
      return true;
    },
  );
  assert.equal(getterExecuted, false);

  const nonEnumerableInput = validInput();
  Object.defineProperty(nonEnumerableInput.documents, "readmeCommit", {
    enumerable: false,
    value: commit,
  });
  assert.throws(
    () => buildFinalEvidencePublicationGate(nonEnumerableInput),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input.documents.readmeCommit",
  );

  const symbolInput = validInput();
  symbolInput[Symbol("extra")] = true;
  assert.throws(
    () => buildFinalEvidencePublicationGate(symbolInput),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  const nullPrototypeInput = Object.assign(Object.create(null), validInput());
  assert.throws(
    () => buildFinalEvidencePublicationGate(nullPrototypeInput),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  assert.throws(
    () => buildFinalEvidencePublicationGate(validInput({
      graphify: Object.assign(Object.create(null), validInput().graphify),
    })),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input.graphify",
  );
});

test("arrays reject sparse entries, extra properties, cycles and non-finite numbers", () => {
  const sparsePaths = [...validInput().documents.paths];
  delete sparsePaths[1];
  assert.throws(
    () => buildFinalEvidencePublicationGate(validInput({
      documents: { ...validInput().documents, paths: sparsePaths },
    })),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input.documents.paths[1]",
  );

  const extraPaths = [...validInput().documents.paths];
  extraPaths.note = "not allowed";
  assert.throws(
    () => buildFinalEvidencePublicationGate(validInput({
      documents: { ...validInput().documents, paths: extraPaths },
    })),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input.documents.paths.note",
  );

  const cyclicInput = validInput();
  cyclicInput.finalEvidence.self = cyclicInput;
  assert.throws(
    () => buildFinalEvidencePublicationGate(cyclicInput),
    (error) => error instanceof FinalEvidencePublicationGateError && error.code === "INPUT_INVALID",
  );

  assert.throws(
    () => buildFinalEvidencePublicationGate(validInput({
      graphify: { ...validInput().graphify, nodes: Infinity },
    })),
    (error) =>
      error instanceof FinalEvidencePublicationGateError
      && error.code === "INPUT_INVALID"
      && error.path === "input.graphify.nodes",
  );
});

test("secret-shaped inputs and approval-shaped fields fail closed without echoing values", () => {
  const secretValue = "sk-live-final-evidence-secret";
  assert.throws(
    () => buildFinalEvidencePublicationGate(validInput({ notes: secretValue })),
    (error) => {
      assert.ok(error instanceof FinalEvidencePublicationGateError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(secretValue), false);
      return true;
    },
  );

  for (const key of ["private_key", "mnemonic", "token", "bearer", "credentialedRpc", "rpcUrl"]) {
    assert.throws(
      () => buildFinalEvidencePublicationGate(validInput({
        documents: {
          ...validInput().documents,
          [key]: "do-not-echo-this-field-value",
        },
      })),
      (error) => {
        assert.ok(error instanceof FinalEvidencePublicationGateError);
        assert.equal(error.code, "SECRET_SHAPED_INPUT");
        assert.equal(String(error.message).includes("do-not-echo-this-field-value"), false);
        return true;
      },
      `expected sensitive key to be rejected: ${key}`,
    );
  }

  for (const key of ["authorization", "authorizationText", "approved", "authorizationRecord"]) {
    assert.throws(
      () => buildFinalEvidencePublicationGate(validInput({ [key]: "not final evidence" })),
      (error) => {
        assert.ok(error instanceof FinalEvidencePublicationGateError);
        assert.equal(error.code, "APPROVAL_SHAPED_INPUT");
        assert.equal(String(error.message).includes("not final evidence"), false);
        return true;
      },
      `expected approval-shaped key to be rejected: ${key}`,
    );
  }
});

test("CLI reads stdin JSON and writes the local final evidence publication gate", async () => {
  let stdout = "";
  let stderr = "";
  const result = await runCli(
    [],
    {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    },
    JSON.stringify(validInput()),
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(stderr, "");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.readyToPublishFinalEvidence, true);
  assert.equal(parsed.nextAction, "request_final_evidence_publication_review");
  assert.equal(parsed.finalEvidencePublicationAllowed, false);
});

test("CLI rejects invalid JSON and stream wrapper accessors safely", async () => {
  let stderr = "";
  const invalidJsonResult = await runCli(
    [],
    {
      stderr: { write: (chunk) => { stderr += chunk; } },
    },
    "{not-json",
  );
  assert.equal(invalidJsonResult.ok, false);
  assert.equal(invalidJsonResult.code, 1);
  assert.match(stderr, /JSON_INVALID/u);

  let getterExecuted = false;
  stderr = "";
  const streams = {
    stderr: { write: (chunk) => { stderr += chunk; } },
  };
  Object.defineProperty(streams, "stdout", {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error("stream-secret");
    },
  });

  const streamResult = await runCli([], streams, JSON.stringify(validInput()));
  assert.equal(streamResult.ok, false);
  assert.equal(streamResult.code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /stream-secret/u);
});

test("implementation source keeps external write and secret primitives out", async () => {
  const source = await readFile(
    new URL("./final-evidence-publication-gate.mjs", import.meta.url),
    "utf8",
  );
  const forbidden = [
    ["process.env", /process\.env/u],
    ["child_process", /child_process/u],
    ["exec(", /exec\(/u],
    ["spawn(", /spawn\(/u],
    ["fork(", /fork\(/u],
    ["fetch(", /fetch\(/u],
    ["XMLHttpRequest", /XMLHttpRequest/u],
    ["http://", /http:\/\//u],
    ["https://", /https:\/\//u],
    [".env", /\.env/u],
    ["git command", /\bgit\b/u],
    ["--broadcast", /--broadcast/u],
    ["forge command", /\bforge\b/u],
    ["cast command", /\bcast\b/u],
    ["readFile", /readFile/u],
    ["writeFile", /writeFile/u],
  ];

  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden primitive leaked: ${label}`);
  }
});
