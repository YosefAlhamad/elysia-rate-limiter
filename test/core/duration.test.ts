import { describe, expect, test } from 'bun:test'
import { Duration } from '../../src/core/duration'
import { RateLimiterConfigError } from '../../src/errors'

const THIRTY_DAYS_MS = 30 * 86_400_000

describe('Duration.toMilliseconds', () => {
  test.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['1d', 86_400_000],
    ['30d', THIRTY_DAYS_MS],
    ['720h', THIRTY_DAYS_MS],
    ['1ms', 1],
  ])('parses %p as %p ms', (input, expected) => {
    expect(Duration.toMilliseconds(input)).toBe(expected)
  })

  test('takes numbers as milliseconds', () => {
    expect(Duration.toMilliseconds(1)).toBe(1)
    expect(Duration.toMilliseconds(60_000)).toBe(60_000)
    expect(Duration.toMilliseconds(THIRTY_DAYS_MS)).toBe(THIRTY_DAYS_MS)
  })

  test.each([0, -1, 1.5, THIRTY_DAYS_MS + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the number %p',
    (input) => {
      expect(() => Duration.toMilliseconds(input)).toThrow(RateLimiterConfigError)
    },
  )

  test.each(['0ms', '0s', '31d', '721h', '2592000001ms', '99999999999999999999d'])(
    'rejects the out of range string %p',
    (input) => {
      expect(() => Duration.toMilliseconds(input)).toThrow(RateLimiterConfigError)
    },
  )

  test.each(['', 'ms', '10', '1.5s', '-1s', ' 1s', '1s ', '1 s', '1S', '1w', '1sec', '1e3ms', 'abc'])(
    'rejects the malformed string %p',
    (input) => {
      expect(() => Duration.toMilliseconds(input)).toThrow(RateLimiterConfigError)
    },
  )

  test('explains why a string is malformed', () => {
    expect(() => Duration.toMilliseconds('1w')).toThrow(/Duration must look like/)
  })

  test('explains the bounds', () => {
    expect(() => Duration.toMilliseconds(0)).toThrow(/at least 1ms/)
    expect(() => Duration.toMilliseconds('31d')).toThrow(/at most 30 days/)
    expect(() => Duration.toMilliseconds(1.5)).toThrow(/whole number/)
  })
})
