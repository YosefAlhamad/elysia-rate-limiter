import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { RateLimiterConfigError, StoreConflictError } from '../../src/errors'
import { KeyBuilder } from '../../src/keys/key-builder'
import { RateLimitHeaders } from '../../src/plugin/rate-limit-headers'
import type { RateLimitPluginOptions, RateLimitRequestContext } from '../../src/plugin/plugin-schema'
import { type RateLimitOutcome, rateLimit } from '../../src/plugin/rate-limit-plugin'
import { RedisStore } from '../../src/stores/redis-store'
import type { RateLimitStore } from '../../src/stores/store'
import { FakeRedis } from '../helpers/fake-redis'
import { ManualClock } from '../helpers/manual-clock'

const SECRET = 'redis://admin:hunter2@internal-host:6379'

const createApp = (options: Partial<RateLimitPluginOptions> = {}) =>
  new Elysia()
    .use(rateLimit({ limit: 2, window: '1m', clock: new ManualClock(), ...options }))
    .get('/', ({ rateLimit: outcome }) => ({ status: outcome.status }))

const request = (path = '/', headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers })

const forwardedFor = (value: string) => request('/', { 'x-forwarded-for': value })

const sendTimes = async (app: { handle(request: Request): Promise<Response> }, times: number, make = () => request()) => {
  const responses: Response[] = []
  for (let index = 0; index < times; index += 1) responses.push(await app.handle(make()))
  return responses
}

const statuses = (responses: readonly Response[]) => responses.map((response) => response.status)

const failingStore = (error: unknown): RateLimitStore => {
  const fail = async (): Promise<never> => {
    throw error
  }
  return { read: fail, update: fail, delete: fail }
}

const conflictingRedisStore = (): RedisStore => {
  const redis = new FakeRedis()
  const key = new KeyBuilder('rate-limit', 'sliding-window').build('unknown-client')
  let writes = 0
  redis.onBeforeScript(() => {
    writes += 1
    redis.set(key, `other-writer-${writes}`, 60_000)
  })
  return new RedisStore({ client: redis, maxAttempts: 2 })
}

const STACK_FRAME = /\bat .+:\d+:\d+/

const expectNoLeaks = (body: string | undefined) => {
  expect(body).toBeString()
  expect(body).not.toMatch(STACK_FRAME)
  expect(body).not.toMatch(/[0-9a-f]{64}/)
  expect(body).not.toContain('hunter2')
  expect(body).not.toContain('internal-host')
  expect(body).not.toContain('stack')
  expect(body).not.toContain('other-writer')
}

describe('rateLimit options', () => {
  test.each<[string, Record<string, unknown>]>([
    ['limit', { window: '1m' }],
    ['window', { limit: 1, window: 'soon' }],
    ['key', { limit: 1, window: '1m', key: 'user-id' }],
    ['cost', { limit: 1, window: '1m', cost: 0 }],
    ['cost', { limit: 1, window: '1m', cost: 2 }],
    ['cost', { limit: 1, window: '1m', cost: 'one' }],
    ['skip', { limit: 1, window: '1m', skip: true }],
    ['trustProxy', { limit: 1, window: '1m', trustProxy: 0 }],
    ['trustProxy', { limit: 1, window: '1m', trustProxy: 33 }],
    ['ipv6Subnet', { limit: 1, window: '1m', ipv6Subnet: 129 }],
    ['headers', { limit: 1, window: '1m', headers: 'yes' }],
    ['failureMode', { limit: 1, window: '1m', failureMode: 'ignore' }],
    ['onLimited', { limit: 1, window: '1m', onLimited: {} }],
    ['scope', { limit: 1, window: '1m', scope: 'route' }],
    ['trustproxy', { limit: 1, window: '1m', trustproxy: true }],
  ])('throws at setup for invalid %s', (field, options) => {
    const create = () => rateLimit(options as unknown as RateLimitPluginOptions)
    expect(create).toThrow(RateLimiterConfigError)
    expect(create).toThrow(field)
  })
})

