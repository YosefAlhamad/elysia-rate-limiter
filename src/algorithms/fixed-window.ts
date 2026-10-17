import { z } from 'zod'
import type { AlgorithmName, AlgorithmPolicy, Evaluation, RateLimitAlgorithm } from './algorithm'

const fixedWindowStateSchema = z
  .object({
    windowStart: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  })
  .readonly()

export type FixedWindowState = z.infer<typeof fixedWindowStateSchema>

export class FixedWindow implements RateLimitAlgorithm<FixedWindowState> {
  readonly name: AlgorithmName = 'fixed-window'
  readonly stateSchema: z.ZodType<FixedWindowState> = fixedWindowStateSchema

  constructor(private readonly policy: AlgorithmPolicy) {}

  evaluate(state: FixedWindowState | undefined, now: number, cost: number): Evaluation<FixedWindowState> {
    const { limit, windowMs } = this.policy
    const { windowStart, count } = this.currentWindow(state, now)
    const allowed = count + cost <= limit
    const nextCount = allowed ? count + cost : count
    const resetAt = windowStart + windowMs
    const untilReset = resetAt - now
    return {
      state: { windowStart, count: nextCount },
      ttlMs: untilReset,
      decision: {
        allowed,
        limit,
        remaining: Math.max(0, limit - nextCount),
        resetAt,
        retryAfterMs: allowed ? 0 : untilReset,
      },
    }
  }

  private currentWindow(state: FixedWindowState | undefined, now: number): FixedWindowState {
    const { windowMs } = this.policy
    const windowStart = Math.floor(now / windowMs) * windowMs
    if (state?.windowStart === windowStart || state?.windowStart === windowStart + windowMs) return state
    return { windowStart, count: 0 }
  }
}
