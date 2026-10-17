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
    const tokens = allowed ? available - cost : available
    const updatedAt = Math.max(now, state?.updatedAt ?? now)
    const untilFull = updatedAt - now + this.millisecondsToEarn(limit - tokens)
    return {
      state: { tokens, updatedAt },
      ttlMs: Math.max(1, untilFull),
      decision: {
        allowed,
        limit,
        remaining: Math.floor(tokens),
        resetAt: now + untilFull,
        retryAfterMs: allowed ? 0 : updatedAt - now + this.millisecondsToEarn(cost - tokens),
      },
    }
  }

  private refill(state: TokenBucketState | undefined, now: number): number {
    const { limit, windowMs } = this.policy
    if (state === undefined) return limit
    const elapsed = Math.max(0, now - state.updatedAt)
    return Math.min(limit, state.tokens + (elapsed * limit) / windowMs)
  }

  private millisecondsToEarn(tokens: number): number {
    const { limit, windowMs } = this.policy
    return Math.ceil((tokens * windowMs) / limit)
  }
}
