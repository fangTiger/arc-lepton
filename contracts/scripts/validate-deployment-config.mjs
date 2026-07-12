export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ROOT_FIELDS = [
  "chainId",
  "addresses",
  "code",
  "usdcDecimals",
  "implementationUpgradeability",
];
const ADDRESS_FIELDS = ["deployer", "registry", "implementation", "factory", "usdc"];
const CODE_FIELDS = ["registry", "implementation", "factory", "usdc"];
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NON_EMPTY_BYTECODE_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

export class DeploymentConfigValidationError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "DeploymentConfigValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new DeploymentConfigValidationError(code, path, message);
}

function configInvalid(path) {
  fail("CONFIG_INVALID", path, `${path} 必须是只含预期 enumerable own data properties 的普通对象`);
}

function safeReflection(path, operation) {
  try {
    return operation();
  } catch {
    configInvalid(path);
  }
}

function requireExactPlainDataRecord(value, expectedKeys, path) {
  if (value === null || typeof value !== "object") {
    configInvalid(path);
  }

  if (safeReflection(path, () => Array.isArray(value))) {
    configInvalid(path);
  }

  const prototype = safeReflection(path, () => Reflect.getPrototypeOf(value));
  if (prototype !== Object.prototype) {
    configInvalid(path);
  }

  const ownKeys = safeReflection(path, () => Reflect.ownKeys(value));
  const expectedKeySet = new Set(expectedKeys);
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expectedKeySet.has(key)) {
      configInvalid(path);
    }
  }

  const ownKeySet = new Set(ownKeys);
  const values = {};
  for (const key of expectedKeys) {
    if (!ownKeySet.has(key)) {
      values[key] = undefined;
      continue;
    }

    const descriptor = safeReflection(path, () => Reflect.getOwnPropertyDescriptor(value, key));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      configInvalid(path);
    }
    values[key] = descriptor.value;
  }
  return values;
}

function validateAddress(value, path) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    fail("ADDRESS_INVALID", path, `${path} 必须是严格的 20-byte 0x hex 地址`);
  }

  const normalized = value.toLowerCase();
  if (normalized === ZERO_ADDRESS) {
    fail("ADDRESS_ZERO", path, `${path} 不得为零地址`);
  }
  return normalized;
}

function validateCode(value, path) {
  if (value === undefined || value === null || value === "" || value === "0x") {
    fail("CODE_MISSING", path, `${path} 必须包含至少一个 byte 的合约 code`);
  }
  if (typeof value !== "string" || !NON_EMPTY_BYTECODE_PATTERN.test(value)) {
    fail("CODE_INVALID", path, `${path} 必须是偶数字节的非空 0x hex code`);
  }
  return value.toLowerCase();
}

export function validateDeploymentConfig(snapshot) {
  const root = requireExactPlainDataRecord(snapshot, ROOT_FIELDS, "$");

  if (root.chainId !== ARC_TESTNET_CHAIN_ID) {
    fail(
      "CHAIN_ID_MISMATCH",
      "chainId",
      `chainId 必须严格等于 ${ARC_TESTNET_CHAIN_ID}`,
    );
  }

  const inputAddresses = requireExactPlainDataRecord(
    root.addresses,
    ADDRESS_FIELDS,
    "addresses",
  );
  const addresses = {};
  for (const field of ADDRESS_FIELDS) {
    const path = `addresses.${field}`;
    addresses[field] = validateAddress(inputAddresses[field], path);
  }

  if (addresses.usdc !== ARC_TESTNET_USDC_ADDRESS) {
    fail(
      "USDC_UNSUPPORTED",
      "addresses.usdc",
      `addresses.usdc 必须等于 Arc Testnet 官方 USDC ${ARC_TESTNET_USDC_ADDRESS}`,
    );
  }

  const inputCode = requireExactPlainDataRecord(root.code, CODE_FIELDS, "code");
  const code = {};
  for (const field of CODE_FIELDS) {
    const path = `code.${field}`;
    code[field] = validateCode(inputCode[field], path);
  }

  if (
    typeof root.usdcDecimals !== "number" ||
    !Number.isInteger(root.usdcDecimals) ||
    root.usdcDecimals !== 6
  ) {
    fail(
      "USDC_DECIMALS_INVALID",
      "usdcDecimals",
      "usdcDecimals 必须严格等于整数 6",
    );
  }

  if (root.implementationUpgradeability !== "none") {
    fail(
      "IMPLEMENTATION_UPGRADEABLE",
      "implementationUpgradeability",
      "implementationUpgradeability 必须明确为 none",
    );
  }

  const normalizedAddresses = Object.freeze(addresses);
  const normalizedCode = Object.freeze(code);
  return Object.freeze({
    chainId: ARC_TESTNET_CHAIN_ID,
    addresses: normalizedAddresses,
    code: normalizedCode,
    usdcDecimals: 6,
    implementationUpgradeability: "none",
  });
}
