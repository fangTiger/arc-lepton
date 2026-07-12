import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildDeploymentNextActionChecklist,
  runCli,
} from "./deployment-next-action-checklist.mjs";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const SOURCE_PATH = resolve(ROOT, "contracts/scripts/deployment-next-action-checklist.mjs");
const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);

async function withJsonFixture(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "arc-next-action-checklist-"));
  const file = join(dir, "input.json");
  try {
    await writeFile(file, JSON.stringify(content, null, 2));
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deployRequest(overrides = {}) {
  return {
    request: {
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      deployer: "0x1000000000000000000000000000000000000001",
      expectedAddresses: {
        registry: "0x2000000000000000000000000000000000000001",
        implementation: "0x2000000000000000000000000000000000000002",
        factory: "0x2000000000000000000000000000000000000003",
      },
      transactions: [
        { action: "deploy DataSourceRegistry" },
        { action: "deploy ResearchEscrow implementation" },
        { action: "deploy ResearchEscrowFactory" },
      ],
      estimatedGas: "9000000",
      maxUsdcUnits: "0",
    },
    explicitAuthorization: null,
    ambiguousApproval: "",
    authorizationPackageDigest: `sha256:${"c".repeat(64)}`,
    cleanCommit: false,
    preflightProofDigest: null,
    ...overrides,
  };
}

function smokeRequest(overrides = {}) {
  return {
    request: {
      stage: "smoke_usdc_spend",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      buyer: "0x3000000000000000000000000000000000000001",
      payout: "0x3000000000000000000000000000000000000002",
      factory: "0x2000000000000000000000000000000000000003",
      usdc: {
        address: "0x3600000000000000000000000000000000000000",
        chainId: 5042002,
        decimals: 6,
      },
      transactions: [
        { action: "approve" },
        { action: "createAndFund" },
        { action: "settleBatch" },
        { action: "close" },
      ],
      estimatedGas: "12000000",
      maxUsdcUnits: "1000000",
    },
    explicitAuthorization: null,
    ambiguousApproval: "",
    authorizationPackageDigest: "",
    cleanCommit: false,
    preflightProofDigest: null,
    ...overrides,
  };
}

function configureRequest(overrides = {}) {
  return {
    request: {
      stage: "configure_sources_and_roles",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      targetAddresses: [
        "0x2000000000000000000000000000000000000001",
        "0x2000000000000000000000000000000000000003",
      ],
      sourceConfigurationChanges: [
        {
          target: "0x2000000000000000000000000000000000000001",
          function: "setSource",
          args: {
            sourceId: `0x${"4".repeat(64)}`,
            payout: "0x3000000000000000000000000000000000000002",
            maxUnitPrice: "1000",
            active: true,
          },
        },
      ],
      roleChanges: [
        {
          target: "0x2000000000000000000000000000000000000003",
          action: "grant",
          role: "SETTLER_ROLE",
          account: "0x3000000000000000000000000000000000000003",
        },
      ],
      transactions: [
        { action: "bindFactory" },
        { action: "setSource" },
        { action: "grantRole" },
      ],
      estimatedGas: "11000000",
      maxUsdcUnits: "0",
    },
    explicitAuthorization: null,
    ambiguousApproval: "",
    authorizationPackageDigest: "",
    cleanCommit: false,
    preflightProofDigest: null,
    ...overrides,
  };
}

function expectedExactAuthorizationReply(request) {
  return `我明确授权 stage=${request.stage} chainId=${request.chainId} commit=${request.commit} requestDigest=${request.requestDigest} estimatedGas=${request.estimatedGas} maxUsdcUnits=${request.maxUsdcUnits}`;
}

function expectSanitizedChecklistError(input, expectation) {
  assert.throws(
    () => buildDeploymentNextActionChecklist(input),
    (error) => {
      assert.equal(error.code, expectation.code);
      assert.equal(error.path, expectation.path);
      assert.equal(
        error.message.includes(expectation.secret),
        false,
        "error message must not echo the secret-shaped value",
      );
      return true;
    },
  );
}

test("missing explicit authorization requests user authorization and never allows broadcast", () => {
  const report = buildDeploymentNextActionChecklist(deployRequest());

  assert.equal(report.stage, "deploy_core_contracts");
  assert.equal(report.nextAction, "request_explicit_authorization");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
  assert.equal(report.safety.noBroadcast, true);
  assert.equal(report.safety.notAuthorizationRecord, true);
  assert.equal(report.safety.stageAuthorizationReuseForbidden, true);
  assert.ok(report.blockers.some((blocker) => blocker.code === "EXPLICIT_AUTHORIZATION_MISSING"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "AUTHORIZATION_PACKAGE_NOT_APPROVAL"));
  assert.ok(report.requiredBeforeAuthorization.every((item) => item.required === true));
  assert.ok(
    report.requiredBeforeAuthorization.some((item) =>
      item.key === "requestDigest" && item.present === true
    ),
  );
});

test("all stages expose an exact authorization reply without satisfying explicit authorization", () => {
  for (const makeRequest of [deployRequest, configureRequest, smokeRequest]) {
    const base = makeRequest();
    const displayOnlyReply = expectedExactAuthorizationReply(base.request);
    const report = buildDeploymentNextActionChecklist({
      ...base,
      exactAuthorizationReply: displayOnlyReply,
      authorizationText: displayOnlyReply,
    });

    assert.equal(report.exactAuthorizationReply, displayOnlyReply);
    assert.equal(report.authorization.status, "missing_explicit_authorization");
    assert.equal(report.authorization.explicitAuthorizationMatched, false);
    assert.equal(report.nextAction, "request_explicit_authorization");
    assert.equal(report.broadcastAllowed, false);
    assert.equal(report.deployAllowed, false);
    assert.equal(report.goalCompleteAllowed, false);
    assert.equal(report.safety.notAuthorizationRecord, true);
    assert.ok(
      report.requiredBeforeAuthorization.some((item) =>
        item.key === "exactAuthorizationReply" && item.present === true
      ),
      `${base.request.stage} must include exactAuthorizationReply before authorization`,
    );
    assert.ok(report.blockers.some((blocker) => blocker.code === "EXPLICIT_AUTHORIZATION_MISSING"));
  }
});

test("matching explicit authorization only advances to authorized preflight and still cannot broadcast", () => {
  const report = buildDeploymentNextActionChecklist(deployRequest({
    explicitAuthorization: {
      approved: true,
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      approvedAt: "2026-07-11T01:00:00Z",
    },
    authorizationPackageDigest: "",
  }));

  assert.equal(report.authorization.status, "explicit_authorization_matched");
  assert.equal(report.nextAction, "run_authorized_preflight");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
  assert.ok(!report.blockers.some((blocker) => blocker.code === "EXPLICIT_AUTHORIZATION_MISSING"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "CLEAN_COMMIT_MISSING"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "PREFLIGHT_PROOF_MISSING"));
});

test("ambiguous approval and authorization package digest are not accepted as approval", () => {
  const report = buildDeploymentNextActionChecklist(deployRequest({
    ambiguousApproval: "可以继续",
    authorizationPackageDigest: `sha256:${"d".repeat(64)}`,
  }));

  assert.equal(report.authorization.status, "missing_explicit_authorization");
  assert.equal(report.authorization.authorizationPackageIsApproval, false);
  assert.equal(report.authorization.ambiguousApprovalAccepted, false);
  assert.equal(report.nextAction, "request_explicit_authorization");
  assert.ok(report.blockers.some((blocker) => blocker.code === "AMBIGUOUS_APPROVAL"));
  assert.ok(report.blockers.some((blocker) => blocker.code === "AUTHORIZATION_PACKAGE_NOT_APPROVAL"));
});

test("authorized and preflighted input remains non-broadcast and asks for the next stage boundary", () => {
  const report = buildDeploymentNextActionChecklist(deployRequest({
    explicitAuthorization: {
      approved: true,
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      approvedAt: "2026-07-11T01:00:00Z",
    },
    authorizationPackageDigest: "",
    cleanCommit: true,
    preflightProofDigest: `sha256:${"e".repeat(64)}`,
    preflightConfirmations: {
      cleanGitCommit: true,
      compilerSettings: true,
      deployerBalance: true,
      factoryRegistrySafe: true,
      sourcePayout: true,
      fundingSigner: true,
      intentSignerEoa: true,
      settler: true,
      officialUsdc: true,
      publicRpcFinalizedBlock: true,
      secretHygiene: true,
    },
  }));

  assert.equal(report.nextAction, "prepare_13_3_broadcast_request");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
  assert.equal(report.safety.notPreflightProof, true);
  assert.ok(report.blockers.some((blocker) => blocker.code === "BROADCAST_REQUIRES_STAGE_BOUNDARY"));
  assert.ok(report.requiredAfterAuthorizationPreflight.every((item) => item.present === true));
});

test("unused top-level secret-shaped keys fail closed without echoing values", () => {
  const secret = `sk-${"x".repeat(24)}`;

  expectSanitizedChecklistError(
    deployRequest({ privateKey: secret }),
    {
      code: "SECRET_SHAPED_INPUT",
      path: "input.privateKey",
      secret,
    },
  );
});

test("nested transaction secret-shaped values fail closed without echoing values", () => {
  const secret = `0x${"1".repeat(64)}`;
  const input = deployRequest();
  input.request.transactions[0] = {
    ...input.request.transactions[0],
    metadata: secret,
  };

  expectSanitizedChecklistError(
    input,
    {
      code: "SECRET_SHAPED_INPUT",
      path: "input.request.transactions[0].metadata",
      secret,
    },
  );
});

test("configure source public sourceId bytes32 is allowed only at the canonical args path", () => {
  const report = buildDeploymentNextActionChecklist(configureRequest());

  assert.equal(report.stage, "configure_sources_and_roles");
  assert.equal(report.nextAction, "request_explicit_authorization");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
  assert.ok(
    report.requiredBeforeAuthorization.some((item) =>
      item.key === "sourceConfigurationChanges" && item.present === true
    ),
  );
});

test("raw root configure request also allows public sourceId bytes32 at the canonical args path", () => {
  const report = buildDeploymentNextActionChecklist(configureRequest().request);

  assert.equal(report.stage, "configure_sources_and_roles");
  assert.equal(report.nextAction, "request_explicit_authorization");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.deployAllowed, false);
});

