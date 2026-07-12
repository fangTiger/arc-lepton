import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DeploymentAuthorizationInputGapError,
  buildDeploymentAuthorizationInputGapReport,
  runCli,
} from "./deployment-authorization-input-gap.mjs";

const change = "onchain-research-escrow";
const chainId = 5042002;
const commit = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"0123456789abcdef".repeat(4)}`;
const publicSourceId = `0x${"ab".repeat(32)}`;

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
      artifacts: {
        registry: { name: "DataSourceRegistry", hash: digest },
        implementation: { name: "ResearchEscrow", hash: digest },
        factory: { name: "ResearchEscrowFactory", hash: digest },
      },
      transactions: [{ to: null, description: "deploy Registry" }],
      estimatedGas: "1234567",
      maxUsdcUnits: "0",
      requestDigest: digest,
    },
    configure_sources_and_roles: {
      commit,
      targetAddresses: {
        registry: addresses.registry,
        factory: addresses.factory,
      },
      sourceConfigurationChanges: [{ source: "whale-flow", payout: addresses.payout }],
      roleChanges: [{ role: "FUNDING_SIGNER_ROLE", grantee: addresses.fundingSigner }],
      factoryGovernanceSafe: addresses.factorySafe,
      registryGovernanceSafe: addresses.registrySafe,
      sourceAdmin: addresses.sourceAdmin,
      fundingSigner: addresses.fundingSigner,
      intentSigner: addresses.intentSigner,
      settler: addresses.settler,
      estimatedGas: "2345678",
      maxUsdcUnits: "0",
      requestDigest: digest,
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
      steps: ["approve", "createAndFund", "activate", "settleBatch", "close"],
      maxUsdcUnits: "1000000",
      estimatedGas: "3456789",
      requestDigest: digest,
    },
  };

  return {
    ...stages,
    ...overrides,
  };
}

function reportFor(input) {
  return buildDeploymentAuthorizationInputGapReport({
    change,
    chainId,
    ...input,
  });
}

function missingPaths(stage) {
  return stage.missingInputs.map((entry) => entry.path);
}

test("empty and partial stages report missing public inputs and collect action", () => {
  const report = reportFor({
    stages: {
      deploy_core_contracts: {
        commit,
      },
    },
  });

  assert.equal(report.readyToRequestAuthorization, false);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
  assert.equal(report.goalCompleteAllowed, false);
  assert.equal(report.summary.totalStages, 3);
  assert.equal(report.summary.readyStages, 0);
  assert.equal(report.summary.nextAction, "collect_public_inputs");
  assert.equal(report.stages.deploy_core_contracts.readyToRequestAuthorization, false);
  assert.ok(missingPaths(report.stages.deploy_core_contracts).includes("deployer"));
  assert.ok(missingPaths(report.stages.configure_sources_and_roles).includes("commit"));
  assert.ok(missingPaths(report.stages.smoke_usdc_spend).includes("usdc.address"));
});

test("complete public inputs allow only building stage-scoped authorization requests", () => {
  const report = reportFor({
    stages: validStages(),
  });

  assert.equal(report.readyToRequestAuthorization, true);
  assert.equal(report.summary.readyStages, 3);
  assert.equal(report.summary.missingInputsCount, 0);
  assert.equal(report.summary.nextAction, "build_stage_scoped_authorization_requests");
  assert.equal(report.deployAllowed, false);
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.goalCompleteAllowed, false);
  assert.equal(report.safety.notAuthorizationRecord, true);
  assert.equal(report.safety.notTaskCompletionAuthority, true);
  assert.equal(report.stages.smoke_usdc_spend.readinessOnly, true);
});

test("placeholder commit digest address and strings cannot make a stage ready", () => {
  const report = reportFor({
    stages: validStages({
      deploy_core_contracts: {
        ...validStages().deploy_core_contracts,
        commit: "TODO",
        deployer: "0x1111111111111111111111111111111111111111",
        expectedAddresses: {
          registry: "TBD",
          implementation: addresses.implementation,
          factory: addresses.factory,
        },
        requestDigest: `sha256:${"1".repeat(64)}`,
      },
    }),
  });

  assert.equal(report.readyToRequestAuthorization, false);
  assert.equal(report.stages.deploy_core_contracts.readyToRequestAuthorization, false);
  const paths = missingPaths(report.stages.deploy_core_contracts);
  assert.ok(paths.includes("commit"));
  assert.ok(paths.includes("deployer"));
  assert.ok(paths.includes("expectedAddresses.registry"));
  assert.ok(paths.includes("requestDigest"));
});

test("nested placeholder strings inside records and arrays keep stages unready", () => {
  const report = reportFor({
    stages: validStages({
      deploy_core_contracts: {
        ...validStages().deploy_core_contracts,
        artifacts: {
          registry: { name: "DataSourceRegistry", hash: "TODO" },
          implementation: { name: "ResearchEscrow", hash: digest },
          factory: { name: "ResearchEscrowFactory", hash: digest },
        },
        transactions: [{ description: "placeholder deploy tx" }],
      },
      configure_sources_and_roles: {
        ...validStages().configure_sources_and_roles,
        sourceConfigurationChanges: [{ source: "TBD", payout: addresses.payout }],
      },
    }),
  });

  assert.equal(report.readyToRequestAuthorization, false);
  assert.equal(report.stages.deploy_core_contracts.readyToRequestAuthorization, false);
  assert.equal(report.stages.configure_sources_and_roles.readyToRequestAuthorization, false);
  assert.ok(missingPaths(report.stages.deploy_core_contracts).includes("artifacts.registry"));
  assert.ok(missingPaths(report.stages.deploy_core_contracts).includes("transactions"));
  assert.ok(missingPaths(report.stages.configure_sources_and_roles).includes("sourceConfigurationChanges"));
});

test("smoke USDC chain and decimals must match Arc Testnet public token facts", () => {
  const report = reportFor({
    stages: validStages({
      smoke_usdc_spend: {
        ...validStages().smoke_usdc_spend,
        usdc: {
          address: addresses.usdc,
          chainId: 1,
          decimals: 18,
        },
      },
    }),
  });

  assert.equal(report.readyToRequestAuthorization, false);
  assert.equal(report.stages.smoke_usdc_spend.readyToRequestAuthorization, false);
  const paths = missingPaths(report.stages.smoke_usdc_spend);
  assert.ok(paths.includes("usdc.chainId"));
  assert.ok(paths.includes("usdc.decimals"));
});

test("unknown top-level keys and unknown stages fail closed", () => {
  assert.throws(
    () =>
      buildDeploymentAuthorizationInputGapReport({
        change,
        chainId,
        stages: {},
        surprise: true,
      }),
    (error) =>
      error instanceof DeploymentAuthorizationInputGapError &&
      error.code === "UNKNOWN_TOP_LEVEL_KEY",
  );

  assert.throws(
    () =>
      reportFor({
        stages: {
          deploy_everything_now: {},
        },
      }),
    (error) =>
      error instanceof DeploymentAuthorizationInputGapError &&
      error.code === "UNKNOWN_STAGE",
  );
});

test("secret-shaped input fails closed without echoing the secret", () => {
  assert.throws(
    () =>
      reportFor({
        stages: {
          deploy_core_contracts: {
            commit,
            deployer: "sk-live-this-value-must-not-appear",
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes("sk-live-this-value-must-not-appear"), false);
      return true;
    },
  );
});

test("sensitive stage key names fail closed without echoing values", () => {
  const sensitiveKeys = [
    "privateKey",
    "private_key",
    "rpcUrl",
    "credentialedRpc",
    "mnemonic",
    "secret",
    "token",
    "authorization",
    "password",
  ];
  const secretFreeValue = "do-not-echo-sensitive-key-value";

  for (const key of sensitiveKeys) {
    assert.throws(
      () =>
        reportFor({
          stages: validStages({
            deploy_core_contracts: {
              ...validStages().deploy_core_contracts,
              [key]: secretFreeValue,
            },
          }),
        }),
      (error) => {
        assert.ok(error instanceof DeploymentAuthorizationInputGapError);
        assert.equal(error.code, "SECRET_SHAPED_INPUT");
        assert.equal(String(error.message).includes(secretFreeValue), false);
        return true;
      },
      `expected sensitive key to fail closed: ${key}`,
    );
  }
});

test("nested sensitive key names inside records and arrays fail closed", () => {
  const secretFreeValue = "nested-value-must-not-echo";

  assert.throws(
    () =>
      reportFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: [
              {
                description: "deploy Registry",
                metadata: { private_key: secretFreeValue },
              },
            ],
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(String(error.message).includes(secretFreeValue), false);
      return true;
    },
  );
});

test("raw 32-byte secret-shaped values fail closed outside public bytes32 paths", () => {
  const rawSecrets = [
    `0x${"cd".repeat(32)}`,
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ];

  for (const rawSecret of rawSecrets) {
    assert.throws(
      () =>
        reportFor({
          stages: validStages({
            deploy_core_contracts: {
              ...validStages().deploy_core_contracts,
              transactions: [
                {
                  description: "deploy Registry",
                  unsignedPayloadHash: rawSecret,
                },
              ],
            },
          }),
        }),
      (error) => {
        assert.ok(error instanceof DeploymentAuthorizationInputGapError);
        assert.equal(error.code, "SECRET_SHAPED_INPUT");
        assert.equal(String(error.message).includes(rawSecret), false);
        return true;
      },
    );
  }
});

test("public sourceId bytes32 remains allowed in authorization input gap", () => {
  const report = reportFor({
    stages: validStages({
      configure_sources_and_roles: {
        ...validStages().configure_sources_and_roles,
        sourceConfigurationChanges: [
          {
            sourceId: publicSourceId,
            payout: addresses.payout,
            maxUnitPrice: "1000000",
            active: true,
          },
          {
            args: {
              sourceId: publicSourceId,
              payout: addresses.payout,
              maxUnitPrice: "1000000",
              active: true,
            },
          },
        ],
      },
    }),
  });

  assert.equal(report.stages.configure_sources_and_roles.readyToRequestAuthorization, true);
  assert.equal(report.readyToRequestAuthorization, true);
});

test("array extra sensitive key names fail closed without echoing values", () => {
  const transactions = [{ to: null, description: "deploy Registry" }];
  const secretFreeValue = "array-extra-key-value-must-not-echo";
  transactions.privateKey = secretFreeValue;

  assert.throws(
    () =>
      reportFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.privateKey");
      assert.equal(String(error.message).includes(secretFreeValue), false);
      return true;
    },
  );
});

test("array extra secret-shaped values fail closed without echoing values", () => {
  const transactions = [{ to: null, description: "deploy Registry" }];
  const rawSecret = `0x${"ef".repeat(32)}`;
  transactions.unsignedPayloadHash = rawSecret;

  assert.throws(
    () =>
      reportFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.unsignedPayloadHash");
      assert.equal(String(error.message).includes(rawSecret), false);
      return true;
    },
  );
});

test("array accessor and non-enumerable extra properties fail closed without running getters", () => {
  const accessorTransactions = [{ to: null, description: "deploy Registry" }];
  let getterCalled = false;
  Object.defineProperty(accessorTransactions, "metadata", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "getter-value-must-not-be-read";
    },
  });

  assert.throws(
    () =>
      reportFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: accessorTransactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.metadata");
      assert.equal(getterCalled, false);
      return true;
    },
  );
  assert.equal(getterCalled, false);

  const nonEnumerableTransactions = [{ to: null, description: "deploy Registry" }];
  Object.defineProperty(nonEnumerableTransactions, "metadata", {
    enumerable: false,
    value: "non-enumerable-value-must-not-matter",
  });

  assert.throws(
    () =>
      reportFor({
        stages: validStages({
          deploy_core_contracts: {
            ...validStages().deploy_core_contracts,
            transactions: nonEnumerableTransactions,
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationInputGapError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "input.stages.deploy_core_contracts.transactions.metadata");
      return true;
    },
  );
});

test("plain JSON arrays and public sourceId bytes32 array entries remain allowed", () => {
  const stages = validStages({
    configure_sources_and_roles: {
      ...validStages().configure_sources_and_roles,
      sourceConfigurationChanges: [
        {
          sourceId: publicSourceId,
          payout: addresses.payout,
          maxUnitPrice: "1000000",
          active: true,
        },
      ],
    },
  });

  const report = reportFor({ stages });

  assert.equal(report.readyToRequestAuthorization, true);
  assert.equal(report.stages.deploy_core_contracts.readyToRequestAuthorization, true);
  assert.equal(report.stages.configure_sources_and_roles.readyToRequestAuthorization, true);
});

test("null-prototype public input containers fail closed as non-plain objects", () => {
  const nullPrototypeInput = Object.assign(Object.create(null), {
    change,
    chainId,
    stages: validStages(),
  });

  assert.throws(
    () => buildDeploymentAuthorizationInputGapReport(nullPrototypeInput),
    (error) =>
      error instanceof DeploymentAuthorizationInputGapError
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
    () => buildDeploymentAuthorizationInputGapReport(nestedNullPrototypeInput),
    (error) =>
      error instanceof DeploymentAuthorizationInputGapError
      && error.code === "INPUT_INVALID"
      && error.path === "input.stages.deploy_core_contracts",
  );
});

test("CLI reads stdin JSON and writes the local gap report", async () => {
  let stdout = "";
  let stderr = "";
  const result = await runCli(
    [],
    {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    },
    JSON.stringify({ change, chainId, stages: {} }),
  );

  assert.equal(result.ok, true);
  assert.equal(stderr, "");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.change, change);
  assert.equal(parsed.chainId, chainId);
  assert.equal(parsed.readyToRequestAuthorization, false);
  assert.equal(parsed.summary.nextAction, "collect_public_inputs");
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
    JSON.stringify({ change, chainId, stages: {} }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assert.equal(getterExecuted, false);
  assert.match(stderr, /STREAMS_INVALID/u);
  assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
});

test("implementation source keeps forbidden deployment primitives out", async () => {
  const source = await readFile(
    new URL("./deployment-authorization-input-gap.mjs", import.meta.url),
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
  ];

  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden primitive leaked: ${label}`);
  }
});
