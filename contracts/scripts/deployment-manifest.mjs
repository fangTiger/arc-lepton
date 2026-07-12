import { createHash } from "node:crypto";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";

export const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 1;
export const DEPLOYMENT_MANIFEST_GENERATOR_VERSION = "arc-lepton-deployment-manifest/1";

const CORE_CONTRACT_KEYS = ["registry", "implementation", "factory"];
const ARTIFACT_HASH_KEYS = [
  "initCodeHash",
  "creationBytecodeHash",
  "compiledDeployedBytecodeHash",
  "onchainRuntimeBytecodeHash",
  "abiHash",
  "metadataHash",
  "buildInfoHash",
  "sourceBundleHash",
];
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export class DeploymentManifestValidationError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentManifestValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentManifestValidationError(code, path, message);
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedJsonValue(value[key])]),
    );
  }
  return value;
}

function stableStringify(value, space) {
  return JSON.stringify(sortedJsonValue(value), null, space);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inputInvalid(path) {
  fail("INPUT_INVALID", path, `${path} 只能包含 JSON-like 可枚举 data property`);
}

function propertyPath(path, key) {
  return path === "$" ? key : `${path}.${key}`;
}

function arrayIndexPath(path, index) {
  return `${path}[${index}]`;
}

function isPlainJsonRecord(value) {
  return isPlainRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isArrayIndexKey(key, length) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function requireDataDescriptor(descriptor, path) {
  if (
    descriptor === undefined
    || descriptor.get !== undefined
    || descriptor.set !== undefined
    || descriptor.enumerable !== true
    || !Object.prototype.hasOwnProperty.call(descriptor, "value")
  ) {
    inputInvalid(path);
  }
  return descriptor.value;
}

function safeJsonCloneArray(value, path, seen) {
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    inputInvalid(path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(descriptors)) {
    if (key === "length") {
      continue;
    }
    if (!isArrayIndexKey(key, value.length)) {
      inputInvalid(propertyPath(path, key));
    }
  }
  return Array.from({ length: value.length }, (_unused, index) => {
    const itemPath = arrayIndexPath(path, index);
    const item = requireDataDescriptor(descriptors[String(index)], itemPath);
    return safeJsonClone(item, itemPath, seen);
  });
}

function safeJsonCloneRecord(value, path, seen) {
  if (!isPlainJsonRecord(value)) {
    inputInvalid(path);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    inputInvalid(path);
  }
  const clone = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(descriptors)) {
    const itemPath = propertyPath(path, key);
    const item = requireDataDescriptor(descriptors[key], itemPath);
    if (item === undefined) {
      continue;
    }
    clone[key] = safeJsonClone(item, itemPath, seen);
  }
  return clone;
}

function safeJsonClone(value, path, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      inputInvalid(path);
    }
    return value;
  }
  if (typeof value !== "object") {
    inputInvalid(path);
  }
  if (seen.has(value)) {
    inputInvalid(path);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return safeJsonCloneArray(value, path, seen);
    }
    return safeJsonCloneRecord(value, path, seen);
  } finally {
    seen.delete(value);
  }
}

function requireRecord(value, path) {
  if (!isPlainRecord(value)) {
    fail("RECORD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("STRING_INVALID", path, `${path} 必须是非空字符串`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("BOOLEAN_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireExactChainId(value, path) {
  if (value !== ARC_TESTNET_CHAIN_ID) {
    fail(
      "CHAIN_ID_MISMATCH",
      path,
      `${path} 必须严格等于 ${ARC_TESTNET_CHAIN_ID}`,
    );
  }
  return ARC_TESTNET_CHAIN_ID;
}

function requireInteger(value, path, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("INTEGER_INVALID", path, `${path} 必须是整数`);
  }
  if (positive && value <= 0) {
    fail("INTEGER_INVALID", path, `${path} 必须是正整数`);
  }
  if (!positive && value < 0) {
    fail("INTEGER_INVALID", path, `${path} 不得为负数`);
  }
  return value;
}

function requireAddress(value, path) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    fail("ADDRESS_INVALID", path, `${path} 必须是严格 20-byte 0x hex 地址`);
  }
  return value.toLowerCase();
}

function requireBytes32(value, path, code = "HASH_INVALID") {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    fail(code, path, `${path} 必须是 32-byte 0x hex`);
  }
  return value.toLowerCase();
}

