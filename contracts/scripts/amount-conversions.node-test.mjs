import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const vectorPath = resolve("contracts/test/vectors/amount-conversions.json");

async function readVectors() {
  return JSON.parse(await readFile(vectorPath, "utf8"));
}

test("共享 amount conversion fixture 固定 scale-8、unit6 与 native18 向量", async () => {
  const vectors = await readVectors();

  assert.equal(vectors.schemaVersion, 1);
  assert.equal(vectors.units.scale8PerUnit6, "100");
  assert.equal(vectors.units.nativePerUnit6, "1000000000000");
  assert.deepEqual(vectors.valid[0], {
    label: "minimum non-zero unit",
    decimal: "0.000001",
    scale8: "100",
    units6: "1",
    native18: "1000000000000",
  });
});

test("独立 verifier 必须复核共享 amount conversion 向量", async () => {
  const vectors = await readVectors();
  const { verifyAmountConversionVectors } = await import("./verify-amount-conversions.mjs");

  const result = await verifyAmountConversionVectors(vectors);

  assert.deepEqual(result, {
    ok: true,
    checked: [
      "scale8ToUnits6",
      "units6ToScale8",
      "units6ToNative18",
      "native18ToUnits6",
      "native18AmountEqualsUnits6",
      "invalid.scale8",
      "invalid.units6",
      "invalid.native18",
      "invalid.decimal",
    ],
  });
});
