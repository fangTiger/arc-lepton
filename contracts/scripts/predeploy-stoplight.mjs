import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const SAFETY = Object.freeze({
  noBroadcast: true,
  noDeploy: true,
  noAutoStage: true,
  noAutoCommit: true,
  noSecrets: true,
  notAuthorizationRecord: true,
  notPreflightProof: true,
  notFinalManifestOrVerifierEvidence: true,
  notLiveE2EOrRollbackEvidence: true,
});

export class PredeployStoplightError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "PredeployStoplightError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new PredeployStoplightError(code, path, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function optionalRecord(value, path) {
  if (value === undefined || value === null) {
    return {};
  }
  return requireRecord(value, path);
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
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
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

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("FIELD_INVALID", path, `${path} 必须是非空字符串`);
  }
  return value;
}

function optionalString(value, path) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireString(value, path);
}

function integerOrZero(value, path) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    fail("FIELD_INVALID", path, `${path} 必须是非负整数`);
  }
  return value;
}

function booleanValue(value, path) {
  if (typeof value !== "boolean") {
    fail("FIELD_INVALID", path, `${path} 必须是布尔值`);
  }
  return value;
}

function optionalBoolean(value, path) {
  if (value === undefined || value === null) {
    return false;
  }
  return booleanValue(value, path);
}

