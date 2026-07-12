import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CHANGE_NAME = "onchain-research-escrow";
const ARC_TESTNET_CHAIN_ID = 5042002;
const CONFIGURE_STAGE = "configure_sources_and_roles";
const SOURCE_COUNT = 5;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RAW_32_BYTE_SECRET_SHAPED = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const PUBLIC_SOURCE_ID_PATH_PATTERN = /^input\.sources\[(?:0|[1-9][0-9]*)\]\.sourceId$/u;
const SECRET_SHAPED =
  /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]{8,}|mnemonic|private[_-]?key|credentialed[_-]?rpc|:\/\/[^/\s:@]+:[^/\s@]+@)/iu;

const TOP_LEVEL_KEYS = new Set([
  "change",
  "chainId",
  "stage",
  "commit",
  "requestDigest",
  "coreContracts",
  "sources",
  "rolePlan",
  "evidence",
]);

const CORE_CONTRACT_KEYS = Object.freeze(["registry", "implementation", "factory"]);
const ROLE_ADDRESS_KEYS = Object.freeze([
  "deployer",
  "factoryGovernanceSafe",
  "registryGovernanceSafe",
  "sourceAdmin",
  "fundingSigner",
  "intentSigner",
  "settler",
]);
const ROLE_CONTRACTS = new Set(["factory", "registry"]);
const ROLE_NAMES_BY_CONTRACT = Object.freeze({
  factory: new Set([
    "DEFAULT_ADMIN_ROLE",
    "FUNDING_SIGNER_ROLE",
    "INTENT_SIGNER_ROLE",
    "SETTLER_ROLE",
  ]),
  registry: new Set([
    "DEFAULT_ADMIN_ROLE",
    "SOURCE_ADMIN_ROLE",
  ]),
});
const EVIDENCE_KEYS = Object.freeze([
  "bindFactoryPlanned",
  "exactMatchPlanned",
  "finalizedReadbackPlanned",
  "manifestUpdatePlanned",
]);

const SENSITIVE_KEY_NAMES = new Set([
  "apikey",
  "bearer",
  "credentialedrpc",
  "mnemonic",
  "password",
  "privatekey",
  "rpcurl",
  "secret",
  "token",
]);

const APPROVAL_SHAPED_KEY_NAMES = new Set([
  "approved",
  "authorization",
  "authorizationrecord",
  "authorizationtext",
]);

const SAFETY = Object.freeze({
  notAuthorizationRecord: true,
  notPreflightProof: true,
  notFinalManifestOrVerifierEvidence: true,
  requiresFreshConfigureAuthorization: true,
  deploymentAuthorizationCannotBeReused: true,
  noResponseOrAmbiguousApprovalStops: true,
  noSecrets: true,
});

export class SourceRoleReadinessReportError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "SourceRoleReadinessReportError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new SourceRoleReadinessReportError(code, path, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeKeyName(key) {
  return key.toLowerCase().replace(/[_-]/gu, "");
}

function isSensitiveKeyName(key) {
  return SENSITIVE_KEY_NAMES.has(normalizeKeyName(key));
}

function isApprovalShapedKeyName(key) {
  return APPROVAL_SHAPED_KEY_NAMES.has(normalizeKeyName(key));
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

function assertSafeKey(key, path) {
  if (isApprovalShapedKeyName(key)) {
    fail("APPROVAL_SHAPED_INPUT", path, `${path} 使用授权形态字段名，已拒绝且不回显原值`);
  }
  if (isSensitiveKeyName(key)) {
    fail("SECRET_SHAPED_INPUT", path, `${path} 使用疑似敏感字段名，已拒绝且不回显原值`);
  }
}

function assertJsonSafe(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INPUT_INVALID", path, `${path} 必须是有限数字`);
    }
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
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      const childPath = `${path}[${index}]`;
      if (!descriptor) {
        fail("INPUT_INVALID", childPath, `${childPath} 不得为空洞`);
      }
      if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
        fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
      }
      assertJsonSafe(descriptor.value, childPath, seen);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length" || isArrayIndexKey(key, value.length)) {
        continue;
      }
      const childPath = `${path}.${key}`;
      assertSafeKey(key, childPath);
      if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
        fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
      }
      assertJsonSafe(descriptor.value, childPath, seen);
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
    assertSafeKey(key, childPath);
    if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
      fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
    }
    assertJsonSafe(descriptor.value, childPath, seen);
  }
  seen.delete(value);
}

