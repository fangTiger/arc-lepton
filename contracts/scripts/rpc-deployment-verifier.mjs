import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toBytes } from "viem";

import { validateDeploymentManifest } from "./deployment-manifest.mjs";

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const OFFICIAL_ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";
export const ARC_NATIVE_USDC_SYSTEM_EMITTER =
  "0xfffffffffffffffffffffffffffffffffffffffe";
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const DECIMALS_SELECTOR = "0x313ce567";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CORE_CONTRACT_KEYS = ["registry", "implementation", "factory"];
const DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}`;
const FACTORY_ROLE_IDS = {
  DEFAULT_ADMIN_ROLE,
  FUNDING_SIGNER_ROLE: keccak256(toBytes("FUNDING_SIGNER_ROLE")),
  INTENT_SIGNER_ROLE: keccak256(toBytes("INTENT_SIGNER_ROLE")),
  SETTLER_ROLE: keccak256(toBytes("SETTLER_ROLE")),
};
const REGISTRY_ROLE_IDS = {
  DEFAULT_ADMIN_ROLE,
  SOURCE_ADMIN_ROLE: keccak256(toBytes("SOURCE_ADMIN_ROLE")),
};
const ROLE_GRANTED_TOPIC = keccak256(toBytes("RoleGranted(bytes32,address,address)"));
const ROLE_REVOKED_TOPIC = keccak256(toBytes("RoleRevoked(bytes32,address,address)"));
const ROLE_ADMIN_CHANGED_TOPIC = keccak256(toBytes("RoleAdminChanged(bytes32,bytes32,bytes32)"));
const ROLE_EVENT_TOPICS = [
  { type: "granted", topic: ROLE_GRANTED_TOPIC, name: "RoleGranted" },
  { type: "revoked", topic: ROLE_REVOKED_TOPIC, name: "RoleRevoked" },
  { type: "adminChanged", topic: ROLE_ADMIN_CHANGED_TOPIC, name: "RoleAdminChanged" },
];
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
const MINIMAL_PROXY_PREFIX = "0x363d3d373d3d3d363d73";
const MINIMAL_PROXY_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

export class RpcDeploymentVerifierError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "RpcDeploymentVerifierError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new RpcDeploymentVerifierError(code, path, message);
}

function normalizeAddress(address) {
  return String(address).toLowerCase();
}

function requireInputDataDescriptor(descriptor, path) {
  if (descriptor === undefined) {
    fail("RPC_INPUT_INVALID", path, `${path} 缺少字段`);
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("RPC_INPUT_INVALID", path, `${path} 只能包含 JSON-like 可枚举 data property`);
  }
  return descriptor.value;
}

function requireVerifierInputEnvelope(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("RPC_INPUT_INVALID", "$", "$ 必须是对象");
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    fail("RPC_INPUT_INVALID", "$", "$ 只能是 JSON-like plain object");
  }
  if (Object.getOwnPropertySymbols(input).length !== 0) {
    fail("RPC_INPUT_INVALID", "$", "$ 不得包含 symbol key");
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownNames = Object.getOwnPropertyNames(input);
  const enumerableKeys = Object.keys(input);
  if (ownNames.length !== enumerableKeys.length) {
    fail("RPC_INPUT_INVALID", "$", "$ 只能包含 JSON-like 可枚举 data property");
  }
  for (const key of enumerableKeys) {
    requireInputDataDescriptor(descriptors[key], `$.${key}`);
  }

  const blockTagDescriptor = descriptors.blockTag;
  return {
    manifest: requireInputDataDescriptor(descriptors.manifest, "$.manifest"),
    rpc: requireInputDataDescriptor(descriptors.rpc, "$.rpc"),
    blockTag:
      blockTagDescriptor === undefined || blockTagDescriptor.value === undefined
        ? "finalized"
        : requireInputDataDescriptor(blockTagDescriptor, "$.blockTag"),
  };
}

function findPropertyDescriptor(value, property) {
  let current = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function requireRpc(rpc) {
  if (rpc === null || typeof rpc !== "object" || Array.isArray(rpc)) {
    fail("RPC_CLIENT_INVALID", "rpc", "rpc 必须提供 request({method, params})");
  }
  const requestDescriptor = findPropertyDescriptor(rpc, "request");
  if (
    requestDescriptor === undefined
    || !Object.hasOwn(requestDescriptor, "value")
    || typeof requestDescriptor.value !== "function"
  ) {
    fail("RPC_CLIENT_INVALID", "rpc.request", "rpc.request 必须是 data function");
  }
  return rpc;
}

function parseRpcQuantity(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    fail("RPC_QUANTITY_INVALID", path, `${path} 必须是 0x quantity`);
  }
  return Number(BigInt(value));
}

function normalizeCode(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    fail("RPC_CODE_INVALID", path, `${path} 必须是 0x hex code`);
  }
  return value.toLowerCase();
}

function runtimeHash(code) {
  return keccak256(code);
}

function requireCode(code, path) {
  const normalized = normalizeCode(code, path);
  if (normalized === "0x") {
    fail("CODE_MISSING", path, `${path} 不得为空 code`);
  }
  return normalized;
}

function decodeUint256(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("RPC_CALL_RESULT_INVALID", path, `${path} 必须是 32-byte ABI 返回值`);
  }
  return BigInt(value);
}

function decodeAddressFromStorage(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("RPC_STORAGE_INVALID", path, `${path} 必须是 32-byte storage word`);
  }
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return address === ZERO_ADDRESS ? null : address;
}

async function rpcRequest(rpc, method, params, path) {
  try {
    return await rpc.request({ method, params });
  } catch (error) {
    fail("RPC_REQUEST_FAILED", path, `${method} 请求失败：${error?.message ?? "unknown"}`);
  }
}

function decodeCallResult(abi, functionName, data, path) {
  try {
    return decodeFunctionResult({ abi, functionName, data });
  } catch (error) {
    fail("RPC_CALL_RESULT_INVALID", path, `${path} ABI 解码失败：${error?.message ?? "unknown"}`);
  }
}

async function callContract(rpc, address, abi, functionName, args, blockTag, path) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpcRequest(rpc, "eth_call", [{ to: address, data }, blockTag], path);
  return decodeCallResult(abi, functionName, result, path);
}

function requireExpectedAddress(actual, expected, path) {
  const normalized = normalizeAddress(actual);
  if (normalized !== normalizeAddress(expected)) {
    fail("WIRING_MISMATCH", path, `${path} 与 manifest 不一致`);
  }
  return normalized;
}

function requireExpectedBytes32(actual, expected, path) {
  const normalized = String(actual).toLowerCase();
  if (normalized !== String(expected).toLowerCase()) {
    fail("ROLE_ADMIN_MISMATCH", path, `${path} 与预期 role admin 不一致`);
  }
  return normalized;
}

function requireExpectedRoleMember(actual, expected, path) {
  const normalized = normalizeAddress(actual);
  if (normalized !== normalizeAddress(expected)) {
    fail("ROLE_MEMBER_MISMATCH", path, `${path} 与预期 role member 不一致`);
  }
  return normalized;
}

function minimalProxyRuntime(implementation) {
  return `${MINIMAL_PROXY_PREFIX}${normalizeAddress(implementation).slice(2)}${MINIMAL_PROXY_SUFFIX}`;
}

function decodeMinimalProxyImplementation(code) {
  if (
    code.length !== MINIMAL_PROXY_PREFIX.length + 40 + MINIMAL_PROXY_SUFFIX.length
    || !code.startsWith(MINIMAL_PROXY_PREFIX)
    || !code.endsWith(MINIMAL_PROXY_SUFFIX)
  ) {
    return null;
  }
  return `0x${code.slice(MINIMAL_PROXY_PREFIX.length, MINIMAL_PROXY_PREFIX.length + 40)}`;
}

function toRpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function requireBytes32Hex(value, path) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("RPC_LOG_INVALID", path, `${path} 必须是 32-byte hex`);
  }
  return value.toLowerCase();
}

function topicAddress(topic, path) {
  const normalized = requireBytes32Hex(topic, path);
  return `0x${normalized.slice(-40)}`;
}

function requireRoleLogArray(value, path) {
  if (!Array.isArray(value)) {
    fail("RPC_LOGS_INVALID", path, `${path} 必须返回 log 数组`);
  }
  return value;
}

function expectedRoleEventTopic(eventType) {
  if (eventType === "granted") {
    return ROLE_GRANTED_TOPIC;
  }
  if (eventType === "revoked") {
    return ROLE_REVOKED_TOPIC;
  }
  return ROLE_ADMIN_CHANGED_TOPIC;
}

function normalizeRoleEventLog(raw, authority, eventType, index, path) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("RPC_LOG_INVALID", `${path}[${index}]`, "role event log 必须是对象");
  }
  if (raw.address !== undefined && normalizeAddress(raw.address) !== authority) {
    fail("RPC_LOG_INVALID", `${path}[${index}].address`, "role event log address 与 filter 不一致");
  }
  if (!Array.isArray(raw.topics) || raw.topics.length !== 4) {
    fail("RPC_LOG_INVALID", `${path}[${index}].topics`, "role event log 必须包含 4 个 indexed topic");
  }

  const topic0 = requireBytes32Hex(raw.topics[0], `${path}[${index}].topics[0]`);
  if (topic0 !== expectedRoleEventTopic(eventType)) {
    fail("RPC_LOG_INVALID", `${path}[${index}].topics[0]`, "role event topic 与查询类型不一致");
  }
  const role = requireBytes32Hex(raw.topics[1], `${path}[${index}].topics[1]`);
  const blockNumber = parseRpcQuantity(raw.blockNumber, `${path}[${index}].blockNumber`);
  const transactionIndex = parseRpcQuantity(raw.transactionIndex ?? "0x0", `${path}[${index}].transactionIndex`);
  const logIndex = parseRpcQuantity(raw.logIndex, `${path}[${index}].logIndex`);
  const base = {
    type: eventType,
    topic0,
    role,
    txHash: requireBytes32Hex(raw.transactionHash, `${path}[${index}].transactionHash`),
    blockNumber,
    transactionIndex,
    logIndex,
  };

  if (eventType === "adminChanged") {
    return {
      ...base,
      previousAdmin: requireBytes32Hex(raw.topics[2], `${path}[${index}].topics[2]`),
      newAdmin: requireBytes32Hex(raw.topics[3], `${path}[${index}].topics[3]`),
    };
  }

  return {
    ...base,
    account: topicAddress(raw.topics[2], `${path}[${index}].topics[2]`),
    sender: topicAddress(raw.topics[3], `${path}[${index}].topics[3]`),
  };
}

function eventProof(event) {
  const proof = {
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
  };
  if (event.account !== undefined) {
    proof.account = event.account;
  }
  if (event.sender !== undefined) {
    proof.sender = event.sender;
  }
  if (event.previousAdmin !== undefined) {
    proof.previousAdmin = event.previousAdmin;
  }
  if (event.newAdmin !== undefined) {
    proof.newAdmin = event.newAdmin;
  }
  return proof;
}

async function getCode(rpc, address, blockTag, path) {
  const code = await rpcRequest(rpc, "eth_getCode", [address, blockTag], path);
  return requireCode(code, path);
}

async function verifyChainId(rpc) {
  const chainId = parseRpcQuantity(await rpcRequest(rpc, "eth_chainId", [], "rpc.chainId"), "rpc.chainId");
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("CHAIN_ID_MISMATCH", "rpc.chainId", `RPC chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }
  return chainId;
}

