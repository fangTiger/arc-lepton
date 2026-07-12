import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes } from "viem";

import { buildDeploymentManifest } from "./deployment-manifest.mjs";
import {
  ARC_NATIVE_USDC_SYSTEM_EMITTER,
  ARC_TESTNET_CHAIN_ID,
  EIP1967_IMPLEMENTATION_SLOT,
  OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
  RpcDeploymentVerifierError,
  verifyArcDeploymentRpcEvidence,
  verifyArcDeploymentTopologyAndRoles,
} from "./rpc-deployment-verifier.mjs";
import {
  SmokeEvidenceVerificationError,
  verifyArcSmokeEvidence,
} from "./smoke-evidence-verifier.mjs";
import {
  LocalSmokeEvidenceRunnerError,
  runLocalSmokeEvidence,
} from "./local-smoke-evidence-runner.mjs";

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
const PROXY_IMPLEMENTATION = "0xdDddDdddDDdDddDdDdDDdDdDDdDdDDdDDDDDDDDd";
const OTHER_TOKEN = "0xeEeEeEeeEeEeEeeEeEEEEeeeeEeeeeeeeEEeEeeE";
const CLONE = "0x1212121212121212121212121212121212121212";
const WRONG_IMPLEMENTATION = "0xfEfeFEfeFEFeFEFEFeFefefEfeFEFEfeFEFEFEFE";
const USDC_CODE = "0x6001600155";
const REGISTRY_CODE = "0x6002600255";
const IMPLEMENTATION_CODE = "0x6003600355";
const FACTORY_CODE = "0x6004600455";
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
const TX_CLONE_FUNDING = `0x${"55".repeat(32)}`;
const TX_FACTORY_ROLE_TRANSFER = `0x${"66".repeat(32)}`;
const TX_REGISTRY_ROLE_TRANSFER = `0x${"77".repeat(32)}`;
const DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}`;
const ROLE_GRANTED_TOPIC = keccak256(toBytes("RoleGranted(bytes32,address,address)"));
const ROLE_REVOKED_TOPIC = keccak256(toBytes("RoleRevoked(bytes32,address,address)"));
const ROLE_ADMIN_CHANGED_TOPIC = keccak256(toBytes("RoleAdminChanged(bytes32,bytes32,bytes32)"));
const FACTORY_ROLE_IDS = {
  defaultAdmin: DEFAULT_ADMIN_ROLE,
  fundingSigner: keccak256(toBytes("FUNDING_SIGNER_ROLE")),
  intentSigner: keccak256(toBytes("INTENT_SIGNER_ROLE")),
  settler: keccak256(toBytes("SETTLER_ROLE")),
};
const REGISTRY_ROLE_IDS = {
  defaultAdmin: DEFAULT_ADMIN_ROLE,
  sourceAdmin: keccak256(toBytes("SOURCE_ADMIN_ROLE")),
};
const FACTORY_VIEW_ABI = parseAbi([
  "function implementation() view returns (address)",
  "function registry() view returns (address)",
  "function usdc() view returns (address)",
  "function initialDeployer() view returns (address)",
]);
const REGISTRY_VIEW_ABI = parseAbi([
  "function factory() view returns (address)",
  "function usdc() view returns (address)",
]);
const ACCESS_CONTROL_ABI = parseAbi([
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);
const INITIALIZE_ABI = parseAbi([
  "function initialize(address factory,address registry,address usdc,address buyer,bytes32 researchKey,uint256 initialBudget,uint64 expectedExpiresAt,uint64 activationCutoff,address plannedIntentSigner)",
]);

function runtimeHash(code) {
  return keccak256(code);
}

function paddedAddress(address) {
  return `0x${"00".repeat(12)}${address.toLowerCase().slice(2)}`;
}

function uint256Hex(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function returnAddress(address) {
  return encodeAbiParameters([{ type: "address" }], [address]);
}

function returnBytes32(value) {
  return encodeAbiParameters([{ type: "bytes32" }], [value]);
}

function returnUint256(value) {
  return encodeAbiParameters([{ type: "uint256" }], [BigInt(value)]);
}

function returnBool(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]);
}

function callData(abi, functionName, args = []) {
  return encodeFunctionData({ abi, functionName, args });
}

function callKey(to, data) {
  return `${to.toLowerCase()}:${data.toLowerCase()}`;
}

function callEntry(to, abi, functionName, args, value) {
  return [callKey(to, callData(abi, functionName, args)), value];
}

function roleLogKey(address, topic0) {
  return `${address.toLowerCase()}:${topic0.toLowerCase()}`;
}

function rpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function roleGrantLog({ address, role, account, sender, txHash, blockNumber, transactionIndex, logIndex }) {
  return {
    address: address.toLowerCase(),
    topics: [ROLE_GRANTED_TOPIC, role.toLowerCase(), paddedAddress(account), paddedAddress(sender)],
    data: "0x",
    transactionHash: txHash,
    blockNumber: rpcQuantity(blockNumber),
    transactionIndex: rpcQuantity(transactionIndex),
    logIndex: rpcQuantity(logIndex),
  };
}

function roleRevokeLog({ address, role, account, sender, txHash, blockNumber, transactionIndex, logIndex }) {
  return {
    address: address.toLowerCase(),
    topics: [ROLE_REVOKED_TOPIC, role.toLowerCase(), paddedAddress(account), paddedAddress(sender)],
    data: "0x",
    transactionHash: txHash,
    blockNumber: rpcQuantity(blockNumber),
    transactionIndex: rpcQuantity(transactionIndex),
    logIndex: rpcQuantity(logIndex),
  };
}

function roleAdminChangedLog({ address, role, previousAdmin, newAdmin, txHash, blockNumber, transactionIndex, logIndex }) {
  return {
    address: address.toLowerCase(),
    topics: [ROLE_ADMIN_CHANGED_TOPIC, role.toLowerCase(), previousAdmin.toLowerCase(), newAdmin.toLowerCase()],
    data: "0x",
    transactionHash: txHash,
    blockNumber: rpcQuantity(blockNumber),
    transactionIndex: rpcQuantity(transactionIndex),
    logIndex: rpcQuantity(logIndex),
  };
}

function groupRoleLogs(logs) {
  const grouped = new Map();
  for (const log of logs) {
    const key = roleLogKey(log.address, log.topics[0]);
    grouped.set(key, [...(grouped.get(key) ?? []), log]);
  }
  return grouped;
}

function baselineRoleLogEntries(options = {}) {
  const logs = [
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.defaultAdmin,
      account: DEPLOYER,
      sender: DEPLOYER,
      txHash: TX_FACTORY,
      blockNumber: 8_000_000,
      transactionIndex: 1,
      logIndex: 1,
    }),
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.defaultAdmin,
      account: FACTORY_GOVERNANCE,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 10,
    }),
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.fundingSigner,
      account: FUNDING_SIGNER,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 11,
    }),
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.intentSigner,
      account: INTENT_SIGNER,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 12,
    }),
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.settler,
      account: SETTLER,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 13,
    }),
    roleRevokeLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.defaultAdmin,
      account: DEPLOYER,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 14,
    }),
    roleGrantLog({
      address: REGISTRY,
      role: REGISTRY_ROLE_IDS.defaultAdmin,
      account: DEPLOYER,
      sender: DEPLOYER,
      txHash: TX_REGISTRY,
      blockNumber: 8_000_000,
      transactionIndex: 0,
      logIndex: 0,
    }),
    roleGrantLog({
      address: REGISTRY,
      role: REGISTRY_ROLE_IDS.defaultAdmin,
      account: REGISTRY_GOVERNANCE,
      sender: DEPLOYER,
      txHash: TX_REGISTRY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 1,
      logIndex: 20,
    }),
    roleGrantLog({
      address: REGISTRY,
      role: REGISTRY_ROLE_IDS.sourceAdmin,
      account: SOURCE_ADMIN,
      sender: DEPLOYER,
      txHash: TX_REGISTRY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 1,
      logIndex: 21,
    }),
    roleRevokeLog({
      address: REGISTRY,
      role: REGISTRY_ROLE_IDS.defaultAdmin,
      account: DEPLOYER,
      sender: DEPLOYER,
      txHash: TX_REGISTRY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 1,
      logIndex: 22,
    }),
    roleAdminChangedLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.intentSigner,
      previousAdmin: DEFAULT_ADMIN_ROLE,
      newAdmin: DEFAULT_ADMIN_ROLE,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 15,
    }),
  ];

  const transformedLogs = logs.map((log) => {
    if (
      options.wrongFactoryIntentGrantSender
      && log.topics[0] === ROLE_GRANTED_TOPIC
      && log.address === FACTORY.toLowerCase()
      && log.topics[1] === FACTORY_ROLE_IDS.intentSigner
    ) {
      return {
        ...log,
        topics: [log.topics[0], log.topics[1], log.topics[2], paddedAddress(FACTORY_GOVERNANCE)],
      };
    }
    return log;
  });

  return groupRoleLogs(
    transformedLogs.filter((log) => {
      if (options.omitFactoryIntentGrant && log.topics[0] === ROLE_GRANTED_TOPIC && log.topics[1] === FACTORY_ROLE_IDS.intentSigner) {
        return false;
      }
      if (
        options.omitRegistryDeployerDefaultAdminRevoke
        && log.topics[0] === ROLE_REVOKED_TOPIC
        && log.address === REGISTRY.toLowerCase()
        && log.topics[1] === REGISTRY_ROLE_IDS.defaultAdmin
        && log.topics[2] === paddedAddress(DEPLOYER)
      ) {
        return false;
      }
      return true;
    }),
  );
}

function minimalProxyRuntime(implementation) {
  return `0x363d3d373d3d3d363d73${implementation.toLowerCase().slice(2)}5af43d82803e903d91602b57fd5bf3`;
}

function artifactHashes(runtimeCode) {
  return {
    initCodeHash: HASH_A,
    creationBytecodeHash: HASH_B,
    compiledDeployedBytecodeHash: HASH_C,
    onchainRuntimeBytecodeHash: runtimeHash(runtimeCode),
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

function core({ name, type, address, sourceFile, txHash, runtimeCode, constructorArguments, initializerArguments }) {
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
    artifactHashes: artifactHashes(runtimeCode),
  };
}

function manifest(overrides = {}) {
  const base = buildDeploymentManifest({
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
        runtimeCode: REGISTRY_CODE,
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
        runtimeCode: IMPLEMENTATION_CODE,
        constructorArguments: { raw: "0x", decoded: {} },
        initializerArguments: { locked: true, raw: "0x", decoded: {} },
      }),
      factory: core({
        name: "ResearchEscrowFactory",
        type: "factory",
        address: FACTORY,
        sourceFile: "src/factory/ResearchEscrowFactory.sol",
        txHash: TX_FACTORY,
        runtimeCode: FACTORY_CODE,
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
        address: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
        authority: "Circle USDC Contract Addresses",
        finalizedBlockNumber: 8_000_020,
        decimals: 6,
        codeHash: runtimeHash(USDC_CODE),
        proxyImplementation: PROXY_IMPLEMENTATION,
        projectDeployment: false,
      },
      {
        name: "Arc native USDC system emitter",
        type: "system-emitter",
        chainId: ARC_TESTNET_CHAIN_ID,
        address: ARC_NATIVE_USDC_SYSTEM_EMITTER,
        authority: "Arc USDC system events",
        finalizedBlockNumber: 8_000_020,
        projectDeployment: false,
      },
    ],
    clones: [],
  });
  return Object.assign(base, overrides);
}

function cloneEvidence(overrides = {}) {
  const runtimeCode = minimalProxyRuntime(overrides.implementation ?? IMPLEMENTATION);
  return {
    clone: CLONE,
    buyer: SMOKE_BUYER,
    researchKey: HASH_A,
    factory: FACTORY,
    implementation: IMPLEMENTATION,
    registry: REGISTRY,
    usdc: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    salt: HASH_B,
    predictedAddress: CLONE,
    voucherHash: HASH_C,
    voucherNonce: "7",
    initializerArguments: {
      raw: "0x1234",
      decoded: {
        factory: FACTORY,
        registry: REGISTRY,
        usdc: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
        buyer: SMOKE_BUYER,
        researchKey: HASH_A,
        initialBudget: "420000",
        expectedExpiresAt: 8_020_000,
        activationCutoff: 8_010_000,
        plannedIntentSigner: INTENT_SIGNER,
      },
    },
    funding: {
      txHash: TX_CLONE_FUNDING,
      status: "success",
      blockNumber: 8_000_010,
      blockHash: HASH_H,
      transactionIndex: 3,
      factoryEventLogIndex: 4,
      usdcFundingTransferLogIndex: 5,
      nonZero: true,
      amountUnits: "420000",
    },
    initialBudget: "420000",
    activationCutoff: 8_010_000,
    expectedExpiresAt: 8_020_000,
    runtimeHash: runtimeHash(runtimeCode),
    state: "Funded",
    ...overrides,
  };
}

function topologyManifest(overrides = {}) {
  const candidate = manifest(overrides.manifest);
  candidate.clones = [cloneEvidence(overrides.clone)];
  candidate.cloneCounts = { funded: 1, settled: 0 };
  delete candidate.deploymentTopology;
  return candidate;
}

function units18(units6) {
  return (BigInt(units6) * 1_000_000_000_000n).toString();
}

function operationTransferPair({ from, to, amountUnits }) {
  return [
    {
      emitter: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
      decimals: 6,
      from,
      to,
      amount: String(amountUnits),
    },
    {
      emitter: ARC_NATIVE_USDC_SYSTEM_EMITTER,
      decimals: 18,
      from,
      to,
      amount: units18(amountUnits),
    },
  ];
}

function balanceDelta(address, before, after) {
  return {
    address,
    before: String(before),
    after: String(after),
    delta: (BigInt(after) - BigInt(before)).toString(),
  };
}

function smokeEvidence(overrides = {}) {
  const budgetUnits = "420000";
  const settlementUnits = "120000";
  const refundUnits = "300000";
  const gasUsed = "100000";
  const effectiveGasPrice = "1000000000";
  const nativeBefore18 = "1000000000000000000";
  const nativeAfter18 = (
    BigInt(nativeBefore18)
    - BigInt(gasUsed) * BigInt(effectiveGasPrice)
    - BigInt(units18(budgetUnits))
  ).toString();

  const evidence = {
    chainId: ARC_TESTNET_CHAIN_ID,
    clone: CLONE,
    buyer: SMOKE_BUYER,
    payout: PAYOUT,
    factory: FACTORY,
    registry: REGISTRY,
    implementation: IMPLEMENTATION,
    usdc: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    researchKey: HASH_A,
    initialBudgetUnits: budgetUnits,
    approval: {
      txHash: `0x${"88".repeat(32)}`,
      txFrom: SMOKE_BUYER,
      owner: SMOKE_BUYER,
      spender: FACTORY,
      token: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
      amountUnits: budgetUnits,
    },
    funding: {
      txHash: TX_CLONE_FUNDING,
      txFrom: SMOKE_BUYER,
      gasPayer: SMOKE_BUYER,
      directEoa: true,
      accountAbstraction: false,
      paymaster: null,
      gasUsed,
      effectiveGasPrice,
      nativeBefore18,
      nativeAfter18,
      transfers: operationTransferPair({ from: SMOKE_BUYER, to: CLONE, amountUnits: budgetUnits }),
      balanceDeltas: [
        balanceDelta(SMOKE_BUYER, "1000000", "580000"),
        balanceDelta(CLONE, "0", budgetUnits),
      ],
      isolation: { method: "state-diff", noOtherBuyerBalanceChange: true },
      factoryEvent: {
        buyer: SMOKE_BUYER,
        researchKey: HASH_A,
        escrow: CLONE,
        implementation: IMPLEMENTATION,
      },
      stateAfter: {
        state: "Funded",
        spent: "0",
        initialBudget: budgetUnits,
      },
    },
    activation: {
      signer: SMOKE_BUYER,
      txFrom: SETTLER,
      stateBefore: "Funded",
      stateAfter: "Active",
      intentSigner: INTENT_SIGNER,
      transfers: [],
    },
    settlement: {
      signer: INTENT_SIGNER,
      txFrom: SETTLER,
      amountUnits: settlementUnits,
      transfers: operationTransferPair({ from: CLONE, to: PAYOUT, amountUnits: settlementUnits }),
      balanceDeltas: [
        balanceDelta(CLONE, budgetUnits, refundUnits),
        balanceDelta(PAYOUT, "0", settlementUnits),
      ],
      summary: {
        itemsHash: HASH_B,
        total: settlementUnits,
        itemCount: 1,
      },
    },
    close: {
      signer: INTENT_SIGNER,
      txFrom: SETTLER,
      refundUnits,
      finalLiabilityHash: HASH_C,
      transfers: operationTransferPair({ from: CLONE, to: SMOKE_BUYER, amountUnits: refundUnits }),
      balanceDeltas: [
        balanceDelta(CLONE, refundUnits, "0"),
        balanceDelta(SMOKE_BUYER, "580000", "880000"),
      ],
      stateAfter: "Closed",
    },
  };

  return {
    ...evidence,
    ...overrides,
  };
}

function mockPrecompileSmokeHarness(evidence = smokeEvidence()) {
  const calls = [];
  return {
    calls,
    nativeEmitterMode: "mock-precompile",
    nativeEmitterReason: "Arc native USDC system emitter is represented by a deterministic local precompile harness",
    async approve(input) {
      calls.push({ operation: "approve", input });
      return evidence.approval;
    },
    async createAndFund(input) {
      calls.push({ operation: "createAndFund", input });
      return evidence.funding;
    },
    async activate(input) {
      calls.push({ operation: "activate", input });
      return evidence.activation;
    },
    async settleBatch(input) {
      calls.push({ operation: "settleBatch", input });
      return evidence.settlement;
    },
    async close(input) {
      calls.push({ operation: "close", input });
      return evidence.close;
    },
  };
}

function roleReadEntries(authority, roleId, member) {
  return [
    callEntry(authority, ACCESS_CONTROL_ABI, "getRoleAdmin", [roleId], returnBytes32(DEFAULT_ADMIN_ROLE)),
    callEntry(authority, ACCESS_CONTROL_ABI, "getRoleMemberCount", [roleId], returnUint256(1)),
    callEntry(authority, ACCESS_CONTROL_ABI, "getRoleMember", [roleId, 0n], returnAddress(member)),
    callEntry(authority, ACCESS_CONTROL_ABI, "hasRole", [roleId, DEPLOYER], returnBool(false)),
  ];
}

function baselineTopologyCalls(overrides = {}) {
  const entries = [
    callEntry(FACTORY, FACTORY_VIEW_ABI, "implementation", [], returnAddress(IMPLEMENTATION)),
    callEntry(FACTORY, FACTORY_VIEW_ABI, "registry", [], returnAddress(REGISTRY)),
    callEntry(FACTORY, FACTORY_VIEW_ABI, "usdc", [], returnAddress(OFFICIAL_ARC_TESTNET_USDC_ADDRESS)),
    callEntry(FACTORY, FACTORY_VIEW_ABI, "initialDeployer", [], returnAddress(DEPLOYER)),
    callEntry(REGISTRY, REGISTRY_VIEW_ABI, "factory", [], returnAddress(FACTORY)),
    callEntry(REGISTRY, REGISTRY_VIEW_ABI, "usdc", [], returnAddress(OFFICIAL_ARC_TESTNET_USDC_ADDRESS)),
    ...roleReadEntries(FACTORY, FACTORY_ROLE_IDS.defaultAdmin, FACTORY_GOVERNANCE),
    ...roleReadEntries(FACTORY, FACTORY_ROLE_IDS.fundingSigner, FUNDING_SIGNER),
    ...roleReadEntries(FACTORY, FACTORY_ROLE_IDS.intentSigner, INTENT_SIGNER),
    ...roleReadEntries(FACTORY, FACTORY_ROLE_IDS.settler, SETTLER),
    ...roleReadEntries(REGISTRY, REGISTRY_ROLE_IDS.defaultAdmin, REGISTRY_GOVERNANCE),
    ...roleReadEntries(REGISTRY, REGISTRY_ROLE_IDS.sourceAdmin, SOURCE_ADMIN),
  ];

  const intentSignerConflictRoles = [
    [FACTORY, FACTORY_ROLE_IDS.defaultAdmin],
    [FACTORY, FACTORY_ROLE_IDS.fundingSigner],
    [FACTORY, FACTORY_ROLE_IDS.settler],
    [REGISTRY, REGISTRY_ROLE_IDS.defaultAdmin],
    [REGISTRY, REGISTRY_ROLE_IDS.sourceAdmin],
  ];
  for (const [authority, roleId] of intentSignerConflictRoles) {
    entries.push(callEntry(authority, ACCESS_CONTROL_ABI, "hasRole", [roleId, INTENT_SIGNER], returnBool(false)));
  }
  const buyerSensitiveRoles = [
    [FACTORY, FACTORY_ROLE_IDS.defaultAdmin],
    [FACTORY, FACTORY_ROLE_IDS.fundingSigner],
    [FACTORY, FACTORY_ROLE_IDS.intentSigner],
    [FACTORY, FACTORY_ROLE_IDS.settler],
    [REGISTRY, REGISTRY_ROLE_IDS.defaultAdmin],
    [REGISTRY, REGISTRY_ROLE_IDS.sourceAdmin],
  ];
  for (const [authority, roleId] of buyerSensitiveRoles) {
    entries.push(callEntry(authority, ACCESS_CONTROL_ABI, "hasRole", [roleId, SMOKE_BUYER], returnBool(false)));
  }

  const map = new Map(entries);
  for (const [key, value] of overrides.callByToData ?? []) {
    map.set(key.toLowerCase(), value);
  }
  return map;
}

function initializerLockError() {
  const error = new Error("execution reverted: AlreadyInitialized");
  error.reverted = true;
  return error;
}

function initializeProbeKey() {
  const clone = cloneEvidence();
  const data = callData(INITIALIZE_ABI, "initialize", [
    FACTORY,
    REGISTRY,
    OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    clone.buyer,
    clone.researchKey,
    BigInt(clone.initialBudget),
    BigInt(clone.expectedExpiresAt),
    BigInt(clone.activationCutoff),
    clone.initializerArguments.decoded.plannedIntentSigner,
  ]);
  return callKey(IMPLEMENTATION, data);
}

function createRpc(overrides = {}) {
  const codeByAddress = new Map([
    [OFFICIAL_ARC_TESTNET_USDC_ADDRESS, USDC_CODE],
    [REGISTRY, REGISTRY_CODE],
    [IMPLEMENTATION, IMPLEMENTATION_CODE],
    [FACTORY, FACTORY_CODE],
    [PROXY_IMPLEMENTATION.toLowerCase(), "0x6005600555"],
    ...(overrides.codeByAddress ?? []),
  ].map(([address, code]) => [address.toLowerCase(), code]));
  const storageByAddressSlot = new Map([
    [`${OFFICIAL_ARC_TESTNET_USDC_ADDRESS}:${EIP1967_IMPLEMENTATION_SLOT}`, paddedAddress(PROXY_IMPLEMENTATION)],
    ...(overrides.storageByAddressSlot ?? []),
  ].map(([key, value]) => [key.toLowerCase(), value]));
  const callByToData = new Map([
    ...(overrides.callByToData ?? []),
  ].map(([key, value]) => [key.toLowerCase(), value]));
  const callErrorByToData = new Map([
    ...(overrides.callErrorByToData ?? []),
  ].map(([key, value]) => [key.toLowerCase(), value]));
  const logsByAddressTopic = new Map(
    overrides.logsByAddressTopic === undefined
      ? baselineRoleLogEntries()
      : overrides.logsByAddressTopic,
  );

  return {
    calls: [],
    async request({ method, params = [] }) {
      this.calls.push({ method, params });
      if (method === "eth_chainId") {
        return overrides.chainId ?? `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`;
      }
      if (method === "eth_getCode") {
        const [address] = params;
        return codeByAddress.get(address.toLowerCase()) ?? "0x";
      }
      if (method === "eth_call") {
        const [call] = params;
        const key = callKey(call.to, call.data);
        if (callErrorByToData.has(key)) {
          throw callErrorByToData.get(key);
        }
        if (callByToData.has(key)) {
          return callByToData.get(key);
        }
        assert.equal(call.to.toLowerCase(), OFFICIAL_ARC_TESTNET_USDC_ADDRESS);
        assert.equal(call.data, "0x313ce567");
        return overrides.decimalsResult ?? uint256Hex(6);
      }
      if (method === "eth_getStorageAt") {
        const [address, slot] = params;
        return storageByAddressSlot.get(`${address}:${slot}`.toLowerCase()) ?? uint256Hex(0);
      }
      if (method === "eth_getLogs") {
        const [filter] = params;
        return logsByAddressTopic.get(roleLogKey(filter.address, filter.topics[0])) ?? [];
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
  };
}

async function expectVerifierError(input, expected) {
  await assert.rejects(
    verifyArcDeploymentRpcEvidence(input),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.name, "RpcDeploymentVerifierError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

async function expectTopologyVerifierError(input, expected) {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles(input),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.name, "RpcDeploymentVerifierError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

async function expectLocalSmokeRunnerError(input, expected) {
  await assert.rejects(
    runLocalSmokeEvidence(input),
    (error) => {
      assert.ok(error instanceof LocalSmokeEvidenceRunnerError);
      assert.equal(error.name, "LocalSmokeEvidenceRunnerError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

test("RPC verifier 拒绝 wrapper/rpc request accessor 且不执行 getter", async () => {
  const manifestAccessorInput = { rpc: createRpc() };
  let manifestGetterExecuted = false;
  Object.defineProperty(manifestAccessorInput, "manifest", {
    enumerable: true,
    get() {
      manifestGetterExecuted = true;
      return manifest();
    },
  });

  await expectVerifierError(
    manifestAccessorInput,
    { code: "RPC_INPUT_INVALID", path: "$.manifest" },
  );
  assert.equal(manifestGetterExecuted, false);

  const topologyAccessorInput = { manifest: topologyManifest() };
  let rpcGetterExecuted = false;
  Object.defineProperty(topologyAccessorInput, "rpc", {
    enumerable: true,
    get() {
      rpcGetterExecuted = true;
      return createRpc();
    },
  });

  await expectTopologyVerifierError(
    topologyAccessorInput,
    { code: "RPC_INPUT_INVALID", path: "$.rpc" },
  );
  assert.equal(rpcGetterExecuted, false);

  const blockTagAccessorInput = { manifest: manifest(), rpc: createRpc() };
  let blockTagGetterExecuted = false;
  Object.defineProperty(blockTagAccessorInput, "blockTag", {
    enumerable: true,
    get() {
      blockTagGetterExecuted = true;
      return "finalized";
    },
  });

  await expectVerifierError(
    blockTagAccessorInput,
    { code: "RPC_INPUT_INVALID", path: "$.blockTag" },
  );
  assert.equal(blockTagGetterExecuted, false);

  const rpcWithAccessor = {};
  let requestGetterExecuted = false;
  Object.defineProperty(rpcWithAccessor, "request", {
    enumerable: true,
    get() {
      requestGetterExecuted = true;
      return createRpc().request;
    },
  });

  await expectVerifierError(
    { manifest: manifest(), rpc: rpcWithAccessor },
    { code: "RPC_CLIENT_INVALID", path: "rpc.request" },
  );
  assert.equal(requestGetterExecuted, false);
});

test("smoke evidence verifier 校验 Arc 双接口语义、native gas 公式、余额差和 lineage", () => {
  const report = verifyArcSmokeEvidence({
    manifest: topologyManifest(),
    evidence: smokeEvidence(),
  });

  assert.equal(report.status, "passed");
  assert.equal(report.chainId, ARC_TESTNET_CHAIN_ID);
  assert.deepEqual(report.flow, ["approve", "createAndFund", "activate", "settleBatch", "close"]);
  assert.equal(report.lineage.factory, FACTORY.toLowerCase());
  assert.equal(report.lineage.registry, REGISTRY.toLowerCase());
  assert.equal(report.lineage.implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(report.lineage.clone, CLONE.toLowerCase());
  assert.equal(report.lineage.researchKey, HASH_A);
  assert.equal(report.nativeFundingFormula.verified, true);
  assert.equal(report.nativeFundingFormula.budgetUnits6, "420000");
  assert.equal(report.nativeFundingFormula.budgetUnits18, units18("420000"));
  assert.equal(report.nativeFundingFormula.nativeDeltaMinusGas18, units18("420000"));
  assert.equal(report.transferSummary.funding.erc20.amount, "420000");
  assert.equal(report.transferSummary.funding.native.amount, units18("420000"));
  assert.equal(report.transferSummary.funding.deduplicatedLogicalTransfers, 1);
  assert.equal(report.transferSummary.settlement.deduplicatedLogicalTransfers, 1);
  assert.equal(report.transferSummary.close.deduplicatedLogicalTransfers, 1);
  assert.equal(report.funding.lineage.verified, true);
  assert.equal(report.funding.lineage.buyer, SMOKE_BUYER.toLowerCase());
  assert.equal(report.funding.lineage.researchKey, HASH_A);
  assert.equal(report.funding.lineage.escrow, CLONE.toLowerCase());
  assert.equal(report.funding.lineage.implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(report.settlement.summary.itemsHash, HASH_B);
  assert.equal(report.settlement.summary.total, "120000");
  assert.equal(report.settlement.summary.itemCount, 1);
  assert.equal(report.close.finalLiabilityHash, HASH_C);
  assert.equal(report.close.stateAfter, "Closed");
  assert.equal(report.accounting.initialBudgetUnits, "420000");
  assert.equal(report.accounting.settlementUnits, "120000");
  assert.equal(report.accounting.refundUnits, "300000");
  assert.equal(report.accounting.cloneBalanceZeroAfterClose, true);
});

test("smoke evidence verifier 在 native gas 公式或双接口金额不一致时 fail closed", () => {
  assert.throws(
    () =>
      verifyArcSmokeEvidence({
        manifest: topologyManifest(),
        evidence: smokeEvidence({
          funding: {
            ...smokeEvidence().funding,
            nativeAfter18: "1",
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof SmokeEvidenceVerificationError);
      assert.equal(error.code, "SMOKE_NATIVE_GAS_MISMATCH");
      assert.equal(error.path, "smoke.funding.nativeDelta18");
      return true;
    },
  );

  const evidence = smokeEvidence();
  evidence.funding.transfers[1] = {
    ...evidence.funding.transfers[1],
    amount: units18("420001"),
  };

  assert.throws(
    () =>
      verifyArcSmokeEvidence({
        manifest: topologyManifest(),
        evidence,
      }),
    (error) => {
      assert.ok(error instanceof SmokeEvidenceVerificationError);
      assert.equal(error.code, "SMOKE_TRANSFER_PAIR_MISMATCH");
      assert.equal(error.path, "smoke.funding.transfers");
      return true;
    },
  );
});

test("smoke evidence verifier 在余额差或 lineage 不一致时 fail closed", () => {
  const badBalance = smokeEvidence();
  badBalance.settlement.balanceDeltas[1] = balanceDelta(PAYOUT, "0", "119999");

  assert.throws(
    () =>
      verifyArcSmokeEvidence({
        manifest: topologyManifest(),
        evidence: badBalance,
      }),
    (error) => {
      assert.ok(error instanceof SmokeEvidenceVerificationError);
      assert.equal(error.code, "SMOKE_BALANCE_DELTA_MISMATCH");
      assert.equal(error.path, "smoke.settlement.balanceDeltas.payout");
      return true;
    },
  );

  assert.throws(
    () =>
      verifyArcSmokeEvidence({
        manifest: topologyManifest(),
        evidence: smokeEvidence({
          funding: {
            ...smokeEvidence().funding,
            factoryEvent: {
              ...smokeEvidence().funding.factoryEvent,
              implementation: WRONG_IMPLEMENTATION,
            },
          },
        }),
      }),
    (error) => {
      assert.ok(error instanceof SmokeEvidenceVerificationError);
      assert.equal(error.code, "SMOKE_LINEAGE_MISMATCH");
      assert.equal(error.path, "smoke.funding.factoryEvent.implementation");
      return true;
    },
  );
});

test("local smoke runner 实际驱动 mock-precompile harness 并将 evidence 喂给 verifier", async () => {
  const harness = mockPrecompileSmokeHarness();
  const result = await runLocalSmokeEvidence({
    manifest: topologyManifest(),
    harness,
  });

  assert.deepEqual(
    harness.calls.map((call) => call.operation),
    ["approve", "createAndFund", "activate", "settleBatch", "close"],
  );
  assert.equal(harness.calls[0].input.owner, SMOKE_BUYER.toLowerCase());
  assert.equal(harness.calls[1].input.factory, FACTORY.toLowerCase());
  assert.equal(harness.calls[2].input.intentSigner, INTENT_SIGNER.toLowerCase());
  assert.equal(harness.calls[3].input.payout, PAYOUT.toLowerCase());
  assert.equal(harness.calls[4].input.refundUnits, "300000");
  assert.equal(result.evidence.nativeEmitterHarness.mode, "mock-precompile");
  assert.match(result.evidence.nativeEmitterHarness.reason, /local precompile harness/);
  assert.equal(result.evidence.funding.txHash, TX_CLONE_FUNDING);
  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.funding.lineage.implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(result.verification.settlement.summary.itemsHash, HASH_B);
  assert.equal(result.verification.close.finalLiabilityHash, HASH_C);
});

test("local smoke runner 拒绝 wrapper/harness accessor 且不执行 getter", async () => {
  const manifestAccessorInput = { harness: mockPrecompileSmokeHarness() };
  let manifestGetterExecuted = false;
  Object.defineProperty(manifestAccessorInput, "manifest", {
    enumerable: true,
    get() {
      manifestGetterExecuted = true;
      return topologyManifest();
    },
  });

  await expectLocalSmokeRunnerError(
    manifestAccessorInput,
    { code: "LOCAL_SMOKE_INPUT_INVALID", path: "$.manifest" },
  );
  assert.equal(manifestGetterExecuted, false);

  const harnessAccessorInput = { manifest: topologyManifest() };
  let harnessGetterExecuted = false;
  Object.defineProperty(harnessAccessorInput, "harness", {
    enumerable: true,
    get() {
      harnessGetterExecuted = true;
      return mockPrecompileSmokeHarness();
    },
  });

  await expectLocalSmokeRunnerError(
    harnessAccessorInput,
    { code: "LOCAL_SMOKE_INPUT_INVALID", path: "$.harness" },
  );
  assert.equal(harnessGetterExecuted, false);

  const methodAccessorHarness = mockPrecompileSmokeHarness();
  let approveGetterExecuted = false;
  Object.defineProperty(methodAccessorHarness, "approve", {
    enumerable: true,
    get() {
      approveGetterExecuted = true;
      return async () => smokeEvidence().approval;
    },
  });

  await expectLocalSmokeRunnerError(
    { manifest: topologyManifest(), harness: methodAccessorHarness },
    { code: "LOCAL_SMOKE_HARNESS_INVALID", path: "harness.approve" },
  );
  assert.equal(approveGetterExecuted, false);

  const optionalAccessorHarness = mockPrecompileSmokeHarness();
  let modeGetterExecuted = false;
  Object.defineProperty(optionalAccessorHarness, "nativeEmitterMode", {
    enumerable: true,
    get() {
      modeGetterExecuted = true;
      return "mock-precompile";
    },
  });

  await expectLocalSmokeRunnerError(
    { manifest: topologyManifest(), harness: optionalAccessorHarness },
    { code: "LOCAL_SMOKE_HARNESS_INVALID", path: "harness.nativeEmitterMode" },
  );
  assert.equal(modeGetterExecuted, false);
});

test("独立 RPC verifier 使用内置 ARC 常量验证 USDC、native emitter 与核心 runtime", async () => {
  const rpc = createRpc();
  const report = await verifyArcDeploymentRpcEvidence({
    manifest: manifest(),
    rpc,
    blockTag: "finalized",
  });

  assert.equal(report.status, "passed");
  assert.equal(report.chainId, ARC_TESTNET_CHAIN_ID);
  assert.equal(report.authoritativeUsdc.address, OFFICIAL_ARC_TESTNET_USDC_ADDRESS);
  assert.equal(report.authoritativeUsdc.decimals, 6);
  assert.equal(report.authoritativeUsdc.runtimeHash, runtimeHash(USDC_CODE));
  assert.equal(report.nativeUsdcSystemEmitter.address, ARC_NATIVE_USDC_SYSTEM_EMITTER);
  assert.equal(report.coreContracts.registry.runtimeHash, runtimeHash(REGISTRY_CODE));
  assert.equal(report.coreContracts.implementation.runtimeHash, runtimeHash(IMPLEMENTATION_CODE));
  assert.equal(report.coreContracts.factory.runtimeHash, runtimeHash(FACTORY_CODE));
  assert.ok(rpc.calls.some((call) => call.method === "eth_getCode" && call.params[0] === OFFICIAL_ARC_TESTNET_USDC_ADDRESS));
});

test("manifest 或 RPC 中的替代 6 位 token 不能覆盖内置官方 USDC", async () => {
  const rpc = createRpc({
    codeByAddress: [
      [OFFICIAL_ARC_TESTNET_USDC_ADDRESS, "0x"],
      [OTHER_TOKEN, USDC_CODE],
    ],
  });

  await expectVerifierError(
    { manifest: manifest(), rpc, blockTag: "finalized" },
    { code: "CODE_MISSING", path: "rpc.usdc.code" },
  );
});

test("完整 topology verifier 读回 wiring、initializer 锁、clone implementation 与角色图", async () => {
  const rpc = createRpc({
    codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
    callByToData: baselineTopologyCalls(),
    callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
  });

  const report = await verifyArcDeploymentTopologyAndRoles({
    manifest: topologyManifest(),
    rpc,
    blockTag: "finalized",
  });

  assert.equal(report.status, "passed");
  assert.equal(report.wiring.factory.implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(report.wiring.registry.factory, FACTORY.toLowerCase());
  assert.equal(report.implementation.initializerLocked, true);
  assert.equal(report.clones[0].implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(report.roles.factory.INTENT_SIGNER_ROLE.members[0], INTENT_SIGNER.toLowerCase());
  assert.equal(report.roles.factory.INTENT_SIGNER_ROLE.count, 1);
  assert.equal(report.roles.factory.INTENT_SIGNER_ROLE.admin, DEFAULT_ADMIN_ROLE);
  assert.equal(report.roles.deployerZeroPermissions, true);
  assert.equal(report.roles.intentSigner.eoa, true);
  assert.equal(report.roles.intentSigner.mutuallyExclusive, true);
  assert.equal(report.roles.grantRevokeProof.authorities.factory.roles.INTENT_SIGNER_ROLE.grants[0].account, INTENT_SIGNER.toLowerCase());
  assert.equal(report.roles.grantRevokeProof.authorities.factory.roles.DEFAULT_ADMIN_ROLE.revokes[0].account, DEPLOYER);
  assert.equal(report.deploymentTopology.verified, true);
  assert.equal(report.deploymentTopology.formula, "3 + R");
  assert.equal(report.deploymentTopology.researchCloneR, 1);
  assert.equal(report.deploymentTopology.totalProjectContracts, 4);
  assert.equal(report.deploymentTopology.settledResearchClones, 0);
  assert.equal(report.deploymentTopology.excluded.externalDependencies, 2);
  assert.equal(report.smokeIdentities.verified, true);
  assert.equal(report.smokeIdentities.addresses.buyer, SMOKE_BUYER.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.payout, PAYOUT.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.deployer, DEPLOYER.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.factoryGovernance, FACTORY_GOVERNANCE.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.registryGovernance, REGISTRY_GOVERNANCE.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.sourceAdmin, SOURCE_ADMIN.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.fundingSigner, FUNDING_SIGNER.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.intentSigner, INTENT_SIGNER.toLowerCase());
  assert.equal(report.smokeIdentities.addresses.settler, SETTLER.toLowerCase());
  assert.equal(report.smokeIdentities.protocol.factory, FACTORY.toLowerCase());
  assert.equal(report.smokeIdentities.protocol.registry, REGISTRY.toLowerCase());
  assert.equal(report.smokeIdentities.protocol.implementation, IMPLEMENTATION.toLowerCase());
  assert.equal(report.smokeIdentities.protocol.usdc, OFFICIAL_ARC_TESTNET_USDC_ADDRESS);
  assert.equal(report.smokeIdentities.protocol.nativeEmitter, ARC_NATIVE_USDC_SYSTEM_EMITTER);
  assert.equal(report.smokeIdentities.protocol.clone, CLONE.toLowerCase());
  assert.equal(report.smokeIdentities.identityMatrix.smokeBuyer.role, "smoke-buyer");
  assert.equal(report.smokeIdentities.identityMatrix.smokePayout.role, "smoke-payout");
  assert.equal(report.smokeIdentities.identityMatrix.deployer.role, "deployment-key");
  assert.equal(report.smokeIdentities.identityMatrix.factoryGovernance.role, "factory-admin");
  assert.equal(report.smokeIdentities.identityMatrix.registryGovernance.role, "registry-admin");
  assert.equal(report.smokeIdentities.identityMatrix.sourceAdmin.role, "source-admin");
  assert.equal(report.smokeIdentities.identityMatrix.fundingSigner.role, "funding-signer");
  assert.equal(report.smokeIdentities.identityMatrix.intentSigner.role, "intent-signer");
  assert.equal(report.smokeIdentities.identityMatrix.settler.role, "settler");
  assert.equal(report.smokeIdentities.identityMatrix.factory.role, "protocol-contract");
  assert.equal(report.smokeIdentities.identityMatrix.usdc.role, "authoritative-usdc");
  assert.equal(report.smokeIdentities.relationships.payoutDistinctFromSensitiveIdentities, true);
  assert.equal(report.smokeIdentities.relationships.payoutDistinctFromProtocolAddresses, true);
  assert.equal(report.smokeIdentities.relationships.buyerSensitiveRoleFree, true);
  assert.equal(report.smokeIdentities.payoutDistinctFrom.length, 14);
  assert.equal(report.smokeIdentities.buyerSensitiveRoleFree, true);
});

test("smoke verifier 要求 payout 与敏感身份和协议地址隔离", async () => {
  const candidate = topologyManifest();
  candidate.roles.smokePayout = FUNDING_SIGNER.toLowerCase();

  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: candidate,
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "SMOKE_PAYOUT_IDENTITY_CONFLICT");
      assert.equal(error.path, "smokeIdentities.payout");
      return true;
    },
  );

  const protocolConflict = topologyManifest();
  protocolConflict.roles.smokePayout = FACTORY.toLowerCase();

  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: protocolConflict,
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "SMOKE_PAYOUT_IDENTITY_CONFLICT");
      assert.equal(error.path, "smokeIdentities.payout");
      return true;
    },
  );
});

test("smoke verifier 要求 buyer 不持有项目敏感角色", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [
            callEntry(FACTORY, ACCESS_CONTROL_ABI, "hasRole", [FACTORY_ROLE_IDS.fundingSigner, SMOKE_BUYER], returnBool(true)),
          ],
        }),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "SMOKE_BUYER_ROLE_CONFLICT");
      assert.equal(error.path, "smokeIdentities.buyer.FUNDING_SIGNER_ROLE");
      return true;
    },
  );
});

function expectSmokeEvidenceError(input, expected) {
  assert.throws(
    () => verifyArcSmokeEvidence(input),
    (error) => {
      assert.ok(error instanceof SmokeEvidenceVerificationError);
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

test("smoke evidence verifier 拒绝 wrapper/evidence accessor 且不执行 getter", () => {
  const wrapper = { manifest: topologyManifest() };
  let wrapperGetterExecuted = false;
  Object.defineProperty(wrapper, "evidence", {
    enumerable: true,
    get() {
      wrapperGetterExecuted = true;
      return smokeEvidence();
    },
  });

  expectSmokeEvidenceError(
    wrapper,
    { code: "SMOKE_EVIDENCE_INVALID", path: "$.evidence" },
  );
  assert.equal(wrapperGetterExecuted, false);

  const evidence = smokeEvidence();
  let evidenceGetterExecuted = false;
  Object.defineProperty(evidence, "funding", {
    enumerable: true,
    get() {
      evidenceGetterExecuted = true;
      return smokeEvidence().funding;
    },
  });

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke.funding" },
  );
  assert.equal(evidenceGetterExecuted, false);
});

test("smoke evidence verifier 拒绝非 JSON-like evidence 输入形状", () => {
  class CustomEvidence {}

  const symbolKeyed = smokeEvidence();
  symbolKeyed[Symbol("hidden")] = "must not be accepted";
  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: symbolKeyed },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke" },
  );

  const hidden = smokeEvidence();
  Object.defineProperty(hidden, "hidden", {
    enumerable: false,
    value: "must not be accepted",
  });
  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: hidden },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke" },
  );

  const sparse = smokeEvidence();
  delete sparse.funding.transfers[0];
  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: sparse },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke.funding.transfers[0]" },
  );

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: Object.assign(new CustomEvidence(), smokeEvidence()) },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke" },
  );

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: Object.assign(Object.create(null), smokeEvidence()) },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke" },
  );

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: { ...smokeEvidence(), chainId: Number.NaN } },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke.chainId" },
  );

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: { ...smokeEvidence(), chainId: Number.POSITIVE_INFINITY } },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke.chainId" },
  );

  const circular = smokeEvidence();
  circular.funding.self = circular;
  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence: circular },
    { code: "SMOKE_EVIDENCE_INVALID", path: "smoke.funding.self" },
  );
});

test("smoke evidence verifier 校验 Arc 双接口 gas 公式、emitter 去重、余额差与 lineage", () => {
  const report = verifyArcSmokeEvidence({
    manifest: topologyManifest(),
    evidence: smokeEvidence(),
  });

  assert.equal(report.status, "passed");
  assert.equal(report.funding.nativeFormula.verified, true);
  assert.equal(report.funding.nativeFormula.budgetUnits18, units18("420000"));
  assert.equal(report.funding.transferPair.erc20.amount, "420000");
  assert.equal(report.funding.transferPair.native.amount, units18("420000"));
  assert.equal(report.funding.lineage.verified, true);
  assert.equal(report.activation.signer, SMOKE_BUYER.toLowerCase());
  assert.equal(report.settlement.transferPair.erc20.to, PAYOUT.toLowerCase());
  assert.equal(report.close.refundUnits, "300000");
});

test("smoke evidence verifier 拒绝 funding native 18 位余额公式不匹配", () => {
  const evidence = smokeEvidence({
    funding: {
      ...smokeEvidence().funding,
      nativeAfter18: "1",
    },
  });

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence },
    { code: "SMOKE_NATIVE_GAS_MISMATCH", path: "smoke.funding.nativeDelta18" },
  );
});

test("smoke evidence verifier 按 emitter 区分六位和 18 位 Transfer，不能双计", () => {
  const evidence = smokeEvidence();
  evidence.funding.transfers[1].emitter = OFFICIAL_ARC_TESTNET_USDC_ADDRESS;

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence },
    { code: "SMOKE_NATIVE_TRANSFER_MISSING", path: "smoke.funding.transfers.native" },
  );
});

test("smoke evidence verifier 拒绝 settlement payout 余额差与 Transfer 不一致", () => {
  const evidence = smokeEvidence();
  evidence.settlement.balanceDeltas[1] = balanceDelta(PAYOUT, "0", "119999");

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence },
    { code: "SMOKE_BALANCE_DELTA_MISMATCH", path: "smoke.settlement.balanceDeltas.payout" },
  );
});

test("smoke evidence verifier 拒绝 Factory child lineage 与 manifest clone 不一致", () => {
  const evidence = smokeEvidence();
  evidence.funding.factoryEvent.implementation = WRONG_IMPLEMENTATION.toLowerCase();

  expectSmokeEvidenceError(
    { manifest: topologyManifest(), evidence },
    { code: "SMOKE_LINEAGE_MISMATCH", path: "smoke.funding.factoryEvent.implementation" },
  );
});

test("Factory/Registry wiring 与 manifest 不一致时 fail closed", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [
            callEntry(FACTORY, FACTORY_VIEW_ABI, "registry", [], returnAddress(OTHER_TOKEN.toLowerCase())),
          ],
        }),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "WIRING_MISMATCH");
      assert.equal(error.path, "wiring.factory.registry");
      return true;
    },
  );
});

test("implementation initializer 若可被调用则 fail closed", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [[initializeProbeKey(), "0x"]],
        }),
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "INITIALIZER_UNLOCKED");
      assert.equal(error.path, "contracts.implementation.initializer");
      return true;
    },
  );
});

test("clone runtime 指向非 manifest implementation 时 fail closed", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(WRONG_IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "CLONE_IMPLEMENTATION_MISMATCH");
      assert.equal(error.path, "clones[0].implementation");
      return true;
    },
  );
});

test("角色成员数量不是精确 1 时 fail closed，不能隐藏额外成员", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [
            callEntry(FACTORY, ACCESS_CONTROL_ABI, "getRoleMemberCount", [FACTORY_ROLE_IDS.intentSigner], returnUint256(2)),
          ],
        }),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "ROLE_MEMBER_COUNT_MISMATCH");
      assert.equal(error.path, "roles.factory.INTENT_SIGNER_ROLE.count");
      return true;
    },
  );
});

test("deployer 若仍持有任一敏感角色则 fail closed", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [
            callEntry(FACTORY, ACCESS_CONTROL_ABI, "hasRole", [FACTORY_ROLE_IDS.fundingSigner, DEPLOYER], returnBool(true)),
          ],
        }),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "DEPLOYER_ROLE_RETAINED");
      assert.equal(error.path, "roles.factory.FUNDING_SIGNER_ROLE.deployer");
      return true;
    },
  );
});

test("缺少角色 grant/revoke 事件证明时 fail closed，即使 readback 看起来正确", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
        logsByAddressTopic: baselineRoleLogEntries({ omitFactoryIntentGrant: true }),
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "ROLE_GRANT_EVENT_MISSING");
      assert.equal(error.path, "roles.factory.INTENT_SIGNER_ROLE.grant");
      return true;
    },
  );

  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
        logsByAddressTopic: baselineRoleLogEntries({ omitRegistryDeployerDefaultAdminRevoke: true }),
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "ROLE_REVOKE_EVENT_MISSING");
      assert.equal(error.path, "roles.registry.DEFAULT_ADMIN_ROLE.deployerRevoke");
      return true;
    },
  );
});

test("角色 grant/revoke 事件必须由 deployer 执行，不能只匹配 role/account", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
        logsByAddressTopic: baselineRoleLogEntries({ wrongFactoryIntentGrantSender: true }),
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "ROLE_GRANT_EVENT_MISSING");
      assert.equal(error.path, "roles.factory.INTENT_SIGNER_ROLE.grant");
      return true;
    },
  );
});

test("角色事件重放最终成员与 enumerable readback 不一致时 fail closed", async () => {
  const logsByAddressTopic = baselineRoleLogEntries();
  const factoryGrantKey = roleLogKey(FACTORY, ROLE_GRANTED_TOPIC);
  logsByAddressTopic.set(factoryGrantKey, [
    ...logsByAddressTopic.get(factoryGrantKey),
    roleGrantLog({
      address: FACTORY,
      role: FACTORY_ROLE_IDS.intentSigner,
      account: OTHER_TOKEN,
      sender: DEPLOYER,
      txHash: TX_FACTORY_ROLE_TRANSFER,
      blockNumber: 8_000_006,
      transactionIndex: 2,
      logIndex: 16,
    }),
  ]);

  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
        logsByAddressTopic,
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "ROLE_EVENT_REPLAY_MISMATCH");
      assert.equal(error.path, "roles.factory.INTENT_SIGNER_ROLE.events");
      return true;
    },
  );
});

test("INTENT_SIGNER 必须是 EOA 且不能持有其它敏感角色", async () => {
  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [
          [CLONE, minimalProxyRuntime(IMPLEMENTATION)],
          [INTENT_SIGNER, "0x6007600755"],
        ],
        callByToData: baselineTopologyCalls(),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "INTENT_SIGNER_NOT_EOA");
      assert.equal(error.path, "roles.intentSigner.code");
      return true;
    },
  );

  await assert.rejects(
    verifyArcDeploymentTopologyAndRoles({
      manifest: topologyManifest(),
      rpc: createRpc({
        codeByAddress: [[CLONE, minimalProxyRuntime(IMPLEMENTATION)]],
        callByToData: baselineTopologyCalls({
          callByToData: [
            callEntry(FACTORY, ACCESS_CONTROL_ABI, "hasRole", [FACTORY_ROLE_IDS.settler, INTENT_SIGNER], returnBool(true)),
          ],
        }),
        callErrorByToData: [[initializeProbeKey(), initializerLockError()]],
      }),
      blockTag: "finalized",
    }),
    (error) => {
      assert.ok(error instanceof RpcDeploymentVerifierError);
      assert.equal(error.code, "INTENT_SIGNER_ROLE_CONFLICT");
      assert.equal(error.path, "roles.intentSigner.SETTLER_ROLE");
      return true;
    },
  );
});

test("USDC decimals 不为 6 时 fail closed", async () => {
  await expectVerifierError(
    { manifest: manifest(), rpc: createRpc({ decimalsResult: uint256Hex(18) }), blockTag: "finalized" },
    { code: "USDC_DECIMALS_INVALID", path: "rpc.usdc.decimals" },
  );
});

test("核心合约 runtime hash 与 manifest 不一致时 fail closed", async () => {
  await expectVerifierError(
    {
      manifest: manifest(),
      rpc: createRpc({ codeByAddress: [[FACTORY, "0x6009"]] }),
      blockTag: "finalized",
    },
    { code: "RUNTIME_HASH_MISMATCH", path: "contracts.factory.runtimeHash" },
  );
});

test("USDC proxy implementation 与公开证据不一致时 fail closed", async () => {
  await expectVerifierError(
    {
      manifest: manifest(),
      rpc: createRpc({
        storageByAddressSlot: [
          [`${OFFICIAL_ARC_TESTNET_USDC_ADDRESS}:${EIP1967_IMPLEMENTATION_SLOT}`, paddedAddress(OTHER_TOKEN)],
        ],
      }),
      blockTag: "finalized",
    },
    { code: "PROXY_IMPLEMENTATION_MISMATCH", path: "rpc.usdc.proxyImplementation" },
  );
});

test("native emitter 必须等于内置 Arc system emitter", async () => {
  const candidate = manifest();
  candidate.externalDependencies[1].address = OTHER_TOKEN;
  delete candidate.deploymentTopology;

  await expectVerifierError(
    { manifest: candidate, rpc: createRpc(), blockTag: "finalized" },
    { code: "NATIVE_EMITTER_MISMATCH", path: "manifest.externalDependencies.nativeEmitter" },
  );
});
