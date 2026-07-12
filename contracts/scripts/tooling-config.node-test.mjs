import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FORGE_BUILD_ARGS,
  FORGE_CLEAN_ARGS,
  SLITHER_ARGS,
  SLITHER_VERSION,
  runSlither,
} from "./run-slither.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = resolve(repositoryRoot, "package.json");
const workflowPath = resolve(repositoryRoot, ".github/workflows/test.yml");
const vitestConfigPath = resolve(repositoryRoot, "vitest.config.ts");

const existingScripts = {
  dev: "next dev",
  build: "next build",
  start: "next start",
  lint: "next lint",
  typecheck: "tsc --noEmit",
  test: "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "node scripts/db-migrate.mjs",
  "db:push": "drizzle-kit push",
};

const contractScripts = {
  "contracts:tooling:test": "node --test contracts/scripts/*.node-test.mjs",
  "contracts:fmt": "FOUNDRY_OFFLINE=true forge fmt --root contracts --check",
  "contracts:build": "FOUNDRY_OFFLINE=true forge build --root contracts",
  "contracts:test:unit": "node contracts/scripts/run-forge-test-profile.mjs unit",
  "contracts:test:fuzz": "node contracts/scripts/run-forge-test-profile.mjs fuzz",
  "contracts:test:invariant": "node contracts/scripts/run-forge-test-profile.mjs invariant",
  "contracts:coverage":
    "FOUNDRY_OFFLINE=true forge coverage --root contracts --report summary",
  "contracts:slither": "node contracts/scripts/run-slither.mjs",
  "contracts:artifacts:check":
    "FOUNDRY_OFFLINE=true forge clean --root contracts && FOUNDRY_OFFLINE=true forge build --root contracts --force && node contracts/scripts/check-artifact-consistency.mjs",
};

const foundryActionSha = "b00af27efadbc7b4ca8b82abbd903b17cc874d2a";

const requiredUses = [
  "actions/checkout@v4",
  "actions/setup-node@v4",
  "actions/setup-python@v5",
  `foundry-rs/foundry-toolchain@${foundryActionSha}`,
];

const requiredRunCommands = [
  "forge install --no-git openzeppelin-contracts=OpenZeppelin/openzeppelin-contracts@tag=v5.6.1",
  "git diff --exit-code -- foundry.lock",
  "forge build --root contracts",
  "npm run contracts:tooling:test",
  "npm run contracts:fmt",
  "npm run contracts:build",
  "npm run contracts:test:unit",
  "npm run contracts:test:fuzz",
  "npm run contracts:test:invariant",
  "npm run contracts:coverage",
  "npm run contracts:artifacts:check",
  "python -m pip install slither-analyzer==0.11.5",
  'test "$(slither --version)" = "0.11.5"',
  "npm run contracts:slither",
];

const expectedWebJob = `  test:
    runs-on: ubuntu-latest
    env:
      JWT_SECRET: ci-secret-ci-secret-ci-secret-ci-secret
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: 00000000000000000000000000000000
      NEXT_PUBLIC_ARC_CHAIN_ID: '9999'
      NEXT_PUBLIC_ARC_RPC_URL: https://example.com/rpc
      NEXT_PUBLIC_ARC_EXPLORER_URL: https://example.com/explorer
      DATABASE_URL: postgres://stub
      KV_REST_API_URL: https://example.com
      KV_REST_API_TOKEN: stub
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10.14.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test --run
      - run: pnpm build`;

function extractJob(workflow, jobName) {
  const marker = new RegExp(`^  ${jobName}:\\n`, "m");
  const match = marker.exec(workflow);
  assert.ok(match, `workflow 缺少 active ${jobName} job`);
  const start = match.index;
  const markerLength = match[0].length;

  const remaining = workflow.slice(start + markerLength);
  const nextJobOffset = remaining.search(/^  [a-zA-Z0-9_-]+:\n/m);
  const end = nextJobOffset === -1 ? workflow.length : start + markerLength + nextJobOffset;
  return workflow.slice(start, end).trimEnd();
}