function findOfficialUsdcDependency(manifest) {
  const dependency = manifest.externalDependencies.find(
    (item) => normalizeAddress(item.address) === OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
  );
  if (dependency === undefined) {
    fail(
      "USDC_DEPENDENCY_MISSING",
      "manifest.externalDependencies.usdc",
      "manifest 必须列出内置官方 USDC 外部依赖",
    );
  }
  if (dependency.codeHash === undefined) {
    fail(
      "USDC_RUNTIME_HASH_MISSING",
      "manifest.externalDependencies.usdc.codeHash",
      "官方 USDC 外部依赖必须记录 runtime code hash",
    );
  }
  if (dependency.decimals !== 6) {
    fail("USDC_DECIMALS_INVALID", "manifest.externalDependencies.usdc.decimals", "manifest USDC decimals 必须为 6");
  }
  return dependency;
}

function verifyNativeEmitterDependency(manifest) {
  const dependency = manifest.externalDependencies.find(
    (item) => item.type === "system-emitter" || normalizeAddress(item.address) === ARC_NATIVE_USDC_SYSTEM_EMITTER,
  );
  if (
    dependency === undefined
    || normalizeAddress(dependency.address) !== ARC_NATIVE_USDC_SYSTEM_EMITTER
  ) {
    fail(
      "NATIVE_EMITTER_MISMATCH",
      "manifest.externalDependencies.nativeEmitter",
      "native USDC system emitter 必须等于内置 Arc emitter",
    );
  }
  return dependency;
}

