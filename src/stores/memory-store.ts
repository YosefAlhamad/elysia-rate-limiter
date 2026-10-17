import { z } from 'zod'
import { type Clock, SystemClock, isClock } from '../core/clock'
import { RateLimiterConfigError } from '../errors'
import { type RateLimitStore, type StoreMutation, type StoreWrite, normalizeTtlMs } from './store'

export interface MemoryStoreOptions {
  readonly maxKeys?: number
  readonly sweepIntervalMs?: number
  readonly clock?: Clock
}

interface MemoryEntry {
  readonly value: string
  readonly expiresAt: number
}

const memoryStoreOptionsSchema = z.strictObject({
  maxKeys: z.number().int().positive().max(100_000_000).default(100_000),
  sweepIntervalMs: z.number().int().positive().max(86_400_000).default(60_000),
  clock: z.custom<Clock>(isClock, 'Expected an object with a now() method').optional(),
})

export class MemoryStore implements RateLimitStore {
  private readonly entries = new Map<string, MemoryEntry>()
  private readonly maxKeys: number
  private readonly clock: Clock
  private readonly sweepTimer: ReturnType<typeof setInterval>

  constructor(options: MemoryStoreOptions = {}) {
    const result = memoryStoreOptionsSchema.safeParse(options)
    if (!result.success) throw new RateLimiterConfigError(result.error)
    this.maxKeys = result.data.maxKeys
    this.clock = result.data.clock ?? new SystemClock()
    this.sweepTimer = setInterval(() => this.sweep(), result.data.sweepIntervalMs)
    this.sweepTimer.unref()
  }

  get size(): number {
    return this.entries.size
  }

  async update<TResult>(key: string, mutation: StoreMutation<TResult>): Promise<TResult> {
    const write = mutation(this.read(key))
    this.write(key, write)
    return write.result
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer)
    this.entries.clear()
  }

  private read(key: string): string | null {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (this.isExpired(entry, this.clock.now())) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  private write<TResult>(key: string, write: StoreWrite<TResult>): void {
    const expiresAt = this.clock.now() + normalizeTtlMs(write.ttlMs)
    this.entries.delete(key)
    this.entries.set(key, { value: write.value, expiresAt })
    this.evictOverflow()
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) return
      this.entries.delete(oldest.value)
    }
  }

  private sweep(): void {
    const now = this.clock.now()
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(key)
    }
  }

  private isExpired(entry: MemoryEntry, now: number): boolean {
    return entry.expiresAt <= now
  }
}