function requireHexBytes(value, path) {
  if (typeof value !== "string" || !HEX_BYTES_PATTERN.test(value)) {
    fail("HEX_INVALID", path, `${path} 必须是偶数字节 0x hex`);
  }
  return value.toLowerCase();
}

function requireCommit(value, path) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    fail("COMMIT_INVALID", path, `${path} 必须是小写 40-byte Git commit`);
  }
  return value;
}

function requireDecimalString(value, path, { positive = false } = {}) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail("AMOUNT_INVALID", path, `${path} 必须是十进制整数文本`);
  }
  if (positive && value === "0") {
    fail("AMOUNT_INVALID", path, `${path} 必须大于 0`);
  }
  return value;
}

function hasCleanSubmoduleStatus(value) {
  if (value === "") {
    return true;
  }
  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length > 0 && lines.every((line) => line.startsWith(" "));
}

function normalizeDecodedValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeDecodedValue);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDecodedValue(item)]),
    );
  }
  if (typeof value === "string" && (ADDRESS_PATTERN.test(value) || BYTES32_PATTERN.test(value))) {
    return value.toLowerCase();
  }
  return value;
}

function normalizeArgumentRecord(value, path) {
  const record = requireRecord(value, path);
  return {
    raw: requireHexBytes(record.raw, `${path}.raw`),
    decoded: normalizeDecodedValue(requireRecord(record.decoded, `${path}.decoded`)),
  };
}

function normalizeArtifactHashes(value, path) {
  const record = requireRecord(value, path);
  return Object.fromEntries(
    ARTIFACT_HASH_KEYS.map((key) => [
      key,
      requireBytes32(record[key], `${path}.${key}`),
    ]),
  );
}

function normalizeDeployment(value, path) {
  const record = requireRecord(value, path);
  if (record.status !== "success") {
    fail("TX_STATUS_INVALID", `${path}.status`, `${path}.status 必须是 success`);
  }
  return {
    txHash: requireBytes32(record.txHash, `${path}.txHash`, "TX_HASH_INVALID"),
    status: "success",
    blockNumber: requireInteger(record.blockNumber, `${path}.blockNumber`, { positive: true }),
    blockHash: requireBytes32(record.blockHash, `${path}.blockHash`, "BLOCK_HASH_INVALID"),
    transactionIndex: requireInteger(record.transactionIndex, `${path}.transactionIndex`),
  };
}

function normalizeCoreContract(value, path, expectedType) {
  const record = requireRecord(value, path);
  const artifact = requireRecord(record.artifact, `${path}.artifact`);
  const normalized = {
    name: requireNonEmptyString(record.name, `${path}.name`),
    type: requireNonEmptyString(record.type, `${path}.type`),
    address: requireAddress(record.address, `${path}.address`),
    creator: requireAddress(record.creator, `${path}.creator`),
    deployment: normalizeDeployment(record.deployment, `${path}.deployment`),
    artifact: {
      fullyQualifiedName: requireNonEmptyString(
        artifact.fullyQualifiedName,
        `${path}.artifact.fullyQualifiedName`,
      ),
      sourceFile: requireNonEmptyString(artifact.sourceFile, `${path}.artifact.sourceFile`),
    },
    constructorArguments: normalizeArgumentRecord(
      record.constructorArguments,
      `${path}.constructorArguments`,
    ),
    artifactHashes: normalizeArtifactHashes(record.artifactHashes, `${path}.artifactHashes`),
  };

  if (normalized.type !== expectedType) {
    fail("CORE_CONTRACT_TYPE_INVALID", `${path}.type`, `${path}.type 必须是 ${expectedType}`);
  }

  if (record.initializerArguments !== undefined) {
    const initializer = requireRecord(record.initializerArguments, `${path}.initializerArguments`);
    normalized.initializerArguments = {
      locked: requireBoolean(initializer.locked, `${path}.initializerArguments.locked`),
      raw: requireHexBytes(initializer.raw, `${path}.initializerArguments.raw`),
      decoded: normalizeDecodedValue(
        requireRecord(initializer.decoded, `${path}.initializerArguments.decoded`),
      ),
    };
  }

  return normalized;
}

