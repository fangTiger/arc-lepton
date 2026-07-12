import assert from "node:assert/strict";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
  DeploymentConfigValidationError,
  validateDeploymentConfig,
} from "./validate-deployment-config.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ALTERNATIVE_TOKEN = "0x1111111111111111111111111111111111111111";

function validSnapshot() {
  return {
    chainId: 5_042_002,
    addresses: {
      deployer: "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
      registry: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      implementation: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
      factory: "0xdDddDdddDDdDddDdDdDDdDdDDdDdDDdDDDDDDDDd",
      usdc: "0x3600000000000000000000000000000000000000",
    },
    code: {
      registry: "0x6001",
      implementation: "0xABcd",
      factory: "0x60026003",
      usdc: "0xFe",
    },
    usdcDecimals: 6,
    implementationUpgradeability: "none",
  };
}

function expectValidationError(mutate, expected) {
  const snapshot = validSnapshot();
  mutate(snapshot);

  expectSnapshotValidationError(snapshot, expected);
}

function expectSnapshotValidationError(snapshot, expected) {
  return assert.throws(
    () => validateDeploymentConfig(snapshot),
    (error) => {
      assert.ok(error instanceof DeploymentConfigValidationError);
      assert.equal(error.name, "DeploymentConfigValidationError");
      assert.equal(error.code, expected.code);
      assert.equal(error.path, expected.path);
      return true;
    },
  );
}

class CustomRecord {}

const nonPlainRecordCases = [
  ["Date", (source) => Object.assign(new Date(0), source)],
  ["class instance", (source) => Object.assign(new CustomRecord(), source)],
  ["继承字段", (source) => Object.create(source)],
  ["null prototype", (source) => Object.assign(Object.create(null), source)],
];

for (const [label, createRecord] of nonPlainRecordCases) {
  test(`拒绝 root ${label}，即使字段值完整`, () => {
    expectSnapshotValidationError(createRecord(validSnapshot()), {
      code: "CONFIG_INVALID",
      path: "$",
    });
  });

  test(`拒绝 addresses ${label}，即使字段值完整`, () => {
    const snapshot = validSnapshot();
    snapshot.addresses = createRecord(snapshot.addresses);
    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path: "addresses",
    });
  });

  test(`拒绝 code ${label}，即使字段值完整`, () => {
    const snapshot = validSnapshot();
    snapshot.code = createRecord(snapshot.code);
    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path: "code",
    });
  });
}

const containerCases = [
  ["root", "$", (snapshot) => snapshot, "chainId"],
  ["addresses", "addresses", (snapshot) => snapshot.addresses, "deployer"],
  ["code", "code", (snapshot) => snapshot.code, "registry"],
];

const extraOwnKeyCases = [
  ["额外字符串 key", (record) => {
    record.unexpected = true;
  }],
  ["额外 symbol key", (record) => {
    record[Symbol("unexpected")] = true;
  }],
  ["额外非枚举 key", (record) => {
    Object.defineProperty(record, "unexpected", {
      value: true,
      configurable: true,
      enumerable: false,
    });
  }],
];

for (const [containerLabel, path, selectRecord] of containerCases) {
  for (const [keyLabel, addKey] of extraOwnKeyCases) {
    test(`拒绝 ${containerLabel} ${keyLabel}`, () => {
      const snapshot = validSnapshot();
      addKey(selectRecord(snapshot));
      expectSnapshotValidationError(snapshot, {
        code: "CONFIG_INVALID",
        path,
      });
    });
  }
}

for (const [containerLabel, path, selectRecord, field] of containerCases) {
  test(`拒绝 ${containerLabel} 已知字段的非枚举 data property`, () => {
    const snapshot = validSnapshot();
    const record = selectRecord(snapshot);
    const value = record[field];
    Object.defineProperty(record, field, {
      value,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path,
    });
  });

  test(`拒绝 ${containerLabel} accessor 且绝不执行 getter`, () => {
    const snapshot = validSnapshot();
    const record = selectRecord(snapshot);
    let getterCalls = 0;
    Object.defineProperty(record, field, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new TypeError("不应执行 getter");
      },
    });

    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path,
    });
    assert.equal(getterCalls, 0);
  });
}

for (const [containerLabel, path, selectRecord] of containerCases) {
  test(`拒绝 ${containerLabel} revoked Proxy 且不泄漏原生异常`, () => {
    const snapshot = validSnapshot();
    const {proxy, revoke} = Proxy.revocable(selectRecord(snapshot), {});
    if (containerLabel === "root") {
      revoke();
      expectSnapshotValidationError(proxy, {
        code: "CONFIG_INVALID",
        path,
      });
      return;
    }

    snapshot[containerLabel] = proxy;
    revoke();
    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path,
    });
  });
}

