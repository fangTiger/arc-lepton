import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SourceRoleReadinessReportError,
  buildSourceRoleReadinessReport,
  runCli,
} from "./source-role-readiness-report.mjs";

const change = "onchain-research-escrow";
const chainId = 5042002;
const stage = "configure_sources_and_roles";
const commit = "0123456789abcdef0123456789abcdef01234567";
const requestDigest = `sha256:${"0123456789abcdef".repeat(4)}`;

const addresses = {
  registry: "0x1234567890abcdef1234567890abcdef12345678",
  implementation: "0x2234567890abcdef1234567890abcdef12345678",
  factory: "0x3234567890abcdef1234567890abcdef12345678",
  deployer: "0x4234567890abcdef1234567890abcdef12345678",
  factoryGovernanceSafe: "0x5234567890abcdef1234567890abcdef12345678",
  registryGovernanceSafe: "0x6234567890abcdef1234567890abcdef12345678",
  sourceAdmin: "0x7234567890abcdef1234567890abcdef12345678",
  fundingSigner: "0x8234567890abcdef1234567890abcdef12345678",
  intentSigner: "0x9234567890abcdef1234567890abcdef12345678",
  settler: "0xa234567890abcdef1234567890abcdef12345678",
  payoutA: "0xb234567890abcdef1234567890abcdef12345678",
  payoutB: "0xc234567890abcdef1234567890abcdef12345678",
  payoutC: "0xd234567890abcdef1234567890abcdef12345678",
  payoutD: "0xe234567890abcdef1234567890abcdef12345678",
  payoutE: "0xf234567890abcdef1234567890abcdef12345678",
};

const sourceIds = [
  `0x${"01".repeat(32)}`,
  `0x${"02".repeat(32)}`,
  `0x${"03".repeat(32)}`,
  `0x${"04".repeat(32)}`,
  `0x${"05".repeat(32)}`,
];

function validSources(overrides = []) {
  const payouts = [
    addresses.payoutA,
    addresses.payoutB,
    addresses.payoutC,
    addresses.payoutD,
    addresses.payoutE,
  ];
  return sourceIds.map((sourceId, index) => ({
    sourceId,
    payout: payouts[index],
    maxUnitPrice: String((index + 1) * 1000),
    active: index !== 3,
    revision: index + 1,
    ...overrides[index],
  }));
}

function validInput(overrides = {}) {
  return {
    change,
    chainId,
    stage,
    commit,
    requestDigest,
    coreContracts: {
      registry: addresses.registry,
      implementation: addresses.implementation,
      factory: addresses.factory,
    },
    sources: validSources(),
    rolePlan: {
      deployer: addresses.deployer,
      factoryGovernanceSafe: addresses.factoryGovernanceSafe,
      registryGovernanceSafe: addresses.registryGovernanceSafe,
      sourceAdmin: addresses.sourceAdmin,
      fundingSigner: addresses.fundingSigner,
      intentSigner: addresses.intentSigner,
      settler: addresses.settler,
      grants: [
        { contract: "factory", role: "FUNDING_SIGNER_ROLE", account: addresses.fundingSigner },
        { contract: "factory", role: "INTENT_SIGNER_ROLE", account: addresses.intentSigner },
        { contract: "factory", role: "SETTLER_ROLE", account: addresses.settler },
        { contract: "registry", role: "SOURCE_ADMIN_ROLE", account: addresses.sourceAdmin },
      ],
      revokes: [
        { contract: "factory", role: "DEFAULT_ADMIN_ROLE", account: addresses.deployer },
        { contract: "registry", role: "DEFAULT_ADMIN_ROLE", account: addresses.deployer },
      ],
    },
    evidence: {
      bindFactoryPlanned: true,
      exactMatchPlanned: true,
      finalizedReadbackPlanned: true,
      manifestUpdatePlanned: true,
    },
    ...overrides,
  };
}

function missingPaths(report) {
  return report.missingInputs.map((entry) => entry.path);
}

test("complete public source and role inputs only allow requesting configure authorization", () => {
  const report = buildSourceRoleReadinessReport(validInput());

  assert.equal(report.change, change);
  assert.equal(report.chainId, chainId);
  assert.equal(report.stage, stage);
  assert.equal(report.readyToRequestConfigureAuthorization, true);
  assert.equal(report.nextAction, "request_configure_sources_and_roles_authorization");
  assert.deepEqual(report.missingInputs, []);
  assert.equal(report.readyToExecuteExternalWrites, false);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.sourceVerifyAllowed, false);
  assert.equal(report.roleChangeAllowed, false);
  assert.equal(report.taskCompleteAllowed, false);
  assert.deepEqual(report.safety, {
    notAuthorizationRecord: true,
    notPreflightProof: true,
    notFinalManifestOrVerifierEvidence: true,
    requiresFreshConfigureAuthorization: true,
    deploymentAuthorizationCannotBeReused: true,
    noResponseOrAmbiguousApprovalStops: true,
    noSecrets: true,
  });
});

