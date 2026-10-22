import type { LabPolicy } from '../lab-policy'

export interface Scenario {
  readonly id: string
  readonly title: string
  readonly description: string
  arrivals(now: number, policy: LabPolicy): readonly number[]
}

const evenlySpaced = (start: number, count: number, spacing: number): readonly number[] =>
  Array.from({ length: count }, (_, index) => Math.round(start + index * spacing))

export class BurstScenario implements Scenario {
  readonly id = 'burst'
  readonly title = 'Sudden burst'
  readonly description = 'Twice the limit arrives within half a second. See who absorbs it and how fast each recovers.'

  arrivals(now: number, { limit }: LabPolicy): readonly number[] {
    const count = limit * 2
    return evenlySpaced(now, count, 500 / count)
  }
}

export class BoundaryBurstScenario implements Scenario {
  readonly id = 'boundary'
  readonly title = 'Window boundary trick'
  readonly description =
    'A full limit just before a window resets, then another just after. The fixed window lets 2× the limit through.'

  arrivals(now: number, { limit, windowMs }: LabPolicy): readonly number[] {
    const boundary = this.nextBoundary(now, windowMs)
    const spacing = 400 / limit
    return [...evenlySpaced(boundary - 500, limit, spacing), ...evenlySpaced(boundary + 50, limit, spacing)]
  }

  private nextBoundary(now: number, windowMs: number): number {
    const boundary = Math.ceil((now + 1) / windowMs) * windowMs
    return boundary - now < 700 ? boundary + windowMs : boundary
  }
}

export class SustainedOverloadScenario implements Scenario {
  readonly id = 'overload'
  readonly title = 'Sustained overload'
  readonly description = 'Traffic at 1.5× the allowed rate for two windows. Compare how evenly each one spreads the allowed requests.'

  arrivals(now: number, { limit, windowMs }: LabPolicy): readonly number[] {
    const count = Math.ceil(limit * 3)
    return evenlySpaced(now, count, (2 * windowMs) / count)
  }
}

export const SCENARIOS: readonly Scenario[] = [new BurstScenario(), new BoundaryBurstScenario(), new SustainedOverloadScenario()]
