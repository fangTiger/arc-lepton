import assert from "node:assert/strict";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { buildDeploymentManifest } from "./deployment-manifest.mjs";
import { buildDeploymentEvidencePackage } from "./deployment-evidence-package.mjs";
import {
  DeploymentAuthorizationGateError,
  buildAuthorizationRequests,
  validateStageAuthorization,
} from "./deployment-authorization-gate.mjs";

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
const TX_REGISTRY = `0x${"11".repeat(32)}`;
const TX_IMPLEMENTATION = `0x${"22".repeat(32)}`;
const TX_FACTORY = `0x${"33".repeat(32)}`;
const TX_BIND = `0x${"44".repeat(32)}`;

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

function manifest({ commit = COMMIT } = {}) {
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
      commit,
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
      txHash: TX_BIND,
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
        txHash: TX_REGISTRY,
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
        txHash: TX_IMPLEMENTATION,
        constructorArguments: { raw: "0x", decoded: {} },
        initializerArguments: { locked: true, raw: "0x", decoded: {} },
      }),
      factory: core({
        name: "ResearchEscrowFactory",
        type: "factory",
        address: FACTORY,
        sourceFile: "src/factory/ResearchEscrowFactory.sol",
        txHash: TX_FACTORY,
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

function validPackageInput({ commit = COMMIT, smokeUsdcSpendUnits = "0" } = {}) {
  return {
    manifest: manifest({ commit }),
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
      smokeUsdcSpendUnits,
    },
    explorerBaseUrl: "https://explorer.arc-testnet.example",
    manifestOutputPath: "deployments/5042002.json",
  };
}

function evidence(overrides = {}) {
  return buildDeploymentEvidencePackage(validPackageInput(overrides));
}

function requestsFor(evidencePackage = evidence()) {
  return buildAuthorizationRequests(evidencePackage);
}

function requestByStage(requests, stage) {
  return requests.find((request) => request.stage === stage);
}

function authorizationFor(request, overrides = {}) {
  return {
    stage: request.stage,
    chainId: request.chainId,
    commit: request.commit,
    requestDigest: request.requestDigest,
    approved: true,
    approvedAt: "2026-07-11T01:00:00.000Z",
    operator: "captain",
    ...overrides,
  };
}

function expectGateError(fn, code) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationGateError);
      assert.equal(error.name, "DeploymentAuthorizationGateError");
      assert.equal(error.code, code);
      return true;
    },
  );
}

function expectGateErrorAt(fn, code, path, forbidden = []) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationGateError);
      assert.equal(error.name, "DeploymentAuthorizationGateError");
      assert.equal(error.code, code);
      assert.equal(error.path, path);
      for (const text of forbidden) {
        assert.ok(!error.message.includes(text), `error must not echo ${text}`);
      }
      return true;
    },
  );
}

function expectInputInvalid(fn, expectedPath) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentAuthorizationGateError);
      assert.equal(error.name, "DeploymentAuthorizationGateError");
      assert.equal(error.code, "INPUT_INVALID");
      if (expectedPath !== undefined) {
        assert.equal(error.path, expectedPath);
      }
      assert.doesNotMatch(error.message, /sk-proj|getter-leak|hidden-leak|symbol-leak/);
      return true;
    },
  );
}

function changedRequests(mutator) {
  const changedEvidence = structuredClone(evidence());
  mutator(changedEvidence);
  return buildAuthorizationRequests(changedEvidence);
}

function expectBuildGateError(mutator, code) {
  const changedEvidence = structuredClone(evidence());
  mutator(changedEvidence);
  expectGateError(
    () => buildAuthorizationRequests(changedEvidence),
    code,
  );
}

