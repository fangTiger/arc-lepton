import {
  native18AmountEqualsUnits6,
  native18ToUnits6,
  parseScale8DecimalToUnits6,
  scale8ToUnits6,
  units6ToNative18,
  units6ToScale8,
} from "../../lib/chain/amounts.ts";

const CHECKED = [
  "scale8ToUnits6",
  "units6ToScale8",
  "units6ToNative18",
  "native18ToUnits6",
  "native18AmountEqualsUnits6",
  "invalid.scale8",
  "invalid.units6",
  "invalid.native18",
  "invalid.decimal",
];

export function verifyAmountConversionVectors(vectors) {
  for (const entry of vectors.valid) {
    assertEqual(scale8ToUnits6(entry.scale8), entry.units6, `${entry.label}: scale8ToUnits6`);
    assertEqual(units6ToScale8(entry.units6), entry.scale8, `${entry.label}: units6ToScale8`);
    assertEqual(units6ToNative18(entry.units6), entry.native18, `${entry.label}: units6ToNative18`);
    assertEqual(native18ToUnits6(entry.native18), entry.units6, `${entry.label}: native18ToUnits6`);
    assertEqual(parseScale8DecimalToUnits6(entry.decimal), entry.units6, `${entry.label}: parseScale8DecimalToUnits6`);
    if (!native18AmountEqualsUnits6(entry.units6, entry.native18)) {
      throw new Error(`amount vector mismatch: ${entry.label}: native18AmountEqualsUnits6`);
    }
  }

  for (const entry of vectors.invalid.scale8) {
    assertThrows(() => scale8ToUnits6(entry.value), entry.reason, `invalid.scale8.${entry.label}`);
  }
  for (const entry of vectors.invalid.units6) {
    assertThrows(
      () => {
        if (entry.reason === "UINT256_OVERFLOW" && entry.label.includes("native18")) {
          units6ToNative18(entry.value);
        } else {
          units6ToScale8(entry.value);
        }
      },
      entry.reason,
      `invalid.units6.${entry.label}`,
    );
  }
  for (const entry of vectors.invalid.native18) {
    assertThrows(() => native18ToUnits6(entry.value), entry.reason, `invalid.native18.${entry.label}`);
  }
  for (const entry of vectors.invalid.decimal) {
    assertThrows(() => parseScale8DecimalToUnits6(entry.value), entry.reason, `invalid.decimal.${entry.label}`);
  }

  return { ok: true, checked: CHECKED };
}

function assertEqual(actual, expected, label) {
  if (actual !== BigInt(expected)) {
    throw new Error(`amount vector mismatch: ${label}`);
  }
}

function assertThrows(action, code, label) {
  try {
    action();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === code) {
      return;
    }
    throw new Error(`amount vector wrong error: ${label}`);
  }
  throw new Error(`amount vector did not reject: ${label}`);
}
