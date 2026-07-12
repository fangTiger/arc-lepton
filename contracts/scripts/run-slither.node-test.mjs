import assert from "node:assert/strict";
import test from "node:test";

import { runSlither } from "./run-slither.mjs";

const validSummary =
  "INFO:Slither:contracts analyzed (6 contracts with 101 detectors), 0 result(s) found\n";

function createHarness({
  version = { exitCode: 0, stdout: "0.11.5\n", stderr: "" },
  clean = { exitCode: 0, stdout: "clean stdout\n", stderr: "clean stderr\n" },
  build = { exitCode: 0, stdout: "build stdout\n", stderr: "build stderr\n" },
  slither = { exitCode: 0, stdout: "slither stdout\n", stderr: validSummary },
  buildInfoFiles = ["build.json"],
} = {}) {
  const calls = [];
  let stdout = "";
  let stderr = "";
  let buildInfoListCalls = 0;
  const results = { version, clean, build, slither };

  return {
    calls,
    readStdout: () => stdout,
    readStderr: () => stderr,
    buildInfoListCalls: () => buildInfoListCalls,
    options: {
      baseEnv: { BASE_ENV: "preserved" },
      executeCommand: async ({ command, args, env, phase }) => {
        calls.push({ command, args, env, phase });
        return results[phase];
      },
      listBuildInfoFiles: async () => {
        buildInfoListCalls += 1;
        return buildInfoFiles;
      },
      writeStdout: (value) => {
        stdout += value;
      },
      writeStderr: (value) => {
        stderr += value;
      },
    },
  };
}

async function captureRejection(promise, expectedMessage) {
  try {
    await promise;
    assert.fail("预期 wrapper 失败，但实际成功");
  } catch (error) {
    assert.match(error.message, expectedMessage);
    return error;
  }
}

test("Slither 版本不是 0.11.5 时失败且不编译", async () => {
  const harness = createHarness({
    version: { exitCode: 0, stdout: "0.11.4\n", stderr: "" },
  });
  await captureRejection(runSlither(harness.options), /Slither 版本必须精确为 0\.11\.5/);
  assert.deepEqual(harness.calls.map((call) => call.phase), ["version"]);
});

test("forge clean 失败后立即停止", async () => {
  const harness = createHarness({
    clean: { exitCode: 4, stdout: "", stderr: "clean failed\n" },
  });
  const error = await captureRejection(runSlither(harness.options), /Forge clean 失败/);
  assert.equal(error.exitCode, 4);
  assert.deepEqual(harness.calls.map((call) => call.phase), ["version", "clean"]);
});

test("forge build 失败后绝不调用 Slither", async () => {
  const harness = createHarness({
    build: { exitCode: 5, stdout: "", stderr: "build failed\n" },
  });
  const error = await captureRejection(runSlither(harness.options), /Forge build 失败/);
  assert.equal(error.exitCode, 5);
  assert.deepEqual(harness.calls.map((call) => call.phase), ["version", "clean", "build"]);
  assert.equal(harness.buildInfoListCalls(), 0);
});

test("Slither 非零退出码被透传为失败", async () => {
  const harness = createHarness({
    slither: { exitCode: 7, stdout: "partial output\n", stderr: "slither failed\n" },
  });
  const error = await captureRejection(runSlither(harness.options), /Slither 执行失败/);
  assert.equal(error.exitCode, 7);
  assert.match(harness.readStdout(), /partial output/);
  assert.match(harness.readStderr(), /slither failed/);
  assert.equal(harness.buildInfoListCalls(), 0);
});

test("Slither exit 0 但包含内部编译失败标记时失败", async () => {
  const harness = createHarness({
    slither: {
      exitCode: 0,
      stdout: "",
      stderr:
        "forge returned non-zero exit code\nInvalidCompilation: Compilation failed. Can you run build command?\n",
    },
  });
  await captureRejection(runSlither(harness.options), /Slither 内部编译失败/);
  assert.equal(harness.buildInfoListCalls(), 0);
});

