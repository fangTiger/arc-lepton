import { fileURLToPath } from "node:url";

import {
  readCliStdin,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

const EXACT_CANDIDATE_PATHS = new Set([
  ".github/workflows/test.yml",
  "README.md",
  "package.json",
  "vitest.config.ts",
  "drizzle.config.ts",
  "drizzle.config.test.ts",
]);

const CANDIDATE_PREFIXES = [
  "app/",
  "components/",
  "contracts/src/",
  "contracts/script/",
  "contracts/scripts/",
  "contracts/test/",
  "docs/contracts/",
  "docs/plans/",
  "graphify-out/",
  "lib/",
  "openspec/changes/onchain-research-escrow/",
  "openspec/specs/",
  "scripts/",
];

const EXCLUDED_PREFIX_REASONS = [
  [".devos/", "local-workflow"],
  ["cache/invariant/failures/", "invariant-failure-cache"],
  ["contracts/out/", "foundry-output"],
  ["contracts/cache/", "foundry-cache"],
  ["contracts/lib/", "vendored-dependency"],
  ["contracts/broadcast/", "broadcast-artifact"],
];

const SAFETY = Object.freeze({
  noAutoStage: true,
  noAutoCommit: true,
  noSecrets: true,
  notAuthorizationRecord: true,
  notCleanCommitProof: true,
  notPreflightProof: true,
  notDeploymentPermission: true,
});

export class PredeployCommitScopeError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "PredeployCommitScopeError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path, message) {
  throw new PredeployCommitScopeError(code, path, message);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseStatusLine(line, lineNumber) {
  if (line.trim() === "") {
    return null;
  }
  if (line.length < 4) {
    fail("STATUS_LINE_INVALID", `line:${lineNumber}`, "状态行过短");
  }

  const indexStatus = line[0];
  const worktreeStatus = line[1];
  const rawPath = line.slice(3).trim();
  if (rawPath === "") {
    fail("STATUS_PATH_MISSING", `line:${lineNumber}`, "状态行缺少路径");
  }

  let path = rawPath;
  let originalPath = null;
  const renameSeparator = " -> ";
  if (rawPath.includes(renameSeparator)) {
    const [from, to] = rawPath.split(renameSeparator);
    originalPath = normalizePath(from.trim());
    path = to.trim();
  }

  const normalizedPath = normalizePath(path);
  const untracked = indexStatus === "?" && worktreeStatus === "?";
  const ignored = indexStatus === "!" && worktreeStatus === "!";
  const staged = !untracked && !ignored && indexStatus !== " ";
  const unstaged = !untracked && !ignored && worktreeStatus !== " ";
  const deleted = indexStatus === "D" || worktreeStatus === "D";

  return {
    raw: line,
    indexStatus,
    worktreeStatus,
    status: `${indexStatus}${worktreeStatus}`,
    path: normalizedPath,
    ...(originalPath === null ? {} : { originalPath }),
    staged,
    unstaged,
    untracked,
    ignored,
    deleted,
  };
}

function exclusionReason(path) {
  if (path === ".env" || path.startsWith(".env")) {
    return "secret-env";
  }
  for (const [prefix, reason] of EXCLUDED_PREFIX_REASONS) {
    if (path.startsWith(prefix)) {
      return reason;
    }
  }
  return null;
}

function isCandidatePath(path) {
  return EXACT_CANDIDATE_PATHS.has(path)
    || CANDIDATE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function classifyEntry(entry) {
  const reason = exclusionReason(entry.path);
  if (reason !== null) {
    return {
      ...entry,
      classification: "excluded",
      reason,
    };
  }
  if (entry.deleted) {
    return {
      ...entry,
      classification: "unknown",
      reason: "deleted-requires-root-review",
    };
  }
  if (isCandidatePath(entry.path)) {
    return {
      ...entry,
      classification: "candidate",
      reason: "allowed-predeploy-scope",
    };
  }
  return {
    ...entry,
    classification: "unknown",
    reason: "requires-root-review",
  };
}

function count(entries, predicate) {
  return entries.filter(predicate).length;
}

export function buildPredeployCommitScopeReport(statusText) {
  if (typeof statusText !== "string") {
    fail("STATUS_TEXT_INVALID", "statusText", "statusText 必须是字符串");
  }

  const entries = statusText
    .split(/\r?\n/)
    .map((line, index) => parseStatusLine(line, index + 1))
    .filter((entry) => entry !== null)
    .map(classifyEntry);

  return {
    schemaVersion: 1,
    purpose: "onchain-research-escrow-predeploy-commit-scope",
    safety: { ...SAFETY },
    entries,
    candidates: entries.filter((entry) => entry.classification === "candidate"),
    excluded: entries.filter((entry) => entry.classification === "excluded"),
    unknown: entries.filter((entry) => entry.classification === "unknown"),
    summary: {
      total: entries.length,
      candidateCount: count(entries, (entry) => entry.classification === "candidate"),
      excludedCount: count(entries, (entry) => entry.classification === "excluded"),
      unknownCount: count(entries, (entry) => entry.classification === "unknown"),
      stagedCount: count(entries, (entry) => entry.staged),
      unstagedCount: count(entries, (entry) => entry.unstaged),
      untrackedCount: count(entries, (entry) => entry.untracked),
      deletedCount: count(entries, (entry) => entry.deleted),
    },
  };
}

export async function runCli(argv = process.argv, streams = process, inputText = undefined) {
  try {
    const stdout = readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail);
    const stdin = readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail);
    const statusText = typeof inputText === "string"
      ? inputText
      : await readCliStdin(stdin, fail);
    const report = buildPredeployCommitScopeReport(statusText);
    writeCliStream(stdout, `${JSON.stringify(report, null, 2)}\n`, "streams.stdout", fail);
    return 0;
  } catch (error) {
    const stderr = readCliStreamWrapperProperty(streams, "stderr", process.stderr, fail);
    if (error instanceof PredeployCommitScopeError) {
      writeCliStream(stderr, `${error.code} ${error.path}\n`, "streams.stderr", fail);
      return 1;
    }
    writeCliStream(stderr, "PREDEPLOY_COMMIT_SCOPE_FAILED input\n", "streams.stderr", fail);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
