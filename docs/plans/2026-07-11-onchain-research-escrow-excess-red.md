# Onchain Research Escrow Excess RED Plan

**Goal:** Add RED coverage for OpenSpec task 5.11 without implementing production close/refund/recovery logic.

**Scope:** Extend `contracts/test/unit/escrow/ResearchEscrowClose.t.sol` because excess accounting belongs to the same future close/refund surface introduced by 5.9 and expanded in 5.10.

## RED cases

- Direct USDC transfers into an Active escrow are classified as excess and do not increase `initialBudget` or settlement capacity.
- Signed `close(...)` separates `budgetRefund = initialBudget - spent` from `excessRefund = actualBalance - budgetRefund`, transfers both only to buyer, and leaves escrow balance at zero.
- After `Closed`, any account can call `recoverExcess()` when USDC is later forced/transferred in, but the recipient remains buyer and close metadata does not change.
- `recoverExcess()` before `Closed` reverts, so excess cannot bypass normal settlement/close accounting.

## Verification

- Focused Forge command should compile and fail until 5.12 implements close/refund/recover.
- `forge fmt --check`, `git diff --check`, and `openspec validate` must pass.
- Rebuild Graphify after changing Solidity tests.