test("array extra sourceId bytes32 still fails closed without echoing values", () => {
  const secret = `0x${"5".repeat(64)}`;
  const input = configureRequest();
  Object.defineProperty(input.request.sourceConfigurationChanges, "sourceId", {
    enumerable: true,
    value: secret,
  });

  expectSanitizedChecklistError(
    input,
    {
      code: "SECRET_SHAPED_INPUT",
      path: "input.request.sourceConfigurationChanges.sourceId",
      secret,
    },
  );
});

test("array extra properties fail closed without executing accessors", () => {
  const input = deployRequest();
  let getterExecuted = false;
  Object.defineProperty(input.request.transactions, "privateKey", {
    enumerable: true,
    get() {
      getterExecuted = true;
      return `sk-${"y".repeat(24)}`;
    },
  });

  assert.throws(
    () => buildDeploymentNextActionChecklist(input),
    (error) => {
      assert.equal(error.code, "SECRET_SHAPED_INPUT");
      assert.equal(error.path, "input.request.transactions.privateKey");
      assert.equal(getterExecuted, false);
      return true;
    },
  );
});

test("null-prototype checklist input containers fail closed as non-plain objects", () => {
  assert.throws(
    () => buildDeploymentNextActionChecklist(Object.assign(Object.create(null), deployRequest())),
    (error) =>
      error.code === "INPUT_INVALID"
      && error.path === "input",
  );

  const input = deployRequest();
  input.request = Object.assign(Object.create(null), input.request);

  assert.throws(
    () => buildDeploymentNextActionChecklist(input),
    (error) =>
      error.code === "INPUT_INVALID"
      && error.path === "input.request",
  );
});

