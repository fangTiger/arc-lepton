import assert from "node:assert/strict";
import test from "node:test";
import {types} from "node:util";
import {runInNewContext} from "node:vm";

import {
  ArtifactPublicationGateError,
  runArtifactPublicationGate,
} from "./reproducible-artifact-gate.mjs";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "c".repeat(40);
const DIGEST = "b".repeat(64);
const OTHER_DIGEST = "d".repeat(64);

function cleanGitSnapshot(overrides = {}) {
  return {
    headCommit: COMMIT,
    statusPorcelain: "",
    submoduleStatus: "",
    ...overrides,
  };
}

function validProof(overrides = {}) {
  return {commit: COMMIT, digest: DIGEST, ...overrides};
}

function createRequest(overrides = {}) {
  return {
    requestFinal: true,
    gitSnapshot: cleanGitSnapshot(),
    localDigest: DIGEST,
    rebuildIsolated: async () => validProof(),
    writeTemporary: async () => {},
    writeFinal: async () => {},
    ...overrides,
  };
}

async function expectGateError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ArtifactPublicationGateError);
    assert.equal(error.name, "ArtifactPublicationGateError");
    assert.equal(error.code, code);
    return true;
  });
}

test("导出可复现 artifact 发布门禁接口", () => {
  assert.equal(typeof ArtifactPublicationGateError, "function");
  assert.equal(typeof runArtifactPublicationGate, "function");
});

test("temporary 请求只能写 temporary，且不执行重建或最终发布", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate(
    createRequest({
      requestFinal: false,
      gitSnapshot: cleanGitSnapshot({
        statusPorcelain: " M contracts/src/Escrow.sol",
        submoduleStatus: "-deadbeef lib/uninitialized",
      }),
      rebuildIsolated: async () => calls.push("rebuild"),
      writeTemporary: async () => calls.push("temporary"),
      writeFinal: async () => calls.push("final"),
    }),
  );

  assert.deepEqual(calls, ["temporary"]);
  assert.deepEqual(result, {classification: "temporary"});
  assert.ok(Object.isFrozen(result));
});

test("temporary 只需要 temporary writer，并完全忽略 final 专用输入", async () => {
  const calls = [];
  const ignoredGitSnapshot = new Proxy({}, {
    getPrototypeOf() {
      throw new TypeError("temporary 不得读取 Git snapshot");
    },
  });
  const result = await runArtifactPublicationGate(
    createRequest({
      requestFinal: false,
      gitSnapshot: ignoredGitSnapshot,
      localDigest: undefined,
      rebuildIsolated: undefined,
      writeTemporary: async () => calls.push("temporary"),
      writeFinal: undefined,
    }),
  );

  assert.deepEqual(calls, ["temporary"]);
  assert.deepEqual(result, {classification: "temporary"});
});

test("temporary 允许只提供当前模式必需字段", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate({
    requestFinal: false,
    writeTemporary: async () => calls.push("temporary"),
  });

  assert.deepEqual(calls, ["temporary"]);
  assert.deepEqual(result, {classification: "temporary"});
});

test("temporary 不读取已知但无关的 accessor 或 proxy descriptor", async () => {
  let accessorCalls = 0;
  const accessorRequest = {
    requestFinal: false,
    writeTemporary: async () => {},
  };
  Object.defineProperty(accessorRequest, "gitSnapshot", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      throw new TypeError("temporary 不得读取 accessor");
    },
  });
  await runArtifactPublicationGate(accessorRequest);
  assert.equal(accessorCalls, 0);

  let descriptorTrapCalls = 0;
  const proxyRequest = new Proxy({
    requestFinal: false,
    writeTemporary: async () => {},
    gitSnapshot: cleanGitSnapshot(),
  }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "gitSnapshot") {
        descriptorTrapCalls += 1;
        throw new TypeError("temporary 不得读取 proxy descriptor");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  await runArtifactPublicationGate(proxyRequest);
  assert.equal(descriptorTrapCalls, 0);
});

