# Arc Lepton — 认证模块设计

| 项 | 值 |
|---|---|
| 状态 | 草案 v1（待用户审阅） |
| 日期 | 2026-06-23 |
| 范围 | 仅认证模块（钱包登录 + session） |
| 不在范围 | 邮箱登录、Circle Embedded Wallet（v2）；充值、Agent、研究、Uniswap 集成（独立模块） |
| 目标产品 | AI 交易研究员（Lepton Hackathon 提交） |
| 截止日期 | 2026-06-29（比赛结束） |

---

## 0. 上下文

### 0.1 产品定位（一段话）

**AI 交易研究员**：用户给 Agent 一个研究主题（如"PEPE 现在能不能进"），Agent 在用户预设预算内自主调用多个 x402 计费数据源（鲸鱼追踪、情绪指标、Twitter 信号等），每次调用支付亚分级 USDC，最终输出研究报告。用户可一键通过 Uniswap on Arc 执行交易。

**为什么这个产品适合 Lepton**：
- Agent 自主性 30%：Agent 自主决定调哪些数据源、各花多少
- 真实采用 30%：开发者本人即 day-1 用户，链上 tx 可验证
- Circle 工具使用 20%：x402 协议 + Nanopayment + App Kit Swap
- 创新 20%："Agent 自费做研究"+ Uniswap on Arc 闭环执行

### 0.2 本模块在产品中的位置

本设计是产品的**第一个落地模块**。所有后续业务模块（research、wallet、agent）都要通过本模块拿到鉴权用户 ID，因此认证设计的稳定性直接决定后续开发速度。

### 0.3 决策日志（关键裁决，按时间顺序）

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-06-23 | MVP 只做插件钱包登录，邮箱登录留 v2 | 8 天倒计时下收窄范围；保留 v2 扩展空间 |
| 2026-06-23 | 钱包入口用 RainbowKit + wagmi | 与开发者已有经验一致；多钱包支持（MetaMask/Rabby/WalletConnect 等） |
| 2026-06-23 | Session 用 SIWE + JWT HTTP-only cookie | 行业标准；无状态；Edge 友好 |
| 2026-06-23 | 后端用 Vercel Postgres + Drizzle | 研究历史需持久化跨设备 + 提供真实采用数据 |
| 2026-06-23 | Nonce 存 Vercel KV，TTL 5 分钟 | 原子操作、自动过期、零运维 |
| 2026-06-23 | JWT 有效期 7 天 | 演示期间避免频繁重登；速率限制相应放宽 |
| 2026-06-23 | 删除 `AuthProvider` interface 抽象（YAGNI） | MVP 只有一种钱包类型，加抽象层是过早优化 |
| 2026-06-23 | 网络仅 Arc Testnet（Arc mainnet 未发布） | SIWE message 中 chainId 写死 |
| 2026-06-23 | 项目结构：单 Next.js 14 App Router，不做 monorepo | hackathon 阶段单 app，monorepo 是过度工程 |

---

## 1. 高层架构（产品全景 + 认证模块定位）

