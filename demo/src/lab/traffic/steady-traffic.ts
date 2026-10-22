import type { SeededRandom } from './seeded-random'
import type { TrafficSource } from './traffic-source'

const MS_PER_SECOND = 1_000
const MAX_ARRIVALS_PER_CALL = 500

export class SteadyTraffic implements TrafficSource {
  private nextAt: number | undefined
  private lastTo: number | undefined

  constructor(
    private readonly ratePerSecond: number,
    private readonly random: SeededRandom,
  ) {
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) throw new RangeError('Traffic rate must be above 0')
  }

  arrivalsBetween(fromMs: number, toMs: number): readonly number[] {
    let nextAt = this.lastTo === fromMs && this.nextAt !== undefined ? this.nextAt : fromMs + this.gap()
    const arrivals: number[] = []
    while (nextAt <= toMs && arrivals.length < MAX_ARRIVALS_PER_CALL) {
      arrivals.push(Math.round(nextAt))
      nextAt += this.gap()
    }
    this.nextAt = nextAt
    this.lastTo = toMs
    return arrivals
  }

  private gap(): number {
    return (MS_PER_SECOND / this.ratePerSecond) * (0.4 + 1.2 * this.random.next())
  }
}