describe('rateLimit responses', () => {
  test('allows up to the limit, then answers 429 with a JSON body', async () => {
    const responses = await sendTimes(createApp(), 3)
    expect(statuses(responses)).toEqual([200, 200, 429])
    expect(await responses[0]?.json()).toEqual({ status: 'allowed' })
    expect(await responses[2]?.json()).toEqual({ error: 'Too Many Requests', retryAfter: 90 })
  })

  test('sends RateLimit headers on allowed and limited responses', async () => {
    const clock = new ManualClock(15_000)
    const [first, , limited] = await sendTimes(createApp({ clock, algorithm: 'fixed-window' }), 3)
    expect(first?.headers.get('RateLimit-Limit')).toBe('2')
    expect(first?.headers.get('RateLimit-Remaining')).toBe('1')
    expect(first?.headers.get('RateLimit-Reset')).toBe('45')
    expect(first?.headers.get('RateLimit-Policy')).toBe('2;w=60')
    expect(first?.headers.has('Retry-After')).toBe(false)
    expect(limited?.headers.get('RateLimit-Remaining')).toBe('0')
    expect(limited?.headers.get('Retry-After')).toBe('45')
  })

  test('sends no headers when headers is false', async () => {
    const [response] = await sendTimes(createApp({ headers: false }), 1)
    expect(response?.headers.has('RateLimit-Limit')).toBe(false)
  })

  test('never leaks keys or store details in the 429 body', async () => {
    const [, , limited] = await sendTimes(createApp({ prefix: 'secret-prefix' }), 3)
    const body = await limited?.text()
    expect(body).not.toContain('secret-prefix')
    expect(body).not.toContain('unknown-client')
    expect(body).not.toContain(new KeyBuilder('secret-prefix', 'sliding-window').build('unknown-client'))
    expectNoLeaks(body)
  })

  test('a failing key function answers 500 without a stack trace or the identifier', async () => {
    const app = createApp({ key: () => ({ secret: SECRET }) as unknown as string })
    const [response] = await sendTimes(app, 1)
    expect(response?.status).toBe(500)
    expectNoLeaks(await response?.text())
  })
})

describe('rateLimit hooks', () => {
  test('skip lets requests through without counting them', async () => {
    const app = createApp({ skip: ({ path }) => path === '/health' }).get('/health', ({ rateLimit: outcome }) => outcome.status)
    const health = await sendTimes(app, 5, () => request('/health'))
    expect(statuses(health)).toEqual([200, 200, 200, 200, 200])
    expect(await health[0]?.text()).toBe('skipped')
    expect(health[0]?.headers.has('RateLimit-Limit')).toBe(false)
    expect(statuses(await sendTimes(app, 3))).toEqual([200, 200, 429])
  })

  test('a custom key counts each value separately', async () => {
    const app = createApp({ key: async ({ request: incoming }) => incoming.headers.get('x-api-key') ?? 'anonymous' })
    const alice = () => request('/', { 'x-api-key': 'alice' })
    expect(statuses(await sendTimes(app, 3, alice))).toEqual([200, 200, 429])
    expect(statuses(await sendTimes(app, 1, () => request('/', { 'x-api-key': 'bob' })))).toEqual([200])
  })

  test('a numeric cost charges each request', async () => {
    const app = createApp({ limit: 4, cost: 2 })
    expect(statuses(await sendTimes(app, 3))).toEqual([200, 200, 429])
  })

  test('a cost function can charge by route', async () => {
    const app = createApp({ limit: 4, cost: ({ path }) => (path === '/export' ? 4 : 1) }).get('/export', () => 'ok')
    expect(statuses(await sendTimes(app, 1))).toEqual([200])
    expect(statuses(await sendTimes(app, 1, () => request('/export')))).toEqual([429])
    expect(statuses(await sendTimes(app, 3))).toEqual([200, 200, 200])
  })

  test('onLimited replaces the 429 body', async () => {
    const seen: RateLimitRequestContext[] = []
    const app = createApp({
      onLimited: (context, decision) => {
        seen.push(context)
        return { message: `slow down, ${decision.remaining} left` }
      },
    })
    const [, , limited] = await sendTimes(app, 3)
    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ message: 'slow down, 0 left' })
    expect(seen[0]?.path).toBe('/')
  })

  test('onLimited can return a Response', async () => {
    const app = createApp({ onLimited: () => new Response('custom', { status: 429 }) })
    const [, , limited] = await sendTimes(app, 3)
    expect(limited?.status).toBe(429)
    expect(await limited?.text()).toBe('custom')
  })

  test('onLimited returning nothing still blocks the request', async () => {
    const app = createApp({ onLimited: () => undefined })
    const [, , limited] = await sendTimes(app, 3)
    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ error: 'Too Many Requests', retryAfter: 90 })
  })

  test.each<[string, () => Promise<unknown>]>([
    ['undefined', async () => undefined],
    ['null', async () => null],
  ])('an async onLimited resolving to %s still blocks without running the handler', async (_, onLimited) => {
    const handled: string[] = []
    const app = new Elysia()
      .use(rateLimit({ limit: 1, window: '1m', clock: new ManualClock(), onLimited }))
      .get('/', () => (handled.push('ran'), 'handled'))
    const [, limited] = await sendTimes(app, 2)
    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ error: 'Too Many Requests', retryAfter: 120 })
    expect(handled).toEqual(['ran'])
  })

  test('an async onLimited body replaces the 429 body', async () => {
    const app = createApp({ onLimited: async (_, decision) => ({ retryInMs: decision.retryAfterMs }) })
    const [, , limited] = await sendTimes(app, 3)
    expect(limited?.status).toBe(429)
    expect(await limited?.json()).toEqual({ retryInMs: 90_000 })
  })

  test('a key function that returns a non-string fails the request instead of sharing a bucket', async () => {
    const app = createApp({ key: () => 42 as unknown as string })
    expect(statuses(await sendTimes(app, 1))).toEqual([500])
  })

  test('a cost function that returns an invalid cost fails the request', async () => {
    const app = createApp({ cost: () => 3 })
    expect(statuses(await sendTimes(app, 1))).toEqual([500])
  })
})