test("temporary 仍拒绝未知 root key", async () => {
  await expectGateError(
    runArtifactPublicationGate({
      requestFinal: false,
      writeTemporary: async () => {},
      unexpected: true,
    }),
    "REQUEST_INVALID",
  );
});

test("final 不需要 temporary writer", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate(
    createRequest({
      writeTemporary: undefined,
      rebuildIsolated: async () => {
        calls.push("rebuild");
        return validProof();
      },
      writeFinal: async () => calls.push("final"),
    }),
  );

  assert.deepEqual(calls, ["rebuild", "final"]);
  assert.equal(result.classification, "final");
});

test("final 允许只提供当前模式必需字段", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate({
    requestFinal: true,
    gitSnapshot: cleanGitSnapshot(),
    localDigest: DIGEST,
    rebuildIsolated: async () => {
      calls.push("rebuild");
      return validProof();
    },
    writeFinal: async () => calls.push("final"),
  });

  assert.deepEqual(calls, ["rebuild", "final"]);
  assert.equal(result.classification, "final");
});

test("缺失当前模式必需 callback 时稳定 REQUEST_INVALID 且零调用", async () => {
  const temporaryCalls = [];
  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        requestFinal: false,
        writeTemporary: undefined,
        rebuildIsolated: async () => temporaryCalls.push("rebuild"),
        writeFinal: async () => temporaryCalls.push("final"),
      }),
    ),
    "REQUEST_INVALID",
  );
  assert.deepEqual(temporaryCalls, []);

  for (const callbackName of ["rebuildIsolated", "writeFinal"]) {
    const calls = [];
    const request = createRequest({
      rebuildIsolated: async () => calls.push("rebuild"),
      writeFinal: async () => calls.push("final"),
    });
    request[callbackName] = undefined;
    await expectGateError(
      runArtifactPublicationGate(request),
      "REQUEST_INVALID",
    );
    assert.deepEqual(calls, []);
  }
});

test("clean submodule stdout 可带一个末尾换行", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate(
    createRequest({
      gitSnapshot: cleanGitSnapshot({
        submoduleStatus: ` ${COMMIT} lib/clean-submodule\n`,
      }),
      rebuildIsolated: async () => {
        calls.push("rebuild");
        return validProof();
      },
      writeFinal: async () => calls.push("final"),
    }),
  );

  assert.deepEqual(calls, ["rebuild", "final"]);
  assert.equal(result.classification, "final");
});

test("cross-realm native Promise proof 可完成 final 发布", async () => {
  const calls = [];
  const result = await runArtifactPublicationGate(
    createRequest({
      rebuildIsolated: () => runInNewContext("Promise.resolve(proof)", {
        proof: validProof(),
      }),
      writeFinal: async () => calls.push("final"),
    }),
  );

  assert.deepEqual(calls, ["final"]);
  assert.equal(result.classification, "final");
});

test("cross-realm rejected native Promise proof 稳定转换为 CALLBACK_FAILED", async () => {
  const rejected = runInNewContext("Promise.reject(new Error('rebuild failed'))");
  rejected.catch(() => {});
  await expectGateError(
    runArtifactPublicationGate(createRequest({rebuildIsolated: () => rejected})),
    "CALLBACK_FAILED",
  );
});

test("Promise Proxy proof 按非 plain proof 拒绝", async () => {
  const basePromise = Promise.resolve(validProof());
  const proof = new Proxy(basePromise, {});
  assert.equal(types.isPromise(proof), false);
  await expectGateError(
    runArtifactPublicationGate(createRequest({rebuildIsolated: () => proof})),
    "ISOLATED_PROOF_INVALID",
  );
});