function normalizeBlock(value, path) {
  const record = requireRecord(value, path);
  return {
    blockNumber: requireInteger(record.blockNumber, `${path}.blockNumber`, { positive: true }),
    blockHash: requireBytes32(record.blockHash, `${path}.blockHash`, "BLOCK_HASH_INVALID"),
    timestamp: requireNonEmptyString(record.timestamp, `${path}.timestamp`),
  };
}

function normalizeGit(value, path) {
  const record = requireRecord(value, path);
  const normalized = {
    commit: requireCommit(record.commit, `${path}.commit`),
    clean: requireBoolean(record.clean, `${path}.clean`),
    statusPorcelain: record.statusPorcelain === "" ? "" : requireNonEmptyString(
      record.statusPorcelain,
      `${path}.statusPorcelain`,
    ),
    submoduleStatus: typeof record.submoduleStatus === "string"
      ? record.submoduleStatus
      : fail("STRING_INVALID", `${path}.submoduleStatus`, `${path}.submoduleStatus 必须是字符串`),
  };
  if (!normalized.clean || normalized.statusPorcelain !== "" || !hasCleanSubmoduleStatus(normalized.submoduleStatus)) {
    fail("GIT_DIRTY", `${path}.clean`, "最终部署 manifest 只能从 clean Git tree 生成");
  }
  return normalized;
}

function normalizeBuild(value, path) {
  const record = requireRecord(value, path);
  const compiler = requireRecord(record.compiler, `${path}.compiler`);
  const settings = requireRecord(compiler.settings, `${path}.compiler.settings`);
  const optimizer = requireRecord(settings.optimizer, `${path}.compiler.settings.optimizer`);
  const metadata = requireRecord(settings.metadata, `${path}.compiler.settings.metadata`);
  const dependencies = requireRecord(record.dependencies, `${path}.dependencies`);
  const openZeppelin = requireRecord(
    dependencies.openZeppelin,
    `${path}.dependencies.openZeppelin`,
  );

  if (!Array.isArray(settings.remappings)) {
    fail("STRING_ARRAY_INVALID", `${path}.compiler.settings.remappings`, "remappings 必须是数组");
  }

  return {
    compiler: {
      solidityVersion: requireNonEmptyString(
        compiler.solidityVersion,
        `${path}.compiler.solidityVersion`,
      ),
      foundryVersion: requireNonEmptyString(
        compiler.foundryVersion,
        `${path}.compiler.foundryVersion`,
      ),
      foundryCommit: requireCommit(compiler.foundryCommit, `${path}.compiler.foundryCommit`),
      settings: {
        optimizer: {
          enabled: requireBoolean(optimizer.enabled, `${path}.compiler.settings.optimizer.enabled`),
          runs: requireInteger(optimizer.runs, `${path}.compiler.settings.optimizer.runs`, {
            positive: true,
          }),
        },
        viaIR: requireBoolean(settings.viaIR, `${path}.compiler.settings.viaIR`),
        evmVersion: requireNonEmptyString(settings.evmVersion, `${path}.compiler.settings.evmVersion`),
        metadata: {
          bytecodeHash: requireNonEmptyString(
            metadata.bytecodeHash,
            `${path}.compiler.settings.metadata.bytecodeHash`,
          ),
          useLiteralContent: requireBoolean(
            metadata.useLiteralContent,
            `${path}.compiler.settings.metadata.useLiteralContent`,
          ),
          appendCBOR: requireBoolean(
            metadata.appendCBOR,
            `${path}.compiler.settings.metadata.appendCBOR`,
          ),
        },
        remappings: settings.remappings.map((item, index) =>
          requireNonEmptyString(item, `${path}.compiler.settings.remappings[${index}]`)),
      },
      settingsHash: requireBytes32(compiler.settingsHash, `${path}.compiler.settingsHash`),
    },
    dependencies: {
      openZeppelin: {
        tag: requireNonEmptyString(
          openZeppelin.tag,
          `${path}.dependencies.openZeppelin.tag`,
        ),
        revision: requireCommit(
          openZeppelin.revision,
          `${path}.dependencies.openZeppelin.revision`,
        ),
      },
      lockfileHash: requireBytes32(dependencies.lockfileHash, `${path}.dependencies.lockfileHash`),
      buildCommand: requireNonEmptyString(
        dependencies.buildCommand,
        `${path}.dependencies.buildCommand`,
      ),
    },
  };
}

