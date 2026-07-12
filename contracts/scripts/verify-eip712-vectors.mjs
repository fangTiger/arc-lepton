import { deriveEip712VectorHashes, CHECKED_EIP712_VECTOR_KEYS } from "../../lib/chain/eip712.ts";

export function verifyEip712Vectors(vectors) {
  const actual = deriveEip712VectorHashes(vectors);
  const expected = expectedHashes(vectors);

  for (const key of CHECKED_EIP712_VECTOR_KEYS) {
    if (lookup(actual, key) !== lookup(expected, key)) {
      throw new Error(`EIP-712 vector mismatch: ${key}`);
    }
  }

  return { ok: true, checked: [...CHECKED_EIP712_VECTOR_KEYS] };
}

function expectedHashes(vectors) {
  return {
    factoryDomainSeparator: vectors.domains.factory.separator,
    escrowDomainSeparator: vectors.domains.escrow.separator,
    FundingVoucher: expectedAuthorization(vectors, "FundingVoucher"),
    ActivationAuthorization: expectedAuthorization(vectors, "ActivationAuthorization"),
    SettlementAuthorization: expectedAuthorization(vectors, "SettlementAuthorization"),
    CloseAuthorization: expectedAuthorization(vectors, "CloseAuthorization"),
  };
}

function expectedAuthorization(vectors, name) {
  return {
    typeHash: vectors.types[name].typeHash,
    structHash: vectors.authorizations[name].structHash,
    digest: vectors.authorizations[name].digest,
  };
}

function lookup(value, dottedPath) {
  return dottedPath.split(".").reduce((current, segment) => current?.[segment], value);
}
