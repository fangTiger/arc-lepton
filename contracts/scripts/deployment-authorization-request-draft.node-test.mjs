import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { digestAuthorizationRequest } from "./deployment-authorization-gate.mjs";
import {
  DeploymentAuthorizationRequestDraftError,
  buildDeploymentAuthorizationRequestDrafts,
  runCli,
} from "./deployment-authorization-request-draft.mjs";

const change = "onchain-research-escrow";
const chainId = 5042002;
const commit = "0123456789abcdef0123456789abcdef01234567";

const addresses = {
  deployer: "0x1234567890abcdef1234567890abcdef12345678",
  registry: "0x2234567890abcdef1234567890abcdef12345678",
  implementation: "0x3234567890abcdef1234567890abcdef12345678",
  factory: "0x4234567890abcdef1234567890abcdef12345678",
  factorySafe: "0x5234567890abcdef1234567890abcdef12345678",
  registrySafe: "0x6234567890abcdef1234567890abcdef12345678",
  sourceAdmin: "0x7234567890abcdef1234567890abcdef12345678",
  fundingSigner: "0x8234567890abcdef1234567890abcdef12345678",
  intentSigner: "0x9234567890abcdef1234567890abcdef12345678",
  settler: "0xa234567890abcdef1234567890abcdef12345678",
  buyer: "0xb234567890abcdef1234567890abcdef12345678",
  payout: "0xc234567890abcdef1234567890abcdef12345678",
  usdc: "0x3600000000000000000000000000000000000000",
};

function validStages(overrides = {}) {
  const stages = {
    deploy_core_contracts: {
      commit,
      deployer: addresses.deployer,
      expectedAddresses: {
        registry: addresses.registry,
        implementation: addresses.implementation,
        factory: addresses.factory,
      },
      coreArtifacts: [
        "contracts/src/DataSourceRegistry.sol:DataSourceRegistry",
        "contracts/src/ResearchEscrow.sol:ResearchEscrow",
        "contracts/src/ResearchEscrowFactory.sol:ResearchEscrowFactory",
      ],
      transactions: [
        { action: "deploy", target: "DataSourceRegistry" },
        { action: "deploy", target: "ResearchEscrow implementation" },
        { action: "deploy", target: "ResearchEscrowFactory" },
      ],
      estimatedGas: "1234567",
      maxUsdcUnits: "0",
    },
    configure_sources_and_roles: {
      commit,
      deployer: addresses.deployer,
      targetAddresses: [addresses.registry, addresses.factory],
      sourceConfigurationChanges: [
        {
          target: "DataSourceRegistry",
          to: addresses.registry,
          function: "setSource",
          args: {
            sourceId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            payout: addresses.payout,
            maxUnitPrice: "1000000",
            active: true,
          },
        },
      ],
      roleChanges: [
        {
          target: "ResearchEscrowFactory",
          to: addresses.factory,
          action: "grantRole",
          role: "FUNDING_SIGNER_ROLE",
          account: addresses.fundingSigner,
        },
        {
          target: "ResearchEscrowFactory",
          to: addresses.factory,
          action: "grantRole",
          role: "INTENT_SIGNER_ROLE",
          account: addresses.intentSigner,
        },
      ],
      transactions: [
        { to: addresses.registry, function: "setSource" },
        { to: addresses.factory, action: "grantRole", role: "FUNDING_SIGNER_ROLE" },
      ],
      estimatedGas: "2345678",
      maxUsdcUnits: "0",
    },
    smoke_usdc_spend: {
      commit,
      buyer: addresses.buyer,
      payout: addresses.payout,
      factory: addresses.factory,
      usdc: {
        address: addresses.usdc,
        chainId,
        decimals: 6,
      },
      transactions: [
        { to: addresses.usdc, function: "approve" },
        { to: addresses.factory, function: "createAndFund" },
        { to: addresses.factory, function: "activate" },
        { to: addresses.factory, function: "settleBatch" },
        { to: addresses.factory, function: "close" },
      ],
      estimatedGas: "3456789",
      maxUsdcUnits: "1000000",
    },
  };

  return {
    ...stages,
    ...overrides,
  };
}

function draftFor(input = {}) {
  return buildDeploymentAuthorizationRequestDrafts({
    change,
    chainId,
    stages: validStages(),
    ...input,
  });
}

