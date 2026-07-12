import assert from "node:assert/strict";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import {
  DeploymentManifestValidationError,
  buildDeploymentManifest,
  digestDeploymentManifest,
  validateDeploymentManifest,
} from "./deployment-manifest.mjs";

const COMMIT = "a".repeat(40);
const FOUNDRY_COMMIT = "b".repeat(40);
const OZ_REVISION = "c".repeat(40);
const REGISTRY = "0x1111111111111111111111111111111111111111";
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222";
const FACTORY = "0x3333333333333333333333333333333333333333";
const DEPLOYER = "0x4444444444444444444444444444444444444444";
const BUYER_ONE = "0x5555555555555555555555555555555555555555";
const BUYER_TWO = "0x6666666666666666666666666666666666666666";
const CLONE_ONE = "0x7777777777777777777777777777777777777777";
const CLONE_TWO = "0x8888888888888888888888888888888888888888";
const CLONE_EMPTY = "0x1010101010101010101010101010101010101010";
const PAYOUT = "0x9999999999999999999999999999999999999999";
const FACTORY_ADMIN = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const REGISTRY_ADMIN = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const SOURCE_ADMIN = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const FUNDING_SIGNER = "0xdDddDdddDDdDddDdDdDDdDdDDdDdDDdDDDDDDDDd";
const INTENT_SIGNER = "0xeEeEeEeeEeEeEeeEeEEEEeeeeEeeeeeeeEEeEeeE";
const SETTLER = "0xfFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";
const HASH_A = `0x${"01".repeat(32)}`;
const HASH_B = `0x${"02".repeat(32)}`;
const HASH_C = `0x${"03".repeat(32)}`;
const HASH_D = `0x${"04".repeat(32)}`;
const HASH_E = `0x${"05".repeat(32)}`;
const HASH_F = `0x${"06".repeat(32)}`;
const HASH_G = `0x${"07".repeat(32)}`;
const HASH_H = `0x${"08".repeat(32)}`;
const HASH_I = `0x${"09".repeat(32)}`;
const TX_REGISTRY = `0x${"11".repeat(32)}`;
const TX_IMPLEMENTATION = `0x${"22".repeat(32)}`;
const TX_FACTORY = `0x${"33".repeat(32)}`;
const TX_BIND = `0x${"44".repeat(32)}`;
const TX_FUND_ONE = `0x${"55".repeat(32)}`;
const TX_FUND_TWO = `0x${"66".repeat(32)}`;
const TX_SETTLE_TWO = `0x${"77".repeat(32)}`;
const TX_FUND_EMPTY = `0x${"88".repeat(32)}`;

function artifactHashes(suffix) {
  return {
    initCodeHash: HASH_A,
    creationBytecodeHash: HASH_B,
    compiledDeployedBytecodeHash: HASH_C,
    onchainRuntimeBytecodeHash: suffix,
    abiHash: HASH_D,
    metadataHash: HASH_E,
    buildInfoHash: HASH_F,
    sourceBundleHash: HASH_G,
  };
}

function deployment(txHash, blockNumber, transactionIndex = 0) {
  return {
    txHash,
    status: "success",
    blockNumber,
    blockHash: HASH_H,
    transactionIndex,
  };
}

function coreContract({ name, type, address, txHash, sourceFile, constructorArguments, initializerArguments }) {
  return {
    name,
    type,
    address,
    creator: DEPLOYER,
    deployment: deployment(txHash, 8_000_000, 1),
    artifact: {
      fullyQualifiedName: `${sourceFile}:${name}`,
      sourceFile,
    },
    constructorArguments,
    initializerArguments,
    artifactHashes: artifactHashes(HASH_I),
  };
}

function fundedClone({
  clone,
  buyer,
  researchKey,
  txHash,
  state,
  settlement,
}) {
  return {
    clone,
    buyer,
    researchKey,
    factory: FACTORY,
    implementation: IMPLEMENTATION,
    registry: REGISTRY,
    usdc: ARC_TESTNET_USDC_ADDRESS,
    salt: HASH_A,
    predictedAddress: clone,
    voucherHash: HASH_B,
    voucherNonce: "7",
    initializerArguments: {
      raw: "0x1234",
      decoded: {
        buyer,
        researchKey,
        initialBudget: "1000000",
        expectedExpiresAt: 2_000_000_000,
        activationCutoff: 1_999_996_400,
      },
    },
    funding: {
      txHash,
      status: "success",
      blockNumber: 8_000_010,
      blockHash: HASH_H,
      transactionIndex: 3,
      factoryEventLogIndex: 4,
      usdcFundingTransferLogIndex: 5,
      nonZero: true,
      amountUnits: "1000000",
    },
    initialBudget: "1000000",
    activationCutoff: 1_999_996_400,
    expectedExpiresAt: 2_000_000_000,
    runtimeHash: HASH_C,
    state,
    settlement,
  };
}

