import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CHANGE_NAME = "onchain-research-escrow";
const ARC_TESTNET_CHAIN_ID = 5042002;
const OFFICIAL_USDC = "0x3600000000000000000000000000000000000000";

const STAGE_ORDER = Object.freeze([
  "deploy_core_contracts",
  "configure_sources_and_roles",
  "smoke_usdc_spend",
]);

const TOP_LEVEL_KEYS = new Set(["change", "chainId", "commit", "stages"]);
const STAGE_KEYS = Object.freeze({
  deploy_core_contracts: new Set(["deployer", "transactions"]),
  configure_sources_and_roles: new Set(["deployer", "transactions", "sourceChanges", "roleChanges"]),
  smoke_usdc_spend: new Set(["buyer", "payout", "usdc", "factory", "maxUsdcUnits", "transactions"]),
});
const TRANSACTION_KEYS = new Set(["name", "type", "to", "estimatedGas", "args"]);
const SOURCE_CHANGE_KEYS = new Set(["sourceId", "payout", "maxUnitPrice", "active"]);
const ROLE_CHANGE_KEYS = new Set(["contract", "action", "role", "account"]);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/u;
const SECRET_SHAPED =
  /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]{8,}|mnemonic|private[_-]?key|credentialed[_-]?rpc|:\/\/[^/\s:@]+:[^/\s@]+@)/iu;

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
  noSecrets: true,
  noResponseOrAmbiguousApprovalStops: true,
  inputChangeRequiresNewAuthorization: true,
  stageAuthorizationReuseAllowed: false,
});

export class DeploymentWritePlanFreezeError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentWritePlanFreezeError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentWritePlanFreezeError(code, path, message);
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

function isArrayIndexKey(key, length) {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
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
    if (SECRET_SHAPED.test(value)) {
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

function sortedJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedJsonValue(value[key])]),
    );
  }
  return value;
}

function digestValue(value) {
  const text = JSON.stringify(sortedJsonValue(value));
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function addMissing(missingInputs, path, reason = "missing_or_invalid_public_input") {
  missingInputs.push({ path, reason });
}

function requireRecordForEvaluation(value) {
  return isRecord(value) ? value : undefined;
}

function assertKnownKeys(value, path, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail("UNKNOWN_FIELD", `${path}.${key}`, `未知字段：${path}.${key}`);
    }
  }
}

