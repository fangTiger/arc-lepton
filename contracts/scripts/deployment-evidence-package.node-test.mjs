import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { buildDeploymentManifest, digestDeploymentManifest } from "./deployment-manifest.mjs";
import {
  DeploymentEvidencePackageError,
  DeploymentArtifactSecurityError,
  buildDeploymentEvidencePackage,
  scanPublicDeploymentArtifact,
} from "./deployment-evidence-package.mjs";

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

function validPackageInput() {
  return {
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
      smokeUsdcSpendUnits: "0",
    },
    explorerBaseUrl: "https://explorer.arc-testnet.example",
    manifestOutputPath: "deployments/5042002.json",
  };
}

function expectSecurityError(value, expected) {
  assert.throws(
    () => scanPublicDeploymentArtifact(value),
    (error) => {
      assert.ok(error instanceof DeploymentArtifactSecurityError);
      assert.equal(error.name, "DeploymentArtifactSecurityError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      assert.doesNotMatch(error.message, /user:pass|sk-proj|abcdef|\/Users\/captain/);
      return true;
    },
  );
}

function expectInputInvalid(value, expected = {}) {
  assert.throws(
    () => scanPublicDeploymentArtifact(value),
    (error) => {
      assert.ok(error instanceof DeploymentArtifactSecurityError);
      assert.equal(error.name, "DeploymentArtifactSecurityError");
      assert.equal(error.code, "INPUT_INVALID");
      if (expected.path !== undefined) {
        assert.equal(error.path, expected.path);
      }
      assert.doesNotMatch(error.message, /sk-proj|getter-leak|hidden-leak|symbol-leak/);
      return true;
    },
  );
}

test("生成部署、source、角色移交、manifest 与 Explorer exact-match 输入计划", () => {
  const evidence = buildDeploymentEvidencePackage(validPackageInput());

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.chainId, ARC_TESTNET_CHAIN_ID);
  assert.equal(evidence.commit, COMMIT);
  assert.equal(evidence.deployer, DEPLOYER);
  assert.equal(evidence.authorization.requiredBeforeBroadcast, true);
  assert.equal(evidence.authorization.boundaryTask, "13.1");
  assert.equal(
    evidence.foundryDeploy.script,
    "contracts/script/DeployResearchEscrow.s.sol:DeployResearchEscrowScript",
  );
  assert.match(evidence.foundryDeploy.commandTemplates.simulate, /forge script/);
  assert.equal(evidence.foundryDeploy.commandTemplates.simulate.includes("--broadcast"), false);
  assert.match(evidence.foundryDeploy.commandTemplates.broadcast, /--broadcast/);
  assert.doesNotMatch(evidence.foundryDeploy.commandTemplates.broadcast, /--private-key|sk-|:\/\//);
  assert.deepEqual(evidence.foundryDeploy.expectedAddresses, {
    registry: REGISTRY,
    implementation: IMPLEMENTATION,
    factory: FACTORY,
  });
  assert.deepEqual(evidence.sourceConfiguration.transactions, [
    {
      stage: "configure_sources_and_roles",
      target: "registry",
      to: REGISTRY,
      function: "createSource(bytes32,address,uint256,bool)",
      args: {
        sourceId: SOURCE_ID,
        payout: PAYOUT.toLowerCase(),
        maxUnitPrice: "1000",
        active: true,
      },
    },
  ]);
  assert.deepEqual(
    evidence.roleTransfer.transactions.map((transaction) => [
      transaction.target,
      transaction.action,
      transaction.role,
      transaction.account,
    ]),
    [
      ["factory", "grant", "DEFAULT_ADMIN_ROLE", FACTORY_GOVERNANCE],
      ["factory", "grant", "FUNDING_SIGNER_ROLE", FUNDING_SIGNER],
      ["factory", "grant", "INTENT_SIGNER_ROLE", INTENT_SIGNER],
      ["factory", "grant", "SETTLER_ROLE", SETTLER.toLowerCase()],
      ["registry", "grant", "DEFAULT_ADMIN_ROLE", REGISTRY_GOVERNANCE],
      ["registry", "grant", "SOURCE_ADMIN_ROLE", SOURCE_ADMIN],
      ["factory", "revoke", "DEFAULT_ADMIN_ROLE", DEPLOYER],
      ["registry", "revoke", "DEFAULT_ADMIN_ROLE", DEPLOYER],
    ],
  );
  assert.equal(evidence.explorerVerificationInputs.length, 3);
  assert.deepEqual(evidence.deploymentTopology, evidence.manifest.deploymentTopology);
  assert.equal(evidence.deploymentTopology.formula, "3 + R");
  assert.equal(evidence.deploymentTopology.researchCloneR, 0);
  assert.equal(evidence.deploymentTopology.totalProjectContracts, 3);
  assert.equal(evidence.deploymentTopology.settledResearchClones, 0);
  assert.equal(evidence.deploymentTopology.excluded.externalDependencies, 1);
  assert.equal(evidence.manifestPublication.digest, digestDeploymentManifest(evidence.manifest));
  assert.equal(evidence.manifestPublication.outputPath, "deployments/5042002.json");
  assert.equal(
    evidence.explorer.links.factory,
    "https://explorer.arc-testnet.example/address/0x4444444444444444444444444444444444444444",
  );
  assert.deepEqual(
    evidence.explorerVerificationInputs.map((input) => [
      input.contract,
      input.address,
      input.exactMatchRequired,
      input.constructorArgumentsRaw,
      input.abiHash,
    ]),
    [
      ["DataSourceRegistry", REGISTRY, true, "0xaaaa", HASH_D],
      ["ResearchEscrow", IMPLEMENTATION, true, "0x", HASH_D],
      ["ResearchEscrowFactory", FACTORY, true, "0xbbbb", HASH_D],
    ],
  );
  assert.equal(evidence.securityScan.classification, "public");
});

test("生成计划前拒绝让 deployer 保留最终敏感角色", () => {
  const input = validPackageInput();
  input.manifest.roles.factoryGovernance = DEPLOYER;

  assert.throws(
    () => buildDeploymentEvidencePackage(input),
    (error) => {
      assert.ok(error instanceof DeploymentEvidencePackageError);
      assert.equal(error.code, "DEPLOYER_FINAL_ROLE");
      assert.equal(error.path, "roles.factoryGovernance");
      return true;
    },
  );
});

test("生成公开证据包前拒绝未使用的敏感输入且不回显原值", () => {
  const input = validPackageInput();
  input.privateKey = "super-secret-json-value";

  assert.throws(
    () => buildDeploymentEvidencePackage(input),
    (error) => {
      assert.ok(error instanceof DeploymentArtifactSecurityError);
      assert.equal(error.code, "SECRET_FIELD");
      assert.equal(error.path, "privateKey");
      assert.doesNotMatch(error.message, /super-secret-json-value/);
      return true;
    },
  );
});

test("生成公开证据包前拒绝 accessor 输入且不执行 getter", () => {
  const input = validPackageInput();
  let getterCalled = false;
  Object.defineProperty(input, "manifestOutputPath", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "/Users/captain/secret-deployments/5042002.json";
    },
  });

  assert.throws(
    () => buildDeploymentEvidencePackage(input),
    (error) => {
      assert.ok(error instanceof DeploymentArtifactSecurityError);
      assert.equal(error.code, "INPUT_INVALID");
      assert.equal(error.path, "manifestOutputPath");
      assert.doesNotMatch(error.message, /secret-deployments|\/Users\/captain/);
      return true;
    },
  );
  assert.equal(getterCalled, false);
});