function validInput() {
  return {
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
      factoryGovernance: FACTORY_ADMIN,
      registryGovernance: REGISTRY_ADMIN,
      sourceAdmin: SOURCE_ADMIN,
      fundingSigner: FUNDING_SIGNER,
      intentSigner: INTENT_SIGNER,
      settler: SETTLER,
      smokeBuyer: BUYER_ONE,
      smokePayout: PAYOUT,
    },
    registryBinding: {
      txHash: TX_BIND,
      blockNumber: 8_000_005,
      blockHash: HASH_H,
      logIndex: 2,
    },
    contracts: {
      registry: coreContract({
        name: "DataSourceRegistry",
        type: "registry",
        address: REGISTRY,
        txHash: TX_REGISTRY,
        sourceFile: "src/registry/DataSourceRegistry.sol",
        constructorArguments: {
          raw: "0xaaaa",
          decoded: { initialAdmin: DEPLOYER },
        },
      }),
      implementation: coreContract({
        name: "ResearchEscrow",
        type: "implementation",
        address: IMPLEMENTATION,
        txHash: TX_IMPLEMENTATION,
        sourceFile: "src/escrow/ResearchEscrow.sol",
        constructorArguments: {
          raw: "0x",
          decoded: {},
        },
        initializerArguments: {
          locked: true,
          raw: "0x",
          decoded: {},
        },
      }),
      factory: coreContract({
        name: "ResearchEscrowFactory",
        type: "factory",
        address: FACTORY,
        txHash: TX_FACTORY,
        sourceFile: "src/factory/ResearchEscrowFactory.sol",
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
      {
        name: "Arc native USDC system emitter",
        type: "system-emitter",
        chainId: ARC_TESTNET_CHAIN_ID,
        address: "0xfffffffffffffffffffffffffffffffffffffffe",
        authority: "Arc USDC system events",
        finalizedBlockNumber: 8_000_020,
        projectDeployment: false,
      },
      {
        name: "Arc explorer",
        type: "explorer",
        chainId: ARC_TESTNET_CHAIN_ID,
        identifier: "arc-testnet-explorer",
        authority: "Arc public explorer",
        finalizedBlockNumber: 8_000_020,
        projectDeployment: false,
      },
    ],
    clones: [
      fundedClone({
        clone: CLONE_ONE,
        buyer: BUYER_ONE,
        researchKey: HASH_D,
        txHash: TX_FUND_ONE,
        state: "Funded",
      }),
      fundedClone({
        clone: CLONE_TWO,
        buyer: BUYER_TWO,
        researchKey: HASH_E,
        txHash: TX_FUND_TWO,
        state: "Closed",
        settlement: {
          successful: true,
          txHash: TX_SETTLE_TWO,
          blockNumber: 8_000_015,
          blockHash: HASH_H,
          logIndex: 9,
        },
      }),
    ],
  };
}

function expectManifestValidationError(manifest, expected) {
  assert.throws(
    () => validateDeploymentManifest(manifest),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.name, "DeploymentManifestValidationError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

function expectBuildManifestError(fn, expected) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.name, "DeploymentManifestValidationError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

test("生成 ARC 5042002 部署 manifest，覆盖核心地址、构造参数、tx/block、artifact 与 clone 计数", () => {
  const manifest = buildDeploymentManifest(validInput());

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.chainId, ARC_TESTNET_CHAIN_ID);
  assert.equal(manifest.network, "arc-testnet");
  assert.equal(manifest.git.commit, COMMIT);
  assert.equal(manifest.git.clean, true);
  assert.equal(manifest.deployer, DEPLOYER.toLowerCase());
  assert.deepEqual(manifest.addresses, {
    registry: REGISTRY,
    implementation: IMPLEMENTATION,
    factory: FACTORY,
  });
  assert.equal(manifest.build.compiler.solidityVersion, "0.8.30");
  assert.equal(manifest.build.compiler.settings.optimizer.runs, 200);
  assert.equal(manifest.build.compiler.settings.evmVersion, "prague");
  assert.equal(manifest.build.compiler.settingsHash, HASH_D);
  assert.equal(manifest.build.dependencies.openZeppelin.revision, OZ_REVISION);
  assert.equal(manifest.contracts.registry.constructorArguments.decoded.initialAdmin, DEPLOYER.toLowerCase());
  assert.equal(manifest.contracts.implementation.initializerArguments.locked, true);
  assert.equal(manifest.contracts.factory.constructorArguments.decoded.implementation, IMPLEMENTATION);
  assert.equal(manifest.contracts.factory.constructorArguments.decoded.registry, REGISTRY);
  assert.equal(manifest.contracts.factory.deployment.txHash, TX_FACTORY);
  assert.equal(manifest.contracts.factory.deployment.blockNumber, 8_000_000);
  assert.equal(manifest.contracts.registry.artifactHashes.onchainRuntimeBytecodeHash, HASH_I);
  assert.equal(manifest.contracts.registry.artifactHashes.buildInfoHash, HASH_F);
  assert.equal(manifest.contracts.registry.artifactHashes.sourceBundleHash, HASH_G);
  assert.equal(manifest.externalDependencies[0].address, ARC_TESTNET_USDC_ADDRESS);
  assert.equal(manifest.externalDependencies[0].projectDeployment, false);
  assert.deepEqual(manifest.cloneCounts, { funded: 2, settled: 1 });
  assert.deepEqual(manifest.deploymentTopology, {
    formula: "3 + R",
    coreContracts: 3,
    researchCloneR: 2,
    totalProjectContracts: 5,
    settledResearchClones: 1,
    excluded: {
      zeroFundingClones: 0,
      externalDependencies: 3,
      externalDependencyReferences: [
        {
          name: "Arc Testnet official USDC",
          type: "erc20",
          address: ARC_TESTNET_USDC_ADDRESS,
        },
        {
          name: "Arc native USDC system emitter",
          type: "system-emitter",
          address: "0xfffffffffffffffffffffffffffffffffffffffe",
        },
        {
          name: "Arc explorer",
          type: "explorer",
          identifier: "arc-testnet-explorer",
        },
      ],
    },
  });
  assert.equal(manifest.clones[0].funding.txHash, TX_FUND_ONE);
  assert.equal(manifest.clones[0].funding.blockNumber, 8_000_010);
  assert.equal(manifest.clones[1].settlement.txHash, TX_SETTLE_TWO);
  assert.match(digestDeploymentManifest(manifest), /^[a-f0-9]{64}$/);
  assert.deepEqual(validateDeploymentManifest(manifest), manifest);
});

test("拒绝错误 chainId，manifest 不能漂移到其他网络", () => {
  const input = validInput();
  input.chainId = 1;

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "CHAIN_ID_MISMATCH");
      assert.equal(error.path, "chainId");
      return true;
    },
  );
});

