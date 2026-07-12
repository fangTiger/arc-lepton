# Onchain Research Escrow CloseAuthorization RED Plan

> **For worker:** REQUIRED SUB-SKILL: Use test-driven-development. This is a RED-only task; do not implement production `close`.

**Goal:** Add failing Forge tests for OpenSpec task 5.9, proving the missing CloseAuthorization path must validate canonical liabilities, close authorization fields, signer/settler separation, nonce/window, and early-close guards.

**Architecture:** Use a new focused test file so settlement tests stay readable. The RED test interface may declare the future close API as `close(liabilities, expectedRequestKeys, authorization, signature)` because task 5.9 explicitly requires omissions/duplicates/unknown terminal state and PAID result/spent checks; a hash-only call cannot verify those details on-chain. Production implementation remains untouched until task 5.12.

**Tech Stack:** Foundry Forge, Solidity 0.8.30, existing `CanonicalResearch`, `ResearchEscrowEip712`, `ResearchEscrowFactory`, `DataSourceRegistry`, token fixtures, `RoleIsolationFixture`.

---

### Task 1: Create focused RED test harness

**Files:**

- Create: `contracts/test/unit/escrow/ResearchEscrowClose.t.sol`
- Read/reference: `contracts/test/unit/escrow/ResearchEscrowActivation.t.sol`
- Read/reference: `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`

**Step 1: Add imports, VM interface, future close interface, fixtures**

Create a test harness mirroring the existing settlement helpers:

```solidity
interface CloseVm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectPartialRevert(bytes4 revertData) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

interface IResearchEscrowClose {
    error InvalidCloseAuthorization();
    error InvalidCloseAuthorizationWindow();
    error InvalidCloseSignature();
    error UnauthorizedSettler(address caller);
    error InvalidCloseSigner(address signer);
    error CloseNonceUsed(uint256 nonce);
    error PaidLiabilityNotSettled(bytes32 requestKey);
    error PaidLiabilityResultMismatch(bytes32 settlementKey);

    function activate(ResearchEscrowEip712.ActivationAuthorization calldata authorization, bytes calldata signature)
        external;
    function settleBatch(
        bytes32 settlementKey,
        CanonicalResearch.SettlementItem[] calldata items,
        ResearchEscrowEip712.SettlementAuthorization calldata authorization,
        bytes calldata signature
    ) external;
    function close(
        CanonicalResearch.LiabilityItem[] calldata liabilities,
        bytes32[] calldata expectedRequestKeys,
        ResearchEscrowEip712.CloseAuthorization calldata authorization,
        bytes calldata signature
    ) external;
    function closeReason() external view returns (uint8);
    function finalLiabilityHash() external view returns (bytes32);
    function closeNonceUsed(uint256 nonce) external view returns (bool);
}
```

Reuse constants from settlement tests where possible: `RESEARCH_KEY`, `REQUEST_KEY_1`, `REQUEST_KEY_2`, `SETTLEMENT_KEY`, `SOURCE_ID_1`, `BUDGET_UNITS`, `FIRST_AMOUNT`, `NOW_TS`, keys, `ARC_TESTNET_USDC`. Add helpers for `_publishedFactoryWithMockUsdc`, `_fundedEscrow`, `_activeEscrow`, `_validFundingVoucher`, `_validActivation`, `_singleSettlementItem`, `_validSettlementAuthorization`, `_signFundingVoucher`, `_signActivation`, `_signSettlementAuthorization`, `_signCloseAuthorization`, `_closeAuthorization`.

**Step 2: Run compile RED check**

Run:

```bash
FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowClose.t.sol
```

Expected at this sub-step: the file compiles. Tests may fail because `ResearchEscrow.close` and close read interfaces are not implemented. If it fails from syntax/import/helper mistakes, fix the test.

### Task 2: Add success-path RED tests

**Files:**

- Modify: `contracts/test/unit/escrow/ResearchEscrowClose.t.sol`

**Step 1: Empty liabilities close**

Add:

```solidity
function testSignedCloseWithEmptyLiabilitiesRefundsBudgetAndRecordsReason() public {
    address buyer = VM.addr(BUYER_KEY);
    (FactoryDeployment memory deployment, ResearchEscrowEip712.FundingVoucher memory voucher, address escrow) =
        _activeEscrow(buyer);

    CanonicalResearch.LiabilityItem[] memory liabilities = new CanonicalResearch.LiabilityItem[](0);
    bytes32[] memory expectedRequestKeys = new bytes32[](0);
    bytes32 liabilityHash = CanonicalResearch.finalLiabilityHashForRequests(liabilities, expectedRequestKeys, 0);
    ResearchEscrowEip712.CloseAuthorization memory authorization =
        _closeAuthorization(escrow, voucher, 1, liabilityHash, 0, 201, NOW_TS, NOW_TS + 5 minutes);

    VM.prank(SETTLER);
    IResearchEscrowClose(escrow).close(liabilities, expectedRequestKeys, authorization, _signCloseAuthorization(escrow, authorization));

    assert(ResearchEscrow(escrow).state() == ResearchEscrow.EscrowState.Closed);
    assert(IResearchEscrowClose(escrow).closeReason() == 1);
    assert(IResearchEscrowClose(escrow).finalLiabilityHash() == liabilityHash);
    assert(IResearchEscrowClose(escrow).closeNonceUsed(201));
    assert(deployment.usdc.balanceOf(escrow) == 0);
    assert(deployment.usdc.balanceOf(buyer) == BUDGET_UNITS);
}
```