```
                          ┌─────────────────────────────────────┐
                          │   用户浏览器（Next.js App Router）    │
                          │                                     │
                          │  ┌──────────────┐  ┌──────────────┐ │
                          │  │   首页 Hero   │  │ Dashboard    │ │
                          │  │  (营销模块)   │  │  (产品主界面) │ │
                          │  └──────────────┘  └──────────────┘ │
                          │         │                  │        │
                          │  ┌──────▼──────────────────▼─────┐  │
                          │  │   🔐 认证模块（本次设计）       │  │
                          │  │   - RainbowKit Connect Button │  │
                          │  │   - SIWE 签名流程              │  │
                          │  │   - useAuth() / useUser()     │  │
                          │  └───────────┬───────────────────┘  │
                          └──────────────┼──────────────────────┘
                                         │ JWT cookie
                                         ▼
                          ┌─────────────────────────────────────┐
                          │   Next.js API Routes (Edge/Node)    │
                          │                                     │
                          │  ┌──────────────────────────────┐   │
                          │  │ 🔐 /api/auth/* (本次设计)      │   │
                          │  │   nonce / verify / logout    │   │
                          │  └──────────────────────────────┘   │
                          │  ┌──────────────────────────────┐   │
                          │  │ /api/research/*  (v2)        │   │
                          │  │ /api/wallet/*    (v2)        │   │
                          │  │ /api/agent/*     (v2)        │   │
                          │  │   ↑ 全部走 requireAuth() 中间件 │   │
                          │  └──────────────────────────────┘   │
                          └──────────────┬──────────────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
                ▼                        ▼                        ▼
       ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
       │ Vercel       │         │  Arc Testnet │         │  外部服务     │
       │ Postgres     │         │  RPC         │         │  (v2)        │
       │              │         │              │         │              │
       │ 🔐 users     │         │ 🔐 验签       │         │ x402 数据源  │
       │ research(v2) │         │ USDC balance │         │ Uniswap      │
       │ tx_log(v2)   │         │ tx 提交       │         │ Nanopayment │
       └──────────────┘         └──────────────┘         └──────────────┘

  🔐 = 本次设计范围内的组件
```

### 1.1 模块划分原则

- **认证模块**只负责"who is this user"，不碰业务数据
- **业务模块**（research / wallet / agent）通过 `requireAuth()` 中间件拿到 `userId`，各自管自己的数据
- DB schema 按模块划分表，所有业务表用 `users.address` 做外键源

### 1.2 认证模块对外接口契约

后续模块依赖以下 3 个稳定接口（认证模块演进时这 3 个接口不允许破坏性变更）：

| 接口 | 类型 | 签名 |
|---|---|---|
| `useUser()` | 前端 hook | `() => { address: Address \| null, isAuthed: boolean, isLoading: boolean }` |
| `requireAuth(req)` | 服务端 fn | `(req: Request) => Promise<{ userId: Address, address: Address }>`，失败抛 401 |
| `users.address` | DB 字段 | `TEXT PRIMARY KEY`，小写 `0x...` 格式 |

---

## 2. 模块内部结构

### 2.1 文件结构

```
arc-lepton/
├── app/
│   ├── api/
│   │   └── auth/
│   │       ├── nonce/route.ts        ← GET 拿 nonce
│   │       ├── verify/route.ts       ← POST 验签 + 发 JWT
│   │       ├── logout/route.ts       ← POST 清 cookie
│   │       └── session/route.ts      ← GET 当前 session 状态
│   ├── (auth)/
│   │   └── login/page.tsx            ← 独立登录页（middleware 兜底跳转）
│   └── layout.tsx                    ← 注入 <Providers>
│
├── components/
│   └── auth/
│       ├── ConnectWalletButton.tsx   ← 顶部导航按钮
│       ├── NetworkGuard.tsx          ← 检测 chainId，引导切到 Arc
│       └── AuthGate.tsx              ← 组件级守卫（包裹需登录内容）
│
├── lib/
│   ├── auth/
│   │   ├── siwe.ts                   ← SIWE message 构造 + 验签（服务端）
│   │   ├── jwt.ts                    ← jose 签发/验证 JWT
│   │   ├── session.ts                ← cookie 读写封装
│   │   ├── middleware.ts             ← requireAuth() 服务端工具
│   │   ├── nonce-store.ts            ← KV nonce 暂存
│   │   └── rate-limit.ts             ← KV 速率限制
│   ├── wagmi.ts                      ← wagmi config（Arc testnet 链定义）
│   └── db/
│       └── schema/
│           ├── users.ts              ← Drizzle user 表定义
│           └── _future.md            ← v2 表结构草图（非编译，仅备忘）
│
├── hooks/
│   ├── useUser.ts                    ← 前端 session 状态
│   └── useSiweLogin.ts               ← 触发 SIWE 流程
│
├── providers/
│   └── Providers.tsx                 ← WagmiProvider + RainbowKitProvider + QueryClient
│
├── middleware.ts                     ← Next.js 全局中间件（路由守卫）
├── .env.example                      ← 环境变量模板（commit）
└── .env.local                        ← 实际值（gitignore）
```

