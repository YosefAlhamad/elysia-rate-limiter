import { describe, expect, test } from 'bun:test'
import { RateLimiterConfigError } from '../../src/errors'
import { SimulationClock } from '../../demo/src/lab/simulation-clock'
import { RateLimitLab } from '../../demo/src/lab/rate-limit-lab'
import type { TrafficSource } from '../../demo/src/lab/traffic/traffic-source'

const createLab = (historySize = 300): RateLimitLab => new RateLimitLab({ policy: { limit: 3, windowMs: 2_000 }, historySize })

const verdicts = (lab: RateLimitLab, name: 'fixed-window' | 'sliding-window' | 'token-bucket'): boolean[] =>
  lab.snapshot().lanes[name].requests.map((record) => record.evaluation.decision.allowed)

class FixedTraffic implements TrafficSource {
  constructor(private readonly times: readonly number[]) {}

  arrivalsBetween(fromMs: number, toMs: number): readonly number[] {
    return this.times.filter((at) => at > fromMs && at <= toMs)
  }
}

describe('RateLimitLab', () => {
  test('validates its options', () => {
    expect(() => new RateLimitLab({ policy: { limit: 0, windowMs: 2_000 } })).toThrow(RateLimiterConfigError)
    expect(() => new RateLimitLab({ policy: { limit: 3, windowMs: 100 } })).toThrow(RateLimiterConfigError)
    expect(() => createLab(0)).toThrow(RateLimiterConfigError)
    expect(createLab().policy).toEqual({ limit: 3, windowMs: 2_000 })
  })

  test('sends every request to all three algorithms with the same id and time', () => {
    const clock = new SimulationClock(500)
    const lab = new RateLimitLab({ policy: { limit: 3, windowMs: 2_000 }, clock })
    lab.send()
    const { lanes, now } = lab.snapshot()
    expect(now).toBe(500)
    for (const lane of Object.values(lanes)) {
      expect(lane.latest).toMatchObject({ id: 1, at: 500, cost: 1 })
      expect(lane.totals).toEqual({ allowed: 1, denied: 0 })
    }
  })

  test('each lane keeps its own verdicts and totals', () => {
    const lab = createLab()
    for (let index = 0; index < 4; index += 1) lab.send()
    expect(verdicts(lab, 'fixed-window')).toEqual([true, true, true, false])
    expect(lab.snapshot().lanes['token-bucket'].totals).toEqual({ allowed: 3, denied: 1 })
    expect(lab.snapshot().lanes['fixed-window'].preview.allowed).toBe(false)
  })

  test('rejects bad costs and bad time steps', () => {
    const lab = createLab()
    expect(() => lab.send(0)).toThrow(RangeError)
    expect(() => lab.send(4)).toThrow(RangeError)
    expect(() => lab.advance(-1)).toThrow(RangeError)
    expect(() => lab.advance(1.5)).toThrow(RangeError)
  })

  test('scheduled arrivals fire at their exact time while advancing', () => {
    const lab = createLab()
    lab.advance(100)
    lab.schedule([50, 300, 250, 1.5, 5_000])
    expect(lab.snapshot().pendingArrivals).toBe(3)
    lab.advance(400)
    expect(lab.snapshot().lanes['fixed-window'].requests.map((record) => record.at)).toEqual([250, 300])
    expect(lab.snapshot()).toMatchObject({ now: 500, pendingArrivals: 1 })
  })

  test('traffic sources add arrivals until removed', () => {
    const lab = createLab()
    lab.setTraffic(new FixedTraffic([100, 200, 900]))
    lab.advance(500)
    expect(lab.snapshot().lanes['sliding-window'].requests.map((record) => record.at)).toEqual([100, 200])
    lab.setTraffic(undefined)
    lab.advance(500)
    expect(lab.snapshot().lanes['sliding-window'].requests).toHaveLength(2)
  })

  test('reset and configure start over at time zero', () => {
    const lab = createLab()
    lab.advance(700)
    lab.send()
    lab.schedule([800])
    lab.reset()
    expect(lab.snapshot()).toMatchObject({ now: 0, pendingArrivals: 0 })
    expect(lab.snapshot().lanes['fixed-window'].requests).toEqual([])
    lab.configure({ limit: 5, windowMs: 4_000 })
    expect(lab.snapshot().policy).toEqual({ limit: 5, windowMs: 4_000 })
    lab.send()
    expect(lab.snapshot().lanes['token-bucket'].latest?.id).toBe(1)
  })

  test('keeps a bounded history per lane', () => {
    const lab = createLab(2)
    lab.send()
    lab.send()
    lab.send()
    expect(lab.snapshot().lanes['fixed-window'].requests.map((record) => record.id)).toEqual([2, 3])
  })

  test('publishes a new snapshot and notifies until unsubscribed', () => {
    const lab = createLab()
    const first = lab.snapshot()
    let calls = 0
    const unsubscribe = lab.subscribe(() => {
      calls += 1
    })
    lab.send()
    expect(lab.snapshot()).not.toBe(first)
    expect(lab.snapshot().version).toBe(first.version + 1)
    unsubscribe()
    lab.send()
    expect(calls).toBe(1)
  })
})
