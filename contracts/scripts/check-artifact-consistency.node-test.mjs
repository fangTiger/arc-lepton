import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyArtifactConsistency } from "./check-artifact-consistency.mjs";

const EXPECTED_FORGE_OUTPUT = `forge Version: 1.5.1-stable
Commit SHA: b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2
Build Timestamp: 2025-12-22T11:41:09.812070000Z (1766403669)
Build Profile: maxperf`;

function validBuildInfo() {
  return {
    id: "fixture-build-info",
    source_id_to_path: { 0: "test/ToolingProfiles.t.sol" },
    language: "Solidity",
    _format: "ethers-rs-sol-build-info-1",
    solcLongVersion: "0.8.30+commit.73712a01",
    solcVersion: "0.8.30",
    input: {
      language: "Solidity",
      sources: {
        "test/ToolingProfiles.t.sol": {
          content: "pragma solidity 0.8.30; contract Fixture {}",
        },
      },
      settings: {
        remappings: ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"],
        optimizer: { enabled: true, runs: 200 },
        metadata: {
          useLiteralContent: false,
          bytecodeHash: "ipfs",
          appendCBOR: true,
        },
        outputSelection: {},
        evmVersion: "prague",
        viaIR: false,
        libraries: {},
      },
    },
    output: { contracts: {}, sources: {} },
  };
}

function validLock() {
  return {
    "lib/openzeppelin-contracts": {
      tag: {
        name: "v5.6.1",
        rev: "5fd1781b1454fd1ef8e722282f86f9293cacf256",
      },
    },
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "arc-lepton-artifact-check-"));
  const buildInfoDir = join(root, "out", "build-info");
  await mkdir(buildInfoDir, { recursive: true });
  await writeFile(join(root, ".foundry-version"), "1.5.1\n");
  await writeFile(join(root, "foundry.lock"), `${JSON.stringify(validLock(), null, 2)}\n`);
  await writeFile(
    join(buildInfoDir, "fixture.json"),
    `${JSON.stringify(validBuildInfo(), null, 2)}\n`,
  );
  return root;
}

async function verify(root, forgeOutput = EXPECTED_FORGE_OUTPUT) {
  return verifyArtifactConsistency({
    contractsRoot: root,
    runForgeVersion: async () => forgeOutput,
  });
}

async function mutateJson(path, mutate) {
  const value = JSON.parse(await readFile(path, "utf8"));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("正确 build-info、lock 与 Foundry 输出生成稳定无路径 digest", async () => {
  await withFixture(async (root) => {
    const first = await verify(root);
    const second = await verify(root);

    assert.deepEqual(first, second);
    assert.match(first.digest, /^[a-f0-9]{64}$/);
    assert.equal(first.foundry.version, "1.5.1-stable");
    assert.equal(first.foundry.commit, "b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2");
    assert.equal(first.solidity.version, "0.8.30");
    assert.equal(first.openZeppelin.tag, "v5.6.1");
    assert.equal(first.buildInfo.count, 1);
    assert.doesNotMatch(JSON.stringify(first), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("artifact consistency wrapper 拒绝 accessor 输入且不执行 getter", async () => {
  await withFixture(async (root) => {
    const contractsRootAccessorInput = {
      runForgeVersion: async () => EXPECTED_FORGE_OUTPUT,
    };
    let contractsRootGetterExecuted = false;
    Object.defineProperty(contractsRootAccessorInput, "contractsRoot", {
      enumerable: true,
      get() {
        contractsRootGetterExecuted = true;
        return root;
      },
    });

    await assert.rejects(
      verifyArtifactConsistency(contractsRootAccessorInput),
      /tooling request.*contractsRoot/,
    );
    assert.equal(contractsRootGetterExecuted, false);

    const runForgeVersionAccessorInput = { contractsRoot: root };
    let runForgeVersionGetterExecuted = false;
    Object.defineProperty(runForgeVersionAccessorInput, "runForgeVersion", {
      enumerable: true,
      get() {
        runForgeVersionGetterExecuted = true;
        return async () => EXPECTED_FORGE_OUTPUT;
      },
    });

    await assert.rejects(
      verifyArtifactConsistency(runForgeVersionAccessorInput),
      /tooling request.*runForgeVersion/,
    );
    assert.equal(runForgeVersionGetterExecuted, false);
  });
});

const invalidBuildInfoCases = [
  ["Solidity 版本", (value) => (value.solcVersion = "0.8.29"), /Solidity/],
  ["EVM Prague", (value) => (value.input.settings.evmVersion = "cancun"), /EVM/],
  ["optimizer enable", (value) => (value.input.settings.optimizer.enabled = false), /optimizer\.enabled/],
  ["optimizer runs", (value) => (value.input.settings.optimizer.runs = 201), /optimizer\.runs/],
  ["viaIR", (value) => (value.input.settings.viaIR = true), /viaIR/],
  ["metadata bytecodeHash", (value) => (value.input.settings.metadata.bytecodeHash = "none"), /metadata\.bytecodeHash/],
  ["metadata useLiteralContent", (value) => (value.input.settings.metadata.useLiteralContent = true), /metadata\.useLiteralContent/],
  ["metadata appendCBOR", (value) => (value.input.settings.metadata.appendCBOR = false), /metadata\.appendCBOR/],
  ["remapping", (value) => (value.input.settings.remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]), /remappings/],
  ["optimizer details 扩展字段", (value) => (value.input.settings.optimizer.details = { yul: true }), /optimizer 字段/],
  ["非空 libraries", (value) => (value.input.settings.libraries = { "src/A.sol": { A: "0x1111111111111111111111111111111111111111" } }), /libraries/],
  ["metadata 扩展字段", (value) => (value.input.settings.metadata.unexpected = true), /metadata 字段/],
  ["settings 扩展字段", (value) => (value.input.settings.debug = {}), /settings 字段/],
];

for (const [label, mutate, expectedError] of invalidBuildInfoCases) {
  test(`拒绝错误 ${label}`, async () => {
    await withFixture(async (root) => {
      await mutateJson(join(root, "out", "build-info", "fixture.json"), mutate);
      await assert.rejects(verify(root), expectedError);
    });
  });
}

test("拒绝错误 .foundry-version", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, ".foundry-version"), "1.5.0\n");
    await assert.rejects(verify(root), /\.foundry-version/);
  });
});