test("生成三个逐阶段新授权请求并包含部署、配置角色和 smoke 关键信息", () => {
  const requests = requestsFor();

  assert.deepEqual(requests.map((request) => request.stage), [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
  ]);
  assert.equal(new Set(requests.map((request) => request.requestDigest)).size, 3);
  for (const request of requests) {
    assert.equal(request.schemaVersion, 1);
    assert.equal(request.requiresFreshUserAuthorization, true);
    assert.equal(request.chainId, ARC_TESTNET_CHAIN_ID);
    assert.equal(request.commit, COMMIT);
    assert.match(request.requestDigest, /^sha256:[a-f0-9]{64}$/);
  }

  const deploy = requestByStage(requests, "deploy_core_contracts");
  assert.equal(deploy.deployer, DEPLOYER);
  assert.deepEqual(deploy.expectedAddresses, {
    factory: FACTORY,
    implementation: IMPLEMENTATION,
    registry: REGISTRY,
  });
  assert.ok(deploy.coreArtifacts.includes("src/factory/ResearchEscrowFactory.sol:ResearchEscrowFactory"));
  assert.ok(deploy.transactions.includes("deploy ResearchEscrowFactory"));

  const configure = requestByStage(requests, "configure_sources_and_roles");
  assert.deepEqual(configure.targetAddresses, [REGISTRY, FACTORY]);
  assert.ok(configure.sourceConfigurationChanges.some((change) =>
    change.function === "createSource(bytes32,address,uint256,bool)"
    && change.args.sourceId === SOURCE_ID));
  assert.ok(configure.roleChanges.some((change) =>
    change.action === "grant"
    && change.role === "SOURCE_ADMIN_ROLE"
    && change.account === SOURCE_ADMIN));
  assert.ok(configure.roleChanges.some((change) =>
    change.action === "revoke"
    && change.role === "DEFAULT_ADMIN_ROLE"
    && change.account === DEPLOYER));

  const smoke = requestByStage(requests, "smoke_usdc_spend");
  assert.equal(smoke.buyer, SMOKE_BUYER.toLowerCase());
  assert.equal(smoke.payout, PAYOUT.toLowerCase());
  assert.equal(smoke.maxUsdcUnits, "0");
  assert.equal(smoke.factory, FACTORY);
  assert.deepEqual(smoke.usdc, {
    address: ARC_TESTNET_USDC_ADDRESS,
    authority: "Circle USDC Contract Addresses",
    chainId: ARC_TESTNET_CHAIN_ID,
    decimals: 6,
  });
  assert.deepEqual(smoke.transactions, [
    "approve",
    "createAndFund",
    "activate",
    "settleBatch",
    "close/refund",
  ]);
});

test("构建授权请求时缺少必须展示给用户的部署字段会 fail closed", () => {
  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.authorizationStages[0].deployer;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.foundryDeploy.expectedAddresses.factory;
  }, "STRING_INVALID");
});

test("构建 smoke 授权请求时缺少 buyer、payout、factory 或 USDC 依赖会 fail closed", () => {
  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.authorizationStages[2].buyer;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.authorizationStages[2].payout;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.foundryDeploy.expectedAddresses.factory;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    changedEvidence.manifest.externalDependencies = [];
  }, "USDC_DEPENDENCY_MISSING");

  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.manifest.externalDependencies[0].address;
  }, "STRING_INVALID");
});

test("构建配置授权请求时缺少交易目标、角色账户或 source args 会 fail closed", () => {
  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.authorizationStages[1].transactions[0].to;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    const roleTransaction = changedEvidence.authorizationStages[1].transactions
      .find((transaction) => transaction.role === "SETTLER_ROLE");
    delete roleTransaction.account;
  }, "STRING_INVALID");

  expectBuildGateError((changedEvidence) => {
    delete changedEvidence.authorizationStages[1].transactions[0].args;
  }, "RECORD_INVALID");
});

test("授权请求 digest 稳定且不受 JSON 对象 key 顺序影响", () => {
  const baseEvidence = evidence();
  const baseRequests = buildAuthorizationRequests(baseEvidence);
  const reorderedEvidence = {
    manifest: {
      externalDependencies: [...baseEvidence.manifest.externalDependencies],
    },
    foundryDeploy: {
      coreArtifacts: [...baseEvidence.foundryDeploy.coreArtifacts].reverse(),
      expectedAddresses: {
        registry: REGISTRY,
        implementation: IMPLEMENTATION,
        factory: FACTORY,
      },
    },
    authorizationStages: baseEvidence.authorizationStages.map((stage) =>
      Object.fromEntries(Object.entries(stage).reverse())),
  };

  assert.deepEqual(
    buildAuthorizationRequests(reorderedEvidence).map((request) => request.requestDigest),
    baseRequests.map((request) => request.requestDigest),
  );
});

