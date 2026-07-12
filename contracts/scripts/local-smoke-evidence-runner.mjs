import { validateDeploymentManifest } from "./deployment-manifest.mjs";
import { OFFICIAL_ARC_TESTNET_USDC_ADDRESS } from "./rpc-deployment-verifier.mjs";
import { verifyArcSmokeEvidence } from "./smoke-evidence-verifier.mjs";

export class LocalSmokeEvidenceRunnerError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "LocalSmokeEvidenceRunnerError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new LocalSmokeEvidenceRunnerError(code, path, message);
}

function normalizeAddress(address) {
  return String(address).toLowerCase();
}

const REQUIRED_HARNESS_METHODS = ["approve", "createAndFund", "activate", "settleBatch", "close"];

function requireInputDataDescriptor(descriptor, path) {
  if (descriptor === undefined) {
    fail("LOCAL_SMOKE_INPUT_INVALID", path, `${path} 缺少字段`);
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("LOCAL_SMOKE_INPUT_INVALID", path, `${path} 只能包含 JSON-like 可枚举 data property`);
  }
  return descriptor.value;
}

function requireRunnerInputEnvelope(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("LOCAL_SMOKE_INPUT_INVALID", "$", "$ 必须是对象");
  }
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    fail("LOCAL_SMOKE_INPUT_INVALID", "$", "$ 只能是 JSON-like plain object");
  }
  if (Object.getOwnPropertySymbols(input).length !== 0) {
    fail("LOCAL_SMOKE_INPUT_INVALID", "$", "$ 不得包含 symbol key");
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownNames = Object.getOwnPropertyNames(input);
  const enumerableKeys = Object.keys(input);
  if (ownNames.length !== enumerableKeys.length) {
    fail("LOCAL_SMOKE_INPUT_INVALID", "$", "$ 只能包含 JSON-like 可枚举 data property");
  }
  for (const key of enumerableKeys) {
    requireInputDataDescriptor(descriptors[key], `$.${key}`);
  }

  return {
    manifest: requireInputDataDescriptor(descriptors.manifest, "$.manifest"),
    harness: requireInputDataDescriptor(descriptors.harness, "$.harness"),
  };
}

function findPropertyDescriptor(value, property) {
  let current = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function requireHarnessDataDescriptor(descriptor, path, missingMessage) {
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
    fail("LOCAL_SMOKE_HARNESS_INVALID", path, missingMessage);
  }
  return descriptor.value;
}

function requireHarnessMethod(harness, method) {
  const value = requireHarnessDataDescriptor(
    findPropertyDescriptor(harness, method),
    `harness.${method}`,
    `harness 必须实现 ${method}() data function`,
  );
  if (typeof value !== "function") {
    fail("LOCAL_SMOKE_HARNESS_INVALID", `harness.${method}`, `harness 必须实现 ${method}() data function`);
  }
  return value;
}

function optionalHarnessDataValue(harness, property, fallback) {
  const descriptor = findPropertyDescriptor(harness, property);
  if (descriptor === undefined) {
    return fallback;
  }
  const value = requireHarnessDataDescriptor(
    descriptor,
    `harness.${property}`,
    `harness.${property} 必须是 data property`,
  );
  return value ?? fallback;
}

function requireHarness(harness) {
  if (harness === null || typeof harness !== "object" || Array.isArray(harness)) {
    fail("LOCAL_SMOKE_HARNESS_INVALID", "harness", "local smoke harness 必须是对象");
  }
  const methods = {};
  for (const method of REQUIRED_HARNESS_METHODS) {
    methods[method] = requireHarnessMethod(harness, method);
  }
  return {
    target: harness,
    methods,
    nativeEmitterMode: optionalHarnessDataValue(harness, "nativeEmitterMode", "mock-precompile"),
    nativeEmitterReason: optionalHarnessDataValue(
      harness,
      "nativeEmitterReason",
      "Arc native USDC system emitter is represented by a deterministic local precompile harness",
    ),
  };
}

async function runHarnessStep(harness, method, input) {
  const result = await harness.methods[method].call(harness.target, input);
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    fail("LOCAL_SMOKE_STEP_INVALID", `harness.${method}`, `${method}() 必须返回 evidence 对象`);
  }
  return result;
}

function firstNonZeroClone(manifest) {
  const clone = manifest.clones.find((item) => BigInt(item.initialBudget) > 0n);
  if (clone === undefined) {
    fail("LOCAL_SMOKE_CLONE_MISSING", "manifest.clones", "local smoke runner 需要一个非零资助 clone 证据目标");
  }
  return clone;
}

function decimalDifference(left, right) {
  return (BigInt(left) - BigInt(right)).toString();
}

export async function runLocalSmokeEvidence(input) {
  const { manifest: inputManifest, harness: inputHarness } = requireRunnerInputEnvelope(input);
  const manifest = validateDeploymentManifest(inputManifest);
  const harness = requireHarness(inputHarness);
  const clone = firstNonZeroClone(manifest);
  const buyer = normalizeAddress(clone.buyer);
  const payout = normalizeAddress(manifest.roles.smokePayout);
  const factory = normalizeAddress(manifest.addresses.factory);
  const registry = normalizeAddress(manifest.addresses.registry);
  const implementation = normalizeAddress(manifest.addresses.implementation);
  const intentSigner = normalizeAddress(manifest.roles.intentSigner);
  const settler = normalizeAddress(manifest.roles.settler);
  const cloneAddress = normalizeAddress(clone.clone);
  const budgetUnits = clone.initialBudget;

  const approval = await runHarnessStep(harness, "approve", {
    owner: buyer,
    spender: factory,
    token: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    amountUnits: budgetUnits,
  });
  const funding = await runHarnessStep(harness, "createAndFund", {
    buyer,
    factory,
    registry,
    implementation,
    clone: cloneAddress,
    researchKey: clone.researchKey,
    budgetUnits,
    token: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
  });
  const activation = await runHarnessStep(harness, "activate", {
    clone: cloneAddress,
    buyer,
    researchKey: clone.researchKey,
    intentSigner,
    expectedStateBefore: "Funded",
    expectedStateAfter: "Active",
  });
  const settlement = await runHarnessStep(harness, "settleBatch", {
    clone: cloneAddress,
    payout,
    researchKey: clone.researchKey,
    intentSigner,
    settler,
  });
  const refundUnits = decimalDifference(budgetUnits, settlement.amountUnits ?? "0");
  const close = await runHarnessStep(harness, "close", {
    clone: cloneAddress,
    buyer,
    researchKey: clone.researchKey,
    intentSigner,
    settler,
    refundUnits,
  });

  const evidence = {
    chainId: manifest.chainId,
    clone: cloneAddress,
    buyer,
    payout,
    factory,
    registry,
    implementation,
    usdc: OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    researchKey: clone.researchKey,
    initialBudgetUnits: budgetUnits,
    nativeEmitterHarness: {
      mode: harness.nativeEmitterMode,
      reason: harness.nativeEmitterReason,
    },
    approval,
    funding,
    activation,
    settlement,
    close,
  };

  return {
    evidence,
    verification: verifyArcSmokeEvidence({ manifest, evidence }),
  };
}
