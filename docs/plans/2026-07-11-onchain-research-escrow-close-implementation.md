# Onchain Research Escrow Close Implementation Plan

**Goal:** Implement OpenSpec task 5.12 so the 5.9–5.11 close/refund/recover tests move from RED to GREEN.

**Scope:** Modify `contracts/src/escrow/ResearchEscrow.sol` only unless compilation proves a minimal supporting change is required. Do not change Factory/Registry semantics, deployment scripts, or frontend/backend code.

## Implementation checklist

- Add close state/read surface: `closeReason`, `finalLiabilityHash`, `closeNonceUsed`, `budgetRefund`, `excessRefund`, and `excessBalance()`.
- Implement signed `close(...)` for Active escrows:
  - reject replayed close nonce before state checks;
  - require Active state and current SETTLER_ROLE caller;
  - validate CloseAuthorization escrow/researchKey/final hash/spent/window/signature/current intent signer;
  - validate PAID liabilities against recorded settlement result summaries;
  - set Closed, close metadata, nonce, budget/excess refund accounting;
  - transfer full current USDC balance only to buyer.
- Implement `refundExpired()` for non-Closed escrows at/after `expectedExpiresAt`, callable by any account, with all funds sent only to buyer.
- Implement `recoverExcess()` for Closed escrows, callable by any account, with current balance sent only to buyer and close metadata unchanged.

## Verification

- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowClose.t.sol`
- `FOUNDRY_OFFLINE=true forge test --root contracts`
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`
- `git diff --check`
- `openspec validate onchain-research-escrow --strict --no-interactive`
- Rebuild Graphify after Solidity changes.
