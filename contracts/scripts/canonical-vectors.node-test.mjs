import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const vectorPath = resolve("contracts/test/vectors/canonical-vectors.json");

async function readVectors() {
  return JSON.parse(await readFile(vectorPath, "utf8"));
}

test("共享 canonical fixture 固定 design v1 向量", async () => {
  const vectors = await readVectors();

  assert.equal(vectors.schemaVersion, 1);
  assert.equal(vectors.inputs.chainId, 5_042_002);
  assert.equal(vectors.inputs.source, "whale-flow");
  assert.equal(
    vectors.expected.researchKey,
    "0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464",
  );
  assert.equal(
    vectors.expected.singlePaidFinalLiabilityHash,
    "0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e",
  );
});

test("独立 verifier 必须复核共享 canonical 向量", async () => {
  const vectors = await readVectors();
  const { verifyCanonicalVectors } = await import("./verify-canonical-vectors.mjs");

  const result = await verifyCanonicalVectors(vectors);

  assert.deepEqual(result, {
    ok: true,
    checked: [
      "researchKey",
      "requestKey",
      "settlementKey",
      "sourceId",
      "itemsHash",
      "settlementResultDigest",
      "emptyFinalLiabilityHash",
      "singlePaidFinalLiabilityHash",
    ],
  });
});
