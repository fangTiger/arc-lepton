# Auth Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过插件钱包（MetaMask 等）登录 Arc Lepton 应用，建立 SIWE 签名 + JWT cookie session，并把基础后端用户表写入 Vercel Postgres。

**Architecture:** Next.js 14 App Router 单 app；前端用 wagmi + RainbowKit，后端 SIWE 验签 + jose 签 JWT，会话以 HTTP-only cookie 维持；nonce 与速率限制存 Vercel KV；用户表用 Drizzle ORM 操作 Vercel Postgres。

**Tech Stack:** Next.js 14 · TypeScript · Tailwind · wagmi v2 · viem · RainbowKit · jose (JWT) · Drizzle ORM · @vercel/postgres · @upstash/redis · Vitest

**Source spec:** `docs/plans/2026-06-23-auth-module-design.md`

---

## File Structure

每个文件单一职责，便于独立测试与替换。

```
arc-lepton/
├── package.json                          ← deps + scripts
├── tsconfig.json                         ← strict TS
├── next.config.js                        ← Next config
├── tailwind.config.ts                    ← tokens（colors/space/radius）
├── postcss.config.js                     ← postcss + tailwind
├── drizzle.config.ts                     ← migration 配置
├── .env.example                          ← 必需 env 模板（commit）
├── .env.local                            ← 真实 env（gitignore）
├── middleware.ts                         ← 全局路由守卫（仅检查 cookie 存在性）
│
├── app/
│   ├── layout.tsx                        ← root layout + <Providers>
│   ├── page.tsx                          ← 首页占位（"Connect Wallet" CTA）
│   ├── globals.css                       ← Tailwind base + 设计 tokens 注入
│   ├── (auth)/
│   │   └── login/page.tsx                ← 独立登录页（来自 v1 设计）
│   └── api/
│       └── auth/
│           ├── nonce/route.ts            ← GET nonce
│           ├── verify/route.ts           ← POST 验签 + 发 JWT
│           ├── logout/route.ts           ← POST 清 cookie
│           └── session/route.ts          ← GET 当前 session
│
├── components/
│   └── auth/
│       ├── ConnectWalletButton.tsx       ← Header 按钮 + 4 状态
│       ├── NetworkGuard.tsx              ← 错网络 banner + 切链
│       └── AuthGate.tsx                  ← 受保护内容守卫
│
├── hooks/
│   ├── useUser.ts                        ← GET /api/auth/session + cache
│   └── useSiweLogin.ts                   ← 完整 login/logout 封装
│
├── lib/
│   ├── auth/
│   │   ├── jwt.ts                        ← sign/verify JWT（jose）
│   │   ├── nonce-store.ts                ← KV nonce 存取
│   │   ├── rate-limit.ts                 ← KV 速率限制
│   │   ├── siwe.ts                       ← SIWE message 构造 + 7 项校验
│   │   ├── session.ts                    ← cookie 读写工具
│   │   └── middleware.ts                 ← requireAuth(req) 业务用
│   ├── db/
│   │   ├── index.ts                      ← Drizzle client 实例
│   │   └── schema/
│   │       ├── users.ts                  ← users 表
│   │       └── _future.md                ← v2 表占位注释
│   ├── kv.ts                             ← Vercel KV client
│   ├── wagmi.ts                          ← wagmi config + arcTestnet chain
│   └── constants.ts                      ← 全局常量（CHAIN_ID 等）
│
├── providers/
│   └── Providers.tsx                     ← Wagmi + RainbowKit + QueryClient
│
├── test/
│   └── fixtures/
│       ├── mock-kv.ts                    ← in-memory KV 替身
│       ├── test-wallet.ts                ← viem 测试私钥 + 签名工具
│       └── valid-siwe-message.ts         ← 合法 SIWE message 模板
│
├── .github/
│   └── workflows/
│       └── test.yml                      ← CI（typecheck + test + build）
│
└── vitest.config.ts                      ← Vitest 配置
```

---

## Phase A · Foundation（3 tasks）

### Task 1: 项目初始化 + 依赖安装

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Create: `vitest.config.ts`
- Create: `app/layout.tsx`（最小占位）
- Create: `app/page.tsx`（最小占位）
- Create: `app/globals.css`
- Create: `.env.example`

**Why:** 建立可运行的 Next.js 14 + Tailwind + Vitest 骨架，跑通 `pnpm dev` 和 `pnpm test`。

- [ ] **Step 1: 初始化 package.json**

```bash
pnpm init
```

- [ ] **Step 2: 写 package.json 内容（覆盖 init 产物）**

```json
{
  "name": "arc-lepton",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push"
  }
}
```

- [ ] **Step 3: 安装生产依赖**

```bash
pnpm add next@14 react@18 react-dom@18 typescript \
  wagmi viem @rainbow-me/rainbowkit @tanstack/react-query \
  jose \
  drizzle-orm @vercel/postgres \
  @upstash/redis \
  zod
```

- [ ] **Step 4: 安装开发依赖**

```bash
pnpm add -D @types/node @types/react @types/react-dom \
  tailwindcss postcss autoprefixer \
  drizzle-kit \
  vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom \
  eslint eslint-config-next
```

- [ ] **Step 5: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6: 创建 next.config.js**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}
module.exports = nextConfig
```

- [ ] **Step 7: 创建 Tailwind 配置**

`postcss.config.js`:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0A0B10', surface: '#14161D', elevated: '#1C1F28', inset: '#060709' },
        arc: { DEFAULT: '#4D7EFF', hover: '#6B92FF' },
        success: '#10B981',
        danger:  '#F75A5A',
        warning: '#F5A623',
        live:    '#00D9FF',
      },
      borderRadius: { xs: '6px', sm: '10px', md: '14px', lg: '20px' },
      fontFamily: { sans: ['Geist', 'sans-serif'], mono: ['Geist Mono', 'monospace'] },
    },
  },
  plugins: [],
}
export default config
```

- [ ] **Step 8: 创建 app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

body {
  background: #0A0B10;
  color: #F4F5F8;
  font-family: 'Geist', -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 9: 创建 Vitest 配置**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 10: 创建最小 layout + page**

`app/layout.tsx`:
```tsx
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Arc Lepton',
  description: 'AI 交易研究员 · 让 Agent 在 USDC 预算内自主研究',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

`app/page.tsx`:
```tsx
export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-2xl">Arc Lepton — placeholder</h1>
    </main>
  )
}
```

- [ ] **Step 11: 创建 .env.example**

```bash
# 公开变量
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ARC_CHAIN_ID=
NEXT_PUBLIC_ARC_RPC_URL=
NEXT_PUBLIC_ARC_EXPLORER_URL=

# 敏感变量
JWT_SECRET=
DATABASE_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

- [ ] **Step 12: 验证 dev 与 build 通过**

