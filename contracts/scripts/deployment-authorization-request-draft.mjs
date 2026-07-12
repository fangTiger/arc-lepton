import { fileURLToPath } from "node:url";

import {
  DEPLOYMENT_AUTHORIZATION_REQUEST_SCHEMA_VERSION,
  digestAuthorizationRequest,
} from "./deployment-authorization-gate.mjs";
import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CHANGE_NAME = "onchain-research-escrow";
const ARC_TESTNET_CHAIN_ID = 5042002;
const OFFICIAL_USDC = "0x3600000000000000000000000000000000000000";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const RAW_32_BYTE_SECRET_SHAPED = /^(?:0x)?[0-9a-fA-F]{64}$/;
const PUBLIC_SOURCE_ID_PATH_PATTERN =
  /^input\.stages\.configure_sources_and_roles\.sourceConfigurationChanges\[[0-9]+\]\.args\.sourceId$/u;
const SECRET_SHAPED =
  /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]{8,}|mnemonic|private[_-]?key|credentialed[_-]?rpc|:\/\/[^/\s:@]+:[^/\s@]+@)/i;
const SENSITIVE_KEY_NAMES = new Set([
  "privatekey",
  "mnemonic",
  "credentialedrpc",
  "rpcurl",
  "secret",
  "token",
  "authorization",
  "password",
]);

const STAGE_ORDER = Object.freeze([
  "deploy_core_contracts",
  "configure_sources_and_roles",
  "smoke_usdc_spend",
]);
const COMMON_STAGE_KEYS = Object.freeze(["commit", "estimatedGas", "maxUsdcUnits", "transactions"]);
const STAGE_ALLOWED_KEYS = Object.freeze({
  deploy_core_contracts: Object.freeze([
    ...COMMON_STAGE_KEYS,
    "deployer",
    "expectedAddresses",
    "coreArtifacts",
  ]),
  configure_sources_and_roles: Object.freeze([
    ...COMMON_STAGE_KEYS,
    "deployer",
    "targetAddresses",
    "sourceConfigurationChanges",
    "roleChanges",
  ]),
  smoke_usdc_spend: Object.freeze([
    ...COMMON_STAGE_KEYS,
    "buyer",
    "payout",
    "factory",
    "usdc",
  ]),
});
const EXPECTED_ADDRESS_KEYS = Object.freeze(["registry", "implementation", "factory"]);
const SOURCE_CHANGE_KEYS = Object.freeze(["target", "to", "function", "args"]);
const SOURCE_ARGS_KEYS = Object.freeze(["sourceId", "payout", "maxUnitPrice", "active"]);
const ROLE_CHANGE_KEYS = Object.freeze(["target", "to", "action", "role", "account"]);
const USDC_KEYS = Object.freeze(["address", "chainId", "decimals"]);

const SAFETY = Object.freeze({
  noBroadcast: true,
  noDeploy: true,
  noAutoStage: true,
  noAutoCommit: true,
  noSecrets: true,
  notAuthorizationRecord: true,
  notPreflightProof: true,
  notFinalManifestOrVerifierEvidence: true,
  notTaskCompletionAuthority: true,
  stageAuthorizationReuseForbidden: true,
});

