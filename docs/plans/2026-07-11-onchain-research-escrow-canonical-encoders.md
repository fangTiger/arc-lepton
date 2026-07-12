# Onchain Research Escrow Canonical Encoders Plan

**Goal:** 完成 OpenSpec Task 2.2，让 Task 2.1 的 Solidity、TypeScript 和独立 verifier RED 向量转绿，并补齐 canonical 输入拒绝规则。

**Architecture:** Solidity 使用 `abi.encode`，TypeScript 与独立 verifier 使用 viem `encodeAbiParameters`。三端共享 `contracts/test/vectors/canonical-vectors.json`，但 TypeScript encoder 与独立 verifier 分开实现，避免 verifier 只复述生产模块。

**Scope:** 仅实现 canonical key/hash 与输入校验；不实现 EIP-712 授权 digest、合约状态机、Registry、Factory、Escrow 支付逻辑。

---

## Task 2.2: Canonical Encoders

**Files:**

- Create: `contracts/src/canonical/CanonicalResearch.sol`
- Create: `lib/chain/canonical.ts`
- Create: `contracts/scripts/verify-canonical-vectors.mjs`
- Modify: `contracts/test/unit/canonical/CanonicalVectors.t.sol`
- Modify: `lib/chain/canonical.test.ts`
- Modify: `contracts/scripts/canonical-vectors.node-test.mjs`
- Update task docs under `.devos/tasks/onchain-research-escrow-2-2/`
- Modify after verification: `openspec/changes/onchain-research-escrow/tasks.md`

**Implementation rules:**

- Use only `abi.encode` / `encodeAbiParameters` for canonical ABI encoding.
- Reject non-canonical UUID strings: exactly lowercase hex with hyphens at UUID positions.
- Reject non-canonical source names: non-empty lowercase ASCII `[a-z0-9-]+`.
- Reject zero request/source/settlement keys where required.
- Reject empty settlement item arrays, unsorted items, duplicate requestKey, and zero sourceId.
- Allow empty liabilities for no-intent close, but reject unsorted/duplicate/zero requestKey in non-empty liabilities.
- Validate terminalState: `1=PAID`, `2=VOID_BEFORE_SIDE_EFFECT`, `3=UNPAYABLE_MANUAL`.
- For PAID liabilities require non-zero settlementKey and terminalEvidenceHash; for non-PAID require zero settlementKey and non-zero evidence.
- Provide a spent-aware helper that verifies the sum of PAID amounts equals supplied spent.
- Provide an expected-request helper to reject omitted liabilities when caller has the full expected requestKey set.

**Verification commands:**

```bash
FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/canonical/CanonicalVectors.t.sol
npm test -- --run lib/chain/canonical.test.ts
node --test contracts/scripts/canonical-vectors.node-test.mjs
FOUNDRY_OFFLINE=true forge fmt --root contracts --check
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
openspec validate onchain-research-escrow --strict --no-interactive
```