test("拒绝错误运行时 Foundry 版本", async () => {
  await withFixture(async (root) => {
    const output = EXPECTED_FORGE_OUTPUT.replace("1.5.1-stable", "1.5.0-stable");
    await assert.rejects(verify(root, output), /Foundry 版本/);
  });
});

test("拒绝错误 Foundry commit", async () => {
  await withFixture(async (root) => {
    const output = EXPECTED_FORGE_OUTPUT.replace(
      "b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2",
      "0000000000000000000000000000000000000000",
    );
    await assert.rejects(verify(root, output), /Foundry commit/);
  });
});

test("拒绝错误 OpenZeppelin tag", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      value["lib/openzeppelin-contracts"].tag.name = "v5.6.0";
    });
    await assert.rejects(verify(root), /OpenZeppelin tag/);
  });
});

test("拒绝错误 OpenZeppelin revision", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      value["lib/openzeppelin-contracts"].tag.rev = "0000000000000000000000000000000000000000";
    });
    await assert.rejects(verify(root), /OpenZeppelin revision/);
  });
});

test("拒绝 foundry.lock 额外依赖", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      value["lib/unexpected"] = {
        tag: { name: "v1.0.0", rev: "0000000000000000000000000000000000000000" },
      };
    });
    await assert.rejects(verify(root), /foundry\.lock 依赖字段/);
  });
});

test("拒绝 OpenZeppelin lock entry 额外字段", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      value["lib/openzeppelin-contracts"].unexpected = true;
    });
    await assert.rejects(verify(root), /OpenZeppelin lock entry 字段/);
  });
});

test("拒绝 OpenZeppelin tag 缺失字段", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      delete value["lib/openzeppelin-contracts"].tag.rev;
    });
    await assert.rejects(verify(root), /OpenZeppelin tag 字段/);
  });
});

test("拒绝 OpenZeppelin tag 额外字段", async () => {
  await withFixture(async (root) => {
    await mutateJson(join(root, "foundry.lock"), (value) => {
      value["lib/openzeppelin-contracts"].tag.unexpected = true;
    });
    await assert.rejects(verify(root), /OpenZeppelin tag 字段/);
  });
});

test("拒绝缺失 build-info", async () => {
  await withFixture(async (root) => {
    await rm(join(root, "out", "build-info", "fixture.json"));
    await assert.rejects(verify(root), /恰好一个 build-info/);
  });
});

test("拒绝多个 build-info", async () => {
  await withFixture(async (root) => {
    await writeFile(
      join(root, "out", "build-info", "second.json"),
      `${JSON.stringify(validBuildInfo(), null, 2)}\n`,
    );
    await assert.rejects(verify(root), /恰好一个 build-info/);
  });
});
