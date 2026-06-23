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

  _clear() {
    this.store.clear()
  }

  _now() {
    return Date.now()
  }
}