```bash
pnpm dev   # 打开 http://localhost:3000 应看到 "Arc Lepton — placeholder"
# Ctrl+C 退出
pnpm typecheck
pnpm build
```

Expected: 三个命令都成功无错。

- [ ] **Step 13: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.js \
  postcss.config.js tailwind.config.ts vitest.config.ts \
  app/layout.tsx app/page.tsx app/globals.css .env.example
git commit -m "chore: scaffold Next.js 14 + Tailwind + Vitest"
```

---

### Task 2: Drizzle DB schema（users 表）+ 连接

**Files:**
- Create: `lib/db/schema/users.ts`
- Create: `lib/db/index.ts`
- Create: `lib/db/schema/_future.md`
- Create: `drizzle.config.ts`

**Why:** 持久化用户登录记录所需的最小 schema 与 client。

- [ ] **Step 1: 创建 users 表 schema**

`lib/db/schema/users.ts`:
```ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  address:     text('address').primaryKey(),       // 小写 0x...
  createdAt:   timestamp('created_at',   { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User    = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

- [ ] **Step 2: 创建 v2 占位备忘**

`lib/db/schema/_future.md`:
```md
# Future Tables (v2)

不进 Drizzle 编译，仅记录后续模块的表设计草图。

## research
- id (uuid)
- address (FK → users.address)
- topic (text)
- report_md (text)
- total_spent (numeric)
- created_at (timestamptz)

## tx_log
- id (uuid)
- address (FK → users.address)
- tx_hash (text unique)
- amount (numeric)
- type (text)   # 'research_data' | 'swap' | ...
- created_at (timestamptz)

## agent_config
- address (PK, FK → users.address)
- default_budget (numeric)
- preferred_sources (text[])
- updated_at (timestamptz)
```

- [ ] **Step 3: 创建 DB client**

`lib/db/index.ts`:
```ts
import { drizzle } from 'drizzle-orm/vercel-postgres'
import { sql } from '@vercel/postgres'
import * as schema from './schema/users'

export const db = drizzle(sql, { schema })
```

- [ ] **Step 4: 创建 Drizzle 配置**

`drizzle.config.ts`:
```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema/users.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/db drizzle.config.ts
git commit -m "feat(db): users schema + drizzle client"
```

---

### Task 3: Vercel KV client + 常量

**Files:**
- Create: `lib/kv.ts`
- Create: `lib/constants.ts`

**Why:** 为 nonce 与速率限制提供统一 KV 入口；常量集中管理（CHAIN_ID 等）。

- [ ] **Step 1: 创建 KV client**

`lib/kv.ts`:
```ts
import { Redis } from '@upstash/redis'

export const kv = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})
```

- [ ] **Step 2: 创建常量文件**

`lib/constants.ts`:
```ts
export const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '0')
export const ARC_RPC_URL  = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? ''
export const APP_URL      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
export const APP_HOST     = new URL(APP_URL).host

export const COOKIE_NAME  = 'arc_session'
export const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7   // 7 days

export const NONCE_TTL_SEC = 60 * 5                  // 5 min
export const SIWE_MAX_AGE_MS = 5 * 60 * 1000         // 5 min issuedAt window

export const RATE_LIMIT_NONCE  = { max: 120, windowSec: 60 }
export const RATE_LIMIT_VERIFY = { max: 30,  windowSec: 60 }
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add lib/kv.ts lib/constants.ts
git commit -m "feat: kv client + auth constants"
```

---

## Phase B · Backend Auth Core（4 tasks）

### Task 4: JWT 签发/验证 + 测试

**Files:**
- Create: `lib/auth/jwt.ts`
- Test: `lib/auth/jwt.test.ts`

**Why:** session token 的最底层原语；必须先有它才能写 verify 路由。

- [ ] **Step 1: 写失败测试**

`lib/auth/jwt.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt, verifySessionJwt } from './jwt'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

describe('jwt', () => {
  it('signs and verifies a session token', async () => {
    const token = await signSessionJwt('0xabc')
    const payload = await verifySessionJwt(token)
    expect(payload.sub).toBe('0xabc')
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionJwt('0xabc')
    const tampered = token.slice(0, -1) + 'X'
    await expect(verifySessionJwt(tampered)).rejects.toThrow()
  })

  it('rejects when secret is different', async () => {
    const token = await signSessionJwt('0xabc')
    process.env.JWT_SECRET = 'different-different-different-different32'
    await expect(verifySessionJwt(token)).rejects.toThrow()
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
  })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

```bash
pnpm test lib/auth/jwt.test.ts --run
```

Expected: 失败（模块不存在）。

- [ ] **Step 3: 实现 jwt.ts**

`lib/auth/jwt.ts`:
```ts
import { SignJWT, jwtVerify } from 'jose'
import { COOKIE_MAX_AGE_SEC } from '@/lib/constants'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing or too short')
  return new TextEncoder().encode(secret)
}

export async function signSessionJwt(address: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(address.toLowerCase())
    .setIssuedAt(now)
    .setExpirationTime(now + COOKIE_MAX_AGE_SEC)
    .sign(getSecret())
}

export async function verifySessionJwt(token: string): Promise<{ sub: string; iat: number; exp: number }> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
  return payload as { sub: string; iat: number; exp: number }
}
```

- [ ] **Step 4: 跑测试验证 PASS**

```bash
pnpm test lib/auth/jwt.test.ts --run
```

Expected: 3 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/auth/jwt.ts lib/auth/jwt.test.ts
git commit -m "feat(auth): JWT sign/verify with jose (HS256, 7d exp)"
```

---

### Task 5: Nonce store + Rate limit + 测试（KV-backed，可注入）

**Files:**
- Create: `lib/auth/nonce-store.ts`
- Create: `lib/auth/rate-limit.ts`
- Create: `test/fixtures/mock-kv.ts`
- Test: `lib/auth/nonce-store.test.ts`
- Test: `lib/auth/rate-limit.test.ts`

**Why:** SIWE 防重放 + 防爆破；用接口注入 KV，便于单测 mock。

- [ ] **Step 1: 创建 in-memory KV mock**

`test/fixtures/mock-kv.ts`:
```ts
// 仅实现 nonce-store / rate-limit 用到的方法
type Value = { value: string; expiresAt: number | null }

export class MockKv {
  private store = new Map<string, Value>()

  async set(key: string, value: string, opts?: { ex?: number }): Promise<'OK'> {
    this.store.set(key, {
      value,
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
    })
    return 'OK'
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key)
    if (!item) return null
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key)
      return null
    }
    return item.value
  }

  async getdel(key: string): Promise<string | null> {
    const v = await this.get(key)
    this.store.delete(key)
    return v
  }

  async incr(key: string): Promise<number> {
    const current = parseInt((await this.get(key)) ?? '0', 10)
    const next = current + 1
    const existing = this.store.get(key)
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null })
    return next
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key)
    if (!item) return 0
    item.expiresAt = Date.now() + seconds * 1000
    return 1
  }

  // 测试辅助
  _clear() { this.store.clear() }
  _now() { return Date.now() }
}
```

