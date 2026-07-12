import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const expected = Object.freeze({
  foundryFileVersion: "1.5.1",
  foundryRuntimeVersion: "1.5.1-stable",
  foundryCommit: "b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2",
  solidityVersion: "0.8.30",
  evmVersion: "prague",
  optimizerEnabled: true,
  optimizerRuns: 200,
  viaIR: false,
  metadataBytecodeHash: "ipfs",
  metadataUseLiteralContent: false,
  metadataAppendCBOR: true,
  remappings: ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"],
  openZeppelinTag: "v5.6.1",
  openZeppelinRevision: "5fd1781b1454fd1ef8e722282f86f9293cacf256",
});

function sortedJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedJsonValue(value[key])]),
    );
  }
  return value;
}

function stableStringify(value, space) {
  return JSON.stringify(sortedJsonValue(value), null, space);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    throw new Error(`${label} 不一致：期望 ${JSON.stringify(expectedValue)}，实际 ${JSON.stringify(actual)}`);
  }
}

function assertJsonArrayEqual(actual, expectedValue, label) {
  if (!Array.isArray(actual) || stableStringify(actual) !== stableStringify(expectedValue)) {
    throw new Error(`${label} 不一致：期望 ${stableStringify(expectedValue)}，实际 ${stableStringify(actual)}`);
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
}

function toolingRequestInvalid(path, message) {
  throw new Error(`tooling request ${path} ${message}`);
}

function requireToolingOptionsDescriptors(options) {
  if (options === undefined) {
    return {};
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    toolingRequestInvalid("$", "必须是 plain object");
  }

  let prototype;
  let symbols;
  let descriptors;
  let ownNames;
  let enumerableKeys;
  try {
    prototype = Object.getPrototypeOf(options);
    symbols = Object.getOwnPropertySymbols(options);
    descriptors = Object.getOwnPropertyDescriptors(options);
    ownNames = Object.getOwnPropertyNames(options);
    enumerableKeys = Object.keys(options);
  } catch {
    toolingRequestInvalid("$", "必须可静态枚举");
  }

  if (prototype !== Object.prototype) {
    toolingRequestInvalid("$", "必须是 plain object");
  }
  if (symbols.length !== 0) {
    toolingRequestInvalid("$", "不得包含 symbol key");
  }
  if (ownNames.length !== enumerableKeys.length) {
    toolingRequestInvalid("$", "只能包含可枚举 data property");
  }
  for (const key of enumerableKeys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      toolingRequestInvalid(`$.${key}`, "只能是可枚举 data property");
    }
  }
  return descriptors;
}

function readToolingOption(descriptors, key, fallback) {
  const descriptor = descriptors[key];
  if (descriptor === undefined || descriptor.value === undefined) {
    return fallback;
  }
  return descriptor.value;
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (stableStringify(actualKeys) !== stableStringify(sortedExpectedKeys)) {
    throw new Error(
      `${label} 不一致：期望 ${stableStringify(sortedExpectedKeys)}，实际 ${stableStringify(actualKeys)}`,
    );
  }
}

async function readRequiredText(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`无法读取 ${label}`, { cause: error });
  }
}

