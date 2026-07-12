# On-chain Research Escrow：Foundry 基线实施计划

> 执行规则：主代理只负责规划和验收；worker 负责实现；reviewer 依次执行规范符合性审查和代码质量审查。未经用户新的明确授权，任何代理都不得执行 Arc Testnet 写入、角色变更或 test USDC 支出。

**目标：** 完成 OpenSpec 任务 1.1，建立可复现、不会改变现有 Next.js 运行语义的 `contracts/` Foundry 基线。

**规范来源：**

- `openspec/changes/onchain-research-escrow/proposal.md`
- `openspec/changes/onchain-research-escrow/design.md` 的 Decision 11
- `openspec/changes/onchain-research-escrow/tasks.md` 的任务 1.1
- `openspec/changes/onchain-research-escrow/specs/contract-deployment-evidence/spec.md` 的 clean/reproducible build 要求

**固定工具链：**

- Foundry `1.5.1-stable`（本机已验证版本，commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`）
- Solidity `0.8.30`
- EVM `prague`（Arc Testnet 官方执行环境）
- optimizer 开启，`runs = 200`
- `via_ir = false`
- OpenZeppelin Contracts `v5.6.1`，依赖必须通过 exact ref 与 `foundry.lock` 固定
- metadata/build-info 设置必须显式写入配置，禁止依赖 Foundry 隐式默认值

## Task 1：先建立失败的工具链基线测试

**Files:**

- Create: `contracts/test/ToolchainBaseline.t.sol`

1. 先写最小 Forge 测试，使用精确 `pragma solidity 0.8.30`，并从 `@openzeppelin/contracts/` 导入一个稳定工具库。
2. 在尚无 Foundry 配置和依赖时运行：

   ```bash
   /Users/captain/.foundry/bin/forge test --root contracts --match-path test/ToolchainBaseline.t.sol
   ```

3. 保存 RED 证据：命令必须因缺少配置、remapping 或 OpenZeppelin 依赖而失败；不得以语法错误制造失败。

## Task 2：创建最小、显式、可复现的 Foundry 工程

**Files:**

- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `contracts/.foundry-version`
- Create: `contracts/README.md`
- Generate: `contracts/foundry.lock`
- Create directories as needed: `contracts/src/`, `contracts/test/`, `contracts/script/`

1. 在 `foundry.toml` 显式固定 source/test/script/out/cache 路径、Solidity 0.8.30、Prague、optimizer/runs、viaIR、metadata、build-info 和依赖搜索路径。
2. 在 `.foundry-version` 固定 `1.5.1`，README 记录完整 Foundry commit 与复现命令。
3. 使用 exact tag 安装 OpenZeppelin `v5.6.1`，让 Foundry 生成包含精确 revision 的 `foundry.lock`；`contracts/lib/` 保持为可重建且被忽略的本地产物。
4. `remappings.txt` 只声明受控、无歧义的 OpenZeppelin remapping。
5. 不创建 Registry、Factory、Escrow 或任何可部署业务合约；不修改根 `package.json` 的既有命令。

## Task 3：GREEN 验证与最小整理

**Files:**

- Verify: `contracts/foundry.toml`
- Verify: `contracts/foundry.lock`
- Verify: `contracts/test/ToolchainBaseline.t.sol`

依次运行：

```bash
/Users/captain/.foundry/bin/forge config --root contracts --json
/Users/captain/.foundry/bin/forge fmt --root contracts --check
/Users/captain/.foundry/bin/forge build --root contracts
/Users/captain/.foundry/bin/forge test --root contracts --match-path test/ToolchainBaseline.t.sol -vv
```

验收条件：

- 解析后的配置精确显示 Solidity `0.8.30`、EVM `prague`、optimizer=true、runs=200、viaIR=false。
- OpenZeppelin import 只通过固定 remapping 解析，lock 中存在不可漂移的 exact revision。
- fmt/build/test 全部通过，且测试至少 1 个、0 失败。
- 根 Next.js 源码、`package.json`、README 和用户已暂存图片不发生变化。
- `contracts/out/`、`contracts/cache/`、`contracts/lib/`、`contracts/broadcast/` 不进入 Git 交付差异。
- 没有链上交易、RPC 广播、私钥读取或 test USDC 操作。

## Task 4：双阶段审查

1. 规范 reviewer 只对照任务 1.1、上述固定工具链与边界，输出 PASS 或逐条缺口。
2. worker 修复全部规范缺口后，由同一规范 reviewer 复审。
3. 代码质量 reviewer 检查配置可维护性、依赖可重建性、测试有效性、忽略规则和对现有应用的零影响。
4. worker 修复全部质量问题后，由同一质量 reviewer 复审。
5. 两阶段均通过且主代理独立重跑验证后，才把 OpenSpec 任务 1.1 标记为完成。