function arrayOrEmpty(value, path) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是数组`);
  }
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function addReason(reasons, code, path, message) {
  reasons.push({ code, path, message });
}

function normalizeOpenspec(input, reasons) {
  const value = requireRecord(input, "openspec");
  const totalTasks = integerOrZero(value.totalTasks, "openspec.totalTasks");
  const completeTasks = integerOrZero(value.completeTasks, "openspec.completeTasks");
  const remainingTasks = arrayOrEmpty(value.remainingTasks, "openspec.remainingTasks");
  if (remainingTasks.length > 0) {
    addReason(
      reasons,
      "OPENSPEC_REMAINING_TASKS",
      "openspec.remainingTasks",
      "OpenSpec 仍有未完成任务，不能宣称完成或进入无门禁部署",
    );
  }
  return {
    change: requireString(value.change, "openspec.change"),
    totalTasks,
    completeTasks,
    remainingTasks,
  };
}

function normalizeCommitScope(input, reasons) {
  const value = requireRecord(input, "commitScope");
  const summary = requireRecord(value.summary, "commitScope.summary");
  const normalizedSummary = {
    candidateCount: integerOrZero(summary.candidateCount, "commitScope.summary.candidateCount"),
    excludedCount: integerOrZero(summary.excludedCount, "commitScope.summary.excludedCount"),
    unknownCount: integerOrZero(summary.unknownCount, "commitScope.summary.unknownCount"),
    stagedCount: integerOrZero(summary.stagedCount, "commitScope.summary.stagedCount"),
    unstagedCount: integerOrZero(summary.unstagedCount, "commitScope.summary.unstagedCount"),
    untrackedCount: integerOrZero(summary.untrackedCount, "commitScope.summary.untrackedCount"),
    deletedCount: integerOrZero(summary.deletedCount, "commitScope.summary.deletedCount"),
  };
  if (normalizedSummary.unknownCount > 0) {
    addReason(
      reasons,
      "COMMIT_SCOPE_UNKNOWN",
      "commitScope.summary.unknownCount",
      "提交范围仍有 unknown 路径，需要人工确认",
    );
  }
  if (normalizedSummary.excludedCount > 0) {
    addReason(
      reasons,
      "COMMIT_SCOPE_EXCLUDED",
      "commitScope.summary.excludedCount",
      "提交范围报告包含 excluded 路径，不得自动暂存或发布",
    );
  }
  return {
    summary: normalizedSummary,
    safety: { ...optionalRecord(value.safety, "commitScope.safety") },
  };
}

function normalizeGraphify(input) {
  const value = requireRecord(input, "graphify");
  return {
    source: requireString(value.source, "graphify.source"),
    nodes: integerOrZero(value.nodes, "graphify.nodes"),
    edges: integerOrZero(value.edges, "graphify.edges"),
    communities: integerOrZero(value.communities, "graphify.communities"),
    notFinalEvidence: true,
  };
}

function explicitAuthorizationMatches(request, explicitAuthorization) {
  if (!isRecord(explicitAuthorization)) {
    return false;
  }
  return explicitAuthorization.approved === true
    && explicitAuthorization.stage === request.stage
    && explicitAuthorization.chainId === request.chainId
    && explicitAuthorization.commit === request.commit
    && explicitAuthorization.requestDigest === request.requestDigest
    && typeof explicitAuthorization.approvedAt === "string"
    && explicitAuthorization.approvedAt.trim() !== "";
}

function normalizeAuthorization(input, reasons) {
  const value = requireRecord(input, "authorization");
  const request = {
    stage: requireString(value.stage, "authorization.stage"),
    chainId: integerOrZero(value.chainId, "authorization.chainId"),
    commit: requireString(value.commit, "authorization.commit"),
    requestDigest: requireString(value.requestDigest, "authorization.requestDigest"),
    authorizationPackageDigest: optionalString(
      value.authorizationPackageDigest,
      "authorization.authorizationPackageDigest",
    ),
  };
  const ambiguousApproval = optionalString(value.ambiguousApproval, "authorization.ambiguousApproval");
  const matched = explicitAuthorizationMatches(request, value.explicitAuthorization);
  if (!matched) {
    addReason(
      reasons,
      "DEPLOY_AUTHORIZATION_MISSING",
      "authorization.explicitAuthorization",
      "缺少与当前 requestDigest 完全匹配的逐阶段明确授权",
    );
  }
  if (ambiguousApproval !== null) {
    addReason(
      reasons,
      "AMBIGUOUS_APPROVAL",
      "authorization.ambiguousApproval",
      "模糊同意不能替代当次明确授权",
    );
  }
  return {
    ...request,
    status: matched ? "explicit_authorization_matched" : "missing_explicit_authorization",
    authorizationPackageIsApproval: false,
  };
}

function normalizePreflight(input, reasons) {
  const value = requireRecord(input, "preflight");
  const cleanCommit = optionalBoolean(value.cleanCommit, "preflight.cleanCommit");
  const proofDigest = optionalString(value.proofDigest, "preflight.proofDigest");
  if (!cleanCommit) {
    addReason(
      reasons,
      "CLEAN_COMMIT_MISSING",
      "preflight.cleanCommit",
      "尚未证明 clean commit，不能进入部署广播",
    );
  }
  if (proofDigest === null) {
    addReason(
      reasons,
      "PREFLIGHT_PROOF_MISSING",
      "preflight.proofDigest",
      "尚未取得授权后的 preflight 通过证明",
    );
  }
  return { cleanCommit, proofDigest };
}

function normalizeFinalEvidence(input, reasons) {
  const value = requireRecord(input, "finalEvidence");
  const manifest = optionalBoolean(value.manifest, "finalEvidence.manifest");
  const publicVerifier = optionalBoolean(value.publicVerifier, "finalEvidence.publicVerifier");
  const finalAddresses = optionalBoolean(value.finalAddresses, "finalEvidence.finalAddresses");
  if (!manifest || !finalAddresses) {
    addReason(
      reasons,
      "FINAL_MANIFEST_MISSING",
      "finalEvidence.manifest",
      "最终 manifest、最终地址或 clean commit 证据仍缺失",
    );
  }
  if (!publicVerifier) {
    addReason(
      reasons,
      "FINAL_VERIFIER_MISSING",
      "finalEvidence.publicVerifier",
      "最终公开 RPC verifier 证据仍缺失",
    );
  }
  return { manifest, publicVerifier, finalAddresses };
}

function normalizeLiveEvidence(input, reasons) {
  const value = requireRecord(input, "liveEvidence");
  const rollout = optionalBoolean(value.rollout, "liveEvidence.rollout");
  const successE2E = optionalBoolean(value.successE2E, "liveEvidence.successE2E");
  const failureE2E = optionalBoolean(value.failureE2E, "liveEvidence.failureE2E");
  const rollback = optionalBoolean(value.rollback, "liveEvidence.rollback");
  if (!rollout) {
    addReason(
      reasons,
      "LIVE_ROLLOUT_MISSING",
      "liveEvidence.rollout",
      "真实 rollout 证据仍缺失",
    );
  }
  if (!successE2E || !failureE2E) {
    addReason(
      reasons,
      "LIVE_E2E_MISSING",
      "liveEvidence",
      "真实成功/失败 E2E 证据仍缺失",
    );
  }
  if (!rollback) {
    addReason(
      reasons,
      "ROLLBACK_EVIDENCE_MISSING",
      "liveEvidence.rollback",
      "真实回滚演练证据仍缺失",
    );
  }
  return { rollout, successE2E, failureE2E, rollback };
}

export function buildPredeployStoplightReport(input) {
  const root = safeJsonClone(requireRecord(input, "$"), "$", new WeakSet());
  const blockingReasons = [];
  const openspec = normalizeOpenspec(root.openspec, blockingReasons);
  const commitScope = normalizeCommitScope(root.commitScope, blockingReasons);
  const graphify = normalizeGraphify(root.graphify);
  const authorization = normalizeAuthorization(root.authorization, blockingReasons);
  const preflight = normalizePreflight(root.preflight, blockingReasons);
  const finalEvidence = normalizeFinalEvidence(root.finalEvidence, blockingReasons);
  const liveEvidence = normalizeLiveEvidence(root.liveEvidence, blockingReasons);

  return {
    schemaVersion: 1,
    purpose: "onchain-research-escrow-predeploy-stoplight",
    readyToDeploy: false,
    broadcastAllowed: false,
    goalCompleteAllowed: false,
    safety: { ...SAFETY },
    openspec,
    commitScope,
    graphify,
    authorization,
    preflight,
    finalEvidence,
    liveEvidence,
    blockingReasons,
  };
}

export async function runCli(argv = process.argv, streams = process, inputText = undefined) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const stdin = readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail);
    const text = typeof inputText === "string" ? inputText : await readCliStdin(stdin, fail);
    const input = JSON.parse(text);
    const report = buildPredeployStoplightReport(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return 0;
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    if (error instanceof PredeployStoplightError) {
      writeCliStream(stderr, `${error.code} ${error.path}\n`, "streams.stderr", fail);
      return 1;
    }
    writeCliStream(stderr, "PREDEPLOY_STOPLIGHT_FAILED input\n", "streams.stderr", fail);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
