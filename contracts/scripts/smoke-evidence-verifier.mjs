import { validateDeploymentManifest } from "./deployment-manifest.mjs";
import {
  ARC_NATIVE_USDC_SYSTEM_EMITTER,
  ARC_TESTNET_CHAIN_ID,
  OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
} from "./rpc-deployment-verifier.mjs";

const ARC_NATIVE_USDC_SCALE = 1_000_000_000_000n;

export class SmokeEvidenceVerificationError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "SmokeEvidenceVerificationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new SmokeEvidenceVerificationError(code, path, message);
}

function normalizeAddress(address) {
  return String(address).toLowerCase();
}

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是对象`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是非空字符串`);
  }
  return value;
}

function requireAddress(value, path) {
  const address = requireString(value, path);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是 EVM 地址`);
  }
  return normalizeAddress(address);
}

function requireBytes32(value, path) {
  const bytes32 = requireString(value, path);
  if (!/^0x[0-9a-fA-F]{64}$/.test(bytes32)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是 bytes32`);
  }
  return bytes32.toLowerCase();
}

function requireUnsignedDecimal(value, path) {
  const text = requireString(value, path);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是十进制非负整数`);
  }
  return text;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是 boolean`);
  }
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是数组`);
  }
  return value;
}

function requireJsonDataDescriptor(descriptor, path) {
  if (descriptor === undefined) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 缺少字段`);
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 只能包含 JSON-like 可枚举 data property`);
  }
  return descriptor.value;
}

function rejectSymbols(value, path) {
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 不得包含 symbol key`);
  }
}

function requirePlainJsonRecord(value, path) {
  requireRecord(value, path);
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 只能是 JSON-like plain object`);
  }
  rejectSymbols(value, path);
  return value;
}

function safeJsonCloneArray(value, path, seen) {
  if (seen.has(value)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 不得包含循环引用`);
  }
  seen.add(value);
  rejectSymbols(value, path);

  const ownNames = Object.getOwnPropertyNames(value);
  const allowedNames = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  const extraName = ownNames.find((name) => !allowedNames.has(name));
  if (extraName !== undefined) {
    fail("SMOKE_EVIDENCE_INVALID", `${path}.${extraName}`, `${path} 数组不得包含额外属性`);
  }

  const cloned = [];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const item = requireJsonDataDescriptor(descriptors[index], itemPath);
    cloned.push(safeJsonClone(item, itemPath, seen));
  }
  seen.delete(value);
  return cloned;
}