const invalidGitCases = [
  ["tracked diff", cleanGitSnapshot({statusPorcelain: " M contracts/src/Escrow.sol"}), "GIT_DIRTY"],
  ["untracked file", cleanGitSnapshot({statusPorcelain: "?? artifact.json"}), "GIT_DIRTY"],
  ["dirty submodule", cleanGitSnapshot({submoduleStatus: "+deadbeef lib/dirty"}), "GIT_SUBMODULE_DIRTY"],
  ["uninitialized submodule", cleanGitSnapshot({submoduleStatus: "-deadbeef lib/missing"}), "GIT_SUBMODULE_DIRTY"],
  ["conflicted submodule", cleanGitSnapshot({submoduleStatus: "Udeadbeef lib/conflict"}), "GIT_SUBMODULE_DIRTY"],
  ["missing commit", cleanGitSnapshot({headCommit: undefined}), "GIT_COMMIT_INVALID"],
  ["short commit", cleanGitSnapshot({headCommit: "a".repeat(39)}), "GIT_COMMIT_INVALID"],
  ["uppercase commit", cleanGitSnapshot({headCommit: "A".repeat(40)}), "GIT_COMMIT_INVALID"],
  ["non-hex commit", cleanGitSnapshot({headCommit: `${"a".repeat(39)}g`}), "GIT_COMMIT_INVALID"],
];

for (const [label, gitSnapshot, code] of invalidGitCases) {
  test(`final 拒绝 ${label}，且不调用任何 callback`, async () => {
    const calls = [];
    await expectGateError(
      runArtifactPublicationGate(
        createRequest({
          gitSnapshot,
          rebuildIsolated: async () => calls.push("rebuild"),
          writeTemporary: async () => calls.push("temporary"),
          writeFinal: async () => calls.push("final"),
        }),
      ),
      code,
    );
    assert.deepEqual(calls, []);
  });
}

test("clean commit 仍拒绝非法 local digest，且不调用 callback", async () => {
  const calls = [];
  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        localDigest: "B".repeat(64),
        rebuildIsolated: async () => calls.push("rebuild"),
        writeTemporary: async () => calls.push("temporary"),
        writeFinal: async () => calls.push("final"),
      }),
    ),
    "DIGEST_INVALID",
  );
  assert.deepEqual(calls, []);
});

const invalidProofCases = [
  ["null", null],
  ["missing digest", {commit: COMMIT}],
  ["invalid commit", validProof({commit: "A".repeat(40)})],
  ["invalid digest", validProof({digest: "B".repeat(64)})],
];

for (const [label, proof] of invalidProofCases) {
  test(`拒绝 ${label} isolated proof，且不发布 final`, async () => {
    const calls = [];
    await expectGateError(
      runArtifactPublicationGate(
        createRequest({
          rebuildIsolated: async () => {
            calls.push("rebuild");
            return proof;
          },
          writeFinal: async () => calls.push("final"),
        }),
      ),
      "ISOLATED_PROOF_INVALID",
    );
    assert.deepEqual(calls, ["rebuild"]);
  });
}

for (const [label, proof] of [
  ["不同 commit", validProof({commit: OTHER_COMMIT})],
  ["不同 digest", validProof({digest: OTHER_DIGEST})],
]) {
  test(`拒绝 ${label} 的 isolated artifact proof`, async () => {
    const calls = [];
    await expectGateError(
      runArtifactPublicationGate(
        createRequest({
          rebuildIsolated: async () => {
            calls.push("rebuild");
            return proof;
          },
          writeFinal: async () => calls.push("final"),
        }),
      ),
      "ARTIFACT_MISMATCH",
    );
    assert.deepEqual(calls, ["rebuild"]);
  });
}

test("clean 且 digest/proof 匹配时仅按正确顺序发布一次 final", async () => {
  const calls = [];
  let rebuildArgument;
  let finalArgument;
  const result = await runArtifactPublicationGate(
    createRequest({
      rebuildIsolated: async (argument) => {
        calls.push("rebuild");
        rebuildArgument = argument;
        return validProof();
      },
      writeFinal: async (argument) => {
        calls.push("final");
        finalArgument = argument;
      },
    }),
  );

  assert.deepEqual(calls, ["rebuild", "final"]);
  assert.deepEqual(rebuildArgument, {commit: COMMIT});
  assert.ok(Object.isFrozen(rebuildArgument));
  assert.deepEqual(finalArgument, {commit: COMMIT, digest: DIGEST});
  assert.deepEqual(result, {classification: "final", commit: COMMIT, digest: DIGEST});
  assert.ok(Object.isFrozen(result));
});

