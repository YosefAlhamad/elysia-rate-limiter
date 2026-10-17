import { describe, expect, test } from 'bun:test'
import { FixedWindow } from '../../src/algorithms/fixed-window'
import { AlgorithmRunner } from '../helpers/algorithm-runner'
import { ManualClock } from '../helpers/manual-clock'

const createRunner = (start = 10_000) => {
  const clock = new ManualClock(start)
  const runner = new AlgorithmRunner(new FixedWindow({ limit: 3, windowMs: 1_000 }), clock)
  return { clock, runner }
}

describe('FixedWindow', () => {
  test('allows the first request', () => {
    const { runner } = createRunner()
    const { decision, state, ttlMs } = runner.consume()
    expect(decision).toEqual({ allowed: true, limit: 3, remaining: 2, resetAt: 11_000, retryAfterMs: 0 })
    expect(state).toEqual({ windowStart: 10_000, count: 1 })
    expect(ttlMs).toBe(1_000)
  })

  test('fills up to the limit, then denies without counting the denial', () => {
    const { clock, runner } = createRunner()
    const remaining = runner.consumeTimes(3).map(({ decision }) => decision.remaining)
    expect(remaining).toEqual([2, 1, 0])
    clock.advance(400)
    const { decision, state } = runner.consume()
    expect(decision).toEqual({ allowed: false, limit: 3, remaining: 0, resetAt: 11_000, retryAfterMs: 600 })
    expect(state.count).toBe(3)
  })

  test('allows the next request after exactly retryAfterMs', () => {
    const { clock, runner } = createRunner(10_250)
    runner.consumeTimes(3)
    const denied = runner.consume()
    expect(denied.decision.retryAfterMs).toBe(750)
    clock.advance(denied.decision.retryAfterMs - 1)
    expect(runner.peek().decision.allowed).toBe(false)
    clock.advance(1)
    expect(runner.consume().decision).toMatchObject({ allowed: true, remaining: 2, resetAt: 12_000 })
  })

  test('aligns windows to the clock and starts a fresh count on rollover', () => {
    const { clock, runner } = createRunner(10_999)
    runner.consumeTimes(3)
    expect(runner.consume().decision.allowed).toBe(false)
    clock.advance(1)
    const { decision, state } = runner.consume()
    expect(decision).toMatchObject({ allowed: true, remaining: 2, resetAt: 12_000 })
    expect(state).toEqual({ windowStart: 11_000, count: 1 })
  })

  test('resets a count stored for an older window', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(3)
    clock.advance(5_000)
    expect(runner.consume().decision).toMatchObject({ allowed: true, remaining: 2 })
  })

  test('charges costs above 1', () => {
    const { runner } = createRunner()
    expect(runner.consume(2).decision).toMatchObject({ allowed: true, remaining: 1 })
    expect(runner.consume(2).decision).toMatchObject({ allowed: false, remaining: 1 })
    expect(runner.consume(1).decision).toMatchObject({ allowed: true, remaining: 0 })
  })

  test('keeps the ttl at least 1ms at the last moment of a window', () => {
    const { runner } = createRunner(10_999)
    expect(runner.consume().ttlMs).toBe(1)
  })

  test('never reports negative remaining for an over-limit stored count', () => {
    const algorithm = new FixedWindow({ limit: 3, windowMs: 1_000 })
    const { decision } = algorithm.evaluate({ windowStart: 10_000, count: 50 }, 10_000, 1)
    expect(decision).toMatchObject({ allowed: false, remaining: 0 })
  })

  test('validates stored state with its schema', () => {
    const { stateSchema } = new FixedWindow({ limit: 3, windowMs: 1_000 })
    expect(stateSchema.safeParse({ windowStart: 0, count: 2 }).success).toBe(true)
    for (const value of [null, {}, { windowStart: -1, count: 0 }, { windowStart: 0, count: 1.5 }, { windowStart: '0', count: 0 }]) {
      expect(stateSchema.safeParse(value).success).toBe(false)
    }
  })
})

describe('FixedWindow with clock skew between servers', () => {
  const algorithm = new FixedWindow({ limit: 3, windowMs: 1_000 })

  test('keeps counting a window stored up to one window ahead', () => {
    const { state, decision, ttlMs } = algorithm.evaluate({ windowStart: 11_000, count: 3 }, 10_900, 1)
    expect(decision).toEqual({ allowed: false, limit: 3, remaining: 0, resetAt: 12_000, retryAfterMs: 1_100 })
    expect(state).toEqual({ windowStart: 11_000, count: 3 })
    expect(ttlMs).toBe(1_100)
  })

  test('starts fresh when the stored window is further ahead than one window', () => {
    const { state, decision } = algorithm.evaluate({ windowStart: 12_000, count: 3 }, 10_900, 1)
    expect(decision.allowed).toBe(true)
    expect(state).toEqual({ windowStart: 10_000, count: 1 })
  })
})