async function verifyOfficialUsdc(rpc, manifest, blockTag) {
  const dependency = findOfficialUsdcDependency(manifest);
  const code = await getCode(rpc, OFFICIAL_ARC_TESTNET_USDC_ADDRESS, blockTag, "rpc.usdc.code");
  const codeHash = runtimeHash(code);
  if (codeHash !== dependency.codeHash) {
    fail(
      "RUNTIME_HASH_MISMATCH",
      "rpc.usdc.runtimeHash",
      "官方 USDC runtime hash 与 manifest 不一致",
    );
  }

  const decimals = Number(
    decodeUint256(
      await rpcRequest(
        rpc,
        "eth_call",
        [{ to: OFFICIAL_ARC_TESTNET_USDC_ADDRESS, data: DECIMALS_SELECTOR }, blockTag],
        "rpc.usdc.decimals",
      ),
      "rpc.usdc.decimals",
    ),
  );
  if (decimals !== 6) {
    fail("USDC_DECIMALS_INVALID", "rpc.usdc.decimals", "官方 USDC decimals 必须为 6");
  }

  const report = {
    address: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    runtimeHash: codeHash,
    decimals,
  };

  if (dependency.proxyImplementation !== undefined) {
    const implementation = decodeAddressFromStorage(
      await rpcRequest(
        rpc,
        "eth_getStorageAt",
        [OFFICIAL_ARC_TESTNET_USDC_ADDRESS, EIP1967_IMPLEMENTATION_SLOT, blockTag],
        "rpc.usdc.proxyImplementation",
      ),
      "rpc.usdc.proxyImplementation",
    );
    if (implementation !== dependency.proxyImplementation) {
      fail(
        "PROXY_IMPLEMENTATION_MISMATCH",
        "rpc.usdc.proxyImplementation",
        "官方 USDC proxy implementation 与 manifest 不一致",
      );
    }
    await getCode(rpc, implementation, blockTag, "rpc.usdc.proxyImplementation.code");
    report.proxyImplementation = implementation;
  }

  return report;
}

