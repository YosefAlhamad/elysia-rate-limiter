import { describe, expect, test } from 'bun:test'
import { SlidingWindow } from '../../src/algorithms/sliding-window'
import { AlgorithmRunner } from '../helpers/algorithm-runner'
import { ManualClock } from '../helpers/manual-clock'

const createRunner = (start = 10_000) => {
  const clock = new ManualClock(start)
  const runner = new AlgorithmRunner(new SlidingWindow({ limit: 10, windowMs: 1_000 }), clock)
  return { clock, runner }
}

describe('SlidingWindow', () => {
  test('allows the first request', () => {
    const { runner } = createRunner(10_200)
    const { decision, state, ttlMs } = runner.consume()
    expect(decision).toEqual({ allowed: true, limit: 10, remaining: 9, resetAt: 11_000, retryAfterMs: 0 })
    expect(state).toEqual({ windowStart: 10_000, current: 1, previous: 0 })
    expect(ttlMs).toBe(1_800)
  })

  test('fills up to the limit, then denies without counting the denial', () => {
    const { runner } = createRunner()
    const remaining = runner.consumeTimes(10).map(({ decision }) => decision.remaining)
    expect(remaining).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const { decision, state } = runner.consume()
    expect(decision).toMatchObject({ allowed: false, remaining: 0 })
    expect(state.current).toBe(10)
  })

  test('weights the previous window halfway through the current one', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.set(11_500)
    expect(runner.peek().decision).toMatchObject({ allowed: true, remaining: 4 })
    const allowed = runner.consumeTimes(5).map(({ decision }) => decision.allowed)
    expect(allowed).toEqual([true, true, true, true, true])
    expect(runner.consume().decision.allowed).toBe(false)
    expect(runner.current).toEqual({ windowStart: 11_000, current: 5, previous: 10 })
  })

  test('waits for the previous share to decay when the current window has room', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.set(11_000)
    const denied = runner.consume()
    expect(denied.decision).toMatchObject({ allowed: false, retryAfterMs: 100, resetAt: 11_100 })
    clock.advance(99)
    expect(runner.peek().decision.allowed).toBe(false)
    clock.advance(1)
    expect(runner.consume().decision).toMatchObject({ allowed: true, remaining: 0 })
  })

  test('waits into the next window when the current window is full', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    const denied = runner.consume()
    expect(denied.decision).toMatchObject({ allowed: false, retryAfterMs: 1_100, resetAt: 11_100 })
    clock.advance(denied.decision.retryAfterMs - 1)
    expect(runner.peek().decision.allowed).toBe(false)
    clock.advance(1)
    expect(runner.consume().decision.allowed).toBe(true)
  })

  test('moves current into previous when rolling one window forward', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(4)
    clock.set(11_000)
    expect(runner.consume().state).toEqual({ windowStart: 11_000, current: 1, previous: 4 })
  })

  test('drops both counters when the stored window is older than one window', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.set(12_000)
    const { decision, state } = runner.consume()
    expect(decision).toMatchObject({ allowed: true, remaining: 9 })
    expect(state).toEqual({ windowStart: 12_000, current: 1, previous: 0 })
  })

  test('charges costs above 1 and computes the wait for the full cost', () => {
    const { clock, runner } = createRunner()
    expect(runner.consume(4).decision).toMatchObject({ allowed: true, remaining: 6 })
    expect(runner.consume(6).decision).toMatchObject({ allowed: true, remaining: 0 })
    clock.set(11_000)
    const denied = runner.consume(3)
    expect(denied.decision).toMatchObject({ allowed: false, retryAfterMs: 300 })
    clock.advance(300)
    expect(runner.consume(3).decision.allowed).toBe(true)
  })

  test('keeps state alive until the end of the next window', () => {
    const { runner } = createRunner(10_999)
    expect(runner.consume().ttlMs).toBe(1_001)
  })

  test('validates stored state with its schema', () => {
    const { stateSchema } = new SlidingWindow({ limit: 10, windowMs: 1_000 })
    expect(stateSchema.safeParse({ windowStart: 0, current: 1, previous: 2 }).success).toBe(true)
    for (const value of [null, { windowStart: 0, current: 1 }, { windowStart: 0, current: -1, previous: 0 }, { windowStart: 0, current: 0, previous: 0.5 }]) {
      expect(stateSchema.safeParse(value).success).toBe(false)
    }
  })
})

describe('SlidingWindow with clock skew between servers', () => {
  const algorithm = new SlidingWindow({ limit: 4, windowMs: 1_000 })

  test('keeps counting a window stored up to one window ahead', () => {
    const { state, decision, ttlMs } = algorithm.evaluate({ windowStart: 11_000, current: 4, previous: 0 }, 10_900, 1)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterMs).toBeGreaterThan(1_000)
    expect(state).toEqual({ windowStart: 11_000, current: 4, previous: 0 })
    expect(ttlMs).toBe(2_100)
  })

  test('counts the full previous share before the stored window starts', () => {
    const { decision } = algorithm.evaluate({ windowStart: 11_000, current: 0, previous: 4 }, 10_900, 1)
    expect(decision).toMatchObject({ allowed: false, remaining: 0 })
  })

  test('starts fresh when the stored window is further ahead than one window', () => {
    const { state, decision } = algorithm.evaluate({ windowStart: 12_000, current: 4, previous: 4 }, 10_900, 1)
    expect(decision.allowed).toBe(true)
    expect(state).toEqual({ windowStart: 10_000, current: 1, previous: 0 })
  })
})
