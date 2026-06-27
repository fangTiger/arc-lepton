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

2. ARC receipt 配置
   - `ARC_RECEIPT_MODE=mock`：默认开发模式，不广播链上交易，但会记录 `mock` 状态。
   - `ARC_RECEIPT_MODE=arc`：服务端会发送一笔 0-value、带 JSON calldata 的 ARC receipt 交易，并等待 receipt。
   - `ARC_RECEIPT_MODE=arc` 下每次付费请求都必须显式提供幂等 key：优先 `Idempotency-Key`，其次 `X-Idempotency-Key`，也支持 `requestId` query 参数；幂等 key 必须为 1-128 个字符，且仅允许 `[A-Za-z0-9._:-]`；缺失或非法时请求会直接失败，不会广播。
   - 同一地址、同一支付 scope（`source + amount + researchId`）重复使用同一个幂等 key 时，系统会复用已有 receipt，不会再次广播或重复计费；当前业务响应保持可重放，handler 会重新执行，但不会持久化业务响应体。
   - `ARC_RECORDER_PRIVATE_KEY`：仅服务端使用，必须有 ARC 测试网 gas，绝不能放到 `NEXT_PUBLIC_*`。
   - `ARC_RECEIPT_TO_ADDRESS`：可选，默认向 recorder 自己发交易；如需固定审计地址可单独指定。
   - 未配置 `ARC_RECORDER_PRIVATE_KEY` 时不要切到 `arc` 模式；应用只支持 mock/测试路径，不会伪造 confirmed。

3. 安装依赖 + 推 schema 到 DB
   ```bash
   pnpm install
   pnpm db:push
   ```
   - 如果拉取了最新的 ARC receipt 幂等修复，请先执行一次 `pnpm db:push`：它会给 `tx_log` 增加可为空的 `request_id`，并把 `research_id` 与 `address + request_id` 唯一约束同步到 Postgres。
   - 如果拉取了 follow-up Q&A 功能，也需要执行 `pnpm db:push`，以创建 `research_follow_up` 表。
   - 新写入记录会由应用自动填充 `request_id`；历史记录的 `request_id` 可以为空，且不会参与幂等复用。

4. 起 dev server
   ```bash
   pnpm dev
   ```

5. 跑测试
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
