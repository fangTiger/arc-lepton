import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const HANDOFF_PATH = resolve(
  ROOT,
  "docs/plans/2026-07-11-onchain-research-escrow-deployment-authorization-handoff.md",
);

async function readHandoff() {
  return readFile(HANDOFF_PATH, "utf8");
}

test("deployment authorization handoff lists stage-scoped user approval boundaries", async () => {
  const handoff = await readHandoff();

  for (const phrase of [
    "deploy_core_contracts",
    "configure_sources_and_roles",
    "smoke_usdc_spend",
    "chainId 5042002",
    "DataSourceRegistry",
    "ResearchEscrow implementation",
    "ResearchEscrowFactory",
    "requestDigest",
    "deployment-authorization-package.mjs",
    "node contracts/scripts/deployment-authorization-package.mjs evidence-package.json",
    "deployment-authorization-package.node-test.mjs",
    "stageOrder",
    "nextStage",
    "manifestDigest",
    "deployment-authorization-briefing.mjs",
    "node contracts/scripts/deployment-authorization-briefing.mjs request.json",
    "buildAuthorizationBriefing",
    "deployment-authorization-briefing.node-test.mjs",
    "stdout",
    "不读 env",
    "不访问网络",
    "maxUsdcUnits = 0",
    "test USDC",
    "不得复用部署授权",
    "不得执行 --broadcast",
    "不勾 13.1",
    "不勾 13.2",
    "不勾 13.3",
  ]) {
    assert.ok(handoff.includes(phrase), `handoff must mention ${phrase}`);
  }
});

test("deployment authorization handoff lists every public role/address input", async () => {
  const handoff = await readHandoff();

  for (const envName of [
    "ARC_DEPLOYER",
    "ARC_FACTORY_GOVERNANCE",
    "ARC_REGISTRY_GOVERNANCE",
    "ARC_SOURCE_ADMIN",
    "ARC_FUNDING_SIGNER",
    "ARC_INTENT_SIGNER",
    "ARC_SETTLER",
  ]) {
    assert.ok(handoff.includes(envName), `handoff must mention ${envName}`);
  }
});

test("deployment authorization handoff treats evidence-package.json as a public path example only", async () => {
  const handoff = await readHandoff();

  for (const phrase of [
    "公开 evidence package 路径示例",
    "必须替换为当次生成的公开 evidence package 路径",
    "不得把示例路径当作固定文件名",
    "不能替代 13.1 授权记录",
    "不能替代 13.2 preflight 通过证明",
    "不能替代最终 manifest/verifier 公开部署证据",
    "输入必须是公开 evidence package，不得包含 secrets",
  ]) {
    assert.ok(handoff.includes(phrase), `handoff must mention ${phrase}`);
  }
});

test("deployment authorization handoff documents machine-readable package safety flags", async () => {
  const handoff = await readHandoff();

  for (const phrase of [
    "safety.externalWritesAuthorized = false",
    "safety.broadcastAllowed = false",
    "safety.authorizedStages = []",
    "safety.notAuthorizationRecord = true",
    "safety.notPreflightProof = true",
    "safety.notFinalManifestOrVerifierEvidence = true",
    "safety.stageAuthorizationReuseAllowed = false",
    "safety.noResponseOrAmbiguousApprovalStops = true",
    "safety.inputChangeRequiresNewAuthorization = true",
    "用户未回应或模糊同意",
    "request/commit/address/gas/maxUsdcUnits 改变后必须重新授权",
  ]) {
    assert.ok(handoff.includes(phrase), `handoff must mention ${phrase}`);
  }
});

test("deployment authorization handoff does not contain secret-shaped placeholders", async () => {
  const handoff = await readHandoff();
  const forbiddenPatterns = [
    [/=\s*0x[a-fA-F0-9]{64}\b/, "private-key-shaped assignment"],
    [/https?:\/\/[^\s/@:]+:[^\s/@]+@/i, "credentialed HTTP URL"],
    [/wss?:\/\/[^\s/@:]+:[^\s/@]+@/i, "credentialed websocket URL"],
    [/RAW_(FUNDING|ACTIVATION|SETTLEMENT|CLOSE)_SIGNATURE\s*=/i, "raw signature placeholder"],
    [/(mnemonic|seed phrase)\s*[:=]\s*[a-z]+(\s+[a-z]+){11,}/i, "mnemonic placeholder"],
  ];

  for (const [pattern, label] of forbiddenPatterns) {
    assert.doesNotMatch(handoff, pattern, `handoff must not contain ${label}`);
  }
});