**Step 2: PAID liability close**

Settle one request, compute:

```solidity
bytes32 resultDigest = CanonicalResearch.settlementResultDigest(SETTLEMENT_KEY, itemsHash, FIRST_AMOUNT, 1);
liabilities[0] = CanonicalResearch.LiabilityItem({
    requestKey: REQUEST_KEY_1,
    amount: FIRST_AMOUNT,
    terminalState: 1,
    settlementKey: SETTLEMENT_KEY,
    terminalEvidenceHash: resultDigest
});
```

Then close with `spent = FIRST_AMOUNT` and assert buyer receives `BUDGET_UNITS - FIRST_AMOUNT`, close metadata is recorded, and escrow is Closed.

**Step 3: VOID and UNPAYABLE canonical liabilities close**

Use sorted request keys:

```solidity
liabilities[0] = CanonicalResearch.LiabilityItem({
    requestKey: REQUEST_KEY_1,
    amount: 0,
    terminalState: 2,
    settlementKey: bytes32(0),
    terminalEvidenceHash: keccak256("void-before-side-effect")
});
liabilities[1] = CanonicalResearch.LiabilityItem({
    requestKey: REQUEST_KEY_2,
    amount: 0,
    terminalState: 3,
    settlementKey: bytes32(0),
    terminalEvidenceHash: keccak256("manual-unpayable")
});
```

Close with `closeReason = 2` or `3`, `spent = 0`, and assert full refund plus metadata.

### Task 3: Add canonical liability and authorization negative RED tests

**Files:**

- Modify: `contracts/test/unit/escrow/ResearchEscrowClose.t.sol`

**Step 1: Canonical liability invalid cases**

Add tests that use exact future selectors or canonical library selectors, not generic reverts:

- duplicate expected request keys / duplicate liabilities should revert with `CanonicalResearch.UnsortedKeys.selector`.
- omitted expected request key should revert with `CanonicalResearch.MissingLiability.selector`.
- unknown terminal state should revert with `CanonicalResearch.InvalidTerminalState.selector`.
- PAID liability whose requestKey was not settled should revert with `IResearchEscrowClose.PaidLiabilityNotSettled.selector`.
- PAID liability whose terminalEvidenceHash does not equal `settlementResultDigest` should revert with `IResearchEscrowClose.PaidLiabilityResultMismatch.selector`.
- authorization `spent` mismatch should revert with `CanonicalResearch.SpentMismatch.selector` or `IResearchEscrowClose.InvalidCloseAuthorization.selector`.

**Step 2: Authorization field and signature cases**

Cover:

- `closeReason = 0` or `4`.
- `finalLiabilityHash = bytes32(0)`.
- wrong `escrow`, wrong `researchKey`, tampered `nonce`, tampered `spent`.
- wrong signer key.
- signer no longer has only `INTENT_SIGNER_ROLE`.
- caller lacks `SETTLER_ROLE`.
- issuedAt in future, expired window, `deadline - issuedAt > 5 minutes`, `deadline > expectedExpiresAt`.
- close nonce replay / calling close again after successful close.

Use `VM.expectPartialRevert(selector)` immediately before the close call.

**Step 3: Early-close guard cases**

Cover:

- Funded state rejects signed close.
- buyer direct call before expiry rejects even if buyer has a valid-looking auth.
- Closed escrow rejects second close.

### Task 4: Record RED evidence and task status

**Files:**

- Create: `.devos/tasks/onchain-research-escrow-5-9/requirement.md`
- Create: `.devos/tasks/onchain-research-escrow-5-9/design.md`
- Create: `.devos/tasks/onchain-research-escrow-5-9/progress.md`
- Create: `.devos/tasks/onchain-research-escrow-5-9/test-report.md`
- Create: `.devos/tasks/onchain-research-escrow-5-9/review.md`
- Modify: `openspec/changes/onchain-research-escrow/tasks.md`

**Step 1: Run RED command**

Run:

```bash
FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowClose.t.sol
```

Expected: non-zero exit. The important failure should be missing close implementation/read interface behavior, not parser/type errors.

**Step 2: Run non-behavior checks**

Run:

```bash
FOUNDRY_OFFLINE=true forge fmt --root contracts --check
git diff --check
openspec validate onchain-research-escrow --strict --no-interactive
```

Expected: all pass.

**Step 3: Update artifacts**

Record the RED result and checks. If RED is correct, mark 5.9 as complete in `openspec/changes/onchain-research-escrow/tasks.md`. Do not claim the full contract suite is green; it is expected to remain red until 5.12 implements close/refund.
