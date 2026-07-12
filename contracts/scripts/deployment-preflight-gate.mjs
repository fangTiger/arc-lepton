import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { validateStageAuthorization } from "./deployment-authorization-gate.mjs";

const DEPLOYMENT_STAGE = "deploy_core_contracts";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const SOURCE_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const REPORT_TEXT_SECRET_PATTERN =
  /(?:credential|secret|password|token|api[_-]?key|authorization|bearer|sk-|pk-|rk-|ghp_|github_pat)/i;

const EXPECTED_COMPILER = Object.freeze({
  solidityVersion: "0.8.30",
  evmVersion: "prague",
  optimizerEnabled: true,
  optimizerRuns: 200,
  viaIR: false,
  metadataBytecodeHash: "ipfs",
  metadataAppendCBOR: true,
  metadataUseLiteralContent: false,
});

const ROLE_FIELDS = Object.freeze([
  "factoryGovernanceSafe",
  "registryGovernanceSafe",
  "sourceAdmin",
  "fundingSigner",
  "intentSigner",
  "settler",
  "smokeBuyer",
  "smokePayout",
]);

const PROTOCOL_FIELDS = Object.freeze(["registry", "implementation", "factory", "usdc"]);
const INTERNAL_GATE_ERRORS = new WeakMap();
let activeGateContext;

export class DeploymentPreflightGateError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentPreflightGateError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  const error = new DeploymentPreflightGateError(code, path, message);
  if (activeGateContext !== undefined) {
    INTERNAL_GATE_ERRORS.set(error, activeGateContext);
  }
  Object.freeze(error);
  throw error;
}

function isInternalGateError(error) {
  return (
    error instanceof DeploymentPreflightGateError
    && activeGateContext !== undefined
    && INTERNAL_GATE_ERRORS.get(error) === activeGateContext
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOptionalDataProperty(record, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    fail("PREFLIGHT_INPUT_INVALID", path, `${path} 必须是可枚举 data property`);
  }
  return descriptor.value;
}

function cloneSafeJsonLike(value, path, seen = new WeakSet()) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      fail("PREFLIGHT_INPUT_INVALID", path, `${path} 不得循环引用`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length !== 0) {
      fail("PREFLIGHT_INPUT_INVALID", path, `${path} 不得包含 symbol key`);
    }
    const cloned = [];
    for (const key of Object.keys(descriptors)) {
      if (key === "length") {
        continue;
      }
      const index = Number(key);
      const isCanonicalIndex = Number.isInteger(index)
        && index >= 0
        && index < value.length
        && String(index) === key;
      if (!isCanonicalIndex) {
        fail("PREFLIGHT_INPUT_INVALID", `${path}.${key}`, `${path}.${key} 不是合法数组索引`);
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        fail("PREFLIGHT_INPUT_INVALID", `${path}[${key}]`, `${path}[${key}] 必须是可枚举 data property`);
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined) {
        fail("PREFLIGHT_INPUT_INVALID", `${path}[${index}]`, `${path}[${index}] 不得为空洞`);
      }
      cloned.push(cloneSafeJsonLike(descriptor.value, `${path}[${index}]`, seen));
    }
    seen.delete(value);
    return cloned;
  }
  if (!isRecord(value)) {
    fail("PREFLIGHT_INPUT_INVALID", path, `${path} 只能包含 JSON-like 数据`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype) {
    fail("PREFLIGHT_INPUT_INVALID", path, `${path} 必须是 plain object`);
  }
  if (seen.has(value)) {
    fail("PREFLIGHT_INPUT_INVALID", path, `${path} 不得循环引用`);
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const cloned = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const childPath = `${path}.${key}`;
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      fail("PREFLIGHT_INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
    }
    cloned[key] = cloneSafeJsonLike(descriptor.value, childPath, seen);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("PREFLIGHT_INPUT_INVALID", path, `${path} 不得包含 symbol key`);
  }
  seen.delete(value);
  return cloned;
}

