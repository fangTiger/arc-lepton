import { encodeAbiParameters, keccak256, toBytes } from "viem";

const CHECKED = [
  "researchKey",
  "requestKey",
  "settlementKey",
  "sourceId",
  "itemsHash",
  "settlementResultDigest",
  "emptyFinalLiabilityHash",
  "singlePaidFinalLiabilityHash",
];

const settlementItemAbi = [
  { name: "requestKey", type: "bytes32" },
  { name: "sourceId", type: "bytes32" },
  { name: "registryRevision", type: "uint64" },
  { name: "expectedPayout", type: "address" },
  { name: "maxUnitPrice", type: "uint256" },
  { name: "amount", type: "uint256" },
];

const liabilityItemAbi = [
  { name: "requestKey", type: "bytes32" },
  { name: "amount", type: "uint256" },
  { name: "terminalState", type: "uint8" },
  { name: "settlementKey", type: "bytes32" },
  { name: "terminalEvidenceHash", type: "bytes32" },
];

export function verifyCanonicalVectors(vectors) {
  const actual = computeCanonicalVectorHashes(vectors);

  for (const key of CHECKED) {
    if (actual[key] !== vectors.expected[key]) {
      throw new Error(`canonical vector mismatch: ${key}`);
    }
  }

  return { ok: true, checked: CHECKED };
}

function computeCanonicalVectorHashes(vectors) {
  const domains = {
    research: textHash(vectors.domains.research),
    request: textHash(vectors.domains.request),
    settlement: textHash(vectors.domains.settlement),
    source: textHash(vectors.domains.source),
    items: textHash(vectors.domains.items),
    settlementResult: textHash(vectors.domains.settlementResult),
    finalLiability: textHash(vectors.domains.finalLiability),
  };
  const item = vectors.inputs.item;
  const researchKey = hashAbi(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
    [
      domains.research,
      BigInt(vectors.inputs.chainId),
      vectors.inputs.buyer,
      textHash(vectors.inputs.canonicalResearchId),
    ],
  );
  const requestKey = hashAbi(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [domains.request, researchKey, textHash(vectors.inputs.canonicalPaymentIntentId)],
  );
  const settlementKey = hashAbi(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [domains.settlement, researchKey, textHash(vectors.inputs.canonicalSettlementId)],
  );
  const sourceId = hashAbi(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [domains.source, textHash(vectors.inputs.source)],
  );
  const items = [
    {
      requestKey,
      sourceId,
      registryRevision: BigInt(item.registryRevision),
      expectedPayout: item.payout,
      maxUnitPrice: BigInt(item.maxUnitPrice),
      amount: BigInt(item.amount),
    },
  ];
  const itemsHash = hashAbi(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "tuple[]", components: settlementItemAbi }],
    [domains.items, 1n, items],
  );
  const settlementResultDigest = hashAbi(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint32" },
    ],
    [domains.settlementResult, settlementKey, itemsHash, BigInt(item.amount), 1n],
  );
  const emptyFinalLiabilityHash = hashAbi(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "tuple[]", components: liabilityItemAbi }],
    [domains.finalLiability, 1n, []],
  );
  const singlePaid = vectors.inputs.liabilities.singlePaid.map((liability) => ({
    requestKey: liability.requestKey,
    amount: BigInt(liability.amount),
    terminalState: liability.terminalState,
    settlementKey: liability.settlementKey,
    terminalEvidenceHash: liability.terminalEvidenceHash,
  }));
  const singlePaidFinalLiabilityHash = hashAbi(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "tuple[]", components: liabilityItemAbi }],
    [domains.finalLiability, 1n, singlePaid],
  );

  return {
    researchKey,
    requestKey,
    settlementKey,
    sourceId,
    itemsHash,
    settlementResultDigest,
    emptyFinalLiabilityHash,
    singlePaidFinalLiabilityHash,
  };
}

function textHash(value) {
  return keccak256(toBytes(value));
}

function hashAbi(parameters, values) {
  return keccak256(encodeAbiParameters(parameters, values));
}
