import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DeploymentArtifactSecurityError,
  scanPublicDeploymentArtifact,
} from "./deployment-evidence-package.mjs";
import {
  DeploymentAuthorizationGateError,
  buildAuthorizationRequests,
} from "./deployment-authorization-gate.mjs";
import {
  DeploymentAuthorizationBriefingError,
  buildAuthorizationBriefing,
} from "./deployment-authorization-briefing.mjs";
import {
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const EXPECTED_STAGE_ORDER = [
  "deploy_core_contracts",
  "configure_sources_and_roles",
  "smoke_usdc_spend",
];

export class DeploymentAuthorizationPackageError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentAuthorizationPackageError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentAuthorizationPackageError(code, path, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) {
    fail("RECORD_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("STRING_INVALID", path, `${path} 必须是非空字符串`);
  }
  return value;
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

function stableStringify(value) {
  return JSON.stringify(sortedJsonValue(value));
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeKnownError(error) {
  if (error instanceof DeploymentAuthorizationPackageError) {
    return error;
  }
  if (
    error instanceof DeploymentArtifactSecurityError
    || error instanceof DeploymentAuthorizationGateError
    || error instanceof DeploymentAuthorizationBriefingError
  ) {
    return new DeploymentAuthorizationPackageError(
      error.code,
      error.path,
      "deployment authorization package 生成失败",
    );
  }
  if (
    error !== null
    && typeof error === "object"
    && typeof error.code === "string"
    && typeof error.path === "string"
  ) {
    return new DeploymentAuthorizationPackageError(
      error.code,
      error.path,
      "deployment authorization package 生成失败",
    );
  }
  return new DeploymentAuthorizationPackageError(
    "UNEXPECTED_ERROR",
    "input",
    "deployment authorization package 生成失败",
  );
}

function assertStageOrder(stageOrder) {
  if (
    stageOrder.length !== EXPECTED_STAGE_ORDER.length
    || stageOrder.some((stage, index) => stage !== EXPECTED_STAGE_ORDER[index])
  ) {
    fail(
      "STAGE_ORDER_INVALID",
      "requests",
      "授权 package 必须按 deploy/configure/smoke 三阶段顺序生成",
    );
  }
}

function exactAuthorizationReply(request) {
  return `我明确授权 stage=${request.stage} chainId=${request.chainId} commit=${request.commit} requestDigest=${request.requestDigest} estimatedGas=${request.estimatedGas} maxUsdcUnits=${request.maxUsdcUnits}`;
}

export function buildDeploymentAuthorizationPackage(input) {
  try {
    const evidencePackage = safeJsonClone(
      requireRecord(input, "evidencePackage"),
      "evidencePackage",
      new WeakSet(),
    );
    const securityScan = scanPublicDeploymentArtifact(evidencePackage);
    const requests = buildAuthorizationRequests(evidencePackage);
    const stageOrder = requests.map((request) => request.stage);
    assertStageOrder(stageOrder);

    const exactAuthorizationReplies = Object.fromEntries(
      requests.map((request) => [request.stage, exactAuthorizationReply(request)]),
    );
    const briefings = Object.fromEntries(
      requests.map((request) => [request.stage, buildAuthorizationBriefing(request)]),
    );
    const manifestPublication = requireRecord(
      evidencePackage.manifestPublication,
      "evidencePackage.manifestPublication",
    );
    const manifestDigest = requireString(
      manifestPublication.digest,
      "evidencePackage.manifestPublication.digest",
    );

    const packageWithoutDigest = {
      schemaVersion: 1,
      chainId: evidencePackage.chainId,
      commit: requireString(evidencePackage.commit, "evidencePackage.commit"),
      deployer: requireString(evidencePackage.deployer, "evidencePackage.deployer"),
      manifestDigest,
      authorizationBoundaryTask: "13.1",
      nextStage: "deploy_core_contracts",
      stageOrder,
      safety: {
        externalWritesAuthorized: false,
        broadcastAllowed: false,
        requiresFreshUserAuthorization: true,
        notAuthorizationRecord: true,
        notPreflightProof: true,
        notFinalManifestOrVerifierEvidence: true,
        stageAuthorizationReuseAllowed: false,
        noResponseOrAmbiguousApprovalStops: true,
        inputChangeRequiresNewAuthorization: true,
        authorizedStages: [],
        stageReuseForbidden: {
          deploy_core_contracts: ["configure_sources_and_roles", "smoke_usdc_spend"],
          configure_sources_and_roles: ["deploy_core_contracts", "smoke_usdc_spend"],
          smoke_usdc_spend: ["deploy_core_contracts", "configure_sources_and_roles"],
        },
        note: "此 package 只用于向用户展示授权范围；不能替代当次明确授权，不能替代 13.2 preflight 通过证明，不能替代最终 manifest/verifier 公开部署证据；不得跨阶段复用授权。用户未回应或模糊同意时必须停止；request/commit/address/gas/maxUsdcUnits 改变后必须重新授权。",
      },
      exactAuthorizationReplies,
      requests,
      briefings,
      evidence: {
        manifestPublication,
        securityScan,
      },
    };
    return {
      ...packageWithoutDigest,
      packageDigest: sha256Digest(stableStringify(packageWithoutDigest)),
    };
  } catch (error) {
    throw normalizeKnownError(error);
  }
}

async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    fail("FILE_READ_FAILED", "argv[2]", "无法读取 deployment authorization evidence JSON");
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail("JSON_INVALID", "input", "deployment authorization evidence JSON 格式无效");
  }
}

export async function runCli(argv = process.argv, streams = process) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const filePath = argv[2];
    if (typeof filePath !== "string" || filePath.trim() === "") {
      fail("ARGUMENT_REQUIRED", "argv[2]", "必须提供公开 deployment evidence package JSON 文件路径");
    }
    const evidencePackage = await readJsonFile(filePath);
    const output = buildDeploymentAuthorizationPackage(evidencePackage);
    writeCliStream(stdout, `${JSON.stringify(output, null, 2)}\n`, "streams.stdout", fail);
    return 0;
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const normalized = normalizeKnownError(error);
    writeCliStream(stderr, `${normalized.code} ${normalized.path}\n`, "streams.stderr", fail);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
