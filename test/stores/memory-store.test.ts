import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { RateLimiterConfigError } from '../../src/errors'
import { MemoryStore, type MemoryStoreOptions } from '../../src/stores/memory-store'
import { ManualClock } from '../helpers/manual-clock'

const openStores: MemoryStore[] = []

const createStore = (options: MemoryStoreOptions = {}): MemoryStore => {
  const store = new MemoryStore(options)
  openStores.push(store)
  return store
}

const put = (store: MemoryStore, key: string, value: string, ttlMs = 1_000) =>
  store.update(key, () => ({ value, ttlMs, result: undefined }))

const get = (store: MemoryStore, key: string) =>
  store.update(key, (current) => ({ value: current ?? '', ttlMs: 1_000, result: current }))

afterEach(async () => {
  await Promise.all(openStores.splice(0).map((store) => store.close()))
})

describe('MemoryStore options', () => {
  test('uses defaults when no options are given', () => {
    expect(createStore().size).toBe(0)
  })

  test.each<[string, unknown]>([
    ['maxKeys', 0],
    ['maxKeys', 1.5],
    ['sweepIntervalMs', -1],
    ['clock', { now: 'later' }],
    ['maxkeys', 5],
  ])('rejects invalid %s', (field, value) => {
    const create = () => new MemoryStore({ [field]: value })
    expect(create).toThrow(RateLimiterConfigError)
    expect(create).toThrow(field)
  })
})

describe('MemoryStore.update', () => {
  test('passes null for a missing key and returns the mutation result', async () => {
    const store = createStore({ clock: new ManualClock() })
    const result = await store.update('a', (current) => ({ value: 'one', ttlMs: 1_000, result: current }))
    expect(result).toBeNull()
    expect(await get(store, 'a')).toBe('one')
  })

  test('rejects when the mutation throws and leaves the value unchanged', async () => {
    const store = createStore({ clock: new ManualClock() })
    await put(store, 'a', 'one')
    const failing = store.update('a', () => {
      throw new Error('mutation failed')
    })
    await expect(failing).rejects.toThrow('mutation failed')
    expect(await get(store, 'a')).toBe('one')
  })

  test('runs concurrent updates to one key one after another', async () => {
    const store = createStore({ clock: new ManualClock() })
    const increment = () =>
      store.update('count', (current) => {
        const next = Number(current ?? '0') + 1
        return { value: String(next), ttlMs: 1_000, result: next }
      })
    const results = await Promise.all(Array.from({ length: 100 }, increment))
    expect(new Set(results).size).toBe(100)
    expect(Math.max(...results)).toBe(100)
  })
})

describe('MemoryStore TTL', () => {
  test('keeps a value until its TTL passes, then treats it as missing', async () => {
    const clock = new ManualClock()
    const store = createStore({ clock })
    await put(store, 'a', 'one', 500)
    clock.advance(499)
    expect(await get(store, 'a')).toBe('one')
    await put(store, 'b', 'two', 500)
    clock.advance(500)
    expect(await get(store, 'b')).toBeNull()
  })

  test('removes an expired entry when it is read', async () => {
    const clock = new ManualClock()
    const store = createStore({ clock })
    await put(store, 'a', 'one', 100)
    clock.advance(100)
    await store.delete('missing')
    expect(store.size).toBe(1)
    expect(await store.update('a', (current) => ({ value: 'two', ttlMs: 100, result: current }))).toBeNull()
    expect(store.size).toBe(1)
  })
})

describe('MemoryStore LRU', () => {
  test('evicts the least recently updated key first', async () => {
    const store = createStore({ maxKeys: 3, clock: new ManualClock() })
    await put(store, 'a', '1')
    await put(store, 'b', '2')
    await put(store, 'c', '3')
    await put(store, 'a', '1 again')
    await put(store, 'd', '4')
    expect(store.size).toBe(3)
    expect(await get(store, 'b')).toBeNull()
    expect(store.size).toBe(3)
    expect(await get(store, 'd')).toBe('4')
    expect(await get(store, 'a')).toBe('1 again')
  })

  test('never holds more than maxKeys entries', async () => {
    const store = createStore({ maxKeys: 10, clock: new ManualClock() })
    for (let index = 0; index < 1_000; index += 1) {
      await put(store, `key-${index}`, String(index))
      expect(store.size).toBeLessThanOrEqual(10)
    }
    expect(store.size).toBe(10)
    expect(await get(store, 'key-999')).toBe('999')
    expect(await get(store, 'key-0')).toBeNull()
  })
})

describe('MemoryStore.delete', () => {
  test('removes a key', async () => {
    const store = createStore({ clock: new ManualClock() })
    await put(store, 'a', 'one')
    await store.delete('a')
    expect(store.size).toBe(0)
    expect(await get(store, 'a')).toBeNull()
  })
})

const isTimer = (value: unknown): value is { hasRef(): boolean } =>
  typeof value === 'object' && value !== null && 'hasRef' in value && typeof value.hasRef === 'function'

describe('MemoryStore sweep timer', () => {
  const spies: { mockRestore(): void }[] = []

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
  })

  const captureSweep = (options: MemoryStoreOptions) => {
    const setIntervalSpy = spyOn(globalThis, 'setInterval')
    spies.push(setIntervalSpy)
    const store = createStore(options)
    const [sweep, intervalMs] = setIntervalSpy.mock.calls[0] ?? []
    const timer = setIntervalSpy.mock.results[0]?.value
    if (typeof sweep !== 'function' || !isTimer(timer)) throw new Error('expected a sweep timer')
    return { store, sweep: () => sweep(), intervalMs, timer }
  }

  test('schedules the sweep at sweepIntervalMs and unrefs the timer', () => {
    const { intervalMs, timer } = captureSweep({ sweepIntervalMs: 5_000, clock: new ManualClock() })
    expect(intervalMs).toBe(5_000)
    expect(timer.hasRef()).toBe(false)
  })

  test('removes expired entries and keeps live ones', async () => {
    const clock = new ManualClock()
    const { store, sweep } = captureSweep({ clock })
    await put(store, 'short', '1', 100)
    await put(store, 'long', '2', 1_000)
    clock.advance(100)
    sweep()
    expect(store.size).toBe(1)
    expect(await get(store, 'long')).toBe('2')
  })

  test('close() stops the timer and clears the entries', async () => {
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval')
    spies.push(clearIntervalSpy)
    const { store, timer } = captureSweep({ clock: new ManualClock() })
    await put(store, 'a', 'one')
    await store.close()
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer)
    expect(store.size).toBe(0)
  })
})