test("missing or invalid public inputs collect exact configure readiness blockers", () => {
  const input = validInput({
    commit: "0123456789abcdef0123456789abcdef0123456A",
    coreContracts: {
      registry: addresses.registry,
      implementation: addresses.implementation,
      factory: "0x0000000000000000000000000000000000000000",
    },
    sources: validSources([
      { maxUnitPrice: "01", revision: 0 },
      { payout: "not-an-address" },
    ]),
    rolePlan: {
      ...validInput().rolePlan,
      intentSigner: "0x0000000000000000000000000000000000000000",
      grants: "grant later",
    },
    evidence: {
      ...validInput().evidence,
      finalizedReadbackPlanned: false,
    },
  });

  const report = buildSourceRoleReadinessReport(input);

  assert.equal(report.readyToRequestConfigureAuthorization, false);
  assert.equal(report.nextAction, "collect_configure_sources_and_roles_public_inputs");
  assert.equal(report.readyToExecuteExternalWrites, false);
  const paths = missingPaths(report);
  assert.ok(paths.includes("commit"));
  assert.ok(paths.includes("coreContracts.factory"));
  assert.ok(paths.includes("sources[0].maxUnitPrice"));
  assert.ok(paths.includes("sources[0].revision"));
  assert.ok(paths.includes("sources[1].payout"));
  assert.ok(paths.includes("rolePlan.intentSigner"));
  assert.ok(paths.includes("rolePlan.grants"));
  assert.ok(paths.includes("evidence.finalizedReadbackPlanned"));
});

test("malformed role diff entries keep configure authorization request unready", () => {
  const input = validInput({
    rolePlan: {
      ...validInput().rolePlan,
      grants: [
        { contract: "treasury", role: "FUNDING_SIGNER_ROLE", account: addresses.fundingSigner },
        { contract: "factory", role: "", account: addresses.intentSigner },
        { contract: "factory", role: "SETTLER_ROLE", account: "0x0000000000000000000000000000000000000000" },
        "not-a-role-diff-entry",
      ],
      revokes: [
        { contract: "registry", role: "SETTLER_ROLE", account: addresses.deployer },
        { role: "DEFAULT_ADMIN_ROLE", account: addresses.deployer },
        { contract: "factory", account: addresses.deployer },
        { contract: "registry", role: "DEFAULT_ADMIN_ROLE", account: "not-an-address" },
      ],
    },
  });

  const report = buildSourceRoleReadinessReport(input);

  assert.equal(report.readyToRequestConfigureAuthorization, false);
  assert.equal(report.nextAction, "collect_configure_sources_and_roles_public_inputs");
  const paths = missingPaths(report);
  assert.ok(paths.includes("rolePlan.grants[0].contract"));
  assert.ok(paths.includes("rolePlan.grants[1].role"));
  assert.ok(paths.includes("rolePlan.grants[2].account"));
  assert.ok(paths.includes("rolePlan.grants[3]"));
  assert.ok(paths.includes("rolePlan.revokes[0].role"));
  assert.ok(paths.includes("rolePlan.revokes[1].contract"));
  assert.ok(paths.includes("rolePlan.revokes[2].role"));
  assert.ok(paths.includes("rolePlan.revokes[3].account"));
});

test("sources must be exactly five strict public records", () => {
  const tooFew = buildSourceRoleReadinessReport(validInput({ sources: validSources().slice(0, 4) }));
  assert.equal(tooFew.readyToRequestConfigureAuthorization, false);
  assert.ok(missingPaths(tooFew).includes("sources"));

  const invalidSource = buildSourceRoleReadinessReport(validInput({
    sources: validSources([
      {
        sourceId: `0x${"ab".repeat(31)}`,
        active: "true",
      },
    ]),
  }));
  assert.equal(invalidSource.readyToRequestConfigureAuthorization, false);
  assert.ok(missingPaths(invalidSource).includes("sources[0].sourceId"));
  assert.ok(missingPaths(invalidSource).includes("sources[0].active"));
});

