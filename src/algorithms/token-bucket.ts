import { z } from 'zod'
import type { AlgorithmName, AlgorithmPolicy, Evaluation, RateLimitAlgorithm } from './algorithm'

const tokenBucketStateSchema = z
  .object({
    tokens: z.number().nonnegative().finite(),
    updatedAt: z.number().int().nonnegative(),
  })
  .readonly()

export type TokenBucketState = z.infer<typeof tokenBucketStateSchema>

export class TokenBucket implements RateLimitAlgorithm<TokenBucketState> {
  readonly name: AlgorithmName = 'token-bucket'
  readonly stateSchema: z.ZodType<TokenBucketState> = tokenBucketStateSchema

  constructor(private readonly policy: AlgorithmPolicy) {}

  evaluate(state: TokenBucketState | undefined, now: number, cost: number): Evaluation<TokenBucketState> {
    const { limit } = this.policy
    const available = this.refill(state, now)
    const allowed = available >= cost
    const next = { tokens: allowed ? available - cost : available, updatedAt: this.anchor(state, now) }
    const untilFull = this.waitFor(next, now, limit)
    return {
      state: next,
      ttlMs: Math.max(1, untilFull),
      decision: {
        allowed,
        limit,
        remaining: Math.floor(next.tokens),
        resetAt: now + untilFull,
        retryAfterMs: allowed ? 0 : this.waitFor(next, now, cost),
      },
    }
  }

  private refill(state: TokenBucketState | undefined, now: number): number {
    const { limit, windowMs } = this.policy
    if (state === undefined) return limit
    const elapsed = Math.max(0, now - state.updatedAt)
    return Math.min(limit, state.tokens + (elapsed * limit) / windowMs)
  }

  private anchor(state: TokenBucketState | undefined, now: number): number {
    return Math.max(now, state?.updatedAt ?? now)
  }

  private waitFor(state: TokenBucketState, now: number, tokens: number): number {
    const { limit, windowMs } = this.policy
    const estimate = Math.max(0, state.updatedAt - now + Math.ceil(((tokens - state.tokens) * windowMs) / limit))
    const candidates = [estimate - 1, estimate, estimate + 1].filter((wait) => wait >= 0)
    return candidates.find((wait) => this.refill(state, now + wait) >= tokens) ?? estimate + 1
  }
}
