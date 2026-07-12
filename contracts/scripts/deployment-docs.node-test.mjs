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
  requireIncludes(section, "fresh stage-specific authorization", "README escrow section");
  requireIncludes(section, "not final deployment evidence", "README escrow section");
  requireIncludes(section, "13.x/14.8/14.9", "README escrow section");
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
    "未授权时不得广播任何部署、source、角色或 smoke 交易",
    "只要 `deployments/5042002.json`、Explorer exact-match、独立 verifier 或 smoke evidence 任一项缺失或不一致",
  ]) {
    requireIncludes(runbook, expected, "deployment runbook");
  }
});
