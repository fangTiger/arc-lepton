import assert from "node:assert/strict";
import test from "node:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
} from "./validate-deployment-config.mjs";
import { digestAuthorizationRequest } from "./deployment-authorization-gate.mjs";
import {
  DeploymentPreflightGateError,
  buildDeploymentPreflightReport,
} from "./deployment-preflight-gate.mjs";

const COMMIT = "a".repeat(40);
const OLD_COMMIT = "b".repeat(40);
const DEPLOYER = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333";
const FACTORY = "0x4444444444444444444444444444444444444444";
const FACTORY_SAFE = "0x5555555555555555555555555555555555555555";
const REGISTRY_SAFE = "0x6666666666666666666666666666666666666666";
const SOURCE_ADMIN = "0x7777777777777777777777777777777777777777";
const FUNDING_SIGNER = "0x8888888888888888888888888888888888888888";
const INTENT_SIGNER = "0x9999999999999999999999999999999999999999";
const SETTLER = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const SMOKE_BUYER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const SMOKE_PAYOUT = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const SOURCE_PAYOUT_1 = "0xdDDDDdddDDDDdDddDdDdDDDDdDDDDdDdDdDDDDdD";
const SOURCE_PAYOUT_2 = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const SOURCE_PAYOUT_3 = "0xfFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";
const SOURCE_PAYOUT_4 = "0x1234567890123456789012345678901234567890";
const SOURCE_PAYOUT_5 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function deployRequest(overrides = {}) {
  const request = {
    schemaVersion: 1,
    stage: "deploy_core_contracts",
    requiresFreshUserAuthorization: true,
    chainId: ARC_TESTNET_CHAIN_ID,
    commit: COMMIT,
    deployer: DEPLOYER,
    estimatedGas: "3000000",
    maxUsdcUnits: "0",
    transactions: [
      "deploy DataSourceRegistry",
      "deploy ResearchEscrow implementation",
      "deploy ResearchEscrowFactory",
      "bind Registry to Factory",
    ],
    expectedAddresses: {
      registry: REGISTRY,
      implementation: IMPLEMENTATION,
      factory: FACTORY,
    },
    coreArtifacts: [
      "src/registry/DataSourceRegistry.sol:DataSourceRegistry",
      "src/escrow/ResearchEscrow.sol:ResearchEscrow",
      "src/factory/ResearchEscrowFactory.sol:ResearchEscrowFactory",
    ],
    ...overrides,
  };
  return {
    ...request,
    requestDigest: digestAuthorizationRequest(request),
  };
}

function authorizationFor(request, overrides = {}) {
  return {
    stage: request.stage,
    chainId: request.chainId,
    commit: request.commit,
    requestDigest: request.requestDigest,
    approved: true,
    approvedAt: "2026-07-11T01:00:00.000Z",
    operator: "captain",
    ...overrides,
  };
}

function source(sourceId, payout, overrides = {}) {
  return {
    sourceId,
    payout,
    maxUnitPrice: "1000",
    active: true,
    ...overrides,
  };
}

function validSources() {
  return [
    source(`0x${"01".repeat(32)}`, SOURCE_PAYOUT_1),
    source(`0x${"02".repeat(32)}`, SOURCE_PAYOUT_2),
    source(`0x${"03".repeat(32)}`, SOURCE_PAYOUT_3),
    source(`0x${"04".repeat(32)}`, SOURCE_PAYOUT_4),
    source(`0x${"05".repeat(32)}`, SOURCE_PAYOUT_5),
  ];
}

