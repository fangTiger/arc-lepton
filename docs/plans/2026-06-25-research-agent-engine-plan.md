# Research Agent Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Phase 3 research engine with DeepSeek-compatible tool calling, x402 mock-source accounting, research persistence, and SSE streaming.

**Architecture:** API routes create research jobs and publish AgentEvent records into an in-memory event bus. The agent loop talks to an OpenAI-compatible DeepSeek client, executes local mock data tools directly, writes tx_log/research state through repositories, and streams the final markdown report.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Drizzle, OpenAI SDK, SSE Web Streams, existing auth and repo fallback patterns.

---

### Task 1: OpenSpec and Test Harness

**Files:**
- Create: `openspec/changes/research-agent-engine/*`
- Create: `docs/plans/2026-06-25-research-agent-engine-plan.md`
- Test: `lib/llm/deepseek.test.ts`, `lib/db/research-repo-memory.test.ts`, `lib/agent/research-agent.test.ts`, `app/api/research/start/route.test.ts`

**Steps:**
1. Write OpenSpec proposal, tasks, and spec delta.
2. Add RED tests for DeepSeek fallback, research memory repo, agent flow, and start route.
3. Run targeted Vitest commands and verify failures are due to missing modules.

### Task 2: DeepSeek Client

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `lib/llm/deepseek.ts`

**Steps:**
1. Run `pnpm add openai`.
2. Implement `getDeepSeekClient()` with real OpenAI SDK client when key exists.
3. Implement dev-only mock client that returns deterministic tool calls and report chunks.
4. Re-run `lib/llm/deepseek.test.ts`.

### Task 3: Research Repository

**Files:**
- Create: `lib/db/schema/research.ts`
- Modify: `lib/db/schema/index.ts`, `drizzle.config.ts`, `lib/db/index.ts`
- Create: `lib/db/research-repo.ts`, `lib/db/research-repo-memory.ts`, `lib/db/research-repo-pg.ts`

**Steps:**
1. Implement schema and typed repository interface.
2. Implement memory repo with decimal-safe `appendSpent`.
3. Implement Drizzle repo with `updateStatus`, `setReport`, `listByAddress`.
4. Export `researchRepo` from `lib/db/index.ts` using the same production fail-fast/dev fallback pattern.

### Task 4: Agent and Event Bus

**Files:**
- Create: `lib/agent/event-bus.ts`
- Create: `lib/agent/research-agent.ts`

**Steps:**
1. Implement event bus with replay, subscribe, publish, done, abort controller registry, and TTL cleanup.
2. Implement tool definitions and local tool executor using `lib/data/mock-sources.ts` plus `txLogRepo.record`.
3. Implement `runResearchAgent()` async generator with tool loop, budget checks, streamed report chunks, final/error events, and research repo updates.
4. Re-run agent tests.

### Task 5: Research API Routes

**Files:**
- Create: `app/api/research/start/route.ts`
- Create: `app/api/research/start/route.test.ts`
- Create: `app/api/research/[id]/stream/route.ts`
- Create: `app/api/research/[id]/route.ts`
- Create: `app/api/research/[id]/cancel/route.ts`

**Steps:**
1. Implement zod validation and `requireAuth` in start route.
2. Start background agent with `void runAgentInBackground(...)`.
3. Implement SSE stream with history replay and subscriber cleanup.
4. Implement detail and cancel routes.

### Task 6: Verification and Commit

**Files:**
- All touched files

**Steps:**
1. Run `openspec validate research-agent-engine --strict`.
2. Run `pnpm typecheck`, `pnpm vitest run`, and `pnpm build`.
3. Restart dev server and run curl E2E: start research, stream SSE, fetch detail, fetch tx-log.
4. Run graphify rebuild.
5. Commit `feat(agent): research engine with DeepSeek V4 + SSE streaming`.