async function readRequiredJson(path, label) {
  const source = await readRequiredText(path, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON`, { cause: error });
  }
}

async function defaultRunForgeVersion(contractsRoot) {
  const { stdout } = await execFileAsync("forge", ["--version"], {
    cwd: contractsRoot,
    encoding: "utf8",
  });
  return stdout;
}

function parseForgeVersion(output) {
  const source = typeof output === "string" ? output : output?.stdout;
  if (typeof source !== "string") {
    throw new Error("forge --version 未返回文本输出");
  }

  const version = source.match(/^forge Version:\s*(\S+)\s*$/m)?.[1];
  const commit = source.match(/^Commit SHA:\s*([a-fA-F0-9]{40})\s*$/m)?.[1]?.toLowerCase();
  if (!version || !commit) {
    throw new Error("无法解析 forge --version 的版本或 commit");
  }
  return { version, commit };
}

async function listBuildInfoFiles(contractsRoot) {
  const directory = resolve(contractsRoot, "out/build-info");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw new Error("无法读取 out/build-info", { cause: error });
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

export async function verifyArtifactConsistency(options) {
  const optionDescriptors = requireToolingOptionsDescriptors(options);
  const contractsRoot = readToolingOption(
    optionDescriptors,
    "contractsRoot",
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const runForgeVersion = readToolingOption(
    optionDescriptors,
    "runForgeVersion",
    defaultRunForgeVersion,
  );
  const foundryFileVersion = (
    await readRequiredText(resolve(contractsRoot, ".foundry-version"), ".foundry-version")
  ).trim();
  assertEqual(foundryFileVersion, expected.foundryFileVersion, ".foundry-version");

  const forge = parseForgeVersion(await runForgeVersion(contractsRoot));
  assertEqual(forge.version, expected.foundryRuntimeVersion, "Foundry 版本");
  assertEqual(forge.commit, expected.foundryCommit, "Foundry commit");

  const lock = await readRequiredJson(resolve(contractsRoot, "foundry.lock"), "foundry.lock");
  assertExactKeys(lock, ["lib/openzeppelin-contracts"], "foundry.lock 依赖字段");
  const openZeppelinEntry = lock["lib/openzeppelin-contracts"];
  assertExactKeys(openZeppelinEntry, ["tag"], "OpenZeppelin lock entry 字段");
  const openZeppelin = openZeppelinEntry.tag;
  assertExactKeys(openZeppelin, ["name", "rev"], "OpenZeppelin tag 字段");
  assertEqual(openZeppelin?.name, expected.openZeppelinTag, "OpenZeppelin tag");
  assertEqual(openZeppelin?.rev, expected.openZeppelinRevision, "OpenZeppelin revision");

  const buildInfoFiles = await listBuildInfoFiles(contractsRoot);
  if (buildInfoFiles.length !== 1) {
    throw new Error(`clean build 后必须恰好一个 build-info，实际 ${buildInfoFiles.length} 个`);
  }

  const buildInfo = await readRequiredJson(
    resolve(contractsRoot, "out/build-info", buildInfoFiles[0]),
    "build-info",
  );
  const settings = buildInfo?.input?.settings;
  assertExactKeys(
    settings,
    [
      "evmVersion",
      "libraries",
      "metadata",
      "optimizer",
      "outputSelection",
      "remappings",
      "viaIR",
    ],
    "settings 字段",
  );
  assertExactKeys(settings.optimizer, ["enabled", "runs"], "optimizer 字段");
  assertExactKeys(
    settings.metadata,
    ["appendCBOR", "bytecodeHash", "useLiteralContent"],
    "metadata 字段",
  );
  assertPlainObject(settings.outputSelection, "outputSelection");
  assertPlainObject(settings.libraries, "libraries");
  if (Object.keys(settings.libraries).length !== 0) {
    throw new Error("libraries 必须为空对象");
  }
  assertEqual(buildInfo?.solcVersion, expected.solidityVersion, "Solidity 版本");
  assertEqual(settings?.evmVersion, expected.evmVersion, "EVM 版本");
  assertEqual(settings?.optimizer?.enabled, expected.optimizerEnabled, "optimizer.enabled");
  assertEqual(settings?.optimizer?.runs, expected.optimizerRuns, "optimizer.runs");
  assertEqual(settings?.viaIR, expected.viaIR, "viaIR");
  assertEqual(
    settings?.metadata?.bytecodeHash,
    expected.metadataBytecodeHash,
    "metadata.bytecodeHash",
  );
  assertEqual(
    settings?.metadata?.useLiteralContent,
    expected.metadataUseLiteralContent,
    "metadata.useLiteralContent",
  );
  assertEqual(
    settings?.metadata?.appendCBOR,
    expected.metadataAppendCBOR,
    "metadata.appendCBOR",
  );
  assertJsonArrayEqual(settings?.remappings, expected.remappings, "remappings");

  const summary = {
    schemaVersion: 1,
    foundry: {
      version: forge.version,
      commit: forge.commit,
    },
    solidity: {
      version: buildInfo.solcVersion,
      evmVersion: settings.evmVersion,
      optimizer: {
        enabled: settings.optimizer.enabled,
        runs: settings.optimizer.runs,
      },
      viaIR: settings.viaIR,
      metadata: {
        bytecodeHash: settings.metadata.bytecodeHash,
        useLiteralContent: settings.metadata.useLiteralContent,
        appendCBOR: settings.metadata.appendCBOR,
      },
      remappings: [...settings.remappings],
    },
    openZeppelin: {
      tag: openZeppelin.name,
      revision: openZeppelin.rev,
    },
    buildInfo: {
      count: 1,
      format: buildInfo._format,
      sha256: sha256(stableStringify(buildInfo)),
    },
  };

  return {
    ...summary,
    digest: sha256(stableStringify(summary)),
  };
}

async function main() {
  try {
    const report = await verifyArtifactConsistency();
    process.stdout.write(`${stableStringify(report, 2)}\n`);
  } catch (error) {
    process.stderr.write(`artifact 一致性检查失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
