import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const ARC_TESTNET_CHAIN_ID = 5042002;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RAW_32_BYTE_SECRET_SHAPED = /^(?:0x)?[0-9a-fA-F]{64}$/;
const PUBLIC_SOURCE_ID_PATH_PATTERN =
  /^input(?:\.request)?\.sourceConfigurationChanges\[[0-9]+\]\.args\.sourceId$/u;
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

const SAFETY = Object.freeze({
  noBroadcast: true,
  noDeploy: true,
  noAutoStage: true,
  noAutoCommit: true,
  noSecrets: true,
  notAuthorizationRecord: true,
  notPreflightProof: true,
  notFinalManifestOrVerifierEvidence: true,
  stageAuthorizationReuseForbidden: true,
});

const STAGE_LABELS = Object.freeze({
  deploy_core_contracts: "部署 Registry、ResearchEscrow implementation 与 Factory",
  configure_sources_and_roles: "配置 source、grant/revoke 角色并移交权限",
  smoke_usdc_spend: "执行会花费 test USDC 的 smoke",
});

const PREFLIGHT_ITEMS = Object.freeze([
  ["cleanGitCommit", "clean Git commit"],
  ["compilerSettings", "compiler settings"],
  ["deployerBalance", "deployer balance"],
  ["factoryRegistrySafe", "Factory/Registry Safe code"],
  ["sourcePayout", "source payout"],
  ["fundingSigner", "funding signer"],
  ["intentSignerEoa", "intent signer EOA"],
  ["settler", "settler"],
  ["officialUsdc", "official USDC"],
  ["publicRpcFinalizedBlock", "public RPC finalized block"],
  ["secretHygiene", "secret hygiene"],
]);

export class DeploymentNextActionChecklistError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentNextActionChecklistError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentNextActionChecklistError(code, path, message);
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

