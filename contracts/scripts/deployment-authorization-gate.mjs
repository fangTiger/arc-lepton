import { createHash } from "node:crypto";

export const DEPLOYMENT_AUTHORIZATION_REQUEST_SCHEMA_VERSION = 1;
export const DEPLOYMENT_AUTHORIZATION_RESULT_SCHEMA_VERSION = 1;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const AUTHORIZATION_RECORD_FIELDS = new Set([
  "stage",
  "chainId",
  "commit",
  "requestDigest",
  "approved",
  "approvedAt",
  "operator",
]);

export class DeploymentAuthorizationGateError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentAuthorizationGateError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentAuthorizationGateError(code, path, message);
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

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail("ARRAY_INVALID", path, `${path} 必须是数组`);
  }
  return value;
}

function requireNonEmptyArray(value, path) {
  const array = requireArray(value, path);
  if (array.length === 0) {
    fail("ARRAY_EMPTY", path, `${path} 不得为空`);
  }
  return array;
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

function requireTrue(value, path) {
  if (value !== true) {
    fail("BOOLEAN_TRUE_REQUIRED", path, `${path} 必须显式为 true`);
  }
  return true;
}

function requireInteger(value, path) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("INTEGER_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function requireDigest(value, path) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    fail("DIGEST_INVALID", path, `${path} 必须是 sha256:<64 hex>`);
  }
  return value;
}

function requireIsoDateTime(value, path) {
  const text = requireNonEmptyString(value, path);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    fail("DATETIME_INVALID", path, `${path} 必须是可解析的 ISO 时间`);
  }
  return text;
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
    const descriptor = descriptors[String(index)];
    const item = requireDataDescriptor(descriptor, itemPath);
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneStable(value) {
  return sortedJsonValue(value);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim() !== ""))]
    .sort();
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireOnlyAuthorizationRecordFields(value) {
  for (const key of Object.keys(value)) {
    if (!AUTHORIZATION_RECORD_FIELDS.has(key)) {
      fail(
        "AUTHORIZATION_FIELD_UNEXPECTED",
        propertyPath("authorization", key),
        `${propertyPath("authorization", key)} 不是允许持久化的授权证明字段`,
      );
    }
  }
}

function normalizedRequestBody(request) {
  const body = { ...requireRecord(request, "request") };
  delete body.requestDigest;
  return cloneStable(body);
}

export function digestAuthorizationRequest(request) {
  const safeRequest = safeJsonClone(requireRecord(request, "request"), "request", new WeakSet());
  return `sha256:${sha256(stableStringify(normalizedRequestBody(safeRequest)))}`;
}

function normalizeTransactions(value, path) {
  return requireNonEmptyArray(value, path).map((transaction, index) => {
    if (typeof transaction === "string") {
      return requireNonEmptyString(transaction, `${path}[${index}]`);
    }
    return cloneStable(requireRecord(transaction, `${path}[${index}]`));
  });
}

function normalizeExpectedAddresses(value, path) {
  const addresses = requireRecord(value, path);
  return {
    factory: requireNonEmptyString(addresses.factory, `${path}.factory`),
    implementation: requireNonEmptyString(addresses.implementation, `${path}.implementation`),
    registry: requireNonEmptyString(addresses.registry, `${path}.registry`),
  };
}

function normalizeCoreArtifacts(value, path) {
  return requireNonEmptyArray(value, path)
    .map((artifact, index) => requireNonEmptyString(artifact, `${path}[${index}]`))
    .sort();
}

function normalizeSourceTransaction(transaction, path) {
  const args = requireRecord(transaction.args, `${path}.args`);
  return {
    target: requireNonEmptyString(transaction.target, `${path}.target`),
    to: requireNonEmptyString(transaction.to, `${path}.to`),
    function: requireNonEmptyString(transaction.function, `${path}.function`),
    args: cloneStable({
      active: requireBoolean(args.active, `${path}.args.active`),
      maxUnitPrice: requireNonEmptyString(args.maxUnitPrice, `${path}.args.maxUnitPrice`),
      payout: requireNonEmptyString(args.payout, `${path}.args.payout`),
      sourceId: requireNonEmptyString(args.sourceId, `${path}.args.sourceId`),
    }),
  };
}

function normalizeRoleTransaction(transaction, path) {
  return {
    target: requireNonEmptyString(transaction.target, `${path}.target`),
    to: requireNonEmptyString(transaction.to, `${path}.to`),
    action: requireNonEmptyString(transaction.action, `${path}.action`),
    role: requireNonEmptyString(transaction.role, `${path}.role`),
    account: requireNonEmptyString(transaction.account, `${path}.account`),
  };
}