async function verifyCoreContracts(rpc, manifest, blockTag) {
  const entries = {};
  for (const key of CORE_CONTRACT_KEYS) {
    const contract = manifest.contracts[key];
    const code = await getCode(rpc, contract.address, blockTag, `contracts.${key}.code`);
    const codeHash = runtimeHash(code);
    const expected = contract.artifactHashes.onchainRuntimeBytecodeHash;
    if (codeHash !== expected) {
      fail(
        "RUNTIME_HASH_MISMATCH",
        `contracts.${key}.runtimeHash`,
        `${key} runtime hash 与 manifest 不一致`,
      );
    }
    entries[key] = {
      address: contract.address,
      runtimeHash: codeHash,
    };
  }
  return entries;
}

async function verifyWiring(rpc, manifest, blockTag) {
  const factory = {
    implementation: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.factory,
        FACTORY_VIEW_ABI,
        "implementation",
        [],
        blockTag,
        "wiring.factory.implementation",
      ),
      manifest.addresses.implementation,
      "wiring.factory.implementation",
    ),
    registry: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.factory,
        FACTORY_VIEW_ABI,
        "registry",
        [],
        blockTag,
        "wiring.factory.registry",
      ),
      manifest.addresses.registry,
      "wiring.factory.registry",
    ),
    usdc: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.factory,
        FACTORY_VIEW_ABI,
        "usdc",
        [],
        blockTag,
        "wiring.factory.usdc",
      ),
      OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
      "wiring.factory.usdc",
    ),
    initialDeployer: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.factory,
        FACTORY_VIEW_ABI,
        "initialDeployer",
        [],
        blockTag,
        "wiring.factory.initialDeployer",
      ),
      manifest.deployer,
      "wiring.factory.initialDeployer",
    ),
  };

  const registry = {
    factory: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.registry,
        REGISTRY_VIEW_ABI,
        "factory",
        [],
        blockTag,
        "wiring.registry.factory",
      ),
      manifest.addresses.factory,
      "wiring.registry.factory",
    ),
    usdc: requireExpectedAddress(
      await callContract(
        rpc,
        manifest.addresses.registry,
        REGISTRY_VIEW_ABI,
        "usdc",
        [],
        blockTag,
        "wiring.registry.usdc",
      ),
      OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
      "wiring.registry.usdc",
    ),
  };

  return { factory, registry };
}

async function verifyImplementationInitializerLocked(rpc, manifest, blockTag) {
  const path = "contracts.implementation.initializer";
  const probeClone = manifest.clones[0];
  const data = encodeFunctionData({
    abi: INITIALIZE_ABI,
    functionName: "initialize",
    args: [
      manifest.addresses.factory,
      manifest.addresses.registry,
      OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
      probeClone?.buyer ?? manifest.roles.smokeBuyer,
      probeClone?.researchKey ?? "0x0000000000000000000000000000000000000000000000000000000000000001",
      BigInt(probeClone?.initialBudget ?? "1"),
      BigInt(probeClone?.expectedExpiresAt ?? 2_000_000),
      BigInt(probeClone?.activationCutoff ?? 1_000_000),
      probeClone?.initializerArguments?.decoded?.plannedIntentSigner ?? manifest.roles.intentSigner,
    ],
  });

  try {
    await rpc.request({ method: "eth_call", params: [{ to: manifest.addresses.implementation, data }, blockTag] });
  } catch (error) {
    const message = String(error?.message ?? "");
    if (
      error?.reverted === true
      || /execution reverted|vm exception while processing transaction: revert|reverted with/i.test(message)
    ) {
      return {
        address: manifest.addresses.implementation,
        initializerLocked: true,
      };
    }
    fail("RPC_REQUEST_FAILED", path, `eth_call 请求失败：${error?.message ?? "unknown"}`);
  }

  fail("INITIALIZER_UNLOCKED", path, "implementation initializer 仍可被调用");
}

