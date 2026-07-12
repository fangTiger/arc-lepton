import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { digestDeploymentManifest, validateDeploymentManifest } from "./deployment-manifest.mjs";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const RAW_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const SECRET_FIELD_PATTERN =
  /(?:private[-_]?key|mnemonic|keystore|secret|provider[-_]?key|api[-_]?key|auth[-_]?token|access[-_]?token|bearer|password|full[-_]?env|environment)$/i;
const APPROVAL_FIELD_NAMES = new Set([
  "approval",
  "approvalid",
  "approved",
  "approvedat",
  "authorizationrecord",
  "explicitauthorization",
]);
const SIGNATURE_FIELD_PATTERN = /(?:^|[.[\]_ -])(?:signature|rawsignature|signedpayload)(?:$|[.[\]_ -])/i;
const CREDENTIAL_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const LOCAL_PATH_PATTERN = /^(?:file:\/\/|\/Users\/|\/home\/|\/private\/var\/|\/var\/folders\/|[A-Za-z]:\\Users\\)/;

export class DeploymentArtifactSecurityError extends Error {
  constructor(code, path) {
    super(`${path} 包含禁止持久化的公开证据字段：${code}`);
    this.name = "DeploymentArtifactSecurityError";
    this.code = code;
    this.path = path;
  }
}

export class DeploymentEvidencePackageError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentEvidencePackageError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentEvidencePackageError(code, path, message);
}