- [ ] **Step 2: 定义 KV 接口（让 nonce-store / rate-limit 接受任意实现）**

`lib/kv.ts`（追加）:
```ts
// 在已有 kv export 之后追加：
export interface KvClient {
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
  get(key: string): Promise<string | null>
  getdel(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}
```

- [ ] **Step 3: 写 nonce-store 失败测试**

`lib/auth/nonce-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { createNonce, consumeNonce } from './nonce-store'

let kv: MockKv

beforeEach(() => { kv = new MockKv() })

describe('nonce-store', () => {
  it('creates a unique nonce and stores in KV', async () => {
    const n1 = await createNonce(kv)
    const n2 = await createNonce(kv)
    expect(n1).not.toBe(n2)
    expect(n1).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  it('consume returns true once, then false', async () => {
    const n = await createNonce(kv)
    expect(await consumeNonce(kv, n)).toBe(true)
    expect(await consumeNonce(kv, n)).toBe(false)
  })

  it('consume returns false for unknown nonce', async () => {
    expect(await consumeNonce(kv, 'unknown-nonce-xxxx')).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试 FAIL**

```bash
pnpm test lib/auth/nonce-store.test.ts --run
```

Expected: 失败（模块不存在）。

- [ ] **Step 5: 实现 nonce-store**

`lib/auth/nonce-store.ts`:
```ts
import type { KvClient } from '@/lib/kv'
import { NONCE_TTL_SEC } from '@/lib/constants'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function genNonce(len = 16): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('')
}

const key = (nonce: string) => `siwe:nonce:${nonce}`

export async function createNonce(kv: KvClient): Promise<string> {
  const nonce = genNonce()
  await kv.set(key(nonce), '1', { ex: NONCE_TTL_SEC })
  return nonce
}

export async function consumeNonce(kv: KvClient, nonce: string): Promise<boolean> {
  const v = await kv.getdel(key(nonce))
  return v !== null
}
```

- [ ] **Step 6: 跑测试 PASS**

```bash
pnpm test lib/auth/nonce-store.test.ts --run
```

Expected: 3 PASS。

- [ ] **Step 7: 写 rate-limit 失败测试**

`lib/auth/rate-limit.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { checkRateLimit } from './rate-limit'

let kv: MockKv

beforeEach(() => { kv = new MockKv() })

describe('rate-limit', () => {
  it('allows requests under the limit', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
      expect(ok).toBe(true)
    }
  })

  it('blocks requests over the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
    }
    expect(await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)).toBe(false)
  })

  it('isolates buckets by IP', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
    }
    expect(await checkRateLimit(kv, '5.6.7.8', 'verify', 5, 60)).toBe(true)
  })
})
```

- [ ] **Step 8: 跑测试 FAIL**

```bash
pnpm test lib/auth/rate-limit.test.ts --run
```

Expected: 失败。

- [ ] **Step 9: 实现 rate-limit**

`lib/auth/rate-limit.ts`:
```ts
import type { KvClient } from '@/lib/kv'

const key = (ip: string, bucket: string) => `rl:${bucket}:${ip}`

export async function checkRateLimit(
  kv: KvClient,
  ip: string,
  bucket: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const k = key(ip, bucket)
  const count = await kv.incr(k)
  if (count === 1) await kv.expire(k, windowSec)
  return count <= max
}
```

- [ ] **Step 10: 跑测试 PASS**

```bash
pnpm test lib/auth/rate-limit.test.ts --run
```

Expected: 3 PASS。

- [ ] **Step 11: Commit**

```bash
git add lib/kv.ts lib/auth/nonce-store.ts lib/auth/nonce-store.test.ts \
  lib/auth/rate-limit.ts lib/auth/rate-limit.test.ts \
  test/fixtures/mock-kv.ts
git commit -m "feat(auth): KV-backed nonce-store + rate-limit (with in-memory mock)"
```

---

### Task 6: SIWE message 构造 + 7 项校验 + 验签

**Files:**
- Create: `lib/auth/siwe.ts`
- Create: `test/fixtures/test-wallet.ts`
- Create: `test/fixtures/valid-siwe-message.ts`
- Test: `lib/auth/siwe.test.ts`

**Why:** 整个登录流程的安全核心；必须穷尽 7 项校验场景。

- [ ] **Step 1: 创建测试钱包**

`test/fixtures/test-wallet.ts`:
```ts
import { privateKeyToAccount } from 'viem/accounts'

export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil 第一个
export const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY)