async function verifyClones(rpc, manifest, blockTag) {
  const clones = [];
  for (const [index, clone] of manifest.clones.entries()) {
    const code = await getCode(rpc, clone.clone, blockTag, `clones[${index}].code`);
    const implementation = decodeMinimalProxyImplementation(code);
    if (implementation === null) {
      fail("CLONE_RUNTIME_INVALID", `clones[${index}].code`, "clone runtime 必须是 EIP-1167 minimal proxy");
    }
    if (implementation !== manifest.addresses.implementation) {
      fail(
        "CLONE_IMPLEMENTATION_MISMATCH",
        `clones[${index}].implementation`,
        "clone runtime 指向的 implementation 与 manifest 不一致",
      );
    }
    const codeHash = runtimeHash(code);
    if (codeHash !== clone.runtimeHash) {
      fail("RUNTIME_HASH_MISMATCH", `clones[${index}].runtimeHash`, "clone runtime hash 与 manifest 不一致");
    }
    if (code !== minimalProxyRuntime(manifest.addresses.implementation)) {
      fail("CLONE_RUNTIME_INVALID", `clones[${index}].code`, "clone runtime bytecode 与 EIP-1167 模板不一致");
    }
    clones.push({
      address: clone.clone,
      implementation,
      runtimeHash: codeHash,
    });
  }
  return clones;
}

function roleChecks(manifest) {
  return [
    {
      scope: "factory",
      authority: manifest.addresses.factory,
      roleName: "DEFAULT_ADMIN_ROLE",
      roleId: FACTORY_ROLE_IDS.DEFAULT_ADMIN_ROLE,
      expectedMember: manifest.roles.factoryGovernance,
    },
    {
      scope: "factory",
      authority: manifest.addresses.factory,
      roleName: "FUNDING_SIGNER_ROLE",
      roleId: FACTORY_ROLE_IDS.FUNDING_SIGNER_ROLE,
      expectedMember: manifest.roles.fundingSigner,
    },
    {
      scope: "factory",
      authority: manifest.addresses.factory,
      roleName: "INTENT_SIGNER_ROLE",
      roleId: FACTORY_ROLE_IDS.INTENT_SIGNER_ROLE,
      expectedMember: manifest.roles.intentSigner,
    },
    {
      scope: "factory",
      authority: manifest.addresses.factory,
      roleName: "SETTLER_ROLE",
      roleId: FACTORY_ROLE_IDS.SETTLER_ROLE,
      expectedMember: manifest.roles.settler,
    },
    {
      scope: "registry",
      authority: manifest.addresses.registry,
      roleName: "DEFAULT_ADMIN_ROLE",
      roleId: REGISTRY_ROLE_IDS.DEFAULT_ADMIN_ROLE,
      expectedMember: manifest.roles.registryGovernance,
    },
    {
      scope: "registry",
      authority: manifest.addresses.registry,
      roleName: "SOURCE_ADMIN_ROLE",
      roleId: REGISTRY_ROLE_IDS.SOURCE_ADMIN_ROLE,
      expectedMember: manifest.roles.sourceAdmin,
    },
  ];
}

async function loadRoleEvents(rpc, authority, scope, fromBlock, toBlock) {
  const events = [];
  for (const eventTopic of ROLE_EVENT_TOPICS) {
    const path = `roles.${scope}.events.${eventTopic.name}`;
    const logs = requireRoleLogArray(
      await rpcRequest(
        rpc,
        "eth_getLogs",
        [
          {
            address: authority,
            fromBlock: toRpcQuantity(fromBlock),
            toBlock: toRpcQuantity(toBlock),
            topics: [eventTopic.topic],
          },
        ],
        path,
      ),
      path,
    );
    events.push(
      ...logs.map((log, index) => normalizeRoleEventLog(log, authority, eventTopic.type, index, path)),
    );
  }

  return events.sort(
    (left, right) =>
      left.blockNumber - right.blockNumber
      || left.transactionIndex - right.transactionIndex
      || left.logIndex - right.logIndex,
  );
}

function ensureRoleGrantEvent(events, check, account, sender, path) {
  const expectedAccount = normalizeAddress(account);
  const expectedSender = normalizeAddress(sender);
  const found = events.some(
    (event) =>
      event.type === "granted"
      && event.role === check.roleId
      && event.account === expectedAccount
      && event.sender === expectedSender,
  );
  if (!found) {
    fail("ROLE_GRANT_EVENT_MISSING", path, `${path} 缺少 RoleGranted 事件证明`);
  }
}

function ensureRoleRevokeEvent(events, check, account, sender, path) {
  const expectedAccount = normalizeAddress(account);
  const expectedSender = normalizeAddress(sender);
  const found = events.some(
    (event) =>
      event.type === "revoked"
      && event.role === check.roleId
      && event.account === expectedAccount
      && event.sender === expectedSender,
  );
  if (!found) {
    fail("ROLE_REVOKE_EVENT_MISSING", path, `${path} 缺少 RoleRevoked 事件证明`);
  }
}

