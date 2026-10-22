import type { z } from 'zod'
import type { AlgorithmPolicy } from '../../../../src/algorithms/algorithm'
import { FixedWindow, type FixedWindowState } from '../../../../src/algorithms/fixed-window'
import { formatSeconds as s } from '../format'
import type { RequestRecord } from '../request-record'
import { type AlgorithmInsight, type Explanation, type ExplanationStep, infoStep, verdictStep } from './explanation'

export interface FixedWindowView {
  readonly windowStart: number
  readonly windowEnd: number
  readonly count: number
  readonly limit: number
  readonly progress: number
  readonly msUntilReset: number
}

export class FixedWindowInsight implements AlgorithmInsight<FixedWindowView> {
  private readonly schema: z.ZodType<FixedWindowState>

  constructor(private readonly policy: AlgorithmPolicy) {
    this.schema = new FixedWindow(policy).stateSchema
  }

  view(state: unknown, now: number): FixedWindowView {
    const { limit, windowMs } = this.policy
    const windowStart = this.windowStartAt(now)
    return {
      windowStart,
      windowEnd: windowStart + windowMs,
      count: this.countIn(this.parse(state), windowStart),
      limit,
      progress: (now - windowStart) / windowMs,
      msUntilReset: windowStart + windowMs - now,
    }
  }

  explain(record: RequestRecord): Explanation {
    const stored = this.parse(record.stateBefore)
    const windowStart = this.windowStartAt(record.at)
    const count = this.countIn(stored, windowStart)
    const allowed = count + record.cost <= this.policy.limit
    const steps = [
      this.windowStep(record.at, windowStart),
      this.counterStep(stored, windowStart, count),
      this.checkStep(count, record.cost, allowed),
      this.outcomeStep(record, count),
    ]
    return { allowed, steps }
  }

  private windowStep(now: number, windowStart: number): ExplanationStep {
    const window = s(this.policy.windowMs)
    return infoStep(
      'Find the current window',
      'windowStart = ⌊now ÷ window⌋ × window',
      `⌊${s(now)} ÷ ${window}⌋ × ${window} = ${s(windowStart)}, so this window runs until ${s(windowStart + this.policy.windowMs)}.`,
    )
  }

  private counterStep(stored: FixedWindowState | undefined, windowStart: number, count: number): ExplanationStep {
    if (stored === undefined) return infoStep('Load the counter', 'count = 0', 'Nothing is stored for this client yet, so the count starts at 0.')
    if (stored.windowStart === windowStart) {
      return infoStep('Load the counter', 'count = stored count', `Still the same window, so the stored count of ${count} carries over.`)
    }
    return infoStep(
      'Load the counter',
      'count = 0',
      `The stored count belongs to the window at ${s(stored.windowStart)}, which has ended. The counter starts again at 0.`,
    )
  }

  private checkStep(count: number, cost: number, allowed: boolean): ExplanationStep {
    const { limit } = this.policy
    return verdictStep(
      'Compare with the limit',
      'count + cost ≤ limit',
      `${count} + ${cost} = ${count + cost} ${allowed ? '≤' : '>'} ${limit}`,
      allowed,
    )
  }

  private outcomeStep(record: RequestRecord, count: number): ExplanationStep {
    const { decision } = record.evaluation
    if (decision.allowed) {
      return verdictStep(
        'Allow and count it',
        'count = count + cost',
        `The count is now ${count + record.cost}. ${decision.remaining} left until the reset at ${s(decision.resetAt)}.`,
        true,
      )
    }
    return verdictStep(
      'Reject with 429',
      'Retry-After = windowEnd − now',
      `${s(decision.resetAt)} − ${s(record.at)} = ${s(decision.retryAfterMs)}. The count stays at ${count}.`,
      false,
    )
  }

  private windowStartAt(now: number): number {
    return Math.floor(now / this.policy.windowMs) * this.policy.windowMs
  }

  private countIn(stored: FixedWindowState | undefined, windowStart: number): number {
    return stored?.windowStart === windowStart ? stored.count : 0
  }

  private parse(state: unknown): FixedWindowState | undefined {
    const result = this.schema.safeParse(state)
    return result.success ? result.data : undefined
  }
}
