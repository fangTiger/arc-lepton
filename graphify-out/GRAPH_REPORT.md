# Graph Report - arc-lepton  (2026-06-26)

## Corpus Check
- 64 files · ~35,441 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 150 nodes · 130 edges · 13 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 13|Community 13]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 11 edges
2. `MockKv` - 9 edges
3. `POST()` - 7 edges
4. `logSiweFailure()` - 4 edges
5. `eventLine()` - 4 edges
6. `middleware()` - 3 edges
7. `authedRequest()` - 3 edges
8. `serializeResearch()` - 3 edges
9. `buildValidBody()` - 3 edges
10. `parseSiweDiagnostics()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `persistedEvent()` --calls--> `utcTime()`  [INFERRED]
  app/research/ResearchPageClient.tsx → components/research/types.ts
- `POST()` --calls--> `postVerify()`  [INFERRED]
  app/api/auth/logout/route.ts → app/api/auth/verify.test.ts
- `buildValidBody()` --calls--> `buildSiweMessage()`  [INFERRED]
  app/api/auth/verify.test.ts → test/fixtures/valid-siwe-message.ts
- `buildValidBody()` --calls--> `signTestMessage()`  [INFERRED]
  app/api/auth/verify.test.ts → test/fixtures/test-wallet.ts
- `AuthGate()` --calls--> `useUser()`  [INFERRED]
  components/auth/AuthGate.tsx → hooks/useUser.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (2): GET(), serializeResearch()

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (6): argsText(), eventLine(), utcTime(), persistedEvent(), extractPreview(), utcTime()

### Community 2 - "Community 2"
Cohesion: 0.27
Nodes (2): middleware(), MockKv

### Community 3 - "Community 3"
Cohesion: 0.2
Nodes (2): handleSignIn(), signatureErrorMessage()

### Community 4 - "Community 4"
Cohesion: 0.22
Nodes (2): resetIn(), submit()

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (1): load()

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (4): expectedSiweDiagnostics(), logSiweFailure(), parseSiweDiagnostics(), POST()

### Community 7 - "Community 7"
Cohesion: 0.25
Nodes (4): AuthGate(), useSiweLogin(), useInvalidateSession(), useUser()

### Community 8 - "Community 8"
Cohesion: 0.29
Nodes (4): signTestMessage(), buildSiweMessage(), buildValidBody(), postVerify()

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (1): authedRequest()

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (2): formatBlock(), TopBar()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (2): BudgetMeter(), decimal()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (2): chainLabel(), NetworkGuard()

## Knowledge Gaps
- **Thin community `Community 0`** (15 nodes): `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `route.ts`, `GET()`, `serializeEntry()`, `serializeResearch()`, `serializeTxLog()`, `sse()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 2`** (12 nodes): `middleware()`, `middleware.ts`, `MockKv`, `._clear()`, `.decr()`, `.expire()`, `.get()`, `.getdel()`, `.incr()`, `._now()`, `.set()`, `mock-kv.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 3`** (11 nodes): `ConnectWalletButton.tsx`, `closeOnEscape()`, `closeOnOutsideClick()`, `formatBalance()`, `handleSignIn()`, `menuAddress()`, `shortAddress()`, `signatureErrorMessage()`, `toggleAccountMenu()`, `toWagmiAddress()`, `warmAuthNonce()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 4`** (10 nodes): `ResearchPageClient.tsx`, `cancel()`, `estimatedCalls()`, `formatBudget()`, `quotaBar()`, `quotaExceededReason()`, `QuotaPanel()`, `quotaTone()`, `resetIn()`, `submit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 5`** (9 nodes): `page.tsx`, `page.tsx`, `DataCell()`, `FieldRow()`, `formatBalance()`, `load()`, `shortAddress()`, `statusLabel()`, `toWagmiAddress()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (4 nodes): `route.test.ts`, `route.test.ts`, `route.test.ts`, `authedRequest()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (4 nodes): `TopBar.tsx`, `formatBlock()`, `formatUtcTime()`, `TopBar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (4 nodes): `bar()`, `BudgetMeter()`, `decimal()`, `BudgetMeter.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (3 nodes): `NetworkGuard.tsx`, `chainLabel()`, `NetworkGuard()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `POST()` connect `Community 6` to `Community 8`, `Community 2`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `persistedEvent()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `POST()` (e.g. with `postVerify()` and `.get()`) actually correct?**
  _`POST()` has 2 INFERRED edges - model-reasoned connections that need verification._