function requireRecord(value, path) {
  if (!isRecord(value)) {
    fail("RECORD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail("ARRAY_INVALID", path, `${path} 必须是数组`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("STRING_INVALID", path, `${path} 必须是非空字符串`);
  }
  return value;
}

function requireText(value, path) {
  if (typeof value !== "string") {
    fail("STRING_INVALID", path, `${path} 必须是字符串`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("BOOLEAN_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireInteger(value, path) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("INTEGER_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function requireAddress(value, path) {
  const text = requireString(value, path);
  if (!ADDRESS_PATTERN.test(text)) {
    fail("ADDRESS_INVALID", path, `${path} 必须是 20-byte 0x hex 地址`);
  }
  const normalized = text.toLowerCase();
  if (normalized === "0x0000000000000000000000000000000000000000") {
    fail("ADDRESS_ZERO", path, `${path} 不得为零地址`);
  }
  return normalized;
}

function requireBytes32(value, path) {
  const text = requireString(value, path);
  if (!BYTES32_PATTERN.test(text)) {
    fail("BYTES32_INVALID", path, `${path} 必须是 bytes32 0x hex`);
  }
  return text.toLowerCase();
}

function requireDecimalInteger(value, path) {
  const text = requireString(value, path);
  if (!DECIMAL_INTEGER_PATTERN.test(text)) {
    fail("DECIMAL_INTEGER_INVALID", path, `${path} 必须是十进制整数`);
  }
  return text;
}

function requirePositiveDecimalInteger(value, path) {
  const text = requireDecimalInteger(value, path);
  if (BigInt(text) <= 0n) {
    fail("DECIMAL_POSITIVE_INVALID", path, `${path} 必须是正十进制整数`);
  }
  return text;
}

function requireSourceId(value, path) {
  const text = requireString(value, path);
  if (!SOURCE_ID_PATTERN.test(text)) {
    fail("SOURCE_ID_INVALID", path, `${path} 必须是 bytes32 sourceId`);
  }
  return text.toLowerCase();
}

function normalizeGit(root, authorizationResult) {
  const git = requireRecord(root.git, "git");
  const commit = requireString(git.commit, "git.commit");
  if (commit !== authorizationResult.commit) {
    fail("GIT_COMMIT_MISMATCH", "git.commit", "git.commit 必须匹配已授权 commit");
  }
  if (requireBoolean(git.clean, "git.clean") !== true) {
    fail("GIT_DIRTY", "git.clean", "git 快照必须 clean");
  }
  if (requireText(git.statusPorcelain, "git.statusPorcelain") !== "") {
    fail("GIT_DIRTY", "git.statusPorcelain", "git statusPorcelain 必须为空");
  }
  const submoduleStatus = requireText(git.submoduleStatus, "git.submoduleStatus");
  if (submoduleStatus !== "" && submoduleStatus !== "clean") {
    fail("GIT_DIRTY", "git.submoduleStatus", "git submoduleStatus 必须为空或 clean");
  }
  return { commit, clean: true, statusPorcelain: "", submoduleStatus };
}

function normalizeCompiler(root) {
  const compiler = requireRecord(root.compiler, "compiler");
  const settings = requireRecord(compiler.settings, "compiler.settings");
  const optimizer = requireRecord(settings.optimizer, "compiler.settings.optimizer");
  const metadata = requireRecord(settings.metadata, "compiler.settings.metadata");

  const checks = [
    [compiler.solidityVersion, EXPECTED_COMPILER.solidityVersion, "compiler.solidityVersion"],
    [settings.evmVersion, EXPECTED_COMPILER.evmVersion, "compiler.settings.evmVersion"],
    [optimizer.enabled, EXPECTED_COMPILER.optimizerEnabled, "compiler.settings.optimizer.enabled"],
    [optimizer.runs, EXPECTED_COMPILER.optimizerRuns, "compiler.settings.optimizer.runs"],
    [settings.viaIR, EXPECTED_COMPILER.viaIR, "compiler.settings.viaIR"],
    [metadata.bytecodeHash, EXPECTED_COMPILER.metadataBytecodeHash, "compiler.settings.metadata.bytecodeHash"],
    [metadata.appendCBOR, EXPECTED_COMPILER.metadataAppendCBOR, "compiler.settings.metadata.appendCBOR"],
    [
      metadata.useLiteralContent,
      EXPECTED_COMPILER.metadataUseLiteralContent,
      "compiler.settings.metadata.useLiteralContent",
    ],
  ];

  for (const [actual, expected, path] of checks) {
    if (actual !== expected) {
      fail("COMPILER_SETTINGS_INVALID", path, `${path} 与可复现部署设置不一致`);
    }
  }

  return {
    solidityVersion: EXPECTED_COMPILER.solidityVersion,
    settings: {
      optimizer: {
        enabled: EXPECTED_COMPILER.optimizerEnabled,
        runs: EXPECTED_COMPILER.optimizerRuns,
      },
      evmVersion: EXPECTED_COMPILER.evmVersion,
      viaIR: EXPECTED_COMPILER.viaIR,
      metadata: {
        bytecodeHash: EXPECTED_COMPILER.metadataBytecodeHash,
        appendCBOR: EXPECTED_COMPILER.metadataAppendCBOR,
        useLiteralContent: EXPECTED_COMPILER.metadataUseLiteralContent,
      },
    },
  };
}

function normalizeDeployer(root, request) {
  const deployer = requireRecord(root.deployer, "deployer");
  const address = requireAddress(deployer.address, "deployer.address");
  const requestDeployer = requireAddress(request.deployer, "authorization.request.deployer");
  if (address !== requestDeployer) {
    fail("DEPLOYER_MISMATCH", "deployer.address", "deployer.address 必须匹配授权请求 deployer");
  }
  const balanceWei = requireDecimalInteger(deployer.balanceWei, "deployer.balanceWei");
  const minBalanceWei = requireDecimalInteger(deployer.minBalanceWei, "deployer.minBalanceWei");
  if (BigInt(balanceWei) < BigInt(minBalanceWei)) {
    fail("DEPLOYER_BALANCE_INSUFFICIENT", "deployer.balanceWei", "deployer 余额低于预部署最小值");
  }
  return { address, balanceWei, minBalanceWei };
}

function normalizeRoles(root, deployerAddress) {
  const rolesInput = requireRecord(root.roles, "roles");
  const roles = {};
  for (const field of ROLE_FIELDS) {
    roles[field] = requireAddress(rolesInput[field], `roles.${field}`);
  }

  const seen = new Map();
  for (const [field, address] of Object.entries(roles)) {
    if (address === deployerAddress) {
      fail("ADDRESS_OVERLAP", `roles.${field}`, "deployer 不得持有最终敏感角色");
    }
    if (seen.has(address)) {
      fail(
        "ADDRESS_OVERLAP",
        `roles.${field}`,
        `敏感身份必须互斥，${field} 与 ${seen.get(address)} 重叠`,
      );
    }
    seen.set(address, field);
  }
  return roles;
}

function normalizeAccountCode(root) {
  const accountCode = requireRecord(root.accountCode, "accountCode");
  const factorySafe = requireRecord(
    accountCode.factoryGovernanceSafe,
    "accountCode.factoryGovernanceSafe",
  );
  const registrySafe = requireRecord(
    accountCode.registryGovernanceSafe,
    "accountCode.registryGovernanceSafe",
  );
  const intentSigner = requireRecord(accountCode.intentSigner, "accountCode.intentSigner");

  if (requireBoolean(factorySafe.hasCode, "accountCode.factoryGovernanceSafe.hasCode") !== true) {
    fail("ACCOUNT_CODE_INVALID", "accountCode.factoryGovernanceSafe.hasCode", "Factory governance Safe 必须已有 code");
  }
  if (requireBoolean(registrySafe.hasCode, "accountCode.registryGovernanceSafe.hasCode") !== true) {
    fail("ACCOUNT_CODE_INVALID", "accountCode.registryGovernanceSafe.hasCode", "Registry governance Safe 必须已有 code");
  }
  if (requireBoolean(intentSigner.hasCode, "accountCode.intentSigner.hasCode") !== false) {
    fail("ACCOUNT_CODE_INVALID", "accountCode.intentSigner.hasCode", "intentSigner 必须是 EOA");
  }

  return {
    factoryGovernanceSafe: { hasCode: true },
    registryGovernanceSafe: { hasCode: true },
    intentSigner: { hasCode: false },
  };
}

function normalizeProtocol(root, request) {
  const protocolInput = requireRecord(root.protocol, "protocol");
  const protocol = {};
  for (const field of PROTOCOL_FIELDS) {
    protocol[field] = requireAddress(protocolInput[field], `protocol.${field}`);
  }

  const expectedAddresses = requireRecord(request.expectedAddresses, "authorization.request.expectedAddresses");
  for (const field of ["registry", "implementation", "factory"]) {
    const expected = requireAddress(
      expectedAddresses[field],
      `authorization.request.expectedAddresses.${field}`,
    );
    if (protocol[field] !== expected) {
      fail("PROTOCOL_ADDRESS_MISMATCH", `protocol.${field}`, `${field} 必须匹配授权请求 expectedAddresses`);
    }
  }
  if (protocol.usdc !== ARC_TESTNET_USDC_ADDRESS) {
    fail("USDC_ADDRESS_INVALID", "protocol.usdc", "protocol.usdc 必须是 Arc Testnet 官方 USDC");
  }
  return protocol;
}

function assertNoAddressOverlap(address, path, forbidden) {
  const owner = forbidden.get(address);
  if (owner !== undefined) {
    fail("ADDRESS_OVERLAP", path, `${path} 不得与 ${owner} 重叠`);
  }
}

function normalizeSources(root, roles, protocol, deployerAddress) {
  const sourcesInput = requireArray(root.sources, "sources");
  const expectedSourceCount = requireInteger(root.expectedSourceCount, "expectedSourceCount");
  if (expectedSourceCount !== 5 || sourcesInput.length !== expectedSourceCount) {
    fail("SOURCE_COUNT_INVALID", "sources", "部署前 source 配置必须正好包含 5 个 source");
  }

  const forbidden = new Map([
    [deployerAddress, "deployer"],
    ...Object.entries(roles).map(([field, address]) => [address, `roles.${field}`]),
    ...Object.entries(protocol).map(([field, address]) => [address, `protocol.${field}`]),
  ]);
  const seenSourceIds = new Set();

  return sourcesInput.map((source, index) => {
    const value = requireRecord(source, `sources[${index}]`);
    const sourceId = requireSourceId(value.sourceId, `sources[${index}].sourceId`);
    if (seenSourceIds.has(sourceId)) {
      fail("SOURCE_ID_DUPLICATE", `sources[${index}].sourceId`, "sourceId 不得重复");
    }
    seenSourceIds.add(sourceId);

    const payout = requireAddress(value.payout, `sources[${index}].payout`);
    assertNoAddressOverlap(payout, `sources[${index}].payout`, forbidden);
    const maxUnitPrice = requirePositiveDecimalInteger(
      value.maxUnitPrice,
      `sources[${index}].maxUnitPrice`,
    );
    const active = requireBoolean(value.active, `sources[${index}].active`);
    return { sourceId, payout, maxUnitPrice, active };
  });
}

function normalizeUsdc(root) {
  const usdc = requireRecord(root.usdc, "usdc");
  if (requireInteger(usdc.chainId, "usdc.chainId") !== ARC_TESTNET_CHAIN_ID) {
    fail("USDC_CHAIN_ID_INVALID", "usdc.chainId", "USDC chainId 必须是 Arc Testnet");
  }
  const address = requireAddress(usdc.address, "usdc.address");
  if (address !== ARC_TESTNET_USDC_ADDRESS) {
    fail("USDC_ADDRESS_INVALID", "usdc.address", "USDC 地址必须是 Arc Testnet 官方 USDC");
  }
  if (requireInteger(usdc.decimals, "usdc.decimals") !== 6) {
    fail("USDC_DECIMALS_INVALID", "usdc.decimals", "USDC decimals 必须等于 6");
  }
  if (requireBoolean(usdc.hasCode, "usdc.hasCode") !== true) {
    fail("USDC_CODE_MISSING", "usdc.hasCode", "USDC 必须已有合约 code");
  }
  return {
    chainId: ARC_TESTNET_CHAIN_ID,
    address,
    decimals: 6,
    hasCode: true,
  };
}

function credentialKeyFound(value) {
  if (!isRecord(value)) {
    return false;
  }
  return Object.keys(value).some((key) =>
    /credential|secret|password|token|api[_-]?key|authorization/i.test(key));
}

function assertUrlHasNoCredentials(value, path) {
  if (value === undefined) {
    return;
  }
  const urlText = requireString(value, path);
  try {
    const url = new URL(urlText);
    if (url.username !== "" || url.password !== "") {
      fail("RPC_CREDENTIAL_FORBIDDEN", path, `${path} 不得包含凭据`);
    }
    for (const key of url.searchParams.keys()) {
      if (/credential|secret|password|token|api[_-]?key|authorization/i.test(key)) {
        fail("RPC_CREDENTIAL_FORBIDDEN", path, `${path} query 不得包含凭据字段`);
      }
    }
  } catch (error) {
    if (isInternalGateError(error)) {
      throw error;
    }
    fail("RPC_URL_INVALID", path, `${path} 必须是可解析 URL`);
  }
}

function requirePublicReportLabel(value, path) {
  const text = requireString(value, path);
  const normalized = text.trim();
  if (REPORT_TEXT_SECRET_PATTERN.test(normalized)) {
    fail("RPC_CREDENTIAL_FORBIDDEN", path, `${path} 不得包含 credential/secret/token 文本`);
  }
  if (normalized.startsWith("//")) {
    fail("RPC_CREDENTIAL_FORBIDDEN", path, `${path} 必须是公开网络标签而不是 URL`);
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== "") {
      fail("RPC_CREDENTIAL_FORBIDDEN", path, `${path} 必须是公开网络标签而不是 URL`);
    }
  } catch (error) {
    if (isInternalGateError(error)) {
      throw error;
    }
  }
  return normalized;
}

function normalizeRpc(root) {
  const rpc = requireRecord(root.rpc, "rpc");
  if (credentialKeyFound(rpc)) {
    fail("RPC_CREDENTIAL_FORBIDDEN", "rpc", "rpc 快照不得包含 credential/secret/token 字段");
  }
  assertUrlHasNoCredentials(rpc.url, "rpc.url");
  if (requireInteger(rpc.chainId, "rpc.chainId") !== ARC_TESTNET_CHAIN_ID) {
    fail("RPC_CHAIN_ID_INVALID", "rpc.chainId", "RPC chainId 必须是 Arc Testnet");
  }
  const publicRpcNetwork = requirePublicReportLabel(
    rpc.publicRpcNetwork,
    "rpc.publicRpcNetwork",
  );
  const finalizedBlockNumber = requireInteger(rpc.finalizedBlockNumber, "rpc.finalizedBlockNumber");
  if (finalizedBlockNumber <= 0) {
    fail("RPC_FINALITY_INVALID", "rpc.finalizedBlockNumber", "finalizedBlockNumber 必须是正整数");
  }
  let finalizedBlockHash;
  try {
    finalizedBlockHash = requireBytes32(rpc.finalizedBlockHash, "rpc.finalizedBlockHash");
  } catch (error) {
    if (isInternalGateError(error)) {
      fail("RPC_FINALITY_INVALID", "rpc.finalizedBlockHash", "finalizedBlockHash 必须是 bytes32");
    }
    throw error;
  }
  return {
    chainId: ARC_TESTNET_CHAIN_ID,
    publicRpcNetwork,
    finalizedBlockNumber,
    finalizedBlockHash,
  };
}

function normalizeSmokePayoutIsolation(roles, protocol, deployerAddress) {
  const forbidden = new Map([
    [deployerAddress, "deployer"],
    [roles.smokeBuyer, "roles.smokeBuyer"],
    ...Object.entries(protocol).map(([field, address]) => [address, `protocol.${field}`]),
  ]);
  for (const [field, address] of Object.entries(roles)) {
    if (field !== "smokePayout") {
      forbidden.set(address, `roles.${field}`);
    }
  }
  assertNoAddressOverlap(roles.smokePayout, "roles.smokePayout", forbidden);
}

function pass(name) {
  return { name, pass: true };
}

function buildDeploymentPreflightReportCore(input) {
  const root = cloneSafeJsonLike(input, "$");
  requireRecord(root, "$");
  const authorizationRaw = readOptionalDataProperty(root, "authorization", "authorization");
  const authorizationInput = authorizationRaw === undefined
    ? undefined
    : cloneSafeJsonLike(authorizationRaw, "authorization");
  let authorizationResult;
  try {
    authorizationResult = validateStageAuthorization(authorizationInput);
  } catch (error) {
    if (!(
      error !== null
      && typeof error === "object"
      && error.name === "DeploymentAuthorizationGateError"
    )) {
      throw error;
    }
    fail("AUTHORIZATION_INVALID", "authorization", "部署前必须提供匹配当前 request 的显式用户授权");
  }
  if (authorizationResult.stage !== DEPLOYMENT_STAGE) {
    fail("AUTHORIZATION_STAGE_INVALID", "authorization.stage", "13.2 只接受 deploy_core_contracts 阶段授权");
  }

  const authorizationRoot = requireRecord(authorizationInput, "authorization");
  const request = requireRecord(authorizationRoot.request, "authorization.request");
  const git = normalizeGit(root, authorizationResult);
  const compiler = normalizeCompiler(root);
  const deployer = normalizeDeployer(root, request);
  const roles = normalizeRoles(root, deployer.address);
  const accountCode = normalizeAccountCode(root);
  const protocol = normalizeProtocol(root, request);
  normalizeSmokePayoutIsolation(roles, protocol, deployer.address);
  const sources = normalizeSources(root, roles, protocol, deployer.address);
  const usdc = normalizeUsdc(root);
  const rpc = normalizeRpc(root);

  return Object.freeze({
    ready: true,
    stage: DEPLOYMENT_STAGE,
    commit: authorizationResult.commit,
    chainId: authorizationResult.chainId,
    authorizationDigest: authorizationResult.requestDigest,
    checks: Object.freeze([
      pass("authorization"),
      pass("git"),
      pass("compiler"),
      pass("deployer_balance"),
      pass("role_separation"),
      pass("safe_code"),
      pass("protocol_addresses"),
      pass("source_configuration"),
      pass("official_usdc"),
      pass("public_rpc_finality"),
      pass("secret_free_report"),
    ]),
    summary: Object.freeze({
      git,
      compiler,
      deployer: Object.freeze({
        address: deployer.address,
        minBalanceWei: deployer.minBalanceWei,
      }),
      roles,
      accountCode,
      protocol,
      sources,
      usdc,
      rpc,
    }),
  });
}

export function buildDeploymentPreflightReport(input) {
  const previousGateContext = activeGateContext;
  activeGateContext = Object.freeze({});
  try {
    return buildDeploymentPreflightReportCore(input);
  } catch (error) {
    if (isInternalGateError(error)) {
      throw error;
    }
    fail("PREFLIGHT_INPUT_INVALID", "$", "preflight 输入无法安全读取或包含不支持结构");
  } finally {
    activeGateContext = previousGateContext;
  }
}