function normalizeRoles(value, path) {
  const record = requireRecord(value, path);
  return {
    factoryGovernance: requireAddress(record.factoryGovernance, `${path}.factoryGovernance`),
    registryGovernance: requireAddress(record.registryGovernance, `${path}.registryGovernance`),
    sourceAdmin: requireAddress(record.sourceAdmin, `${path}.sourceAdmin`),
    fundingSigner: requireAddress(record.fundingSigner, `${path}.fundingSigner`),
    intentSigner: requireAddress(record.intentSigner, `${path}.intentSigner`),
    settler: requireAddress(record.settler, `${path}.settler`),
    smokeBuyer: requireAddress(record.smokeBuyer, `${path}.smokeBuyer`),
    smokePayout: requireAddress(record.smokePayout, `${path}.smokePayout`),
  };
}

function normalizeRegistryBinding(value, path) {
  const record = requireRecord(value, path);
  return {
    txHash: requireBytes32(record.txHash, `${path}.txHash`, "TX_HASH_INVALID"),
    blockNumber: requireInteger(record.blockNumber, `${path}.blockNumber`, { positive: true }),
    blockHash: requireBytes32(record.blockHash, `${path}.blockHash`, "BLOCK_HASH_INVALID"),
    logIndex: requireInteger(record.logIndex, `${path}.logIndex`),
  };
}

function normalizeExternalDependency(value, index) {
  const path = `externalDependencies[${index}]`;
  const record = requireRecord(value, path);
  if (record.projectDeployment !== false) {
    fail(
      "EXTERNAL_DEPENDENCY_PROJECT_DEPLOYMENT",
      `${path}.projectDeployment`,
      "externalDependencies 必须明确标记为非项目部署",
    );
  }

  const normalized = {
    name: requireNonEmptyString(record.name, `${path}.name`),
    type: requireNonEmptyString(record.type, `${path}.type`),
    chainId: requireExactChainId(record.chainId, `${path}.chainId`),
    authority: requireNonEmptyString(record.authority, `${path}.authority`),
    finalizedBlockNumber: requireInteger(record.finalizedBlockNumber, `${path}.finalizedBlockNumber`, {
      positive: true,
    }),
    projectDeployment: false,
  };

  if (record.address !== undefined) {
    normalized.address = requireAddress(record.address, `${path}.address`);
  }
  if (record.identifier !== undefined) {
    normalized.identifier = requireNonEmptyString(record.identifier, `${path}.identifier`);
  }
  if (normalized.address === undefined && normalized.identifier === undefined) {
    fail("EXTERNAL_DEPENDENCY_IDENTITY_INVALID", path, `${path} 必须包含 address 或 identifier`);
  }
  if (record.decimals !== undefined) {
    normalized.decimals = requireInteger(record.decimals, `${path}.decimals`);
  }
  if (record.codeHash !== undefined) {
    normalized.codeHash = requireBytes32(record.codeHash, `${path}.codeHash`);
  }
  if (record.proxyImplementation !== undefined) {
    normalized.proxyImplementation = requireAddress(
      record.proxyImplementation,
      `${path}.proxyImplementation`,
    );
  }
  if (record.proxyImplementationCodeHash !== undefined) {
    normalized.proxyImplementationCodeHash = requireBytes32(
      record.proxyImplementationCodeHash,
      `${path}.proxyImplementationCodeHash`,
    );
  }

  return normalized;
}

function normalizeExternalDependencies(value) {
  if (!Array.isArray(value)) {
    fail("EXTERNAL_DEPENDENCIES_INVALID", "externalDependencies", "externalDependencies 必须是数组");
  }
  const dependencies = value.map(normalizeExternalDependency);
  if (!dependencies.some((dependency) => dependency.address === ARC_TESTNET_USDC_ADDRESS)) {
    fail(
      "USDC_DEPENDENCY_MISSING",
      "externalDependencies",
      "manifest 必须把 Arc Testnet 官方 USDC 作为外部依赖列示",
    );
  }
  return dependencies;
}

