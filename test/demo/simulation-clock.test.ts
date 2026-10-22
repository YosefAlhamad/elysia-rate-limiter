import { describe, expect, test } from 'bun:test'
import { SimulationClock, isControllableClock } from '../../demo/src/lab/simulation-clock'

describe('SimulationClock', () => {
  test('starts where asked, then sets and advances', () => {
    const clock = new SimulationClock(100)
    clock.advance(50)
    expect(clock.now()).toBe(150)
    clock.set(10)
    expect(clock.now()).toBe(10)
    expect(new SimulationClock().now()).toBe(0)
  })
})

describe('isControllableClock', () => {
  test('requires now, set and advance', () => {
    expect(isControllableClock(new SimulationClock())).toBe(true)
    expect(isControllableClock(null)).toBe(false)
    expect(isControllableClock({ set: () => undefined })).toBe(false)
    expect(isControllableClock({ now: () => 0 })).toBe(false)
    expect(isControllableClock({ now: () => 0, set: () => undefined })).toBe(false)
  })
})