export class DeploymentAuthorizationRequestDraftError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentAuthorizationRequestDraftError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentAuthorizationRequestDraftError(code, path, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeKeyForSensitivity(key) {
  return key.toLowerCase().replace(/[_-]/gu, "");
}

function isSensitiveKeyName(key) {
  return SENSITIVE_KEY_NAMES.has(normalizeKeyForSensitivity(key));
}

function allowsPublicBytes32Value(path) {
  return PUBLIC_SOURCE_ID_PATH_PATTERN.test(path);
}

function isArrayIndexKey(key, length) {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function isSecretShapedString(value, path) {
  return SECRET_SHAPED.test(value)
    || (RAW_32_BYTE_SECRET_SHAPED.test(value) && !allowsPublicBytes32Value(path));
}

function assertJsonSafe(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    if (isSecretShapedString(value, path)) {
      fail("SECRET_SHAPED_INPUT", path, `${path} 包含疑似敏感值，已拒绝且不回显原值`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      fail("INPUT_INVALID", path, `${path} 不得循环引用`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const childPath = `${path}[${index}]`;
      const descriptor = descriptors[String(index)];
      if (!descriptor) {
        fail("INPUT_INVALID", childPath, `${childPath} 不得为空洞`);
      }
      if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
        fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
      }
      assertJsonSafe(descriptor.value, childPath, seen);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length" || isArrayIndexKey(key, value.length)) {
        continue;
      }
      const childPath = `${path}.${key}`;
      if (isSensitiveKeyName(key)) {
        fail("SECRET_SHAPED_INPUT", childPath, `${childPath} 使用疑似敏感字段名，已拒绝且不回显原值`);
      }
      if (key.toLowerCase() === "requestdigest") {
        fail(
          "REQUEST_DIGEST_INPUT_FORBIDDEN",
          childPath,
          "requestDigest 必须由 draft 工具根据 request body 生成，不得由输入覆盖",
        );
      }
      if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
        fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
      }
      if (typeof descriptor.value === "string" && isSecretShapedString(descriptor.value, childPath)) {
        fail("SECRET_SHAPED_INPUT", childPath, `${childPath} 包含疑似敏感值，已拒绝且不回显原值`);
      }
      fail("INPUT_INVALID", childPath, `${childPath} 不得包含数组索引以外的额外属性`);
    }
    seen.delete(value);
    return;
  }
  if (!isRecord(value)) {
    fail("INPUT_INVALID", path, `${path} 只能包含 JSON-like 数据`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype) {
    fail("INPUT_INVALID", path, `${path} 必须是 plain object`);
  }
  if (seen.has(value)) {
    fail("INPUT_INVALID", path, `${path} 不得循环引用`);
  }
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKeyName(key)) {
      fail("SECRET_SHAPED_INPUT", childPath, `${childPath} 使用疑似敏感字段名，已拒绝且不回显原值`);
    }
    if (key.toLowerCase() === "requestdigest") {
      fail(
        "REQUEST_DIGEST_INPUT_FORBIDDEN",
        childPath,
        "requestDigest 必须由 draft 工具根据 request body 生成，不得由输入覆盖",
      );
    }
    if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
      fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
    }
    assertJsonSafe(descriptor.value, childPath, seen);
  }
  seen.delete(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function assertExactKeys(value, path, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("UNKNOWN_FIELD", `${path}.${key}`, `未知字段：${path}.${key}`);
    }
  }
}

function isPlaceholderString(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === ""
    || normalized === "tbd"
    || normalized === "todo"
    || normalized === "example"
    || normalized === "placeholder"
    || normalized.includes("placeholder")
    || normalized.includes("example");
}

function containsPlaceholderString(value, seen = new WeakSet()) {
  if (isPlaceholderString(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    const found = value.some((entry) => containsPlaceholderString(entry, seen));
    seen.delete(value);
    return found;
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (hasOwn(descriptor, "value") && containsPlaceholderString(descriptor.value, seen)) {
        seen.delete(value);
        return true;
      }
    }
    seen.delete(value);
  }
  return false;
}

function isRepeatedExampleAddress(value) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    return false;
  }
  return new Set(value.slice(2).toLowerCase()).size === 1;
}

function requireString(value, path) {
  if (typeof value !== "string" || isPlaceholderString(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是非占位字符串`);
  }
  return value;
}

function requireCommit(value, path) {
  const text = requireString(value, path);
  if (!COMMIT_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是 40 位小写 git commit`);
  }
  return text;
}

function requireAddress(value, path) {
  const text = requireString(value, path);
  if (!ADDRESS_PATTERN.test(text) || isRepeatedExampleAddress(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是非占位 EVM 地址`);
  }
  const normalized = text.toLowerCase();
  if (normalized === "0x0000000000000000000000000000000000000000") {
    fail("FIELD_INVALID", path, `${path} 不得为零地址`);
  }
  return text;
}

function requireDecimal(value, path) {
  const text = requireString(value, path);
  if (!DECIMAL_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是十进制整数`);
  }
  return text;
}

function requireArray(value, path) {
  if (!Array.isArray(value) || value.length === 0 || containsPlaceholderString(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是非空且无占位符的数组`);
  }
  return value.map((entry) => normalizeJsonValue(entry));
}

function requireBytes32(value, path) {
  const text = requireString(value, path);
  if (!BYTES32_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是 bytes32 hex`);
  }
  return text;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("FIELD_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireInteger(value, path) {
  if (!Number.isInteger(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function sortedRecord(value) {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeJsonValue(value[key])]),
  );
}

function normalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }
  if (isRecord(value)) {
    return sortedRecord(value);
  }
  return value;
}

function withDigest(request) {
  return {
    ...request,
    requestDigest: digestAuthorizationRequest(request),
  };
}