test("拒绝缺失核心合约 runtime/artifact hash", () => {
  const manifest = buildDeploymentManifest(validInput());
  delete manifest.contracts.registry.artifactHashes.onchainRuntimeBytecodeHash;

  expectManifestValidationError(manifest, {
    code: "HASH_INVALID",
    path: "contracts.registry.artifactHashes.onchainRuntimeBytecodeHash",
  });
});

test("拒绝核心合约 creator 与 manifest deployer 不一致", () => {
  const input = validInput();
  input.contracts.factory.creator = BUYER_ONE;

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "CORE_CREATOR_MISMATCH");
      assert.equal(error.path, "contracts.factory.creator");
      return true;
    },
  );
});

test("拒绝篡改 funded/settled clone 计数", () => {
  const manifest = buildDeploymentManifest(validInput());
  manifest.cloneCounts.funded = 999;

  expectManifestValidationError(manifest, {
    code: "CLONE_COUNT_MISMATCH",
    path: "cloneCounts.funded",
  });
});

test("R 只统计可复核非零资助 clone，零资助空实例和外部依赖不进入 3+R", () => {
  const input = validInput();
  const emptyClone = fundedClone({
    clone: CLONE_EMPTY,
    buyer: BUYER_ONE,
    researchKey: HASH_F,
    txHash: TX_FUND_EMPTY,
    state: "Funded",
  });
  emptyClone.funding.nonZero = false;
  emptyClone.funding.amountUnits = "0";
  input.clones.push(emptyClone);

  const manifest = buildDeploymentManifest(input);

  assert.deepEqual(manifest.cloneCounts, { funded: 2, settled: 1 });
  assert.equal(manifest.deploymentTopology.researchCloneR, 2);
  assert.equal(manifest.deploymentTopology.totalProjectContracts, 5);
  assert.equal(manifest.deploymentTopology.settledResearchClones, 1);
  assert.equal(manifest.deploymentTopology.excluded.zeroFundingClones, 1);
  assert.equal(manifest.deploymentTopology.excluded.externalDependencies, 3);
});

test("拒绝篡改 3+R 部署拓扑计数", () => {
  const manifest = buildDeploymentManifest(validInput());
  manifest.deploymentTopology.researchCloneR = 999;

  expectManifestValidationError(manifest, {
    code: "DEPLOYMENT_TOPOLOGY_MISMATCH",
    path: "deploymentTopology.researchCloneR",
  });
});

