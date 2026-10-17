import { z } from 'zod'
import type { AlgorithmName, AlgorithmPolicy, Evaluation, RateLimitAlgorithm } from './algorithm'

const slidingWindowStateSchema = z
  .object({
    windowStart: z.number().int().nonnegative(),
    current: z.number().int().nonnegative(),
    previous: z.number().int().nonnegative(),
  })
  .readonly()

export type SlidingWindowState = z.infer<typeof slidingWindowStateSchema>

interface Counters {
  readonly current: number
  readonly previous: number
}

export class SlidingWindow implements RateLimitAlgorithm<SlidingWindowState> {
  readonly name: AlgorithmName = 'sliding-window'
  readonly stateSchema: z.ZodType<SlidingWindowState> = slidingWindowStateSchema

  constructor(private readonly policy: AlgorithmPolicy) {}

  evaluate(state: SlidingWindowState | undefined, now: number, cost: number): Evaluation<SlidingWindowState> {
    const { limit, windowMs } = this.policy
    const windowStart = Math.floor(now / windowMs) * windowMs
    const elapsed = now - windowStart
    const { current, previous } = this.rollForward(state, windowStart)
    const allowed = this.estimate(previous, current, elapsed) + cost <= limit
    const nextCurrent = allowed ? current + cost : current
    const retryAfterMs = allowed ? 0 : this.retryAfter(windowStart, now, { current, previous }, cost)
    return {
      state: { windowStart, current: nextCurrent, previous },
      ttlMs: 2 * windowMs - elapsed,
      decision: {
        allowed,
        limit,
        remaining: Math.max(0, Math.floor(limit - this.estimate(previous, nextCurrent, elapsed))),
        resetAt: allowed ? windowStart + windowMs : now + retryAfterMs,
        retryAfterMs,
      },
    }
  }

  private rollForward(state: SlidingWindowState | undefined, windowStart: number): Counters {
    if (state?.windowStart === windowStart) return { current: state.current, previous: state.previous }
    if (state?.windowStart === windowStart - this.policy.windowMs) return { current: 0, previous: state.current }
    return { current: 0, previous: 0 }
  }

  private estimate(previous: number, current: number, elapsed: number): number {
    const { windowMs } = this.policy
    return (previous * (windowMs - elapsed)) / windowMs + current
  }

  private retryAfter(windowStart: number, now: number, counters: Counters, cost: number): number {
    const waitUntil = windowStart + this.waitOffset(counters, cost)
    return Math.max(1, Math.ceil(waitUntil - now))
  }

  private waitOffset({ current, previous }: Counters, cost: number): number {
    const { limit, windowMs } = this.policy
    if (current + cost <= limit) return windowMs * (1 - (limit - cost - current) / previous)
    return windowMs + windowMs * Math.max(0, 1 - (limit - cost) / current)
  }
}