test("公开证据扫描拒绝 private key、provider key、带凭据 RPC、本机路径和原始签名", () => {
  expectSecurityError({ privateKey: `0x${"ab".repeat(32)}` }, {
    code: "SECRET_FIELD",
    path: "privateKey",
  });
  expectSecurityError({ providerKey: "sk-proj-abcdef" }, {
    code: "SECRET_FIELD",
    path: "providerKey",
  });
  expectSecurityError({ rpcUrl: "https://user:pass@rpc.example.invalid" }, {
    code: "CREDENTIAL_URL",
    path: "rpcUrl",
  });
  expectSecurityError({ artifactPath: "/Users/captain/.env" }, {
    code: "LOCAL_PATH",
    path: "artifactPath",
  });
  expectSecurityError({ signature: `0x${"12".repeat(65)}` }, {
    code: "RAW_SIGNATURE",
    path: "signature",
  });
});

test("公开证据扫描拒绝审批或授权记录 marker 字段", () => {
  for (const [value, expectedPath] of [
    [{ authorization: { approved: true } }, "authorization.approved"],
    [{ authorization: { approvedAt: "2026-07-12T00:00:00.000Z" } }, "authorization.approvedAt"],
    [{ approval: { stage: "deploy_core_contracts" } }, "approval"],
    [{ explicitAuthorization: { approved: true } }, "explicitAuthorization"],
    [{ authorizationRecord: { operator: "captain" } }, "authorizationRecord"],
  ]) {
    expectSecurityError(value, {
      code: "APPROVAL_FIELD",
      path: expectedPath,
    });
  }
});