function safeJsonCloneRecord(value, path, seen) {
  requirePlainJsonRecord(value, path);
  if (seen.has(value)) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 不得包含循环引用`);
  }
  seen.add(value);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownNames = Object.getOwnPropertyNames(value);
  const enumerableKeys = Object.keys(value);
  if (ownNames.length !== enumerableKeys.length) {
    fail("SMOKE_EVIDENCE_INVALID", path, `${path} 只能包含 JSON-like 可枚举 data property`);
  }

  const cloned = {};
  for (const key of enumerableKeys) {
    const childPath = `${path}.${key}`;
    const item = requireJsonDataDescriptor(descriptors[key], childPath);
    if (item !== undefined) {
      cloned[key] = safeJsonClone(item, childPath, seen);
    }
  }
  seen.delete(value);
  return cloned;
}

function safeJsonClone(value, path, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("SMOKE_EVIDENCE_INVALID", path, `${path} 必须是有限 number`);
    }
    return value;
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return safeJsonCloneArray(value, path, seen);
    }
    return safeJsonCloneRecord(value, path, seen);
  }
  fail("SMOKE_EVIDENCE_INVALID", path, `${path} 只能包含 JSON-like 数据`);
}

function requireSmokeInputEnvelope(input) {
  requirePlainJsonRecord(input, "$");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownNames = Object.getOwnPropertyNames(input);
  const enumerableKeys = Object.keys(input);
  if (ownNames.length !== enumerableKeys.length) {
    fail("SMOKE_EVIDENCE_INVALID", "$", "$ 只能包含 JSON-like 可枚举 data property");
  }
  for (const key of enumerableKeys) {
    requireJsonDataDescriptor(descriptors[key], `$.${key}`);
  }
  return {
    manifest: requireJsonDataDescriptor(descriptors.manifest, "$.manifest"),
    evidence: requireJsonDataDescriptor(descriptors.evidence, "$.evidence"),
  };
}

function expectEqual(actual, expected, code, path, message) {
  if (actual !== expected) {
    fail(code, path, message);
  }
  return actual;
}

function expectAddress(actual, expected, code, path, message) {
  return expectEqual(normalizeAddress(actual), normalizeAddress(expected), code, path, message);
}

function toUnits18(units6) {
  return (BigInt(units6) * ARC_NATIVE_USDC_SCALE).toString();
}

function normalizeTransfer(raw, path) {
  const record = requireRecord(raw, path);
  return {
    emitter: requireAddress(record.emitter, `${path}.emitter`),
    decimals: Number(record.decimals),
    from: requireAddress(record.from, `${path}.from`),
    to: requireAddress(record.to, `${path}.to`),
    amount: requireUnsignedDecimal(record.amount, `${path}.amount`),
  };
}

function verifyTransferPair(operationName, rawTransfers, { from, to, amountUnits }) {
  const path = `smoke.${operationName}.transfers`;
  const transfers = requireArray(rawTransfers, path).map((transfer, index) => normalizeTransfer(transfer, `${path}[${index}]`));
  const erc20Transfers = transfers.filter((transfer) => transfer.emitter === normalizeAddress(OFFICIAL_ARC_TESTNET_USDC_ADDRESS));
  const nativeTransfers = transfers.filter((transfer) => transfer.emitter === normalizeAddress(ARC_NATIVE_USDC_SYSTEM_EMITTER));

  if (nativeTransfers.length !== 1) {
    fail("SMOKE_NATIVE_TRANSFER_MISSING", `${path}.native`, `${path} 必须包含一条 Arc native emitter 18 位事件`);
  }
  if (erc20Transfers.length !== 1) {
    fail("SMOKE_ERC20_TRANSFER_MISSING", `${path}.erc20`, `${path} 必须包含一条官方 USDC 6 位事件`);
  }
  if (transfers.length !== 2) {
    fail(
      "SMOKE_TRANSFER_DEDUPLICATION_FAILED",
      path,
      `${path} 必须精确包含官方 USDC 6 位事件和 Arc native emitter 18 位事件各一条`,
    );
  }

  const erc20 = erc20Transfers[0];
  const native = nativeTransfers[0];
  const expectedFrom = normalizeAddress(from);
  const expectedTo = normalizeAddress(to);
  const expectedUnits18 = toUnits18(amountUnits);
  const matches =
    erc20.decimals === 6
    && native.decimals === 18
    && erc20.from === expectedFrom
    && native.from === expectedFrom
    && erc20.to === expectedTo
    && native.to === expectedTo
    && erc20.amount === String(amountUnits)
    && native.amount === expectedUnits18;

  if (!matches) {
    fail(
      "SMOKE_TRANSFER_PAIR_MISMATCH",
      path,
      `${path} 的 6 位 ERC-20 与 18 位 native emitter 金额、方向或 decimals 不一致`,
    );
  }

  return {
    erc20,
    native,
    logicalAmountUnits6: String(amountUnits),
    logicalAmountUnits18: expectedUnits18,
    deduplicatedLogicalTransfers: 1,
  };
}

function normalizeBalanceDelta(raw, path) {
  const record = requireRecord(raw, path);
  const before = requireUnsignedDecimal(record.before, `${path}.before`);
  const after = requireUnsignedDecimal(record.after, `${path}.after`);
  const delta = requireString(record.delta, `${path}.delta`);
  if (!/^-?(0|[1-9][0-9]*)$/.test(delta)) {
    fail("SMOKE_EVIDENCE_INVALID", `${path}.delta`, `${path}.delta 必须是十进制整数`);
  }
  if ((BigInt(after) - BigInt(before)).toString() !== delta) {
    fail("SMOKE_BALANCE_DELTA_MISMATCH", path, `${path} 的 before/after 与 delta 不一致`);
  }
  return {
    address: requireAddress(record.address, `${path}.address`),
    before,
    after,
    delta,
  };
}

function verifyBalanceDelta(operationName, rawDeltas, label, address, expectedDelta) {
  const path = `smoke.${operationName}.balanceDeltas.${label}`;
  const deltas = requireArray(rawDeltas, `smoke.${operationName}.balanceDeltas`).map((delta, index) =>
    normalizeBalanceDelta(delta, `smoke.${operationName}.balanceDeltas[${index}]`),
  );
  const found = deltas.find((delta) => delta.address === normalizeAddress(address));
  if (found === undefined || found.delta !== String(expectedDelta)) {
    fail("SMOKE_BALANCE_DELTA_MISMATCH", path, `${path} 与预期余额差不一致`);
  }
  return found;
}

function verifyApproval(evidence, buyer, factory, budgetUnits) {
  const approval = requireRecord(evidence.approval, "smoke.approval");
  expectAddress(requireAddress(approval.txFrom, "smoke.approval.txFrom"), buyer, "SMOKE_APPROVAL_MISMATCH", "smoke.approval.txFrom", "approve 必须由 buyer 发起");
  expectAddress(requireAddress(approval.owner, "smoke.approval.owner"), buyer, "SMOKE_APPROVAL_MISMATCH", "smoke.approval.owner", "approve owner 必须是 buyer");
  expectAddress(requireAddress(approval.spender, "smoke.approval.spender"), factory, "SMOKE_APPROVAL_MISMATCH", "smoke.approval.spender", "approve spender 必须是 Factory");
  expectAddress(
    requireAddress(approval.token, "smoke.approval.token"),
    OFFICIAL_ARC_TESTNET_USDC_ADDRESS,
    "SMOKE_APPROVAL_MISMATCH",
    "smoke.approval.token",
    "approve token 必须是官方 USDC",
  );
  if (BigInt(requireUnsignedDecimal(approval.amountUnits, "smoke.approval.amountUnits")) < BigInt(budgetUnits)) {
    fail("SMOKE_APPROVAL_MISMATCH", "smoke.approval.amountUnits", "approve 数量必须覆盖 initial budget");
  }
  return {
    txHash: requireBytes32(approval.txHash, "smoke.approval.txHash"),
    owner: normalizeAddress(buyer),
    spender: normalizeAddress(factory),
    token: normalizeAddress(OFFICIAL_ARC_TESTNET_USDC_ADDRESS),
    amountUnits: approval.amountUnits,
  };
}

function verifyNativeFundingFormula(funding, budgetUnits) {
  const path = "smoke.funding.nativeDelta18";
  const nativeBefore18 = BigInt(requireUnsignedDecimal(funding.nativeBefore18, "smoke.funding.nativeBefore18"));
  const nativeAfter18 = BigInt(requireUnsignedDecimal(funding.nativeAfter18, "smoke.funding.nativeAfter18"));
  const gasUsed = BigInt(requireUnsignedDecimal(funding.gasUsed, "smoke.funding.gasUsed"));
  const effectiveGasPrice = BigInt(requireUnsignedDecimal(funding.effectiveGasPrice, "smoke.funding.effectiveGasPrice"));
  const gasCost18 = gasUsed * effectiveGasPrice;
  const nativeDeltaMinusGas18 = nativeBefore18 - nativeAfter18 - gasCost18;
  const budgetUnits18 = BigInt(toUnits18(budgetUnits));

  if (nativeDeltaMinusGas18 !== budgetUnits18) {
    fail(
      "SMOKE_NATIVE_GAS_MISMATCH",
      path,
      "nativeBefore18-nativeAfter18-gasUsed*effectiveGasPrice 必须等于 initialBudgetUnits6*10^12",
    );
  }

  return {
    verified: true,
    budgetUnits6: String(budgetUnits),
    budgetUnits18: budgetUnits18.toString(),
    gasUsed: gasUsed.toString(),
    effectiveGasPrice: effectiveGasPrice.toString(),
    gasCost18: gasCost18.toString(),
    nativeBefore18: nativeBefore18.toString(),
    nativeAfter18: nativeAfter18.toString(),
    nativeDeltaMinusGas18: nativeDeltaMinusGas18.toString(),
  };
}

function verifyFunding(evidence, manifest, clone, buyer, budgetUnits) {
  const funding = requireRecord(evidence.funding, "smoke.funding");
  expectAddress(requireAddress(funding.txFrom, "smoke.funding.txFrom"), buyer, "SMOKE_FUNDING_MISMATCH", "smoke.funding.txFrom", "createAndFund tx.from 必须是 buyer");
  expectAddress(requireAddress(funding.gasPayer, "smoke.funding.gasPayer"), buyer, "SMOKE_FUNDING_MISMATCH", "smoke.funding.gasPayer", "createAndFund gas payer 必须是 direct EOA buyer");
  if (requireBoolean(funding.directEoa, "smoke.funding.directEoa") !== true) {
    fail("SMOKE_FUNDING_MISMATCH", "smoke.funding.directEoa", "smoke 必须使用 direct EOA buyer");
  }
  if (requireBoolean(funding.accountAbstraction, "smoke.funding.accountAbstraction") !== false) {
    fail("SMOKE_FUNDING_MISMATCH", "smoke.funding.accountAbstraction", "smoke 不得使用 AA");
  }
  if (funding.paymaster !== null) {
    fail("SMOKE_FUNDING_MISMATCH", "smoke.funding.paymaster", "smoke 不得使用 paymaster/sponsorship");
  }

  const factoryEvent = requireRecord(funding.factoryEvent, "smoke.funding.factoryEvent");
  expectAddress(requireAddress(factoryEvent.buyer, "smoke.funding.factoryEvent.buyer"), buyer, "SMOKE_LINEAGE_MISMATCH", "smoke.funding.factoryEvent.buyer", "Factory event buyer 与 manifest 不一致");
  expectEqual(requireBytes32(factoryEvent.researchKey, "smoke.funding.factoryEvent.researchKey"), clone.researchKey, "SMOKE_LINEAGE_MISMATCH", "smoke.funding.factoryEvent.researchKey", "Factory event researchKey 与 manifest 不一致");
  expectAddress(requireAddress(factoryEvent.escrow, "smoke.funding.factoryEvent.escrow"), clone.clone, "SMOKE_LINEAGE_MISMATCH", "smoke.funding.factoryEvent.escrow", "Factory event escrow 与 manifest 不一致");
  expectAddress(requireAddress(factoryEvent.implementation, "smoke.funding.factoryEvent.implementation"), manifest.addresses.implementation, "SMOKE_LINEAGE_MISMATCH", "smoke.funding.factoryEvent.implementation", "Factory event implementation 与 manifest 不一致");

  const stateAfter = requireRecord(funding.stateAfter, "smoke.funding.stateAfter");
  expectEqual(requireString(stateAfter.state, "smoke.funding.stateAfter.state"), "Funded", "SMOKE_STATE_MISMATCH", "smoke.funding.stateAfter.state", "createAndFund 后必须是 Funded");
  expectEqual(requireUnsignedDecimal(stateAfter.spent, "smoke.funding.stateAfter.spent"), "0", "SMOKE_STATE_MISMATCH", "smoke.funding.stateAfter.spent", "Funded 后 spent 必须为 0");
  expectEqual(requireUnsignedDecimal(stateAfter.initialBudget, "smoke.funding.stateAfter.initialBudget"), budgetUnits, "SMOKE_STATE_MISMATCH", "smoke.funding.stateAfter.initialBudget", "Funded initialBudget 与 manifest 不一致");

  const isolation = requireRecord(funding.isolation, "smoke.funding.isolation");
  if (isolation.noOtherBuyerBalanceChange !== true) {
    fail("SMOKE_FUNDING_MISMATCH", "smoke.funding.isolation", "funding 必须证明无其它 buyer 余额变化污染 native delta");
  }

  return {
    txHash: requireBytes32(funding.txHash, "smoke.funding.txHash"),
    transfers: verifyTransferPair("funding", funding.transfers, {
      from: buyer,
      to: clone.clone,
      amountUnits: budgetUnits,
    }),
    buyerDelta: verifyBalanceDelta("funding", funding.balanceDeltas, "buyer", buyer, `-${budgetUnits}`),
    cloneDelta: verifyBalanceDelta("funding", funding.balanceDeltas, "clone", clone.clone, budgetUnits),
    nativeFormula: verifyNativeFundingFormula(funding, budgetUnits),
    lineage: {
      verified: true,
      buyer,
      researchKey: clone.researchKey,
      escrow: normalizeAddress(clone.clone),
      implementation: normalizeAddress(manifest.addresses.implementation),
    },
  };
}

function verifyActivation(evidence, buyer, intentSigner) {
  const activation = requireRecord(evidence.activation, "smoke.activation");
  expectAddress(requireAddress(activation.signer, "smoke.activation.signer"), buyer, "SMOKE_ACTIVATION_MISMATCH", "smoke.activation.signer", "activation 签名者必须是 buyer");
  expectEqual(requireString(activation.stateBefore, "smoke.activation.stateBefore"), "Funded", "SMOKE_STATE_MISMATCH", "smoke.activation.stateBefore", "activation 前必须是 Funded");
  expectEqual(requireString(activation.stateAfter, "smoke.activation.stateAfter"), "Active", "SMOKE_STATE_MISMATCH", "smoke.activation.stateAfter", "activation 后必须是 Active");
  expectAddress(requireAddress(activation.intentSigner, "smoke.activation.intentSigner"), intentSigner, "SMOKE_ACTIVATION_MISMATCH", "smoke.activation.intentSigner", "activation 必须固化 manifest intent signer");
  if (requireArray(activation.transfers, "smoke.activation.transfers").length !== 0) {
    fail("SMOKE_TRANSFER_PAIR_MISMATCH", "smoke.activation.transfers", "activation 不得移动 USDC");
  }
  return {
    signer: normalizeAddress(buyer),
    stateBefore: "Funded",
    stateAfter: "Active",
    intentSigner: normalizeAddress(intentSigner),
  };
}

function verifySettlement(evidence, clone, payout, intentSigner, settler) {
  const settlement = requireRecord(evidence.settlement, "smoke.settlement");
  const amountUnits = requireUnsignedDecimal(settlement.amountUnits, "smoke.settlement.amountUnits");
  expectAddress(requireAddress(settlement.signer, "smoke.settlement.signer"), intentSigner, "SMOKE_SETTLEMENT_MISMATCH", "smoke.settlement.signer", "settlement intent 签名者必须是 intent signer");
  expectAddress(requireAddress(settlement.txFrom, "smoke.settlement.txFrom"), settler, "SMOKE_SETTLEMENT_MISMATCH", "smoke.settlement.txFrom", "settlement 广播者必须是 settler");
  const summary = requireRecord(settlement.summary, "smoke.settlement.summary");
  requireBytes32(summary.itemsHash, "smoke.settlement.summary.itemsHash");
  expectEqual(requireUnsignedDecimal(summary.total, "smoke.settlement.summary.total"), amountUnits, "SMOKE_SETTLEMENT_MISMATCH", "smoke.settlement.summary.total", "settlement summary total 必须等于实际付款");
  if (BigInt(requireUnsignedDecimal(String(summary.itemCount), "smoke.settlement.summary.itemCount")) <= 0n) {
    fail("SMOKE_SETTLEMENT_MISMATCH", "smoke.settlement.summary.itemCount", "settlement itemCount 必须大于 0");
  }

  return {
    amountUnits,
    transfers: verifyTransferPair("settlement", settlement.transfers, {
      from: clone.clone,
      to: payout,
      amountUnits,
    }),
    cloneDelta: verifyBalanceDelta("settlement", settlement.balanceDeltas, "clone", clone.clone, `-${amountUnits}`),
    payoutDelta: verifyBalanceDelta("settlement", settlement.balanceDeltas, "payout", payout, amountUnits),
    summary: {
      itemsHash: summary.itemsHash,
      total: amountUnits,
      itemCount: Number(summary.itemCount),
    },
  };
}

function verifyClose(evidence, clone, buyer, intentSigner, settler) {
  const close = requireRecord(evidence.close, "smoke.close");
  const refundUnits = requireUnsignedDecimal(close.refundUnits, "smoke.close.refundUnits");
  expectAddress(requireAddress(close.signer, "smoke.close.signer"), intentSigner, "SMOKE_CLOSE_MISMATCH", "smoke.close.signer", "close 签名者必须是 intent signer");
  expectAddress(requireAddress(close.txFrom, "smoke.close.txFrom"), settler, "SMOKE_CLOSE_MISMATCH", "smoke.close.txFrom", "close 广播者必须是 settler");
  requireBytes32(close.finalLiabilityHash, "smoke.close.finalLiabilityHash");
  expectEqual(requireString(close.stateAfter, "smoke.close.stateAfter"), "Closed", "SMOKE_STATE_MISMATCH", "smoke.close.stateAfter", "close 后必须是 Closed");

  return {
    refundUnits,
    transfers: verifyTransferPair("close", close.transfers, {
      from: clone.clone,
      to: buyer,
      amountUnits: refundUnits,
    }),
    cloneDelta: verifyBalanceDelta("close", close.balanceDeltas, "clone", clone.clone, `-${refundUnits}`),
    buyerDelta: verifyBalanceDelta("close", close.balanceDeltas, "buyer", buyer, refundUnits),
    finalLiabilityHash: close.finalLiabilityHash,
    stateAfter: "Closed",
  };
}

export function verifyArcSmokeEvidence(input) {
  const { manifest: inputManifest, evidence: inputEvidence } = requireSmokeInputEnvelope(input);
  const manifest = validateDeploymentManifest(inputManifest);
  const evidence = safeJsonClone(requireRecord(inputEvidence, "smoke"), "smoke", new WeakSet());
  const chainId = Number(evidence.chainId);
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    fail("SMOKE_CHAIN_ID_MISMATCH", "smoke.chainId", `smoke chainId 必须是 ${ARC_TESTNET_CHAIN_ID}`);
  }

  const cloneAddress = requireAddress(evidence.clone, "smoke.clone");
  const clone = manifest.clones.find((item) => normalizeAddress(item.clone) === cloneAddress);
  if (clone === undefined) {
    fail("SMOKE_LINEAGE_MISMATCH", "smoke.clone", "smoke clone 必须来自 manifest");
  }

  const buyer = expectAddress(requireAddress(evidence.buyer, "smoke.buyer"), clone.buyer, "SMOKE_LINEAGE_MISMATCH", "smoke.buyer", "smoke buyer 与 manifest clone 不一致");
  const payout = expectAddress(requireAddress(evidence.payout, "smoke.payout"), manifest.roles.smokePayout, "SMOKE_LINEAGE_MISMATCH", "smoke.payout", "smoke payout 与 manifest 不一致");
  expectAddress(requireAddress(evidence.factory, "smoke.factory"), manifest.addresses.factory, "SMOKE_LINEAGE_MISMATCH", "smoke.factory", "smoke factory 与 manifest 不一致");
  expectAddress(requireAddress(evidence.registry, "smoke.registry"), manifest.addresses.registry, "SMOKE_LINEAGE_MISMATCH", "smoke.registry", "smoke registry 与 manifest 不一致");
  expectAddress(requireAddress(evidence.implementation, "smoke.implementation"), manifest.addresses.implementation, "SMOKE_LINEAGE_MISMATCH", "smoke.implementation", "smoke implementation 与 manifest 不一致");
  expectAddress(requireAddress(evidence.usdc, "smoke.usdc"), OFFICIAL_ARC_TESTNET_USDC_ADDRESS, "SMOKE_LINEAGE_MISMATCH", "smoke.usdc", "smoke USDC 必须是官方 USDC");
  expectEqual(requireBytes32(evidence.researchKey, "smoke.researchKey"), clone.researchKey, "SMOKE_LINEAGE_MISMATCH", "smoke.researchKey", "smoke researchKey 与 manifest clone 不一致");
  const budgetUnits = expectEqual(
    requireUnsignedDecimal(evidence.initialBudgetUnits, "smoke.initialBudgetUnits"),
    clone.initialBudget,
    "SMOKE_LINEAGE_MISMATCH",
    "smoke.initialBudgetUnits",
    "smoke initial budget 与 manifest clone 不一致",
  );

  const approval = verifyApproval(evidence, buyer, manifest.addresses.factory, budgetUnits);
  const funding = verifyFunding(evidence, manifest, clone, buyer, budgetUnits);
  const activation = verifyActivation(evidence, buyer, manifest.roles.intentSigner);
  const settlement = verifySettlement(evidence, clone, payout, manifest.roles.intentSigner, manifest.roles.settler);
  const close = verifyClose(evidence, clone, buyer, manifest.roles.intentSigner, manifest.roles.settler);

  if (BigInt(settlement.amountUnits) + BigInt(close.refundUnits) !== BigInt(budgetUnits)) {
    fail("SMOKE_ACCOUNTING_MISMATCH", "smoke.accounting", "settlement + refund 必须等于 initial budget");
  }
  if (close.cloneDelta.after !== "0") {
    fail("SMOKE_BALANCE_DELTA_MISMATCH", "smoke.close.balanceDeltas.clone", "close 后 clone 六位余额必须清零");
  }

  return {
    status: "passed",
    chainId,
    flow: ["approve", "createAndFund", "activate", "settleBatch", "close"],
    lineage: {
      factory: normalizeAddress(manifest.addresses.factory),
      registry: normalizeAddress(manifest.addresses.registry),
      implementation: normalizeAddress(manifest.addresses.implementation),
      clone: cloneAddress,
      buyer,
      payout,
      researchKey: clone.researchKey,
      fundingTxHash: funding.txHash,
    },
    approval,
    funding: {
      nativeFormula: funding.nativeFormula,
      transferPair: funding.transfers,
      lineage: funding.lineage,
    },
    activation,
    settlement: {
      amountUnits: settlement.amountUnits,
      transferPair: settlement.transfers,
      summary: settlement.summary,
    },
    close: {
      refundUnits: close.refundUnits,
      transferPair: close.transfers,
      finalLiabilityHash: close.finalLiabilityHash,
      stateAfter: close.stateAfter,
    },
    nativeFundingFormula: funding.nativeFormula,
    transferSummary: {
      funding: funding.transfers,
      settlement: settlement.transfers,
      close: close.transfers,
    },
    accounting: {
      initialBudgetUnits: budgetUnits,
      settlementUnits: settlement.amountUnits,
      refundUnits: close.refundUnits,
      cloneBalanceZeroAfterClose: true,
    },
    operations: {
      activation,
      settlement: settlement.summary,
      close: {
        finalLiabilityHash: close.finalLiabilityHash,
        stateAfter: close.stateAfter,
      },
    },
  };
}