test("callback 抛错或 reject 时稳定失败并保持 fail closed", async () => {
  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        rebuildIsolated: async () => {
          throw new TypeError("build failed");
        },
      }),
    ),
    "CALLBACK_FAILED",
  );

  let finalCalls = 0;
  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        writeFinal: async () => {
          finalCalls += 1;
          return Promise.reject(new TypeError("writer failed"));
        },
      }),
    ),
    "CALLBACK_FAILED",
  );
  assert.equal(finalCalls, 1);
});

test("拒绝 malformed callback，且 temporary writer 异常稳定失败", async () => {
  const calls = [];
  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        writeFinal: null,
        rebuildIsolated: async () => calls.push("rebuild"),
        writeTemporary: async () => calls.push("temporary"),
      }),
    ),
    "REQUEST_INVALID",
  );
  assert.deepEqual(calls, []);

  await expectGateError(
    runArtifactPublicationGate(
      createRequest({
        requestFinal: false,
        writeTemporary: async () => {
          throw new TypeError("temporary writer failed");
        },
      }),
    ),
    "CALLBACK_FAILED",
  );
});

class CustomRecord {}

const invalidRootRecordFactories = [
  ["Date", (value) => Object.assign(new Date(0), value)],
  ["class instance", (value) => Object.assign(new CustomRecord(), value)],
  ["null prototype", (value) => Object.assign(Object.create(null), value)],
  ["inherited fields", (value) => Object.create(value)],
  ["revoked Proxy", (value) => {
    const {proxy, revoke} = Proxy.revocable(value, {});
    revoke();
    return proxy;
  }],
  ["getPrototypeOf trap", (value) => new Proxy(value, {
    getPrototypeOf() {
      throw new TypeError("unexpected proxy trap");
    },
  })],
];

for (const [label, factory] of invalidRootRecordFactories) {
  test(`将 root ${label} 统一转换为 REQUEST_INVALID`, async () => {
    await expectGateError(runArtifactPublicationGate(factory(createRequest())), "REQUEST_INVALID");
  });
}

for (const [label, addUnexpectedKey] of [
  ["额外字符串 key", (value) => { value.unexpected = true; }],
  ["额外 symbol key", (value) => { value[Symbol("unexpected")] = true; }],
  ["额外 non-enumerable key", (value) => {
    Object.defineProperty(value, "unexpected", {value: true, enumerable: false});
  }],
]) {
  test(`拒绝 root ${label}`, async () => {
    const request = createRequest();
    addUnexpectedKey(request);
    await expectGateError(runArtifactPublicationGate(request), "REQUEST_INVALID");
  });
}

test("拒绝 root accessor 且不执行 getter", async () => {
  const request = createRequest();
  let getterCalls = 0;
  Object.defineProperty(request, "requestFinal", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new TypeError("getter should not run");
    },
  });

  await expectGateError(runArtifactPublicationGate(request), "REQUEST_INVALID");
  assert.equal(getterCalls, 0);
});

test("拒绝 root 已知字段的 non-enumerable data property", async () => {
  const request = createRequest();
  Object.defineProperty(request, "requestFinal", {
    configurable: true,
    enumerable: false,
    value: true,
  });
  await expectGateError(runArtifactPublicationGate(request), "REQUEST_INVALID");
});

const invalidGitRecordFactories = [
  ["Date", (value) => Object.assign(new Date(0), value)],
  ["class instance", (value) => Object.assign(new CustomRecord(), value)],
  ["null prototype", (value) => Object.assign(Object.create(null), value)],
  ["inherited fields", (value) => Object.create(value)],
  ["revoked Proxy", (value) => {
    const {proxy, revoke} = Proxy.revocable(value, {});
    revoke();
    return proxy;
  }],
  ["ownKeys trap", (value) => new Proxy(value, {
    ownKeys() {
      throw new TypeError("unexpected proxy trap");
    },
  })],
];

