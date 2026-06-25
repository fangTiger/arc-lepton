# SIGNAL/LEDGER

AI 交易研究终端 - Agent 在固定 USDC 预算内自主调用数据源并生成交易研究报告。

推荐 Vercel 项目 slug：`signal-ledger`，默认域名可使用 `https://signal-ledger.vercel.app/`（如果该 slug 未被占用）。

## 本地启动

1. 复制环境变量
   ```bash
   cp .env.example .env.local
   # 填入：JWT_SECRET (32字节)、WalletConnect projectId、Arc testnet RPC、Vercel Postgres、DeepSeek API
   # KV/Redis 可先留空，应用会临时使用内存 KV 兜底。
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

## CI / 验证

CI 使用 pnpm 10.14.0。pnpm 9 需要 `pnpm test -- --run` 或 `pnpm run test --run` 才能转发 Vitest 参数；pnpm 10 可直接执行：

```bash
pnpm typecheck && pnpm test --run && pnpm build
```

## 设计与计划

- 设计文档：`docs/plans/2026-06-23-auth-module-design.md`
- 视觉稿：`docs/plans/2026-06-23-auth-mockup-v1.html`（在浏览器打开）
- 实现计划：`docs/plans/2026-06-23-auth-module-plan.md`