test("匹配当前 request 的显式授权通过并返回公开授权结果", () => {
  const request = requestByStage(requestsFor(), "deploy_core_contracts");
  const result = validateStageAuthorization({
    request,
    authorization: authorizationFor(request),
  });

  assert.deepEqual(result, {
    schemaVersion: 1,
    authorized: true,
    stage: "deploy_core_contracts",
    chainId: ARC_TESTNET_CHAIN_ID,
    commit: COMMIT,
    requestDigest: request.requestDigest,
    approvedAt: "2026-07-11T01:00:00.000Z",
    operator: "captain",
  });
});

test("显式授权记录拒绝额外字段、会话内容和未消费签名", () => {
  const request = requestByStage(requestsFor(), "deploy_core_contracts");

  for (const [field, value, forbidden] of [
    ["transcript", "用户完整聊天内容不应进入授权证明", ["用户完整聊天内容"]],
    ["approvalText", "可以，部署吧，但这不是结构化审批字段", ["可以，部署吧"]],
    ["session", { raw: "chat session copy" }, ["chat session copy"]],
    ["privateKey", "sk-proj-secret-value", ["sk-proj-secret-value"]],
    ["rawSignature", `0x${"12".repeat(65)}`, [`0x${"12".repeat(65)}`]],
    ["signedPayload", `0x${"34".repeat(65)}`, [`0x${"34".repeat(65)}`]],
  ]) {
    expectGateErrorAt(
      () => validateStageAuthorization({
        request,
        authorization: authorizationFor(request, { [field]: value }),
      }),
      "AUTHORIZATION_FIELD_UNEXPECTED",
      `authorization.${field}`,
      forbidden,
    );
  }

  const result = validateStageAuthorization({
    request,
    authorization: authorizationFor(request),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "approvedAt",
    "authorized",
    "chainId",
    "commit",
    "operator",
    "requestDigest",
    "schemaVersion",
    "stage",
  ]);
});

test("部署阶段授权不能复用到配置角色阶段", () => {
  const requests = requestsFor();
  const deploy = requestByStage(requests, "deploy_core_contracts");
  const configure = requestByStage(requests, "configure_sources_and_roles");

  expectGateError(
    () => validateStageAuthorization({
      request: configure,
      authorization: authorizationFor(deploy),
    }),
    "STAGE_MISMATCH",
  );
});

test("request 参数变化后旧授权全部失效", () => {
  const baseRequests = requestsFor();
  const deploy = requestByStage(baseRequests, "deploy_core_contracts");
  const configure = requestByStage(baseRequests, "configure_sources_and_roles");
  const smoke = requestByStage(baseRequests, "smoke_usdc_spend");

  const cases = [
    [
      "chainId",
      requestByStage(changedRequests((changedEvidence) => {
        changedEvidence.authorizationStages[0].chainId = ARC_TESTNET_CHAIN_ID + 1;
      }), "deploy_core_contracts"),
      authorizationFor(deploy),
      "CHAIN_ID_MISMATCH",
    ],
    [
      "commit",
      requestByStage(changedRequests((changedEvidence) => {
        changedEvidence.authorizationStages[0].commit = "d".repeat(40);
      }), "deploy_core_contracts"),
      authorizationFor(deploy),
      "COMMIT_MISMATCH",
    ],
    [
      "gas",
      requestByStage(changedRequests((changedEvidence) => {
        changedEvidence.authorizationStages[0].estimatedGas = "3000001";
      }), "deploy_core_contracts"),
      authorizationFor(deploy),
      "REQUEST_DIGEST_MISMATCH",
    ],
    [
      "source config",
      requestByStage(changedRequests((changedEvidence) => {
        changedEvidence.authorizationStages[1].transactions[0].args.maxUnitPrice = "1001";
      }), "configure_sources_and_roles"),
      authorizationFor(configure),
      "REQUEST_DIGEST_MISMATCH",
    ],
    [
      "role change",
      requestByStage(changedRequests((changedEvidence) => {
        const roleChange = changedEvidence.authorizationStages[1].transactions
          .find((transaction) => transaction.role === "SETTLER_ROLE");
        roleChange.account = "0xdDDDDdddDDDDdDddDdDdDDDDdDDDDdDdDdDDDDdD".toLowerCase();
      }), "configure_sources_and_roles"),
      authorizationFor(configure),
      "REQUEST_DIGEST_MISMATCH",
    ],
    [
      "transaction list",
      requestByStage(changedRequests((changedEvidence) => {
        changedEvidence.authorizationStages[2].transactions.push("unexpectedTransfer");
      }), "smoke_usdc_spend"),
      authorizationFor(smoke),
      "REQUEST_DIGEST_MISMATCH",
    ],
    [
      "max USDC",
      requestByStage(buildAuthorizationRequests(evidence({ smokeUsdcSpendUnits: "1" })), "smoke_usdc_spend"),
      authorizationFor(smoke),
      "REQUEST_DIGEST_MISMATCH",
    ],
  ];

  for (const [label, changedRequest, oldAuthorization, expectedCode] of cases) {
    assert.notEqual(changedRequest.requestDigest, oldAuthorization.requestDigest, label);
    expectGateError(
      () => validateStageAuthorization({
        request: changedRequest,
        authorization: oldAuthorization,
      }),
      expectedCode,
    );
  }
});