function extractTopLevelBlock(workflow, key) {
  const marker = new RegExp(`^${key}:\\n`, "m");
  const match = marker.exec(workflow);
  requireCondition(Boolean(match), `workflow 缺少 active 顶层 ${key}`);
  const start = match.index;
  const markerLength = match[0].length;
  const remaining = workflow.slice(start + markerLength);
  const nextBlockOffset = remaining.search(/^[a-zA-Z0-9_-]+:\s*(?:\n|$)/m);
  const end = nextBlockOffset === -1 ? workflow.length : start + markerLength + nextBlockOffset;
  return workflow.slice(start, end).trimEnd();
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stripInlineComment(line) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (
      character === "#" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      (index === 0 || /\s/.test(line[index - 1]))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function activeYamlLines(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map(stripInlineComment)
    .filter((line) => line.trim().length > 0);
}

function parseActiveSteps(job) {
  const steps = [];
  let currentStep;
  let multilineRun;

  function addEntry(step, source) {
    const entry = source.match(/^([a-zA-Z0-9_-]+):(?:\s*(.*))?$/);
    if (!entry) {
      return;
    }
    const value = entry[2] ?? "";
    step.entries.push({ key: entry[1], value });
    multilineRun = entry[1] === "run" && ["|", ">"].includes(value) ? step.entries.at(-1) : undefined;
  }

  for (const rawLine of job.split("\n").slice(1)) {
    if (/^\s*#/.test(rawLine) || rawLine.trim().length === 0) {
      continue;
    }
    const line = stripInlineComment(rawLine);
    if (line.trim().length === 0) {
      continue;
    }

    const stepStart = line.match(/^ {6}-\s+(.+)$/);
    if (stepStart) {
      currentStep = { entries: [], rawLines: [line] };
      steps.push(currentStep);
      addEntry(currentStep, stepStart[1]);
      continue;
    }

    if (currentStep && multilineRun && /^ {10,}\S/.test(line)) {
      currentStep.rawLines.push(line);
      multilineRun.value += `\n${line.trim()}`;
      continue;
    }

    const stepProperty = line.match(/^ {8}([a-zA-Z0-9_-]+:.*)$/);
    if (currentStep && stepProperty) {
      currentStep.rawLines.push(line);
      addEntry(currentStep, stepProperty[1]);
      continue;
    }

    if (/^ {4}\S/.test(line)) {
      currentStep = undefined;
      multilineRun = undefined;
    }
  }
  return steps;
}

function stepValues(steps, key) {
  return steps.flatMap((step) =>
    step.entries.filter((entry) => entry.key === key).map((entry) => entry.value),
  );
}

function requireOrderedUnique(actual, required, label) {
  let previousIndex = -1;
  for (const expected of required) {
    const indexes = actual.flatMap((value, index) => (value === expected ? [index] : []));
    requireCondition(
      indexes.length === 1,
      `${label} 必须恰好包含一个唯一 active step：${expected}`,
    );
    requireCondition(indexes[0] > previousIndex, `${label} 顺序错误：${expected}`);
    previousIndex = indexes[0];
  }
}

function isStaticallyFalse(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").toLowerCase();
  return ["false", "0", "${{ false }}", "${{false}}"].includes(normalized);
}

function validateContractsWorkflow(workflow) {
  requireCondition(
    activeYamlLines(extractTopLevelBlock(workflow, "permissions")).join("\n") ===
      "permissions:\n  contents: read",
    "workflow 必须声明最小权限 permissions.contents=read",
  );

  const job = extractJob(workflow, "contracts");
  const activeJob = activeYamlLines(job).join("\n");
  const steps = parseActiveSteps(job);
  requireCondition(steps.length > 0, "contracts job 缺少 active steps");

  const staticIfValues = activeJob
    .split("\n")
    .flatMap((line) => line.match(/^\s+(?:-\s+)?if:\s*(.+)$/)?.[1] ?? []);
  requireCondition(
    !staticIfValues.some(isStaticallyFalse),
    "contracts job/step 不得被 if:false 静态禁用",
  );
  requireCondition(
    !/^\s+(?:-\s+)?continue-on-error:\s*(?:true|['"]true['"]|\$\{\{\s*true\s*\}\})\s*$/im.test(activeJob),
    "contracts job/step 不得 continue-on-error:true",
  );
  requireCondition(
    !/^\s+(?:-\s+)?env:\s*(?:$|\{)/im.test(activeJob),
    "contracts job/step 不得声明 env",
  );
  requireCondition(!/\$\{\{\s*secrets\./i.test(activeJob), "contracts job 不得读取 GitHub secrets");
  requireCondition(
    !/(?:RPC|PRIVATE_KEY|MNEMONIC|WALLET|SECRET|DEPLOY)/i.test(activeJob),
    "contracts job 不得包含链上、钱包或机密配置",
  );
  requireCondition(
    !/actions\/upload-artifact|\bforge\s+script\b|--broadcast\b/i.test(activeJob),
    "contracts job 不得发布 artifact 或执行链上脚本",
  );

  const uses = stepValues(steps, "uses");
  const runs = stepValues(steps, "run");
  for (const command of runs) {
    requireCondition(
      !/\|\|\s*true(?:\s|$)|(?:^|[;\n])\s*set\s+\+e\b|;\s*true(?:\s|$)/m.test(command),
      `run step 不得吞错：${command}`,
    );
  }
  requireOrderedUnique(uses, requiredUses, "uses steps");
  requireOrderedUnique(runs, requiredRunCommands, "run steps");

  const foundryUse = uses.find((value) => value.startsWith("foundry-rs/foundry-toolchain@"));
  const pinnedSha = foundryUse?.split("@")[1];
  requireCondition(/^[a-f0-9]{40}$/.test(pinnedSha ?? ""), "Foundry action 必须固定完整40位 commit SHA");
  requireCondition(pinnedSha === foundryActionSha, "Foundry action SHA 与官方 v1 核验结果不一致");
  requireCondition(
    new RegExp(`^ {6}- uses: foundry-rs/foundry-toolchain@${foundryActionSha}\\s+# v1$`, "m").test(job),
    "Foundry action pin 必须保留 # v1 注释",
  );

  const foundryStep = steps.find((step) =>
    step.entries.some((entry) => entry.key === "uses" && entry.value === foundryUse),
  );
  requireCondition(
    foundryStep?.rawLines.some((line) => /with:\s*\{\s*version:\s*v1\.5\.1\s*\}/.test(line)),
    "Foundry action 必须输入 version v1.5.1",
  );
  const nodeStep = steps.find((step) =>
    step.entries.some((entry) => entry.key === "uses" && entry.value === "actions/setup-node@v4"),
  );
  requireCondition(
    nodeStep?.rawLines.some((line) => /with:\s*\{\s*node-version:\s*20\s*\}/.test(line)),
    "contracts job 必须使用 Node 20",
  );
  const pythonStep = steps.find((step) =>
    step.entries.some((entry) => entry.key === "uses" && entry.value === "actions/setup-python@v5"),
  );
  requireCondition(
    pythonStep?.rawLines.some((line) => /with:\s*\{\s*python-version:\s*['"]3\.12['"]\s*\}/.test(line)),
    "contracts job 必须使用 Python 3.12",
  );

  return { job, runs, steps, uses };
}

function replaceOnce(source, search, replacement) {
  requireCondition(source.includes(search), `mutation 找不到目标：${search}`);
  return source.replace(search, replacement);
}

test("保留既有 Next.js scripts 并精确增加九个合约命令", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  for (const [name, command] of Object.entries(existingScripts)) {
    assert.equal(packageJson.scripts[name], command, `${name} 的既有语义发生变化`);
  }
  for (const [name, command] of Object.entries(contractScripts)) {
    assert.equal(packageJson.scripts[name], command, `${name} 未按固定命令配置`);
  }
  assert.deepEqual(
    Object.keys(packageJson.scripts).sort(),
    [...Object.keys(existingScripts), ...Object.keys(contractScripts)].sort(),
    "根工程 scripts 只能包含既有 Web/DB 命令和新增九项合约命令",
  );
});

test("Slither npm 命令固定使用失败关闭包装器", () => {
  assert.equal(SLITHER_VERSION, "0.11.5");
  assert.deepEqual(FORGE_CLEAN_ARGS, ["clean", "--root", "contracts"]);
  assert.deepEqual(FORGE_BUILD_ARGS, ["build", "--root", "contracts", "--force"]);
  assert.deepEqual(SLITHER_ARGS, [
    "contracts",
    "--foundry-compile-all",
    "--exclude-dependencies",
    "--filter-paths",
    "contracts/(lib|test|script)/",
    "--fail-medium",
  ]);
  assert.equal(typeof runSlither, "function");
});

test("既有 Web test job 保持逐字不变", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.equal(extractJob(workflow, "test"), expectedWebJob);
});

test("Vitest 保留默认排除并隔离 Foundry 可重建目录", async () => {
  const source = await readFile(vitestConfigPath, "utf8");

  assert.match(source, /import\s+\{\s*configDefaults,\s*defineConfig\s*\}\s+from\s+['"]vitest\/config['"]/);
  assert.match(source, /exclude:\s*\[[\s\S]*\.\.\.configDefaults\.exclude/);
  for (const path of [
    "contracts/lib/**",
    "contracts/out/**",
    "contracts/cache/**",
    "contracts/broadcast/**",
  ]) {
    assert.match(source, new RegExp(`["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  }
});

test("contracts job 固定工具链、依赖和全部本地门禁", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
});

test("contracts job 的注释命令不能满足 active gate", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "      - run: npm run contracts:fmt",
    "      # - run: npm run contracts:fmt",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /唯一 active step：npm run contracts:fmt/);
});

test("contracts job 拒绝 if:false 静态禁用", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "  contracts:\n    runs-on: ubuntu-latest",
    "  contracts:\n    if: false\n    runs-on: ubuntu-latest",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /if:false 静态禁用/);
});

test("contracts job 拒绝 continue-on-error:true", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "      - run: npm run contracts:fmt",
    "      - run: npm run contracts:fmt\n        continue-on-error: true",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /continue-on-error:true/);
});

test("contracts job 拒绝 || true 吞错", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "      - run: npm run contracts:fmt",
    "      - run: npm run contracts:fmt || true",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /run step 不得吞错/);
});

test("contracts job 拒绝 set +e 吞错", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "      - run: npm run contracts:fmt",
    "      - run: |\n          set +e\n          npm run contracts:fmt",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /run step 不得吞错/);
});

test("contracts job 拒绝分号 true 吞错", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "      - run: npm run contracts:fmt",
    "      - run: npm run contracts:fmt; true",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /run step 不得吞错/);
});

test("contracts job 拒绝 job 或 step env", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "  contracts:\n    runs-on: ubuntu-latest",
    "  contracts:\n    env: {}\n    runs-on: ubuntu-latest",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /不得声明 env/);
});

test("workflow 拒绝扩大顶层 permissions", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  validateContractsWorkflow(workflow);
  const mutated = replaceOnce(
    workflow,
    "permissions:\n  contents: read",
    "permissions:\n  contents: read\n  actions: write",
  );
  assert.throws(() => validateContractsWorkflow(mutated), /最小权限/);
});