function validInput(overrides = {}) {
  const request = deployRequest();
  const input = {
    authorization: {
      request,
      authorization: authorizationFor(request),
    },
    git: {
      commit: COMMIT,
      clean: true,
      statusPorcelain: "",
      submoduleStatus: "",
    },
    compiler: {
      solidityVersion: "0.8.30",
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "prague",
        viaIR: false,
        metadata: {
          bytecodeHash: "ipfs",
          appendCBOR: true,
          useLiteralContent: false,
        },
      },
    },
    deployer: {
      address: DEPLOYER,
      balanceWei: "1000000000000000000",
      minBalanceWei: "100000000000000000",
    },
    roles: {
      factoryGovernanceSafe: FACTORY_SAFE,
      registryGovernanceSafe: REGISTRY_SAFE,
      sourceAdmin: SOURCE_ADMIN,
      fundingSigner: FUNDING_SIGNER,
      intentSigner: INTENT_SIGNER,
      settler: SETTLER,
      smokeBuyer: SMOKE_BUYER,
      smokePayout: SMOKE_PAYOUT,
    },
    accountCode: {
      factoryGovernanceSafe: { hasCode: true },
      registryGovernanceSafe: { hasCode: true },
      intentSigner: { hasCode: false },
    },
    protocol: {
      registry: REGISTRY,
      implementation: IMPLEMENTATION,
      factory: FACTORY,
      usdc: ARC_TESTNET_USDC_ADDRESS,
    },
    sources: validSources(),
    expectedSourceCount: 5,
    usdc: {
      chainId: ARC_TESTNET_CHAIN_ID,
      address: ARC_TESTNET_USDC_ADDRESS,
      decimals: 6,
      hasCode: true,
    },
    rpc: {
      chainId: ARC_TESTNET_CHAIN_ID,
      publicRpcNetwork: "Arc Testnet public RPC",
      finalizedBlockNumber: 8_000_020,
      finalizedBlockHash: BLOCK_HASH,
      url: "https://rpc.testnet.arc.example",
    },
  };

  return structuredClone({ ...input, ...overrides });
}

function expectPreflightError(mutator, expectedCode, options = {}) {
  const input = validInput();
  mutator(input);
  assert.throws(
    () => buildDeploymentPreflightReport(input),
    (error) => {
      assert.ok(error instanceof DeploymentPreflightGateError);
      assert.equal(error.name, "DeploymentPreflightGateError");
      assert.equal(error.code, expectedCode);
      if (options.path !== undefined) {
        assert.equal(error.path, options.path);
      }
      if (options.notIncludes !== undefined) {
        assert.equal(error.message.includes(options.notIncludes), false);
      }
      return true;
    },
  );
}

test("合法部署授权与本地快照生成 ready preflight report", () => {
  const report = buildDeploymentPreflightReport(validInput());

  assert.equal(report.ready, true);
  assert.equal(report.stage, "deploy_core_contracts");
  assert.equal(report.chainId, ARC_TESTNET_CHAIN_ID);
  assert.equal(report.commit, COMMIT);
  assert.equal(report.authorizationDigest, deployRequest().requestDigest);
  assert.ok(report.checks.length >= 10);
  assert.ok(report.checks.every((check) => check.pass === true));
  assert.deepEqual(report.summary.protocol, {
    factory: FACTORY.toLowerCase(),
    implementation: IMPLEMENTATION.toLowerCase(),
    registry: REGISTRY.toLowerCase(),
    usdc: ARC_TESTNET_USDC_ADDRESS,
  });
  assert.equal(report.summary.sources.length, 5);
  assert.equal(JSON.stringify(report).includes("rpc.testnet.arc.example"), false);
});

test("缺授权、错阶段、拒绝授权和旧 digest 都 fail closed", () => {
  expectPreflightError((input) => {
    delete input.authorization;
  }, "AUTHORIZATION_INVALID");

  expectPreflightError((input) => {
    const request = deployRequest({ stage: "configure_sources_and_roles" });
    input.authorization = {
      request,
      authorization: authorizationFor(request),
    };
  }, "AUTHORIZATION_STAGE_INVALID");

  expectPreflightError((input) => {
    input.authorization.authorization.approved = false;
  }, "AUTHORIZATION_INVALID");

  expectPreflightError((input) => {
    input.authorization.request.estimatedGas = "3000001";
  }, "AUTHORIZATION_INVALID");
});