describe('rateLimit client IP', () => {
  test('ignores X-Forwarded-For by default', async () => {
    const app = createApp()
    const spoofed = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => () => forwardedFor(ip))
    const responses = [...(await sendTimes(app, 2, spoofed[0])), ...(await sendTimes(app, 1, spoofed[1]))]
    expect(statuses(responses)).toEqual([200, 200, 429])
  })

  test('with trustProxy 1, prepended fake entries cannot change the client', async () => {
    const app = createApp({ trustProxy: 1 })
    const responses = [
      ...(await sendTimes(app, 2, () => forwardedFor('10.0.0.1, 198.51.100.7'))),
      ...(await sendTimes(app, 1, () => forwardedFor('10.0.0.2, 10.0.0.3, 198.51.100.7'))),
    ]
    expect(statuses(responses)).toEqual([200, 200, 429])
    expect(statuses(await sendTimes(app, 1, () => forwardedFor('198.51.100.8')))).toEqual([200])
  })

  test('groups IPv6 clients by /56 and IPv4-mapped addresses with IPv4', async () => {
    const seen: (string | null)[] = []
    const app = createApp({ trustProxy: true, skip: ({ ip }) => (seen.push(ip), false) })
    await sendTimes(app, 2, () => forwardedFor('2001:db8:1:ab01::1'))
    const sameSubnet = await sendTimes(app, 1, () => forwardedFor('2001:db8:1:abff:ffff::9'))
    expect(statuses(sameSubnet)).toEqual([429])
    await sendTimes(app, 2, () => forwardedFor('203.0.113.7'))
    expect(statuses(await sendTimes(app, 1, () => forwardedFor('::ffff:203.0.113.7')))).toEqual([429])
    expect(seen).toContain('2001:db8:1:ab00::/56')
    expect(seen).toContain('203.0.113.7')
  })

  test('honours a custom ipv6Subnet', async () => {
    const app = createApp({ trustProxy: true, ipv6Subnet: 64 })
    await sendTimes(app, 2, () => forwardedFor('2001:db8:1:ab01::1'))
    expect(statuses(await sendTimes(app, 1, () => forwardedFor('2001:db8:1:ab02::1')))).toEqual([200])
  })

  test('clients without an address share one bucket', async () => {
    const app = createApp({ trustProxy: true })
    const responses = [...(await sendTimes(app, 2)), ...(await sendTimes(app, 1, () => forwardedFor('not-an-ip')))]
    expect(statuses(responses)).toEqual([200, 200, 429])
  })
})

describe('rateLimit store failures', () => {
  const failures: readonly [string, unknown][] = [
    ['a plain error', new Error(`connection to ${SECRET} refused`)],
    ['a store conflict', new StoreConflictError(`conflict on ${SECRET}`)],
    ['a thrown string', SECRET],
  ]

  test.each(failures)('passes the request in open mode on %s', async (_, error) => {
    const app = createApp({ store: failingStore(error) })
    const [response] = await sendTimes(app, 1)
    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({ status: 'unavailable' })
    expect(response?.headers.has('RateLimit-Limit')).toBe(false)
  })

  test.each(failures)('answers 503 in closed mode on %s without leaking store details', async (_, error) => {
    const app = createApp({ store: failingStore(error), failureMode: 'closed' })
    const [response] = await sendTimes(app, 1)
    expect(response?.status).toBe(503)
    const body = await response?.text()
    expect(JSON.parse(body ?? '')).toEqual({ error: 'Rate limiter unavailable' })
    expectNoLeaks(body)
  })

  test.each<['open' | 'closed', number]>([
    ['open', 200],
    ['closed', 503],
  ])('a Redis store that keeps conflicting answers %s mode with %p, never 500', async (failureMode, status) => {
    const app = createApp({ store: conflictingRedisStore(), failureMode })
    const [response] = await sendTimes(app, 1)
    expect(response?.status).toBe(status)
    expectNoLeaks(await response?.text())
  })

  test('exposes the error as a RateLimiterError on the context', async () => {
    const failure = new Error('down')
    const outcomes: RateLimitOutcome[] = []
    const app = new Elysia()
      .use(rateLimit({ limit: 1, window: '1m', store: failingStore(failure) }))
      .get('/', ({ rateLimit: outcome }) => (outcomes.push(outcome), 'ok'))
    await app.handle(request())
    const [outcome] = outcomes
    expect(outcome?.status).toBe('unavailable')
    if (outcome?.status !== 'unavailable') return
    expect(outcome.error.name).toBe('StoreUnavailableError')
    expect(outcome.error.cause).toBe(failure)
  })
})

