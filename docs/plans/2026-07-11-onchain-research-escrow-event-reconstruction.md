# Onchain Research Escrow 6.4 Event Reconstruction Implementation Plan

> **For worker:** REQUIRED SUB-SKILL: Use test-driven-development. Do not stage, commit, push, deploy, broadcast, or touch external chain state.

**Goal:** Add complete reconstruction tests proving source revision, child lineage, funding, activation, settlement, close/refund/recovery events plus read interfaces are enough to rebuild public escrow facts.

**Architecture:** Add one focused Solidity test file that records logs across Registry → Factory → Escrow flows and reconstructs a compact mirror from event topics/data plus read interfaces. If RED exposes missing close/refund/recovery events, add minimal Escrow events and emits without changing money movement.

**Tech Stack:** Foundry Solidity tests, existing `RoleIsolationFixture`, `MockUSDC`, existing canonical/EIP-712 helpers.

---

### Task 1: Add RED reconstruction tests

**Files:**
- Create: `contracts/test/unit/escrow/ResearchEscrowEventReconstruction.t.sol`
- Create/update: `.devos/tasks/onchain-research-escrow-6-4/*`

**Step 1: Write the failing test**

Create tests that execute and record logs for:

- Registry `FactoryBound` and `SourceConfigured` create/update; assert `getSource` matches reconstructed latest revision.
- Factory `ResearchEscrowCreated` and `ResearchEscrowFunded`; assert `predictEscrow`, `escrowOf`, clone `factory/registry/usdc/buyer/researchKey/initialBudget/expectedExpiresAt/activationCutoff/plannedIntentSigner/state/accountedBalance` match reconstructed lineage/funding.
- Escrow `ResearchEscrowActivated`; assert `activeIntentSigner`, `activationNonceUsed`, state and read interfaces match.
- Escrow settlement summary and item events; assert `settlementResult`, `processedSettlementKey`, `processedRequestKey`, `spent`, `accountedBalance` match.
- Escrow signed close event; assert close reason, final liability hash, `budgetRefund`, `excessRefund`, state and zero balance match.
- Separate expired refund and closed excess recovery flows; assert emitted refund/recovery events and read interfaces match.

**Step 2: Run RED**

Run:

```bash
FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowEventReconstruction.t.sol
```

Expected before GREEN: fail if close/refund/recovery events are missing.

### Task 2: Add minimal missing events

**Files:**
- Modify: `contracts/src/escrow/ResearchEscrow.sol`

**Step 1: Add only observability events needed by tests**

Likely events:

```solidity
event ResearchEscrowClosed(
    address indexed buyer,
    bytes32 indexed researchKey,
    bytes32 indexed finalLiabilityHash,
    uint8 closeReason,
    uint256 spent,
    uint256 budgetRefund,
    uint256 excessRefund
);
event ResearchEscrowExpiredRefunded(
    address indexed buyer,
    bytes32 indexed researchKey,
    uint256 budgetRefund,
    uint256 excessRefund
);
event ResearchEscrowExcessRecovered(address indexed buyer, bytes32 indexed researchKey, uint256 amount);
```

Emit after state/refund fields are finalized and after recovery transfer succeeds. Do not change authorization, accounting, transfer ordering, or recipient logic.

**Step 2: Run GREEN**

Run focused test again. Then run:

```bash
FOUNDRY_OFFLINE=true forge fmt --root contracts --check
FOUNDRY_OFFLINE=true forge test --root contracts
git diff --check
openspec validate onchain-research-escrow --strict --no-interactive
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

### Task 3: Review and mark complete

**Files:**
- Update: `.devos/tasks/onchain-research-escrow-6-4/test-report.md`
- Update: `.devos/tasks/onchain-research-escrow-6-4/review.md`
- Update: `openspec/changes/onchain-research-escrow/tasks.md`
- Update: `.Codex/session-state.md`

Only mark 6.4 complete after focused and full verification pass and review finds no blocking issues.
