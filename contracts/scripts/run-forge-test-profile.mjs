import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const invariantEnvironmentKeys = [
  "FOUNDRY_INVARIANT_RUNS",
  "FOUNDRY_INVARIANT_DEPTH",
  "FOUNDRY_INVARIANT_FAIL_ON_REVERT",
];

const profiles = Object.freeze({
  unit: Object.freeze({
    filterArgs: ["--no-match-test", "^(testFuzz|invariant_)"],
    suiteArgs: ["--no-match-test", "^(testFuzz|invariant_)", "-vv"],
    env: {},
  }),
  fuzz: Object.freeze({
    filterArgs: ["--match-test", "^testFuzz"],
    suiteArgs: ["--match-test", "^testFuzz", "--fuzz-runs", "1024", "-vv"],
    env: {},
  }),
  invariant: Object.freeze({
    filterArgs: ["--match-test", "^invariant_"],
    suiteArgs: ["--match-test", "^invariant_", "-vv"],
    env: {
      FOUNDRY_INVARIANT_RUNS: "256",
      FOUNDRY_INVARIANT_DEPTH: "64",
      FOUNDRY_INVARIANT_FAIL_ON_REVERT: "true",
    },
  }),
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function countListedTests(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("无法解析 forge test --list --json：输出不是有效 JSON", { cause: error });
  }

  if (!isPlainObject(parsed)) {
    throw new Error("无法解析 forge test --list --json：顶层必须是对象");
  }

  let count = 0;
  for (const contracts of Object.values(parsed)) {
    if (!isPlainObject(contracts)) {
      throw new Error("无法解析 forge test --list --json：文件值必须是合约对象");
    }
    for (const testNames of Object.values(contracts)) {
      if (!Array.isArray(testNames) || !testNames.every((name) => typeof name === "string")) {
        throw new Error("无法解析 forge test --list --json：合约值必须是测试名称数组");
      }
      count += testNames.length;
    }
  }
  return count;
}

function defaultExecuteForge({ args, env }) {
  const result = spawnSync("forge", args, {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw new Error(`无法执行 forge：${result.error.message}`, { cause: result.error });
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function profileEnvironment(profile, baseEnv) {
  const env = { ...baseEnv, FOUNDRY_OFFLINE: "true" };
  for (const key of invariantEnvironmentKeys) {
    delete env[key];
  }
  return { ...env, ...profile.env };
}

function writeResultOutput(result, writeStdout, writeStderr) {
  if (result.stdout) {
    writeStdout(result.stdout);
  }
  if (result.stderr) {
    writeStderr(result.stderr);
  }
}

export async function runForgeTestProfile(
  profileName,
  {
    baseEnv = process.env,
    executeForge = defaultExecuteForge,
    writeStdout = (value) => process.stdout.write(value),
    writeStderr = (value) => process.stderr.write(value),
  } = {},
) {
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`未知 Forge 测试 profile：${profileName ?? "<missing>"}`);
  }

  const env = profileEnvironment(profile, baseEnv);
  const listArgs = [
    "test",
    "--list",
    "--json",
    "--root",
    "contracts",
    ...profile.filterArgs,
  ];
  const listResult = await executeForge({ args: listArgs, env, phase: "list" });
  if (listResult.exitCode !== 0) {
    writeResultOutput(listResult, writeStdout, writeStderr);
    throw new Error(`forge test --list --json 失败，退出码 ${listResult.exitCode}`);
  }

  const testCount = countListedTests(listResult.stdout);
  if (testCount === 0) {
    throw new Error(`Forge ${profileName} profile 没有匹配任何测试，拒绝假绿`);
  }

  const suiteArgs = ["test", "--root", "contracts", ...profile.suiteArgs];
  const suiteResult = await executeForge({ args: suiteArgs, env, phase: "suite" });
  writeResultOutput(suiteResult, writeStdout, writeStderr);
  return { exitCode: suiteResult.exitCode, testCount };
}

async function main() {
  try {
    const result = await runForgeTestProfile(process.argv[2]);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
