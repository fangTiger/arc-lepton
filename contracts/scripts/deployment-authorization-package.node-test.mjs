import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { buildDeploymentManifest } from "./deployment-manifest.mjs";
import { buildDeploymentEvidencePackage } from "./deployment-evidence-package.mjs";
import {
  DeploymentAuthorizationPackageError,
  buildDeploymentAuthorizationPackage,
  runCli,
} from "./deployment-authorization-package.mjs";

const PACKAGE_CLI = new URL("./deployment-authorization-package.mjs", import.meta.url).pathname;
const ROOT = new URL("../../", import.meta.url).pathname;

const COMMIT = "a".repeat(40);
const FOUNDRY_COMMIT = "b".repeat(40);
const OZ_REVISION = "c".repeat(40);
const DEPLOYER = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333";
const FACTORY = "0x4444444444444444444444444444444444444444";
const FACTORY_GOVERNANCE = "0x5555555555555555555555555555555555555555";
const REGISTRY_GOVERNANCE = "0x6666666666666666666666666666666666666666";
const SOURCE_ADMIN = "0x7777777777777777777777777777777777777777";
const FUNDING_SIGNER = "0x8888888888888888888888888888888888888888";
const INTENT_SIGNER = "0x9999999999999999999999999999999999999999";
const SETTLER = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const SMOKE_BUYER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const PAYOUT = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const SOURCE_ID = `0x${"12".repeat(32)}`;
const HASH_A = `0x${"01".repeat(32)}`;
const HASH_B = `0x${"02".repeat(32)}`;
const HASH_C = `0x${"03".repeat(32)}`;
const HASH_D = `0x${"04".repeat(32)}`;
const HASH_E = `0x${"05".repeat(32)}`;
const HASH_F = `0x${"06".repeat(32)}`;
const HASH_G = `0x${"07".repeat(32)}`;
const HASH_H = `0x${"08".repeat(32)}`;

function artifactHashes(runtimeHash) {
  return {
    initCodeHash: HASH_A,
    creationBytecodeHash: HASH_B,
    compiledDeployedBytecodeHash: HASH_C,
    onchainRuntimeBytecodeHash: runtimeHash,
    abiHash: HASH_D,
    metadataHash: HASH_E,
    buildInfoHash: HASH_F,
    sourceBundleHash: HASH_G,
  };
}

function deployment(txHash, transactionIndex) {
  return {
    txHash,
    status: "success",
    blockNumber: 8_000_000,
    blockHash: HASH_H,
    transactionIndex,
  };
}

function core({ name, type, address, sourceFile, txHash, constructorArguments, initializerArguments }) {
  return {
    name,
    type,
    address,
    creator: DEPLOYER,
    deployment: deployment(txHash, 1),
    artifact: {
      fullyQualifiedName: `${sourceFile}:${name}`,
      sourceFile,
    },
    constructorArguments,
    initializerArguments,
    artifactHashes: artifactHashes(HASH_A),
  };
}