test("dirty git、commit mismatch 和 compiler settings drift 都失败", () => {
  expectPreflightError((input) => {
    input.git.statusPorcelain = " M contracts/src/escrow/ResearchEscrow.sol";
  }, "GIT_DIRTY");

  expectPreflightError((input) => {
    input.git.commit = OLD_COMMIT;
  }, "GIT_COMMIT_MISMATCH");

  for (const mutate of [
    (input) => {
      input.compiler.solidityVersion = "0.8.29";
    },
    (input) => {
      input.compiler.settings.evmVersion = "cancun";
    },
    (input) => {
      input.compiler.settings.optimizer.enabled = false;
    },
    (input) => {
      input.compiler.settings.optimizer.runs = 201;
    },
    (input) => {
      input.compiler.settings.viaIR = true;
    },
    (input) => {
      input.compiler.settings.metadata.bytecodeHash = "none";
    },
    (input) => {
      input.compiler.settings.metadata.appendCBOR = false;
    },
    (input) => {
      input.compiler.settings.metadata.useLiteralContent = true;
    },
  ]) {
    expectPreflightError(mutate, "COMPILER_SETTINGS_INVALID");
  }
});

test("deployer 余额不足或与最终敏感角色重叠都失败", () => {
  expectPreflightError((input) => {
    input.deployer.balanceWei = "999";
    input.deployer.minBalanceWei = "1000";
  }, "DEPLOYER_BALANCE_INSUFFICIENT");

  expectPreflightError((input) => {
    input.roles.settler = DEPLOYER;
  }, "ADDRESS_OVERLAP");
});

test("governance Safe 无 code、intentSigner 有 code 或角色重复都失败", () => {
  expectPreflightError((input) => {
    input.accountCode.factoryGovernanceSafe.hasCode = false;
  }, "ACCOUNT_CODE_INVALID");

  expectPreflightError((input) => {
    input.accountCode.registryGovernanceSafe.hasCode = false;
  }, "ACCOUNT_CODE_INVALID");

  expectPreflightError((input) => {
    input.accountCode.intentSigner.hasCode = true;
  }, "ACCOUNT_CODE_INVALID");

  expectPreflightError((input) => {
    input.roles.sourceAdmin = FUNDING_SIGNER;
  }, "ADDRESS_OVERLAP");
});

test("source 数量、sourceId、payout 隔离和 maxUnitPrice 都被严格校验", () => {
  expectPreflightError((input) => {
    input.sources.pop();
  }, "SOURCE_COUNT_INVALID");

  expectPreflightError((input) => {
    input.sources[1].sourceId = input.sources[0].sourceId;
  }, "SOURCE_ID_DUPLICATE");

  expectPreflightError((input) => {
    input.sources[0].payout = input.roles.smokeBuyer;
  }, "ADDRESS_OVERLAP");

  expectPreflightError((input) => {
    input.sources[0].payout = input.protocol.factory;
  }, "ADDRESS_OVERLAP");

  expectPreflightError((input) => {
    input.sources[0].maxUnitPrice = "0";
  }, "DECIMAL_POSITIVE_INVALID");
});

test("官方 USDC 和 RPC finality 快照错误都会失败", () => {
  for (const [mutate, code] of [
    [
      (input) => {
        input.usdc.address = "0x0000000000000000000000000000000000000001";
      },
      "USDC_ADDRESS_INVALID",
    ],
    [
      (input) => {
        input.usdc.decimals = 18;
      },
      "USDC_DECIMALS_INVALID",
    ],
    [
      (input) => {
        input.usdc.hasCode = false;
      },
      "USDC_CODE_MISSING",
    ],
    [
      (input) => {
        input.rpc.chainId = ARC_TESTNET_CHAIN_ID + 1;
      },
      "RPC_CHAIN_ID_INVALID",
    ],
    [
      (input) => {
        input.rpc.finalizedBlockNumber = 0;
      },
      "RPC_FINALITY_INVALID",
    ],
    [
      (input) => {
        input.rpc.finalizedBlockHash = `0x${"ab".repeat(31)}`;
      },
      "RPC_FINALITY_INVALID",
    ],
  ]) {
    expectPreflightError(mutate, code);
  }

  expectPreflightError((input) => {
    input.protocol.factory = REGISTRY;
  }, "PROTOCOL_ADDRESS_MISMATCH");
});

