import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const CHANGE_NAME = "onchain-research-escrow";
const TOTAL_TASKS = 107;
const COMPLETE_TASKS = 102;
const REMAINING_TASK_IDS = Object.freeze([
  "14.2",
  "14.3",
  "14.4",
  "14.7",
  "14.9",
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
  notLiveE2EOrRollbackEvidence: true,
  notTaskCompletionAuthority: true,
});

const SENSITIVE_TEXT =
  /(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._-]{12,}|mnemonic|credentialed-rpc|credentialed_rpc)/i;

export class RemainingTaskEvidenceMatrixError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "RemainingTaskEvidenceMatrixError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new RemainingTaskEvidenceMatrixError(code, path, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectJsonLike(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (SENSITIVE_TEXT.test(value)) {
      fail("SENSITIVE_VALUE_REJECTED", path, `${path} 包含敏感形态字段，已拒绝且不回显原值`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      fail("INPUT_INVALID", path, `${path} 不得循环引用`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined) {
        fail("INPUT_INVALID", `${path}[${index}]`, `${path}[${index}] 不得为空洞`);
      }
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        fail("INPUT_INVALID", `${path}[${index}]`, `${path}[${index}] 必须是可枚举 data property`);
      }
      inspectJsonLike(descriptor.value, `${path}[${index}]`, seen);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
    }
    seen.delete(value);
    return value;
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("INPUT_INVALID", path, `${path} 不得包含 symbol key`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const childPath = `${path}.${key}`;
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      fail("INPUT_INVALID", childPath, `${childPath} 必须是可枚举 data property`);
    }
    inspectJsonLike(descriptor.value, childPath, seen);
  }
  seen.delete(value);
  return value;
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

function requireInteger(value, path) {
  if (!Number.isInteger(value)) {
    fail("FIELD_INVALID", path, `${path} 必须是整数`);
  }
  return value;
}

function bool(value) {
  return value === true;
}

function normalizeOpenspec(root) {
  const openspec = requireRecord(root.openspec, "openspec");
  const change = requireString(openspec.change, "openspec.change");
  const totalTasks = requireInteger(openspec.totalTasks, "openspec.totalTasks");
  const completeTasks = requireInteger(openspec.completeTasks, "openspec.completeTasks");
  const remainingTaskIds = openspec.remainingTaskIds;

  if (change !== CHANGE_NAME || totalTasks !== TOTAL_TASKS || completeTasks !== COMPLETE_TASKS) {
    fail(
      "OPENSPEC_PROGRESS_MISMATCH",
      "openspec",
      "OpenSpec 进度必须匹配当前 onchain-research-escrow 102/107 状态",
    );
  }
  if (!Array.isArray(remainingTaskIds)) {
    fail("FIELD_INVALID", "openspec.remainingTaskIds", "openspec.remainingTaskIds 必须是数组");
  }
  const sortedActual = [...remainingTaskIds].sort();
  const sortedExpected = [...REMAINING_TASK_IDS].sort();
  const matches = sortedActual.length === sortedExpected.length
    && sortedActual.every((id, index) => id === sortedExpected[index])
    && new Set(remainingTaskIds).size === remainingTaskIds.length;
  if (!matches) {
    fail(
      "REMAINING_TASKS_MISMATCH",
      "openspec.remainingTaskIds",
      "remainingTaskIds 必须精确匹配当前 5 个未完成任务",
    );
  }
  return { change, totalTasks, completeTasks, remainingTaskIds: [...REMAINING_TASK_IDS] };
}

function readinessEvidence(evidence) {
  const accepted = [];
  if (typeof evidence.authorizationPackageDigest === "string" && evidence.authorizationPackageDigest !== "") {
    accepted.push("authorization package digest is readiness only");
  }
  if (bool(evidence.deploymentAuthorizationHandoff)) {
    accepted.push("deployment authorization handoff is readiness only");
  }
  if (bool(evidence.deploymentNextActionChecklist)) {
    accepted.push("deployment next-action checklist is readiness only");
  }
  if (bool(evidence.predeployStoplight)) {
    accepted.push("predeploy stoplight report is readiness only");
  }
  if (bool(evidence.specScenarioAudit)) {
    accepted.push("spec scenario audit document exists");
  }
  if (isRecord(evidence.graphify) && bool(evidence.graphify.rebuiltAfterLastCodeChange)) {
    accepted.push("Graphify rebuilt after latest local code change");
  }
  return accepted;
}

function presentEvidence(evidence, key) {
  return bool(evidence[key]);
}

function makeTask(id, classification, authoritativeEvidenceRequired, readiness, checks) {
  const missingEvidence = checks
    .filter((check) => !check.ok)
    .map((check) => check.label);
  const authoritativeEvidenceSatisfied = missingEvidence.length === 0;
  return {
    id,
    classification,
    authoritativeEvidenceSatisfied,
    canMarkComplete: false,
    authoritativeEvidenceRequired,
    readinessEvidenceAccepted: [...readiness],
    missingEvidence,
  };
}

