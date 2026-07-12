# ARC Lepton 合约工程

本目录是链上 research escrow 的独立 Foundry 工程。当前阶段只建立可复现工具链基线，尚未包含 Registry、Factory、Escrow 或部署脚本，也不会执行任何链上写入。

## 固定工具链

- Foundry：`1.5.1-stable`
- Foundry commit：`b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`
- Solidity：`0.8.30`，关闭自动版本探测
- EVM：`prague`
- optimizer：开启，`runs = 200`
- via IR：关闭
- OpenZeppelin Contracts：`v5.6.1`，peeled commit `5fd1781b1454fd1ef8e722282f86f9293cacf256`

`.foundry-version` 固定 Foundry 发布版本，`foundry.toml` 显式固定编译器、EVM、优化器、metadata、build-info 和工程路径。`remappings.txt` 只提供 OpenZeppelin 的受控映射。`lib/`、`out/`、`cache/` 和 `broadcast/` 均为可重建的本地产物，不进入 Git 交付差异。

## 复现依赖

`foundry.lock` 记录 Foundry 解析 exact tag 后得到的完整 revision。以下流程统一从仓库根目录进入合约工程；不要在仓库根目录使用相对的 `--root contracts` 执行 `forge install`，以免触发 Foundry 1.5.1 的嵌套工程路径解析问题。

```bash
cd contracts
forge install --no-git openzeppelin-contracts=OpenZeppelin/openzeppelin-contracts@tag=v5.6.1
git diff --exit-code -- foundry.lock
```

安装后必须验证实际包版本；命令非零退出即表示依赖不符合基线：

```bash
node -e 'const p = require("./lib/openzeppelin-contracts/package.json"); if (p.version !== "5.6.1") process.exit(1)'
```

由于 `--no-git` 安装目录不保留可用于 tag 证明的 Git 元数据，发布或更新依赖前还必须创建隔离 clone，并明确对该 clone 使用 `git -C` 核对 tag、peeled commit 和包版本：

```bash
EXPECTED_OZ_REV=5fd1781b1454fd1ef8e722282f86f9293cacf256
OZ_VERIFY_ROOT="$(mktemp -d)"
OZ_CLONE_DIR="$OZ_VERIFY_ROOT/openzeppelin-contracts"

git clone --branch v5.6.1 --depth 1 --recurse-submodules \
  https://github.com/OpenZeppelin/openzeppelin-contracts.git "$OZ_CLONE_DIR"

git -C "$OZ_CLONE_DIR" rev-parse HEAD
git -C "$OZ_CLONE_DIR" rev-parse 'refs/tags/v5.6.1^{commit}'
git -C "$OZ_CLONE_DIR" describe --exact-match --tags HEAD

test "$(git -C "$OZ_CLONE_DIR" rev-parse HEAD)" = "$EXPECTED_OZ_REV"
test "$(git -C "$OZ_CLONE_DIR" rev-parse 'refs/tags/v5.6.1^{commit}')" = "$EXPECTED_OZ_REV"
test "$(git -C "$OZ_CLONE_DIR" describe --exact-match --tags HEAD)" = "v5.6.1"
node -e 'const p = require(process.argv[1]); if (p.version !== "5.6.1") process.exit(1)' \
  "$OZ_CLONE_DIR/package.json"
```

上述检查的 HEAD 与 peeled commit 必须都等于 `5fd1781b1454fd1ef8e722282f86f9293cacf256`，exact tag 必须为 `v5.6.1`。不得改用 branch、浮动 tag 或未锁定源码。

## 本地验证

首次准备新 checkout 时，先按“复现依赖”安装 OpenZeppelin，并执行一次允许下载精确 Solc `0.8.30` 的 `forge build`。完成该 bootstrap 后，日常门禁统一从仓库根目录运行以下九个命令：

```bash
npm run contracts:tooling:test
npm run contracts:fmt
npm run contracts:build
npm run contracts:test:unit
npm run contracts:test:fuzz
npm run contracts:test:invariant
npm run contracts:coverage
npm run contracts:slither
npm run contracts:artifacts:check
```

除首次依赖和编译器 bootstrap 外，这些命令均通过 `FOUNDRY_OFFLINE=true` 禁止 Foundry 下载依赖或编译器。`contracts:slither` 要求调用环境预先安装精确的 `slither-analyzer==0.11.5`；CI 使用隔离 Python 3.12 环境安装并核对版本。该命令通过三层失败关闭门禁避免 Slither 编译失败时假绿：先核对 Slither 精确版本；再离线执行 `forge clean` 和强制 `forge build`，任一步失败都不会运行 Slither；最后执行带 `--fail-medium` 的静态分析，并拒绝内部编译失败标记、非唯一 build-info、无法解析或合约数/检测器数为零的分析摘要。`--foundry-compile-all` 让尚无 `src/` 的基线工程也能生成分析输入，`lib/test/script` 的 findings 仍被过滤。所有命令只执行本地格式、编译、测试、覆盖率、静态分析或 artifact 检查，不读取 RPC、钱包、私钥，也不广播交易。

`contracts:artifacts:check` 会先清理旧产物，再用固定配置强制构建，并检查当前 `.foundry-version`、`foundry.lock` 和唯一 build-info 的工具链/编译设置一致性。它只能证明当前 checkout 的设置与产物相符，不等同于任务 1.5 要求的 clean checkout、clean commit 与跨环境可复现 artifact 门禁。

```bash
forge --version
forge config --json
forge build
FOUNDRY_OFFLINE=true forge fmt --check
FOUNDRY_OFFLINE=true forge build
FOUNDRY_OFFLINE=true forge test --match-path test/ToolchainBaseline.t.sol -vv
```

预期 `forge --version` 输出 Foundry `1.5.1-stable` 和上述 commit。首次 `forge build` 必须先成功安装或缓存配置中精确固定的 Solc `0.8.30`；随后三条带 `FOUNDRY_OFFLINE=true` 的命令才用于不访问外部签名解析服务的离线格式、编译和测试验证。整个流程不包含 RPC、广播、私钥或 test USDC 操作。