const throwingProxyTrapCases = [
  ["root getPrototypeOf", "$", (snapshot, proxy) => proxy, "getPrototypeOf"],
  ["addresses ownKeys", "addresses", (snapshot, proxy) => {
    snapshot.addresses = proxy;
    return snapshot;
  }, "ownKeys"],
  ["code getOwnPropertyDescriptor", "code", (snapshot, proxy) => {
    snapshot.code = proxy;
    return snapshot;
  }, "getOwnPropertyDescriptor"],
];

for (const [label, path, install, trap] of throwingProxyTrapCases) {
  test(`将 ${label} trap 异常转换为稳定 CONFIG_INVALID`, () => {
    const snapshot = validSnapshot();
    const target = path === "$" ? snapshot : snapshot[path];
    const proxy = new Proxy(target, {
      [trap]() {
        throw new TypeError(`${trap} trap failed`);
      },
    });
    const input = install(snapshot, proxy);
    expectSnapshotValidationError(input, {
      code: "CONFIG_INVALID",
      path,
    });
  });
}

const invalidSnapshotCases = [
  ["null", null],
  ["array", []],
  ["非对象", "5042002"],
];

for (const [label, snapshot] of invalidSnapshotCases) {
  test(`拒绝 ${label} snapshot 容器且不泄漏 TypeError`, () => {
    expectSnapshotValidationError(snapshot, {
      code: "CONFIG_INVALID",
      path: "$",
    });
  });
}

const invalidChainCases = [
  ["错误数字", 1],
  ["字符串", "5042002"],
  ["缺失", undefined],
];

for (const [label, value] of invalidChainCases) {
  test(`拒绝${label} chainId，且输入不能覆盖内置 Arc chainId`, () => {
    expectValidationError(
      (snapshot) => {
        if (value === undefined) {
          delete snapshot.chainId;
        } else {
          snapshot.chainId = value;
        }
      },
      { code: "CHAIN_ID_MISMATCH", path: "chainId" },
    );
  });
}

const addressFields = ["deployer", "registry", "implementation", "factory", "usdc"];

const invalidAddressesContainerCases = [
  ["缺失", undefined],
  ["null", null],
  ["array", []],
];

for (const [label, value] of invalidAddressesContainerCases) {
  test(`拒绝 addresses ${label}容器且不泄漏 TypeError`, () => {
    expectValidationError(
      (snapshot) => {
        if (value === undefined) {
          delete snapshot.addresses;
        } else {
          snapshot.addresses = value;
        }
      },
      { code: "CONFIG_INVALID", path: "addresses" },
    );
  });
}

for (const field of addressFields) {
  test(`拒绝缺失 addresses.${field}`, () => {
    expectValidationError(
      (snapshot) => {
        delete snapshot.addresses[field];
      },
      { code: "ADDRESS_INVALID", path: `addresses.${field}` },
    );
  });

  test(`拒绝 addresses.${field} 零地址`, () => {
    expectValidationError(
      (snapshot) => {
        snapshot.addresses[field] = ZERO_ADDRESS;
      },
      { code: "ADDRESS_ZERO", path: `addresses.${field}` },
    );
  });

  test(`拒绝 addresses.${field} 非严格 20-byte 0x hex`, () => {
    expectValidationError(
      (snapshot) => {
        snapshot.addresses[field] = "0x1234";
      },
      { code: "ADDRESS_INVALID", path: `addresses.${field}` },
    );
  });
}

test("拒绝地址使用大写 0X 前缀", () => {
  expectValidationError(
    (snapshot) => {
      snapshot.addresses.deployer = `0X${"11".repeat(20)}`;
    },
    { code: "ADDRESS_INVALID", path: "addresses.deployer" },
  );
});

test("拒绝全大写形式的零地址", () => {
  expectValidationError(
    (snapshot) => {
      snapshot.addresses.deployer = ZERO_ADDRESS.toUpperCase();
    },
    { code: "ADDRESS_INVALID", path: "addresses.deployer" },
  );
});

const codeFields = ["registry", "implementation", "factory", "usdc"];
const invalidCodeContainerCases = [
  ["缺失", undefined],
  ["null", null],
  ["array", []],
];

for (const [label, value] of invalidCodeContainerCases) {
  test(`拒绝 code ${label}容器且不泄漏 TypeError`, () => {
    expectValidationError(
      (snapshot) => {
        if (value === undefined) {
          delete snapshot.code;
        } else {
          snapshot.code = value;
        }
      },
      { code: "CONFIG_INVALID", path: "code" },
    );
  });
}

const invalidCodeCases = [
  ["空 code", "0x", "CODE_MISSING"],
  ["缺失 code", undefined, "CODE_MISSING"],
  ["奇数 hex", "0x0", "CODE_INVALID"],
  ["非 hex", "0xgg", "CODE_INVALID"],
  ["不可判定状态", "unknown", "CODE_INVALID"],
];