function normalizeCloneFunding(value, path) {
  const record = requireRecord(value, path);
  if (record.status !== "success") {
    fail("TX_STATUS_INVALID", `${path}.status`, `${path}.status 必须是 success`);
  }
  const amountUnits = requireDecimalString(record.amountUnits, `${path}.amountUnits`);
  const nonZero = requireBoolean(record.nonZero, `${path}.nonZero`);
  if (nonZero !== (amountUnits !== "0")) {
    fail(
      "FUNDING_NONZERO_MISMATCH",
      `${path}.nonZero`,
      `${path}.nonZero 必须与 amountUnits 是否为非零一致`,
    );
  }
  return {
    txHash: requireBytes32(record.txHash, `${path}.txHash`, "TX_HASH_INVALID"),
    status: "success",
    blockNumber: requireInteger(record.blockNumber, `${path}.blockNumber`, { positive: true }),
    blockHash: requireBytes32(record.blockHash, `${path}.blockHash`, "BLOCK_HASH_INVALID"),
    transactionIndex: requireInteger(record.transactionIndex, `${path}.transactionIndex`),
    factoryEventLogIndex: requireInteger(record.factoryEventLogIndex, `${path}.factoryEventLogIndex`),
    usdcFundingTransferLogIndex: requireInteger(
      record.usdcFundingTransferLogIndex,
      `${path}.usdcFundingTransferLogIndex`,
    ),
    nonZero,
    amountUnits,
  };
}

function normalizeCloneSettlement(value, path) {
  const record = requireRecord(value, path);
  return {
    successful: requireBoolean(record.successful, `${path}.successful`),
    txHash: requireBytes32(record.txHash, `${path}.txHash`, "TX_HASH_INVALID"),
    blockNumber: requireInteger(record.blockNumber, `${path}.blockNumber`, { positive: true }),
    blockHash: requireBytes32(record.blockHash, `${path}.blockHash`, "BLOCK_HASH_INVALID"),
    logIndex: requireInteger(record.logIndex, `${path}.logIndex`),
  };
}

function normalizeClone(value, index) {
  const path = `clones[${index}]`;
  const record = requireRecord(value, path);
  const normalized = {
    clone: requireAddress(record.clone, `${path}.clone`),
    buyer: requireAddress(record.buyer, `${path}.buyer`),
    researchKey: requireBytes32(record.researchKey, `${path}.researchKey`),
    factory: requireAddress(record.factory, `${path}.factory`),
    implementation: requireAddress(record.implementation, `${path}.implementation`),
    registry: requireAddress(record.registry, `${path}.registry`),
    usdc: requireAddress(record.usdc, `${path}.usdc`),
    salt: requireBytes32(record.salt, `${path}.salt`),
    predictedAddress: requireAddress(record.predictedAddress, `${path}.predictedAddress`),
    voucherHash: requireBytes32(record.voucherHash, `${path}.voucherHash`),
    voucherNonce: requireDecimalString(record.voucherNonce, `${path}.voucherNonce`),
    initializerArguments: normalizeArgumentRecord(
      record.initializerArguments,
      `${path}.initializerArguments`,
    ),
    funding: normalizeCloneFunding(record.funding, `${path}.funding`),
    initialBudget: requireDecimalString(record.initialBudget, `${path}.initialBudget`, {
      positive: true,
    }),
    activationCutoff: requireInteger(record.activationCutoff, `${path}.activationCutoff`, {
      positive: true,
    }),
    expectedExpiresAt: requireInteger(record.expectedExpiresAt, `${path}.expectedExpiresAt`, {
      positive: true,
    }),
    runtimeHash: requireBytes32(record.runtimeHash, `${path}.runtimeHash`),
    state: requireNonEmptyString(record.state, `${path}.state`),
  };

  if (normalized.usdc !== ARC_TESTNET_USDC_ADDRESS) {
    fail("USDC_UNSUPPORTED", `${path}.usdc`, `${path}.usdc 必须是 Arc Testnet 官方 USDC`);
  }
  if (normalized.clone !== normalized.predictedAddress) {
    fail("CLONE_ADDRESS_MISMATCH", `${path}.predictedAddress`, "clone 必须等于 predictedAddress");
  }
  if (record.settlement !== undefined) {
    normalized.settlement = normalizeCloneSettlement(record.settlement, `${path}.settlement`);
  }
  return normalized;
}

function normalizeClones(value) {
  if (!Array.isArray(value)) {
    fail("CLONES_INVALID", "clones", "clones 必须是数组");
  }
  return value.map(normalizeClone);
}

