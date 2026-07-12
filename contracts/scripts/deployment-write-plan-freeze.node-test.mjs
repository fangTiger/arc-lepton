import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DeploymentWritePlanFreezeError,
  buildDeploymentWritePlanFreeze,
  runCli,
} from "./deployment-write-plan-freeze.mjs";

const change = "onchain-research-escrow";
const chainId = 5042002;
const commit = "0123456789abcdef0123456789abcdef01234567";

const addresses = {
  deployer: "0x1234567890abcdef1234567890abcdef12345678",
  registry: "0x2234567890abcdef1234567890abcdef12345678",
  implementation: "0x3234567890abcdef1234567890abcdef12345678",
  factory: "0x4234567890abcdef1234567890abcdef12345678",
  buyer: "0x5234567890abcdef1234567890abcdef12345678",
  payout: "0x6234567890abcdef1234567890abcdef12345678",
  usdc: "0x3600000000000000000000000000000000000000",
  sourceAdmin: "0x7234567890abcdef1234567890abcdef12345678",
  intentSigner: "0x8234567890abcdef1234567890abcdef12345678",
  settler: "0x9234567890abcdef1234567890abcdef12345678",
};

function tx(overrides = {}) {
  return {
    name: "deploy DataSourceRegistry",
    type: "create",
    to: "CREATE",
    estimatedGas: "1000000",
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    change,
    chainId,
    commit,
    stages: {
      deploy_core_contracts: {
        deployer: addresses.deployer,
        transactions: [
          tx(),
          tx({ name: "deploy ResearchEscrow implementation", estimatedGas: "1200000" }),
          tx({ name: "deploy ResearchEscrowFactory", estimatedGas: "1400000" }),
        ],
      },
      configure_sources_and_roles: {
        deployer: addresses.deployer,
        transactions: [
          tx({
            name: "bind Registry to Factory",
            type: "call",
            to: addresses.registry,
            estimatedGas: "150000",
          }),
        ],
        sourceChanges: [
          {
            sourceId: "0x" + "01".repeat(32),
            payout: addresses.payout,
            maxUnitPrice: "100000",
            active: true,
          },
        ],
        roleChanges: [
          {
            contract: "factory",
            action: "grant",
            role: "SETTLER_ROLE",
            account: addresses.settler,
          },
          {
            contract: "registry",
            action: "grant",
            role: "SOURCE_ADMIN_ROLE",
            account: addresses.sourceAdmin,
          },
          {
            contract: "factory",
            action: "grant",
            role: "INTENT_SIGNER_ROLE",
            account: addresses.intentSigner,
          },
        ],
      },
      smoke_usdc_spend: {
        buyer: addresses.buyer,
        payout: addresses.payout,
        usdc: addresses.usdc,
        factory: addresses.factory,
        maxUsdcUnits: "1000000",
        transactions: [
          tx({
            name: "approve official USDC",
            type: "call",
            to: addresses.usdc,
            estimatedGas: "70000",
          }),
          tx({
            name: "createAndFund smoke escrow",
            type: "call",
            to: addresses.factory,
            estimatedGas: "600000",
          }),
        ],
      },
    },
    ...overrides,
  };
}

function missingPaths(report) {
  return report.missingInputs.map((entry) => entry.path);
}