function manifest() {
  return buildDeploymentManifest({
    network: "arc-testnet",
    chainId: ARC_TESTNET_CHAIN_ID,
    publicRpcNetwork: "arc-testnet-public-rpc",
    generatedAt: "2026-07-11T00:00:00.000Z",
    finalizedBlock: {
      blockNumber: 8_000_020,
      blockHash: HASH_H,
      timestamp: "2026-07-11T00:01:00.000Z",
    },
    repository: {
      name: "arc-lepton",
      remote: "https://example.invalid/arc-lepton.git",
    },
    git: {
      commit: COMMIT,
      clean: true,
      statusPorcelain: "",
      submoduleStatus: "",
    },
    deployer: DEPLOYER,
    build: {
      compiler: {
        solidityVersion: "0.8.30",
        foundryVersion: "1.5.1-stable",
        foundryCommit: FOUNDRY_COMMIT,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: false,
          evmVersion: "prague",
          metadata: {
            bytecodeHash: "ipfs",
            useLiteralContent: false,
            appendCBOR: true,
          },
          remappings: ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"],
        },
        settingsHash: HASH_D,
      },
      dependencies: {
        openZeppelin: { tag: "v5.6.1", revision: OZ_REVISION },
        lockfileHash: HASH_E,
        buildCommand: "FOUNDRY_OFFLINE=true forge build --root contracts --force",
      },
    },
    roles: {
      factoryGovernance: FACTORY_GOVERNANCE,
      registryGovernance: REGISTRY_GOVERNANCE,
      sourceAdmin: SOURCE_ADMIN,
      fundingSigner: FUNDING_SIGNER,
      intentSigner: INTENT_SIGNER,
      settler: SETTLER,
      smokeBuyer: SMOKE_BUYER,
      smokePayout: PAYOUT,
    },
    registryBinding: {
      txHash: `0x${"44".repeat(32)}`,
      blockNumber: 8_000_005,
      blockHash: HASH_H,
      logIndex: 2,
    },
    contracts: {
      registry: core({
        name: "DataSourceRegistry",
        type: "registry",
        address: REGISTRY,
        sourceFile: "src/registry/DataSourceRegistry.sol",
        txHash: `0x${"11".repeat(32)}`,
        constructorArguments: {
          raw: "0xaaaa",
          decoded: { initialAdmin: DEPLOYER },
        },
      }),
      implementation: core({
        name: "ResearchEscrow",
        type: "implementation",
        address: IMPLEMENTATION,
        sourceFile: "src/escrow/ResearchEscrow.sol",
        txHash: `0x${"22".repeat(32)}`,
        constructorArguments: { raw: "0x", decoded: {} },
        initializerArguments: { locked: true, raw: "0x", decoded: {} },
      }),
      factory: core({
        name: "ResearchEscrowFactory",
        type: "factory",
        address: FACTORY,
        sourceFile: "src/factory/ResearchEscrowFactory.sol",
        txHash: `0x${"33".repeat(32)}`,
        constructorArguments: {
          raw: "0xbbbb",
          decoded: {
            implementation: IMPLEMENTATION,
            registry: REGISTRY,
            initialAdmin: DEPLOYER,
          },
        },
      }),
    },
    externalDependencies: [
      {
        name: "Arc Testnet official USDC",
        type: "erc20",
        chainId: ARC_TESTNET_CHAIN_ID,
        address: ARC_TESTNET_USDC_ADDRESS,
        authority: "Circle USDC Contract Addresses",
        finalizedBlockNumber: 8_000_020,
        decimals: 6,
        codeHash: HASH_A,
        projectDeployment: false,
      },
    ],
    clones: [],
  });
}

function evidencePackage() {
  return buildDeploymentEvidencePackage({
    manifest: manifest(),
    sourceConfigurations: [
      {
        action: "create",
        sourceId: SOURCE_ID,
        payout: PAYOUT,
        maxUnitPrice: "1000",
        active: true,
      },
    ],
    expectedGas: {
      deployCoreContracts: "3000000",
      configureSourcesAndRoles: "1500000",
      smokeUsdcSpendUnits: "250000",
    },
    explorerBaseUrl: "https://explorer.arc-testnet.example",
    manifestOutputPath: "deployments/5042002.json",
  });
}

function expectPackageError(fn, code, path) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationPackageError);
      assert.equal(error.name, "DeploymentAuthorizationPackageError");
      assert.equal(error.code, code);
      assert.equal(error.path, path);
      return true;
    },
  );
}

async function withJsonFixture(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "arc-authorization-package-"));
  const file = join(dir, "evidence.json");
  try {
    await writeFile(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runPackageCli(args) {
  return spawnSync(process.execPath, [PACKAGE_CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ARC_DEPLOYER_PRIVATE_KEY: "super-secret-env-value-that-must-not-print",
      ARC_RPC_URL: "https://user:password@example.invalid",
    },
  });
}

function exactAuthorizationReply(request) {
  return `我明确授权 stage=${request.stage} chainId=${request.chainId} commit=${request.commit} requestDigest=${request.requestDigest} estimatedGas=${request.estimatedGas} maxUsdcUnits=${request.maxUsdcUnits}`;
}

function assertCliFailure(result, code, path, forbidden = []) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(`\\b${code}\\b`));
  assert.match(result.stderr, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const secret of forbidden) {
    assert.ok(!result.stderr.includes(secret), `stderr must not echo ${secret}`);
    assert.ok(!result.stdout.includes(secret), `stdout must not echo ${secret}`);
  }
}

test("CLI rejects streams wrapper accessors without executing getters", async () => {
  await withJsonFixture(evidencePackage(), async (file) => {
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

    const code = await runCli(["node", PACKAGE_CLI, file], streams);

    assert.equal(code, 1);
    assert.equal(getterExecuted, false);
    assert.match(stderr, /STREAMS_INVALID/u);
    assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
  });
});