function isArrayIndexKey(key, length) {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function allowsPublicBytes32Value(path) {
  return PUBLIC_SOURCE_ID_PATH_PATTERN.test(path);
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

function requireInteger(value, path) {
  if (!Number.isInteger(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("FIELD_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireDecimal(value, path) {
  const text = requireString(value, path);
  if (!DECIMAL_INTEGER_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是十进制整数`);
  }
  return text;
}

function requireDigest(value, path) {
  const text = requireString(value, path);
  if (!DIGEST_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是 sha256 digest`);
  }
  return text;
}

function requireAddress(value, path) {
  const text = requireString(value, path);
  if (!ADDRESS_PATTERN.test(text)) {
    fail("FIELD_INVALID", path, `${path} 必须是 EVM 地址`);
  }
  const normalized = text.toLowerCase();
  if (normalized === "0x0000000000000000000000000000000000000000") {
    fail("FIELD_INVALID", path, `${path} 不得为零地址`);
  }
  return normalized;
}

function requireArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("FIELD_INVALID", path, `${path} 必须是非空数组`);
  }
  return value;
}

function addBlocker(blockers, code, path, message) {
  blockers.push({ code, path, message });
}

function fieldPresent(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return value !== undefined && value !== null && value !== "";
}

function checklistItem(key, label, value) {
  return {
    key,
    label,
    required: true,
    present: fieldPresent(value),
  };
}

function exactAuthorizationReply(request) {
  return `我明确授权 stage=${request.stage} chainId=${request.chainId} commit=${request.commit} requestDigest=${request.requestDigest} estimatedGas=${request.estimatedGas} maxUsdcUnits=${request.maxUsdcUnits}`;
}

function normalizeCommonRequest(rawRequest) {
  const request = requireRecord(rawRequest, "request");
  const stage = requireString(request.stage, "request.stage");
  if (!Object.hasOwn(STAGE_LABELS, stage)) {
    fail("STAGE_UNSUPPORTED", "request.stage", `不支持的部署阶段：${stage}`);
  }
  const chainId = requireInteger(request.chainId, "request.chainId");
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("CHAIN_ID_UNSUPPORTED", "request.chainId", `chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }
  return {
    ...request,
    stage,
    chainId,
    commit: requireString(request.commit, "request.commit"),
    requestDigest: requireDigest(request.requestDigest, "request.requestDigest"),
    estimatedGas: requireDecimal(request.estimatedGas, "request.estimatedGas"),
    maxUsdcUnits: requireDecimal(request.maxUsdcUnits, "request.maxUsdcUnits"),
    transactions: requireArray(request.transactions, "request.transactions"),
  };
}

function normalizeStageSpecificRequest(request) {
  if (request.stage === "deploy_core_contracts") {
    const expectedAddresses = requireRecord(request.expectedAddresses, "request.expectedAddresses");
    return {
      ...request,
      deployer: requireAddress(request.deployer, "request.deployer"),
      expectedAddresses: {
        registry: requireAddress(expectedAddresses.registry, "request.expectedAddresses.registry"),
        implementation: requireAddress(
          expectedAddresses.implementation,
          "request.expectedAddresses.implementation",
        ),
        factory: requireAddress(expectedAddresses.factory, "request.expectedAddresses.factory"),
      },
    };
  }
  if (request.stage === "configure_sources_and_roles") {
    return {
      ...request,
      targetAddresses: requireArray(request.targetAddresses, "request.targetAddresses")
        .map((address, index) => requireAddress(address, `request.targetAddresses[${index}]`)),
      sourceConfigurationChanges: requireArray(
        request.sourceConfigurationChanges,
        "request.sourceConfigurationChanges",
      ),
      roleChanges: requireArray(request.roleChanges, "request.roleChanges"),
    };
  }
  const usdc = requireRecord(request.usdc, "request.usdc");
  const usdcChainId = requireInteger(usdc.chainId, "request.usdc.chainId");
  if (usdcChainId !== ARC_TESTNET_CHAIN_ID) {
    fail(
      "CHAIN_ID_UNSUPPORTED",
      "request.usdc.chainId",
      `USDC chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`,
    );
  }
  return {
    ...request,
    buyer: requireAddress(request.buyer, "request.buyer"),
    payout: requireAddress(request.payout, "request.payout"),
    factory: requireAddress(request.factory, "request.factory"),
    usdc: {
      address: requireAddress(usdc.address, "request.usdc.address"),
      chainId: usdcChainId,
      decimals: requireInteger(usdc.decimals, "request.usdc.decimals"),
    },
  };
}

function normalizeRequest(input) {
  const root = requireRecord(input, "input");
  const rawRequest = isRecord(root.request) ? root.request : root;
  return normalizeStageSpecificRequest(normalizeCommonRequest(rawRequest));
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

function normalizeAuthorization(root, request, blockers) {
  const explicitAuthorization = root.explicitAuthorization;
  const matched = explicitAuthorizationMatches(request, explicitAuthorization);
  const ambiguousApproval = optionalString(root.ambiguousApproval, "ambiguousApproval");
  const authorizationPackageDigest = optionalString(
    root.authorizationPackageDigest,
    "authorizationPackageDigest",
  );

  if (!matched) {
    addBlocker(
      blockers,
      "EXPLICIT_AUTHORIZATION_MISSING",
      "explicitAuthorization",
      "缺少与当前 stage/chainId/commit/requestDigest 完全匹配的明确授权",
    );
  }
  if (ambiguousApproval !== null) {
    addBlocker(
      blockers,
      "AMBIGUOUS_APPROVAL",
      "ambiguousApproval",
      "模糊同意不能替代当次明确授权",
    );
  }
  if (authorizationPackageDigest !== null) {
    addBlocker(
      blockers,
      "AUTHORIZATION_PACKAGE_NOT_APPROVAL",
      "authorizationPackageDigest",
      "authorization package 或 briefing 只能展示范围，不能作为用户授权记录",
    );
  }

  return {
    status: matched ? "explicit_authorization_matched" : "missing_explicit_authorization",
    explicitAuthorizationMatched: matched,
    authorizationPackageDigest,
    authorizationPackageIsApproval: false,
    ambiguousApprovalAccepted: false,
  };
}

function beforeAuthorizationChecklist(request) {
  const common = [
    checklistItem("exactAuthorizationReply", "exact authorization reply", exactAuthorizationReply(request)),
    checklistItem("chainId", "chainId", request.chainId),
    checklistItem("commit", "commit", request.commit),
    checklistItem("requestDigest", "requestDigest", request.requestDigest),
    checklistItem("transactions", "transactions", request.transactions),
    checklistItem("estimatedGas", "estimatedGas", request.estimatedGas),
    checklistItem("maxUsdcUnits", "maxUsdcUnits", request.maxUsdcUnits),
  ];
  if (request.stage === "deploy_core_contracts") {
    return [
      ...common,
      checklistItem("deployer", "deployer", request.deployer),
      checklistItem("expectedAddresses", "expected core addresses", request.expectedAddresses),
    ];
  }
  if (request.stage === "configure_sources_and_roles") {
    return [
      ...common,
      checklistItem("targetAddresses", "target addresses", request.targetAddresses),
      checklistItem(
        "sourceConfigurationChanges",
        "source configuration changes",
        request.sourceConfigurationChanges,
      ),
      checklistItem("roleChanges", "role changes", request.roleChanges),
    ];
  }
  return [
    ...common,
    checklistItem("buyer", "smoke buyer", request.buyer),
    checklistItem("payout", "smoke payout", request.payout),
    checklistItem("factory", "Factory", request.factory),
    checklistItem("usdc", "official USDC", request.usdc),
  ];
}

function afterAuthorizationPreflightChecklist(root) {
  const confirmations = isRecord(root.preflightConfirmations) ? root.preflightConfirmations : {};
  return PREFLIGHT_ITEMS.map(([key, label]) => ({
    key,
    label,
    required: true,
    present: key === "cleanGitCommit"
      ? root.cleanCommit === true
      : confirmations[key] === true,
  }));
}

function normalizePreflight(root, blockers) {
  const cleanCommit = root.cleanCommit === true;
  const proofDigest = optionalString(root.preflightProofDigest, "preflightProofDigest");
  if (!cleanCommit) {
    addBlocker(
      blockers,
      "CLEAN_COMMIT_MISSING",
      "cleanCommit",
      "尚未证明 clean commit",
    );
  }
  if (proofDigest === null) {
    addBlocker(
      blockers,
      "PREFLIGHT_PROOF_MISSING",
      "preflightProofDigest",
      "尚未取得授权后的 preflight 证明摘要",
    );
  } else {
    requireDigest(proofDigest, "preflightProofDigest");
  }
  return { cleanCommit, proofDigest };
}

function determineNextAction(authorization, preflight) {
  if (!authorization.explicitAuthorizationMatched) {
    return "request_explicit_authorization";
  }
  if (!preflight.cleanCommit || preflight.proofDigest === null) {
    return "run_authorized_preflight";
  }
  return "prepare_13_3_broadcast_request";
}

export function buildDeploymentNextActionChecklist(input) {
  assertJsonSafe(input, "input");
  const root = requireRecord(input, "input");
  const request = normalizeRequest(root);
  const blockers = [];
  const authorization = normalizeAuthorization(root, request, blockers);
  const preflight = normalizePreflight(root, blockers);
  addBlocker(
    blockers,
    "BROADCAST_REQUIRES_STAGE_BOUNDARY",
    "nextAction",
    "即使授权和 preflight 已匹配，真实广播仍需要进入 13.3 的阶段边界和最终人工核对",
  );

  return {
    schemaVersion: 1,
    change: "onchain-research-escrow",
    stage: request.stage,
    stageLabel: STAGE_LABELS[request.stage],
    chainId: request.chainId,
    commit: request.commit,
    requestDigest: request.requestDigest,
    exactAuthorizationReply: exactAuthorizationReply(request),
    nextAction: determineNextAction(authorization, preflight),
    broadcastAllowed: false,
    deployAllowed: false,
    goalCompleteAllowed: false,
    safety: { ...SAFETY },
    authorization,
    preflight,
    requiredBeforeAuthorization: beforeAuthorizationChecklist(request),
    requiredAfterAuthorizationPreflight: afterAuthorizationPreflightChecklist(root),
    blockers,
  };
}

async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    fail("FILE_READ_FAILED", "argv[2]", "无法读取 next action checklist JSON");
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail("JSON_INVALID", "input", "next action checklist JSON 格式无效");
  }
}

function normalizeCliError(error) {
  if (error instanceof DeploymentNextActionChecklistError) {
    return error;
  }
  return new DeploymentNextActionChecklistError(
    "UNEXPECTED_ERROR",
    "input",
    "deployment next action checklist 生成失败",
  );
}

export async function runCli(argv = process.argv, streams = process) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const filePath = argv[2];
    if (typeof filePath !== "string" || filePath.trim() === "") {
      fail("ARGUMENT_REQUIRED", "argv[2]", "必须提供公开 next action checklist JSON 文件路径");
    }
    const input = await readJsonFile(filePath);
    const output = buildDeploymentNextActionChecklist(input);
    writeCliStream(stdout, `${JSON.stringify(output, null, 2)}\n`, "streams.stdout", fail);
    return 0;
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    const normalized = normalizeCliError(error);
    writeCliStream(stderr, `${normalized.code} ${normalized.path}\n`, "streams.stderr", fail);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