describe('rateLimit scope and instances', () => {
  test("scope 'local' only limits routes on the plugin instance", async () => {
    const limited = rateLimit({ limit: 1, window: '1m', scope: 'local' }).get('/limited', () => 'limited')
    const app = new Elysia().use(limited).get('/open', () => 'open')
    expect(statuses(await sendTimes(app, 2, () => request('/limited')))).toEqual([200, 429])
    expect(statuses(await sendTimes(app, 3, () => request('/open')))).toEqual([200, 200, 200])
  })

  test("default scope 'scoped' limits the parent but not the grandparent", async () => {
    const child = new Elysia().use(rateLimit({ limit: 1, window: '1m' })).get('/child', () => 'child')
    const app = new Elysia().use(child).get('/parent', () => 'parent')
    expect(statuses(await sendTimes(app, 2, () => request('/child')))).toEqual([200, 429])
    expect(statuses(await sendTimes(app, 2, () => request('/parent')))).toEqual([200, 200])
  })

  test("scope 'global' limits every route", async () => {
    const child = new Elysia().use(rateLimit({ limit: 1, window: '1m', scope: 'global' }))
    const app = new Elysia().use(new Elysia().use(child)).get('/', () => 'ok')
    expect(statuses(await sendTimes(app, 2))).toEqual([200, 429])
  })

  test('two limiters with different settings both apply', async () => {
    const app = new Elysia()
      .use(rateLimit({ limit: 5, window: '1m', prefix: 'burst' }))
      .use(rateLimit({ limit: 2, window: '1h', prefix: 'hourly' }))
      .get('/', () => 'ok')
    expect(statuses(await sendTimes(app, 3))).toEqual([200, 200, 429])
  })

  test('a stricter limiter registered first still blocks when a later one allows', async () => {
    const handled: string[] = []
    const app = new Elysia()
      .use(rateLimit({ limit: 2, window: '1m', prefix: 'burst', algorithm: 'fixed-window', clock: new ManualClock() }))
      .use(rateLimit({ limit: 5, window: '1h', prefix: 'hourly', algorithm: 'fixed-window', clock: new ManualClock() }))
      .get('/', () => (handled.push('ran'), 'ok'))
    const responses = await sendTimes(app, 3)
    expect(statuses(responses)).toEqual([200, 200, 429])
    expect(handled).toHaveLength(2)
    expect(responses[2]?.headers.get('RateLimit-Limit')).toBe('2')
    expect(responses[2]?.headers.get('RateLimit-Remaining')).toBe('0')
    expect(responses[2]?.headers.get('Retry-After')).toBe('60')
  })

  test('the rateLimit context value is typed for handlers', async () => {
    const app = new Elysia()
      .use(rateLimit({ limit: 2, window: '1m' }))
      .get('/', ({ rateLimit: outcome }) => (outcome.status === 'allowed' ? outcome.decision.remaining : -1))
    expect(await (await app.handle(request())).text()).toBe('1')
  })
})

describe('rateLimit on a real server', () => {
  test('counts by socket address and closes its own store on stop', async () => {
    const seen: (string | null)[] = []
    const app = createApp({ skip: ({ ip }) => (seen.push(ip), false) }).listen(0)
    const url = `http://localhost:${app.server?.port ?? 0}/`
    const responses = [await fetch(url), await fetch(url), await fetch(url)]
    await app.stop()
    expect(statuses(responses)).toEqual([200, 200, 429])
    expect(seen[0]).toMatch(/^(127\.0\.0\.1|::\/56)$/)
  })
})

describe('RateLimitHeaders', () => {
  const decision = { allowed: false, limit: 10, remaining: 0, resetAt: 1_500, retryAfterMs: 1 }

  test('rounds seconds up, with Retry-After at least 1 and Reset at least 0', () => {
    expect(RateLimitHeaders.from(decision, 500, 2_000)).toEqual({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '0',
      'RateLimit-Policy': '10;w=1',
      'Retry-After': '1',
    })
  })
})
