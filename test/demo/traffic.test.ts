import { describe, expect, test } from 'bun:test'
import { formatNumber, formatPercent, formatSeconds } from '../../demo/src/lab/format'
import { parseLabPolicy } from '../../demo/src/lab/lab-policy'
import { TimeAccumulator } from '../../demo/src/lab/time-accumulator'
import { BoundaryBurstScenario, BurstScenario, SCENARIOS, SustainedOverloadScenario } from '../../demo/src/lab/traffic/scenarios'
import { SeededRandom } from '../../demo/src/lab/traffic/seeded-random'
import { SteadyTraffic } from '../../demo/src/lab/traffic/steady-traffic'

const POLICY = parseLabPolicy({ limit: 4, windowMs: 2_000 })

describe('SteadyTraffic', () => {
  test('rejects a rate that is not above 0', () => {
    expect(() => new SteadyTraffic(0, new SeededRandom(1))).toThrow(RangeError)
  })

  test('produces roughly the requested rate across continuous calls', () => {
    const traffic = new SteadyTraffic(4, new SeededRandom(3))
    const arrivals: number[] = []
    for (let from = 0; from < 60_000; from += 16) arrivals.push(...traffic.arrivalsBetween(from, from + 16))
    expect(arrivals.length).toBeGreaterThan(200)
    expect(arrivals.length).toBeLessThan(280)
    expect(arrivals).toEqual([...arrivals].sort((left, right) => left - right))
  })

  test('restarts its schedule when time jumps', () => {
    const traffic = new SteadyTraffic(10, new SeededRandom(5))
    traffic.arrivalsBetween(0, 10_000)
    const afterJump = traffic.arrivalsBetween(0, 1_000)
    expect(afterJump.length).toBeGreaterThan(0)
    expect(afterJump.every((at) => at > 0 && at <= 1_000)).toBe(true)
  })
})

describe('scenarios', () => {
  test('burst sends twice the limit within half a second', () => {
    const arrivals = new BurstScenario().arrivals(1_000, POLICY)
    expect(arrivals).toHaveLength(8)
    expect(arrivals[0]).toBe(1_000)
    expect(arrivals.at(-1)).toBeLessThan(1_500)
  })

  test('boundary trick straddles the next window boundary', () => {
    const scenario = new BoundaryBurstScenario()
    const arrivals = scenario.arrivals(100, POLICY)
    expect(arrivals.filter((at) => at < 2_000)).toHaveLength(4)
    expect(arrivals.filter((at) => at > 2_000 && at < 2_500)).toHaveLength(4)
    expect(scenario.arrivals(1_500, POLICY).every((at) => at > 3_000)).toBe(true)
  })

  test('sustained overload spreads 1.5× the rate over two windows', () => {
    const arrivals = new SustainedOverloadScenario().arrivals(0, POLICY)
    expect(arrivals).toHaveLength(12)
    expect(arrivals.at(-1)).toBeLessThan(4_000)
  })

  test('scenarios have unique ids', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length)
  })
})

describe('TimeAccumulator', () => {
  test('hands out whole milliseconds and carries the rest', () => {
    const accumulator = new TimeAccumulator()
    expect([0.4, 0.4, 0.4, 16.7].map((ms) => accumulator.take(ms))).toEqual([0, 0, 1, 16])
    expect(accumulator.take(-5)).toBe(0)
    expect(accumulator.take(Number.NaN)).toBe(0)
  })
})

describe('format', () => {
  test('formats numbers, seconds and percentages for display', () => {
    expect(formatNumber(1.23456)).toBe('1.23')
    expect(formatNumber(2)).toBe('2')
    expect(formatSeconds(1_250)).toBe('1.25s')
    expect(formatPercent(0.756)).toBe('76%')
  })
})
