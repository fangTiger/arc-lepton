import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const vectorPath = resolve("contracts/test/vectors/eip712-vectors.json");

async function readVectors() {
  return JSON.parse(await readFile(vectorPath, "utf8"));
}

test("共享 EIP-712 fixture 固定 design v1 向量", async () => {
  const vectors = await readVectors();

  assert.equal(vectors.schemaVersion, 1);
  assert.equal(vectors.standard, "EIP-712");
  assert.equal(vectors.domains.factory.chainId, 5_042_002);
  assert.equal(vectors.domains.factory.verifyingContract, "0x3333333333333333333333333333333333333333");
  assert.equal(vectors.domains.escrow.verifyingContract, "0x4444444444444444444444444444444444444444");
  assert.equal(
    vectors.authorizations.FundingVoucher.digest,
    "0x8faa9182addb6d5d08af23306436f3306498c84252c9ed09d88f3c6fd8eff95b",
  );
  assert.equal(
    vectors.authorizations.ActivationAuthorization.digest,
    "0xbc1cbf4093c2e740f17393d450269fed5983c790354666867f34bd8a4949e6d7",
  );
  assert.equal(
    vectors.authorizations.SettlementAuthorization.digest,
    "0xb3b9a8aa53892c97a11bea76829a29d72741f75bc6e0046ae69c0fcdeb3712b2",
  );
  assert.equal(
    vectors.authorizations.CloseAuthorization.digest,
    "0x00b2124a61089fcd6b75eadd2b33a5c8876165709f25ccba22a38a213f5139ba",
  );
});

test("独立 verifier 必须复核共享 EIP-712 向量", async () => {
  const vectors = await readVectors();
  const { verifyEip712Vectors } = await import("./verify-eip712-vectors.mjs");

  const result = await verifyEip712Vectors(vectors);

  assert.deepEqual(result, {
    ok: true,
    checked: [
      "factoryDomainSeparator",
      "escrowDomainSeparator",
      "FundingVoucher.typeHash",
      "FundingVoucher.structHash",
      "FundingVoucher.digest",
      "ActivationAuthorization.typeHash",
      "ActivationAuthorization.structHash",
      "ActivationAuthorization.digest",
      "SettlementAuthorization.typeHash",
      "SettlementAuthorization.structHash",
      "SettlementAuthorization.digest",
      "CloseAuthorization.typeHash",
      "CloseAuthorization.structHash",
      "CloseAuthorization.digest",
    ],
  });
});
