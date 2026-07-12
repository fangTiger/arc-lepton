import { fileURLToPath } from "node:url";

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
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const RAW_32_BYTE_SECRET_SHAPED = /^(?:0x)?[0-9a-fA-F]{64}$/;
const PUBLIC_SOURCE_ID_PATH_PATTERN =
  /^input\.stages\.configure_sources_and_roles\.sourceConfigurationChanges\[[0-9]+\](?:\.args)?\.sourceId$/u;
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

const PURPOSES = Object.freeze({
  deploy_core_contracts: "收集部署 Registry、ResearchEscrow implementation 与 Factory 前的公开授权输入",
  configure_sources_and_roles: "收集 source 配置、角色 grant/revoke 与 deployer 撤权前的公开授权输入",
  smoke_usdc_spend: "收集 direct EOA buyer 花费 test USDC smoke 前的公开授权输入",
});

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

export class DeploymentAuthorizationInputGapError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentAuthorizationInputGapError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentAuthorizationInputGapError(code, path, message);
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
      const descriptor = descriptors[String(index)];
      const childPath = `${path}[${index}]`;
      if (!descriptor) {
        fail("INPUT_INVALID", `${path}[${index}]`, `${path}[${index}] 不得为空洞`);
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

function valueAt(record, path) {
  const parts = path.split(".");
  let current = record;
  for (const part of parts) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
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
      if (Object.prototype.hasOwnProperty.call(descriptor, "value")
        && containsPlaceholderString(descriptor.value, seen)) {
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
  const body = value.slice(2).toLowerCase();
  return new Set(body).size === 1;
}

function isValidAddress(value) {
  if (typeof value !== "string" || isPlaceholderString(value) || !ADDRESS_PATTERN.test(value)) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized !== "0x0000000000000000000000000000000000000000"
    && !isRepeatedExampleAddress(normalized);
}

function isValidCommit(value) {
  return typeof value === "string" && !isPlaceholderString(value) && COMMIT_PATTERN.test(value);
}

function isValidDigest(value) {
  if (typeof value !== "string" || isPlaceholderString(value) || !DIGEST_PATTERN.test(value)) {
    return false;
  }
  const body = value.slice("sha256:".length);
  return new Set(body).size > 1;
}

function isValidDecimal(value) {
  return typeof value === "string" && !isPlaceholderString(value) && DECIMAL_PATTERN.test(value);
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && !containsPlaceholderString(value);
}

function isNonEmptyRecord(value) {
  return isRecord(value) && Object.keys(value).length > 0 && !containsPlaceholderString(value);
}

function validByKind(value, kind) {
  if (kind === "address") return isValidAddress(value);
  if (kind === "commit") return isValidCommit(value);
  if (kind === "digest") return isValidDigest(value);
  if (kind === "decimal") return isValidDecimal(value);
  if (kind === "array") return isNonEmptyArray(value);
  if (kind === "record") return isNonEmptyRecord(value);
  if (kind === "usdcChain") return value === ARC_TESTNET_CHAIN_ID;
  if (kind === "usdcDecimals") return value === 6;
  if (kind === "officialUsdc") return typeof value === "string" && value.toLowerCase() === OFFICIAL_USDC;
  return value !== undefined && value !== null && value !== "";
}

function fieldSpec(path, kind, label = path) {
  return { path, kind, label };
}

const REQUIRED_FIELDS = Object.freeze({
  deploy_core_contracts: Object.freeze([
    fieldSpec("commit", "commit"),
    fieldSpec("deployer", "address"),
    fieldSpec("expectedAddresses.registry", "address"),
    fieldSpec("expectedAddresses.implementation", "address"),
    fieldSpec("expectedAddresses.factory", "address"),
    fieldSpec("artifacts.registry", "record"),
    fieldSpec("artifacts.implementation", "record"),
    fieldSpec("artifacts.factory", "record"),
    fieldSpec("transactions", "array"),
    fieldSpec("estimatedGas", "decimal"),
    fieldSpec("maxUsdcUnits", "decimal"),
    fieldSpec("requestDigest", "digest"),
  ]),
  configure_sources_and_roles: Object.freeze([
    fieldSpec("commit", "commit"),
    fieldSpec("targetAddresses", "record"),
    fieldSpec("sourceConfigurationChanges", "array"),
    fieldSpec("roleChanges", "array"),
    fieldSpec("factoryGovernanceSafe", "address"),
    fieldSpec("registryGovernanceSafe", "address"),
    fieldSpec("sourceAdmin", "address"),
    fieldSpec("fundingSigner", "address"),
    fieldSpec("intentSigner", "address"),
    fieldSpec("settler", "address"),
    fieldSpec("estimatedGas", "decimal"),
    fieldSpec("maxUsdcUnits", "decimal"),
    fieldSpec("requestDigest", "digest"),
  ]),
  smoke_usdc_spend: Object.freeze([
    fieldSpec("commit", "commit"),
    fieldSpec("buyer", "address"),
    fieldSpec("payout", "address"),
    fieldSpec("factory", "address"),
    fieldSpec("usdc.address", "officialUsdc"),
    fieldSpec("usdc.chainId", "usdcChain"),
    fieldSpec("usdc.decimals", "usdcDecimals"),
    fieldSpec("steps", "array"),
    fieldSpec("maxUsdcUnits", "decimal"),
    fieldSpec("estimatedGas", "decimal"),
    fieldSpec("requestDigest", "digest"),
  ]),
});

function normalizeTopLevel(input) {
  const root = requireRecord(input, "input");
  const allowed = new Set(["change", "chainId", "stages"]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) {
      fail("UNKNOWN_TOP_LEVEL_KEY", key, `未知顶层字段：${key}`);
    }
  }
  if (root.change !== CHANGE_NAME) {
    fail("CHANGE_UNSUPPORTED", "change", `change 必须是 ${CHANGE_NAME}`);
  }
  if (root.chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("CHAIN_ID_UNSUPPORTED", "chainId", `chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }
  const stages = root.stages === undefined ? {} : requireRecord(root.stages, "stages");
  for (const stage of Object.keys(stages)) {
    if (!STAGE_ORDER.includes(stage)) {
      fail("UNKNOWN_STAGE", `stages.${stage}`, `未知阶段：${stage}`);
    }
  }
  return { stages };
}

function evaluateStage(stage, rawStage) {
  const input = isRecord(rawStage) ? rawStage : {};
  const presentInputs = [];
  const missingInputs = [];
  for (const spec of REQUIRED_FIELDS[stage]) {
    const value = valueAt(input, spec.path);
    if (validByKind(value, spec.kind)) {
      presentInputs.push(spec.path);
    } else {
      missingInputs.push({
        path: spec.path,
        reason: value === undefined ? "missing" : "missing_or_invalid_public_input",
      });
    }
  }
  return {
    stage,
    purpose: PURPOSES[stage],
    readyToRequestAuthorization: missingInputs.length === 0,
    presentInputs,
    missingInputs,
    readinessOnly: true,
    authoritativeNextStep: missingInputs.length === 0
      ? "build stage-scoped authorization request and ask for explicit user approval"
      : "collect missing public inputs before requesting explicit authorization",
  };
}

export function buildDeploymentAuthorizationInputGapReport(input) {
  assertJsonSafe(input, "input");
  const { stages } = normalizeTopLevel(input);
  const stageEntries = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, evaluateStage(stage, stages[stage])]),
  );
  const readyStages = Object.values(stageEntries)
    .filter((stage) => stage.readyToRequestAuthorization).length;
  const missingInputsCount = Object.values(stageEntries)
    .reduce((count, stage) => count + stage.missingInputs.length, 0);
  const readyToRequestAuthorization = readyStages === STAGE_ORDER.length;
  return {
    change: CHANGE_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    readyToRequestAuthorization,
    broadcastAllowed: false,
    deployAllowed: false,
    goalCompleteAllowed: false,
    safety: { ...SAFETY },
    stages: stageEntries,
    summary: {
      totalStages: STAGE_ORDER.length,
      readyStages,
      missingInputsCount,
      nextAction: readyToRequestAuthorization
        ? "build_stage_scoped_authorization_requests"
        : "collect_public_inputs",
    },
  };
}

function errorPayload(error) {
  if (error instanceof DeploymentAuthorizationInputGapError) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  return {
    name: "DeploymentAuthorizationInputGapError",
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
    const report = buildDeploymentAuthorizationInputGapReport(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return { ok: true, code: 0 };
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const payload = error instanceof SyntaxError
      ? { name: "DeploymentAuthorizationInputGapError", code: "JSON_INVALID", path: "stdin", message: "stdin 必须是合法 JSON" }
      : errorPayload(error);
    writeCliStream(stderr, `${JSON.stringify({ error: payload })}\n`, "streams.stderr", fail);
    return { ok: false, code: 1 };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv, process);
  process.exitCode = result.code;
}
