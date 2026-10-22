import { describe, expect, test } from 'bun:test'
import type { AlgorithmName, AlgorithmPolicy } from '../../src/algorithms/algorithm'
import { AlgorithmFactory } from '../../src/algorithms/algorithm-factory'
import { AlgorithmLane } from '../../demo/src/lab/algorithm-lane'
import type { AlgorithmInsight } from '../../demo/src/lab/insights/explanation'
import { FixedWindowInsight } from '../../demo/src/lab/insights/fixed-window-insight'
import { SlidingWindowInsight } from '../../demo/src/lab/insights/sliding-window-insight'
import { TokenBucketInsight } from '../../demo/src/lab/insights/token-bucket-insight'
import type { RequestRecord } from '../../demo/src/lab/request-record'
import { SeededRandom } from '../../demo/src/lab/traffic/seeded-random'

const POLICY: AlgorithmPolicy = { limit: 3, windowMs: 1_000 }

const insights = new Map<AlgorithmName, (policy: AlgorithmPolicy) => AlgorithmInsight<unknown>>([
  ['fixed-window', (policy) => new FixedWindowInsight(policy)],
  ['sliding-window', (policy) => new SlidingWindowInsight(policy)],
  ['token-bucket', (policy) => new TokenBucketInsight(policy)],
])

const replay = (name: AlgorithmName, policy: AlgorithmPolicy, times: readonly number[], cost = 1): RequestRecord[] => {
  const lane = new AlgorithmLane(AlgorithmFactory.create(name, policy), 1_000)
  return times.map((at, index) => lane.send(index + 1, at, cost))
}

const insightFor = (name: AlgorithmName, policy: AlgorithmPolicy): AlgorithmInsight<unknown> => {
  const create = insights.get(name)
  if (create === undefined) throw new Error(`No insight for ${name}`)
  return create(policy)
}

const findMismatch = (name: AlgorithmName, seed: number): RequestRecord | undefined => {
  const random = new SeededRandom(seed)
  for (let scenario = 0; scenario < 400; scenario += 1) {
    const policy = { limit: 1 + Math.floor(random.next() * 20), windowMs: 2_000 + Math.floor(random.next() * 28_000) }
    const insight = insightFor(name, policy)
    let at = Math.floor(random.next() * 50_000)
    const times = Array.from({ length: 30 }, () => (at += Math.floor(random.next() * policy.windowMs * 0.6)))
    const cost = 1 + Math.floor(random.next() * policy.limit)
    const mismatch = replay(name, policy, times, cost).find(
      (record) => insight.explain(record).allowed !== record.evaluation.decision.allowed,
    )
    if (mismatch !== undefined) return mismatch
  }
  return undefined
}

describe('insights agree with the real algorithms', () => {
  for (const name of insights.keys()) {
    test(`${name} explanations reach the same verdict as evaluate()`, () => {
      expect(findMismatch(name, 17)).toBeUndefined()
      expect(findMismatch(name, 2_024)).toBeUndefined()
    })
  }

  test('every explanation ends with a verdict step matching the decision', () => {
    for (const name of insights.keys()) {
      const insight = insightFor(name, POLICY)
      for (const record of replay(name, POLICY, [0, 10, 20, 30, 1_500, 4_000])) {
        const last = insight.explain(record).steps.at(-1)
        expect(last?.tone).toBe(record.evaluation.decision.allowed ? 'allowed' : 'denied')
      }
    }
  })
})

describe('FixedWindowInsight', () => {
  const insight = new FixedWindowInsight(POLICY)

  test('explains a fresh, a carried over, a denied and a reset counter', () => {
    const [first, second, , denied, afterReset] = replay('fixed-window', POLICY, [100, 200, 300, 400, 1_100])
    const details = (record: RequestRecord | undefined): string[] =>
      record === undefined ? [] : insight.explain(record).steps.map((step) => step.detail)
    expect(details(first)[1]).toContain('starts at 0')
    expect(details(second)[1]).toContain('stored count of 1 carries over')
    expect(details(denied)[2]).toBe('3 + 1 = 4 > 3')
    expect(details(denied)[3]).toContain('1s − 0.4s = 0.6s')
    expect(details(afterReset)[1]).toContain('window at 0s, which has ended')
  })

  test('view shows the live window', () => {
    const [record] = replay('fixed-window', POLICY, [250])
    expect(insight.view(record?.evaluation.state, 750)).toEqual({
      windowStart: 0,
      windowEnd: 1_000,
      count: 1,
      limit: 3,
      progress: 0.75,
      msUntilReset: 250,
    })
    expect(insight.view(record?.evaluation.state, 1_200).count).toBe(0)
    expect(insight.view('garbage', 0).count).toBe(0)
  })
})

describe('SlidingWindowInsight', () => {
  const insight = new SlidingWindowInsight(POLICY)

  test('explains every way the counters can roll', () => {
    const records = replay('sliding-window', POLICY, [100, 200, 1_250, 1_300, 1_400, 5_000])
    const rollDetails = records.map((record) => insight.explain(record).steps[1]?.detail ?? '')
    expect(rollDetails[0]).toContain('both counts start at 0')
    expect(rollDetails[1]).toContain('previous = 0, current = 1')
    expect(rollDetails[2]).toContain('old current count (2) becomes previous')
    expect(rollDetails[5]).toContain('both counts reset to 0')
  })

  test('shows the weighted estimate and a denial', () => {
    const records = replay('sliding-window', POLICY, [100, 200, 300, 1_250, 1_300])
    const shifted = records[3]
    const denied = records[4]
    if (shifted === undefined || denied === undefined) throw new Error('missing records')
    expect(insight.explain(shifted).steps[2]?.detail).toContain('75% of the previous window')
    expect(insight.explain(shifted).steps[3]?.detail).toBe('3 × 0.75 + 0 = 2.25')
    expect(insight.explain(denied).allowed).toBe(false)
    expect(insight.explain(denied).steps.at(-1)?.title).toBe('Reject with 429')
  })

  test('view reports the live estimate', () => {
    const records = replay('sliding-window', POLICY, [100, 200])
    expect(insight.view(records[1]?.evaluation.state, 1_500)).toMatchObject({ previous: 2, current: 0, weight: 0.5, estimate: 1 })
  })
})

describe('TokenBucketInsight', () => {
  const insight = new TokenBucketInsight(POLICY)

  test('explains a new bucket, a refill and a denial', () => {
    const records = replay('token-bucket', POLICY, [0, 0, 0, 0, 500])
    const titles = (index: number): string[] => {
      const record = records[index]
      return record === undefined ? [] : insight.explain(record).steps.map((step) => step.title)
    }
    expect(titles(0)[0]).toBe('Open a new bucket')
    expect(titles(3)).toContain('Reject with 429')
    const refill = records[4]
    if (refill === undefined) throw new Error('missing record')
    const details = insight.explain(refill).steps.map((step) => step.detail)
    expect(details[0]).toBe('0.5s − 0s = 0.5s')
    expect(details[1]).toBe('0.5s × 3 ÷ 1s = 1.5 tokens')
    expect(details[2]).toBe('min(3, 0 + 1.5) = 1.5')
    expect(details.at(-1)).toBe('1.5 − 1 = 0.5 tokens left.')
  })

  test('view refills continuously', () => {
    const records = replay('token-bucket', POLICY, [0, 0, 0])
    expect(insight.view(records[2]?.evaluation.state, 500)).toEqual({ tokens: 1.5, limit: 3, msPerToken: 1_000 / 3, msUntilFull: 500 })
    expect(insight.view(undefined, 0).tokens).toBe(3)
  })
})