function normalizeStage(stage, index, evidencePackage) {
  const path = `authorizationStages[${index}]`;
  const value = requireRecord(stage, path);
  const normalized = {
    schemaVersion: DEPLOYMENT_AUTHORIZATION_REQUEST_SCHEMA_VERSION,
    stage: requireNonEmptyString(value.stage, `${path}.stage`),
    requiresFreshUserAuthorization: requireTrue(
      value.requiresFreshUserAuthorization,
      `${path}.requiresFreshUserAuthorization`,
    ),
    chainId: requireInteger(value.chainId, `${path}.chainId`),
    commit: requireNonEmptyString(value.commit, `${path}.commit`),
    estimatedGas: requireNonEmptyString(value.estimatedGas, `${path}.estimatedGas`),
    maxUsdcUnits: requireNonEmptyString(value.maxUsdcUnits, `${path}.maxUsdcUnits`),
    transactions: normalizeTransactions(value.transactions, `${path}.transactions`),
  };

  if (typeof value.deployer === "string") {
    normalized.deployer = requireNonEmptyString(value.deployer, `${path}.deployer`);
  }
  if (typeof value.buyer === "string") {
    normalized.buyer = requireNonEmptyString(value.buyer, `${path}.buyer`);
  }
  if (typeof value.payout === "string") {
    normalized.payout = requireNonEmptyString(value.payout, `${path}.payout`);
  }

  if (normalized.stage === "deploy_core_contracts") {
    normalized.deployer = requireNonEmptyString(value.deployer, `${path}.deployer`);
    const foundryDeploy = requireRecord(evidencePackage.foundryDeploy, "foundryDeploy");
    normalized.expectedAddresses = normalizeExpectedAddresses(
      foundryDeploy.expectedAddresses,
      "foundryDeploy.expectedAddresses",
    );
    normalized.coreArtifacts = normalizeCoreArtifacts(
      foundryDeploy.coreArtifacts,
      "foundryDeploy.coreArtifacts",
    );
  }

  if (normalized.stage === "configure_sources_and_roles") {
    normalized.deployer = requireNonEmptyString(value.deployer, `${path}.deployer`);
    const sourceConfigurationChanges = [];
    const roleChanges = [];
    for (const [transactionIndex, transaction] of normalized.transactions.entries()) {
      const transactionPath = `${path}.transactions[${transactionIndex}]`;
      const transactionRecord = requireRecord(transaction, transactionPath);
      requireNonEmptyString(transactionRecord.to, `${transactionPath}.to`);
      if (hasOwn(transactionRecord, "function") || hasOwn(transactionRecord, "args")) {
        sourceConfigurationChanges.push(
          normalizeSourceTransaction(transactionRecord, transactionPath),
        );
      } else if (
        hasOwn(transactionRecord, "action")
        || hasOwn(transactionRecord, "role")
        || hasOwn(transactionRecord, "account")
      ) {
        roleChanges.push(normalizeRoleTransaction(transactionRecord, transactionPath));
      } else {
        fail(
          "TRANSACTION_KIND_INVALID",
          transactionPath,
          `${transactionPath} 必须是 source 配置或 role 变更交易`,
        );
      }
    }
    normalized.targetAddresses = uniqueSorted(
      [...sourceConfigurationChanges, ...roleChanges].map((transaction) => transaction.to),
    );
    if (normalized.targetAddresses.length === 0) {
      fail("ARRAY_EMPTY", `${path}.targetAddresses`, `${path}.targetAddresses 不得为空`);
    }
    normalized.roleChanges = roleChanges.map((transaction) => ({
      target: transaction.target,
      to: transaction.to,
      action: transaction.action,
      role: transaction.role,
      account: transaction.account,
    }));
    normalized.sourceConfigurationChanges = sourceConfigurationChanges;
  }

  if (normalized.stage === "smoke_usdc_spend") {
    normalized.buyer = requireNonEmptyString(value.buyer, `${path}.buyer`);
    normalized.payout = requireNonEmptyString(value.payout, `${path}.payout`);
    const manifest = requireRecord(evidencePackage.manifest, "manifest");
    const externalDependencies = requireArray(
      manifest.externalDependencies,
      "manifest.externalDependencies",
    );
    const usdcDependency = externalDependencies.find((dependency) =>
      isRecord(dependency)
      && dependency.type === "erc20"
      && dependency.projectDeployment === false);
    if (usdcDependency === undefined) {
      fail(
        "USDC_DEPENDENCY_MISSING",
        "manifest.externalDependencies",
        "manifest.externalDependencies 必须包含 projectDeployment=false 的 erc20 USDC 依赖",
      );
    }
    normalized.usdc = cloneStable({
      chainId: requireInteger(usdcDependency.chainId, "manifest.externalDependencies.usdc.chainId"),
      address: requireNonEmptyString(
        usdcDependency.address,
        "manifest.externalDependencies.usdc.address",
      ),
      decimals: requireInteger(usdcDependency.decimals, "manifest.externalDependencies.usdc.decimals"),
      authority: requireNonEmptyString(
        usdcDependency.authority,
        "manifest.externalDependencies.usdc.authority",
      ),
    });
    const foundryDeploy = requireRecord(evidencePackage.foundryDeploy, "foundryDeploy");
    const expectedAddresses = requireRecord(
      foundryDeploy.expectedAddresses,
      "foundryDeploy.expectedAddresses",
    );
    normalized.factory = requireNonEmptyString(
      expectedAddresses.factory,
      "foundryDeploy.expectedAddresses.factory",
    );
  }

  const request = cloneStable(normalized);
  return {
    ...request,
    requestDigest: digestAuthorizationRequest(request),
  };
}