test("公开证据扫描拒绝 accessor 字段且不执行 getter", () => {
  let getterCalled = false;
  const artifact = { stage: "deploy_core_contracts" };
  Object.defineProperty(artifact, "memo", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "sk-proj-getter-leak";
    },
  });

  expectInputInvalid(artifact, { path: "memo" });
  assert.equal(getterCalled, false);
});

test("公开证据扫描拒绝非枚举字段与 symbol key", () => {
  const hidden = { stage: "deploy_core_contracts" };
  Object.defineProperty(hidden, "memo", {
    enumerable: false,
    value: "hidden-leak",
  });
  expectInputInvalid(hidden, { path: "memo" });

  const symbolKey = Symbol("symbol-leak");
  const artifact = { stage: "deploy_core_contracts" };
  artifact[symbolKey] = "symbol-leak";
  expectInputInvalid(artifact, { path: "$" });
});

test("公开证据扫描拒绝数组额外字段、accessor 与稀疏数组且不执行 getter", () => {
  let getterCalled = false;
  const withAccessor = ["deploy_core_contracts"];
  Object.defineProperty(withAccessor, "memo", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "sk-proj-getter-leak";
    },
  });

  expectInputInvalid(withAccessor, { path: "memo" });
  assert.equal(getterCalled, false);

  const withExtraField = ["deploy_core_contracts"];
  withExtraField.memo = "public memo";
  expectInputInvalid(withExtraField, { path: "memo" });

  const sparse = [];
  sparse[1] = "deploy_core_contracts";
  expectInputInvalid(sparse, { path: "$[0]" });
});

test("公开证据扫描拒绝非 plain object、循环引用与非有限数字", () => {
  class DeploymentArtifact {
    stage = "deploy_core_contracts";
  }

  expectInputInvalid(new DeploymentArtifact(), { path: "$" });

  const nullPrototype = Object.create(null);
  nullPrototype.stage = "deploy_core_contracts";
  expectInputInvalid(nullPrototype, { path: "$" });

  const circular = { stage: "deploy_core_contracts" };
  circular.self = circular;
  expectInputInvalid(circular, { path: "self" });

  expectInputInvalid({ expectedGas: Number.NaN }, { path: "expectedGas" });
  expectInputInvalid({ expectedGas: Number.POSITIVE_INFINITY }, { path: "expectedGas" });
});

test("Foundry deploy script 固定三个核心合约、绑定 Factory 并描述角色移交，但不包含私钥", async () => {
  const source = await readFile(
    resolve("contracts/script/DeployResearchEscrow.s.sol"),
    "utf8",
  );

  assert.match(source, /contract DeployResearchEscrowScript/);
  assert.doesNotMatch(source, /forge-std/);
  assert.match(source, /interface Vm/);
  assert.match(source, /new DataSourceRegistry\(initialAdmin\)/);
  assert.match(source, /new ResearchEscrow\(\)/);
  assert.match(source, /new ResearchEscrowFactory\(address\(implementation\), address\(registry\), initialAdmin\)/);
  assert.match(source, /registry\.bindFactory\(address\(factory\)\)/);
  assert.match(source, /factory\.grantRole\(factory\.DEFAULT_ADMIN_ROLE\(\), roles\.factoryGovernance\)/);
  assert.match(source, /registry\.grantRole\(registry\.SOURCE_ADMIN_ROLE\(\), roles\.sourceAdmin\)/);
  assert.match(source, /factory\.revokeRole\(factory\.DEFAULT_ADMIN_ROLE\(\), initialAdmin\)/);
  assert.doesNotMatch(source, /PRIVATE_KEY|privateKey|mnemonic|--broadcast/);
});