test("RPC URL 或 credential 字段带凭据时失败且错误不回显秘密", () => {
  expectPreflightError((input) => {
    input.rpc.url = "https://captain:super-secret@rpc.testnet.arc.example";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "super-secret" });

  expectPreflightError((input) => {
    input.rpc.credential = "super-secret-token";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "super-secret-token" });

  expectPreflightError((input) => {
    input.rpc.url = "https://rpc.testnet.arc.example?api_key=super-secret-query";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "super-secret-query" });

  expectPreflightError((input) => {
    input.rpc.publicRpcNetwork = "https://captain:super-secret-label@rpc.testnet.arc.example";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "super-secret-label" });

  expectPreflightError((input) => {
    input.rpc.publicRpcNetwork = "//captain:hunter2@rpc.testnet.arc.example/private";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "hunter2" });

  expectPreflightError((input) => {
    input.rpc.publicRpcNetwork = " //captain:hunter2@rpc.testnet.arc.example/private";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "hunter2" });

  expectPreflightError((input) => {
    input.rpc.publicRpcNetwork = "mailto:ops@example.com";
  }, "RPC_CREDENTIAL_FORBIDDEN");

  expectPreflightError((input) => {
    input.rpc.publicRpcNetwork = "Arc Testnet token super-secret-label";
  }, "RPC_CREDENTIAL_FORBIDDEN", { notIncludes: "super-secret-label" });
});

test("异常 getter 必须转换为稳定门禁错误且不泄漏原生 secret", () => {
  expectPreflightError((input) => {
    Object.defineProperty(input.rpc, "publicRpcNetwork", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("super-secret-from-getter");
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-from-getter" });

  expectPreflightError((input) => {
    Object.defineProperty(input.rpc, "publicRpcNetwork", {
      configurable: true,
      enumerable: true,
      get() {
        throw new DeploymentPreflightGateError(
          "ATTACK",
          "rpc.publicRpcNetwork",
          "super-secret-from-gate-getter",
        );
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-from-gate-getter" });

  expectPreflightError((input) => {
    Object.defineProperty(input.rpc, "finalizedBlockHash", {
      configurable: true,
      enumerable: true,
      get() {
        throw new DeploymentPreflightGateError(
          "ATTACK",
          "rpc.finalizedBlockHash",
          "super-secret-from-finality-getter",
        );
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-from-finality-getter" });

  expectPreflightError((input) => {
    Object.defineProperty(input.authorization.request, "stage", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("super-secret-from-authorization-getter");
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-from-authorization-getter" });

  expectPreflightError((input) => {
    Object.defineProperty(input.authorization.request.transactions, "map", {
      configurable: true,
      enumerable: true,
      value() {
        return [{
          get target() {
            const error = new Error("super-secret-array-map");
            error.name = "DeploymentAuthorizationGateError";
            throw error;
          },
        }];
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-array-map" });
});

test("null-prototype preflight input containers fail closed as non-plain objects", () => {
  assert.throws(
    () => buildDeploymentPreflightReport(Object.assign(Object.create(null), validInput())),
    (error) =>
      error instanceof DeploymentPreflightGateError
      && error.code === "PREFLIGHT_INPUT_INVALID"
      && error.path === "$",
  );

  expectPreflightError((input) => {
    input.rpc = Object.assign(Object.create(null), input.rpc);
  }, "PREFLIGHT_INPUT_INVALID", { path: "$.rpc" });
});

test("旧调用泄露出的内部错误对象不能在新调用中被当作内部错误透传", () => {
  let markedInternalError;
  try {
    buildDeploymentPreflightReport(null);
  } catch (error) {
    markedInternalError = error;
  }

  try {
    markedInternalError.message = "super-secret-mutated-internal-error";
  } catch {
    // 如果实现冻结错误对象，赋值失败也是可接受的安全行为。
  }

  expectPreflightError((input) => {
    Object.defineProperty(input, "authorization", {
      configurable: true,
      enumerable: true,
      get() {
        throw markedInternalError;
      },
    });
  }, "PREFLIGHT_INPUT_INVALID", { notIncludes: "super-secret-mutated-internal-error" });
});