export async function signTestMessage(message: string): Promise<`0x${string}`> {
  return testAccount.signMessage({ message })
}
```

- [ ] **Step 2: 创建标准 SIWE message 模板**

`test/fixtures/valid-siwe-message.ts`:
```ts
export function buildSiweMessage(opts: {
  domain: string
  address: string
  uri: string
  chainId: number
  nonce: string
  issuedAt?: string
}): string {
  const issuedAt = opts.issuedAt ?? new Date().toISOString()
  return [
    `${opts.domain} wants you to sign in with your Ethereum account:`,
    opts.address,
    '',
    'Sign in to Arc Lepton.',
    '',
    `URI: ${opts.uri}`,
    `Version: 1`,
    `Chain ID: ${opts.chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')
}
```

- [ ] **Step 3: 写 SIWE 失败测试**

`lib/auth/siwe.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { testAccount, signTestMessage } from '@/test/fixtures/test-wallet'
import { buildSiweMessage } from '@/test/fixtures/valid-siwe-message'
import { createNonce } from './nonce-store'
import { verifySiweLogin } from './siwe'

const DOMAIN   = 'localhost:3000'
const URI      = 'http://localhost:3000'
const CHAIN_ID = 9999

let kv: MockKv

beforeEach(() => {
  kv = new MockKv()
  process.env.NEXT_PUBLIC_APP_URL = URI
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID = String(CHAIN_ID)
})

async function makeValidPayload() {
  const nonce = await createNonce(kv)
  const message = buildSiweMessage({
    domain: DOMAIN, address: testAccount.address, uri: URI, chainId: CHAIN_ID, nonce,
  })
  const signature = await signTestMessage(message)
  return { message, signature, address: testAccount.address }
}

describe('siwe.verifySiweLogin', () => {
  it('accepts a valid signature', async () => {
    const payload = await makeValidPayload()
    const result = await verifySiweLogin(kv, payload)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.address).toBe(testAccount.address.toLowerCase())
  })

  it('rejects when address mismatch', async () => {
    const payload = await makeValidPayload()
    const r = await verifySiweLogin(kv, { ...payload, address: '0x' + '0'.repeat(40) })
    expect(r.ok).toBe(false)
  })

  it('rejects when domain mismatch', async () => {
    const nonce = await createNonce(kv)
    const message = buildSiweMessage({
      domain: 'evil.com', address: testAccount.address, uri: URI, chainId: CHAIN_ID, nonce,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('rejects when chainId mismatch', async () => {
    const nonce = await createNonce(kv)
    const message = buildSiweMessage({
      domain: DOMAIN, address: testAccount.address, uri: URI, chainId: 1, nonce,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('rejects when nonce missing or already used', async () => {
    const payload = await makeValidPayload()
    expect((await verifySiweLogin(kv, payload)).ok).toBe(true)   // 第一次成功
    expect((await verifySiweLogin(kv, payload)).ok).toBe(false)  // 第二次 nonce 被消费
  })

  it('rejects when issuedAt is too old', async () => {
    const nonce = await createNonce(kv)
    const oldIssued = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const message = buildSiweMessage({
      domain: DOMAIN, address: testAccount.address, uri: URI, chainId: CHAIN_ID, nonce, issuedAt: oldIssued,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const payload = await makeValidPayload()
    const bad = (payload.signature.slice(0, -2) + '00') as `0x${string}`
    const r = await verifySiweLogin(kv, { ...payload, signature: bad })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试 FAIL**

```bash
pnpm test lib/auth/siwe.test.ts --run
```

Expected: 失败。

- [ ] **Step 5: 实现 SIWE 验证**

`lib/auth/siwe.ts`:
```ts
import { verifyMessage, type Address } from 'viem'
import type { KvClient } from '@/lib/kv'
import { consumeNonce } from './nonce-store'
import { APP_HOST, APP_URL, ARC_CHAIN_ID, SIWE_MAX_AGE_MS } from '@/lib/constants'

type Input = { message: string; signature: `0x${string}`; address: string }
export type SiweResult =
  | { ok: true; address: Address }
  | { ok: false; reason: string }   // reason 内部用，不外泄

interface ParsedSiwe {
  domain: string
  address: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
}

function parseSiwe(message: string): ParsedSiwe | null {
  const lines = message.split('\n')
  if (lines.length < 8) return null
  const domain = lines[0].split(' wants you to sign in')[0]
  const address = lines[1]
  const get = (key: string) => lines.find(l => l.startsWith(key + ': '))?.slice(key.length + 2) ?? ''
  return {
    domain,
    address,
    uri:      get('URI'),
    version:  get('Version'),
    chainId:  parseInt(get('Chain ID'), 10),
    nonce:    get('Nonce'),
    issuedAt: get('Issued At'),
  }
}

export async function verifySiweLogin(kv: KvClient, input: Input): Promise<SiweResult> {
  const parsed = parseSiwe(input.message)
  if (!parsed) return { ok: false, reason: 'parse_error' }

  // 1. address 一致
  if (parsed.address.toLowerCase() !== input.address.toLowerCase())
    return { ok: false, reason: 'address_mismatch' }

  // 2. domain
  if (parsed.domain !== APP_HOST) return { ok: false, reason: 'domain_mismatch' }

  // 3. uri
  if (parsed.uri !== APP_URL) return { ok: false, reason: 'uri_mismatch' }

  // 4. chainId
  if (parsed.chainId !== ARC_CHAIN_ID) return { ok: false, reason: 'chain_mismatch' }

  // 5. version
  if (parsed.version !== '1') return { ok: false, reason: 'version_mismatch' }

  // 6. issuedAt 窗口
  const issuedTs = Date.parse(parsed.issuedAt)
  if (Number.isNaN(issuedTs) || Math.abs(Date.now() - issuedTs) > SIWE_MAX_AGE_MS)
    return { ok: false, reason: 'expired' }

  // 7. nonce 一次性
  if (!(await consumeNonce(kv, parsed.nonce)))
    return { ok: false, reason: 'nonce_invalid' }

  // 最后才验签
  const valid = await verifyMessage({
    address: input.address as Address,
    message: input.message,
    signature: input.signature,
  })
  if (!valid) return { ok: false, reason: 'signature_invalid' }

  return { ok: true, address: input.address.toLowerCase() as Address }
}
```

- [ ] **Step 6: 跑测试 PASS**

```bash
pnpm test lib/auth/siwe.test.ts --run
```

Expected: 7 PASS。

- [ ] **Step 7: Commit**

```bash
git add lib/auth/siwe.ts lib/auth/siwe.test.ts \
  test/fixtures/test-wallet.ts test/fixtures/valid-siwe-message.ts
git commit -m "feat(auth): SIWE message parse + 7-check verifier + viem signature verify"
```

---

### Task 7: Session cookie 工具 + requireAuth 中间件

**Files:**
- Create: `lib/auth/session.ts`
- Create: `lib/auth/middleware.ts`
- Test: `lib/auth/session.test.ts`

**Why:** API 层鉴权的统一入口；业务模块靠 requireAuth 一行拿到 user。

- [ ] **Step 1: 写 session 测试**

`lib/auth/session.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt } from './jwt'
import { requireAuth } from './middleware'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

function makeReq(cookie?: string): Request {
  return new Request('http://localhost/api/test', {
    headers: cookie ? { cookie } : {},
  })
}

describe('requireAuth', () => {
  it('returns address from valid cookie', async () => {
    const token = await signSessionJwt('0xAbC')
    const res = await requireAuth(makeReq(`arc_session=${token}`))
    expect(res.address).toBe('0xabc')
    expect(res.userId).toBe('0xabc')
  })

  it('throws 401 when no cookie', async () => {
    await expect(requireAuth(makeReq())).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 when cookie token invalid', async () => {
    await expect(requireAuth(makeReq('arc_session=not.a.real.jwt'))).rejects.toMatchObject({ status: 401 })
  })
})
```

- [ ] **Step 2: 跑测试 FAIL**

```bash
pnpm test lib/auth/session.test.ts --run
```

Expected: 失败。

- [ ] **Step 3: 实现 session cookie 工具**

`lib/auth/session.ts`:
```ts
import { COOKIE_NAME, COOKIE_MAX_AGE_SEC } from '@/lib/constants'

export function buildSessionCookie(jwt: string): string {
  const isProd = process.env.NODE_ENV === 'production'
  return [
    `${COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    isProd ? 'Secure' : '',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
    'Path=/',
  ].filter(Boolean).join('; ')
}

export function buildLogoutCookie(): string {
  const isProd = process.env.NODE_ENV === 'production'
  return [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    isProd ? 'Secure' : '',
    'SameSite=Lax',
    'Max-Age=0',
    'Path=/',
  ].filter(Boolean).join('; ')
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const m = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${COOKIE_NAME}=`))
  return m?.slice(COOKIE_NAME.length + 1) || null
}
```

- [ ] **Step 4: 实现 requireAuth**

`lib/auth/middleware.ts`:
```ts
import type { Address } from 'viem'
import { verifySessionJwt } from './jwt'
import { parseSessionCookie } from './session'

