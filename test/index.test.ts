import { expect, test } from 'bun:test'
import * as entry from '../src/index'

test('exports only the public runtime API', () => {
  expect(Object.keys(entry).sort()).toEqual([
    'MemoryStore',
    'RateLimiterConfigError',
    'RateLimiterError',
    'RedisStore',
    'StoreConflictError',
    'StoreUnavailableError',
    'SystemClock',
    'isRateLimitStore',
  ])
})
