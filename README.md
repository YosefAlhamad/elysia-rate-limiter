# elysia-rate-limiter

Rate limiting for [Elysia](https://elysiajs.com) on Bun: three algorithms, memory or Redis storage, Zod-validated options, standard `RateLimit-*` headers, and safe client IP handling.

**Live demo:** watch all three algorithms decide, request by request, at [ratelimit.yosefalhamad.com](https://ratelimit.yosefalhamad.com).

## Install

```sh
bun add elysia-rate-limiter
```

`elysia` (^1.4.30) and `zod` (^4.6.7) are peer dependencies. Requires Bun 1.3 or newer.

## Quick start

```ts
import { Elysia } from 'elysia'
import { rateLimit } from 'elysia-rate-limiter'

const app = new Elysia()
  .use(rateLimit({ limit: 100, window: '1m' }))
  .get('/', () => 'Hello')
  .listen(3000)
```

Each client IP gets 100 requests per minute. Request 101 gets `429 Too Many Requests` with this JSON body and a `Retry-After` header:

```json
{ "error": "Too Many Requests", "retryAfter": 12 }
```

The default store is a `MemoryStore`, which lives inside one process. **If your app runs on more than one instance (several containers, pods, or cluster workers), use Redis**, or each instance will count separately and clients get `limit × instances` requests. See [Redis with Bun](#redis-with-bun).

## Choosing an algorithm

| Algorithm | Behaviour | Good for | Trade-off |
| --- | --- | --- | --- |
| `sliding-window` (default) | Weights the previous window's count by how much of it still overlaps a rolling window | Most APIs and pages | Assumes the previous window's requests were spread evenly, so it is an estimate |
| `fixed-window` | Counts requests in clock-aligned windows (`12:00:00` to `12:01:00`) | Simple quotas, cheapest to reason about | A client can send up to `2 × limit` across a window boundary |
| `token-bucket` | A bucket of `limit` tokens that refills evenly over `window` | APIs that should allow short bursts then a steady rate | A full bucket allows a burst of `limit` at once |

Every algorithm stores a few numbers per key, so memory per client is constant. To compare them side by side on the same traffic, open the [live demo](https://ratelimit.yosefalhamad.com).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `limit` | `number` | required | Requests allowed per window (bucket size for token bucket). Whole number from 1 to 1,000,000,000 |
| `window` | `number \| string` | required | Window length: milliseconds, or `"500ms"`, `"30s"`, `"15m"`, `"1h"`, `"1d"`. At most 30 days |
| `algorithm` | `'fixed-window' \| 'sliding-window' \| 'token-bucket'` | `'sliding-window'` | Algorithm, see above |
| `store` | `RateLimitStore` | a new `MemoryStore` | Where counters live. A store you pass in is never closed by the plugin |
| `prefix` | `string` | `'rate-limit'` | Key prefix, 1 to 64 letters, digits, `_` or `-`. Use different prefixes for different limiters on one store |
| `key` | `(ctx) => string \| Promise<string>` | client IP | What to count by: user id, API key, route plus IP |
| `cost` | `number \| (ctx) => number \| Promise<number>` | `1` | How much one request uses. Whole number from 1 to `limit` |
| `skip` | `(ctx) => boolean \| Promise<boolean>` | none | Return `true` to not count a request (health checks, internal callers) |
| `trustProxy` | `boolean \| number` | `false` | Whether to read `X-Forwarded-For`. A number is how many proxies (1 to 32) sit in front of the app. See [Behind a proxy](#behind-cloudflare-or-nginx) |
| `ipv6Subnet` | `number` | `56` | IPv6 clients in the same `/ipv6Subnet` share one counter (0 to 128) |
| `headers` | `boolean` | `true` | Send `RateLimit-*` and `Retry-After` headers |
| `failureMode` | `'open' \| 'closed'` | `'open'` | When the store fails: let requests through (`open`), or answer `503` (`closed`) |
| `onLimited` | `(ctx, decision) => unknown` | JSON body above | Custom `429` body or `Response`. May be async. Returning `undefined` or `null` uses the default body, so the request is still blocked |
| `scope` | `'global' \| 'scoped' \| 'local'` | `'scoped'` | Elysia hook scope: which routes the limiter applies to |
| `clock` | `Clock` | system clock | An object with `now(): number` in ms. Useful for tests |

Unknown options and invalid values throw a `RateLimiterConfigError` when `rateLimit()` is called, with a message naming each bad field:

```text
Invalid rate limiter options:
window: Duration must look like "500ms", "30s", "15m", "1h" or "1d"
```

### The `ctx` argument

`key`, `cost`, `skip`, and `onLimited` receive:

```ts
import type { Context } from 'elysia'

interface RateLimitRequestContext {
  readonly request: Request
  readonly path: string
  readonly ip: string | null
  readonly elysia: Context
}
```

`ip` is the client address after proxy handling: plain IPv4 (`203.0.113.7`), or an IPv6 subnet (`2001:db8:1:ab00::/56`). It is `null` when no address is known. Without a `key` function, all clients without an address share one bucket named `unknown-client`, so they are limited together rather than not at all.

### The `rateLimit` context value

Handlers get the result as `ctx.rateLimit`, fully typed:

```ts
import type { RateLimiterError } from 'elysia-rate-limiter'

type RateLimitOutcome =
  | { readonly status: 'allowed'; readonly decision: RateLimitDecision }
  | { readonly status: 'limited'; readonly decision: RateLimitDecision }
  | { readonly status: 'skipped' }
  | { readonly status: 'unavailable'; readonly error: RateLimiterError }

interface RateLimitDecision {
  readonly allowed: boolean
  readonly limit: number
  readonly remaining: number
  readonly resetAt: number
  readonly retryAfterMs: number
}
```

`resetAt` is a Unix time in milliseconds. When several limiters are used on one app, `ctx.rateLimit` holds the outcome of the last one, but every limiter still blocks on its own.

### Scope

- `'scoped'` (default): limits the routes of the instance that calls `.use(rateLimit(...))` that are registered after that call, but not apps that use that instance in turn.
- `'global'`: limits every route of every app the plugin ends up in.
- `'local'`: limits only routes registered on the returned plugin itself, as in `rateLimit({ ..., scope: 'local' }).get('/x', ...)`.

## Recipes

### Per-route limits

Put the strict route on its own instance. Its limiter applies only there, and the app-wide limiter applies to every route registered after it, including the sub-instance's:

```ts
import { Elysia } from 'elysia'
import { rateLimit } from 'elysia-rate-limiter'

const reports = new Elysia()
  .use(rateLimit({ limit: 5, window: '1h', prefix: 'reports' }))
  .post('/reports', () => ({ queued: true }))

const app = new Elysia()
  .use(rateLimit({ limit: 100, window: '1m', prefix: 'global' }))
  .use(reports)
  .get('/', () => 'home')
```

Elysia hooks only apply to routes registered after them, so always `.use(rateLimit(...))` before the routes and sub-instances it should cover.

To charge expensive routes more from one limiter, use `cost`:

```ts
import { rateLimit } from 'elysia-rate-limiter'

const weighted = rateLimit({ limit: 100, window: '1m', cost: ({ path }) => (path.startsWith('/export') ? 10 : 1) })
```

### Login limits by username plus IP

Count failed-login attempts per account and address, so one attacker cannot lock out a user from everywhere and cannot try many accounts from one IP without hitting the IP limit too:

```ts
import { Elysia } from 'elysia'
import { rateLimit } from 'elysia-rate-limiter'

const usernameOf = (body: unknown): string =>
  typeof body === 'object' && body !== null && 'username' in body && typeof body.username === 'string'
    ? body.username.trim().toLowerCase()
    : ''

const login = new Elysia()
  .use(
    rateLimit({
      limit: 5,
      window: '15m',
      algorithm: 'fixed-window',
      prefix: 'login-user',
      failureMode: 'closed',
      key: ({ elysia, ip }) => JSON.stringify([usernameOf(elysia.body), ip]),
    }),
  )
  .use(rateLimit({ limit: 20, window: '15m', prefix: 'login-ip', failureMode: 'closed' }))
  .post('/login', ({ body }) => ({ ok: usernameOf(body) !== '' }))
```

`failureMode: 'closed'` makes the login route answer `503` instead of allowing unlimited guesses when the store is down. Encoding the parts with `JSON.stringify` keeps `"a|b" + "c"` and `"a" + "b|c"` apart.

### API key tiers

One limiter per tier, each skipping the other tier's requests:

```ts
import { Elysia } from 'elysia'
import { rateLimit } from 'elysia-rate-limiter'

const apiKeyOf = (request: Request) => request.headers.get('x-api-key') ?? 'anonymous'
const isPro = (request: Request) => apiKeyOf(request).startsWith('pro_')

const app = new Elysia()
  .use(
    rateLimit({
      limit: 60,
      window: '1m',
      prefix: 'tier-free',
      key: ({ request }) => apiKeyOf(request),
      skip: ({ request }) => isPro(request),
    }),
  )
  .use(
    rateLimit({
      limit: 1_000,
      window: '1m',
      algorithm: 'token-bucket',
      prefix: 'tier-pro',
      key: ({ request }) => apiKeyOf(request),
      skip: ({ request }) => !isPro(request),
    }),
  )
  .get('/data', () => ({ data: [] }))
```

In real code, look the tier up from your API key table instead of trusting a prefix.

### Redis with Bun

Bun's built-in `RedisClient` works as is:

```ts
import { RedisClient } from 'bun'
import { Elysia } from 'elysia'
import { RedisStore, rateLimit } from 'elysia-rate-limiter'

const redis = new RedisClient(process.env.REDIS_URL ?? 'redis://localhost:6379')
const store = new RedisStore({ client: redis })

const app = new Elysia()
  .use(rateLimit({ limit: 100, window: '1m', store }))
  .get('/', () => 'ok')
  .onStop(() => redis.close())
```

Updates use an optimistic compare-and-set Lua script, so several app instances can share one Redis without ever allowing more than `limit`. If another instance keeps changing a key, the store retries up to `maxAttempts` times (default `5`, 1 to 20) and then fails with `StoreConflictError`, which `failureMode` handles like any store failure.

Reuse one store for several limiters by giving each a different `prefix`.

### ioredis and node-redis

`RedisStore` only needs an object with `send(command, args)`. One-line adapters:

```ts
import Redis from 'ioredis'
import { RedisStore } from 'elysia-rate-limiter'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const store = new RedisStore({ client: { send: (command, args) => redis.call(command, ...args) } })
```

```ts
import { createClient } from 'redis'
import { RedisStore } from 'elysia-rate-limiter'

const redis = await createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' }).connect()
const store = new RedisStore({ client: { send: (command, args) => redis.sendCommand([command, ...args]) } })
```

### Behind Cloudflare or nginx

By default the plugin uses the TCP socket address and ignores `X-Forwarded-For`, because any client can send that header. Behind a reverse proxy the socket address is the proxy, so every client would share one bucket. Set `trustProxy` to the number of proxies in front of the app:

```ts
import { rateLimit } from 'elysia-rate-limiter'

const behindNginx = rateLimit({ limit: 100, window: '1m', trustProxy: 1 })
const behindCloudflareAndNginx = rateLimit({ limit: 100, window: '1m', trustProxy: 2 })
```

With `trustProxy: n`, the plugin takes the entry `n` places from the right of `X-Forwarded-For`, which is the address your outermost trusted proxy saw. Entries a client adds itself are further left and are ignored. Each proxy must append to the header, for nginx:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

`trustProxy: true` takes the leftmost entry. Only use it when every request passes through a proxy that **overwrites** the header; otherwise clients can pick their own IP.

If your origin only accepts traffic from Cloudflare, you can also count by Cloudflare's header:

```ts
import { rateLimit } from 'elysia-rate-limiter'

const cloudflare = rateLimit({
  limit: 100,
  window: '1m',
  key: ({ request, ip }) => request.headers.get('cf-connecting-ip') ?? ip ?? 'unknown-client',
})
```

### Using `RateLimiter` outside Elysia

The `RateLimiter` class works anywhere: WebSocket messages, queue workers, CLI jobs.

```ts
import { RateLimiter } from 'elysia-rate-limiter'

const limiter = new RateLimiter({ limit: 10, window: '1s', algorithm: 'token-bucket' })

export const onMessage = async (userId: string, message: string): Promise<string> => {
  const decision = await limiter.consume(`ws:${userId}`)
  if (!decision.allowed) return `Slow down, try again in ${decision.retryAfterMs}ms`
  return `echo: ${message}`
}
```

| Member | Meaning |
| --- | --- |
| `new RateLimiter(options)` | Options: `limit`, `window`, `algorithm`, `prefix`, `store`, `clock`, as in the table above |
| `consume(identifier, cost = 1)` | Counts a request and returns a `RateLimitDecision`. Throws `RangeError` if `cost` is not a whole number from 1 to `limit` |
| `peek(identifier)` | Returns the decision the next request would get, without counting it |
| `reset(identifier)` | Clears one identifier's counter |
| `close()` | Closes the store if the limiter created it. Stores you pass in stay open |
| `limit`, `windowMs`, `algorithmName` | The parsed policy |

`MemoryStore` options: `maxKeys` (default `100_000`; least recently updated keys are evicted first), `sweepIntervalMs` (default `60_000`; how often expired keys are removed), and `clock`.

To write your own store, implement `RateLimitStore`. `update` must be atomic per key:

```ts
import type { StoreMutation } from 'elysia-rate-limiter'

interface RateLimitStore {
  read(key: string): Promise<string | null>
  update<TResult>(key: string, mutation: StoreMutation<TResult>): Promise<TResult>
  delete(key: string): Promise<void>
  close?(): Promise<void>
}
```

## Headers

| Header | Sent | Value |
| --- | --- | --- |
| `RateLimit-Limit` | always | `limit` |
| `RateLimit-Remaining` | always | Requests left |
| `RateLimit-Reset` | always | Seconds until the counter resets, rounded up |
| `RateLimit-Policy` | always | `limit;w=windowSeconds`, for example `100;w=60` |
| `Retry-After` | on `429` | Seconds to wait, rounded up, at least 1 |

These follow the IETF `RateLimit` header fields draft. They are not sent for skipped requests, when the store is unavailable, or when `headers: false`. With several limiters, an allowed response carries the last limiter's headers and a `429` carries the headers of the limiter that blocked it.

## Errors

All errors extend `RateLimiterError`.

| Error | When |
| --- | --- |
| `RateLimiterConfigError` | Invalid options, thrown at startup by `rateLimit()`, `new RateLimiter()`, `new MemoryStore()`, or `new RedisStore()`. The message names every bad field |
| `StoreUnavailableError` | The store failed or returned something unexpected. The original error is the `cause` |
| `StoreConflictError` | Redis kept changing under the update for `maxAttempts` tries |

In the plugin, store errors never become a `500`. With `failureMode: 'open'` the request continues and `ctx.rateLimit` is `{ status: 'unavailable', error }`. With `'closed'` the response is `503` with `{ "error": "Rate limiter unavailable" }`. A `key` function that returns a non-string or a `cost` outside 1 to `limit` is a bug in your code and fails the request.

## Security notes

- **Proxy headers.** `X-Forwarded-For` is ignored unless you set `trustProxy`. Prefer a hop count over `true`.
- **IPv6.** One IPv6 user usually controls a whole `/64` or `/56`, so clients are grouped by `/56` by default. IPv4-mapped IPv6 (`::ffff:203.0.113.7`) counts the same as plain IPv4.
- **Hashed keys.** Store keys are `prefix:algorithm:sha256(identifier)`. Raw IPs, user ids, and API keys never reach the store, and an identifier containing `:` cannot collide with another key.
- **Memory cap.** `MemoryStore` holds at most `maxKeys` entries, so random keys cannot exhaust memory.
- **Tampered state.** Stored state is checked with a Zod schema; corrupt or wrong-shape data resets that key instead of crashing or lifting the limit.
- **Redis.** User data only travels as Lua script arguments, never as script text.
- **Failure mode.** `'open'` keeps your app up when the store is down but removes the limit for that time. Use `'closed'` for routes where the limit is the protection, such as login, password reset, or paid APIs.
- **Error bodies.** `429` and `503` bodies contain no stack traces, keys, or store details.
- **Clock skew.** Window algorithms tolerate servers whose clocks differ by up to one window, and the token bucket never adds tokens when the clock moves backwards.
- **Per process memory.** `MemoryStore` limits per process. Use Redis for more than one instance.

## For AI agents

Paste this prompt into your coding agent to add rate limiting to an Elysia app:

````text
Add rate limiting to this Elysia app (Bun) using the elysia-rate-limiter package.

1. Install it with `bun add elysia-rate-limiter`. Use Bun for every command (`bun add`, `bun test`, `bunx`).
2. Import with `import { rateLimit } from 'elysia-rate-limiter'`.
3. Pick limits per kind of route, starting from these and adjusting to real traffic:
   - general pages and API reads: `rateLimit({ limit: 100, window: '1m' })`
   - writes and expensive endpoints: `rateLimit({ limit: 20, window: '1m', prefix: 'writes' })`
   - login, signup, password reset: `rateLimit({ limit: 5, window: '15m', algorithm: 'fixed-window', prefix: 'auth', failureMode: 'closed' })`
   Give every limiter that shares a store its own `prefix`.
4. Where to put `.use()`: hooks apply to the instance that calls `.use(rateLimit(...))`, and only to routes registered after that call. Put the general limiter on the main app before any routes or sub-instances. Put stricter limiters at the top of the sub-instance (for example the auth router) that owns those routes, then `.use()` that sub-instance in the main app after the general limiter. Use `scope: 'global'` only if one limiter must cover every route in every plugin.
5. Client IP: if the app runs behind a reverse proxy or load balancer, set `trustProxy` to the number of proxies in front of it (for example `trustProxy: 1` for one nginx). Never set `trustProxy: true` unless the proxy overwrites `X-Forwarded-For`. If there is no proxy, leave it unset.
6. For logged-in users, count by user id instead of IP: `key: ({ elysia, ip }) => currentUserId(elysia) ?? ip ?? 'anonymous'`, where `currentUserId` is this app's own way to read the user.
7. Skip health checks: `skip: ({ path }) => path === '/health'`.
8. If the app runs on more than one instance (several containers, pods, or workers), switch to Redis, because the default memory store only counts inside one process:
   import { RedisClient } from 'bun'
   import { RedisStore, rateLimit } from 'elysia-rate-limiter'
   const store = new RedisStore({ client: new RedisClient(process.env.REDIS_URL) })
   then pass `store` to every `rateLimit({ ... })`.
9. Handlers can read `ctx.rateLimit.status` ('allowed', 'limited', 'skipped', 'unavailable'); limited requests are answered with 429 before the handler runs.
10. Add a test that sends `limit + 1` requests with `app.handle(new Request('http://localhost/'))` and expects the last one to be 429. `app.handle` has no socket address, so in tests either set a `key` function or send `X-Forwarded-For` with `trustProxy: 1`.
11. Run the type checker and tests.
````

## License

MIT
