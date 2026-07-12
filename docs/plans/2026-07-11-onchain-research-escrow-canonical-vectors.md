# Onchain Research Escrow Canonical Vectors Plan

> 本计划用于当前会话的 subagent-driven-development。主代理负责规划与验收，worker 负责实现，reviewer 负责规范与质量审查。

**Goal:** 为 OpenSpec `onchain-research-escrow` Task 2.1 建立共享 canonical 测试向量，并让 Solidity、TypeScript、独立 verifier 三端先进入 RED。

**Architecture:** 以单一共享 JSON fixture 固定 design Decision 2 的输入、domain 常量和期望 hash。Solidity、TypeScript 与 verifier 测试只消费该 fixture 或等价常量，不在本任务实现生产 canonical encoder。Task 2.2 再实现 `abi.encode` / `encodeAbiParameters` 编码器并让这些测试转绿。

**Tech Stack:** Foundry Solidity tests、Vitest TypeScript tests、Node `node:test` verifier tests、viem ABI/hash utilities（仅在后续实现中使用）。

---

## Task 2.1: Canonical Shared RED Test Vectors

**OpenSpec task:** `2.1 为 design 中 research/request/settlement/source/items、settlementResultDigest、空/单 PAID finalLiabilityHash 写 Solidity、TypeScript 和独立 verifier 共享 RED 测试向量`

**Files:**

- Create: `contracts/test/vectors/canonical-vectors.json`
- Create: `contracts/test/unit/canonical/CanonicalVectors.t.sol`
- Create: `lib/chain/canonical.test.ts`
- Create: `contracts/scripts/canonical-vectors.node-test.mjs`
- Create or update task docs under `.devos/tasks/onchain-research-escrow-2-1/`
- Modify after verification: `openspec/changes/onchain-research-escrow/tasks.md`

**Shared vector content:**

- Domains:
  - `arc-lepton.research-key.v1`
  - `arc-lepton.request-key.v1`
  - `arc-lepton.settlement-key.v1`
  - `arc-lepton.source-id.v1`
  - `arc-lepton.items-hash.v1`
  - `arc-lepton.settlement-result.v1`
  - `arc-lepton.final-liability.v1`
- Inputs:
  - `chainId = 5042002`
  - `buyer = 0x1111111111111111111111111111111111111111`
  - `canonicalResearchId = 00000000-0000-4000-8000-000000000001`
  - `canonicalPaymentIntentId = 00000000-0000-4000-8000-000000000002`
  - `canonicalSettlementId = 00000000-0000-4000-8000-000000000003`
  - `source = whale-flow`
  - `payout = 0x2222222222222222222222222222222222222222`
  - `revision = 1`
  - `maxUnitPrice = 1000`
  - `amount = 100`
- Expected:
  - `researchKey = 0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464`
  - `requestKey = 0xbb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab`
  - `settlementKey = 0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7`
  - `sourceId = 0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1`
  - `itemsHash = 0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea`
  - `settlementResultDigest = 0xb1518f344eeee729e760f0c0d2be569b83fa550833b2309d8e6b7e2cb037b6c4`
  - `emptyFinalLiabilityHash = 0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4`
  - `singlePaidFinalLiabilityHash = 0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e`

**Step 1: Write the shared fixture**

Create `contracts/test/vectors/canonical-vectors.json` with strict, plain JSON. Keep numbers that may exceed JS safe integer as strings unless the value is safely small. Include enough ABI metadata for all three test surfaces to know field order.

**Step 2: Write Solidity RED test**

Create a Foundry unit test that imports the intended canonical Solidity library/API and asserts every expected digest above. This test should currently fail because the production Solidity canonical encoder is not implemented yet. The failure must be clear and tied to the missing implementation or missing function.

Expected command:

```bash
FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/canonical/CanonicalVectors.t.sol
```

Expected RED result for 2.1: non-zero exit caused by missing canonical Solidity implementation, not malformed test syntax.

**Step 3: Write TypeScript RED test**

Create a Vitest test that imports the intended TypeScript canonical API and consumes the shared JSON fixture. Assert all expected keys and hashes.

Expected command:

```bash
npm test -- --run lib/chain/canonical.test.ts
```

Expected RED result for 2.1: non-zero exit caused by missing canonical TypeScript implementation, not fixture parse or TypeScript syntax errors.

**Step 4: Write independent verifier RED test**

Create a `node:test` test under `contracts/scripts/*.node-test.mjs` that consumes the same shared fixture and calls the intended independent verifier entrypoint. It should fail until the verifier is implemented in 2.2.

Expected command:

```bash
node --test contracts/scripts/canonical-vectors.node-test.mjs
```

Expected RED result for 2.1: non-zero exit caused by missing independent verifier implementation or explicit not-implemented result.

**Step 5: Verify RED and update records**

Run the three focused commands and record the expected RED outputs in `.devos/tasks/onchain-research-escrow-2-1/test-report.md`. Mark OpenSpec task 2.1 complete only after reviewer approval confirms the RED tests match the spec and do not include 2.2 implementation.

**Guardrails:**

- Do not implement production canonical encoders in Task 2.1.
- Do not stage, commit, push, reset, restore, deploy, broadcast, read private keys, or touch user-staged README/images.
- Keep all documentation and user-facing text in Chinese.
- If adding comments, use Chinese comments only.