test("complete public write plan freezes stable stage digests but grants no authorization", () => {
  const report = buildDeploymentWritePlanFreeze(validInput());

  assert.equal(report.change, change);
  assert.equal(report.chainId, chainId);
  assert.deepEqual(report.stageOrder, [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]);
  assert.equal(report.readyToRequestAuthorization, true);
  assert.equal(report.nextAction, "request_stage_scoped_authorization");
  assert.match(report.planDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(report.stageDigests), report.stageOrder);
  assert.match(report.stageDigests.deploy_core_contracts, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(report.missingInputs, []);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.readyToExecuteExternalWrites, false);
  assert.equal(report.sourceVerifyAllowed, false);
  assert.equal(report.roleChangeAllowed, false);
  assert.equal(report.testUsdcSpendAllowed, false);
  assert.equal(report.taskCompleteAllowed, false);
  assert.deepEqual(report.authorizedStages, []);
  assert.deepEqual(report.safety, {
    notAuthorizationRecord: true,
    notPreflightProof: true,
    notFinalManifestOrVerifierEvidence: true,
    noSecrets: true,
    noResponseOrAmbiguousApprovalStops: true,
    inputChangeRequiresNewAuthorization: true,
    stageAuthorizationReuseAllowed: false,
  });

  const reordered = validInput({
    stages: Object.fromEntries(Object.entries(validInput().stages).reverse()),
  });
  assert.equal(buildDeploymentWritePlanFreeze(reordered).planDigest, report.planDigest);
});

test("missing or invalid stage public fields keep authorization request unready", () => {
  const input = validInput();
  input.stages.deploy_core_contracts.transactions = [];
  input.stages.configure_sources_and_roles.roleChanges = [];
  input.stages.configure_sources_and_roles.sourceChanges = [];
  input.stages.smoke_usdc_spend.maxUsdcUnits = "0";
  input.stages.smoke_usdc_spend.buyer = "not-an-address";

  const report = buildDeploymentWritePlanFreeze(input);

  assert.equal(report.readyToRequestAuthorization, false);
  assert.equal(report.nextAction, "collect_deployment_write_plan_inputs");
  const paths = missingPaths(report);
  assert.ok(paths.includes("stages.deploy_core_contracts.transactions"));
  assert.ok(paths.includes("stages.configure_sources_and_roles.roleChanges"));
  assert.ok(paths.includes("stages.configure_sources_and_roles.sourceChanges"));
  assert.ok(paths.includes("stages.smoke_usdc_spend.maxUsdcUnits"));
  assert.ok(paths.includes("stages.smoke_usdc_spend.buyer"));
  assert.equal(report.broadcastAllowed, false);
});

test("deploy stage allows CREATE targets while call targets must be strict addresses", () => {
  const invalidDeploy = validInput();
  invalidDeploy.stages.deploy_core_contracts.transactions[0].to = "not-create-or-address";
  let report = buildDeploymentWritePlanFreeze(invalidDeploy);
  assert.ok(missingPaths(report).includes("stages.deploy_core_contracts.transactions[0].to"));

  const invalidConfigure = validInput();
  invalidConfigure.stages.configure_sources_and_roles.transactions[0].to = "CREATE";
  report = buildDeploymentWritePlanFreeze(invalidConfigure);
  assert.ok(missingPaths(report).includes("stages.configure_sources_and_roles.transactions[0].to"));
});

test("unsafe JSON-like shapes fail closed without executing accessors", () => {
  let getterExecuted = false;
  const accessorInput = validInput();
  Object.defineProperty(accessorInput.stages.smoke_usdc_spend, "buyer", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return addresses.buyer;
    },
  });

  assert.throws(
    () => buildDeploymentWritePlanFreeze(accessorInput),
    (error) => {
      assert.ok(error instanceof DeploymentWritePlanFreezeError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "input.stages.smoke_usdc_spend.buyer");
      assert.equal(getterExecuted, false);
      return true;
    },
  );

  const nonEnumerableInput = validInput();
  Object.defineProperty(nonEnumerableInput, "change", {
    enumerable: false,
    value: change,
  });
  assert.throws(
    () => buildDeploymentWritePlanFreeze(nonEnumerableInput),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input.change",
  );

  const symbolInput = validInput();
  symbolInput[Symbol("secret")] = true;
  assert.throws(
    () => buildDeploymentWritePlanFreeze(symbolInput),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );
});