export interface AuthContext {
  userId: Address
  address: Address
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const jwt = parseSessionCookie(req.headers.get('cookie'))
  if (!jwt) throw new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  try {
    const { sub } = await verifySessionJwt(jwt)
    return { userId: sub as Address, address: sub as Address }
  } catch {
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }
}
```

- [ ] **Step 5: 跑测试 PASS**

```bash
pnpm test lib/auth/session.test.ts --run
```

Expected: 3 PASS。

- [ ] **Step 6: 跑所有 unit 测试**

```bash
pnpm test --run
```

Expected: 全部 PASS（jwt + nonce + rate-limit + siwe + session = 16 tests）。

- [ ] **Step 7: Commit**

```bash
git add lib/auth/session.ts lib/auth/middleware.ts lib/auth/session.test.ts
git commit -m "feat(auth): session cookie helpers + requireAuth middleware"
```

---

## Phase C · API Routes（2 tasks）

### Task 8: /api/auth/nonce + /api/auth/session + /api/auth/logout（3 个简单路由）

**Files:**
- Create: `app/api/auth/nonce/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Test: `app/api/auth/nonce.test.ts`
- Test: `app/api/auth/session.test.ts`

**Why:** 3 个低复杂度路由先打通；为前端 hook 提供 stub。

- [ ] **Step 1: 写 nonce 路由测试**

`app/api/auth/nonce.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'

const mockKv = new MockKv()
vi.mock('@/lib/kv', () => ({ kv: mockKv }))

beforeEach(() => mockKv._clear())

describe('GET /api/auth/nonce', () => {
  it('returns a 16-char nonce', async () => {
    const { GET } = await import('./nonce/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.nonce).toMatch(/^[A-Za-z0-9]{16}$/)
  })
})
```

- [ ] **Step 2: 跑测试 FAIL**

```bash
pnpm test app/api/auth/nonce.test.ts --run
```

Expected: 失败。

- [ ] **Step 3: 实现 nonce 路由**

`app/api/auth/nonce/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { kv } from '@/lib/kv'
import { createNonce } from '@/lib/auth/nonce-store'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { RATE_LIMIT_NONCE } from '@/lib/constants'

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const ok = await checkRateLimit(kv, ip, 'nonce', RATE_LIMIT_NONCE.max, RATE_LIMIT_NONCE.windowSec)
  if (!ok) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })

  const nonce = await createNonce(kv)
  return NextResponse.json({ nonce, issuedAt: new Date().toISOString() })
}
```

注：测试不传 req 也能跑通 GET()，但为完整性这里加 ip 提取。测试中 GET 调用需调整：

更新测试 Step 1 的 `await GET()` 为 `await GET(new Request('http://localhost/api/auth/nonce'))`。修正：

- [ ] **Step 3a: 修正 nonce 测试调用方式**

```ts
// nonce.test.ts 中替换：
const res = await GET(new Request('http://localhost/api/auth/nonce'))
```

- [ ] **Step 4: 跑测试 PASS**

```bash
pnpm test app/api/auth/nonce.test.ts --run
```

Expected: PASS。

- [ ] **Step 5: 实现 logout 路由（极简，无测试）**

`app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { buildLogoutCookie } from '@/lib/auth/session'

export async function POST() {
  return NextResponse.json({ ok: true }, {
    headers: { 'Set-Cookie': buildLogoutCookie() },
  })
}
```

- [ ] **Step 6: 写 session 路由测试**

`app/api/auth/session.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

describe('GET /api/auth/session', () => {
  it('returns user when cookie valid', async () => {
    const token = await signSessionJwt('0xAbC')
    const { GET } = await import('./session/route')
    const res = await GET(new Request('http://localhost/api/auth/session', {
      headers: { cookie: `arc_session=${token}` },
    }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.user.address).toBe('0xabc')
  })

  it('returns null user when no cookie', async () => {
    const { GET } = await import('./session/route')
    const res = await GET(new Request('http://localhost/api/auth/session'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.user).toBeNull()
  })
})
```

- [ ] **Step 7: 跑测试 FAIL**

```bash
pnpm test app/api/auth/session.test.ts --run
```

Expected: 失败。

- [ ] **Step 8: 实现 session 路由**

`app/api/auth/session/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { verifySessionJwt } from '@/lib/auth/jwt'
import { parseSessionCookie } from '@/lib/auth/session'

export async function GET(req: Request) {
  const jwt = parseSessionCookie(req.headers.get('cookie'))
  if (!jwt) return NextResponse.json({ user: null })
  try {
    const { sub } = await verifySessionJwt(jwt)
    return NextResponse.json({ user: { address: sub } })
  } catch {
    return NextResponse.json({ user: null })
  }
}
```

- [ ] **Step 9: 跑测试 PASS**

```bash
pnpm test app/api/auth/session.test.ts --run
```

Expected: 2 PASS。

- [ ] **Step 10: Commit**

```bash
git add app/api/auth/nonce app/api/auth/logout app/api/auth/session \
  app/api/auth/nonce.test.ts app/api/auth/session.test.ts
git commit -m "feat(api): /api/auth/{nonce,session,logout} routes"
```

---

### Task 9: /api/auth/verify（核心路由）+ 全局 middleware.ts

**Files:**
- Create: `app/api/auth/verify/route.ts`
- Create: `middleware.ts`（项目根）
- Test: `app/api/auth/verify.test.ts`

**Why:** SIWE 验签 → DB upsert → 发 cookie 的完整链路；全局 middleware 守护受保护路由。

- [ ] **Step 1: 写 verify 路由测试**