export function buildAuthorizationRequests(evidencePackage) {
  const root = safeJsonClone(
    requireRecord(evidencePackage, "evidencePackage"),
    "evidencePackage",
    new WeakSet(),
  );
  const stages = requireNonEmptyArray(root.authorizationStages, "evidencePackage.authorizationStages");
  const requests = stages.map((stage, index) => normalizeStage(stage, index, root));
  const stageNames = requests.map((request) => request.stage);
  if (new Set(stageNames).size !== stageNames.length) {
    fail("STAGE_DUPLICATE", "evidencePackage.authorizationStages", "授权阶段不得重复");
  }
  return requests;
}

function normalizeRequestForValidation(request) {
  const value = requireRecord(request, "request");
  const digest = requireDigest(value.requestDigest, "request.requestDigest");
  const body = normalizedRequestBody(value);
  if (body.schemaVersion !== DEPLOYMENT_AUTHORIZATION_REQUEST_SCHEMA_VERSION) {
    fail("SCHEMA_VERSION_INVALID", "request.schemaVersion", "request schemaVersion 不受支持");
  }
  requireTrue(body.requiresFreshUserAuthorization, "request.requiresFreshUserAuthorization");
  requireNonEmptyString(body.stage, "request.stage");
  requireInteger(body.chainId, "request.chainId");
  requireNonEmptyString(body.commit, "request.commit");
  requireNonEmptyString(body.estimatedGas, "request.estimatedGas");
  requireNonEmptyString(body.maxUsdcUnits, "request.maxUsdcUnits");
  normalizeTransactions(body.transactions, "request.transactions");
  const recomputedDigest = digestAuthorizationRequest(body);
  if (digest !== recomputedDigest) {
    fail("REQUEST_DIGEST_INVALID", "request.requestDigest", "requestDigest 与 request 内容不一致");
  }
  return {
    ...body,
    requestDigest: digest,
  };
}

export function validateStageAuthorization(input) {
  const root = safeJsonClone(requireRecord(input, "$"), "$", new WeakSet());
  const { request, authorization } = root;
  const normalizedRequest = normalizeRequestForValidation(request);
  const value = requireRecord(authorization, "authorization");
  requireOnlyAuthorizationRecordFields(value);

  if (requireNonEmptyString(value.stage, "authorization.stage") !== normalizedRequest.stage) {
    fail("STAGE_MISMATCH", "authorization.stage", "授权阶段与请求阶段不一致");
  }
  if (requireInteger(value.chainId, "authorization.chainId") !== normalizedRequest.chainId) {
    fail("CHAIN_ID_MISMATCH", "authorization.chainId", "授权 chainId 与请求不一致");
  }
  if (requireNonEmptyString(value.commit, "authorization.commit") !== normalizedRequest.commit) {
    fail("COMMIT_MISMATCH", "authorization.commit", "授权 commit 与请求不一致");
  }
  if (requireDigest(value.requestDigest, "authorization.requestDigest")
    !== normalizedRequest.requestDigest) {
    fail("REQUEST_DIGEST_MISMATCH", "authorization.requestDigest", "授权 digest 与请求不一致");
  }
  requireTrue(value.approved, "authorization.approved");

  return {
    schemaVersion: DEPLOYMENT_AUTHORIZATION_RESULT_SCHEMA_VERSION,
    authorized: true,
    stage: normalizedRequest.stage,
    chainId: normalizedRequest.chainId,
    commit: normalizedRequest.commit,
    requestDigest: normalizedRequest.requestDigest,
    approvedAt: requireIsoDateTime(value.approvedAt, "authorization.approvedAt"),
    operator: requireNonEmptyString(value.operator, "authorization.operator"),
  };
}
