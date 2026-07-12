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
import { buildAuthorizationRequests } from "./deployment-authorization-gate.mjs";
import {
  DeploymentAuthorizationBriefingError,
  buildAuthorizationBriefing,
  buildAuthorizationBriefings,
  runCli,
} from "./deployment-authorization-briefing.mjs";

const BRIEFING_CLI = new URL("./deployment-authorization-briefing.mjs", import.meta.url).pathname;
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

function evidence() {
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

function requests() {
  return buildAuthorizationRequests(evidence());
}

function requestByStage(stage) {
  return requests().find((request) => request.stage === stage);
}

function expectBriefingError(fn, code) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationBriefingError);
      assert.equal(error.name, "DeploymentAuthorizationBriefingError");
      assert.equal(error.code, code);
      assert.equal(typeof error.path, "string");
      return true;
    },
  );
}

function expectBriefingErrorDetails(fn, { code, pathIncludes, forbidden = [] }) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationBriefingError);
      assert.equal(error.name, "DeploymentAuthorizationBriefingError");
      assert.equal(error.code, code);
      assert.ok(
        error.path.includes(pathIncludes),
        `error path ${error.path} must include ${pathIncludes}`,
      );
      const rendered = `${error.code} ${error.path} ${error.message}`;
      for (const secret of forbidden) {
        assert.ok(!rendered.includes(secret), `error must not echo ${secret}`);
      }
      return true;
    },
  );
}

async function withJsonFixture(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "arc-authorization-briefing-"));
  const file = join(dir, "request.json");
  try {
    const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    await writeFile(file, body, "utf8");
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runBriefingCli(args) {
  return spawnSync(process.execPath, [BRIEFING_CLI, ...args], {
    cwd: new URL("../../", import.meta.url).pathname,
    encoding: "utf8",
    env: {
      ARC_RECORDER_PRIVATE_KEY: "super-secret-env-value-that-must-not-print",
      ARC_RPC_URL: "https://user:password@example.invalid",
    },
  });
}

function assertCliFailure(result, code, path, forbidden = []) {
  assert.notEqual(result.status, 0, "CLI must exit non-zero");
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(`\\b${code}\\b`));
  assert.match(result.stderr, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const secret of forbidden) {
    assert.ok(!result.stderr.includes(secret), `stderr must not echo ${secret}`);
    assert.ok(!result.stdout.includes(secret), `stdout must not echo ${secret}`);
  }
}

function assertExactAuthorizationReplyTemplate(stage) {
  const request = requestByStage(stage);
  const briefing = buildAuthorizationBriefing(request);
  const expectedPhrase =
    `我明确授权 stage=${request.stage} chainId=${request.chainId} commit=${request.commit} ` +
    `requestDigest=${request.requestDigest} estimatedGas=${request.estimatedGas} ` +
    `maxUsdcUnits=${request.maxUsdcUnits}`;

  assert.ok(briefing.includes("## 精确授权回复模板"), "briefing must render exact reply template section");
  assert.ok(briefing.includes(expectedPhrase), "briefing must render copyable exact authorization phrase");
  assert.ok(
    briefing.includes("briefing/模板/CLI 输出本身不是授权记录"),
    "briefing must state template output is not authorization evidence",
  );
  assert.ok(
    briefing.includes("只有用户在当前会话中针对同一字段回复精确授权"),
    "briefing must require same-session exact reply for identical fields",
  );
  assert.ok(
    briefing.includes("任何字段变化都要重新生成并重新授权"),
    "briefing must require regeneration and reauthorization after any field change",
  );
}

test("renders an exact public authorization reply template for every stage", () => {
  for (const stage of [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]) {
    assertExactAuthorizationReplyTemplate(stage);
  }
});

test("renders deploy_core_contracts authorization briefing with boundaries", () => {
  const briefing = buildAuthorizationBriefing(requestByStage("deploy_core_contracts"));

  for (const phrase of [
    "deploy_core_contracts",
    "chainId 5042002",
    COMMIT,
    "requestDigest",
    "estimatedGas",
    "maxUsdcUnits",
    DEPLOYER,
    REGISTRY,
    IMPLEMENTATION,
    FACTORY,
    "src/factory/ResearchEscrowFactory.sol:ResearchEscrowFactory",
    "只授权核心部署与 bindFactory",
    "不授权 source/role/smoke",
    "不得 --broadcast",
    "参数变化需要重新授权",
  ]) {
    assert.ok(briefing.includes(phrase), `briefing must mention ${phrase}`);
  }
});

