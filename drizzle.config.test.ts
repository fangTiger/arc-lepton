import { afterEach, describe, expect, it, vi } from 'vitest'

describe('drizzle config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('includes every persisted research schema file', async () => {
    const config = (await import('./drizzle.config')).default

    expect(config.schema).toEqual(expect.arrayContaining([
      './lib/db/schema/research.ts',
      './lib/db/schema/research-follow-up.ts',
    ]))
  })

  it('includes the payment settlement schema for migrations', async () => {
    const config = (await import('./drizzle.config')).default

    expect(config.schema).toEqual(expect.arrayContaining([
      './lib/db/schema/payment-settlement.ts',
    ]))
  })

  it('includes escrow workflow and durable event schemas for expand migrations', async () => {
    const config = (await import('./drizzle.config')).default

    expect(config.schema).toEqual(expect.arrayContaining([
      './lib/db/schema/workflow-outbox.ts',
      './lib/db/schema/research-event.ts',
    ]))
  })

  it('includes the research quota schema for shadow quota migrations', async () => {
    const config = (await import('./drizzle.config')).default

    expect(config.schema).toEqual(expect.arrayContaining([
      './lib/db/schema/research-quota.ts',
    ]))
  })

  it('uses POSTGRES_URL when DATABASE_URL is not set', async () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('POSTGRES_URL', 'postgres://example.test/db')
    vi.resetModules()

    const config = (await import('./drizzle.config')).default

    expect(config.dbCredentials.url).toBe('postgres://example.test/db')
  })
})