for (const field of codeFields) {
  for (const [label, value, code] of invalidCodeCases) {
    test(`拒绝 code.${field} 的${label}`, () => {
      expectValidationError(
        (snapshot) => {
          if (value === undefined) {
            delete snapshot.code[field];
          } else {
            snapshot.code[field] = value;
          }
        },
        { code, path: `code.${field}` },
      );
    });
  }
}

test("拒绝 code 使用大写 0X 前缀", () => {
  expectValidationError(
    (snapshot) => {
      snapshot.code.registry = "0X6001";
    },
    { code: "CODE_INVALID", path: "code.registry" },
  );
});

const invalidDecimalsCases = [
  ["不是 6", 18],
  ["字符串 6", "6"],
  ["缺失", undefined],
  ["非整数", 6.5],
  ["NaN", Number.NaN],
  ["正 Infinity", Number.POSITIVE_INFINITY],
  ["负 Infinity", Number.NEGATIVE_INFINITY],
];

for (const [label, value] of invalidDecimalsCases) {
  test(`拒绝 usdcDecimals ${label}`, () => {
    expectValidationError(
      (snapshot) => {
        if (value === undefined) {
          delete snapshot.usdcDecimals;
        } else {
          snapshot.usdcDecimals = value;
        }
      },
      { code: "USDC_DECIMALS_INVALID", path: "usdcDecimals" },
    );
  });
}

const invalidUpgradeabilityCases = [
  ["transparent", "transparent"],
  ["uups", "uups"],
  ["beacon", "beacon"],
  ["erc1967", "erc1967"],
  ["unknown", "unknown"],
  ["非字符串", null],
  ["缺失", undefined],
];

for (const [label, value] of invalidUpgradeabilityCases) {
  test(`拒绝 implementationUpgradeability ${label}`, () => {
    expectValidationError(
      (snapshot) => {
        if (value === undefined) {
          delete snapshot.implementationUpgradeability;
        } else {
          snapshot.implementationUpgradeability = value;
        }
      },
      {
        code: "IMPLEMENTATION_UPGRADEABLE",
        path: "implementationUpgradeability",
      },
    );
  });
}

test("拒绝另一个有 code 且 decimals=6 的 token，输入不能覆盖官方 USDC", () => {
  expectValidationError(
    (snapshot) => {
      snapshot.addresses.usdc = ALTERNATIVE_TOKEN;
      snapshot.code.usdc = "0x6001";
      snapshot.usdcDecimals = 6;
    },
    { code: "USDC_UNSUPPORTED", path: "addresses.usdc" },
  );
});

test("完整合法快照返回规范化深拷贝且不修改输入", () => {
  const snapshot = validSnapshot();
  const original = structuredClone(snapshot);

  const summary = validateDeploymentConfig(snapshot);

  assert.equal(ARC_TESTNET_CHAIN_ID, 5_042_002);
  assert.equal(
    ARC_TESTNET_USDC_ADDRESS,
    "0x3600000000000000000000000000000000000000",
  );
  assert.deepEqual(summary, {
    chainId: 5_042_002,
    addresses: {
      deployer: original.addresses.deployer.toLowerCase(),
      registry: original.addresses.registry.toLowerCase(),
      implementation: original.addresses.implementation.toLowerCase(),
      factory: original.addresses.factory.toLowerCase(),
      usdc: ARC_TESTNET_USDC_ADDRESS,
    },
    code: {
      registry: original.code.registry.toLowerCase(),
      implementation: original.code.implementation.toLowerCase(),
      factory: original.code.factory.toLowerCase(),
      usdc: original.code.usdc.toLowerCase(),
    },
    usdcDecimals: 6,
    implementationUpgradeability: "none",
  });
  assert.deepEqual(snapshot, original);
  assert.notEqual(summary, snapshot);
  assert.notEqual(summary.addresses, snapshot.addresses);
  assert.notEqual(summary.code, snapshot.code);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.addresses), true);
  assert.equal(Object.isFrozen(summary.code), true);

  snapshot.addresses.registry = ZERO_ADDRESS;
  snapshot.code.registry = "0x";
  assert.equal(summary.addresses.registry, original.addresses.registry.toLowerCase());
  assert.equal(summary.code.registry, original.code.registry.toLowerCase());

  assert.throws(() => {
    summary.chainId = 1;
  }, TypeError);
  assert.throws(() => {
    summary.addresses.factory = ZERO_ADDRESS;
  }, TypeError);
  assert.throws(() => {
    summary.code.factory = "0x";
  }, TypeError);
  assert.equal(snapshot.addresses.factory, original.addresses.factory);
  assert.equal(snapshot.code.factory, original.code.factory);
});