test("拒绝把外部依赖标记为项目部署合约", () => {
  const input = validInput();
  input.externalDependencies[0].projectDeployment = true;

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "EXTERNAL_DEPENDENCY_PROJECT_DEPLOYMENT");
      assert.equal(error.path, "externalDependencies[0].projectDeployment");
      return true;
    },
  );
});

test("拒绝缺失官方 USDC 外部依赖", () => {
  const input = validInput();
  input.externalDependencies = input.externalDependencies.slice(1);

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "USDC_DEPENDENCY_MISSING");
      assert.equal(error.path, "externalDependencies");
      return true;
    },
  );
});

test("拒绝 dirty Git 证明生成最终 manifest", () => {
  const input = validInput();
  input.git.clean = false;
  input.git.statusPorcelain = " M contracts/src/factory/ResearchEscrowFactory.sol";

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "GIT_DIRTY");
      assert.equal(error.path, "git.clean");
      return true;
    },
  );
});

test("拒绝用 nonZero=false 隐藏正金额 funded clone", () => {
  const input = validInput();
  input.clones[0].funding.nonZero = false;

  assert.throws(
    () => buildDeploymentManifest(input),
    (error) => {
      assert.ok(error instanceof DeploymentManifestValidationError);
      assert.equal(error.code, "FUNDING_NONZERO_MISMATCH");
      assert.equal(error.path, "clones[0].funding.nonZero");
      return true;
    },
  );
});

test("拒绝 manifest 输入 accessor 且不会执行 getter", () => {
  const input = validInput();
  const contracts = input.contracts;
  let getterExecuted = false;
  Object.defineProperty(input, "contracts", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return contracts;
    },
  });

  expectBuildManifestError(
    () => buildDeploymentManifest(input),
    { code: "INPUT_INVALID", path: "contracts" },
  );
  assert.equal(getterExecuted, false);
});

test("拒绝待校验 manifest 输入 accessor 且不会执行 getter", () => {
  const manifest = buildDeploymentManifest(validInput());
  const schemaVersion = manifest.schemaVersion;
  let getterExecuted = false;
  Object.defineProperty(manifest, "schemaVersion", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return schemaVersion;
    },
  });

  expectBuildManifestError(
    () => validateDeploymentManifest(manifest),
    { code: "INPUT_INVALID", path: "schemaVersion" },
  );
  assert.equal(getterExecuted, false);
});

test("拒绝 manifest 非 JSON-like 输入形状", () => {
  const hidden = validInput();
  Object.defineProperty(hidden, "contracts", {
    enumerable: false,
    value: hidden.contracts,
  });
  expectBuildManifestError(
    () => buildDeploymentManifest(hidden),
    { code: "INPUT_INVALID", path: "contracts" },
  );

  const symbolKeyed = validInput();
  symbolKeyed[Symbol("hidden")] = "must not be accepted";
  expectBuildManifestError(
    () => buildDeploymentManifest(symbolKeyed),
    { code: "INPUT_INVALID", path: "$" },
  );

  const arrayWithExtraKey = validInput();
  arrayWithExtraKey.clones.extra = "unexpected";
  expectBuildManifestError(
    () => buildDeploymentManifest(arrayWithExtraKey),
    { code: "INPUT_INVALID", path: "clones.extra" },
  );

  const sparseArray = validInput();
  delete sparseArray.clones[0];
  expectBuildManifestError(
    () => buildDeploymentManifest(sparseArray),
    { code: "INPUT_INVALID", path: "clones[0]" },
  );

  const classInstance = validInput();
  Object.setPrototypeOf(classInstance, { inherited: true });
  expectBuildManifestError(
    () => buildDeploymentManifest(classInstance),
    { code: "INPUT_INVALID", path: "$" },
  );

  const nullPrototype = validInput();
  Object.setPrototypeOf(nullPrototype, null);
  expectBuildManifestError(
    () => buildDeploymentManifest(nullPrototype),
    { code: "INPUT_INVALID", path: "$" },
  );

  const cyclic = validInput();
  cyclic.self = cyclic;
  expectBuildManifestError(
    () => buildDeploymentManifest(cyclic),
    { code: "INPUT_INVALID", path: "self" },
  );

  const nonFinite = validInput();
  nonFinite.finalizedBlock.blockNumber = Number.POSITIVE_INFINITY;
  expectBuildManifestError(
    () => buildDeploymentManifest(nonFinite),
    { code: "INPUT_INVALID", path: "finalizedBlock.blockNumber" },
  );
});