test("arrays reject sparse entries, extra properties, cycles and non-finite numbers", () => {
  const sparseTransactions = [...validInput().stages.deploy_core_contracts.transactions];
  delete sparseTransactions[1];
  assert.throws(
    () => buildDeploymentWritePlanFreeze(validInput({
      stages: {
        ...validInput().stages,
        deploy_core_contracts: {
          ...validInput().stages.deploy_core_contracts,
          transactions: sparseTransactions,
        },
      },
    })),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions[1]",
  );

  const extraTransactions = [...validInput().stages.deploy_core_contracts.transactions];
  extraTransactions.memo = "not allowed";
  assert.throws(
    () => buildDeploymentWritePlanFreeze(validInput({
      stages: {
        ...validInput().stages,
        deploy_core_contracts: {
          ...validInput().stages.deploy_core_contracts,
          transactions: extraTransactions,
        },
      },
    })),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions.memo",
  );

  const cyclicInput = validInput();
  cyclicInput.stages.deploy_core_contracts.self = cyclicInput;
  assert.throws(
    () => buildDeploymentWritePlanFreeze(cyclicInput),
    (error) => error instanceof DeploymentWritePlanFreezeError && error.code === "INPUT_INVALID",
  );

  const nonFinite = validInput();
  nonFinite.stages.deploy_core_contracts.transactions[0].estimatedGas = Number.POSITIVE_INFINITY;
  assert.throws(
    () => buildDeploymentWritePlanFreeze(nonFinite),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions[0].estimatedGas",
  );
});

test("null-prototype public input containers fail closed as non-plain objects", () => {
  const nullPrototypeInput = Object.assign(Object.create(null), validInput());

  assert.throws(
    () => buildDeploymentWritePlanFreeze(nullPrototypeInput),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  const nestedNullPrototypeStage = validInput();
  nestedNullPrototypeStage.stages.deploy_core_contracts = Object.assign(
    Object.create(null),
    nestedNullPrototypeStage.stages.deploy_core_contracts,
  );

  assert.throws(
    () => buildDeploymentWritePlanFreeze(nestedNullPrototypeStage),
    (error) =>
      error instanceof DeploymentWritePlanFreezeError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts",
  );
});

test("secret-shaped inputs and approval-shaped fields fail closed without echoing values", () => {
  const secretValue = "sk-live-write-plan-secret";
  assert.throws(
    () => buildDeploymentWritePlanFreeze(validInput({ notes: secretValue })),
    (error) => {
      assert.ok(error instanceof DeploymentWritePlanFreezeError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(secretValue), false);
      return true;
    },
  );

  for (const key of ["private_key", "mnemonic", "token", "bearer", "credentialedRpc", "rpcUrl"]) {
    assert.throws(
      () => buildDeploymentWritePlanFreeze(validInput({
        stages: {
          ...validInput().stages,
          deploy_core_contracts: {
            ...validInput().stages.deploy_core_contracts,
            [key]: "do-not-echo-this-field-value",
          },
        },
      })),
      (error) => {
        assert.ok(error instanceof DeploymentWritePlanFreezeError);
        assert.equal(error.code, "SECRET_SHAPED_INPUT");
        assert.equal(String(error.message).includes("do-not-echo-this-field-value"), false);
        return true;
      },
    );
  }

  for (const key of ["authorization", "authorizationText", "approved", "authorizationRecord"]) {
    assert.throws(
      () => buildDeploymentWritePlanFreeze(validInput({ [key]: "not authorization" })),
      (error) => {
        assert.ok(error instanceof DeploymentWritePlanFreezeError);
        assert.equal(error.code, "APPROVAL_SHAPED_INPUT");
        assert.equal(String(error.message).includes("not authorization"), false);
        return true;
      },
    );
  }
});

test("CLI reads stdin JSON and writes the local frozen write plan", async () => {
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
  assert.equal(parsed.readyToRequestAuthorization, true);
  assert.equal(parsed.nextAction, "request_stage_scoped_authorization");
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
    new URL("./deployment-write-plan-freeze.mjs", import.meta.url),
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
