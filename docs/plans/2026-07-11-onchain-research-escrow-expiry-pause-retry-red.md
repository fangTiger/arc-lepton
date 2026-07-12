# Onchain Research Escrow Expiry/Pause/Retry RED Plan

**Goal:** Add RED coverage for OpenSpec task 5.10 without implementing production close/refund logic.

**Scope:** Extend `contracts/test/unit/escrow/ResearchEscrowClose.t.sol` because 5.10 depends on the same future close/refund surface introduced by 5.9.

## RED cases

- `refundExpired()` can be called by any account after `expectedExpiresAt`, but funds only go to `buyer`.
- `refundExpired()` before expiry reverts with a future exact selector.
- Failed close signature does not consume nonce/state and can retry with the valid signature.
- Factory creation pause does not block existing signed settlement, signed close, or expired refund.

## Verification

- Focused Forge command should compile and fail until 5.12 implements close/refund.
- `forge fmt --check`, `git diff --check`, and `openspec validate` must pass.
- Rebuild Graphify after changing Solidity tests.
