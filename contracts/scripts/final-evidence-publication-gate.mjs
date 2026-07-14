import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CHANGE_NAME = "onchain-research-escrow";
const ARC_TESTNET_CHAIN_ID = 5042002;
const STAGE = "final_evidence_publication";
const GRAPHIFY_SUMMARY = Object.freeze({
  nodes: 1307,
  edges: 2754,
  communities: 47,
  reportPath: "graphify-out/GRAPH_REPORT.md",
});
const REQUIRED_DOCUMENT_PATHS = Object.freeze([
  "README.md",
  "docs/contracts/onchain-research-escrow.md",
  "deployments/5042002.json",
]);
const FINAL_EVIDENCE_FLAGS = Object.freeze([
  "finalManifestPresent",
  "publicVerifierPassed",
  "exactMatchVerified",
  "roleGraphVerified",
  "sourceConfigVerified",
  "smokeVerified",
  "finalizedBlockVerified",
  "readmeReferencesFinalAddresses",
  "docsReferencesFinalAddresses",
  "verifierReferencesFinalAddresses",
  "graphifyCheckedAfterFinalCode",
]);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SECRET_SHAPED =
  /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]{8,}|mnemonic|private[_-]?key|credentialed[_-]?rpc|:\/\/[^/\s:@]+:[^/\s@]+@)/iu;

const TOP_LEVEL_KEYS = new Set([
  "change",
  "chainId",
  "stage",
  "commit",
  "manifestDigest",
  "graphify",
  "documents",
  "coreContracts",
  "finalEvidence",
  "counts",
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
  requiresFinalPublicVerifierEvidence: true,
  requiresFreshHumanReview: true,
  noSecrets: true,
  noResponseOrAmbiguousApprovalStops: true,
});

export class FinalEvidencePublicationGateError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "FinalEvidencePublicationGateError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new FinalEvidencePublicationGateError(code, path, message);
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

function addMissing(missingInputs, path, reason = "missing_or_invalid_public_input") {
  missingInputs.push({ path, reason });
}

function isZeroAddress(value) {
  return typeof value === "string"
    && value.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function isStrictAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value) && !isZeroAddress(value);
}

function isStrictCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function isStrictDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function evaluateScalar(missingInputs, path, value, valid) {
  if (!valid(value)) {
    addMissing(missingInputs, path, value === undefined ? "missing" : "missing_or_invalid_public_input");
  }
}

function requireRecordForEvaluation(value) {
  return isRecord(value) ? value : undefined;
}