test("缺字段、拒绝授权、无效时间和被篡改 request 都 fail closed", () => {
  const request = requestByStage(requestsFor(), "smoke_usdc_spend");
  const validAuthorization = authorizationFor(request);

  for (const field of [
    "stage",
    "chainId",
    "commit",
    "requestDigest",
    "approved",
    "approvedAt",
    "operator",
  ]) {
    const authorization = { ...validAuthorization };
    delete authorization[field];
    expectGateError(
      () => validateStageAuthorization({ request, authorization }),
      field === "approved" ? "BOOLEAN_TRUE_REQUIRED" : field === "chainId"
        ? "INTEGER_INVALID"
        : field === "requestDigest"
          ? "DIGEST_INVALID"
          : field === "approvedAt"
            ? "STRING_INVALID"
            : "STRING_INVALID",
    );
  }

  expectGateError(
    () => validateStageAuthorization({
      request,
      authorization: authorizationFor(request, { approved: false }),
    }),
    "BOOLEAN_TRUE_REQUIRED",
  );
  expectGateError(
    () => validateStageAuthorization({
      request,
      authorization: authorizationFor(request, { approvedAt: "not-a-date" }),
    }),
    "DATETIME_INVALID",
  );
  expectGateError(
    () => validateStageAuthorization({
      request: { ...request, estimatedGas: "different" },
      authorization: validAuthorization,
    }),
    "REQUEST_DIGEST_INVALID",
  );
  expectGateError(
    () => validateStageAuthorization({
      request: {
        ...request,
        schemaVersion: 999,
      },
      authorization: validAuthorization,
    }),
    "SCHEMA_VERSION_INVALID",
  );
  expectGateError(
    () => validateStageAuthorization({
      request: {
        ...request,
        requiresFreshUserAuthorization: false,
      },
      authorization: validAuthorization,
    }),
    "BOOLEAN_TRUE_REQUIRED",
  );
  expectGateError(
    () => validateStageAuthorization({
      request: {
        ...request,
        transactions: [],
      },
      authorization: validAuthorization,
    }),
    "ARRAY_EMPTY",
  );
  expectGateError(
    () => validateStageAuthorization(undefined),
    "RECORD_INVALID",
  );
  expectGateError(
    () => validateStageAuthorization([]),
    "RECORD_INVALID",
  );
});

test("buildAuthorizationRequests 拒绝 accessor 输入且不执行 getter", () => {
  const changedEvidence = evidence();
  let getterCalled = false;
  Object.defineProperty(changedEvidence.authorizationStages[0], "stage", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "sk-proj-getter-leak";
    },
  });

  expectInputInvalid(
    () => buildAuthorizationRequests(changedEvidence),
    "evidencePackage.authorizationStages[0].stage",
  );
  assert.equal(getterCalled, false);
});