`app/api/auth/verify.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { testAccount, signTestMessage } from '@/test/fixtures/test-wallet'
import { buildSiweMessage } from '@/test/fixtures/valid-siwe-message'
import { createNonce } from '@/lib/auth/nonce-store'

const mockKv = new MockKv()
vi.mock('@/lib/kv', () => ({ kv: mockKv }))

// mock DB: 仅校验调用，不真插
const upsertSpy = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: () => { upsertSpy(v); return Promise.resolve() },
      }),
    }),
  },
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '9999'
})

beforeEach(() => { mockKv._clear(); upsertSpy.mockClear() })

async function postVerify(body: object): Promise<Response> {
  const { POST } = await import('./verify/route')
  return POST(new Request('http://localhost:3000/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function buildValidBody() {
  const nonce = await createNonce(mockKv)
  const message = buildSiweMessage({
    domain: 'localhost:3000', address: testAccount.address,
    uri: 'http://localhost:3000', chainId: 9999, nonce,
  })
  const signature = await signTestMessage(message)
  return { message, signature, address: testAccount.address }
}

describe('POST /api/auth/verify', () => {
  it('returns 200 + Set-Cookie + user on valid signature', async () => {
    const res = await postVerify(await buildValidBody())
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('arc_session=')
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 401 on tampered message', async () => {
    const body = await buildValidBody()
    body.message = body.message.replace('Sign in to', 'Drain wallet:')
    const res = await postVerify(body)
    expect(res.status).toBe(401)
  })

  it('returns 401 when nonce already consumed', async () => {
    const body = await buildValidBody()
    expect((await postVerify(body)).status).toBe(200)
    expect((await postVerify(body)).status).toBe(401)
  })

  it('returns 400 on malformed body', async () => {
    const res = await postVerify({ message: 'x' })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试 FAIL**

```bash
pnpm test app/api/auth/verify.test.ts --run
```

Expected: 失败。

- [ ] **Step 3: 实现 verify 路由**

`app/api/auth/verify/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema/users'
import { kv } from '@/lib/kv'
import { verifySiweLogin } from '@/lib/auth/siwe'
import { signSessionJwt } from '@/lib/auth/jwt'
import { buildSessionCookie } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { RATE_LIMIT_VERIFY } from '@/lib/constants'

const BodySchema = z.object({
  message:   z.string().min(20),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  address:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

export async function POST(req: Request) {
  // rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const allowed = await checkRateLimit(kv, ip, 'verify', RATE_LIMIT_VERIFY.max, RATE_LIMIT_VERIFY.windowSec)
  if (!allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })

  // parse body
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 }) }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  // SIWE verify
  const result = await verifySiweLogin(kv, {
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
    address: parsed.data.address,
  })
  if (!result.ok) return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })

  // upsert user
  await db.insert(users)
    .values({ address: result.address })
    .onConflictDoUpdate({ target: users.address, set: { lastLoginAt: new Date() } })

  // sign JWT + set cookie
  const jwt = await signSessionJwt(result.address)
  return NextResponse.json(
    { user: { address: result.address } },
    { headers: { 'Set-Cookie': buildSessionCookie(jwt) } },
  )
}
```

- [ ] **Step 4: 跑测试 PASS**

```bash
pnpm test app/api/auth/verify.test.ts --run
```

Expected: 4 PASS。

- [ ] **Step 5: 创建全局 middleware**

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_NAME } from '@/lib/constants'

export const config = {
  matcher: ['/dashboard/:path*', '/research/:path*'],
}

export function middleware(req: NextRequest) {
  const jwt = req.cookies.get(COOKIE_NAME)?.value
  if (!jwt) {
    const url = new URL('/login', req.url)
    url.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}
```

- [ ] **Step 6: 全套测试再跑一遍**

```bash
pnpm test --run
```

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/verify middleware.ts app/api/auth/verify.test.ts
git commit -m "feat(api): /api/auth/verify + global route guard middleware"
```

---

## Phase D · Frontend（3 tasks）

### Task 10: wagmi config + Providers + 注入 layout

**Files:**
- Create: `lib/wagmi.ts`
- Create: `providers/Providers.tsx`
- Modify: `app/layout.tsx`（包裹 `<Providers>`）

**Why:** 前端钱包栈必须先就绪，hooks 和 components 才能动。

- [ ] **Step 1: 创建 wagmi config**

`lib/wagmi.ts`:
```ts
import { defineChain } from 'viem'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { ARC_CHAIN_ID, ARC_RPC_URL } from './constants'

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? '',
    },
  },
  testnet: true,
})

export const wagmiConfig = getDefaultConfig({
  appName: 'Arc Lepton',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [arcTestnet],
  ssr: true,
})
```

- [ ] **Step 2: 创建 Providers**

`providers/Providers.tsx`:
```tsx
'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { wagmiConfig } from '@/lib/wagmi'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

- [ ] **Step 3: 修改 layout 包裹 Providers**

`app/layout.tsx`（在 `<body>` 内包 `<Providers>`）:
```tsx
import './globals.css'
import type { Metadata } from 'next'
import { Providers } from '@/providers/Providers'

export const metadata: Metadata = {
  title: 'Arc Lepton',
  description: 'AI 交易研究员 · 让 Agent 在 USDC 预算内自主研究',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: 验证 dev 启动**

```bash
pnpm dev
# 访问 http://localhost:3000 应仍然看到 placeholder，无 console 报错
```

- [ ] **Step 5: typecheck + build**

```bash
pnpm typecheck && pnpm build
```

Expected: 无错。

- [ ] **Step 6: Commit**

```bash
git add lib/wagmi.ts providers/Providers.tsx app/layout.tsx
git commit -m "feat(web): wagmi + RainbowKit + react-query providers"
```

---

### Task 11: useUser + useSiweLogin hooks

**Files:**
- Create: `hooks/useUser.ts`
- Create: `hooks/useSiweLogin.ts`

**Why:** 把"读 session"和"触发登录"的复杂度封进 hook；组件层只调一个函数。

- [ ] **Step 1: 实现 useUser hook**

`hooks/useUser.ts`:
```ts
'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

type SessionResponse = { user: { address: string } | null }

const SESSION_QUERY_KEY = ['auth', 'session'] as const

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch('/api/auth/session', { credentials: 'include' })
  if (!res.ok) return { user: null }
  return res.json()
}

export function useUser() {
  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
  })
  return {
    address: data?.user?.address ?? null,
    isAuthed: !!data?.user,
    isLoading,
  }
}

export function useInvalidateSession() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
}
```

- [ ] **Step 2: 实现 useSiweLogin hook**

`hooks/useSiweLogin.ts`:
```ts
'use client'

import { useState, useCallback } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { useInvalidateSession } from './useUser'
import { APP_URL, APP_HOST, ARC_CHAIN_ID } from '@/lib/constants'