function isStrictAddress(value) {
  return typeof value === "string"
    && ADDRESS_PATTERN.test(value)
    && value.toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function isOfficialUsdc(value) {
  return isStrictAddress(value) && value.toLowerCase() === OFFICIAL_USDC;
}

function isStrictCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function isDecimal(value) {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isPositiveDecimal(value) {
  return isDecimal(value) && BigInt(value) > 0n;
}

function isBytes32(value) {
  return typeof value === "string" && BYTES32_PATTERN.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function evaluateScalar(missingInputs, path, value, valid, reason) {
  if (!valid(value)) {
    addMissing(missingInputs, path, value === undefined ? "missing" : reason);
  }
}

function normalizeTransaction(stage, transaction, path, missingInputs) {
  const record = requireRecordForEvaluation(transaction);
  if (!record) {
    addMissing(missingInputs, path);
    return undefined;
  }
  assertKnownKeys(record, path, TRANSACTION_KEYS);
  evaluateScalar(missingInputs, `${path}.name`, record.name, isNonEmptyString);
  evaluateScalar(missingInputs, `${path}.type`, record.type, isNonEmptyString);
  evaluateScalar(
    missingInputs,
    `${path}.estimatedGas`,
    record.estimatedGas,
    isPositiveDecimal,
  );
  const validTarget = stage === "deploy_core_contracts"
    ? (value) => value === "CREATE" || isStrictAddress(value)
    : isStrictAddress;
  evaluateScalar(missingInputs, `${path}.to`, record.to, validTarget);
  return sortedJsonValue(record);
}

function evaluateTransactions(stage, stageRecord, path, missingInputs) {
  if (!Array.isArray(stageRecord.transactions) || stageRecord.transactions.length === 0) {
    addMissing(missingInputs, `${path}.transactions`, "missing_or_empty_transactions");
    return [];
  }
  return stageRecord.transactions.map((transaction, index) =>
    normalizeTransaction(stage, transaction, `${path}.transactions[${index}]`, missingInputs),
  );
}

function normalizeSourceChange(change, path, missingInputs) {
  const record = requireRecordForEvaluation(change);
  if (!record) {
    addMissing(missingInputs, path);
    return undefined;
  }
  assertKnownKeys(record, path, SOURCE_CHANGE_KEYS);
  evaluateScalar(missingInputs, `${path}.sourceId`, record.sourceId, isBytes32);
  evaluateScalar(missingInputs, `${path}.payout`, record.payout, isStrictAddress);
  evaluateScalar(missingInputs, `${path}.maxUnitPrice`, record.maxUnitPrice, isPositiveDecimal);
  evaluateScalar(missingInputs, `${path}.active`, record.active, (value) => typeof value === "boolean");
  return sortedJsonValue(record);
}

function normalizeRoleChange(change, path, missingInputs) {
  const record = requireRecordForEvaluation(change);
  if (!record) {
    addMissing(missingInputs, path);
    return undefined;
  }
  assertKnownKeys(record, path, ROLE_CHANGE_KEYS);
  evaluateScalar(
    missingInputs,
    `${path}.contract`,
    record.contract,
    (value) => value === "factory" || value === "registry",
  );
  evaluateScalar(
    missingInputs,
    `${path}.action`,
    record.action,
    (value) => value === "grant" || value === "revoke",
  );
  evaluateScalar(missingInputs, `${path}.role`, record.role, isNonEmptyString);
  evaluateScalar(missingInputs, `${path}.account`, record.account, isStrictAddress);
  return sortedJsonValue(record);
}

function evaluateDeployStage(stageRecord, path, missingInputs) {
  evaluateScalar(missingInputs, `${path}.deployer`, stageRecord.deployer, isStrictAddress);
  return {
    deployer: stageRecord.deployer,
    transactions: evaluateTransactions("deploy_core_contracts", stageRecord, path, missingInputs),
  };
}

function evaluateConfigureStage(stageRecord, path, missingInputs) {
  evaluateScalar(missingInputs, `${path}.deployer`, stageRecord.deployer, isStrictAddress);
  const transactions = evaluateTransactions("configure_sources_and_roles", stageRecord, path, missingInputs);
  if (!Array.isArray(stageRecord.sourceChanges) || stageRecord.sourceChanges.length === 0) {
    addMissing(missingInputs, `${path}.sourceChanges`, "missing_or_empty_source_changes");
  }
  if (!Array.isArray(stageRecord.roleChanges) || stageRecord.roleChanges.length === 0) {
    addMissing(missingInputs, `${path}.roleChanges`, "missing_or_empty_role_changes");
  }
  return {
    deployer: stageRecord.deployer,
    transactions,
    sourceChanges: Array.isArray(stageRecord.sourceChanges)
      ? stageRecord.sourceChanges.map((change, index) =>
        normalizeSourceChange(change, `${path}.sourceChanges[${index}]`, missingInputs),
      )
      : [],
    roleChanges: Array.isArray(stageRecord.roleChanges)
      ? stageRecord.roleChanges.map((change, index) =>
        normalizeRoleChange(change, `${path}.roleChanges[${index}]`, missingInputs),
      )
      : [],
  };
}

function evaluateSmokeStage(stageRecord, path, missingInputs) {
  evaluateScalar(missingInputs, `${path}.buyer`, stageRecord.buyer, isStrictAddress);
  evaluateScalar(missingInputs, `${path}.payout`, stageRecord.payout, isStrictAddress);
  evaluateScalar(missingInputs, `${path}.usdc`, stageRecord.usdc, isOfficialUsdc);
  evaluateScalar(missingInputs, `${path}.factory`, stageRecord.factory, isStrictAddress);
  evaluateScalar(missingInputs, `${path}.maxUsdcUnits`, stageRecord.maxUsdcUnits, isPositiveDecimal);
  return {
    buyer: stageRecord.buyer,
    payout: stageRecord.payout,
    usdc: stageRecord.usdc,
    factory: stageRecord.factory,
    maxUsdcUnits: stageRecord.maxUsdcUnits,
    transactions: evaluateTransactions("smoke_usdc_spend", stageRecord, path, missingInputs),
  };
}

function evaluateStage(input, stage, missingInputs) {
  const path = `stages.${stage}`;
  const stageRecord = requireRecordForEvaluation(input.stages?.[stage]);
  if (!stageRecord) {
    addMissing(missingInputs, path, input.stages?.[stage] === undefined ? "missing" : "missing_or_invalid_public_input");
    return {};
  }
  assertKnownKeys(stageRecord, path, STAGE_KEYS[stage]);
  if (stage === "deploy_core_contracts") {
    return evaluateDeployStage(stageRecord, path, missingInputs);
  }
  if (stage === "configure_sources_and_roles") {
    return evaluateConfigureStage(stageRecord, path, missingInputs);
  }
  return evaluateSmokeStage(stageRecord, path, missingInputs);
}

function assertKnownTopLevelKeys(input) {
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail("UNKNOWN_FIELD", key, `未知顶层字段：${key}`);
    }
  }
}

function assertKnownStageKeys(stages) {
  if (!isRecord(stages)) {
    return;
  }
  for (const key of Object.keys(stages)) {
    if (!STAGE_ORDER.includes(key)) {
      fail("UNKNOWN_STAGE", `stages.${key}`, `未知阶段：${key}`);
    }
  }
}

function evaluateReadiness(input) {
  const missingInputs = [];
  evaluateScalar(missingInputs, "change", input.change, (value) => value === CHANGE_NAME);
  evaluateScalar(missingInputs, "chainId", input.chainId, (value) => value === ARC_TESTNET_CHAIN_ID);
  evaluateScalar(missingInputs, "commit", input.commit, isStrictCommit);
  if (!isRecord(input.stages)) {
    addMissing(missingInputs, "stages", input.stages === undefined ? "missing" : "missing_or_invalid_public_input");
    return { missingInputs, normalizedStages: {} };
  }
  assertKnownStageKeys(input.stages);
  const normalizedStages = {};
  for (const stage of STAGE_ORDER) {
    normalizedStages[stage] = evaluateStage(input, stage, missingInputs);
  }
  return { missingInputs, normalizedStages };
}

export function buildDeploymentWritePlanFreeze(input) {
  assertJsonSafe(input, "input");
  if (!isRecord(input)) {
    fail("INPUT_INVALID", "input", "input 必须是 plain object");
  }
  assertKnownTopLevelKeys(input);
  const { missingInputs, normalizedStages } = evaluateReadiness(input);
  const stageDigests = Object.fromEntries(
    STAGE_ORDER.map((stage) => [
      stage,
      digestValue({
        change: CHANGE_NAME,
        chainId: ARC_TESTNET_CHAIN_ID,
        commit: isStrictCommit(input.commit) ? input.commit : null,
        stage,
        body: normalizedStages[stage] ?? {},
      }),
    ]),
  );
  const readyToRequestAuthorization = missingInputs.length === 0;
  return {
    change: CHANGE_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    commit: isStrictCommit(input.commit) ? input.commit : null,
    stageOrder: [...STAGE_ORDER],
    readyToRequestAuthorization,
    nextAction: readyToRequestAuthorization
      ? "request_stage_scoped_authorization"
      : "collect_deployment_write_plan_inputs",
    missingInputs,
    stageDigests,
    planDigest: digestValue({
      change: CHANGE_NAME,
      chainId: ARC_TESTNET_CHAIN_ID,
      commit: isStrictCommit(input.commit) ? input.commit : null,
      stageOrder: STAGE_ORDER,
      stageDigests,
    }),
    readyToExecuteExternalWrites: false,
    broadcastAllowed: false,
    sourceVerifyAllowed: false,
    roleChangeAllowed: false,
    testUsdcSpendAllowed: false,
    taskCompleteAllowed: false,
    authorizedStages: [],
    safety: { ...SAFETY },
  };
}

function errorPayload(error) {
  if (error instanceof DeploymentWritePlanFreezeError) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  return {
    name: "DeploymentWritePlanFreezeError",
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
    const report = buildDeploymentWritePlanFreeze(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return { ok: true, code: 0 };
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const payload = error instanceof SyntaxError
      ? { name: "DeploymentWritePlanFreezeError", code: "JSON_INVALID", path: "stdin", message: "stdin 必须是合法 JSON" }
      : errorPayload(error);
    writeCliStream(stderr, `${JSON.stringify({ error: payload })}\n`, "streams.stderr", fail);
    return { ok: false, code: 1 };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv, process);
  process.exitCode = result.code;
}
