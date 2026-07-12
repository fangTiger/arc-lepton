import assert from "node:assert/strict";
import test from "node:test";

import {
  countListedTests,
  runForgeTestProfile,
} from "./run-forge-test-profile.mjs";

const oneListedTest = JSON.stringify({
  "test/Example.t.sol": {
    ExampleTest: ["testExample"],
  },
});

function createHarness({ listOutput = oneListedTest, suiteExitCode = 0 } = {}) {
  const calls = [];
  let stdout = "";
  let stderr = "";

  return {
    calls,
    readStdout: () => stdout,
    readStderr: () => stderr,
    options: {
      baseEnv: { BASE_ENV: "preserved" },
      executeForge: async ({ args, env, phase }) => {
        calls.push({ args, env, phase });
        if (phase === "list") {
          return { exitCode: 0, stdout: listOutput, stderr: "" };
        }
        return {
          exitCode: suiteExitCode,
          stdout: "suite stdout\n",
          stderr: "suite stderr\n",
        };
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

test("按 Foundry list JSON 精确计算测试数", () => {
  const listed = JSON.stringify({
    "test/A.t.sol": { ATest: ["testOne", "testTwo"] },
    "test/B.t.sol": { BTest: ["testThree"] },
  });
  assert.equal(countListedTests(listed), 3);
});

test("空 list 必须 fail closed 且不得执行 suite", async () => {
  const harness = createHarness({ listOutput: "{}" });
  await assert.rejects(
    runForgeTestProfile("unit", harness.options),
    /没有匹配任何测试/,
  );
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].phase, "list");
});

test("malformed list JSON 必须失败", async () => {
  const harness = createHarness({ listOutput: "{not-json" });
  await assert.rejects(
    runForgeTestProfile("fuzz", harness.options),
    /无法解析 forge test --list --json/,
  );
  assert.equal(harness.calls.length, 1);
});

test("未知 profile 在调用 Forge 前失败", async () => {
  const harness = createHarness();
  await assert.rejects(
    runForgeTestProfile("unknown", harness.options),
    /未知 Forge 测试 profile/,
  );
  assert.equal(harness.calls.length, 0);
});

const profileCases = [
  {
    name: "unit",
    listArgs: [
      "test",
      "--list",
      "--json",
      "--root",
      "contracts",
      "--no-match-test",
      "^(testFuzz|invariant_)",
    ],
    suiteArgs: [
      "test",
      "--root",
      "contracts",
      "--no-match-test",
      "^(testFuzz|invariant_)",
      "-vv",
    ],
    invariantEnv: {},
  },
  {
    name: "fuzz",
    listArgs: [
      "test",
      "--list",
      "--json",
      "--root",
      "contracts",
      "--match-test",
      "^testFuzz",
    ],
    suiteArgs: [
      "test",
      "--root",
      "contracts",
      "--match-test",
      "^testFuzz",
      "--fuzz-runs",
      "1024",
      "-vv",
    ],
    invariantEnv: {},
  },
  {
    name: "invariant",
    listArgs: [
      "test",
      "--list",
      "--json",
      "--root",
      "contracts",
      "--match-test",
      "^invariant_",
    ],
    suiteArgs: [
      "test",
      "--root",
      "contracts",
      "--match-test",
      "^invariant_",
      "-vv",
    ],
    invariantEnv: {
      FOUNDRY_INVARIANT_RUNS: "256",
      FOUNDRY_INVARIANT_DEPTH: "64",
      FOUNDRY_INVARIANT_FAIL_ON_REVERT: "true",
    },
  },
];

for (const profile of profileCases) {
  test(`${profile.name} profile 先计数再用固定参数执行`, async () => {
    const harness = createHarness();
    const result = await runForgeTestProfile(profile.name, harness.options);

    assert.equal(result.exitCode, 0);
    assert.equal(result.testCount, 1);
    assert.equal(harness.calls.length, 2);
    assert.deepEqual(harness.calls[0].args, profile.listArgs);
    assert.deepEqual(harness.calls[1].args, profile.suiteArgs);
    for (const call of harness.calls) {
      assert.equal(call.env.BASE_ENV, "preserved");
      assert.equal(call.env.FOUNDRY_OFFLINE, "true");
      for (const [key, value] of Object.entries(profile.invariantEnv)) {
        assert.equal(call.env[key], value);
      }
    }
    assert.equal(harness.readStdout(), "suite stdout\n");
    assert.equal(harness.readStderr(), "suite stderr\n");
  });
}

test("suite 非零退出码被原样返回并透传输出", async () => {
  const harness = createHarness({ suiteExitCode: 7 });
  const result = await runForgeTestProfile("unit", harness.options);
  assert.equal(result.exitCode, 7);
  assert.equal(harness.readStdout(), "suite stdout\n");
  assert.equal(harness.readStderr(), "suite stderr\n");
});
