# Graph Report - arc-lepton  (2026-06-27)

## Corpus Check
- 73 files · ~47,483 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 189 nodes · 178 edges · 15 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 15|Community 15]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 12 edges
2. `POST()` - 10 edges
3. `MockKv` - 9 edges
4. `authedRequest()` - 7 edges
5. `logSiweFailure()` - 4 edges
6. `eventLine()` - 4 edges
7. `middleware()` - 3 edges
8. `followUpErrorMessage()` - 3 edges
9. `followUpErrorMessage()` - 3 edges
10. `load()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `persistedEvent()` --calls--> `utcTime()`  [INFERRED]
  app/research/ResearchPageClient.tsx → components/research/types.ts
- `cancel()` --calls--> `utcTime()`  [INFERRED]
  app/research/ResearchPageClient.tsx → components/research/types.ts
- `POST()` --calls--> `postVerify()`  [INFERRED]
  app/api/auth/logout/route.ts → app/api/auth/verify.test.ts
- `buildValidBody()` --calls--> `buildSiweMessage()`  [INFERRED]
  app/api/auth/verify.test.ts → test/fixtures/valid-siwe-message.ts
- `buildValidBody()` --calls--> `signTestMessage()`  [INFERRED]
  app/api/auth/verify.test.ts → test/fixtures/test-wallet.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (10): cancel(), followUpErrorMessage(), followUpStatusLabel(), followUpStatusTone(), loadFollowUps(), persistedEvent(), resetIn(), submit() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (2): GET(), serializeResearch()

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (4): middleware(), MockKv, final(), mergeFollowUps()

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (4): argsText(), eventLine(), utcTime(), extractPreview()

### Community 4 - "Community 4"
Cohesion: 0.27
Nodes (6): expectedSiweDiagnostics(), followUpConflict(), logSiweFailure(), parseSiweDiagnostics(), POST(), serializeFollowUp()

### Community 5 - "Community 5"
Cohesion: 0.2
Nodes (2): handleSignIn(), signatureErrorMessage()

### Community 6 - "Community 6"
Cohesion: 0.29
Nodes (6): detailErrorMessage(), followUpErrorMessage(), followUpStatusLabel(), followUpStatusTone(), load(), submitFollowUp()

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (1): load()

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (1): authedRequest()

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (4): AuthGate(), useSiweLogin(), useInvalidateSession(), useUser()

### Community 10 - "Community 10"
Cohesion: 0.29
Nodes (4): signTestMessage(), buildSiweMessage(), buildValidBody(), postVerify()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (2): formatBlock(), TopBar()

### Community 12 - "Community 12"
Cohesion: 0.5
Nodes (1): MockEventSource

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (2): BudgetMeter(), decimal()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): chainLabel(), NetworkGuard()

## Knowledge Gaps
- **Thin community `Community 1`** (17 nodes): `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `GET()`, `isTerminalEvent()`, `persistedTerminalEvent()`, `serializeEntry()`, `serializeResearch()`, `serializeTxLog()`, `sse()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 5`** (11 nodes): `ConnectWalletButton.tsx`, `closeOnEscape()`, `closeOnOutsideClick()`, `formatBalance()`, `handleSignIn()`, `menuAddress()`, `shortAddress()`, `signatureErrorMessage()`, `toggleAccountMenu()`, `toWagmiAddress()`, `warmAuthNonce()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 7`** (9 nodes): `page.tsx`, `page.tsx`, `DataCell()`, `FieldRow()`, `formatBalance()`, `load()`, `shortAddress()`, `statusLabel()`, `toWagmiAddress()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (9 nodes): `route.test.ts`, `route.test.ts`, `route.test.ts`, `route.test.ts`, `route.test.ts`, `route.test.ts`, `route.test.ts`, `authedRequest()`, `waitForAssertion()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (4 nodes): `TopBar.tsx`, `formatBlock()`, `formatUtcTime()`, `TopBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (4 nodes): `MockEventSource`, `.constructor()`, `.reset()`, `AgentLogStream.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (4 nodes): `bar()`, `BudgetMeter()`, `decimal()`, `BudgetMeter.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (3 nodes): `NetworkGuard.tsx`, `chainLabel()`, `NetworkGuard()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `POST()` connect `Community 4` to `Community 10`, `Community 2`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `final()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `GET()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `POST()` (e.g. with `postVerify()` and `.get()`) actually correct?**
  _`POST()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._