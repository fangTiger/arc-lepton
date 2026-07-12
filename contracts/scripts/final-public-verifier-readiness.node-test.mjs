import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-final-public-verifier-readiness.md",
);
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("final public verifier readiness records 13.6 evidence and publication boundaries", async () => {
  const readiness = await readReadiness();
  const requiredPhrases = [
    "13.6 final public RPC verifier readiness",
    "独立公开 RPC verifier",
    "仅凭公开 RPC、权威 USDC 配置和 manifest",
    "deployments/5042002.json",
    "3 + R",
    "fundedCloneCount",
    "settledCloneCount",
    "smoke_usdc_spend",
    "finalized block",
    "Explorer exact-match",
    "角色 members/count/admin graph",
    "deployer 零权限",
    "source revision/payout/maxUnitPrice",
    "不能替代 13.6 真实 public verifier",
    "候选 manifest、本地模拟 verifier、readiness 文档不能替代",
    "任一不一致不得发布证据",
    "不得发布最终 manifest",
    "不得更新 README/docs/contracts 最终地址",
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(readiness.includes(phrase), `final public verifier readiness must include phrase: ${phrase}`);
  }
});

test("final public verifier readiness keeps task 13.6 unchecked until public verifier succeeds", async () => {
  const [readiness, tasks] = await Promise.all([readReadiness(), readFile(TASKS_PATH, "utf8")]);

  assert.ok(readiness.includes("13.6 仍 pending"), "readiness must not claim 13.6 complete");
  assert.ok(
    tasks.includes(
      "- [ ] 13.6 独立 verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke；任一不一致不得发布证据",
    ),
    "tasks.md must keep 13.6 unchecked",
  );
  assert.doesNotMatch(readiness, /13\.6 已完成|13\.6 complete/i, "readiness must not mark 13.6 complete");
});
