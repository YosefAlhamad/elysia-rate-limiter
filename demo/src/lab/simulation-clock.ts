import type { Clock } from '../../../src/core/clock'

export interface ControllableClock extends Clock {
  set(ms: number): void
  advance(ms: number): void
}

export class SimulationClock implements ControllableClock {
  private current: number

  constructor(start = 0) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  set(ms: number): void {
    this.current = ms
  }

  advance(ms: number): void {
    this.current += ms
  }
}

export const isControllableClock = (value: unknown): value is ControllableClock => {
  if (typeof value !== 'object' || value === null) return false
  if (!('now' in value) || typeof value.now !== 'function') return false
  if (!('set' in value) || typeof value.set !== 'function') return false
  return 'advance' in value && typeof value.advance === 'function'
}
