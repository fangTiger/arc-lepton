import {types} from "node:util";

const REQUEST_KEYS = [
  "requestFinal",
  "gitSnapshot",
  "localDigest",
  "rebuildIsolated",
  "writeTemporary",
  "writeFinal",
];
const GIT_SNAPSHOT_KEYS = ["headCommit", "statusPorcelain", "submoduleStatus"];
const ISOLATED_PROOF_KEYS = ["commit", "digest"];
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export class ArtifactPublicationGateError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArtifactPublicationGateError";
    this.code = code;
  }
}

function gateError(code) {
  return new ArtifactPublicationGateError(code);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * 只接受没有原型扩展、访问器或隐藏字段的普通数据记录，并通过 descriptor
 * 读取值，避免执行不可信 getter。
 */
function inspectExactDataRecord(value, expectedKeys) {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      return null;
    }

    const expected = Object.create(null);
    for (const key of expectedKeys) {
      expected[key] = true;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
      return null;
    }

    for (const key of ownKeys) {
      if (typeof key !== "string" || !hasOwn(expected, key)) {
        return null;
      }
    }

    const descriptors = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !hasOwn(descriptor, "value")
        || hasOwn(descriptor, "get")
        || hasOwn(descriptor, "set")
      ) {
        return null;
      }
      descriptors[key] = descriptor;
    }

    return descriptors;
  } catch {
    return null;
  }
}

function inspectRootRecord(value) {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      return null;
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !REQUEST_KEYS.includes(key)) {
        return null;
      }
    }
    return value;
  } catch {
    return null;
  }
}

function readOwnEnumerableDataValue(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || descriptor.enumerable !== true
      || !hasOwn(descriptor, "value")
      || hasOwn(descriptor, "get")
      || hasOwn(descriptor, "set")
    ) {
      return null;
    }
    return {value: descriptor.value};
  } catch {
    return null;
  }
}

function readExactDataRecord(value, expectedKeys) {
  const descriptors = inspectExactDataRecord(value, expectedKeys);
  if (descriptors === null) {
    return null;
  }

  const record = Object.create(null);
  for (const key of expectedKeys) {
    record[key] = descriptors[key].value;
  }
  return record;
}

function isCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function isDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function hasCleanSubmoduleStatus(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (value === "") {
    return true;
  }

  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length > 0 && lines.every((line) => line.startsWith(" "));
}

async function callCallback(callback, argument) {
  try {
    if (argument === undefined) {
      return await callback();
    }
    return await callback(argument);
  } catch {
    throw gateError("CALLBACK_FAILED");
  }
}

async function callRebuildCallback(callback, argument) {
  let output;
  try {
    output = callback(argument);
  } catch {
    throw gateError("CALLBACK_FAILED");
  }

  // 只 await 原生或跨 realm Promise；Promise Proxy 与任意 thenable 作为 proof
  // 继续走严格 plain-record 校验，因而不会触发其 then getter 或 trap。
  if (types.isPromise(output)) {
    try {
      output = await output;
    } catch {
      throw gateError("CALLBACK_FAILED");
    }
  }

  // 将输出包进普通对象，避免 async return 对恶意 proof 进行 thenable 同化。
  return {output};
}

/**
 * 对可发布 artifact 执行纯本地可复现性门禁。
 *
 * @param {object} request 注入 Git 快照、隔离重建与发布 callback 的请求。
 * @returns {Promise<object>} 冻结的 temporary 或 final 分类结果。
 */
export async function runArtifactPublicationGate(request) {
  const root = inspectRootRecord(request);
  const requestFinal = root === null ? null : readOwnEnumerableDataValue(root, "requestFinal");
  if (requestFinal === null || typeof requestFinal.value !== "boolean") {
    throw gateError("REQUEST_INVALID");
  }

  if (!requestFinal.value) {
    const writeTemporary = readOwnEnumerableDataValue(root, "writeTemporary");
    if (writeTemporary === null || typeof writeTemporary.value !== "function") {
      throw gateError("REQUEST_INVALID");
    }
    await callCallback(writeTemporary.value);
    return Object.freeze({classification: "temporary"});
  }

  const rebuildIsolated = readOwnEnumerableDataValue(root, "rebuildIsolated");
  const writeFinal = readOwnEnumerableDataValue(root, "writeFinal");
  if (
    rebuildIsolated === null
    || writeFinal === null
    || typeof rebuildIsolated.value !== "function"
    || typeof writeFinal.value !== "function"
  ) {
    throw gateError("REQUEST_INVALID");
  }

  const gitSnapshotInput = readOwnEnumerableDataValue(root, "gitSnapshot");
  const gitSnapshot = gitSnapshotInput === null
    ? null
    : readExactDataRecord(gitSnapshotInput.value, GIT_SNAPSHOT_KEYS);
  if (gitSnapshot === null) {
    throw gateError("GIT_COMMIT_INVALID");
  }

  if (!isCommit(gitSnapshot.headCommit)) {
    throw gateError("GIT_COMMIT_INVALID");
  }
  if (gitSnapshot.statusPorcelain !== "") {
    throw gateError("GIT_DIRTY");
  }
  if (!hasCleanSubmoduleStatus(gitSnapshot.submoduleStatus)) {
    throw gateError("GIT_SUBMODULE_DIRTY");
  }
  const localDigest = readOwnEnumerableDataValue(root, "localDigest");
  if (localDigest === null || !isDigest(localDigest.value)) {
    throw gateError("DIGEST_INVALID");
  }

  const rebuildRequest = Object.freeze({commit: gitSnapshot.headCommit});
  const rebuildResult = await callRebuildCallback(rebuildIsolated.value, rebuildRequest);
  const isolatedProof = readExactDataRecord(rebuildResult.output, ISOLATED_PROOF_KEYS);
  if (
    isolatedProof === null
    || !isCommit(isolatedProof.commit)
    || !isDigest(isolatedProof.digest)
  ) {
    throw gateError("ISOLATED_PROOF_INVALID");
  }
  if (
    isolatedProof.commit !== gitSnapshot.headCommit
    || isolatedProof.digest !== localDigest.value
  ) {
    throw gateError("ARTIFACT_MISMATCH");
  }

  const finalArtifact = Object.freeze({
    commit: gitSnapshot.headCommit,
    digest: localDigest.value,
  });
  await callCallback(writeFinal.value, finalArtifact);
  return Object.freeze({
    classification: "final",
    commit: gitSnapshot.headCommit,
    digest: localDigest.value,
  });
}