### 2.2 内部依赖图

```
                         ┌─────────────────────┐
                         │  ConnectWalletBtn   │
                         │  (Header 里)         │
                         └──────────┬──────────┘
                                    │ onClick
                                    ▼
                         ┌─────────────────────┐
                         │  useSiweLogin()     │
                         │  hook               │
                         └──────────┬──────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
       ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
       │ RainbowKit   │   │ wagmi        │   │ /api/auth/   │
       │ openModal()  │   │ signMessage()│   │  nonce GET   │
       │              │   │              │   │  verify POST │
       └──────────────┘   └──────────────┘   └──────┬───────┘
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │  lib/auth/siwe   │
                                          │  + lib/auth/jwt  │
                                          │  + db/schema     │
                                          └──────────────────┘

  登录成功后：
                         ┌─────────────────────┐
                         │  useUser()  hook    │
                         │  全局可调用          │
                         └──────────┬──────────┘
                                    │
                                    ▼ fetch
                         ┌─────────────────────┐
                         │  /api/auth/session  │
                         │  (读 cookie → user) │
                         └─────────────────────┘
```

### 2.3 关键抽象（仅 2 个）

| 抽象 | 类型 | 职责 |
|---|---|---|
| `useSiweLogin()` | 前端 hook | 把"打开钱包 modal → 签消息 → POST verify"封成一行 `await login()` |
| `requireAuth(req)` | 服务端 fn | 业务 API 一行 `const { userId } = await requireAuth(req)` 拿鉴权用户，失败抛 401 |

> **不实现 `AuthProvider` 抽象层**：MVP 仅一种钱包类型（插件），加抽象是过早优化。v2 加 Circle Embedded Wallet 时再重构（成本可控）。

---

## 3. 数据模型

### 3.1 `users` 表（唯一持久化表）

```sql
CREATE TABLE users (
  address       TEXT        PRIMARY KEY,                  -- 钱包地址（小写，0x 开头）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),        -- 首次登录时间
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()         -- 最近一次登录时间
);
```

### 3.2 Drizzle schema 定义

```typescript
// lib/db/schema/users.ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  address:     text('address').primaryKey(),
  createdAt:   timestamp('created_at',   { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User    = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

### 3.3 写入时机

| 时机 | 操作 |
|---|---|
| `/api/auth/verify` 验签成功 | `INSERT ... ON CONFLICT (address) DO UPDATE SET last_login_at = NOW()`（Drizzle `onConflictDoUpdate`） |
| 登录后业务操作 | **不写** users 表 |

### 3.4 Nonce 临时存储

| 项 | 值 |
|---|---|
| 存储 | Vercel KV（Redis） |
| Key 格式 | `siwe:nonce:{nonce_value}` |
| Value | `{ createdAt: timestamp }` |
| TTL | 300 秒 |
| 消费时机 | 验签前 `GETDEL`（一次性，防重放） |

### 3.5 未来表（v2，仅占位文件）

`lib/db/schema/_future.md` 文件记录后续表结构草图（不进入 Drizzle 编译），所有表都用 `address` 做外键：
- `research(id, address, topic, report_md, total_spent, created_at)`
- `tx_log(id, address, tx_hash, amount, type, created_at)`
- `agent_config(address, default_budget, preferred_sources, ...)`

---

## 4. API 设计

### 4.1 端点总览

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| `GET`  | `/api/auth/nonce`   | 公开 | 拿 SIWE 用的随机 nonce |
| `POST` | `/api/auth/verify`  | 公开 | 提交签名 → 验签 → 下发 JWT cookie |
| `POST` | `/api/auth/logout`  | 公开 | 清 JWT cookie |
| `GET`  | `/api/auth/session` | 读 cookie | 拿当前登录用户信息 |

### 4.2 `GET /api/auth/nonce`

```
请求：无 body