function securityFail(code, path) {
  throw new DeploymentArtifactSecurityError(code, path);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainPublicRecord(value) {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function requireRecord(value, path) {
  if (!isRecord(value)) {
    fail("RECORD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function requireAddress(value, path) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    fail("ADDRESS_INVALID", path, `${path} 必须是 20-byte 0x hex 地址`);
  }
  return value.toLowerCase();
}

function requireBytes32(value, path) {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    fail("BYTES32_INVALID", path, `${path} 必须是 32-byte 0x hex`);
  }
  return value.toLowerCase();
}

function requireDecimalString(value, path) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    fail("DECIMAL_INVALID", path, `${path} 必须是十进制整数文本`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("BOOLEAN_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireExpectedGas(input) {
  const value = requireRecord(input, "expectedGas");
  return {
    deployCoreContracts: requireDecimalString(
      value.deployCoreContracts,
      "expectedGas.deployCoreContracts",
    ),
    configureSourcesAndRoles: requireDecimalString(
      value.configureSourcesAndRoles,
      "expectedGas.configureSourcesAndRoles",
    ),
    smokeUsdcSpendUnits: requireDecimalString(
      value.smokeUsdcSpendUnits,
      "expectedGas.smokeUsdcSpendUnits",
    ),
  };
}

function lastPathSegment(path) {
  const segments = String(path).split(/[.[\]]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

function propertyPath(path, key) {
  return path === "$" ? key : `${path}.${key}`;
}

function normalizedFieldName(key) {
  return String(key).replace(/[\s._-]/g, "").toLowerCase();
}

function arrayIndexPath(path, index) {
  return `${path}[${index}]`;
}

function isArrayIndexKey(key) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1;
}

function assertPublicDataDescriptor(descriptor, path) {
  if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) {
    securityFail("INPUT_INVALID", path);
  }
}

function scanString(value, path) {
  const segment = lastPathSegment(path);
  if (typeof value === "string") {
    if (SIGNATURE_FIELD_PATTERN.test(segment) && RAW_SIGNATURE_PATTERN.test(value)) {
      securityFail("RAW_SIGNATURE", path);
    }
    if (SECRET_FIELD_PATTERN.test(segment)) {
      securityFail("SECRET_FIELD", path);
    }
    if (CREDENTIAL_URL_PATTERN.test(value)) {
      securityFail("CREDENTIAL_URL", path);
    }
    if (LOCAL_PATH_PATTERN.test(value)) {
      securityFail("LOCAL_PATH", path);
    }
    if (/^(?:sk|pk|rk|ghp|github_pat)-[A-Za-z0-9_=-]{8,}/.test(value)) {
      securityFail("PROVIDER_KEY", path);
    }
  }
}

function scanArray(value, path, stats, ancestors) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    securityFail("INPUT_INVALID", path);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(descriptors)) {
    if (key === "length") {
      continue;
    }
    if (!isArrayIndexKey(key)) {
      securityFail("INPUT_INVALID", propertyPath(path, key));
    }
    const index = Number(key);
    if (index >= value.length) {
      securityFail("INPUT_INVALID", arrayIndexPath(path, index));
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
      securityFail("INPUT_INVALID", arrayIndexPath(path, index));
    }
    const descriptor = descriptors[key];
    const itemPath = arrayIndexPath(path, index);
    assertPublicDataDescriptor(descriptor, itemPath);
    scanValue(descriptor.value, itemPath, stats, ancestors);
  }
}

function scanRecord(value, path, stats, ancestors) {
  if (!isPlainPublicRecord(value)) {
    securityFail("INPUT_INVALID", path);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    securityFail("INPUT_INVALID", path);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(descriptors)) {
    const itemPath = propertyPath(path, key);
    if (SECRET_FIELD_PATTERN.test(key)) {
      securityFail("SECRET_FIELD", itemPath);
    }
    if (APPROVAL_FIELD_NAMES.has(normalizedFieldName(key))) {
      securityFail("APPROVAL_FIELD", itemPath);
    }
    const descriptor = descriptors[key];
    assertPublicDataDescriptor(descriptor, itemPath);
    scanValue(descriptor.value, itemPath, stats, ancestors);
  }
}

function scanValue(value, path, stats, ancestors) {
  stats.checkedFields += 1;

  if (value === null) {
    return;
  }

  if (typeof value === "string") {
    scanString(value, path);
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      securityFail("INPUT_INVALID", path);
    }
    return;
  }

  if (typeof value === "boolean") {
    return;
  }

  if (typeof value !== "object") {
    securityFail("INPUT_INVALID", path);
  }

  if (ancestors.has(value)) {
    securityFail("INPUT_INVALID", path);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      scanArray(value, path, stats, ancestors);
      return;
    }
    scanRecord(value, path, stats, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function scanPublicDeploymentArtifact(value) {
  const stats = { checkedFields: 0 };
  scanValue(value, "$", stats, new WeakSet());
  return {
    classification: "public",
    checkedFields: stats.checkedFields,
  };
}

function normalizeSourceConfigurations(value) {
  if (!Array.isArray(value)) {
    fail("SOURCE_CONFIG_INVALID", "sourceConfigurations", "sourceConfigurations 必须是数组");
  }
  return value.map((entry, index) => {
    const path = `sourceConfigurations[${index}]`;
    const source = requireRecord(entry, path);
    const action = source.action ?? "create";
    if (action !== "create" && action !== "update") {
      fail("SOURCE_ACTION_INVALID", `${path}.action`, "source action 必须是 create 或 update");
    }
    return {
      action,
      sourceId: requireBytes32(source.sourceId, `${path}.sourceId`),
      payout: requireAddress(source.payout, `${path}.payout`),
      maxUnitPrice: requireDecimalString(source.maxUnitPrice, `${path}.maxUnitPrice`),
      active: requireBoolean(source.active, `${path}.active`),
    };
  });
}

function buildSourceTransactions(manifest, sourceConfigurations) {
  return sourceConfigurations.map((source) => ({
    stage: "configure_sources_and_roles",
    target: "registry",
    to: manifest.addresses.registry,
    function: source.action === "create"
      ? "createSource(bytes32,address,uint256,bool)"
      : "updateSource(bytes32,address,uint256,bool)",
    args: {
      sourceId: source.sourceId,
      payout: source.payout,
      maxUnitPrice: source.maxUnitPrice,
      active: source.active,
    },
  }));
}

function assertRoleSeparation(manifest) {
  const roles = manifest.roles;
  const sensitive = [
    ["factoryGovernance", roles.factoryGovernance],
    ["registryGovernance", roles.registryGovernance],
    ["sourceAdmin", roles.sourceAdmin],
    ["fundingSigner", roles.fundingSigner],
    ["intentSigner", roles.intentSigner],
    ["settler", roles.settler],
  ];
  const seen = new Map();
  for (const [label, account] of sensitive) {
    if (account === manifest.deployer) {
      fail("DEPLOYER_FINAL_ROLE", `roles.${label}`, "deployer 不得保留最终敏感角色");
    }
    const previous = seen.get(account);
    if (previous !== undefined) {
      fail(
        "ROLE_ACCOUNT_CONFLICT",
        `roles.${label}`,
        `${label} 与 ${previous} 不能使用同一地址`,
      );
    }
    seen.set(account, label);
  }
}

function buildRoleTransactions(manifest) {
  const roles = manifest.roles;
  const deployer = manifest.deployer;
  const factory = manifest.addresses.factory;
  const registry = manifest.addresses.registry;
  return [
    {
      stage: "configure_sources_and_roles",
      target: "factory",
      to: factory,
      action: "grant",
      role: "DEFAULT_ADMIN_ROLE",
      account: roles.factoryGovernance,
    },
    {
      stage: "configure_sources_and_roles",
      target: "factory",
      to: factory,
      action: "grant",
      role: "FUNDING_SIGNER_ROLE",
      account: roles.fundingSigner,
    },
    {
      stage: "configure_sources_and_roles",
      target: "factory",
      to: factory,
      action: "grant",
      role: "INTENT_SIGNER_ROLE",
      account: roles.intentSigner,
    },
    {
      stage: "configure_sources_and_roles",
      target: "factory",
      to: factory,
      action: "grant",
      role: "SETTLER_ROLE",
      account: roles.settler,
    },
    {
      stage: "configure_sources_and_roles",
      target: "registry",
      to: registry,
      action: "grant",
      role: "DEFAULT_ADMIN_ROLE",
      account: roles.registryGovernance,
    },
    {
      stage: "configure_sources_and_roles",
      target: "registry",
      to: registry,
      action: "grant",
      role: "SOURCE_ADMIN_ROLE",
      account: roles.sourceAdmin,
    },
    {
      stage: "configure_sources_and_roles",
      target: "factory",
      to: factory,
      action: "revoke",
      role: "DEFAULT_ADMIN_ROLE",
      account: deployer,
    },
    {
      stage: "configure_sources_and_roles",
      target: "registry",
      to: registry,
      action: "revoke",
      role: "DEFAULT_ADMIN_ROLE",
      account: deployer,
    },
  ];
}

function buildExplorerVerificationInputs(manifest) {
  return ["registry", "implementation", "factory"].map((key) => {
    const contract = manifest.contracts[key];
    return {
      contract: contract.name,
      type: contract.type,
      address: contract.address,
      fullyQualifiedName: contract.artifact.fullyQualifiedName,
      sourceFile: contract.artifact.sourceFile,
      exactMatchRequired: true,
      compilerVersion: manifest.build.compiler.solidityVersion,
      evmVersion: manifest.build.compiler.settings.evmVersion,
      optimizer: manifest.build.compiler.settings.optimizer,
      viaIR: manifest.build.compiler.settings.viaIR,
      metadata: manifest.build.compiler.settings.metadata,
      remappings: [...manifest.build.compiler.settings.remappings],
      constructorArgumentsRaw: contract.constructorArguments.raw,
      constructorArgumentsDecoded: contract.constructorArguments.decoded,
      abiHash: contract.artifactHashes.abiHash,
      metadataHash: contract.artifactHashes.metadataHash,
      buildInfoHash: contract.artifactHashes.buildInfoHash,
    };
  });
}

function buildExplorerLinks(manifest, explorerBaseUrl) {
  if (explorerBaseUrl === undefined) {
    return {};
  }
  if (typeof explorerBaseUrl !== "string" || explorerBaseUrl.trim() === "" || explorerBaseUrl.includes("@")) {
    fail("EXPLORER_BASE_URL_INVALID", "explorerBaseUrl", "explorerBaseUrl 必须是公开 explorer URL");
  }

  const base = explorerBaseUrl.replace(/\/+$/, "");
  return {
    registry: `${base}/address/${manifest.addresses.registry}`,
    implementation: `${base}/address/${manifest.addresses.implementation}`,
    factory: `${base}/address/${manifest.addresses.factory}`,
  };
}

function buildAuthorizationStages(manifest, expectedGas, sourceTransactions, roleTransactions) {
  return [
    {
      stage: "deploy_core_contracts",
      requiresFreshUserAuthorization: true,
      chainId: manifest.chainId,
      commit: manifest.git.commit,
      deployer: manifest.deployer,
      estimatedGas: expectedGas.deployCoreContracts,
      maxUsdcUnits: "0",
      transactions: [
        "deploy DataSourceRegistry",
        "deploy ResearchEscrow implementation",
        "deploy ResearchEscrowFactory",
        "bind Registry to Factory",
      ],
    },
    {
      stage: "configure_sources_and_roles",
      requiresFreshUserAuthorization: true,
      chainId: manifest.chainId,
      commit: manifest.git.commit,
      deployer: manifest.deployer,
      estimatedGas: expectedGas.configureSourcesAndRoles,
      maxUsdcUnits: "0",
      transactions: [...sourceTransactions, ...roleTransactions],
    },
    {
      stage: "smoke_usdc_spend",
      requiresFreshUserAuthorization: true,
      chainId: manifest.chainId,
      commit: manifest.git.commit,
      buyer: manifest.roles.smokeBuyer,
      payout: manifest.roles.smokePayout,
      estimatedGas: "unknown_until_smoke_plan",
      maxUsdcUnits: expectedGas.smokeUsdcSpendUnits,
      transactions: [
        "approve",
        "createAndFund",
        "activate",
        "settleBatch",
        "close/refund",
      ],
    },
  ];
}

function buildFoundryDeploy(manifest) {
  return {
    script: "contracts/script/DeployResearchEscrow.s.sol:DeployResearchEscrowScript",
    scriptPath: "contracts/script/DeployResearchEscrow.s.sol",
    scriptContract: "DeployResearchEscrowScript",
    commandTemplates: {
      simulate:
        "FOUNDRY_OFFLINE=true forge script contracts/script/DeployResearchEscrow.s.sol:DeployResearchEscrowScript --root contracts --rpc-url <PUBLIC_RPC_URL>",
      broadcast:
        "FOUNDRY_OFFLINE=true forge script contracts/script/DeployResearchEscrow.s.sol:DeployResearchEscrowScript --root contracts --rpc-url <PUBLIC_RPC_URL> --sender <DEPLOYER_ADDRESS> --broadcast",
    },
    expectedAddresses: {
      registry: manifest.addresses.registry,
      implementation: manifest.addresses.implementation,
      factory: manifest.addresses.factory,
    },
    coreArtifacts: [
      manifest.contracts.registry.artifact.fullyQualifiedName,
      manifest.contracts.implementation.artifact.fullyQualifiedName,
      manifest.contracts.factory.artifact.fullyQualifiedName,
    ],
  };
}

export function buildDeploymentEvidencePackage(input) {
  const root = requireRecord(input, "$");
  scanPublicDeploymentArtifact(root);
  const manifest = validateDeploymentManifest(root.manifest);
  if (manifest.chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("CHAIN_ID_MISMATCH", "manifest.chainId", `chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }
  if (!manifest.externalDependencies.some((dependency) => dependency.address === ARC_TESTNET_USDC_ADDRESS)) {
    fail("USDC_DEPENDENCY_MISSING", "manifest.externalDependencies", "缺少官方 USDC 外部依赖");
  }

  assertRoleSeparation(manifest);
  const expectedGas = requireExpectedGas(root.expectedGas);
  const sourceConfigurations = normalizeSourceConfigurations(root.sourceConfigurations ?? []);
  const sourceTransactions = buildSourceTransactions(manifest, sourceConfigurations);
  const roleTransactions = buildRoleTransactions(manifest);
  const manifestOutputPath = root.manifestOutputPath === undefined
    ? "deployments/5042002.json"
    : String(root.manifestOutputPath);
  const packageWithoutScan = {
    schemaVersion: 1,
    chainId: manifest.chainId,
    commit: manifest.git.commit,
    deployer: manifest.deployer,
    authorization: {
      requiredBeforeBroadcast: true,
      boundaryTask: "13.1",
      note: "任何部署、source 登记、角色 grant/revoke/移交或 test USDC 支出前必须重新取得用户当次明确授权",
    },
    foundryDeploy: buildFoundryDeploy(manifest),
    sourceConfiguration: {
      transactions: sourceTransactions,
    },
    roleTransfer: {
      transactions: roleTransactions,
      finalRoleMembers: {
        factoryGovernance: manifest.roles.factoryGovernance,
        registryGovernance: manifest.roles.registryGovernance,
        sourceAdmin: manifest.roles.sourceAdmin,
        fundingSigner: manifest.roles.fundingSigner,
        intentSigner: manifest.roles.intentSigner,
        settler: manifest.roles.settler,
      },
      deployerRevocations: roleTransactions.filter((transaction) =>
        transaction.action === "revoke" && transaction.account === manifest.deployer),
    },
    explorerVerificationInputs: buildExplorerVerificationInputs(manifest),
    deploymentTopology: manifest.deploymentTopology,
    authorizationStages: buildAuthorizationStages(
      manifest,
      expectedGas,
      sourceTransactions,
      roleTransactions,
    ),
    manifestPublication: {
      outputPath: manifestOutputPath,
      digest: digestDeploymentManifest(manifest),
      finalOnlyAfterVerifier: true,
    },
    explorer: {
      links: buildExplorerLinks(manifest, root.explorerBaseUrl),
    },
    manifest,
  };
  const securityScan = scanPublicDeploymentArtifact(packageWithoutScan);
  return {
    ...packageWithoutScan,
    securityScan,
  };
}