test("complete public inputs generate stage ordered authorization request drafts with stable digests", () => {
  const draft = draftFor();

  assert.equal(draft.readyToAskAuthorization, true);
  assert.equal(draft.broadcastAllowed, false);
  assert.equal(draft.deployAllowed, false);
  assert.equal(draft.goalCompleteAllowed, false);
  assert.equal(draft.summary.nextAction, "ask_user_for_stage_scoped_authorization");
  assert.deepEqual(draft.stageOrder, [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]);
  assert.equal(draft.requests.length, 3);

  for (const request of draft.requests) {
    const { requestDigest, ...body } = request;
    assert.equal(request.requiresFreshUserAuthorization, true);
    assert.equal(request.chainId, chainId);
    assert.equal(requestDigest, digestAuthorizationRequest(body));
  }

  assert.equal(draft.requests[0].stage, "deploy_core_contracts");
  assert.deepEqual(draft.requests[0].expectedAddresses, {
    registry: addresses.registry,
    implementation: addresses.implementation,
    factory: addresses.factory,
  });
  assert.equal(draft.requests[1].stage, "configure_sources_and_roles");
  assert.equal(draft.requests[2].stage, "smoke_usdc_spend");
  assert.equal(draft.requests[2].usdc.address, addresses.usdc);
});

test("input requestDigest cannot override the generated digest", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            requestDigest: `sha256:${"0".repeat(64)}`,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "REQUEST_DIGEST_INPUT_FORBIDDEN",
  );
});

test("missing or placeholder public inputs fail closed before draft generation", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            coreArtifacts: ["TODO"],
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "FIELD_INVALID"
      && error.path === "stages.deploy_core_contracts.coreArtifacts",
  );

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          configure_sources_and_roles: {
            ...validStages().configure_sources_and_roles,
            transactions: [{ to: addresses.registry, function: "placeholder source config" }],
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "FIELD_INVALID"
      && error.path === "stages.configure_sources_and_roles.transactions",
  );
});

test("smoke USDC facts must match Arc Testnet official token", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          smoke_usdc_spend: {
            ...validStages().smoke_usdc_spend,
            usdc: {
              address: "0xd234567890abcdef1234567890abcdef12345678",
              chainId: 1,
              decimals: 18,
            },
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "USDC_UNSUPPORTED",
  );
});

test("secret-shaped input fails closed without echoing the secret", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: [{ note: "sk-live-this-value-must-not-appear" }],
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationRequestDraftError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes("sk-live-this-value-must-not-appear"), false);
      return true;
    },
  );
});

test("unknown keys inside a stage fail closed", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            unexpected: true,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "UNKNOWN_FIELD"
      && error.path === "stages.deploy_core_contracts.unexpected",
  );
});

test("sensitive stage keys fail closed without echoing raw 32-byte values", () => {
  const secret = `0x${"1".repeat(64)}`;

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            privateKey: secret,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationRequestDraftError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.stages.deploy_core_contracts.privateKey");
      assert.equal(String(error.message).includes(secret), false);
      return true;
    },
  );
});

test("unknown keys inside nested stage objects fail closed", () => {
  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            expectedAddresses: {
              ...validStages().deploy_core_contracts.expectedAddresses,
              unexpected: addresses.payout,
            },
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "UNKNOWN_FIELD"
      && error.path === "stages.deploy_core_contracts.expectedAddresses.unexpected",
  );

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          smoke_usdc_spend: {
            ...validStages().smoke_usdc_spend,
            usdc: {
              ...validStages().smoke_usdc_spend.usdc,
              unexpected: "public-extra",
            },
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "UNKNOWN_FIELD"
      && error.path === "stages.smoke_usdc_spend.usdc.unexpected",
  );
});

test("public sourceId bytes32 remains valid", () => {
  const sourceId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const draft = draftFor({
    stages: validStages({
      configure_sources_and_roles: {
        ...validStages().configure_sources_and_roles,
        sourceConfigurationChanges: [
          {
            ...validStages().configure_sources_and_roles.sourceConfigurationChanges[0],
            args: {
              ...validStages().configure_sources_and_roles.sourceConfigurationChanges[0].args,
              sourceId,
            },
          },
        ],
      },
    }),
  });

  assert.equal(
    draft.requestsByStage.configure_sources_and_roles.sourceConfigurationChanges[0].args.sourceId,
    sourceId,
  );
});

test("array extra sensitive key names fail closed without echoing values", () => {
  const secret = "this-value-must-not-appear";
  const transactions = [...validStages().deploy_core_contracts.transactions];
  transactions.privateKey = secret;

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationRequestDraftError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.privateKey");
      assert.equal(String(error.message).includes(secret), false);
      return true;
    },
  );
});

test("array extra raw 32-byte values fail closed without echoing values", () => {
  const secret = `0x${"f".repeat(64)}`;
  const transactions = [...validStages().deploy_core_contracts.transactions];
  transactions.note = secret;

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationRequestDraftError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.note");
      assert.equal(String(error.message).includes(secret), false);
      return true;
    },
  );
});