响应 200：
{
  "nonce": "Zk9aXh3pQrL2mN8v",      // 16 字符 base58
  "issuedAt": "2026-06-23T12:00:00Z"
}
```

服务端流程：生成 nonce → `kv.set("siwe:nonce:" + nonce, { createdAt }, { ex: 300 })` → 返回。

### 4.3 `POST /api/auth/verify`

```
请求 body：
{
  "message":   "...",              // 完整 SIWE message 文本（EIP-4361）
  "signature": "0x...",            // 钱包签名
  "address":   "0xabc..."          // 用户地址
}

响应 200（成功）：
{
  "user": { "address": "0xabc...", "createdAt": "..." }
}
+ Set-Cookie: arc_session=<JWT>; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/

响应 401（任何校验失败）：
{ "error": "INVALID_SIGNATURE" }
```

服务端处理（伪代码）：
```
1. parse(message) → { address, nonce, chainId, domain, issuedAt, ... }
2. assert(address === body.address)              否则 401
3. assert(domain === 当前站点 host)               否则 401
4. assert(chainId === Arc testnet ID)             否则 401
5. assert(issuedAt 在 5 分钟内)                   否则 401
6. kv.getdel("siwe:nonce:" + nonce) 必须存在     否则 401
7. viem.verifyMessage({ address, message, signature })  失败 401
8. db.upsert(users, { address: lower, lastLoginAt: now })
9. JWT = jose.sign({ sub: address, iat, exp: +7d }, secret)
10. Set-Cookie + 返回 user
```

### 4.4 `POST /api/auth/logout`

```
请求：无 body
响应 200：{ "ok": true }
+ Set-Cookie: arc_session=; Max-Age=0; HttpOnly; Path=/
```

无服务端状态清理（JWT 无状态）。

### 4.5 `GET /api/auth/session`

```
请求：无 body（携带 cookie）

响应 200（已登录）：
{ "user": { "address": "0x...", "createdAt": "..." } }

响应 200（未登录）：
{ "user": null }
```

未登录返 200 + null（不是 401），简化前端 hydrate 逻辑。

### 4.6 服务端 `requireAuth()` 工具

```typescript
// lib/auth/middleware.ts
export async function requireAuth(req: Request): Promise<AuthContext> {
  const cookie = req.headers.get('cookie')
  const jwt    = parseCookie(cookie, 'arc_session')
  if (!jwt) throw new Response('Unauthorized', { status: 401 })

  const { payload } = await jose.jwtVerify(jwt, getSecret())
  return {
    userId:  payload.sub as Address,
    address: payload.sub as Address,
  }
}

// 用法（v2 业务 API）：
export async function POST(req: Request) {
  const { address } = await requireAuth(req)   // 失败自动抛 401
  // ... 业务逻辑
}
```

### 4.7 全局 Next.js middleware

```typescript
// middleware.ts
export const config = {
  matcher: ['/dashboard/:path*', '/research/:path*'],
}