function replayRoleEvents({ events, checks, roles, deployer, scope }) {
  const trackedRoleIds = new Set(checks.map((check) => check.roleId));
  const membersByRole = new Map(checks.map((check) => [check.roleId, new Set()]));
  const adminsByRole = new Map(checks.map((check) => [check.roleId, DEFAULT_ADMIN_ROLE]));
  const eventsByRole = new Map(checks.map((check) => [check.roleId, []]));

  for (const event of events) {
    if (!trackedRoleIds.has(event.role)) {
      continue;
    }
    eventsByRole.get(event.role).push(event);
    if (event.type === "granted") {
      membersByRole.get(event.role).add(event.account);
    }
    if (event.type === "revoked") {
      membersByRole.get(event.role).delete(event.account);
    }
    if (event.type === "adminChanged") {
      adminsByRole.set(event.role, event.newAdmin);
    }
  }

  const roleProofs = {};
  for (const check of checks) {
    const basePath = `roles.${scope}.${check.roleName}`;
    const roleEvents = eventsByRole.get(check.roleId);
    const expectedMember = roles[scope][check.roleName].members[0];
    ensureRoleGrantEvent(roleEvents, check, expectedMember, deployer, `${basePath}.grant`);
    if (check.roleName === "DEFAULT_ADMIN_ROLE") {
      ensureRoleGrantEvent(roleEvents, check, deployer, deployer, `${basePath}.deployerGrant`);
      ensureRoleRevokeEvent(roleEvents, check, deployer, deployer, `${basePath}.deployerRevoke`);
    }

    const replayedMembers = [...membersByRole.get(check.roleId)].sort();
    const readbackMembers = [...roles[scope][check.roleName].members].sort();
    if (JSON.stringify(replayedMembers) !== JSON.stringify(readbackMembers)) {
      fail("ROLE_EVENT_REPLAY_MISMATCH", `${basePath}.events`, `${basePath} 事件重放成员与 readback 不一致`);
    }

    const replayedAdmin = adminsByRole.get(check.roleId);
    if (replayedAdmin !== roles[scope][check.roleName].admin) {
      fail("ROLE_EVENT_REPLAY_MISMATCH", `${basePath}.adminEvents`, `${basePath} 事件重放 admin 与 readback 不一致`);
    }

    roleProofs[check.roleName] = {
      roleId: check.roleId,
      finalMembers: replayedMembers,
      finalAdmin: replayedAdmin,
      grants: roleEvents.filter((event) => event.type === "granted").map(eventProof),
      revokes: roleEvents.filter((event) => event.type === "revoked").map(eventProof),
      adminChanges: roleEvents.filter((event) => event.type === "adminChanged").map(eventProof),
    };
  }

  return roleProofs;
}

async function verifyRoleEventReplay(rpc, manifest, roles, checks) {
  const authorities = [
    {
      scope: "factory",
      address: manifest.addresses.factory,
      fromBlock: manifest.contracts.factory.deployment.blockNumber,
      checks: checks.filter((check) => check.scope === "factory"),
    },
    {
      scope: "registry",
      address: manifest.addresses.registry,
      fromBlock: manifest.contracts.registry.deployment.blockNumber,
      checks: checks.filter((check) => check.scope === "registry"),
    },
  ];

  const proof = {
    strategy: "eth_getLogs RoleGranted/RoleRevoked replay plus AccessControlEnumerable readback",
    finalizedBlock: manifest.finalizedBlock.blockNumber,
    authorities: {},
  };

  for (const authority of authorities) {
    const events = await loadRoleEvents(
      rpc,
      authority.address,
      authority.scope,
      authority.fromBlock,
      manifest.finalizedBlock.blockNumber,
    );
    proof.authorities[authority.scope] = {
      address: authority.address,
      fromBlock: authority.fromBlock,
      toBlock: manifest.finalizedBlock.blockNumber,
      roles: replayRoleEvents({
        events,
        checks: authority.checks,
        roles,
        deployer: manifest.deployer,
        scope: authority.scope,
      }),
    };
  }

  return proof;
}

