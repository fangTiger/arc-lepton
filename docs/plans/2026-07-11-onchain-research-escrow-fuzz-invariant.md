# Onchain Research Escrow Fuzz/Invariant Plan

**Goal:** Complete OpenSpec task 5.13 by adding business fuzz/invariant coverage for the contract subsystem now that close/refund/recover is implemented.

**Scope:** Add tests under `contracts/test/invariant/` and, only if protected by those tests, make small readability cleanups in `ResearchEscrow.sol`. Do not change Factory/Registry APIs or deployment scripts.

## Coverage targets

- Accounting: `spent <= initialBudget`, `accountedBalance == initialBudget - spent`, actual Active/Funded balance never drops below accounted balance, Closed balance can only be recoverable excess.
- Key safety: successful settlement consumes settlementKey/requestKey once; failed/replayed operations do not increase spent or move extra funds.
- Role safety: settlement/close remain two-party; role drift fails closed.
- Expiry/pause: creation pause does not block existing signed settlement/close/refund, and expiry refund always sends funds only to buyer.
- Malicious token behavior: fee-on-transfer/false-return/revert/reentrant token paths keep state atomic.

## Verification

- `npm run contracts:test:fuzz`
- `npm run contracts:test:invariant`
- `FOUNDRY_OFFLINE=true forge test --root contracts`
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`
- `git diff --check`
- `openspec validate onchain-research-escrow --strict --no-interactive`
- Rebuild Graphify after Solidity changes.