test("buildAuthorizationRequests 拒绝非枚举、symbol、数组额外字段和稀疏数组", () => {
  const hidden = evidence();
  Object.defineProperty(hidden.authorizationStages[1].transactions[0], "memo", {
    enumerable: false,
    value: "hidden-leak",
  });
  expectInputInvalid(
    () => buildAuthorizationRequests(hidden),
    "evidencePackage.sourceConfiguration.transactions[0].memo",
  );

  const symbolKey = Symbol("symbol-leak");
  const withSymbol = evidence();
  withSymbol.authorizationStages[1].transactions[0][symbolKey] = "symbol-leak";
  expectInputInvalid(
    () => buildAuthorizationRequests(withSymbol),
    "evidencePackage.sourceConfiguration.transactions[0]",
  );

  const withArrayExtra = evidence();
  withArrayExtra.authorizationStages.memo = "public memo";
  expectInputInvalid(
    () => buildAuthorizationRequests(withArrayExtra),
    "evidencePackage.authorizationStages.memo",
  );

  const sparse = evidence();
  sparse.authorizationStages = [];
  sparse.authorizationStages[1] = evidence().authorizationStages[1];
  expectInputInvalid(
    () => buildAuthorizationRequests(sparse),
    "evidencePackage.authorizationStages[0]",
  );
});

test("buildAuthorizationRequests 拒绝非 plain object、循环引用与非有限数字", () => {
  class EvidencePackage {
    constructor(value) {
      Object.assign(this, value);
    }
  }

  expectInputInvalid(() => buildAuthorizationRequests(new EvidencePackage(evidence())), "evidencePackage");

  const nullPrototype = Object.assign(Object.create(null), evidence());
  expectInputInvalid(() => buildAuthorizationRequests(nullPrototype), "evidencePackage");

  const circular = evidence();
  circular.authorizationStages[1].transactions[0].args.self = circular.authorizationStages[1].transactions[0].args;
  expectInputInvalid(
    () => buildAuthorizationRequests(circular),
    "evidencePackage.sourceConfiguration.transactions[0].args.self",
  );

  const nanGas = evidence();
  nanGas.authorizationStages[0].estimatedGas = Number.NaN;
  expectInputInvalid(
    () => buildAuthorizationRequests(nanGas),
    "evidencePackage.authorizationStages[0].estimatedGas",
  );

  const infiniteGas = evidence();
  infiniteGas.authorizationStages[0].estimatedGas = Number.POSITIVE_INFINITY;
  expectInputInvalid(
    () => buildAuthorizationRequests(infiniteGas),
    "evidencePackage.authorizationStages[0].estimatedGas",
  );
});

test("validateStageAuthorization 拒绝 accessor 和隐藏授权输入且不执行 getter", () => {
  const request = requestByStage(requestsFor(), "deploy_core_contracts");
  const authorization = authorizationFor(request);

  let getterCalled = false;
  const accessorRoot = { authorization };
  Object.defineProperty(accessorRoot, "request", {
    enumerable: true,
    get() {
      getterCalled = true;
      return {
        ...request,
        operatorNote: "sk-proj-getter-leak",
      };
    },
  });
  expectInputInvalid(
    () => validateStageAuthorization(accessorRoot),
    "request",
  );
  assert.equal(getterCalled, false);

  const hiddenAuthorization = { request };
  Object.defineProperty(hiddenAuthorization, "authorization", {
    enumerable: false,
    value: authorization,
  });
  expectInputInvalid(
    () => validateStageAuthorization(hiddenAuthorization),
    "authorization",
  );

  const symbolKey = Symbol("symbol-leak");
  const withSymbol = { request, authorization };
  withSymbol[symbolKey] = "symbol-leak";
  expectInputInvalid(() => validateStageAuthorization(withSymbol), "$");

  const circular = { request, authorization };
  circular.request.self = circular.request;
  expectInputInvalid(() => validateStageAuthorization(circular), "request.self");
});