test("CLI renders one public request JSON to stdout", async () => {
  const request = requestByStage("deploy_core_contracts");

  await withJsonFixture(request, async (file) => {
    const result = runBriefingCli([file]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, buildAuthorizationBriefing(request));
    assert.ok(!result.stdout.includes("super-secret-env-value-that-must-not-print"));
    assert.ok(!result.stdout.includes("user:password"));
  });
});

test("CLI rejects streams wrapper accessors without executing getters", async () => {
  const request = requestByStage("deploy_core_contracts");

  await withJsonFixture(request, async (file) => {
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

    const code = await runCli(["node", BRIEFING_CLI, file], streams);

    assert.equal(code, 1);
    assert.equal(getterExecuted, false);
    assert.match(stderr, /STREAMS_INVALID/u);
    assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
  });
});

test("CLI renders wrapped request arrays in order with a markdown separator", async () => {
  const selected = [
    requestByStage("deploy_core_contracts"),
    requestByStage("smoke_usdc_spend"),
  ];

  await withJsonFixture({ requests: selected }, async (file) => {
    const result = runBriefingCli([file]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      selected.map((request) => buildAuthorizationBriefing(request)).join("\n---\n\n"),
    );
    assert.ok(result.stdout.indexOf("deploy_core_contracts") < result.stdout.indexOf("smoke_usdc_spend"));
  });
});

test("CLI fails closed with stable code/path and without secret echo", async () => {
  assertCliFailure(runBriefingCli([]), "ARGUMENT_REQUIRED", "argv[2]");
  assertCliFailure(runBriefingCli(["/tmp/arc-lepton-missing-authorization-request.json"]), "FILE_READ_FAILED", "argv[2]");

  await withJsonFixture("{", async (file) => {
    assertCliFailure(runBriefingCli([file]), "JSON_INVALID", "input");
  });

  await withJsonFixture(
    {
      ...requestByStage("deploy_core_contracts"),
      privateKey: "super-secret-json-value",
    },
    async (file) => {
      assertCliFailure(runBriefingCli([file]), "SECRET_FIELD", "privateKey", ["super-secret-json-value"]);
    },
  );

  await withJsonFixture(
    {
      ...requestByStage("deploy_core_contracts"),
      stage: "unknown_stage",
    },
    async (file) => {
      assertCliFailure(runBriefingCli([file]), "STAGE_UNSUPPORTED", "request.stage", ["unknown_stage"]);
    },
  );
});

test("renders configure_sources_and_roles authorization briefing with source and role diffs", () => {
  const briefing = buildAuthorizationBriefing(requestByStage("configure_sources_and_roles"));

  for (const phrase of [
    "configure_sources_and_roles",
    "chainId 5042002",
    "targetAddresses",
    SOURCE_ID,
    PAYOUT.toLowerCase(),
    "createSource(bytes32,address,uint256,bool)",
    "SOURCE_ADMIN_ROLE",
    SOURCE_ADMIN.toLowerCase(),
    "SETTLER_ROLE",
    SETTLER.toLowerCase(),
    "revoke",
    DEPLOYER,
    "不得复用部署授权",
    "不授权 test USDC smoke",
    "不得 --broadcast",
  ]) {
    assert.ok(briefing.includes(phrase), `briefing must mention ${phrase}`);
  }
});

test("renders smoke_usdc_spend authorization briefing with test USDC boundaries", () => {
  const briefing = buildAuthorizationBriefing(requestByStage("smoke_usdc_spend"));

  for (const phrase of [
    "smoke_usdc_spend",
    "chainId 5042002",
    SMOKE_BUYER.toLowerCase(),
    PAYOUT.toLowerCase(),
    FACTORY,
    ARC_TESTNET_USDC_ADDRESS,
    "Circle USDC Contract Addresses",
    "decimals: 6",
    "250000",
    "approve",
    "createAndFund",
    "activate",
    "settleBatch",
    "close/refund",
    "单独 test USDC 授权",
    "direct EOA/no AA/no paymaster",
    "不得 --broadcast",
  ]) {
    assert.ok(briefing.includes(phrase), `briefing must mention ${phrase}`);
  }
});

