import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const AUDIT_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-deployment-readiness-audit.md",
);

async function readAudit() {
  return readFile(AUDIT_PATH, "utf8");
}

test("deployment readiness audit records 13.2 authorization boundary and local gate evidence", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "95/107 tasks",
    "13.2 只能在 13.1 明确授权后执行",
    "readiness audit",
    "不是授权记录",
    "不是 preflight 通过证明",
    "deployment-authorization-gate.node-test.mjs",
    "deployment-evidence-package.node-test.mjs",
    "deployment-preflight-gate.node-test.mjs",
    "predeploy-stoplight.node-test.mjs",
    "deployment-next-action-checklist.node-test.mjs",
    "deployment-manifest.node-test.mjs",
    "rpc-deployment-verifier.node-test.mjs",
    "smoke-evidence-verifier",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("deployment readiness audit lists authorization-time confirmations and current blockers", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "clean Git commit",
    "compiler settings",
    "deployer balance",
    "Factory/Registry Safe code",
    "source payout",
    "funding signer",
    "intent signer EOA",
    "settler",
    "官方 USDC",
    "public RPC finalized block",
    "用户对 `deploy_core_contracts` 的明确授权",
    "真实公开地址值",
    "dry-run 预计地址/gas",
    "公开 RPC finalized block",
    "clean-tree 发布 commit",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("deployment readiness audit recommends fail-closed command order without external writes", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "生成/展示 deploy_core_contracts requestDigest",
    "用户授权",
    "deployment-preflight-gate",
    "evidence package",
    "manifest",
    "verifier dry-run",
    "才能进入 13.3",
    "不得 --broadcast",
    "不替代 13.3–13.6",
    "不替代 14.2–14.4",
    "不替代 14.9",
    "private key",
    "mnemonic",
    "credentialed RPC",
    "raw signature",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("deployment readiness audit treats authorization package and handoff as non-authorization material", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "deployment-authorization-package.mjs",
    "deployment-authorization-handoff.md",
    "deployment-authorization-briefing.mjs",
    "deployment-next-action-checklist.mjs",
    "briefing",
    "nextAction checklist",
    "requestDigest",
    "不能替代 13.1 授权记录",
    "不能替代 13.2 preflight 通过证明",
    "不能替代 13.6 final public verifier",
    "不能替代最终 manifest/verifier",
    "不能替代 14.2–14.4 真实 rollout/E2E",
    "不能替代 14.9 live rollback",
    "用户未回应或模糊同意必须停止",
    "request/commit/address/gas/maxUsdcUnits 变化必须重新授权",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("deployment readiness audit documents predeploy commit staging hazards", async () => {
  const audit = await readAudit();

  for (const phrase of [
    "不要使用 `git add .`",
    ".devos/",
    "cache/invariant/failures/",
    "contracts/out/",
    "contracts/cache/",
    "contracts/lib/",
    ".env*",
    "只暂存源码、测试、OpenSpec、docs/contracts、docs/plans、README、package 和 CI 配置",
    "先用 `git status --short --untracked-files=all` 复核候选文件",
    "predeploy-stoplight.mjs",
    "deployment-next-action-checklist.mjs",
    "nextAction=request_explicit_authorization",
    "nextAction=run_authorized_preflight",
    "broadcastAllowed=false",
    "只能阻止和解释，不能授权",
  ]) {
    assert.ok(audit.includes(phrase), `audit must mention ${phrase}`);
  }
});

test("deployment readiness audit does not contain secret-shaped material", async () => {
  const audit = await readAudit();
  const forbiddenPatterns = [
    [/=\s*0x[a-fA-F0-9]{64}\b/, "private-key-shaped assignment"],
    [/https?:\/\/[^\s/@:]+:[^\s/@]+@/i, "credentialed HTTP URL"],
    [/wss?:\/\/[^\s/@:]+:[^\s/@]+@/i, "credentialed websocket URL"],
    [/RAW_(FUNDING|ACTIVATION|SETTLEMENT|CLOSE)_SIGNATURE\s*=/i, "raw signature placeholder"],
    [/(mnemonic|seed phrase)\s*[:=]\s*[a-z]+(\s+[a-z]+){11,}/i, "mnemonic placeholder"],
  ];

  for (const [pattern, label] of forbiddenPatterns) {
    assert.doesNotMatch(audit, pattern, `audit must not contain ${label}`);
  }
});