async function verifyRoleMembership(rpc, manifest, blockTag) {
  const roles = {
    factory: {},
    registry: {},
    deployerZeroPermissions: true,
    intentSigner: {
      address: manifest.roles.intentSigner,
      eoa: false,
      mutuallyExclusive: false,
    },
    grantRevokeProof: null,
  };

  const checks = roleChecks(manifest);
  for (const check of checks) {
    const basePath = `roles.${check.scope}.${check.roleName}`;
    const admin = requireExpectedBytes32(
      await callContract(
        rpc,
        check.authority,
        ACCESS_CONTROL_ABI,
        "getRoleAdmin",
        [check.roleId],
        blockTag,
        `${basePath}.admin`,
      ),
      DEFAULT_ADMIN_ROLE,
      `${basePath}.admin`,
    );
    const count = await callContract(
      rpc,
      check.authority,
      ACCESS_CONTROL_ABI,
      "getRoleMemberCount",
      [check.roleId],
      blockTag,
      `${basePath}.count`,
    );
    if (count !== 1n) {
      fail("ROLE_MEMBER_COUNT_MISMATCH", `${basePath}.count`, `${basePath} 成员数量必须精确为 1`);
    }
    const member = requireExpectedRoleMember(
      await callContract(
        rpc,
        check.authority,
        ACCESS_CONTROL_ABI,
        "getRoleMember",
        [check.roleId, 0n],
        blockTag,
        `${basePath}.members[0]`,
      ),
      check.expectedMember,
      `${basePath}.members[0]`,
    );
    const deployerHasRole = await callContract(
      rpc,
      check.authority,
      ACCESS_CONTROL_ABI,
      "hasRole",
      [check.roleId, manifest.deployer],
      blockTag,
      `${basePath}.deployer`,
    );
    if (deployerHasRole === true) {
      fail("DEPLOYER_ROLE_RETAINED", `${basePath}.deployer`, "deployer 发布前必须撤销全部敏感角色");
    }

    roles[check.scope][check.roleName] = {
      roleId: check.roleId,
      admin,
      count: Number(count),
      members: [member],
      deployerHasRole: false,
    };
  }

  const intentSignerCode = normalizeCode(
    await rpcRequest(rpc, "eth_getCode", [manifest.roles.intentSigner, blockTag], "roles.intentSigner.code"),
    "roles.intentSigner.code",
  );
  if (intentSignerCode !== "0x") {
    fail("INTENT_SIGNER_NOT_EOA", "roles.intentSigner.code", "INTENT_SIGNER V1 必须是 code 为空的 EOA");
  }
  roles.intentSigner.eoa = true;

  const conflictChecks = checks.filter(
    (check) => !(check.scope === "factory" && check.roleName === "INTENT_SIGNER_ROLE"),
  );
  for (const check of conflictChecks) {
    const hasConflictRole = await callContract(
      rpc,
      check.authority,
      ACCESS_CONTROL_ABI,
      "hasRole",
      [check.roleId, manifest.roles.intentSigner],
      blockTag,
      `roles.intentSigner.${check.roleName}`,
    );
    if (hasConflictRole === true) {
      fail(
        "INTENT_SIGNER_ROLE_CONFLICT",
        `roles.intentSigner.${check.roleName}`,
        "INTENT_SIGNER 不得同时持有其它敏感角色",
      );
    }
  }
  roles.intentSigner.mutuallyExclusive = true;
  roles.grantRevokeProof = await verifyRoleEventReplay(rpc, manifest, roles, checks);

  return roles;
}

function identityEntry(label, address) {
  return { label, address: normalizeAddress(address) };
}

function identityMatrixEntry(role, address, category) {
  return {
    role,
    category,
    address: normalizeAddress(address),
  };
}

