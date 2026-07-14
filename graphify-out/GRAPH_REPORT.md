# Graph Report - arc-lepton  (2026-07-14)

## Corpus Check
- 165 files · ~1,060,586 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1307 nodes · 2753 edges · 47 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 159 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 53|Community 53]]

## God Nodes (most connected - your core abstractions)
1. `fail()` - 29 edges
2. `fail()` - 29 edges
3. `fail()` - 28 edges
4. `fail()` - 25 edges
5. `buildDeploymentManifest()` - 24 edges
6. `POST()` - 22 edges
7. `call()` - 22 edges
8. `requireRecord()` - 21 edges
9. `fail()` - 20 edges
10. `verifyArcSmokeEvidence()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --calls--> `count()`  [INFERRED]
  app/api/stats/global/route.ts → contracts/scripts/predeploy-commit-scope.mjs
- `POST()` --calls--> `get()`  [INFERRED]
  app/api/auth/logout/route.ts → contracts/scripts/reproducible-artifact-gate.node-test.mjs
- `POST()` --calls--> `fail()`  [INFERRED]
  app/api/auth/logout/route.ts → contracts/scripts/deployment-authorization-gate.mjs
- `POST()` --calls--> `fail()`  [INFERRED]
  app/api/auth/logout/route.ts → contracts/scripts/validate-deployment-config.mjs
- `POST()` --calls--> `get()`  [INFERRED]
  app/api/auth/logout/route.ts → contracts/scripts/validate-deployment-config.node-test.mjs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (50): authedRequest(), request(), callContract(), decodeAddressFromStorage(), decodeCallResult(), decodeMinimalProxyImplementation(), decodeUint256(), ensureRoleGrantEvent() (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (43): hasOwn(), isRecord(), CustomStreams, write(), readCliStdin(), readCliStreamMethod(), readCliStreamWrapperProperty(), writeCliStream() (+35 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (27): activationMatchesResearch(), cancelDigest(), digestJson(), digestString(), epochSeconds(), followUpConflict(), GET(), hasEscrowEvidence() (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (52): assertCoreCreators(), assertCoreWiring(), buildDeploymentManifest(), cloneCountsFor(), compareProvidedAddresses(), compareProvidedCloneCounts(), compareProvidedDeploymentTopology(), compareTopologyValue() (+44 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (41): assertNoAddressOverlap(), assertUrlHasNoCredentials(), buildDeploymentPreflightReport(), buildDeploymentPreflightReportCore(), cloneSafeJsonLike(), credentialKeyFound(), DeploymentPreflightGateError, fail() (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (29): cancelFundedEscrow(), EscrowValueLink(), followUpStatusTone(), load(), lower(), shortValue(), submitFollowUp(), activationAuthorizationFor() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (37): artifactHashes(), core(), deployment(), evidencePackage(), manifest(), arrayIndexPath(), assertPublicDataDescriptor(), assertRoleSeparation() (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (30): artifactHashes(), core(), deployment(), DeploymentArtifact, manifest(), validPackageInput(), artifactHashes(), coreContract() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (36): buildAuthorizationBriefing(), buildAuthorizationBriefings(), bulletList(), commonLines(), configureLines(), deployCoreLines(), DeploymentAuthorizationBriefingError, exactAuthorizationReplyLines() (+28 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (36): addBlocker(), afterAuthorizationPreflightChecklist(), allowsPublicBytes32Value(), assertJsonSafe(), beforeAuthorizationChecklist(), buildDeploymentNextActionChecklist(), checklistItem(), DeploymentNextActionChecklistError (+28 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (39): buildAuthorizationRequests(), cloneStable(), DeploymentAuthorizationGateError, digestAuthorizationRequest(), fail(), inputInvalid(), isArrayIndexKey(), isPlainJsonRecord() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (35): addMissing(), assertJsonSafe(), assertKnownKeys(), assertKnownStageKeys(), assertKnownTopLevelKeys(), assertSafeKey(), buildDeploymentWritePlanFreeze(), DeploymentWritePlanFreezeError (+27 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (36): artifactHashes(), balanceDelta(), baselineRoleLogEntries(), baselineTopologyCalls(), callData(), callEntry(), callKey(), cloneEvidence() (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (36): allowsPublicBytes32Value(), assertExactKeys(), assertJsonSafe(), buildConfigureRequest(), buildDeploymentAuthorizationRequestDrafts(), buildDeployRequest(), buildSmokeRequest(), commonRequest() (+28 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (29): addMissing(), allowsPublicBytes32Value(), assertJsonSafe(), assertKnownTopLevelKeys(), assertSafeKey(), buildSourceRoleReadinessReport(), evaluateCoreContracts(), evaluateEvidence() (+21 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (29): addReason(), arrayOrEmpty(), booleanValue(), buildPredeployStoplightReport(), explicitAuthorizationMatches(), fail(), inputInvalid(), integerOrZero() (+21 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (28): call(), allowsPublicBytes32Value(), assertJsonSafe(), buildDeploymentAuthorizationInputGapReport(), containsPlaceholderString(), DeploymentAuthorizationInputGapError, errorPayload(), evaluateStage() (+20 more)

### Community 17 - "Community 17"
Cohesion: 0.27
Nodes (31): expectAddress(), expectEqual(), fail(), normalizeAddress(), normalizeBalanceDelta(), normalizeTransfer(), rejectSymbols(), requireAddress() (+23 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (24): addMissing(), assertJsonSafe(), assertKnownTopLevelKeys(), assertSafeKey(), buildFinalEvidencePublicationGate(), evaluateCoreContracts(), evaluateCounts(), evaluateDocuments() (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (16): assert(), executeRoleChange(), executeSourceChange(), getSource(), hasRole(), normalizeAddress(), roleCount(), roleHash() (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (22): assertEqual(), assertExactKeys(), assertJsonArrayEqual(), assertPlainObject(), listBuildInfoFiles(), main(), createFixture(), validBuildInfo() (+14 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (21): assertStageOrder(), buildDeploymentAuthorizationPackage(), DeploymentAuthorizationPackageError, fail(), inputInvalid(), isArrayIndexKey(), isPlainJsonRecord(), isRecord() (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (6): buildDeployerNonceAfterCoreCheck(), deriveExpectedAfterCoreNonce(), hasArcNativeUsdcStackUnderflow(), isBlockedByAnvilArcNativeUsdcPrecompile(), normalizeAddressLike(), toSafeNonce()

### Community 23 - "Community 23"
Cohesion: 0.17
Nodes (21): commandFailure(), containsCompilationFailure(), defaultExecuteCommand(), defaultListBuildInfoFiles(), main(), parseAnalysisSummary(), readSlitherOption(), requireSlitherOptionsDescriptors() (+13 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (16): ArtifactPublicationGateError, callCallback(), callRebuildCallback(), gateError(), hasCleanSubmoduleStatus(), hasOwn(), inspectExactDataRecord(), inspectRootRecord() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (9): argumentRecord(), artifactHashes(), coreContract(), deploymentFromReceipt(), fileHash(), getCodeAtFinalized(), jsonHash(), normalizeCode() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (16): hasOwn(), decimalDifference(), fail(), findPropertyDescriptor(), firstNonZeroClone(), LocalSmokeEvidenceRunnerError, normalizeAddress(), optionalHarnessDataValue() (+8 more)

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (11): artifactHashes(), changedRequests(), core(), deployment(), evidence(), EvidencePackage, expectBuildGateError(), expectGateError() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.15
Nodes (9): argsText(), eventLine(), utcTime(), extractPreview(), mergeTxLogIntoEvents(), reconciledTxLogPaymentFacts(), txLogDataPreview(), txLogRequestId() (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (1): load()

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (3): hasFactoryRole(), hasRegistryRole(), roleSummary()

### Community 31 - "Community 31"
Cohesion: 0.2
Nodes (2): handleSignIn(), signatureErrorMessage()

### Community 32 - "Community 32"
Cohesion: 0.31
Nodes (6): countListedTests(), isPlainObject(), main(), profileEnvironment(), runForgeTestProfile(), writeResultOutput()

### Community 33 - "Community 33"
Cohesion: 0.31
Nodes (5): assertAddress(), decodeRevert(), extractRevertData(), requireEnv(), summarizeError()

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (4): AuthGate(), useSiweLogin(), useInvalidateSession(), useUser()

### Community 35 - "Community 35"
Cohesion: 0.38
Nodes (4): base64url(), hold(), shot(), signSession()

### Community 36 - "Community 36"
Cohesion: 0.52
Nodes (5): addr(), getSource(), hasRole(), roleCount(), roleHash()

### Community 38 - "Community 38"
Cohesion: 0.7
Nodes (4): computeCanonicalVectorHashes(), hashAbi(), textHash(), verifyCanonicalVectors()

### Community 39 - "Community 39"
Cohesion: 0.7
Nodes (4): expectedAuthorization(), expectedHashes(), lookup(), verifyEip712Vectors()

### Community 40 - "Community 40"
Cohesion: 0.5
Nodes (2): createJournalTableSql(), runDbMigrations()

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (1): workerRequest()

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (2): safeReceipt(), send()

### Community 45 - "Community 45"
Cohesion: 0.83
Nodes (3): assertEqual(), assertThrows(), verifyAmountConversionVectors()

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (2): formatBlock(), TopBar()

### Community 47 - "Community 47"
Cohesion: 0.5
Nodes (1): MockEventSource

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (2): BudgetMeter(), decimal()

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): chainLabel(), NetworkGuard()

## Knowledge Gaps
- **5 isolated node(s):** `CustomStreams`, `CustomRecord`, `CustomEvidence`, `DeploymentArtifact`, `CustomRecord`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 29`** (13 nodes): `page.tsx`, `page.tsx`, `DataCell()`, `FieldRow()`, `formatBalance()`, `load()`, `quotaConsumed()`, `quotaReserved()`, `quotaStateLabel()`, `shortAddress()`, `statusLabel()`, `statusTone()`, `toWagmiAddress()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (11 nodes): `ConnectWalletButton.tsx`, `closeOnEscape()`, `closeOnOutsideClick()`, `formatBalance()`, `handleSignIn()`, `menuAddress()`, `shortAddress()`, `signatureErrorMessage()`, `toggleAccountMenu()`, `toWagmiAddress()`, `warmAuthNonce()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (5 nodes): `createJournalTableSql()`, `plannedStatements()`, `runDbMigrations()`, `syncVercelPostgresEnv()`, `db-migrate.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `route.test.ts`, `route.test.ts`, `workerRequest()`, `workflowOperation()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (4 nodes): `debug-smoke-forced-local-tx.mjs`, `domain()`, `safeReceipt()`, `send()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (4 nodes): `TopBar.tsx`, `formatBlock()`, `formatUtcTime()`, `TopBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (4 nodes): `MockEventSource`, `.constructor()`, `.reset()`, `AgentLogStream.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `bar()`, `BudgetMeter()`, `decimal()`, `BudgetMeter.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (3 nodes): `NetworkGuard.tsx`, `chainLabel()`, `NetworkGuard()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `call()` connect `Community 16` to `Community 1`, `Community 3`, `Community 4`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 15`, `Community 18`, `Community 21`, `Community 24`, `Community 26`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `hasOwn()` connect `Community 1` to `Community 0`, `Community 7`, `Community 16`, `Community 17`, `Community 20`, `Community 23`, `Community 26`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `hasOwn()` connect `Community 26` to `Community 0`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 16`, `Community 17`, `Community 20`, `Community 23`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `buildDeploymentManifest()` (e.g. with `manifest()` and `manifest()`) actually correct?**
  _`buildDeploymentManifest()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CustomStreams`, `CustomRecord`, `CustomEvidence` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._