export function middleware(req: NextRequest) {
  const jwt = req.cookies.get('arc_session')?.value
  if (!jwt) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('redirect', req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}
```

middleware **只检查 cookie 存在性**（不验签），避免在 Edge runtime 引入重型加密库。真正验签在 API 层。

### 4.8 错误码统一表

| 场景 | HTTP | code |
|---|---|---|
| 任何签名/nonce/domain/chainId 校验失败 | 401 | `INVALID_SIGNATURE`（统一，不泄露细节） |
| JWT 缺失/过期/无效 | 401 | `UNAUTHORIZED` |
| 请求体格式错 | 400 | `BAD_REQUEST` |
| DB 写入失败 | 500 | `INTERNAL_ERROR` |

---

## 5. 前端组件与流程

### 5.1 组件职责矩阵

| 组件 / Hook | 类型 | 唯一职责 |
|---|---|---|
| `Providers` | 顶层组件 | 注入 WagmiProvider + RainbowKitProvider + QueryClientProvider |
| `ConnectWalletButton` | UI 组件 | 显示"Connect Wallet"或"0xAbc...123 ▾"；触发 modal 或 logout |
| `NetworkGuard` | 守卫组件 | `chainId !== ARC_TESTNET_ID` 时显示"切换网络"按钮 |
| `AuthGate` | 守卫组件 | 包裹需登录子树；未登录显示占位 |
| `useUser()` | Hook | 全局读取 `{ address, isAuthed, isLoading }` |
| `useSiweLogin()` | Hook | 暴露 `login()` / `logout()`，封装完整 SIWE 流程 |

### 5.2 用户视角完整流程

```
1. 用户访问任意页面
   middleware.ts 检查 cookie
      ├─ 有 cookie & 不是 /login → 直接渲染
      └─ 无 cookie & 路径在 matcher 内 → redirect /login?redirect=X

2. /login 页面 → 点 "Connect Wallet"
   ConnectWalletButton → RainbowKit openConnectModal()

3. RainbowKit 弹窗 → 选 MetaMask / Rabby / WalletConnect
   钱包插件唤起 → 用户授权 → wagmi useAccount() 返回 address

4. NetworkGuard 检查链
      chainId === Arc testnet ?
      ├─ 是 → 继续 step 5
      └─ 否 → 显示 "Switch to Arc Testnet" 按钮
          点击 → wagmi useSwitchChain()
          如未配置 → 自动 addEthereumChain 推送 RPC

5. useSiweLogin 触发 login()：
      a. GET /api/auth/nonce
      b. 构造 SIWE message（含 domain、nonce、chainId、address）
      c. wagmi signMessage() → 钱包弹窗确认
      d. POST /api/auth/verify { message, signature, address }
      e. 服务端验签成功 → Set-Cookie + 返回 user

6. useUser() refetch /api/auth/session → 拿到 user
   isAuthed = true → router.push(redirect || '/dashboard')

7. 导航栏显示 "0xAbc...123 ▾" + USDC 余额
   点击下拉 → "Disconnect"
   确认 → logout() → POST /api/auth/logout + wagmi disconnect
   → router.push('/')
```

### 5.3 边界 / 异常分支

| 场景 | 行为 |
|---|---|
| 用户在 RainbowKit modal 关闭 | 静默返回，不报错 |
| 用户在签名弹窗点拒绝 | toast "签名已取消"；按钮回到可点击状态 |
| 钱包不在 Arc testnet | NetworkGuard 拦截，签名流程不触发 |
| 钱包连接成功但 verify 返 401 | toast "登录失败，请重试"；**断开钱包**（防止用户误以为已登录） |
| Cookie 过期（7d 后） | 下次访问受保护页面 → middleware 重定向到 `/login?redirect=X` |
| 用户在另一 tab 切换钱包账号 | wagmi onAccountsChanged 监听 → **强制 logout + reload** |
| 用户在另一 tab 切换网络 | NetworkGuard re-render 显示切链提示；**不**强制 logout |
| wagmi 失去钱包连接（卸载/锁定） | useUser 检测 `!isConnected && isAuthed` → 静默 logout |

### 5.4 `useSiweLogin` Hook 接口

```typescript
export function useSiweLogin() {
  return {
    login:     () => Promise<void>,   // 成功 resolve，失败 reject
    logout:    () => Promise<void>,
    isLoading: boolean,
    error:     Error | null,
  }
}
```

### 5.5 `Providers` 组件

```tsx
// providers/Providers.tsx
export function Providers({ children }: PropsWithChildren) {
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

### 5.6 UI 元素位置

| 元素 | 位置 | 状态分支 |
|---|---|---|
| `ConnectWalletButton` | `<Header>` 右上 | 未登录：`Connect Wallet` / 已登录：`0xAbc...123 ▾` |
| 余额显示 | Button 内 | 已登录显示 `$X.XXX USDC`（MVP 可先固定 `—`，v2 接余额查询） |
| `NetworkGuard` 提示 | `<Header>` 下方 banner | 仅当 chainId 错时显示 |
| `/login` 页面 | 独立路由 | 居中卡片：Logo + 文案 + ConnectWalletButton |

---

## 6. 安全与配置

### 6.1 环境变量

| 变量 | 用途 | 来源 | 敏感 |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | SIWE domain 校验 | 部署时定 | ❌ |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | RainbowKit 必需 | cloud.walletconnect.com 注册 | ❌ |
| `NEXT_PUBLIC_ARC_CHAIN_ID` | Arc testnet chainId | 比赛文档 | ❌ |
| `NEXT_PUBLIC_ARC_RPC_URL` | Arc testnet RPC | Circle 提供 | ❌ |
| `JWT_SECRET` | JWT 签名密钥（≥ 32 字节） | `openssl rand -base64 32` | ✅ |
| `DATABASE_URL` | Postgres 连接串 | Vercel Postgres 自动注入 | ✅ |
| `KV_REST_API_URL` | Vercel KV REST endpoint | Vercel KV 自动注入 | ✅ |
| `KV_REST_API_TOKEN` | Vercel KV token | Vercel KV 自动注入 | ✅ |

`.env.example` 必须 commit（仅 key 名 + 占位）。

### 6.2 JWT 配置

| 项 | 值 |
|---|---|
| 算法 | `HS256` |
| 有效期 | 7 天（604800 秒） |
| Payload | `{ sub: address, iat, exp }` |
| 密钥长度 | ≥ 32 字节随机 base64 |
| 密钥轮换 | 不实现（v2） |

### 6.3 Cookie 配置

```
Set-Cookie: arc_session=<jwt>;
  HttpOnly;                  ← 阻止 JS 读取（防 XSS）
  Secure;                    ← 仅 HTTPS
  SameSite=Lax;              ← 防 CSRF；Lax 而非 Strict 以允许外链跳转
  Path=/;
  Max-Age=604800;            ← 7 天，与 JWT exp 一致
```

**不需要单独 CSRF token**：`SameSite=Lax` 已阻止跨站 POST 携带 cookie；nonce 一次性 + 5 分钟过期进一步阻断。

### 6.4 SIWE 服务端校验清单

`/api/auth/verify` 验签前必过 7 项（顺序：先廉价后昂贵）：

```
✓ 1. body.address.toLowerCase() === parsed.address.toLowerCase()
✓ 2. parsed.domain === new URL(NEXT_PUBLIC_APP_URL).host
✓ 3. parsed.uri === NEXT_PUBLIC_APP_URL
✓ 4. parsed.chainId === Number(NEXT_PUBLIC_ARC_CHAIN_ID)
✓ 5. parsed.version === '1'
✓ 6. Date.now() - parsed.issuedAt < 5 * 60 * 1000
✓ 7. KV GETDEL 拿到 nonce（不存在或已消费 → 401）
最后才 viem.verifyMessage()
```

### 6.5 速率限制（已放宽）

| 端点 | 限制 |
|---|---|
| `GET /api/auth/nonce` | 每 IP 120 次/分钟 |
| `POST /api/auth/verify` | 每 IP 30 次/分钟 |
| `POST /api/auth/logout` | 不限 |

实现：`lib/auth/rate-limit.ts`，业务调用 `await rateLimit(req, 'verify', 30, 60)`。Vercel KV `INCR + EXPIRE` 原子操作。

### 6.6 Arc Testnet wagmi 配置

```typescript
// lib/wagmi.ts
import { defineChain } from 'viem'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

export const arcTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },  // Arc 的 gas 即 USDC
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL!] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: '...' } },
  testnet: true,
})

export const wagmiConfig = getDefaultConfig({
  appName: 'Arc Lepton',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [arcTestnet],
  ssr: true,
})
```

### 6.7 安全审查清单（开发完跑一遍）

```
[ ] .env.local 不在 git（.gitignore 包含）
[ ] JWT_SECRET ≥ 32 字节随机
[ ] cookie 三个 flag 都开（HttpOnly + Secure + SameSite=Lax）
[ ] nonce TTL 设了（5 分钟）
[ ] nonce 验签后立刻 KV.del（一次性）
[ ] domain 校验严格匹配（不要 endsWith）
[ ] chainId 校验严格匹配
[ ] 错误统一返 INVALID_SIGNATURE，不泄漏失败原因
[ ] 速率限制在两个公开端点都接了
[ ] 钱包账号切换强制 logout（前端 onAccountsChanged）
[ ] 没有 console.log(jwt / signature / address) 进生产
[ ] Vercel 环境变量都填了（特别是 JWT_SECRET）
```

### 6.8 不防的攻击（明确接受）

| 攻击 | 不防理由 |
|---|---|
| 用户私钥被盗 | 链账户安全模型，超出认证范围 |
| 钱包插件被恶意替换 | 端点安全，超出范围 |
| Vercel 平台被入侵 | 平台信任 |
| DDoS 大流量 | Vercel 边缘有基础防护，hackathon 不额外做 |

---

## 7. 测试策略

### 7.1 测试金字塔

```
              ╱╲
             ╱  ╲   Integration (3 个：API 端点)
            ╱────╲
           ╱      ╲ Unit (~8 个：纯函数)
          ──────────
```

**不写 E2E**（hackathon 时间紧，手动测覆盖 happy path）。

### 7.2 Unit 测试（Vitest）

| 测试文件 | 测试对象 | 关键 case |
|---|---|---|
| `lib/auth/siwe.test.ts` | SIWE message 构造 + 解析 | 标准 message / 缺字段 / 错 chainId |
| `lib/auth/jwt.test.ts` | JWT 签发与验证 | 签发-验证往返 / 过期拒绝 / 错密钥拒绝 |
| `lib/auth/nonce-store.test.ts` | KV nonce 操作 | set-get-del / TTL 过期 / 重复消费拒绝 |
| `lib/auth/rate-limit.test.ts` | 速率限制 | 阈值内通过 / 超阈值拒绝 / 窗口滑动 |

**速度目标**：全部 unit < 2 秒。Mock Vercel KV 用 in-memory Map。

### 7.3 Integration 测试（API Route 级）

| 测试文件 | 流程 |
|---|---|
| `app/api/auth/nonce.test.ts` | GET 返 nonce + KV 写入 |
| `app/api/auth/verify.test.ts` | POST 正确签名 → 200 + Set-Cookie；篡改 message → 401；过期 nonce → 401 |
| `app/api/auth/session.test.ts` | 带 cookie → 200 + user；不带 cookie → 200 + null |

**钱包模拟**：viem `privateKeyToAccount` 创建测试账号，本地签 SIWE message。

### 7.4 测试 fixtures

```
test/fixtures/
├── valid-siwe-message.ts    ← 合法 SIWE message 模板
├── test-wallet.ts            ← 测试私钥 + 签名工具
└── mock-kv.ts                ← in-memory KV，供 unit/integration 共用
```

### 7.5 不测的部分（明确放弃）

| 不测 | 理由 |
|---|---|
| RainbowKit modal UI | 第三方组件库 |
| wagmi hooks 内部 | 第三方库 |
| MetaMask 真实交互 | 手动测覆盖 |
| Vercel KV / Postgres 真实连接 | 用 mock |

### 7.6 CI 配置

```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test --run
      - run: pnpm build
```

---

## 8. 验收标准（Gherkin）

### Scenario: 首次用 MetaMask 登录

```gherkin
GIVEN 用户访问 /login 且未登录
WHEN 用户点击 Connect Wallet，选择 MetaMask，签署 SIWE 消息
THEN 服务端创建 users 记录（首次）
AND 服务端下发 arc_session cookie（HttpOnly, 7 天）
AND 前端跳转到 /dashboard
AND 顶部导航栏显示截断的钱包地址
```

### Scenario: 拒绝签名

```gherkin
GIVEN 用户已连接钱包但未登录
WHEN 用户在签名弹窗点击拒绝
THEN 前端显示 toast "签名已取消"
AND 不下发 cookie
AND 用户仍停留在 /login
```

### Scenario: 在错误网络上登录

```gherkin
GIVEN 用户连接的钱包当前链 ID 不是 Arc Testnet
WHEN 进入 SIWE 流程
THEN NetworkGuard 显示"切换到 Arc Testnet"按钮
AND 不触发 nonce / verify 请求
```

### Scenario: 已登录用户跨页面访问

```gherkin
GIVEN 用户持有有效 arc_session cookie
WHEN 访问 /dashboard
THEN 直接渲染，不触发任何 /api/auth 请求
```

### Scenario: 切换钱包账号

```gherkin
GIVEN 用户已登录地址 A
WHEN 用户在钱包中切换到地址 B
THEN 前端检测到 onAccountsChanged
AND 强制 logout + 刷新页面
AND 用户需用地址 B 重新签名登录
```

### Scenario: 会话过期

```gherkin
GIVEN 用户 7 天前登录的 cookie 已过期
WHEN 访问 /dashboard
THEN middleware 重定向到 /login?redirect=/dashboard
AND 重新登录成功后自动跳回 /dashboard
```

---

## 9. 明确排除项（Out of Scope）

以下功能**不在本模块 MVP 范围**，留 v2 / 独立模块：

| 排除项 | 留给 |
|---|---|
| 邮箱注册/登录 | v2 认证模块 |
| Circle Embedded Wallet 集成 | v2 认证模块 |
| 邮箱 dev 模式登录 | v2（开发期用 MetaMask 测试账号替代） |
| USDC 充值 / Onramp | 独立"钱包/计费模块" |
| Uniswap on Arc swap | 独立"交易模块" |
| 用户资料编辑（昵称、头像） | v2 |
| 多账号绑定（邮箱 ↔ 钱包） | v2 |
| 找回密码 | 不适用（钱包模型无密码） |
| 双因素认证 | v2 |
| 多设备 session 管理 | v2 |
| 滑动续期 / Refresh Token | v2 |
| JWT 密钥轮换 | v2 |
| E2E 测试 | hackathon 后补 |

---

## 10. 风险与未决事项

| 风险 | 影响 | 缓解 |
|---|---|---|
| Arc Testnet RPC 不稳定 | 钱包切链失败 | 在 wagmi config 配多个 fallback RPC（如 Circle 提供多个 endpoint） |
| RainbowKit 不识别 Arc Testnet 自定义链 | 钱包列表显示异常 | 实测 + 备选用 `wagmi/createConfig` 手写连接器 |
| Vercel KV 免费额度不足 | 速率限制失效 | hackathon 期间用量极小，远低于免费额度上限 |
| 评委用的钱包不支持 EIP-1193 标准 | 无法签名 | 限制：演示视频中明确推荐 MetaMask / Rabby |

**未决事项**（开发开始前需确认）：
- [ ] Arc Testnet 的实际 chainId 和 RPC URL（从比赛官方文档/Discord 拿）
- [ ] Arc Explorer 的 URL（区块浏览器链接）
- [ ] Arc Testnet faucet 地址（领测试 USDC）

---

## 11. 后续步骤

1. 用户审阅本设计文档 → 批准或修改
2. 批准后调用 `superpowers:writing-plans` 产出 bite-sized 实现计划
3. 计划批准后开始 TDD 实现
