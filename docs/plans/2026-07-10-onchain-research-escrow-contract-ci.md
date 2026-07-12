# On-chain Research Escrow：合约命令与 CI 门禁实施计划

> 主代理负责本计划与最终验收；新的 worker 负责实现；reviewer 依次执行规范符合性与代码质量审查。全程仅允许本地/CI 构建和静态分析，不允许任何链上写入。

**目标：** 完成 OpenSpec 任务 1.2，在不改变既有 Next.js 命令语义的前提下，为合约增加可执行的 fmt/build/unit/fuzz/invariant/coverage、Slither 与 artifact 设置一致性命令，并接入现有 GitHub Actions。

**方案选择：**

1. 仅增加 npm aliases：改动最小，但无法证明 CI 真正执行，拒绝。
2. npm aliases + 单个合约 CI step：简单，但依赖、静态分析和各测试类型耦合，诊断性差。
3. **采用：npm aliases + 独立 contracts job + 设置一致性 verifier。** Web job 原样保留；合约 job 显式 bootstrap 后离线执行每一道门禁。clean Git checkout 双构建/发布 hash 门禁仍留给任务 1.5，不在本任务越界实现。

## 固定命令契约

根 `package.json` 只新增以下 scripts，现有 `dev/build/start/lint/typecheck/test/db:generate/db:push` 的键和值必须逐字不变：

- `contracts:tooling:test`
- `contracts:fmt`
- `contracts:build`
- `contracts:test:unit`
- `contracts:test:fuzz`
- `contracts:test:invariant`
- `contracts:coverage`
- `contracts:slither`
- `contracts:artifacts:check`

约束：

- bootstrap 之外的 Forge 命令必须 `FOUNDRY_OFFLINE=true`。
- fuzz 固定 `1024` runs，并只匹配 `^testFuzz`。
- invariant 固定 `256` runs、depth `64`、`fail_on_revert=true`，并只匹配 `^invariant_`；Foundry 1.5.1 不支持 `--invariant-runs` CLI，必须使用 `FOUNDRY_INVARIANT_*` 环境变量。
- coverage 输出 summary。
- Slither 固定 `slither-analyzer==0.11.5`，排除 dependency/test/script 路径的 findings，并以 `medium` 及以上为失败边界。
- artifact 检查先清理 ignored `contracts/out`/`cache`，离线强制重建，再校验 Foundry/Solc/EVM/optimizer/viaIR/metadata/remapping/OZ lock 与 build-info 一致；本任务只输出稳定公开 digest，不声称 clean-checkout 可复现发布。

## Task 1：RED — 根命令与 workflow 契约测试

**Files:**

- Create: `contracts/scripts/tooling-config.node-test.mjs`

1. 使用 Node 内置 test runner 读取 `package.json` 与 `.github/workflows/test.yml`。
2. 固定既有 Web scripts/job 的关键命令，断言上述九个合约 scripts、独立 contracts job、Foundry v1.5.1、OZ exact tag、Slither 0.11.5 和所有门禁步骤存在。
3. 先运行 `node --test contracts/scripts/tooling-config.node-test.mjs`；预期因合约 scripts/job 缺失而失败。

## Task 2：GREEN — 新增根 scripts 与独立 CI job

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/test.yml`
- Modify: `contracts/README.md`
- Create: `contracts/test/ToolingProfiles.t.sol`

1. 只向根 scripts 追加九个 `contracts:*` 命令。
2. 增加最小纯 Solidity fuzz/invariant 工具链测试，使专用命令至少各执行一个真实测试，避免“0 tests matched”假绿；不得创建可部署业务合约。
3. 在现有 workflow 中保留原 `test` job 内容和环境配置，新增 `contracts` job：
   - checkout、Node 20、Python 3.12；
   - official `foundry-rs/foundry-toolchain@v1`，输入精确 `v1.5.1`；
   - 从 `contracts/` 使用 OZ `@tag=v5.6.1 --no-git` bootstrap，并要求 `foundry.lock` 无差异；
   - 在线首次 build 只负责获取精确 Solc 0.8.30，之后逐 step 执行离线 tooling/fmt/build/unit/fuzz/invariant/coverage/artifact；
   - 精确安装 `slither-analyzer==0.11.5` 后执行 Slither；
   - contracts job 不注入 RPC、私钥、钱包或部署环境。
4. 更新合约 README 的本地命令和 CI 边界，不修改根 README。
5. 运行 RED 测试转绿，并逐个运行 unit/fuzz/invariant/coverage 命令。

## Task 3：RED/GREEN — artifact 设置一致性 verifier

**Files:**

- Create: `contracts/scripts/check-artifact-consistency.node-test.mjs`
- Create: `contracts/scripts/check-artifact-consistency.mjs`

1. 先写 Node fixture 测试，覆盖：正确 build-info/lock 通过；错误 Foundry、Solc、Prague、optimizer、viaIR、metadata、remapping、OZ tag/rev、缺失或多个 build-info 必须失败。
2. 在 verifier 尚不存在时运行 Node test，保存 module-not-found RED。
3. 实现无第三方依赖的 verifier：只读取明确文件、使用相对路径输出、稳定排序并计算 SHA-256；不得读取 `.env`、RPC 或 private key。
4. `contracts:artifacts:check` 必须 clean → offline force build → verifier，确保不受先前 coverage artifact 污染。

## Task 4：本地验证与双阶段审查

按顺序运行：

```bash
node --test contracts/scripts/*.node-test.mjs
npm run contracts:fmt
npm run contracts:build
npm run contracts:test:unit
npm run contracts:test:fuzz
npm run contracts:test:invariant
npm run contracts:coverage
npm run contracts:artifacts:check
```

Slither 不写入项目环境：在 `/private/tmp` 独立 venv 安装精确 0.11.5，使用该 PATH 运行 `npm run contracts:slither`。随后运行原 Web 回归：

```bash
npm test -- --run
npm run typecheck
npm run build
```

验收条件：所有新增门禁通过；fuzz/invariant 各至少执行 1 个测试；artifact verifier 输出稳定 digest；Web 三条原命令通过；pnpm lock 不变化；无 RPC/广播/密钥/USDC 操作。之后依次经过规范 reviewer 和质量 reviewer，原 worker 修复并由同一 reviewer 复审。
