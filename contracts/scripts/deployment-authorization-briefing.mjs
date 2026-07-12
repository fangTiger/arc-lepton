import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CREDENTIAL_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const SECRET_FIELD_PATTERN =
  /(?:private[-_]?key|mnemonic|keystore|secret|provider[-_]?key|api[-_]?key|auth[-_]?token|access[-_]?token|bearer|password|full[-_]?env|environment)$/i;
const SIGNATURE_FIELD_PATTERN = /(?:^|[.[\]_ -])(?:signature|rawsignature|signedpayload)(?:$|[.[\]_ -])/i;
const RAW_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

export class DeploymentAuthorizationBriefingError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentAuthorizationBriefingError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentAuthorizationBriefingError(code, path, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isArrayIndexKey(key, length) {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
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

function requireInteger(value, path) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail("INTEGER_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function lastPathSegment(path) {
  const segments = String(path).split(/[.[\]]/).filter(Boolean);
  return segments.at(-1) ?? path;
}

function scanPublicString(value, path) {
  const segment = lastPathSegment(path);
  if (SIGNATURE_FIELD_PATTERN.test(segment) && RAW_SIGNATURE_PATTERN.test(value)) {
    fail("RAW_SIGNATURE", path, `${path} 不得包含可重放原始签名`);
  }
  if (CREDENTIAL_URL_PATTERN.test(value)) {
    fail("CREDENTIAL_URL", path, `${path} 不得包含带凭据 URL`);
  }
  if (/^(?:sk|pk|rk|ghp|github_pat)-[A-Za-z0-9_=-]{8,}/.test(value)) {
    fail("PROVIDER_KEY", path, `${path} 不得包含 provider key`);
  }
}

function scanPublicArray(value, path, seen) {
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
    scanPublicRequest(descriptor.value, childPath, seen);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length" || isArrayIndexKey(key, value.length)) {
      continue;
    }
    fail("INPUT_INVALID", `${path}.${key}`, `${path}.${key} 不得包含数组索引以外的额外属性`);
  }
  seen.delete(value);
}

function scanPublicRecord(value, path, seen) {
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
      fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
    }
    if (SECRET_FIELD_PATTERN.test(key)) {
      fail("SECRET_FIELD", childPath, `${childPath} 不得出现在公开授权 briefing 输入中`);
    }
    scanPublicRequest(descriptor.value, childPath, seen);
  }
  seen.delete(value);
}

function scanPublicRequest(value, path = "$", seen = new WeakSet()) {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INPUT_INVALID", path, `${path} 必须是有限 JSON number`);
    }
    return;
  }
  if (typeof value === "string") {
    scanPublicString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    scanPublicArray(value, path, seen);
    return;
  }
  if (!isRecord(value)) {
    fail("INPUT_INVALID", path, `${path} 只能包含 JSON-like 数据`);
    return;
  }
  scanPublicRecord(value, path, seen);
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function formatTransaction(transaction) {
  if (typeof transaction === "string") {
    return transaction;
  }
  if (!isRecord(transaction)) {
    return String(transaction);
  }
  const parts = [];
  for (const key of ["target", "to", "function", "action", "role", "account"]) {
    if (transaction[key] !== undefined) {
      parts.push(`${key}: ${transaction[key]}`);
    }
  }
  if (isRecord(transaction.args)) {
    parts.push(`args: ${JSON.stringify(transaction.args)}`);
  }
  return parts.join(", ");
}

function exactAuthorizationReplyLines(request) {
  const stage = requireString(request.stage, "request.stage");
  const chainId = requireInteger(request.chainId, "request.chainId");
  const commit = requireString(request.commit, "request.commit");
  const requestDigest = requireString(request.requestDigest, "request.requestDigest");
  const estimatedGas = requireString(request.estimatedGas, "request.estimatedGas");
  const maxUsdcUnits = requireString(request.maxUsdcUnits, "request.maxUsdcUnits");
  return [
    "## 精确授权回复模板",
    "",
    "- 请复制下面整句作为当前会话中的授权回复；这不是命令，也不会自行执行任何链上写入。",
    `我明确授权 stage=${stage} chainId=${chainId} commit=${commit} requestDigest=${requestDigest} estimatedGas=${estimatedGas} maxUsdcUnits=${maxUsdcUnits}`,
    "",
    "## 精确授权边界",
    "",
    "- briefing/模板/CLI 输出本身不是授权记录。",
    "- 只有用户在当前会话中针对同一字段回复精确授权，才能进入下一步。",
    "- 任何字段变化都要重新生成并重新授权。",
  ];
}

function commonLines(request) {
  return [
    `# 授权请求 briefing：${requireString(request.stage, "request.stage")}`,
    "",
    `- stage: ${request.stage}`,
    `- chainId ${requireInteger(request.chainId, "request.chainId")}`,
    `- commit: ${requireString(request.commit, "request.commit")}`,
    `- requestDigest: ${requireString(request.requestDigest, "request.requestDigest")}`,
    `- estimatedGas: ${requireString(request.estimatedGas, "request.estimatedGas")}`,
    `- maxUsdcUnits: ${requireString(request.maxUsdcUnits, "request.maxUsdcUnits")}`,
    "",
    ...exactAuthorizationReplyLines(request),
    "",
    "## 预计交易/动作",
    "",
    bulletList(requireArray(request.transactions, "request.transactions").map(formatTransaction)),
    "",
    "## 通用边界",
    "",
    "- 未获得用户对本 stage 的明确回复前，不得 --broadcast。",
    "- 参数变化需要重新授权，包括 chain、commit、地址、角色差异、calldata、estimatedGas、maxUsdcUnits 或 requestDigest。",
  ];
}

