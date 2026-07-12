# Task 1.5：clean commit 与可复现 artifact 发布门禁计划

## 目标

建立可由后续部署/manifest 工具调用的纯本地发布策略门禁。它将当前 checkout 的 artifact 明确分类为 `temporary` 或 `final`：dirty/untracked/submodule/missing commit 时任何最终 manifest 发布请求必须 fail closed；只有 clean commit、隔离 checkout 重建声明同一 commit、且 artifact digest 精确一致时才允许调用 final publish callback。

## 边界与接口

- 新增 `contracts/scripts/reproducible-artifact-gate.mjs` 和对应 Node 测试；现有 `contracts:tooling:test` glob 自动收录，不修改 package/CI。
- 该模块不执行 Git、网络、RPC、文件写入或 manifest 写入；所有 Git 快照、isolated rebuild 和 publish 操作均经显式注入 callback 提供，方便测试和后续部署工具安全接线。
- Git 快照固定为 `headCommit`、porcelain status 与 recursive submodule status。commit 必须为 40 位 SHA-1；status 任何非空、submodule 任何非 clean 前缀、缺失/异常 commit 均拒绝 final。
- `requestFinal=false` 无论 Git 状态如何只能调用 temporary writer；`requestFinal=true` 必须先通过 clean Git 门禁，再要求 local digest 和 isolated digest 均是 64 位 SHA-256，且 isolated proof 的 commit 与 HEAD 相同、两份 digest 相同。失败时不得调用 final writer。
- 成功/失败均用稳定 `ArtifactPublicationGateError.code`，便于未来 CLI、manifest 工具和 verifier 输出机器可读结果。

## RED

先写 Node 测试并在模块不存在时记录 import RED。测试至少覆盖：

1. dirty tracked、untracked、dirty/uninitialized/conflicted submodule、缺失/短/非 hex commit 都拒绝 final，且 isolated build/final writer 零调用。
2. 非 final 请求即使 clean 也只能写 temporary，不能运行 isolated build 或 final writer。
3. clean 状态但 local/isolated digest 无效、isolated proof commit 不一致或 hash 不一致，均拒绝且不发布 final。
4. 唯一正向场景：clean commit + 相同合法 digest + 匹配 isolation proof，final writer 只调用一次并收到 commit/digest。
5. callback 抛错、返回 malformed proof、未知 request 字段和重复 publish callback 结果均 fail closed。

## GREEN 与验收

实现最小纯函数/异步编排器，严格校验输入与 callback 返回值；不在当前 dirty 工作树创建 final manifest。执行 Node tooling、Foundry、Slither、artifact 与 Web 回归；由 spec reviewer、quality reviewer 和根代理依次验收。

## 非目标

- 不创建 Git commit、worktree 或 clone；不 bootstrap 依赖、不联网。
- 不定义最终 manifest schema，也不写 `deployments/`。
- 不部署、广播、读 RPC、配置角色或花费 test USDC。
- 真实 `git worktree` 创建、可复现 build 命令、manifest 写入与链上比对留给 12.x/13.x。
