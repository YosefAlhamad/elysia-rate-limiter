import { describe, expect, test } from 'bun:test'
import type { AlgorithmName, Evaluation } from '../../src/algorithms/algorithm'
import { AlgorithmFactory } from '../../src/algorithms/algorithm-factory'

const ALGORITHMS: readonly AlgorithmName[] = ['fixed-window', 'sliding-window', 'token-bucket']
const SCENARIOS = 3_000
const STEPS = 25

class SeededRandom {
  constructor(private seed: number) {}

  below(bound: number): number {
    this.seed = (this.seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return Math.floor((this.seed / 2_147_483_648) * bound)
  }
}

interface Violation {
  readonly rule: string
  readonly limit: number
  readonly windowMs: number
  readonly now: number
}

const checkEvaluation = (evaluation: Evaluation<unknown>, limit: number): string[] => {
  const { ttlMs, decision } = evaluation
  const rules: string[] = []
  if (!Number.isInteger(ttlMs) || ttlMs < 1) rules.push('ttlMs is a whole number of at least 1')
  if (!Number.isInteger(decision.retryAfterMs)) rules.push('retryAfterMs is a whole number')
  if (decision.remaining < 0 || decision.remaining > limit) rules.push('remaining stays between 0 and limit')
  if (!decision.allowed && decision.retryAfterMs < 1) rules.push('a denial waits at least 1ms')
  return rules
}

const findViolations = (name: AlgorithmName, seed: number): Violation[] => {
  const random = new SeededRandom(seed)
  const violations: Violation[] = []
  for (let scenario = 0; scenario < SCENARIOS; scenario += 1) {
    const limit = 1 + random.below(scenario % 2 === 0 ? 7 : 1_000)
    const windowMs = 1 + random.below(scenario % 5 === 0 ? 100_000 : 997)
    const algorithm = AlgorithmFactory.create(name, { limit, windowMs })
    let state: unknown
    let now = random.below(10_000_000)
    for (let step = 0; step < STEPS; step += 1) {
      const cost = 1 + random.below(limit)
      const evaluation = algorithm.evaluate(state, now, cost)
      const report = (rule: string) => violations.push({ rule, limit, windowMs, now })
      checkEvaluation(evaluation, limit).forEach(report)
      if (!algorithm.stateSchema.safeParse(evaluation.state).success) report('state passes its own schema')
      const { allowed, retryAfterMs } = evaluation.decision
      if (!allowed && !algorithm.evaluate(evaluation.state, now + retryAfterMs, cost).decision.allowed) {
        report('the same request is allowed after exactly retryAfterMs')
      }
      if (!allowed && retryAfterMs > 1 && algorithm.evaluate(evaluation.state, now + retryAfterMs - 1, cost).decision.allowed) {
        report('the same request is still denied 1ms before retryAfterMs')
      }
      state = evaluation.state
      now += random.below(3) === 0 ? 0 : random.below(Math.ceil(windowMs / 2) + 1)
    }
  }
  return violations
}

describe.each(ALGORITHMS)('%s properties over random traffic', (name) => {
  test.each([1, 7, 42])('holds every invariant with seed %p', (seed) => {
    expect(findViolations(name, seed).slice(0, 5)).toEqual([])
  })
})
