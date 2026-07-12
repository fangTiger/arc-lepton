import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const READINESS_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-rollout-e2e-readiness.md",
);
const TASKS_PATH = resolve(ROOT, "openspec/changes/onchain-research-escrow/tasks.md");

async function readReadiness() {
  return readFile(READINESS_PATH, "utf8");
}

test("rollout readiness documents the 14.2 rollout order and write boundaries", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "14.2 rollout 顺序",
    "DB expand/backfill",
    "durable worker",
    "监控",
    "funding UI",
    "小流量切换",
    "ARC_RESEARCH_SETTLEMENT_BACKEND=escrow",
    "回滚点",
    "不得真实 DB migration",
    "不得真实切流",
    "不得 --broadcast",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("rollout readiness documents 14.3 successful E2E evidence requirements", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "14.3 成功 E2E",
    "prepare/quota",
    "非零资助",
    "activate",
    "最多三次 intent",
    "报告先完成",
    "异步真实 USDC settlement",
    "TX feed",
    "close/refund/excess recovery",
    "chainId 5042002",
    "tx hash",
    "block number",
    "commit",
    "资金影响",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("rollout readiness documents 14.4 failed E2E cases and fail-closed behavior", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "14.4 失败 E2E",
    "拒签",
    "账户变化",
    "错误网络",
    "funding_expired",
    "短 TTL",
    "Registry revision 变化",
    "runner/worker 崩溃",
    "RPC 不确定",
    "DB 确认失败",
    "到期退出",
    "fail-closed",
    "不替代真实 rollout/E2E",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("rollout readiness requires final 13.6 verifier evidence before rollout or E2E", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "13.6 独立公开 RPC verifier",
    "最终 deployments/5042002.json manifest",
    "不得使用候选 manifest",
    "不得使用本地模拟 verifier",
    "未通过 13.6 前不得开启 funding UI",
    "未通过 13.6 前不得小流量切换 ARC_RESEARCH_SETTLEMENT_BACKEND=escrow",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("rollout readiness treats authorization package and handoff as non-authorization safety material", async () => {
  const readiness = await readReadiness();

  for (const phrase of [
    "deployment-authorization-package.mjs",
    "deployment-authorization-handoff.md",
    "briefing",
    "requestDigest",
    "不能替代 13.1 授权记录",
    "不能替代 13.2 preflight 证明",
    "不能替代 13.6 final public verifier",
    "不能替代 14.2–14.4 真实 rollout/E2E",
    "用户未回应或模糊同意必须停止",
    "request/commit/address/gas/maxUsdcUnits 变化必须重新授权",
  ]) {
    assert.ok(readiness.includes(phrase), `readiness must mention ${phrase}`);
  }
});

test("rollout readiness keeps 14.2 through 14.4 unchecked until real execution", async () => {
  const tasks = await readFile(TASKS_PATH, "utf8");

  for (const taskId of ["14.2", "14.3", "14.4"]) {
    assert.match(
      tasks,
      new RegExp(`- \\[ \\] ${taskId.replace(".", "\\.")} `),
      `${taskId} must remain unchecked`,
    );
  }
});
