# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-22

### Added

- `rateLimit` Elysia plugin with a typed `ctx.rateLimit` outcome, `429` and `503` responses, `key`, `cost`, `skip`, `onLimited`, `failureMode`, `headers`, and `scope` options.
- `RateLimiter` class for use outside Elysia, with `consume`, `peek`, `reset`, and `close`.
- Sliding window (default), fixed window, and token bucket algorithms.
- `MemoryStore` with TTL expiry, LRU eviction capped at `maxKeys`, and a background sweep.
- `RedisStore` with an optimistic compare-and-set Lua script, per-key queueing, and `EVALSHA` caching. Works with Bun's `RedisClient`, ioredis, and node-redis.
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`, and `Retry-After` headers.
- Client IP resolution that ignores `X-Forwarded-For` unless `trustProxy` is set, supports proxy hop counts, and groups IPv6 clients by subnet.
- SHA-256 hashed store keys.
- Zod-validated options with exported schemas and `RateLimiterConfigError` messages that name each bad field.
