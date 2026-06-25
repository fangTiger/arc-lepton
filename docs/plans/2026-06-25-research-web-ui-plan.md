# Research Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Phase 4 Bloomberg-terminal frontend for creating, watching, reviewing, and listing Agent research runs.

**Architecture:** Keep backend additions read-only and minimal: `/api/research` lists current-user research, `/api/stats/global` exposes public aggregate stats. Client pages consume existing start/stream/detail/wallet APIs, rendering AgentEvent state through small research components.

**Tech Stack:** Next.js App Router, React client components, Tailwind tokens, EventSource SSE, ReactMarkdown + remark-gfm, existing auth/middleware.

---

### Task 1: Spec and API Tests

**Files:**
- Create: `openspec/changes/research-web-ui/*`
- Create: `docs/plans/2026-06-25-research-web-ui-plan.md`
- Test: `app/api/research/route.test.ts`, `app/api/stats/global/route.test.ts`

**Steps:**
1. Add OpenSpec proposal/tasks/spec delta.
2. Add RED tests for authenticated research list and public global stats.
3. Run targeted Vitest and verify missing route failures.

### Task 2: Read-only APIs

**Files:**
- Create: `app/api/research/route.ts`
- Create: `app/api/stats/global/route.ts`
- Modify: `lib/db/research-repo.ts`, `lib/db/research-repo-memory.ts`, `lib/db/research-repo-pg.ts`
- Modify: `lib/db/tx-log-repo.ts`, `lib/db/tx-log-repo-memory.ts`, `lib/db/tx-log-repo-pg.ts`

**Steps:**
1. Add minimal aggregate methods needed for global stats.
2. Implement current-user research list route.
3. Implement public stats route.
4. Re-run targeted tests.

### Task 3: Research Components

**Files:**
- Create: `components/research/AgentLogStream.tsx`
- Create: `components/research/TxFeed.tsx`
- Create: `components/research/BudgetMeter.tsx`
- Create: `components/research/TerminalMarkdown.tsx`
- Create: `components/research/types.ts`

**Steps:**
1. Implement AgentEvent types and formatting helpers.
2. Implement EventSource subscriber with auto-scroll and report chunk accumulation.
3. Implement TX feed and ASCII budget meter.
4. Implement markdown renderers with terminal styles.

### Task 4: Pages

**Files:**
- Create: `app/research/page.tsx`
- Create: `app/research/[id]/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/page.tsx`

**Steps:**
1. Build `/research` form and live modes.
2. Build report detail page.
3. Replace dashboard placeholder with stats/history.
4. Replace home hardcoded stats with global API polling.

### Task 5: Verification

**Steps:**
1. Run OpenSpec validation, typecheck, Vitest, build.
2. Restart dev.
3. Curl unauth redirects and API stats.
4. Run browser/Playwright smoke for research flow, detail, dashboard.
5. Rebuild graphify and commit.