function cloneCountsFor(clones) {
  const funded = clones.filter((clone) => clone.funding.amountUnits !== "0").length;
  const settled = clones.filter(
    (clone) => clone.funding.amountUnits !== "0" && clone.settlement?.successful === true,
  ).length;
  return { funded, settled };
}

function externalDependencyReference(dependency) {
  const reference = {
    name: dependency.name,
    type: dependency.type,
  };
  if (dependency.address !== undefined) {
    reference.address = dependency.address;
  }
  if (dependency.identifier !== undefined) {
    reference.identifier = dependency.identifier;
  }
  return reference;
}

function deploymentTopologyFor(clones, externalDependencies) {
  const researchCloneR = clones.filter((clone) => clone.funding.amountUnits !== "0").length;
  const settledResearchClones = clones.filter(
    (clone) => clone.funding.amountUnits !== "0" && clone.settlement?.successful === true,
  ).length;
  const zeroFundingClones = clones.filter((clone) => clone.funding.amountUnits === "0").length;

  return {
    formula: "3 + R",
    coreContracts: CORE_CONTRACT_KEYS.length,
    researchCloneR,
    totalProjectContracts: CORE_CONTRACT_KEYS.length + researchCloneR,
    settledResearchClones,
    excluded: {
      zeroFundingClones,
      externalDependencies: externalDependencies.length,
      externalDependencyReferences: externalDependencies.map(externalDependencyReference),
    },
  };
}

function assertCoreWiring(manifest) {
  const { registry, implementation, factory } = manifest.addresses;
  const factoryArgs = manifest.contracts.factory.constructorArguments.decoded;
  if (factoryArgs.implementation !== implementation) {
    fail(
      "CONSTRUCTOR_ARGUMENT_MISMATCH",
      "contracts.factory.constructorArguments.decoded.implementation",
      "Factory constructor implementation 必须等于 manifest implementation",
    );
  }
  if (factoryArgs.registry !== registry) {
    fail(
      "CONSTRUCTOR_ARGUMENT_MISMATCH",
      "contracts.factory.constructorArguments.decoded.registry",
      "Factory constructor registry 必须等于 manifest registry",
    );
  }
  for (const [index, clone] of manifest.clones.entries()) {
    if (clone.factory !== factory) {
      fail("CLONE_WIRING_MISMATCH", `clones[${index}].factory`, "clone factory 不匹配");
    }
    if (clone.implementation !== implementation) {
      fail("CLONE_WIRING_MISMATCH", `clones[${index}].implementation`, "clone implementation 不匹配");
    }
    if (clone.registry !== registry) {
      fail("CLONE_WIRING_MISMATCH", `clones[${index}].registry`, "clone registry 不匹配");
    }
  }
}

function assertCoreCreators(manifest) {
  for (const key of CORE_CONTRACT_KEYS) {
    if (manifest.contracts[key].creator !== manifest.deployer) {
      fail(
        "CORE_CREATOR_MISMATCH",
        `contracts.${key}.creator`,
        `${key} creator 必须等于 manifest deployer`,
      );
    }
  }
}

function compareProvidedAddresses(input, manifest) {
  if (input.addresses === undefined) {
    return;
  }
  const provided = requireRecord(input.addresses, "addresses");
  for (const key of CORE_CONTRACT_KEYS) {
    const value = requireAddress(provided[key], `addresses.${key}`);
    if (value !== manifest.addresses[key]) {
      fail("CORE_ADDRESS_MISMATCH", `addresses.${key}`, `${key} 地址与 core contract 不一致`);
    }
  }
}

function compareProvidedCloneCounts(input, manifest) {
  if (input.cloneCounts === undefined) {
    return;
  }
  const provided = requireRecord(input.cloneCounts, "cloneCounts");
  const expected = manifest.cloneCounts;
  for (const key of ["funded", "settled"]) {
    if (provided[key] !== expected[key]) {
      fail(
        "CLONE_COUNT_MISMATCH",
        `cloneCounts.${key}`,
        `${key} clone 计数与 clone 明细不一致`,
      );
    }
  }
}

function compareTopologyValue(provided, expected, key) {
  if (provided[key] !== expected[key]) {
    fail(
      "DEPLOYMENT_TOPOLOGY_MISMATCH",
      `deploymentTopology.${key}`,
      `${key} 部署拓扑计数与 clone/externalDependencies 明细不一致`,
    );
  }
}