function evaluateGraphify(missingInputs, input) {
  const graphify = requireRecordForEvaluation(input.graphify);
  if (!graphify) {
    addMissing(missingInputs, "graphify", input.graphify === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  for (const [key, expected] of Object.entries(GRAPHIFY_SUMMARY)) {
    evaluateScalar(missingInputs, `graphify.${key}`, graphify[key], (value) => value === expected);
  }
}

function evaluateDocuments(missingInputs, input) {
  const documents = requireRecordForEvaluation(input.documents);
  if (!documents) {
    addMissing(missingInputs, "documents", input.documents === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  for (const key of ["readmeCommit", "contractDocsCommit", "manifestCommit", "verifierCommit"]) {
    evaluateScalar(missingInputs, `documents.${key}`, documents[key], (value) => value === input.commit);
  }
  const paths = documents.paths;
  if (!Array.isArray(paths) || !REQUIRED_DOCUMENT_PATHS.every((path) => paths.includes(path))) {
    addMissing(missingInputs, "documents.paths", "missing_required_final_evidence_path");
  }
}

function evaluateCoreContracts(missingInputs, input) {
  const coreContracts = requireRecordForEvaluation(input.coreContracts);
  if (!coreContracts) {
    addMissing(
      missingInputs,
      "coreContracts",
      input.coreContracts === undefined ? "missing" : "missing_or_invalid_public_input",
    );
    return;
  }
  for (const key of ["registry", "implementation", "factory"]) {
    evaluateScalar(missingInputs, `coreContracts.${key}`, coreContracts[key], isStrictAddress);
  }
}

function evaluateFinalEvidence(missingInputs, input) {
  const finalEvidence = requireRecordForEvaluation(input.finalEvidence);
  if (!finalEvidence) {
    addMissing(
      missingInputs,
      "finalEvidence",
      input.finalEvidence === undefined ? "missing" : "missing_or_invalid_public_input",
    );
    return;
  }
  for (const key of FINAL_EVIDENCE_FLAGS) {
    evaluateScalar(missingInputs, `finalEvidence.${key}`, finalEvidence[key], (value) => value === true);
  }
}

function evaluateCounts(missingInputs, input) {
  const counts = requireRecordForEvaluation(input.counts);
  if (!counts) {
    addMissing(missingInputs, "counts", input.counts === undefined ? "missing" : "missing_or_invalid_public_input");
    return;
  }
  evaluateScalar(missingInputs, "counts.fundedCloneCount", counts.fundedCloneCount, isNonNegativeInteger);
  evaluateScalar(missingInputs, "counts.settledCloneCount", counts.settledCloneCount, isNonNegativeInteger);
  if (
    isNonNegativeInteger(counts.fundedCloneCount)
    && isNonNegativeInteger(counts.settledCloneCount)
    && counts.settledCloneCount > counts.fundedCloneCount
  ) {
    addMissing(missingInputs, "counts.settledCloneCount", "settled_clone_count_exceeds_funded_clone_count");
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
  evaluateScalar(missingInputs, "stage", input.stage, (value) => value === STAGE);
  evaluateScalar(missingInputs, "commit", input.commit, isStrictCommit);
  evaluateScalar(missingInputs, "manifestDigest", input.manifestDigest, isStrictDigest);
  evaluateGraphify(missingInputs, input);
  evaluateDocuments(missingInputs, input);
  evaluateCoreContracts(missingInputs, input);
  evaluateFinalEvidence(missingInputs, input);
  evaluateCounts(missingInputs, input);
  return missingInputs;
}

export function buildFinalEvidencePublicationGate(input) {
  assertJsonSafe(input, "input");
  if (!isRecord(input)) {
    fail("INPUT_INVALID", "input", "input 必须是 plain object");
  }
  assertKnownTopLevelKeys(input);
  const missingInputs = evaluateReadiness(input);
  const readyToPublishFinalEvidence = missingInputs.length === 0;
  return {
    change: CHANGE_NAME,
    chainId: ARC_TESTNET_CHAIN_ID,
    stage: STAGE,
    readyToPublishFinalEvidence,
    nextAction: readyToPublishFinalEvidence
      ? "request_final_evidence_publication_review"
      : "collect_final_evidence_publication_inputs",
    missingInputs,
    readyToExecuteExternalWrites: false,
    broadcastAllowed: false,
    sourceVerifyAllowed: false,
    roleChangeAllowed: false,
    taskCompleteAllowed: false,
    finalEvidencePublicationAllowed: false,
    safety: { ...SAFETY },
  };
}

function errorPayload(error) {
  if (error instanceof FinalEvidencePublicationGateError) {
    return {
      name: error.name,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  }
  return {
    name: "FinalEvidencePublicationGateError",
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
    const report = buildFinalEvidencePublicationGate(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return { ok: true, code: 0 };
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const payload = error instanceof SyntaxError
      ? { name: "FinalEvidencePublicationGateError", code: "JSON_INVALID", path: "stdin", message: "stdin 必须是合法 JSON" }
      : errorPayload(error);
    writeCliStream(stderr, `${JSON.stringify({ error: payload })}\n`, "streams.stderr", fail);
    return { ok: false, code: 1 };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv, process);
  process.exitCode = result.code;
}
