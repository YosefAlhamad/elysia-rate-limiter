import { describe, expect, test } from 'bun:test'
import { TokenBucket } from '../../src/algorithms/token-bucket'
import { AlgorithmRunner } from '../helpers/algorithm-runner'
import { ManualClock } from '../helpers/manual-clock'

const createRunner = (start = 10_000) => {
  const clock = new ManualClock(start)
  const runner = new AlgorithmRunner(new TokenBucket({ limit: 10, windowMs: 1_000 }), clock)
  return { clock, runner }
}

describe('TokenBucket', () => {
  test('starts full and allows the first request', () => {
    const { runner } = createRunner()
    const { decision, state, ttlMs } = runner.consume()
    expect(decision).toEqual({ allowed: true, limit: 10, remaining: 9, resetAt: 10_100, retryAfterMs: 0 })
    expect(state).toEqual({ tokens: 9, updatedAt: 10_000 })
    expect(ttlMs).toBe(100)
  })

  test('allows a burst up to the limit, then denies without spending tokens', () => {
    const { runner } = createRunner()
    const remaining = runner.consumeTimes(10).map(({ decision }) => decision.remaining)
    expect(remaining).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const { decision, state } = runner.consume()
    expect(decision).toEqual({ allowed: false, limit: 10, remaining: 0, resetAt: 11_000, retryAfterMs: 100 })
    expect(state.tokens).toBe(0)
  })

  test('allows the next request after exactly retryAfterMs', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    const denied = runner.consume()
    clock.advance(denied.decision.retryAfterMs - 1)
    expect(runner.peek().decision.allowed).toBe(false)
    clock.advance(1)
    expect(runner.consume().decision).toMatchObject({ allowed: true, remaining: 0 })
  })

  test('refills evenly over the window with fractional tokens', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.advance(350)
    const { decision, state } = runner.consume()
    expect(state.tokens).toBeCloseTo(2.5)
    expect(decision).toMatchObject({ allowed: true, remaining: 2, resetAt: 10_350 + 750 })
  })

  test('never refills above the limit', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(5)
    clock.advance(60_000)
    expect(runner.consume().decision.remaining).toBe(9)
  })

  test('charges costs above 1 and computes the wait for the full cost', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.advance(250)
    const denied = runner.consume(3)
    expect(denied.decision).toMatchObject({ allowed: false, remaining: 2, retryAfterMs: 50 })
    clock.advance(50)
    expect(runner.consume(3).decision).toMatchObject({ allowed: true, remaining: 0 })
  })

  test('never adds tokens when the clock moves backwards', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.advance(500)
    expect(runner.consume().state.tokens).toBeCloseTo(4)
    clock.set(1_000)
    const { decision, state } = runner.consume()
    expect(state.tokens).toBeCloseTo(3)
    expect(decision.remaining).toBe(3)
    clock.set(0)
    expect(runner.consumeTimes(4).map(({ decision }) => decision.allowed)).toEqual([true, true, true, false])
  })

  test('does not refill the same time twice after the clock moves backwards and catches up', () => {
    const { clock, runner } = createRunner()
    runner.consumeTimes(10)
    clock.set(5_000)
    const denied = runner.consume()
    expect(denied.state.updatedAt).toBe(10_000)
    expect(denied.decision).toMatchObject({ allowed: false, retryAfterMs: 5_100, resetAt: 11_000 })
    expect(denied.ttlMs).toBe(6_000)
    clock.set(10_000)
    expect(runner.consume().decision.allowed).toBe(false)
    clock.advance(100)
    expect(runner.consume().decision).toMatchObject({ allowed: true, remaining: 0 })
  })

  test('keeps the ttl at least 1ms when the bucket is full', () => {
    const algorithm = new TokenBucket({ limit: 10, windowMs: 1_000 })
    const { ttlMs, decision } = algorithm.evaluate({ tokens: 10, updatedAt: 0 }, 5_000, 0)
    expect(ttlMs).toBe(1)
    expect(decision.resetAt).toBe(5_000)
  })

  test('validates stored state with its schema', () => {
    const { stateSchema } = new TokenBucket({ limit: 10, windowMs: 1_000 })
    expect(stateSchema.safeParse({ tokens: 2.5, updatedAt: 0 }).success).toBe(true)
    for (const value of [null, { tokens: 1 }, { tokens: -1, updatedAt: 0 }, { tokens: Number.POSITIVE_INFINITY, updatedAt: 0 }, { tokens: 1, updatedAt: 0.5 }]) {
      expect(stateSchema.safeParse(value).success).toBe(false)
    }
  })
})