test("fails closed for unknown stage, missing fields, or secret-shaped request fields", () => {
  expectBriefingError(
    () => buildAuthorizationBriefing({ ...requestByStage("deploy_core_contracts"), stage: "unexpected" }),
    "STAGE_UNSUPPORTED",
  );
  expectBriefingError(
    () => {
      const request = structuredClone(requestByStage("deploy_core_contracts"));
      delete request.expectedAddresses.factory;
      buildAuthorizationBriefing(request);
    },
    "STRING_INVALID",
  );
  expectBriefingError(
    () => buildAuthorizationBriefing({
      ...requestByStage("deploy_core_contracts"),
      privateKey: `0x${"ab".repeat(32)}`,
    }),
    "SECRET_FIELD",
  );
  expectBriefingError(
    () => buildAuthorizationBriefing({
      ...requestByStage("deploy_core_contracts"),
      notes: "https://user:password@example.invalid",
    }),
    "CREDENTIAL_URL",
  );
});

test("fails closed when transactions array contains extra properties without executing accessors", () => {
  const requestWithPrivateKey = structuredClone(requestByStage("deploy_core_contracts"));
  let getterExecuted = false;
  Object.defineProperty(requestWithPrivateKey.transactions, "privateKey", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return "super-secret-array-private-key";
    },
  });

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(requestWithPrivateKey),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request.transactions.privateKey",
      forbidden: ["super-secret-array-private-key"],
    },
  );
  assert.equal(getterExecuted, false, "array extra property getter must not execute");

  const requestWithMemo = structuredClone(requestByStage("deploy_core_contracts"));
  requestWithMemo.transactions.memo = "super-secret-array-memo";

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(requestWithMemo),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request.transactions.memo",
      forbidden: ["super-secret-array-memo"],
    },
  );
});

test("fails closed for non-enumerable and accessor request properties without executing getters", () => {
  const requestWithHiddenProperty = structuredClone(requestByStage("deploy_core_contracts"));
  Object.defineProperty(requestWithHiddenProperty, "memo", {
    enumerable: false,
    value: "super-secret-hidden-memo",
  });

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(requestWithHiddenProperty),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request.memo",
      forbidden: ["super-secret-hidden-memo"],
    },
  );

  const requestWithAccessor = structuredClone(requestByStage("deploy_core_contracts"));
  let getterExecuted = false;
  Object.defineProperty(requestWithAccessor, "notes", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return "super-secret-accessor-notes";
    },
  });

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(requestWithAccessor),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request.notes",
      forbidden: ["super-secret-accessor-notes"],
    },
  );
  assert.equal(getterExecuted, false, "request accessor must not execute");
});

test("fails closed for symbol keys in public request input", () => {
  const request = structuredClone(requestByStage("deploy_core_contracts"));
  request[Symbol("memo")] = "super-secret-symbol-value";

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(request),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request",
      forbidden: ["super-secret-symbol-value"],
    },
  );
});

test("fails closed for non-plain roots and circular request graphs", () => {
  class RequestRecord {
    constructor(request) {
      Object.assign(this, request);
    }
  }

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(new RequestRecord(requestByStage("deploy_core_contracts"))),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request",
    },
  );

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(
      Object.assign(Object.create(null), requestByStage("deploy_core_contracts")),
    ),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request",
    },
  );

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefings(
      Object.assign(new RequestRecord({}), {
        requests: [requestByStage("deploy_core_contracts")],
      }),
    ),
    {
      code: "INPUT_INVALID",
      pathIncludes: "input",
    },
  );

  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(null),
    {
      code: "RECORD_INVALID",
      pathIncludes: "request",
    },
  );

  const circular = structuredClone(requestByStage("deploy_core_contracts"));
  circular.review = { parent: circular };
  expectBriefingErrorDetails(
    () => buildAuthorizationBriefing(circular),
    {
      code: "INPUT_INVALID",
      pathIncludes: "request.review.parent",
    },
  );
});