test("normal public deploy request still builds a local-only checklist", () => {
  const input = deployRequest({
    explicitAuthorization: {
      approved: true,
      stage: "deploy_core_contracts",
      chainId: 5042002,
      commit: COMMIT,
      requestDigest: DIGEST,
      approvedAt: "2026-07-11T01:00:00Z",
    },
    authorizationPackageDigest: "",
    cleanCommit: true,
    preflightProofDigest: `sha256:${"e".repeat(64)}`,
    preflightConfirmations: {
      cleanGitCommit: true,
      compilerSettings: true,
      deployerBalance: true,
      factoryRegistrySafe: true,
      sourcePayout: true,
      fundingSigner: true,
      intentSignerEoa: true,
      settler: true,
      officialUsdc: true,
      publicRpcFinalizedBlock: true,
      secretHygiene: true,
    },
  });

  const report = buildDeploymentNextActionChecklist(input);

  assert.equal(report.nextAction, "prepare_13_3_broadcast_request");
  assert.equal(report.broadcastAllowed, false);
  assert.equal(report.safety.noSecrets, true);
});

test("CLI rejects streams wrapper accessors without executing getters", async () => {
  await withJsonFixture(deployRequest(), async (file) => {
    let getterExecuted = false;
    let stderr = "";
    const streams = {
      stderr: { write: (chunk) => { stderr += chunk; } },
    };
    Object.defineProperty(streams, "stdout", {
      enumerable: true,
      get() {
        getterExecuted = true;
        throw new Error("super-secret-stream-getter");
      },
    });

    const code = await runCli(["node", "deployment-next-action-checklist.mjs", file], streams);

    assert.equal(code, 1);
    assert.equal(getterExecuted, false);
    assert.match(stderr, /STREAMS_INVALID/u);
    assert.doesNotMatch(stderr, /super-secret-stream-getter/u);
  });
});

test("non Arc Testnet chain fails closed", () => {
  assert.throws(
    () => buildDeploymentNextActionChecklist(deployRequest({
      request: {
        ...deployRequest().request,
        chainId: 1,
      },
    })),
    (error) => error.code === "CHAIN_ID_UNSUPPORTED" && error.path === "request.chainId",
  );
});

test("smoke USDC chain must also be Arc Testnet", () => {
  assert.throws(
    () => buildDeploymentNextActionChecklist(smokeRequest({
      request: {
        ...smokeRequest().request,
        usdc: {
          ...smokeRequest().request.usdc,
          chainId: 1,
        },
      },
    })),
    (error) => error.code === "CHAIN_ID_UNSUPPORTED" && error.path === "request.usdc.chainId",
  );
});

test("source stays local-only and avoids env, shell, git, network and broadcast primitives", async () => {
  const source = await readFile(SOURCE_PATH, "utf8");
  for (const pattern of [
    /process\.env/,
    /child_process/,
    /\bexec\(/,
    /\bspawn\(/,
    /\bfetch\(/,
    /https?:\/\//,
    /\.env\.local/,
    /git status/,
    /--broadcast/,
    /\bforge\b/,
  ]) {
    assert.doesNotMatch(source, pattern, `source must not contain ${pattern}`);
  }
});