function normalizeRoot(input) {
  assertJsonSafe(input, "input");
  const root = requireRecord(input, "input");
  const allowedKeys = new Set(["change", "chainId", "stages"]);
  for (const key of Object.keys(root)) {
    if (!allowedKeys.has(key)) {
      fail("UNKNOWN_TOP_LEVEL_KEY", key, `未知顶层字段：${key}`);
    }
  }
  if (root.change !== CHANGE_NAME) {
    fail("CHANGE_UNSUPPORTED", "change", `change 必须是 ${CHANGE_NAME}`);
  }
  if (root.chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("CHAIN_ID_UNSUPPORTED", "chainId", `chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }
  const stages = requireRecord(root.stages, "stages");
  for (const stage of Object.keys(stages)) {
    if (!STAGE_ORDER.includes(stage)) {
      fail("UNKNOWN_STAGE", `stages.${stage}`, `未知阶段：${stage}`);
    }
  }
  for (const stage of STAGE_ORDER) {
    if (!isRecord(stages[stage])) {
      fail("FIELD_INVALID", `stages.${stage}`, `${stage} 必须提供公开输入`);
    }
  }
  return stages;
}

function commonRequest(stage, rawStage) {
  return {
    schemaVersion: DEPLOYMENT_AUTHORIZATION_REQUEST_SCHEMA_VERSION,
    stage,
    requiresFreshUserAuthorization: true,
    chainId: ARC_TESTNET_CHAIN_ID,
    commit: requireCommit(rawStage.commit, `stages.${stage}.commit`),
    estimatedGas: requireDecimal(rawStage.estimatedGas, `stages.${stage}.estimatedGas`),
    maxUsdcUnits: requireDecimal(rawStage.maxUsdcUnits, `stages.${stage}.maxUsdcUnits`),
    transactions: requireArray(rawStage.transactions, `stages.${stage}.transactions`),
  };
}

function buildDeployRequest(rawStage) {
  const stage = "deploy_core_contracts";
  assertExactKeys(rawStage, `stages.${stage}`, STAGE_ALLOWED_KEYS[stage]);
  const expectedAddresses = requireRecord(
    rawStage.expectedAddresses,
    `stages.${stage}.expectedAddresses`,
  );
  assertExactKeys(expectedAddresses, `stages.${stage}.expectedAddresses`, EXPECTED_ADDRESS_KEYS);
  return withDigest({
    ...commonRequest(stage, rawStage),
    deployer: requireAddress(rawStage.deployer, `stages.${stage}.deployer`),
    expectedAddresses: {
      factory: requireAddress(expectedAddresses.factory, `stages.${stage}.expectedAddresses.factory`),
      implementation: requireAddress(
        expectedAddresses.implementation,
        `stages.${stage}.expectedAddresses.implementation`,
      ),
      registry: requireAddress(
        expectedAddresses.registry,
        `stages.${stage}.expectedAddresses.registry`,
      ),
    },
    coreArtifacts: requireArray(rawStage.coreArtifacts, `stages.${stage}.coreArtifacts`)
      .map((artifact, index) => requireString(artifact, `stages.${stage}.coreArtifacts[${index}]`))
      .sort(),
  });
}

function normalizeSourceChange(change, path) {
  const value = requireRecord(change, path);
  assertExactKeys(value, path, SOURCE_CHANGE_KEYS);
  const args = requireRecord(value.args, `${path}.args`);
  assertExactKeys(args, `${path}.args`, SOURCE_ARGS_KEYS);
  return {
    args: {
      active: requireBoolean(args.active, `${path}.args.active`),
      maxUnitPrice: requireDecimal(args.maxUnitPrice, `${path}.args.maxUnitPrice`),
      payout: requireAddress(args.payout, `${path}.args.payout`),
      sourceId: requireBytes32(args.sourceId, `${path}.args.sourceId`),
    },
    function: requireString(value.function, `${path}.function`),
    target: requireString(value.target, `${path}.target`),
    to: requireAddress(value.to, `${path}.to`),
  };
}

function normalizeRoleChange(change, path) {
  const value = requireRecord(change, path);
  assertExactKeys(value, path, ROLE_CHANGE_KEYS);
  return {
    account: requireAddress(value.account, `${path}.account`),
    action: requireString(value.action, `${path}.action`),
    role: requireString(value.role, `${path}.role`),
    target: requireString(value.target, `${path}.target`),
    to: requireAddress(value.to, `${path}.to`),
  };
}

function buildConfigureRequest(rawStage) {
  const stage = "configure_sources_and_roles";
  assertExactKeys(rawStage, `stages.${stage}`, STAGE_ALLOWED_KEYS[stage]);
  return withDigest({
    ...commonRequest(stage, rawStage),
    deployer: requireAddress(rawStage.deployer, `stages.${stage}.deployer`),
    targetAddresses: requireArray(rawStage.targetAddresses, `stages.${stage}.targetAddresses`)
      .map((address, index) => requireAddress(address, `stages.${stage}.targetAddresses[${index}]`))
      .sort(),
    sourceConfigurationChanges: requireArray(
      rawStage.sourceConfigurationChanges,
      `stages.${stage}.sourceConfigurationChanges`,
    ).map((change, index) => normalizeSourceChange(
      change,
      `stages.${stage}.sourceConfigurationChanges[${index}]`,
    )),
    roleChanges: requireArray(rawStage.roleChanges, `stages.${stage}.roleChanges`)
      .map((change, index) => normalizeRoleChange(change, `stages.${stage}.roleChanges[${index}]`)),
  });
}

function buildSmokeRequest(rawStage) {
  const stage = "smoke_usdc_spend";
  assertExactKeys(rawStage, `stages.${stage}`, STAGE_ALLOWED_KEYS[stage]);
  const usdc = requireRecord(rawStage.usdc, `stages.${stage}.usdc`);
  assertExactKeys(usdc, `stages.${stage}.usdc`, USDC_KEYS);
  const usdcAddress = requireAddress(usdc.address, `stages.${stage}.usdc.address`);
  const usdcChainId = requireInteger(usdc.chainId, `stages.${stage}.usdc.chainId`);
  const usdcDecimals = requireInteger(usdc.decimals, `stages.${stage}.usdc.decimals`);
  if (
    usdcAddress.toLowerCase() !== OFFICIAL_USDC
    || usdcChainId !== ARC_TESTNET_CHAIN_ID
    || usdcDecimals !== 6
  ) {
    fail(
      "USDC_UNSUPPORTED",
      `stages.${stage}.usdc`,
      "smoke USDC 必须是 Arc Testnet 5042002 官方 6 位 USDC",
    );
  }
  return withDigest({
    ...commonRequest(stage, rawStage),
    buyer: requireAddress(rawStage.buyer, `stages.${stage}.buyer`),
    payout: requireAddress(rawStage.payout, `stages.${stage}.payout`),
    factory: requireAddress(rawStage.factory, `stages.${stage}.factory`),
    usdc: {
      address: usdcAddress,
      chainId: usdcChainId,
      decimals: usdcDecimals,
    },
  });
}

export function buildDeploymentAuthorizationRequestDrafts(input) {
  const stages = normalizeRoot(input);
  const requests = [
    buildDeployRequest(stages.deploy_core_contracts),
    buildConfigureRequest(stages.configure_sources_and_roles),
    buildSmokeRequest(stages.smoke_usdc_spend),
  ];
  return {
    schemaVersion: 1,
    change: CHANGE_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    readyToAskAuthorization: true,
    broadcastAllowed: false,
    deployAllowed: false,
    goalCompleteAllowed: false,
    safety: { ...SAFETY },
    stageOrder: [...STAGE_ORDER],
    requests,
    requestsByStage: Object.fromEntries(requests.map((request) => [request.stage, request])),
    summary: {
      totalStages: STAGE_ORDER.length,
      requestCount: requests.length,
      nextAction: "ask_user_for_stage_scoped_authorization",
      boundary: "draft_only_not_authorization",
    },
  };
}

function errorPayload(error) {
  if (error instanceof DeploymentAuthorizationRequestDraftError) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  return {
    name: "DeploymentAuthorizationRequestDraftError",
    code: "UNEXPECTED",
    path: "unknown",
    message: "发生未预期错误",
  };
}

export async function runCli(_argv = [], streams = {}, stdinText) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const stdin = readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail);
    const text = stdinText ?? await readCliStdin(stdin, fail);
    const input = JSON.parse(text);
    const draft = buildDeploymentAuthorizationRequestDrafts(input);
    writeCliStream(stdout, `${JSON.stringify(draft, null, 2)}\n`, "streams.stdout", fail);
    return { ok: true, code: 0 };
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const payload = error instanceof SyntaxError
      ? {
        name: "DeploymentAuthorizationRequestDraftError",
        code: "JSON_INVALID",
        path: "stdin",
        message: "stdin 必须是合法 JSON",
      }
      : errorPayload(error);
    writeCliStream(stderr, `${JSON.stringify({ error: payload })}\n`, "streams.stderr", fail);
    return { ok: false, code: 1 };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv, process);
  process.exitCode = result.code;
}