async function verifySmokeIdentities(rpc, manifest, clones, blockTag) {
  const buyer = normalizeAddress(manifest.clones[0]?.buyer ?? manifest.roles.smokeBuyer);
  const payout = normalizeAddress(manifest.roles.smokePayout);
  const addresses = {
    buyer,
    payout,
    deployer: normalizeAddress(manifest.deployer),
    factoryGovernance: normalizeAddress(manifest.roles.factoryGovernance),
    registryGovernance: normalizeAddress(manifest.roles.registryGovernance),
    sourceAdmin: normalizeAddress(manifest.roles.sourceAdmin),
    fundingSigner: normalizeAddress(manifest.roles.fundingSigner),
    intentSigner: normalizeAddress(manifest.roles.intentSigner),
    settler: normalizeAddress(manifest.roles.settler),
  };
  const protocol = {
    factory: normalizeAddress(manifest.addresses.factory),
    registry: normalizeAddress(manifest.addresses.registry),
    implementation: normalizeAddress(manifest.addresses.implementation),
    usdc: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    nativeEmitter: ARC_NATIVE_USDC_SYSTEM_EMITTER,
    ...(clones[0]?.address === undefined ? {} : { clone: normalizeAddress(clones[0].address) }),
  };
  const identityMatrix = {
    smokeBuyer: identityMatrixEntry("smoke-buyer", buyer, "smoke"),
    smokePayout: identityMatrixEntry("smoke-payout", payout, "smoke"),
    deployer: identityMatrixEntry("deployment-key", manifest.deployer, "sensitive-identity"),
    factoryGovernance: identityMatrixEntry("factory-admin", manifest.roles.factoryGovernance, "sensitive-identity"),
    registryGovernance: identityMatrixEntry("registry-admin", manifest.roles.registryGovernance, "sensitive-identity"),
    sourceAdmin: identityMatrixEntry("source-admin", manifest.roles.sourceAdmin, "sensitive-identity"),
    fundingSigner: identityMatrixEntry("funding-signer", manifest.roles.fundingSigner, "sensitive-identity"),
    intentSigner: identityMatrixEntry("intent-signer", manifest.roles.intentSigner, "sensitive-identity"),
    settler: identityMatrixEntry("settler", manifest.roles.settler, "sensitive-identity"),
    factory: identityMatrixEntry("protocol-contract", manifest.addresses.factory, "protocol-address"),
    registry: identityMatrixEntry("protocol-contract", manifest.addresses.registry, "protocol-address"),
    implementation: identityMatrixEntry("protocol-contract", manifest.addresses.implementation, "protocol-address"),
    usdc: identityMatrixEntry("authoritative-usdc", OFFICIAL_ARC_TESTNET_USDC_ADDRESS, "protocol-address"),
    nativeEmitter: identityMatrixEntry("arc-native-usdc-emitter", ARC_NATIVE_USDC_SYSTEM_EMITTER, "protocol-address"),
    ...(clones[0]?.address === undefined
      ? {}
      : { clone: identityMatrixEntry("research-clone", clones[0].address, "project-contract") }),
  };
  const payoutDistinctFrom = [
    identityEntry("buyer", buyer),
    identityEntry("deployer", manifest.deployer),
    identityEntry("factoryGovernance", manifest.roles.factoryGovernance),
    identityEntry("registryGovernance", manifest.roles.registryGovernance),
    identityEntry("sourceAdmin", manifest.roles.sourceAdmin),
    identityEntry("fundingSigner", manifest.roles.fundingSigner),
    identityEntry("intentSigner", manifest.roles.intentSigner),
    identityEntry("settler", manifest.roles.settler),
    identityEntry("factory", manifest.addresses.factory),
    identityEntry("registry", manifest.addresses.registry),
    identityEntry("implementation", manifest.addresses.implementation),
    identityEntry("usdc", OFFICIAL_ARC_TESTNET_USDC_ADDRESS),
    identityEntry("nativeEmitter", ARC_NATIVE_USDC_SYSTEM_EMITTER),
    ...(clones[0]?.address === undefined ? [] : [identityEntry("clone", clones[0].address)]),
  ];

  const conflict = payoutDistinctFrom.find((item) => item.address === payout);
  if (conflict !== undefined) {
    fail(
      "SMOKE_PAYOUT_IDENTITY_CONFLICT",
      "smokeIdentities.payout",
      `smoke payout 不得等于 ${conflict.label}`,
    );
  }

  for (const check of roleChecks(manifest)) {
    const hasBuyerRole = await callContract(
      rpc,
      check.authority,
      ACCESS_CONTROL_ABI,
      "hasRole",
      [check.roleId, buyer],
      blockTag,
      `smokeIdentities.buyer.${check.roleName}`,
    );
    if (hasBuyerRole === true) {
      fail(
        "SMOKE_BUYER_ROLE_CONFLICT",
        `smokeIdentities.buyer.${check.roleName}`,
        "smoke buyer 不得持有项目敏感角色",
      );
    }
  }

  return {
    verified: true,
    addresses,
    protocol,
    identityMatrix,
    relationships: {
      payoutDistinctFromSensitiveIdentities: true,
      payoutDistinctFromProtocolAddresses: true,
      buyerSensitiveRoleFree: true,
    },
    payoutDistinctFrom,
    buyerSensitiveRoleFree: true,
  };
}

export async function verifyArcDeploymentRpcEvidence(input) {
  const { manifest: inputManifest, rpc: inputRpc, blockTag } = requireVerifierInputEnvelope(input);
  const rpc = requireRpc(inputRpc);
  const manifest = validateDeploymentManifest(inputManifest);
  const chainId = await verifyChainId(rpc);
  const authoritativeUsdc = await verifyOfficialUsdc(rpc, manifest, blockTag);
  const nativeDependency = verifyNativeEmitterDependency(manifest);
  const coreContracts = await verifyCoreContracts(rpc, manifest, blockTag);

  return {
    status: "passed",
    chainId,
    blockTag,
    authoritativeUsdc,
    nativeUsdcSystemEmitter: {
      address: normalizeAddress(nativeDependency.address),
    },
    coreContracts,
  };
}

export async function verifyArcDeploymentTopologyAndRoles(input) {
  const { manifest: inputManifest, rpc: inputRpc, blockTag } = requireVerifierInputEnvelope(input);
  const rpc = requireRpc(inputRpc);
  const baseReport = await verifyArcDeploymentRpcEvidence({ manifest: inputManifest, rpc, blockTag });
  const manifest = validateDeploymentManifest(inputManifest);
  const wiring = await verifyWiring(rpc, manifest, blockTag);
  const implementation = await verifyImplementationInitializerLocked(rpc, manifest, blockTag);
  const clones = await verifyClones(rpc, manifest, blockTag);
  const roles = await verifyRoleMembership(rpc, manifest, blockTag);
  const smokeIdentities = await verifySmokeIdentities(rpc, manifest, clones, blockTag);
  const deploymentTopology = {
    ...manifest.deploymentTopology,
    verified: true,
    verifiedCloneCount: clones.length,
  };

  return {
    ...baseReport,
    wiring,
    implementation,
    clones,
    roles,
    deploymentTopology,
    smokeIdentities,
  };
}
