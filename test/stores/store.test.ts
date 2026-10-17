import { describe, expect, test } from 'bun:test'
import { MemoryStore } from '../../src/stores/memory-store'
import { isRateLimitStore } from '../../src/stores/store'

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