export function useSiweLogin() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const invalidate = useInvalidateSession()
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const login = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected')
    setError(null); setLoading(true)
    try {
      // 1. nonce
      const nonceRes = await fetch('/api/auth/nonce')
      if (!nonceRes.ok) throw new Error('Failed to fetch nonce')
      const { nonce } = await nonceRes.json()

      // 2. message
      const issuedAt = new Date().toISOString()
      const message = [
        `${APP_HOST} wants you to sign in with your Ethereum account:`,
        address,
        '',
        'Sign in to Arc Lepton.',
        '',
        `URI: ${APP_URL}`,
        `Version: 1`,
        `Chain ID: ${ARC_CHAIN_ID}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n')

      // 3. sign
      const signature = await signMessageAsync({ message })

      // 4. verify
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature, address }),
      })
      if (!verifyRes.ok) throw new Error('Login failed')

      await invalidate()
    } catch (e) {
      setError(e as Error)
      throw e
    } finally {
      setLoading(false)
    }
  }, [address, signMessageAsync, invalidate])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    await disconnectAsync()
    await invalidate()
  }, [disconnectAsync, invalidate])

  return { login, logout, isLoading, error }
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add hooks/useUser.ts hooks/useSiweLogin.ts
git commit -m "feat(web): useUser + useSiweLogin hooks"
```

---

### Task 12: ConnectWalletButton + NetworkGuard + AuthGate + /login 页面

**Files:**
- Create: `components/auth/ConnectWalletButton.tsx`
- Create: `components/auth/NetworkGuard.tsx`
- Create: `components/auth/AuthGate.tsx`
- Create: `app/(auth)/login/page.tsx`
- Modify: `app/page.tsx`（加 Header 演示）

**Why:** 设计 v1 中的可视化组件落地；用户能看到并实操登录。

> 注：组件视觉直接参照 `docs/plans/2026-06-23-auth-mockup-v1.html` 实现。完整 CSS 已在 mockup 里定稿，落地时用 Tailwind className 翻译。

- [ ] **Step 1: 实现 ConnectWalletButton（4 状态）**

`components/auth/ConnectWalletButton.tsx`:
```tsx
'use client'

import { useAccount, useChainId } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useUser } from '@/hooks/useUser'
import { useSiweLogin } from '@/hooks/useSiweLogin'
import { ARC_CHAIN_ID } from '@/lib/constants'
import { useEffect } from 'react'

export function ConnectWalletButton() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { isAuthed, address } = useUser()
  const { login, logout, isLoading } = useSiweLogin()

  // 连接钱包且网络正确但未登录 → 自动触发签名
  useEffect(() => {
    if (isConnected && chainId === ARC_CHAIN_ID && !isAuthed && !isLoading) {
      login().catch(() => { /* error handled by hook */ })
    }
  }, [isConnected, chainId, isAuthed, isLoading, login])

  return (
    <ConnectButton.Custom>
      {({ openConnectModal, mounted }) => {
        if (!mounted) return null

        if (!isConnected) {
          return (
            <button onClick={openConnectModal}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-arc text-white text-sm font-medium hover:bg-arc-hover transition">
              Connect Wallet
            </button>
          )
        }

        if (isLoading) {
          return (
            <button disabled
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-bg-elevated text-text-secondary border border-white/10 text-sm">
              <span className="w-3 h-3 border-2 border-white/20 border-t-current rounded-full animate-spin" />
              Waiting for signature…
            </button>
          )
        }

        if (chainId !== ARC_CHAIN_ID) {
          return (
            <button onClick={openConnectModal}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-danger/10 border border-danger/30 text-danger text-sm font-medium">
              Wrong Network ▾
            </button>
          )
        }

        if (isAuthed && address) {
          const short = `${address.slice(0, 6)}…${address.slice(-4)}`
          return (
            <button onClick={logout}
              className="inline-flex items-center gap-3 h-9 pl-3 pr-1 py-1 rounded-full bg-bg-elevated border border-white/10 text-sm">
              <span className="font-mono text-xs text-text-secondary">$0.000 USDC</span>
              <span className="inline-flex items-center gap-2 bg-bg-base px-3 py-1 rounded-full font-mono text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-live" style={{ boxShadow: '0 0 8px rgba(0,217,255,0.5)' }} />
                {short}
              </span>
            </button>
          )
        }

        return null
      }}
    </ConnectButton.Custom>
  )
}
```

- [ ] **Step 2: 实现 NetworkGuard**

`components/auth/NetworkGuard.tsx`:
```tsx
'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { arcTestnet } from '@/lib/wagmi'
import { ARC_CHAIN_ID } from '@/lib/constants'

export function NetworkGuard() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  if (!isConnected || chainId === ARC_CHAIN_ID) return null

  return (
    <div className="px-7 py-5">
      <div className="flex items-center gap-4 px-5 py-4 rounded-md border border-danger/30 bg-danger/5">
        <div className="w-9 h-9 rounded-md bg-danger/20 text-danger flex items-center justify-center">!</div>
        <div className="flex-1">
          <div className="font-medium text-sm">钱包当前不在 Arc Testnet</div>
          <div className="text-xs text-text-secondary mt-0.5">
            检测到 <span className="font-mono text-text-muted">chainId: {chainId}</span> · 切换网络后才能签名登录
          </div>
        </div>
        <button onClick={() => switchChain({ chainId: arcTestnet.id })}
          className="h-10 px-5 rounded-md bg-arc text-white text-sm font-medium hover:bg-arc-hover">
          Switch to Arc Testnet
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 实现 AuthGate**

`components/auth/AuthGate.tsx`:
```tsx
'use client'

import { useUser } from '@/hooks/useUser'
import { ConnectWalletButton } from './ConnectWalletButton'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthed, isLoading } = useUser()

  if (isLoading) return null
  if (isAuthed) return <>{children}</>

  return (
    <div className="flex justify-center p-12">
      <div className="text-center max-w-md w-full p-12 rounded-lg border border-dashed border-white/15 bg-bg-surface">
        <div className="w-14 h-14 mx-auto mb-5 rounded-md bg-bg-elevated border border-white/10 flex items-center justify-center text-text-secondary">🔒</div>
        <h3 className="text-xl font-semibold mb-2">登录后查看</h3>
        <p className="text-text-secondary mb-6">连接你的钱包以解锁研究历史、Agent 配置与 USDC 余额面板。</p>
        <div className="flex justify-center"><ConnectWalletButton /></div>
      </div>
    </div>
  )
}
```

> ⚠️ AuthGate 里用了 emoji 🔒 作为图标 — **如果项目最终决定零 emoji，替换为 SVG**（参考 mockup v1 中 gate-lock 的 SVG path）。

- [ ] **Step 4: 实现 /login 页面**

`app/(auth)/login/page.tsx`:
```tsx
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@/hooks/useUser'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'