test("unsafe JSON-like shapes fail closed without executing accessors", () => {
  let getterExecuted = false;
  const accessorInput = validInput();
  Object.defineProperty(accessorInput.coreContracts, "registry", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return addresses.registry;
    },
  });

  assert.throws(
    () => buildSourceRoleReadinessReport(accessorInput),
    (error) => {
      assert.ok(error instanceof SourceRoleReadinessReportError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "input.coreContracts.registry");
      assert.equal(getterExecuted, false);
      return true;
    },
  );
  assert.equal(getterExecuted, false);

  const nonEnumerableInput = validInput();
  Object.defineProperty(nonEnumerableInput.rolePlan, "deployer", {
    enumerable: false,
    value: addresses.deployer,
  });
  assert.throws(
    () => buildSourceRoleReadinessReport(nonEnumerableInput),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input.rolePlan.deployer",
  );

  const symbolInput = validInput();
  symbolInput[Symbol("extra")] = true;
  assert.throws(
    () => buildSourceRoleReadinessReport(symbolInput),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  const nullPrototypeInput = Object.assign(Object.create(null), validInput());
  assert.throws(
    () => buildSourceRoleReadinessReport(nullPrototypeInput),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({
      coreContracts: Object.assign(Object.create(null), validInput().coreContracts),
    })),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input.coreContracts",
  );
});

test("arrays reject sparse entries, extra properties, cycles and non-finite numbers", () => {
  const sparseSources = validSources();
  delete sparseSources[2];
  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({ sources: sparseSources })),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input.sources[2]",
  );

  const extraSources = validSources();
  extraSources.note = "not allowed";
  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({ sources: extraSources })),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input.sources.note",
  );

  const cyclicInput = validInput();
  cyclicInput.rolePlan.grants.push(cyclicInput);
  assert.throws(
    () => buildSourceRoleReadinessReport(cyclicInput),
    (error) => error instanceof SourceRoleReadinessReportError && error.code === "INPUT_INVALID",
  );

  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({
      sources: validSources([{ revision: Infinity }]),
    })),
    (error) =>
      error instanceof SourceRoleReadinessReportError
      && error.code === "INPUT_INVALID"
      && error.path === "input.sources[0].revision",
  );
});

test("secret-shaped inputs and approval-shaped fields fail closed without echoing values", () => {
  const secretValue = "sk-live-this-value-must-not-echo";
  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({ notes: secretValue })),
    (error) => {
      assert.ok(error instanceof SourceRoleReadinessReportError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(secretValue), false);
      return true;
    },
  );

  const rawSecret = `0x${"ef".repeat(32)}`;
  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({
      rolePlan: {
        ...validInput().rolePlan,
        grants: [{ proofDigest: rawSecret }],
      },
    })),
    (error) => {
      assert.ok(error instanceof SourceRoleReadinessReportError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(rawSecret), false);
      return true;
    },
  );

  for (const key of ["private_key", "mnemonic", "token", "bearer", "credentialedRpc", "rpcUrl"]) {
    assert.throws(
      () => buildSourceRoleReadinessReport(validInput({
        rolePlan: {
          ...validInput().rolePlan,
          [key]: "do-not-echo-this-field-value",
        },
      })),
      (error) => {
        assert.ok(error instanceof SourceRoleReadinessReportError);
        assert.equal(error.code, "SECRET_SHAPED_INPUT");
        assert.equal(String(error.message).includes("do-not-echo-this-field-value"), false);
        return true;
      },
      `expected sensitive key to be rejected: ${key}`,
    );
  }

  for (const key of ["authorization", "authorizationText", "approved", "authorizationRecord"]) {
    assert.throws(
      () => buildSourceRoleReadinessReport(validInput({ [key]: "not an authorization" })),
      (error) => {
        assert.ok(error instanceof SourceRoleReadinessReportError);
        assert.equal(error.code, "APPROVAL_SHAPED_INPUT");
        assert.equal(String(error.message).includes("not an authorization"), false);
        return true;
      },
      `expected approval-shaped key to be rejected: ${key}`,
    );
  }
});

test("public sourceId bytes32 is allowed only in input.sources entries", () => {
  const report = buildSourceRoleReadinessReport(validInput({
    sources: validSources([{ sourceId: `0x${"ab".repeat(32)}` }]),
  }));
  assert.equal(report.readyToRequestConfigureAuthorization, true);

  const rawValue = `0x${"ab".repeat(32)}`;
  assert.throws(
    () => buildSourceRoleReadinessReport(validInput({
      rolePlan: {
        ...validInput().rolePlan,
        revokes: [{ sourceId: rawValue }],
      },
    })),
    (error) => {
      assert.ok(error instanceof SourceRoleReadinessReportError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(rawValue), false);
      return true;
    },
  );
});

test("CLI reads stdin JSON and writes the local source role readiness report", async () => {
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
  assert.equal(parsed.readyToRequestConfigureAuthorization, true);
  assert.equal(parsed.nextAction, "request_configure_sources_and_roles_authorization");
  assert.equal(parsed.broadcastAllowed, false);
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
    new URL("./source-role-readiness-report.mjs", import.meta.url),
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
    ["camel private key", /privateKey/u],
    ["readFile", /readFile/u],
    ["writeFile", /writeFile/u],
  ];

  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden primitive leaked: ${label}`);
  }
});
