import { describe, expect, test } from 'bun:test'
import type { AlgorithmName } from '../../src/algorithms/algorithm'
import { AlgorithmFactory } from '../../src/algorithms/algorithm-factory'
import { FixedWindow } from '../../src/algorithms/fixed-window'
import { SlidingWindow } from '../../src/algorithms/sliding-window'
import { TokenBucket } from '../../src/algorithms/token-bucket'
import { AlgorithmRunner } from '../helpers/algorithm-runner'
import { ManualClock } from '../helpers/manual-clock'

const ALGORITHMS = [
  ['fixed-window', FixedWindow],
  ['sliding-window', SlidingWindow],
  ['token-bucket', TokenBucket],
] as const

const LIMITS = [1, 3, 7, 10, 100]
const WINDOWS_MS = [7, 1_000, 60_000]
const STARTS = [0, 1_234, 999_999_937]

describe('AlgorithmFactory', () => {
  test.each(ALGORITHMS)('creates %s', (name, AlgorithmClass) => {
    const algorithm = AlgorithmFactory.create(name, { limit: 5, windowMs: 1_000 })
    expect(algorithm).toBeInstanceOf(AlgorithmClass)
    expect(algorithm.name).toBe(name)
  })

  test('applies the policy to the created algorithm', () => {
    const algorithm = AlgorithmFactory.create('fixed-window', { limit: 2, windowMs: 1_000 })
    expect(algorithm.evaluate(undefined, 0, 1).decision).toMatchObject({ limit: 2, remaining: 1, resetAt: 1_000 })
  })

  test('rejects unknown names', () => {
    const name = 'leaky-bucket' as AlgorithmName
    expect(() => AlgorithmFactory.create(name, { limit: 5, windowMs: 1_000 })).toThrow(RangeError)
  })
})

describe('retryAfterMs accuracy across policies', () => {
  test.each(ALGORITHMS)('%s allows exactly retryAfterMs after a denial', (name) => {
    for (const limit of LIMITS) {
      for (const windowMs of WINDOWS_MS) {
        for (const start of STARTS) {
          const clock = new ManualClock(start)
          const runner = new AlgorithmRunner(AlgorithmFactory.create(name, { limit, windowMs }), clock)
          const cost = Math.min(2, limit)
          runner.consumeTimes(limit + 1, cost)
          const { retryAfterMs } = runner.consume(cost).decision
          expect(retryAfterMs).toBeGreaterThan(0)
          expect(Number.isInteger(retryAfterMs)).toBe(true)
          clock.advance(retryAfterMs - 1)
          if (retryAfterMs > 1) expect(runner.peek(cost).decision.allowed).toBe(false)
          clock.advance(1)
          expect(runner.consume(cost).decision.allowed).toBe(true)
        }
      }
    }
  })
})