export default function LoginPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { isAuthed, isLoading } = useUser()

  useEffect(() => {
    if (isAuthed) {
      const redirect = params.get('redirect') ?? '/dashboard'
      router.replace(redirect)
    }
  }, [isAuthed, router, params])

  return (
    <main className="min-h-screen flex items-center justify-center relative">
      <NetworkGuard />
      <div className="w-full max-w-md p-10 bg-bg-surface border border-white/10 rounded-lg shadow-2xl">
        <div className="text-xs uppercase tracking-widest text-arc mb-3 font-mono">— CONNECT TO START</div>
        <h2 className="text-3xl font-semibold leading-tight mb-3">
          给你的 Agent<br />一笔预算去做研究
        </h2>
        <p className="text-text-secondary mb-7">
          用钱包登录，Agent 即可在你设定的 USDC 预算内自主调用数据源、生成研究报告。
        </p>
        <div className="flex"><ConnectWalletButton /></div>
        <p className="text-xs text-text-muted text-center mt-5">
          We don't store your private key — only your public address.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: 改 app/page.tsx 加 Header 演示**

`app/page.tsx`:
```tsx
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'

export default function HomePage() {
  return (
    <>
      <header className="flex justify-between items-center px-7 py-4 border-b border-white/5">
        <div className="font-semibold">Arc Lepton</div>
        <ConnectWalletButton />
      </header>
      <NetworkGuard />
      <main className="p-12 text-center">
        <h1 className="text-2xl">Arc Lepton — placeholder</h1>
        <p className="text-text-secondary mt-4">
          访问 <a href="/login" className="text-arc underline">/login</a> 体验登录流程
        </p>
      </main>
    </>
  )
}
```

- [ ] **Step 6: typecheck + build**

```bash
pnpm typecheck && pnpm build
```

Expected: 无错（warning 关于 react-server 等可忽略）。

- [ ] **Step 7: 手动 smoke test**

```bash
pnpm dev
```

打开 `http://localhost:3000`：
- 点 Connect Wallet → 选 MetaMask → 切到 Arc Testnet（自动）→ 弹签名 → 顶部出现地址
- 点已连接按钮 → 应触发 logout（这里 v1 视觉给的是下拉，MVP 暂用直接退出）
- 访问 `/login` → 应展示登录卡片
- 已登录后访问 `/dashboard` → middleware 阻挡 → 回到 `/login?redirect=/dashboard`（注：`/dashboard` 还不存在会 404，但 redirect 逻辑可看）

- [ ] **Step 8: Commit**

```bash
git add components/auth app/\(auth\) app/page.tsx
git commit -m "feat(web): auth components + login page"
```

---

## Phase E · Wrap-up（1 task）

### Task 13: CI 配置 + 整体回归 + .env.example 校对

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `.env.example`（核对所有 key）
- Modify: `README.md`（如有，加 setup 说明；若无则创建）

**Why:** 让别人（评委、合作者）能 clone 后 5 分钟跑起来。

- [ ] **Step 1: 创建 CI workflow**

`.github/workflows/test.yml`:
```yaml
name: test
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      JWT_SECRET: ci-secret-ci-secret-ci-secret-ci-secret
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: 00000000000000000000000000000000
      NEXT_PUBLIC_ARC_CHAIN_ID: '9999'
      NEXT_PUBLIC_ARC_RPC_URL: https://example.com/rpc
      DATABASE_URL: postgres://stub
      KV_REST_API_URL: https://example.com
      KV_REST_API_TOKEN: stub
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test --run
      - run: pnpm build
```

- [ ] **Step 2: 校对 .env.example**

确认 `.env.example` 包含所有真实使用的 key（对照 `lib/constants.ts` + Providers + db/index.ts），缺则补。

- [ ] **Step 3: 创建/更新 README.md**

```md
# Arc Lepton

AI 交易研究员 — Lepton Hackathon 提交。

## 本地启动

1. 复制环境变量
   ```bash
   cp .env.example .env.local
   # 填入：JWT_SECRET (32字节)、WalletConnect projectId、Arc testnet RPC、Vercel Postgres + KV
   ```

2. 安装依赖 + 推 schema 到 DB
   ```bash
   pnpm install
   pnpm db:push
   ```

3. 起 dev server
   ```bash
   pnpm dev
   ```

4. 跑测试
   ```bash
   pnpm test
   ```

## 设计与计划

- 设计文档：`docs/plans/2026-06-23-auth-module-design.md`
- 视觉稿：`docs/plans/2026-06-23-auth-mockup-v1.html`（在浏览器打开）
- 实现计划：`docs/plans/2026-06-23-auth-module-plan.md`
```

- [ ] **Step 4: 跑全套回归**

```bash
pnpm typecheck && pnpm test --run && pnpm build
```

Expected: 三个全 PASS。

- [ ] **Step 5: Final commit**

```bash
git add .github/workflows/test.yml .env.example README.md
git commit -m "ci: GitHub Actions + README setup guide"
```

- [ ] **Step 6: 推到远程（如需）**

```bash
# 如果还没 add remote
git remote add origin <your-repo-url>
git push -u origin main
```

---

## 完成标准 / Acceptance

实现完成等价于：
1. 所有 13 个 Task 的所有 step ☑️
2. `pnpm typecheck && pnpm test --run && pnpm build` 通过
3. 浏览器内手动验证设计文档 §8 的 6 个 Gherkin 场景全部通过
4. GitHub Actions CI 绿色
5. 部署到 Vercel 后 `/login` 可访问且可完成登录（需要真实 Arc testnet 钱包 + Vercel Postgres + KV 已 provision）

---

## 自检（writing-plans Self-Review）

**1. Spec 覆盖**：
- 设计 §1 高层架构 → Task 1 + Task 10（Providers）覆盖
- 设计 §2 文件结构 → 所有 Task 的 Files 段落对齐
- 设计 §3 数据模型 → Task 2 完整实现
- 设计 §4 API 设计（4 端点 + middleware + 错误码）→ Task 7-9 覆盖
- 设计 §5 前端组件与流程 → Task 10-12 覆盖
- 设计 §6 安全与配置（环境变量、JWT、Cookie、SIWE 7 校验、速率限制、Arc 配置）→ Task 1 (.env.example) + Task 3 (constants) + Task 4 (JWT) + Task 5 (rate-limit) + Task 6 (SIWE) + Task 7 (cookie) + Task 10 (wagmi arcTestnet)
- 设计 §7 测试策略（unit + integration，无 E2E）→ Task 4-9 含 ~12 测试文件，符合
- 设计 §8 6 Gherkin 场景 → Acceptance 部分要求手动验证
- 设计 §10 未决事项 → README 提醒填 `.env.local`（Arc chainId / RPC / Explorer URL）

**2. Placeholder 扫描**：未发现 "TBD/TODO/fill in details/handle edge cases" 等模糊词。所有 code block 完整可粘贴。

**3. 类型一致性**：
- `MockKv` 接口与 `KvClient` 兼容 ✓
- `verifySiweLogin` 返回 `SiweResult` 在 Task 6 定义，Task 9 中使用 `result.ok / result.address` 一致 ✓
- `AuthContext` 在 Task 7 定义为 `{ userId, address }`，Task 9 未直接使用（不冲突）✓
- `requireAuth` throw `Response` 而非 `Error`，调用方在业务 API 不需 try-catch（Next.js 自动转 HTTP），但 Task 7 测试用 `rejects.toMatchObject({ status: 401 })` 验证 ✓

**4. 已知小瑕疵（接受）**：
- AuthGate 用 emoji 🔒，已在 Step 3 加注释提示替换
- 已连接钱包按钮点击直接 logout（v1 设计是先打开下拉菜单），MVP 简化处理，可在 v2 改
- USDC 余额显示固定 `$0.000 USDC`，留作"钱包模块"接入时填充

---