test("builds a public authorization package for all stage-scoped requests", () => {
  const output = buildDeploymentAuthorizationPackage(evidencePackage());

  assert.equal(output.schemaVersion, 1);
  assert.equal(output.chainId, ARC_TESTNET_CHAIN_ID);
  assert.equal(output.commit, COMMIT);
  assert.equal(output.deployer, DEPLOYER);
  assert.equal(output.authorizationBoundaryTask, "13.1");
  assert.equal(output.nextStage, "deploy_core_contracts");
  assert.deepEqual(output.stageOrder, [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]);
  assert.equal(output.requests.length, 3);
  assert.equal(new Set(output.requests.map((request) => request.requestDigest)).size, 3);
  assert.equal(output.safety.externalWritesAuthorized, false);
  assert.equal(output.safety.broadcastAllowed, false);
  assert.equal(output.safety.requiresFreshUserAuthorization, true);
  assert.equal(output.safety.notAuthorizationRecord, true);
  assert.equal(output.safety.notPreflightProof, true);
  assert.equal(output.safety.notFinalManifestOrVerifierEvidence, true);
  assert.equal(output.safety.stageAuthorizationReuseAllowed, false);
  assert.equal(output.safety.noResponseOrAmbiguousApprovalStops, true);
  assert.equal(output.safety.inputChangeRequiresNewAuthorization, true);
  assert.deepEqual(output.safety.authorizedStages, []);
  assert.deepEqual(output.safety.stageReuseForbidden, {
    deploy_core_contracts: ["configure_sources_and_roles", "smoke_usdc_spend"],
    configure_sources_and_roles: ["deploy_core_contracts", "smoke_usdc_spend"],
    smoke_usdc_spend: ["deploy_core_contracts", "configure_sources_and_roles"],
  });
  assert.match(output.safety.note, /不能替代 13\.2 preflight/);
  assert.match(output.safety.note, /不能替代最终 manifest\/verifier/);
  assert.match(output.safety.note, /不得跨阶段复用/);
  assert.match(output.safety.note, /用户未回应或模糊同意/);
  assert.match(output.safety.note, /request\/commit\/address\/gas\/maxUsdcUnits 改变/);
  assert.match(output.packageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(output.manifestDigest, output.evidence.manifestPublication.digest);

  assert.ok(output.exactAuthorizationReplies);
  assert.deepEqual(Object.keys(output.exactAuthorizationReplies), [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]);
  for (const request of output.requests) {
    const reply = output.exactAuthorizationReplies[request.stage];
    assert.equal(reply, exactAuthorizationReply(request));
    assert.deepEqual(reply.match(/\b(?:stage|chainId|commit|requestDigest|estimatedGas|maxUsdcUnits)=/gu), [
      "stage=",
      "chainId=",
      "commit=",
      "requestDigest=",
      "estimatedGas=",
      "maxUsdcUnits=",
    ]);
    assert.ok(!reply.includes("deployer="));
    assert.ok(!reply.includes("buyer="));
    assert.ok(!reply.includes("payout="));
    assert.ok(output.briefings[request.stage].includes(request.requestDigest));
    assert.ok(output.briefings[request.stage].includes("不得 --broadcast"));
  }
});

test("package digest is stable across object key order", () => {
  const evidence = evidencePackage();
  const reordered = Object.fromEntries(Object.entries(evidence).reverse());

  assert.equal(
    buildDeploymentAuthorizationPackage(reordered).packageDigest,
    buildDeploymentAuthorizationPackage(evidence).packageDigest,
  );
});

test("fails closed when unused public evidence fields contain secrets", () => {
  const evidence = evidencePackage();
  evidence.unusedButStillPublic = {
    privateKey: "super-secret-json-value",
  };

  expectPackageError(
    () => buildDeploymentAuthorizationPackage(evidence),
    "SECRET_FIELD",
    "unusedButStillPublic.privateKey",
  );
});

test("fails closed when public evidence contains approval-shaped authorization markers", () => {
  const tamperedAuthorization = evidencePackage();
  tamperedAuthorization.authorization.approved = true;
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(tamperedAuthorization),
    "APPROVAL_FIELD",
    "authorization.approved",
  );

  const tamperedRecord = evidencePackage();
  tamperedRecord.authorizationRecord = {
    stage: "deploy_core_contracts",
    approved: true,
  };
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(tamperedRecord),
    "APPROVAL_FIELD",
    "authorizationRecord",
  );

  const output = buildDeploymentAuthorizationPackage(evidencePackage());
  assert.equal(output.safety.notAuthorizationRecord, true);
  assert.equal(output.evidence.securityScan.classification, "public");
});