function compareProvidedDeploymentTopology(input, manifest) {
  if (input.deploymentTopology === undefined) {
    return;
  }
  const provided = requireRecord(input.deploymentTopology, "deploymentTopology");
  const expected = manifest.deploymentTopology;
  for (const key of [
    "formula",
    "coreContracts",
    "researchCloneR",
    "totalProjectContracts",
    "settledResearchClones",
  ]) {
    compareTopologyValue(provided, expected, key);
  }

  const providedExcluded = requireRecord(provided.excluded, "deploymentTopology.excluded");
  const expectedExcluded = expected.excluded;
  for (const key of ["zeroFundingClones", "externalDependencies"]) {
    if (providedExcluded[key] !== expectedExcluded[key]) {
      fail(
        "DEPLOYMENT_TOPOLOGY_MISMATCH",
        `deploymentTopology.excluded.${key}`,
        `${key} 排除计数与明细不一致`,
      );
    }
  }
  if (stableStringify(providedExcluded.externalDependencyReferences) !== stableStringify(expectedExcluded.externalDependencyReferences)) {
    fail(
      "DEPLOYMENT_TOPOLOGY_MISMATCH",
      "deploymentTopology.excluded.externalDependencyReferences",
      "external dependency 引用列表与明细不一致",
    );
  }
}

export function buildDeploymentManifest(input) {
  const root = safeJsonClone(requireRecord(input, "$"), "$", new WeakSet());
  const contracts = requireRecord(root.contracts, "contracts");
  const normalizedContracts = {
    registry: normalizeCoreContract(contracts.registry, "contracts.registry", "registry"),
    implementation: normalizeCoreContract(
      contracts.implementation,
      "contracts.implementation",
      "implementation",
    ),
    factory: normalizeCoreContract(contracts.factory, "contracts.factory", "factory"),
  };
  const clones = normalizeClones(root.clones);
  const externalDependencies = normalizeExternalDependencies(root.externalDependencies);
  const manifest = {
    schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
    network: requireNonEmptyString(root.network, "network"),
    chainId: requireExactChainId(root.chainId, "chainId"),
    publicRpcNetwork: requireNonEmptyString(root.publicRpcNetwork, "publicRpcNetwork"),
    generatedAt: requireNonEmptyString(root.generatedAt, "generatedAt"),
    finalizedBlock: normalizeBlock(root.finalizedBlock, "finalizedBlock"),
    repository: {
      name: requireNonEmptyString(
        requireRecord(root.repository, "repository").name,
        "repository.name",
      ),
      remote: requireNonEmptyString(
        requireRecord(root.repository, "repository").remote,
        "repository.remote",
      ),
    },
    git: normalizeGit(root.git, "git"),
    deployer: requireAddress(root.deployer, "deployer"),
    generator: {
      version: DEPLOYMENT_MANIFEST_GENERATOR_VERSION,
    },
    addresses: {
      registry: normalizedContracts.registry.address,
      implementation: normalizedContracts.implementation.address,
      factory: normalizedContracts.factory.address,
    },
    build: normalizeBuild(root.build, "build"),
    roles: normalizeRoles(root.roles, "roles"),
    registryBinding: normalizeRegistryBinding(root.registryBinding, "registryBinding"),
    contracts: normalizedContracts,
    externalDependencies,
    clones,
    cloneCounts: cloneCountsFor(clones),
    deploymentTopology: deploymentTopologyFor(clones, externalDependencies),
  };

  assertCoreWiring(manifest);
  assertCoreCreators(manifest);
  return manifest;
}

export function validateDeploymentManifest(manifest) {
  const root = safeJsonClone(requireRecord(manifest, "$"), "$", new WeakSet());
  if (root.schemaVersion !== DEPLOYMENT_MANIFEST_SCHEMA_VERSION) {
    fail(
      "SCHEMA_VERSION_INVALID",
      "schemaVersion",
      `schemaVersion 必须是 ${DEPLOYMENT_MANIFEST_SCHEMA_VERSION}`,
    );
  }

  const normalized = buildDeploymentManifest(root);
  compareProvidedAddresses(root, normalized);
  compareProvidedCloneCounts(root, normalized);
  compareProvidedDeploymentTopology(root, normalized);
  return normalized;
}

export function digestDeploymentManifest(manifest) {
  return sha256(stableStringify(validateDeploymentManifest(manifest)));
}
