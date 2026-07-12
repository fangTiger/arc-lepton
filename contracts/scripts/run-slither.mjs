import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SLITHER_VERSION = "0.11.5";
export const FORGE_CLEAN_ARGS = Object.freeze(["clean", "--root", "contracts"]);
export const FORGE_BUILD_ARGS = Object.freeze([
  "build",
  "--root",
  "contracts",
  "--force",
]);
export const SLITHER_ARGS = Object.freeze([
  "contracts",
  "--foundry-compile-all",
  "--exclude-dependencies",
  "--filter-paths",
  "contracts/(lib|test|script)/",
  "--fail-medium",
]);

function commandFailure(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode > 0 ? exitCode : 1;
  return error;
}

function slitherRequestFailure(path, message) {
  throw commandFailure(`Slither request ${path} ${message}`);
}

function requireSlitherOptionsDescriptors(options) {
  if (options === undefined) {
    return {};
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    slitherRequestFailure("$", "必须是 plain object");
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
    slitherRequestFailure("$", "必须可静态枚举");
  }

  if (prototype !== Object.prototype) {
    slitherRequestFailure("$", "必须是 plain object");
  }
  if (symbols.length !== 0) {
    slitherRequestFailure("$", "不得包含 symbol key");
  }
  if (ownNames.length !== enumerableKeys.length) {
    slitherRequestFailure("$", "只能包含可枚举 data property");
  }
  for (const key of enumerableKeys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      slitherRequestFailure(`$.${key}`, "只能是可枚举 data property");
    }
  }
  return descriptors;
}

function readSlitherOption(descriptors, key, fallback) {
  const descriptor = descriptors[key];
  if (descriptor === undefined || descriptor.value === undefined) {
    return fallback;
  }
  return descriptor.value;
}

function defaultExecuteCommand({ command, args, env }) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw commandFailure(`无法执行 ${command} 命令`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function defaultListBuildInfoFiles() {
  let entries;
  try {
    entries = await readdir(resolve("contracts/out/build-info"), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw commandFailure("无法读取 Slither 后的 build-info");
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

function writeCommandOutput(result, writeStdout, writeStderr) {
  if (result.stdout) {
    writeStdout(result.stdout);
  }
  if (result.stderr) {
    writeStderr(result.stderr);
  }
}

function parseAnalysisSummary(output) {
  const pattern =
    /contracts analyzed\s*\(\s*(\d+)\s+contracts with\s+(\d+)\s+detectors\s*\),\s*(\d+)\s+result\(s\) found/gi;
  let contracts = 0;
  let detectors = 0;
  let findings = 0;
  let matchCount = 0;
  for (const match of output.matchAll(pattern)) {
    matchCount += 1;
    contracts += Number.parseInt(match[1], 10);
    detectors += Number.parseInt(match[2], 10);
    findings += Number.parseInt(match[3], 10);
  }
  if (matchCount === 0 || contracts <= 0 || detectors <= 0) {
    throw commandFailure("无法解析非零 Slither 分析摘要");
  }
  return { contracts, detectors, findings };
}

function containsCompilationFailure(output) {
  return /forge returned non-zero|compilation failed|can't install missing solc|invalidcompilation/i.test(
    output,
  );
}

export async function runSlither(options) {
  const optionDescriptors = requireSlitherOptionsDescriptors(options);
  const baseEnv = readSlitherOption(optionDescriptors, "baseEnv", process.env);
  const executeCommand = readSlitherOption(
    optionDescriptors,
    "executeCommand",
    defaultExecuteCommand,
  );
  const listBuildInfoFiles = readSlitherOption(
    optionDescriptors,
    "listBuildInfoFiles",
    defaultListBuildInfoFiles,
  );
  const writeStdout = readSlitherOption(
    optionDescriptors,
    "writeStdout",
    (value) => process.stdout.write(value),
  );
  const writeStderr = readSlitherOption(
    optionDescriptors,
    "writeStderr",
    (value) => process.stderr.write(value),
  );
  const env = { ...baseEnv, FOUNDRY_OFFLINE: "true" };

  const versionResult = await executeCommand({
    command: "slither",
    args: ["--version"],
    env,
    phase: "version",
  });
  writeCommandOutput(versionResult, writeStdout, writeStderr);
  if (versionResult.exitCode !== 0 || versionResult.stdout.trim() !== SLITHER_VERSION) {
    throw commandFailure(`Slither 版本必须精确为 ${SLITHER_VERSION}`);
  }

  const cleanResult = await executeCommand({
    command: "forge",
    args: [...FORGE_CLEAN_ARGS],
    env,
    phase: "clean",
  });
  writeCommandOutput(cleanResult, writeStdout, writeStderr);
  if (cleanResult.exitCode !== 0) {
    throw commandFailure("Forge clean 失败，停止 Slither", cleanResult.exitCode);
  }

  const buildResult = await executeCommand({
    command: "forge",
    args: [...FORGE_BUILD_ARGS],
    env,
    phase: "build",
  });
  writeCommandOutput(buildResult, writeStdout, writeStderr);
  if (buildResult.exitCode !== 0) {
    throw commandFailure("Forge build 失败，未运行 Slither", buildResult.exitCode);
  }

  const slitherResult = await executeCommand({
    command: "slither",
    args: [...SLITHER_ARGS],
    env,
    phase: "slither",
  });
  writeCommandOutput(slitherResult, writeStdout, writeStderr);
  if (slitherResult.exitCode !== 0) {
    throw commandFailure("Slither 执行失败", slitherResult.exitCode);
  }

  const slitherOutput = `${slitherResult.stdout ?? ""}\n${slitherResult.stderr ?? ""}`;
  if (containsCompilationFailure(slitherOutput)) {
    throw commandFailure("Slither 内部编译失败，拒绝假绿");
  }

  const buildInfoFiles = await listBuildInfoFiles();
  if (buildInfoFiles.length !== 1) {
    throw commandFailure(`Slither 后必须恰好一个 build-info，实际 ${buildInfoFiles.length} 个`);
  }

  const summary = parseAnalysisSummary(slitherOutput);
  return {
    buildInfoCount: 1,
    ...summary,
  };
}

async function main() {
  try {
    await runSlither();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