function buildTasks(evidence, readiness) {
  const tasks = [];

  tasks.push(makeTask(
    "14.2",
    "live_rollout_required",
    [
      "真实 DB expand/backfill、durable worker 与监控部署",
      "funding UI 开启与小流量 escrow backend 切换证据",
    ],
    readiness,
    [
      { ok: presentEvidence(evidence, "rolloutDeployment"), label: "缺少真实 rollout deployment / funding UI / escrow backend 切流证据" },
    ],
  ));

  tasks.push(makeTask(
    "14.3",
    "live_e2e_required",
    [
      "真实成功 E2E：prepare/quota、非零资助、激活、最多三次 intent、settlement、TX feed、close/refund/excess",
    ],
    readiness,
    [
      { ok: presentEvidence(evidence, "successE2E"), label: "缺少成功 E2E 证据" },
    ],
  ));

  tasks.push(makeTask(
    "14.4",
    "live_e2e_required",
    [
      "真实失败 E2E：拒签、账户变化、错误网络、funding_expired、短 TTL、Registry revision、worker/RPC/DB 失败、到期退出",
    ],
    readiness,
    [
      { ok: presentEvidence(evidence, "failureE2E"), label: "缺少失败 E2E 证据" },
    ],
  ));

  const authoritativeEvidenceSatisfiedById = new Map(tasks.map((task) => [
    task.id,
    task.authoritativeEvidenceSatisfied,
  ]));

  tasks.push(makeTask(
    "14.7",
    "cross_spec_audit_blocked",
    [
      "六份 delta spec 逐场景核验证据",
      "14.2–14.4、14.9 均已有 authoritative evidence",
      "OpenSpec strict validate 通过",
    ],
    readiness,
    [
      { ok: bool(evidence.specScenarioAudit), label: "缺少 spec scenario audit 文档" },
      ...["14.2", "14.3", "14.4"].map((id) => ({
        ok: authoritativeEvidenceSatisfiedById.get(id) === true,
        label: `缺少 ${id} authoritative evidence completion`,
      })),
      { ok: presentEvidence(evidence, "rollbackDrill"), label: "缺少 14.9 rollback drill evidence" },
      { ok: presentEvidence(evidence, "openspecStrictValidate"), label: "缺少 OpenSpec strict validate 最新通过证据" },
    ],
  ));

  tasks.push(makeTask(
    "14.9",
    "rollback_drill_required",
    [
      "真实 rollback drill：停止新 voucher/activation、切回 calldata/mock",
      "已 Funded 可取消、已 Active 继续 settlement/close 或到期退出证据",
    ],
    readiness,
    [
      { ok: presentEvidence(evidence, "rollbackDrill"), label: "缺少 rollback drill evidence" },
    ],
  ));

  return tasks;
}

export function buildRemainingTaskEvidenceMatrix(input) {
  inspectJsonLike(input, "input");
  const root = requireRecord(input, "input");
  const openspec = normalizeOpenspec(root);
  const evidence = requireRecord(root.evidence, "evidence");
  const readiness = readinessEvidence(evidence);
  const tasks = buildTasks(evidence, readiness);
  const completeNow = tasks.filter((task) => task.canMarkComplete).length;
  const authoritativeEvidenceSatisfiedCount = tasks
    .filter((task) => task.authoritativeEvidenceSatisfied).length;
  const readinessOnlyCount = tasks.filter((task) => task.readinessEvidenceAccepted.length > 0 && !task.canMarkComplete).length;
  const blockedCount = tasks.filter((task) => !task.canMarkComplete).length;

  return {
    openspec,
    summary: {
      totalRemaining: tasks.length,
      completeNow,
      authoritativeEvidenceSatisfiedCount,
      readinessOnlyCount,
      blockedCount,
    },
    tasks,
    safety: { ...SAFETY },
    goalCompleteAllowed: false,
  };
}

export async function runCli(_argv, streams, stdinText) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const stdin = readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail);
    const text = stdinText ?? await readCliStdin(stdin, fail);
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      fail("JSON_INVALID", "stdin", "stdin 必须是合法 JSON");
    }
    const report = buildRemainingTaskEvidenceMatrix(input);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return 0;
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    if (error instanceof RemainingTaskEvidenceMatrixError) {
      writeCliStream(stderr, `${JSON.stringify({
        error: {
          name: error.name,
          code: error.code,
          path: error.path,
          message: error.message,
        },
      })}\n`, "streams.stderr", fail);
      return 1;
    }
    writeCliStream(stderr, `${JSON.stringify({
      error: {
        name: "RemainingTaskEvidenceMatrixError",
        code: "UNEXPECTED",
        path: "unknown",
        message: "发生未预期错误",
      },
    })}\n`, "streams.stderr", fail);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv, process).then((code) => {
    process.exitCode = code;
  });
}