function requireRecordForEvaluation(value) {
  return isRecord(value) ? value : undefined;
}

function isZeroAddress(value) {
  return typeof value === "string"
    && value.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function isZeroBytes32(value) {
  return typeof value === "string"
    && value.toLowerCase() === `0x${"0".repeat(64)}`;
}

function isStrictAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value) && !isZeroAddress(value);
}

function isStrictBytes32(value) {
  return typeof value === "string" && BYTES32_PATTERN.test(value) && !isZeroBytes32(value);
}

function isStrictCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function isStrictDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isDecimalString(value) {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isRoleContract(value) {
  return typeof value === "string" && ROLE_CONTRACTS.has(value);
}

function isExpectedRoleForContract(contract, role) {
  return typeof role === "string"
    && role.length > 0
    && ROLE_NAMES_BY_CONTRACT[contract]?.has(role) === true;
}

function addMissing(missingInputs, path, reason = "missing_or_invalid_public_input") {
  missingInputs.push({ path, reason });
}

function evaluateScalar(missingInputs, path, value, valid) {
  if (!valid(value)) {
    addMissing(missingInputs, path, value === undefined ? "missing" : "missing_or_invalid_public_input");
  }
}

function evaluateCoreContracts(missingInputs, input) {
  const coreContracts = requireRecordForEvaluation(input.coreContracts);
  if (!coreContracts) {
    addMissing(missingInputs, "coreContracts", input.coreContracts === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  for (const key of CORE_CONTRACT_KEYS) {
    evaluateScalar(missingInputs, `coreContracts.${key}`, coreContracts[key], isStrictAddress);
  }
}

function evaluateSources(missingInputs, input) {
  if (!Array.isArray(input.sources)) {
    addMissing(missingInputs, "sources", input.sources === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  if (input.sources.length !== SOURCE_COUNT) {
    addMissing(missingInputs, "sources", "must_contain_exactly_five_sources");
    return;
  }
  input.sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isRecord(source)) {
      addMissing(missingInputs, path, "missing_or_invalid_public_input");
      return;
    }
    evaluateScalar(missingInputs, `${path}.sourceId`, source.sourceId, isStrictBytes32);
    evaluateScalar(missingInputs, `${path}.payout`, source.payout, isStrictAddress);
    evaluateScalar(missingInputs, `${path}.maxUnitPrice`, source.maxUnitPrice, isDecimalString);
    evaluateScalar(missingInputs, `${path}.active`, source.active, (value) => typeof value === "boolean");
    evaluateScalar(missingInputs, `${path}.revision`, source.revision, isRevision);
  });
}

function evaluateRolePlan(missingInputs, input) {
  const rolePlan = requireRecordForEvaluation(input.rolePlan);
  if (!rolePlan) {
    addMissing(missingInputs, "rolePlan", input.rolePlan === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  for (const key of ROLE_ADDRESS_KEYS) {
    evaluateScalar(missingInputs, `rolePlan.${key}`, rolePlan[key], isStrictAddress);
  }
  evaluateScalar(missingInputs, "rolePlan.grants", rolePlan.grants, Array.isArray);
  evaluateScalar(missingInputs, "rolePlan.revokes", rolePlan.revokes, Array.isArray);
  evaluateRoleDiffEntries(missingInputs, "rolePlan.grants", rolePlan.grants);
  evaluateRoleDiffEntries(missingInputs, "rolePlan.revokes", rolePlan.revokes);
}

function evaluateRoleDiffEntries(missingInputs, path, entries) {
  if (!Array.isArray(entries)) {
    return;
  }
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addMissing(missingInputs, entryPath, "missing_or_invalid_public_input");
      return;
    }
    evaluateScalar(missingInputs, `${entryPath}.contract`, entry.contract, isRoleContract);
    evaluateScalar(
      missingInputs,
      `${entryPath}.role`,
      entry.role,
      (role) => isRoleContract(entry.contract) && isExpectedRoleForContract(entry.contract, role),
    );
    evaluateScalar(missingInputs, `${entryPath}.account`, entry.account, isStrictAddress);
  });
}

function evaluateEvidence(missingInputs, input) {
  const evidence = requireRecordForEvaluation(input.evidence);
  if (!evidence) {
    addMissing(missingInputs, "evidence", input.evidence === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  for (const key of EVIDENCE_KEYS) {
    evaluateScalar(missingInputs, `evidence.${key}`, evidence[key], (value) => value === true);
  }
}

function assertKnownTopLevelKeys(input) {
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail("UNKNOWN_TOP_LEVEL_KEY", key, `未知顶层字段：${key}`);
    }
  }
}

function evaluateReadiness(input) {
  const missingInputs = [];
  evaluateScalar(missingInputs, "change", input.change, (value) => value === CHANGE_NAME);
  evaluateScalar(missingInputs, "chainId", input.chainId, (value) => value === ARC_TESTNET_CHAIN_ID);
  evaluateScalar(missingInputs, "stage", input.stage, (value) => value === CONFIGURE_STAGE);
  evaluateScalar(missingInputs, "commit", input.commit, isStrictCommit);
  evaluateScalar(missingInputs, "requestDigest", input.requestDigest, isStrictDigest);
  evaluateCoreContracts(missingInputs, input);
  evaluateSources(missingInputs, input);
  evaluateRolePlan(missingInputs, input);
  evaluateEvidence(missingInputs, input);
  return missingInputs;
}

export function buildSourceRoleReadinessReport(input) {
  assertJsonSafe(input, "input");
  if (!isRecord(input)) {
    fail("INPUT_INVALID", "input", "input 必须是 plain object");
  }
  assertKnownTopLevelKeys(input);
  const missingInputs = evaluateReadiness(input);
  const readyToRequestConfigureAuthorization = missingInputs.length === 0;
  return {
    change: CHANGE_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    stage: CONFIGURE_STAGE,
    readyToRequestConfigureAuthorization,
    nextAction: readyToRequestConfigureAuthorization
      ? "request_configure_sources_and_roles_authorization"
      : "collect_configure_sources_and_roles_public_inputs",
    missingInputs,
    readyToExecuteExternalWrites: false,
    broadcastAllowed: false,
    sourceVerifyAllowed: false,
    roleChangeAllowed: false,
    taskCompleteAllowed: false,
    safety: { ...SAFETY },
  };
}

function errorPayload(error) {
  if (error instanceof SourceRoleReadinessReportError) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  return {
    name: "SourceRoleReadinessReportError",
    code: "UNEXPECTED",
    path: "unknown",
    message: "发生未预期错误",
  };
}

export async function runCli(_args = [], streams = {}, stdinText) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const stdin = readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail);
    const text = stdinText ?? await readCliStdin(stdin, fail);
    const input = JSON.parse(text);
    const report = buildSourceRoleReadinessReport(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return { ok: true, code: 0 };
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const payload = error instanceof SyntaxError
      ? { name: "SourceRoleReadinessReportError", code: "JSON_INVALID", path: "stdin", message: "stdin 必须是合法 JSON" }
      : errorPayload(error);
    writeCliStream(stderr, `${JSON.stringify({ error: payload })}\n`, "streams.stderr", fail);
    return { ok: false, code: 1 };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv, process);
  process.exitCode = result.code;
}