for (const files of [[], ["one.json", "two.json"]]) {
  test(`Slither 后 build-info 数量 ${files.length} 时失败`, async () => {
    const harness = createHarness({ buildInfoFiles: files });
    await captureRejection(runSlither(harness.options), /Slither 后必须恰好一个 build-info/);
    assert.equal(harness.buildInfoListCalls(), 1);
  });
}

test("Slither exit 0 但无法解析分析摘要时失败", async () => {
  const harness = createHarness({
    slither: { exitCode: 0, stdout: "no summary\n", stderr: "" },
  });
  await captureRejection(runSlither(harness.options), /无法解析非零 Slither 分析摘要/);
});

test("Slither 摘要 contracts 或 detectors 为零时失败", async () => {
  const harness = createHarness({
    slither: {
      exitCode: 0,
      stdout: "",
      stderr: "INFO:Slither:contracts analyzed (6 contracts with 0 detectors), 0 result(s) found\n",
    },
  });
  await captureRejection(runSlither(harness.options), /无法解析非零 Slither 分析摘要/);
});

test("正确顺序、参数、环境和后验摘要通过并透传输出", async () => {
  const harness = createHarness();
  const result = await runSlither(harness.options);

  assert.deepEqual(result, {
    buildInfoCount: 1,
    contracts: 6,
    detectors: 101,
    findings: 0,
  });
  assert.deepEqual(harness.calls, [
    {
      command: "slither",
      args: ["--version"],
      env: { BASE_ENV: "preserved", FOUNDRY_OFFLINE: "true" },
      phase: "version",
    },
    {
      command: "forge",
      args: ["clean", "--root", "contracts"],
      env: { BASE_ENV: "preserved", FOUNDRY_OFFLINE: "true" },
      phase: "clean",
    },
    {
      command: "forge",
      args: ["build", "--root", "contracts", "--force"],
      env: { BASE_ENV: "preserved", FOUNDRY_OFFLINE: "true" },
      phase: "build",
    },
    {
      command: "slither",
      args: [
        "contracts",
        "--foundry-compile-all",
        "--exclude-dependencies",
        "--filter-paths",
        "contracts/(lib|test|script)/",
        "--fail-medium",
      ],
      env: { BASE_ENV: "preserved", FOUNDRY_OFFLINE: "true" },
      phase: "slither",
    },
  ]);
  assert.equal(
    harness.readStdout(),
    "0.11.5\nclean stdout\nbuild stdout\nslither stdout\n",
  );
  assert.equal(
    harness.readStderr(),
    `clean stderr\nbuild stderr\n${validSummary}`,
  );
  assert.equal(harness.buildInfoListCalls(), 1);
});

test("runSlither wrapper 拒绝 accessor 输入且不执行 getter", async () => {
  const executeHarness = createHarness();
  const executeAccessorInput = {
    ...executeHarness.options,
  };
  let executeCommandGetterExecuted = false;
  Object.defineProperty(executeAccessorInput, "executeCommand", {
    enumerable: true,
    get() {
      executeCommandGetterExecuted = true;
      return executeHarness.options.executeCommand;
    },
  });

  await captureRejection(runSlither(executeAccessorInput), /Slither request.*executeCommand/);
  assert.equal(executeCommandGetterExecuted, false);
  assert.deepEqual(executeHarness.calls, []);

  const envHarness = createHarness();
  const baseEnvAccessorInput = {
    ...envHarness.options,
  };
  let baseEnvGetterExecuted = false;
  Object.defineProperty(baseEnvAccessorInput, "baseEnv", {
    enumerable: true,
    get() {
      baseEnvGetterExecuted = true;
      return envHarness.options.baseEnv;
    },
  });

  await captureRejection(runSlither(baseEnvAccessorInput), /Slither request.*baseEnv/);
  assert.equal(baseEnvGetterExecuted, false);
  assert.deepEqual(envHarness.calls, []);
});
