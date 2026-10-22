import type { z } from 'zod'
import type { AlgorithmPolicy } from '../../../../src/algorithms/algorithm'
import { SlidingWindow, type SlidingWindowState } from '../../../../src/algorithms/sliding-window'
import { formatNumber as n, formatPercent, formatSeconds as s } from '../format'
import type { RequestRecord } from '../request-record'
import { type AlgorithmInsight, type Explanation, type ExplanationStep, infoStep, verdictStep } from './explanation'

export interface SlidingWindowView {
  readonly windowStart: number
  readonly previous: number
  readonly current: number
  readonly elapsed: number
  readonly weight: number
  readonly estimate: number
  readonly limit: number
}

type RollKind = 'empty' | 'same' | 'shifted' | 'expired'

interface Rolled {
  readonly kind: RollKind
  readonly counters: SlidingWindowState
}

export class SlidingWindowInsight implements AlgorithmInsight<SlidingWindowView> {
  private readonly schema: z.ZodType<SlidingWindowState>

  constructor(private readonly policy: AlgorithmPolicy) {
    this.schema = new SlidingWindow(policy).stateSchema
  }

  view(state: unknown, now: number): SlidingWindowView {
    const { windowStart, current, previous } = this.roll(this.parse(state), now).counters
    const elapsed = Math.max(0, now - windowStart)
    return {
      windowStart,
      previous,
      current,
      elapsed,
      weight: this.weight(elapsed),
      estimate: this.estimate(previous, current, elapsed),
      limit: this.policy.limit,
    }
  }

  explain(record: RequestRecord): Explanation {
    const rolled = this.roll(this.parse(record.stateBefore), record.at)
    const { windowStart, current, previous } = rolled.counters
    const elapsed = Math.max(0, record.at - windowStart)
    const estimate = this.estimate(previous, current, elapsed)
    const allowed = estimate + record.cost <= this.policy.limit
    const steps = [
      this.windowStep(record.at, windowStart),
      this.rollStep(rolled),
      this.weightStep(elapsed),
      infoStep('Estimate the rolling count', 'estimate = previous × weight + current', `${previous} × ${n(this.weight(elapsed))} + ${current} = ${n(estimate)}`),
      this.checkStep(estimate, record.cost, allowed),
      this.outcomeStep(record, current),
    ]
    return { allowed, steps }
  }

  private windowStep(now: number, windowStart: number): ExplanationStep {
    const window = s(this.policy.windowMs)
    return infoStep('Find the current window', 'windowStart = ⌊now ÷ window⌋ × window', `⌊${s(now)} ÷ ${window}⌋ × ${window} = ${s(windowStart)}`)
  }

  private rollStep({ kind, counters }: Rolled): ExplanationStep {
    const details = new Map<RollKind, string>([
      ['empty', 'Nothing is stored for this client yet, so both counts start at 0.'],
      ['same', `Same window as last time: previous = ${counters.previous}, current = ${counters.current}.`],
      ['shifted', `A new window started. The old current count (${counters.previous}) becomes previous, and current starts at 0.`],
      ['expired', 'More than a whole window has passed since the last request, so both counts reset to 0.'],
    ])
    return infoStep('Roll the counters forward', 'previous, current', details.get(kind) ?? '')
  }

  private weightStep(elapsed: number): ExplanationStep {
    const { windowMs } = this.policy
    return infoStep(
      'Weigh the previous window',
      'weight = (window − elapsed) ÷ window',
      `(${s(windowMs)} − ${s(elapsed)}) ÷ ${s(windowMs)} = ${n(this.weight(elapsed))}. ${formatPercent(this.weight(elapsed))} of the previous window still overlaps the rolling window.`,
    )
  }

  private checkStep(estimate: number, cost: number, allowed: boolean): ExplanationStep {
    return verdictStep(
      'Compare with the limit',
      'estimate + cost ≤ limit',
      `${n(estimate)} + ${cost} = ${n(estimate + cost)} ${allowed ? '≤' : '>'} ${this.policy.limit}`,
      allowed,
    )
  }

  private outcomeStep(record: RequestRecord, current: number): ExplanationStep {
    const { decision } = record.evaluation
    if (decision.allowed) {
      return verdictStep('Allow and count it', 'current = current + cost', `current is now ${current + record.cost}. About ${decision.remaining} more fit right now.`, true)
    }
    return verdictStep(
      'Reject with 429',
      'Retry-After = time until the estimate drops',
      `As the previous window slides out, the estimate falls. There is room again in ${s(decision.retryAfterMs)}.`,
      false,
    )
  }

  private roll(stored: SlidingWindowState | undefined, now: number): Rolled {
    const { windowMs } = this.policy
    const windowStart = Math.floor(now / windowMs) * windowMs
    if (stored === undefined) return { kind: 'empty', counters: { windowStart, current: 0, previous: 0 } }
    if (stored.windowStart === windowStart) return { kind: 'same', counters: stored }
    if (stored.windowStart === windowStart - windowMs) {
      return { kind: 'shifted', counters: { windowStart, current: 0, previous: stored.current } }
    }
    return { kind: 'expired', counters: { windowStart, current: 0, previous: 0 } }
  }

  private weight(elapsed: number): number {
    return (this.policy.windowMs - elapsed) / this.policy.windowMs
  }

  private estimate(previous: number, current: number, elapsed: number): number {
    const { windowMs } = this.policy
    return (previous * (windowMs - elapsed)) / windowMs + current
  }

  private parse(state: unknown): SlidingWindowState | undefined {
    const result = this.schema.safeParse(state)
    return result.success ? result.data : undefined
  }
}
