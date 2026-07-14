import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readText(path) {
  return readFileSync(path, "utf8");
}

function requireIncludes(text, expected, label) {
  assert.ok(
    text.includes(expected),
    `${label} must include ${JSON.stringify(expected)}`,
  );
}

function extractSection(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n## /u);
  return next === -1 ? rest : rest.slice(0, next);
}

test("README on-chain escrow section points to the chain and final evidence entrypoint", () => {
  const readme = readText("README.md");
  const section = extractSection(readme, "## On-chain research escrow");

  requireIncludes(section, "3 + R", "README escrow section");
  requireIncludes(section, "chainId `5042002`", "README escrow section");
  requireIncludes(section, "`deployments/5042002.json`", "README escrow section");
  requireIncludes(section, "7141fae64465f44e4ebc2ce3648787e0b45c54fb", "README escrow section");
  requireIncludes(section, "0x98c9ff2110843186f5fa55f5b0af010eca0bf0d3", "README escrow section");
  requireIncludes(section, "fresh stage-specific authorization", "README escrow section");
  requireIncludes(section, "Explorer exact-match source/ABI verification", "README escrow section");
  requireIncludes(section, "production rollout/E2E", "README escrow section");
});

test("contract deployment runbook covers trust, rollout, rollback, and evidence boundaries", () => {
  const runbook = readText("docs/contracts/onchain-research-escrow.md");

  for (const expected of [
    "## 3 + R 拓扑",
    "## 信任边界",
    "## 角色矩阵",
    "## Funding UX",
    "## Worker SLA",
    "## 部署流程",
    "## 回滚流程",
    "## 密钥轮换",
    "## 事故处置",
    "## Explorer 证据与 manifest",
    "chainId `5042002`",
    "`deployments/5042002.json`",
    "7141fae64465f44e4ebc2ce3648787e0b45c54fb",
    "0x352b064d831f1ee8a6005a186971011fa0c5f8dd",
    "未授权时不得广播任何部署、source、角色或 smoke 交易",
    "Explorer exact-match 和 live rollout/E2E/rollback 仍是剩余发布门禁",
  ]) {
    requireIncludes(runbook, expected, "deployment runbook");
  }
});