test("display-shaped exact replies in evidence input never become authorization", () => {
  const evidence = evidencePackage();
  evidence.exactAuthorizationReplies = {
    deploy_core_contracts: "我明确授权 stage=deploy_core_contracts chainId=5042002 commit=bad requestDigest=sha256:bad estimatedGas=1 maxUsdcUnits=999",
  };
  evidence.authorizationText = "我明确授权 stage=deploy_core_contracts chainId=5042002 commit=bad requestDigest=sha256:bad estimatedGas=1 maxUsdcUnits=999";

  const output = buildDeploymentAuthorizationPackage(evidence);

  assert.equal(output.safety.externalWritesAuthorized, false);
  assert.equal(output.safety.broadcastAllowed, false);
  assert.equal(output.safety.notAuthorizationRecord, true);
  assert.deepEqual(output.safety.authorizedStages, []);
  for (const request of output.requests) {
    assert.equal(output.exactAuthorizationReplies[request.stage], exactAuthorizationReply(request));
  }
});

test("rejects public evidence accessors without executing getters at the package boundary", () => {
  const evidence = evidencePackage();
  let getterExecuted = false;
  Object.defineProperty(evidence, "commit", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return COMMIT;
    },
  });

  expectPackageError(
    () => buildDeploymentAuthorizationPackage(evidence),
    "INPUT_INVALID",
    "evidencePackage.commit",
  );
  assert.equal(getterExecuted, false);
});

test("rejects non-JSON-like public evidence shapes at the package boundary", () => {
  const hidden = evidencePackage();
  Object.defineProperty(hidden, "commit", {
    enumerable: false,
    value: COMMIT,
  });
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(hidden),
    "INPUT_INVALID",
    "evidencePackage.commit",
  );

  const symbolKeyed = evidencePackage();
  symbolKeyed[Symbol("hidden")] = "public evidence must not contain symbol keys";
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(symbolKeyed),
    "INPUT_INVALID",
    "evidencePackage",
  );

  const arrayWithExtraKey = evidencePackage();
  arrayWithExtraKey.authorizationStages.extra = "unexpected";
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(arrayWithExtraKey),
    "INPUT_INVALID",
    "evidencePackage.authorizationStages.extra",
  );

  const sparseArray = evidencePackage();
  delete sparseArray.authorizationStages[0];
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(sparseArray),
    "INPUT_INVALID",
    "evidencePackage.authorizationStages[0]",
  );

  const classInstance = evidencePackage();
  Object.setPrototypeOf(classInstance, { inherited: true });
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(classInstance),
    "INPUT_INVALID",
    "evidencePackage",
  );

  const nullPrototype = evidencePackage();
  Object.setPrototypeOf(nullPrototype, null);
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(nullPrototype),
    "INPUT_INVALID",
    "evidencePackage",
  );

  const cyclic = evidencePackage();
  cyclic.self = cyclic;
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(cyclic),
    "INPUT_INVALID",
    "evidencePackage.self",
  );

  const nonFinite = evidencePackage();
  nonFinite.chainId = Number.NaN;
  expectPackageError(
    () => buildDeploymentAuthorizationPackage(nonFinite),
    "INPUT_INVALID",
    "evidencePackage.chainId",
  );
});

test("CLI prints authorization package JSON and never reads env secrets", async () => {
  await withJsonFixture(evidencePackage(), async (file) => {
    const result = runPackageCli([file]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.nextStage, "deploy_core_contracts");
    assert.equal(output.requests.length, 3);
    assert.ok(output.briefings.deploy_core_contracts.includes("requestDigest"));
    assert.ok(!result.stdout.includes("super-secret-env-value-that-must-not-print"));
    assert.ok(!result.stdout.includes("user:password"));
  });
});

test("CLI errors use stable code/path and do not echo secret values", async () => {
  assertCliFailure(runPackageCli([]), "ARGUMENT_REQUIRED", "argv[2]");
  assertCliFailure(runPackageCli(["/tmp/arc-lepton-missing-authorization-evidence.json"]), "FILE_READ_FAILED", "argv[2]");

  await withJsonFixture("{", async (file) => {
    assertCliFailure(runPackageCli([file]), "JSON_INVALID", "input");
  });

  await withJsonFixture({ schemaVersion: 1 }, async (file) => {
    assertCliFailure(runPackageCli([file]), "ARRAY_INVALID", "evidencePackage.authorizationStages");
  });

  const secretEvidence = evidencePackage();
  secretEvidence.ignored = {
    providerKey: "sk-proj-super-secret-json-value",
  };
  await withJsonFixture(secretEvidence, async (file) => {
    assertCliFailure(
      runPackageCli([file]),
      "SECRET_FIELD",
      "ignored.providerKey",
      ["sk-proj-super-secret-json-value"],
    );
  });
});