function deployCoreLines(request) {
  const expectedAddresses = requireRecord(request.expectedAddresses, "request.expectedAddresses");
  const coreArtifacts = requireArray(request.coreArtifacts, "request.coreArtifacts")
    .map((artifact, index) => requireString(artifact, `request.coreArtifacts[${index}]`));
  return [
    "## deploy_core_contracts 范围",
    "",
    `- deployer: ${requireString(request.deployer, "request.deployer")}`,
    "- expectedAddresses:",
    `  - registry: ${requireString(expectedAddresses.registry, "request.expectedAddresses.registry")}`,
    `  - implementation: ${requireString(expectedAddresses.implementation, "request.expectedAddresses.implementation")}`,
    `  - factory: ${requireString(expectedAddresses.factory, "request.expectedAddresses.factory")}`,
    "- coreArtifacts:",
    ...coreArtifacts.map((artifact) => `  - ${artifact}`),
    "- 只授权核心部署与 bindFactory。",
    "- 不授权 source/role/smoke。",
  ];
}

function configureLines(request) {
  const targetAddresses = requireArray(request.targetAddresses, "request.targetAddresses")
    .map((address, index) => requireString(address, `request.targetAddresses[${index}]`));
  const sourceChanges = requireArray(
    request.sourceConfigurationChanges,
    "request.sourceConfigurationChanges",
  ).map(formatTransaction);
  const roleChanges = requireArray(request.roleChanges, "request.roleChanges").map(formatTransaction);
  return [
    "## configure_sources_and_roles 范围",
    "",
    `- deployer: ${requireString(request.deployer, "request.deployer")}`,
    `- targetAddresses: ${targetAddresses.join(", ")}`,
    "- sourceConfigurationChanges:",
    ...sourceChanges.map((change) => `  - ${change}`),
    "- roleChanges:",
    ...roleChanges.map((change) => `  - ${change}`),
    "- 不得复用部署授权。",
    "- 不授权 test USDC smoke。",
  ];
}

function smokeLines(request) {
  const usdc = requireRecord(request.usdc, "request.usdc");
  return [
    "## smoke_usdc_spend 范围",
    "",
    `- buyer: ${requireString(request.buyer, "request.buyer")}`,
    `- payout: ${requireString(request.payout, "request.payout")}`,
    `- factory: ${requireString(request.factory, "request.factory")}`,
    "- usdc:",
    `  - address: ${requireString(usdc.address, "request.usdc.address")}`,
    `  - authority: ${requireString(usdc.authority, "request.usdc.authority")}`,
    `  - chainId: ${requireInteger(usdc.chainId, "request.usdc.chainId")}`,
    `  - decimals: ${requireInteger(usdc.decimals, "request.usdc.decimals")}`,
    "- 需要单独 test USDC 授权。",
    "- direct EOA/no AA/no paymaster 边界由操作者另行确认。",
  ];
}

export function buildAuthorizationBriefing(input) {
  scanPublicRequest(input, "request");
  const request = requireRecord(input, "request");

  const lines = commonLines(request);
  if (request.stage === "deploy_core_contracts") {
    lines.push("", ...deployCoreLines(request));
  } else if (request.stage === "configure_sources_and_roles") {
    lines.push("", ...configureLines(request));
  } else if (request.stage === "smoke_usdc_spend") {
    lines.push("", ...smokeLines(request));
  } else {
    fail("STAGE_UNSUPPORTED", "request.stage", `不支持的授权阶段：${request.stage}`);
  }
  return `${lines.join("\n")}\n`;
}

function requestsFromInput(input) {
  scanPublicRequest(input, "input");
  const root = requireRecord(input, "input");
  if (Object.hasOwn(root, "requests")) {
    return requireArray(root.requests, "input.requests").map((request, index) =>
      requireRecord(request, `input.requests[${index}]`),
    );
  }
  return [root];
}

export function buildAuthorizationBriefings(input) {
  return requestsFromInput(input)
    .map((request) => buildAuthorizationBriefing(request))
    .join("\n---\n\n");
}

async function readJsonFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    fail("FILE_READ_FAILED", "argv[2]", "无法读取授权 briefing JSON 文件");
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail("JSON_INVALID", "input", "授权 briefing JSON 格式无效");
  }
}

function normalizeCliError(error) {
  if (error instanceof DeploymentAuthorizationBriefingError) {
    return error;
  }
  return new DeploymentAuthorizationBriefingError(
    "UNEXPECTED_ERROR",
    "input",
    "授权 briefing CLI 失败",
  );
}

export async function runCli(argv = process.argv, streams = process) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const filePath = argv[2];
    if (typeof filePath !== "string" || filePath.trim() === "") {
      fail("ARGUMENT_REQUIRED", "argv[2]", "必须提供公开授权 request JSON 文件路径");
    }
    const input = await readJsonFile(filePath);
    writeCliStream(stdout, buildAuthorizationBriefings(input), "streams.stdout", fail);
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