for (const [label, factory] of invalidGitRecordFactories) {
  test(`将 git snapshot ${label} 统一转换为 GIT_COMMIT_INVALID`, async () => {
    await expectGateError(
      runArtifactPublicationGate(createRequest({gitSnapshot: factory(cleanGitSnapshot())})),
      "GIT_COMMIT_INVALID",
    );
  });
}

test("拒绝 git snapshot accessor 或未知 key，且不执行 getter", async () => {
  const gitSnapshot = cleanGitSnapshot();
  let getterCalls = 0;
  Object.defineProperty(gitSnapshot, "headCommit", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new TypeError("getter should not run");
    },
  });

  await expectGateError(
    runArtifactPublicationGate(createRequest({gitSnapshot})),
    "GIT_COMMIT_INVALID",
  );
  assert.equal(getterCalls, 0);

  const withUnknownKey = cleanGitSnapshot();
  withUnknownKey[Symbol("unexpected")] = true;
  await expectGateError(
    runArtifactPublicationGate(createRequest({gitSnapshot: withUnknownKey})),
    "GIT_COMMIT_INVALID",
  );

  const nonEnumerable = cleanGitSnapshot();
  Object.defineProperty(nonEnumerable, "statusPorcelain", {
    configurable: true,
    enumerable: false,
    value: "",
  });
  await expectGateError(
    runArtifactPublicationGate(createRequest({gitSnapshot: nonEnumerable})),
    "GIT_COMMIT_INVALID",
  );
});

const invalidProofRecordFactories = [
  ["Date", (value) => Object.assign(new Date(0), value)],
  ["class instance", (value) => Object.assign(new CustomRecord(), value)],
  ["null prototype", (value) => Object.assign(Object.create(null), value)],
  ["inherited fields", (value) => Object.create(value)],
  ["revoked Proxy", (value) => {
    const {proxy, revoke} = Proxy.revocable(value, {});
    revoke();
    return proxy;
  }],
  ["getOwnPropertyDescriptor trap", (value) => new Proxy(value, {
    getOwnPropertyDescriptor() {
      throw new TypeError("unexpected proxy trap");
    },
  })],
];

for (const [label, factory] of invalidProofRecordFactories) {
  test(`将 isolated proof ${label} 统一转换为 ISOLATED_PROOF_INVALID`, async () => {
    await expectGateError(
      runArtifactPublicationGate(
        createRequest({rebuildIsolated: () => factory(validProof())}),
      ),
      "ISOLATED_PROOF_INVALID",
    );
  });
}

test("拒绝 isolated proof accessor 与未知 non-enumerable key，且不执行 getter", async () => {
  const proof = validProof();
  let getterCalls = 0;
  Object.defineProperty(proof, "digest", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new TypeError("getter should not run");
    },
  });
  await expectGateError(
    runArtifactPublicationGate(createRequest({rebuildIsolated: async () => proof})),
    "ISOLATED_PROOF_INVALID",
  );
  assert.equal(getterCalls, 0);

  const withUnknownKey = validProof();
  Object.defineProperty(withUnknownKey, "unexpected", {value: true, enumerable: false});
  await expectGateError(
    runArtifactPublicationGate(createRequest({rebuildIsolated: async () => withUnknownKey})),
    "ISOLATED_PROOF_INVALID",
  );

  const nonEnumerable = validProof();
  Object.defineProperty(nonEnumerable, "commit", {
    configurable: true,
    enumerable: false,
    value: COMMIT,
  });
  await expectGateError(
    runArtifactPublicationGate(createRequest({rebuildIsolated: async () => nonEnumerable})),
    "ISOLATED_PROOF_INVALID",
  );
});

test("接受冻结的 plain request、git snapshot 与 isolated proof", async () => {
  const proof = Object.freeze(validProof());
  const request = Object.freeze(createRequest({
    gitSnapshot: Object.freeze(cleanGitSnapshot()),
    rebuildIsolated: async () => proof,
  }));

  const result = await runArtifactPublicationGate(request);
  assert.deepEqual(result, {classification: "final", commit: COMMIT, digest: DIGEST});
  assert.ok(Object.isFrozen(result));
});
