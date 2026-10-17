import { describe, expect, test } from 'bun:test'
import { MemoryStore } from '../../src/stores/memory-store'
import { isRateLimitStore, normalizeTtlMs } from '../../src/stores/store'

const noop = async () => undefined

describe('isRateLimitStore', () => {
  test('accepts objects with update and delete, and an optional close', async () => {
    const store = new MemoryStore()
    expect(isRateLimitStore(store)).toBe(true)
    expect(isRateLimitStore({ update: noop, delete: noop })).toBe(true)
    expect(isRateLimitStore({ update: noop, delete: noop, close: undefined })).toBe(true)
    await store.close()
  })

  test.each([
    null,
    undefined,
    'store',
    {},
    { update: noop },
    { delete: noop },
    { update: 1, delete: noop },
    { update: noop, delete: noop, close: 'no' },
  ])('rejects %p', (value) => {
    expect(isRateLimitStore(value)).toBe(false)
  })
})

describe('normalizeTtlMs', () => {
  test.each([
    [1_000, 1_000],
    [1_500.2, 1_501],
    [0.1, 1],
    [0, 1],
    [-50, 1],
  ])('turns %p into %p', (input, expected) => {
    expect(normalizeTtlMs(input)).toBe(expected)
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects %p', (input) => {
    expect(() => normalizeTtlMs(input)).toThrow(RangeError)
  })
})