test("array extra accessor and non-enumerable properties fail closed without executing getters", () => {
  let getterExecuted = false;
  const accessorTransactions = [...validStages().deploy_core_contracts.transactions];
  Object.defineProperty(accessorTransactions, "memo", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return "public";
    },
  });

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: accessorTransactions,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions.memo",
  );
  assert.equal(getterExecuted, false);

  const hiddenTransactions = [...validStages().deploy_core_contracts.transactions];
  Object.defineProperty(hiddenTransactions, "memo", {
    enumerable: false,
    value: "public",
  });

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: hiddenTransactions,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions.memo",
  );
});

test("array extra ordinary enumerable data properties fail closed", () => {
  const transactions = [...validStages().deploy_core_contracts.transactions];
  transactions.memo = "public-but-not-an-array-index";

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts.transactions.memo",
  );
});

test("array extra public-looking sourceId does not widen the bytes32 allowance", () => {
  const sourceId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sourceConfigurationChanges = [...validStages().configure_sources_and_roles.sourceConfigurationChanges];
  sourceConfigurationChanges.sourceId = sourceId;

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          configure_sources_and_roles: {
            ...validStages().configure_sources_and_roles,
            sourceConfigurationChanges,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "SECRET_SHAPED_INPUT"
      && error.path === "input.stages.configure_sources_and_roles.sourceConfigurationChanges.sourceId",
  );
});

test("array extra requestDigest cannot override generated digest", () => {
  const transactions = [...validStages().deploy_core_contracts.transactions];
  transactions.requestDigest = `sha256:${"0".repeat(64)}`;

  assert.throws(
    () =>
      draftFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "REQUEST_DIGEST_INPUT_FORBIDDEN"
      && error.path === "input.stages.deploy_core_contracts.transactions.requestDigest",
  );
});

test("unknown top-level keys and stages fail closed", () => {
  assert.throws(
    () =>
      buildDeploymentAuthorizationRequestDrafts({
        change,
        chainId,
        stages: validStages(),
        surprise: true,
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "UNKNOWN_TOP_LEVEL_KEY",
  );

  assert.throws(
    () =>
      buildDeploymentAuthorizationRequestDrafts({
        change,
        chainId,
        stages: {
          deploy_everything_now: {},
        },
      }),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "UNKNOWN_STAGE",
  );
});

test("null-prototype public input containers fail closed as non-plain objects", () => {
  const nullPrototypeInput = Object.assign(Object.create(null), {
    change,
    chainId,
    stages: validStages(),
  });

  assert.throws(
    () => buildDeploymentAuthorizationRequestDrafts(nullPrototypeInput),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  const nestedNullPrototypeInput = {
    change,
    chainId,
    stages: {
      ...validStages(),
      deploy_core_contracts: Object.assign(
        Object.create(null),
        validStages().deploy_core_contracts,
      ),
    },
  };

  assert.throws(
    () => buildDeploymentAuthorizationRequestDrafts(nestedNullPrototypeInput),
    (error) =>
      error instanceof DeploymentAuthorizationRequestDraftError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts",
  );
});

test("CLI reads stdin JSON and prints the local draft", async () => {
  let stdout = "";
  let stderr = "";
  const result = await runCli(
    [],
    {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    },
    JSON.stringify({ change, chainId, stages: validStages() }),
  );

  assert.equal(result.ok, true);
  assert.equal(stderr, "");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.change, change);
  assert.equal(parsed.readyToAskAuthorization, true);
  assert.equal(parsed.requests.length, 3);
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

  const result = await runCli(
    [],
    streams,
    JSON.stringify({ change, chainId, stages: validStages() }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
});

test("implementation source stays local-only and non-authorizing", async () => {
  const source = await readFile(
    new URL("./deployment-authorization-request-draft.mjs", import.meta.url),
    "utf8",
  );
  const forbidden = [
    ["process.env", /process\.env/u],
    ["child_process", /child_process/u],
    ["exec(", /exec\(/u],
    ["spawn(", /spawn\(/u],
    ["fork(", /fork\(/u],
    ["fetch(", /fetch\(/u],
    ["http://", /http:\/\//u],
    ["https://", /https:\/\//u],
    [".env.local", /\.env\.local/u],
    ["git status", /git status/u],
    ["--broadcast", /--broadcast/u],
    ["forge command", /\bforge\b/u],
    ["cast command", /\bcast\b/u],
    ["rpcUrl", /rpcUrl/u],
    ["privateKey", /privateKey/u],
    ["readFile", /readFile/u],
    ["writeFile", /writeFile/u],
    ["appendFile", /appendFile/u],
  ];

  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden primitive leaked: ${label}`);
  }
});
