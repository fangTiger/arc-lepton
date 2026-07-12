# V1 Implementation Immutability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 固化 ResearchEscrow V1 implementation 不可替换约束，并用测试证明升级只能通过新 implementation、新 Factory 和新 manifest 发布。

**Architecture:** `ResearchEscrowFactory` 已在 constructor 中保存 `private immutable IMPLEMENTATION`，并通过 `implementation()`、`predictEscrow()`、`ResearchEscrowCreated` 和 EIP-1167 runtime 暴露可验证事实。本任务不引入可升级代理、不增加 setter，也不提前实现 12.x 的最终 manifest schema；只补齐审计口径的测试与任务记录。

**Tech Stack:** Foundry、Solidity 0.8.30、OpenZeppelin Clones、OpenSpec。

---

### Task 1: RED — 证明当前测试缺少“无升级入口”审计口径

**Files:**
- Create: `contracts/test/unit/factory/ResearchEscrowFactoryV1Immutability.t.sol`

**Step 1: Write the failing tests**

新增测试合约，覆盖：

- 对 V1 Factory 尝试常见升级 selector：`upgradeTo(address)`、`upgradeToAndCall(address,bytes)`、`setImplementation(address)`、`changeImplementation(address)`、`updateImplementation(address)`，调用必须失败或无效果。
- 每次尝试后 `factory.implementation()`、`predictEscrow(buyer,researchKey)` 和已创建 clone runtime 仍指向原 implementation。
- 部署第二套 implementation + Registry + Factory 后，新 Factory 可形成新的 manifest 拓扑，但旧 Factory 和旧 clone 仍指向旧 implementation，且同一 `(buyer,researchKey)` 的预测地址因 Factory 地址不同而不同。

**Step 2: Run RED**

Run: `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/factory/ResearchEscrowFactoryV1Immutability.t.sol`

Expected: 初始应失败，因为文件/测试尚不存在或测试暴露缺口。

### Task 2: GREEN — 最小实现

**Files:**
- Modify if needed: `contracts/src/factory/ResearchEscrowFactory.sol`
- Test: `contracts/test/unit/factory/ResearchEscrowFactoryV1Immutability.t.sol`

**Step 1: Prefer no production change**

如果现有 `private immutable IMPLEMENTATION`、缺少升级函数、CREATE2 salt 包含 Factory 地址的行为已满足测试，则不要修改生产合约。

**Step 2: If a gap appears, patch minimally**

仅当测试证明存在实际升级/替换路径时，才修改生产合约；不得引入 Transparent/UUPS/Beacon/ProxyAdmin 或任何 admin setter。

**Step 3: Run focused test**

Run: `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/factory/ResearchEscrowFactoryV1Immutability.t.sol`

Expected: all tests pass.

### Task 3: Verification and OpenSpec update

**Files:**
- Modify: `openspec/changes/onchain-research-escrow/tasks.md`
- Modify: `.devos/tasks/onchain-research-escrow-6-5/*.md`
- Modify: `.Codex/session-state.md`

**Step 1: Run validation**

Run:

- `FOUNDRY_OFFLINE=true forge test --root contracts`
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`
- `git diff --check`
- `openspec validate onchain-research-escrow --strict --no-interactive`

**Step 2: Rebuild Graphify after code changes**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

**Step 3: Mark task complete**

Only after focused/full verification and review, change task 6.5 from `- [ ]` to `- [x]`.
