import { afterEach, describe, expect, test } from 'bun:test'
import type { AlgorithmName } from '../../src/algorithms/algorithm'
import { RateLimiterConfigError } from '../../src/errors'
import { KeyBuilder } from '../../src/keys/key-builder'
import { type RateLimiterOptions, rateLimiterOptionsSchema } from '../../src/limiter/limiter-schema'
import { RateLimiter } from '../../src/limiter/rate-limiter'
import { MemoryStore } from '../../src/stores/memory-store'
import { RedisStore } from '../../src/stores/redis-store'
import type { RateLimitStore } from '../../src/stores/store'
import { FakeRedis } from '../helpers/fake-redis'
import { ManualClock } from '../helpers/manual-clock'

const ALGORITHMS: readonly AlgorithmName[] = ['fixed-window', 'sliding-window', 'token-bucket']

const STORES: readonly [string, () => RateLimitStore][] = [
  ['MemoryStore', () => new MemoryStore({ clock: new ManualClock() })],
  ['RedisStore', () => new RedisStore({ client: new FakeRedis() })],
]

const openLimiters: RateLimiter[] = []

const createLimiter = (options: Partial<RateLimiterOptions> = {}): RateLimiter => {
  const limiter = new RateLimiter({ limit: 3, window: '1m', clock: new ManualClock(), ...options })
  openLimiters.push(limiter)
  return limiter
}

const consumeTimes = (limiter: RateLimiter, identifier: string, times: number) =>
  Promise.all(Array.from({ length: times }, () => limiter.consume(identifier)))

const untypedOptions = (options: unknown) => options as RateLimiterOptions

class RecordingStore implements RateLimitStore {
  readonly closed: boolean[] = []
  private readonly inner = new MemoryStore({ clock: new ManualClock() })

  read(key: string): Promise<string | null> {
    return this.inner.read(key)
  }

  update: RateLimitStore['update'] = (key, mutation) => this.inner.update(key, mutation)

  delete(key: string): Promise<void> {
    return this.inner.delete(key)
  }

  async close(): Promise<void> {
    this.closed.push(true)
    await this.inner.close()
  }
}

afterEach(async () => {
  await Promise.all(openLimiters.splice(0).map((limiter) => limiter.close()))
})

describe('RateLimiter options', () => {
  test('applies defaults and exposes the policy', () => {
    const limiter = createLimiter({ limit: 10, window: '15m' })
    expect(limiter.limit).toBe(10)
    expect(limiter.windowMs).toBe(900_000)
    expect(limiter.algorithmName).toBe('sliding-window')
  })

  test('accepts a window in milliseconds', () => {
    expect(createLimiter({ window: 2_500 }).windowMs).toBe(2_500)
  })

  test('parses options into windowMs with defaults', () => {
    const settings = rateLimiterOptionsSchema.parse({ limit: 5, window: '30s' })
    expect(settings).toEqual({ limit: 5, windowMs: 30_000, algorithm: 'sliding-window', prefix: 'rate-limit' })
  })

  test.each<[string, Record<string, unknown>]>([
    ['limit', { window: '1m' }],
    ['limit', { limit: 0, window: '1m' }],
    ['limit', { limit: 1.5, window: '1m' }],
    ['limit', { limit: 1_000_000_001, window: '1m' }],
    ['limit', { limit: '10', window: '1m' }],
    ['window', { limit: 1 }],
    ['window', { limit: 1, window: '1 minute' }],
    ['window', { limit: 1, window: 0 }],
    ['window', { limit: 1, window: '31d' }],
    ['algorithm', { limit: 1, window: '1m', algorithm: 'leaky-bucket' }],
    ['prefix', { limit: 1, window: '1m', prefix: 'has space' }],
    ['prefix', { limit: 1, window: '1m', prefix: '' }],
    ['prefix', { limit: 1, window: '1m', prefix: 'a:b' }],
    ['store', { limit: 1, window: '1m', store: { update: () => undefined } }],
    ['clock', { limit: 1, window: '1m', clock: Date }],
    ['windowMs', { limit: 1, window: '1m', windowMs: 1_000 }],
  ])('rejects invalid %s with a message naming it', (field, options) => {
    const create = () => new RateLimiter(untypedOptions(options))
    expect(create).toThrow(RateLimiterConfigError)
    expect(create).toThrow(field)
  })

  test('rejects missing options from untyped callers', () => {
    expect(() => new RateLimiter(untypedOptions(undefined))).toThrow(RateLimiterConfigError)
  })
})

describe.each(ALGORITHMS)('RateLimiter with %s', (algorithm) => {
  test('allows up to the limit, then denies with a retry time', async () => {
    const limiter = createLimiter({ algorithm })
    const decisions = await consumeTimes(limiter, 'user', 4)
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false])
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0, 0])
    expect(decisions[3]?.retryAfterMs).toBeGreaterThan(0)
    expect(limiter.algorithmName).toBe(algorithm)
  })

  test('allows again after waiting retryAfterMs', async () => {
    const clock = new ManualClock(10_000)
    const limiter = createLimiter({ algorithm, clock })
    await consumeTimes(limiter, 'user', 3)
    const denied = await limiter.consume('user')
    clock.advance(denied.retryAfterMs)
    expect((await limiter.consume('user')).allowed).toBe(true)
  })

  test('counts each identifier separately', async () => {
    const limiter = createLimiter({ algorithm })
    await consumeTimes(limiter, 'alice', 3)
    expect((await limiter.consume('alice')).allowed).toBe(false)
    expect((await limiter.consume('bob')).allowed).toBe(true)
  })

  test('charges the given cost', async () => {
    const limiter = createLimiter({ algorithm })
    expect((await limiter.consume('user', 2)).remaining).toBe(1)
    expect((await limiter.consume('user', 2)).allowed).toBe(false)
    expect((await limiter.consume('user', 1)).allowed).toBe(true)
  })
})

describe('RateLimiter cost', () => {
  test.each([0, -1, 1.5, 4, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p with RangeError', async (cost) => {
    const limiter = createLimiter()
    await expect(limiter.consume('user', cost)).rejects.toThrow(RangeError)
    expect((await limiter.peek('user')).remaining).toBe(2)
  })

  test('accepts a cost equal to the limit', async () => {
    expect((await createLimiter().consume('user', 3)).allowed).toBe(true)
  })

  test('rejects a non-string identifier from untyped callers', async () => {
    const limiter = createLimiter()
    await expect(limiter.consume(42 as unknown as string)).rejects.toThrow(TypeError)
  })
})

describe('RateLimiter.peek', () => {
  test.each(ALGORITHMS)('reports the next decision without changing %s state', async (algorithm) => {
    const limiter = createLimiter({ algorithm })
    await limiter.consume('user')
    const peeked = await limiter.peek('user')
    expect(peeked).toEqual(await limiter.peek('user'))
    expect(peeked.allowed).toBe(true)
    expect((await limiter.consume('user')).remaining).toBe(1)
  })

  test('reports a denial once the limit is used up', async () => {
    const limiter = createLimiter()
    await consumeTimes(limiter, 'user', 3)
    expect((await limiter.peek('user')).allowed).toBe(false)
  })

  test('never creates a key for an unknown identifier', async () => {
    const store = new MemoryStore({ clock: new ManualClock() })
    const limiter = createLimiter({ store })
    expect((await limiter.peek('nobody')).remaining).toBe(2)
    expect(store.size).toBe(0)
    await store.close()
  })
})

describe('RateLimiter.reset', () => {
  test('clears one identifier and leaves others alone', async () => {
    const limiter = createLimiter()
    await consumeTimes(limiter, 'alice', 3)
    await consumeTimes(limiter, 'bob', 3)
    await limiter.reset('alice')
    expect((await limiter.consume('alice')).remaining).toBe(2)
    expect((await limiter.consume('bob')).allowed).toBe(false)
  })
})

describe('RateLimiter.close', () => {
  test('closes the memory store it created itself', async () => {
    const limiter = createLimiter()
    await limiter.consume('user')
    await limiter.close()
    expect((await limiter.peek('user')).remaining).toBe(2)
  })

  test('never closes a store the caller passed in', async () => {
    const store = new RecordingStore()
    const limiter = createLimiter({ store })
    await limiter.consume('user')
    await limiter.close()
    expect(store.closed).toEqual([])
    expect((await limiter.peek('user')).remaining).toBe(1)
    await store.close()
  })

  test('works with a store that has no close method', async () => {
    const memory = new MemoryStore({ clock: new ManualClock() })
    const store: RateLimitStore = {
      read: (key) => memory.read(key),
      update: (key, mutation) => memory.update(key, mutation),
      delete: (key) => memory.delete(key),
    }
    await createLimiter({ store }).close()
    await memory.close()
  })
})

describe('RateLimiter stored state', () => {
  const corruptValues: readonly [string, string][] = [
    ['invalid JSON', '{not json'],
    ['JSON null', 'null'],
    ['an array', '[]'],
    ['a string', '"count"'],
    ['missing fields', '{}'],
    ['wrong field types', '{"windowStart":"0","count":"0","current":"0","previous":"0","tokens":"3","updatedAt":"0"}'],
    ['negative counts', '{"windowStart":0,"count":-100,"current":-100,"previous":-100,"tokens":-100,"updatedAt":0}'],
  ]

  describe.each(STORES)('in %s', (_, createStore) => {
    describe.each(ALGORITHMS)('for %s', (algorithm) => {
      test.each(corruptValues)('treats %s as empty state and still enforces the limit', async (_, value) => {
        const store = createStore()
        const limiter = createLimiter({ algorithm, store })
        const key = new KeyBuilder('rate-limit', algorithm).build('user')
        await store.update(key, () => ({ value, ttlMs: 60_000, result: undefined }))
        expect((await limiter.peek('user')).remaining).toBe(2)
        const decisions = await consumeTimes(limiter, 'user', 4)
        expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false])
        await store.close?.()
      })
    })
  })

  test('uses the prefix in stored keys', async () => {
    const store = new MemoryStore({ clock: new ManualClock() })
    const limiter = createLimiter({ store, prefix: 'login' })
    await limiter.consume('user')
    expect(await store.read(new KeyBuilder('login', 'sliding-window').build('user'))).not.toBeNull()
    await store.close()
  })
})

describe('RateLimiter concurrency', () => {
  describe.each(STORES)('with %s', (_, createStore) => {
    test.each(ALGORITHMS)('allows exactly the limit for 200 parallel %s calls', async (algorithm) => {
      const store = createStore()
      const limiter = createLimiter({ algorithm, store, limit: 50 })
      const decisions = await consumeTimes(limiter, 'user', 200)
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(50)
      await store.close?.()
    })
  })

  test.each(ALGORITHMS)('two %s instances sharing one Redis retry conflicts and allow exactly the limit', async (algorithm) => {
    const redis = new FakeRedis()
    const createShared = () => createLimiter({ algorithm, limit: 50, store: new RedisStore({ client: redis }) })
    const [first, second] = [createShared(), createShared()]
    const calls = Array.from({ length: 200 }, (_, index) => (index % 2 === 0 ? first : second).consume('user'))
    const decisions = await Promise.all(calls)
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(50)
    expect(redis.commands.filter((command) => command.startsWith('EVAL')).length).toBeGreaterThan(200)
  })
})
