import type { z } from 'zod'
import type { AlgorithmPolicy } from '../../../../src/algorithms/algorithm'
import { TokenBucket, type TokenBucketState } from '../../../../src/algorithms/token-bucket'
import { formatNumber as n, formatSeconds as s } from '../format'
import type { RequestRecord } from '../request-record'
import { type AlgorithmInsight, type Explanation, type ExplanationStep, infoStep, verdictStep } from './explanation'

export interface TokenBucketView {
  readonly tokens: number
  readonly limit: number
  readonly msPerToken: number
  readonly msUntilFull: number
}

export class TokenBucketInsight implements AlgorithmInsight<TokenBucketView> {
  private readonly schema: z.ZodType<TokenBucketState>

  constructor(private readonly policy: AlgorithmPolicy) {
    this.schema = new TokenBucket(policy).stateSchema
  }

  view(state: unknown, now: number): TokenBucketView {
    const { limit, windowMs } = this.policy
    const tokens = this.refill(this.parse(state), now)
    return { tokens, limit, msPerToken: windowMs / limit, msUntilFull: ((limit - tokens) * windowMs) / limit }
  }

  explain(record: RequestRecord): Explanation {
    const stored = this.parse(record.stateBefore)
    const available = this.refill(stored, record.at)
    const allowed = available >= record.cost
    const steps = [...this.refillSteps(stored, record.at, available), this.checkStep(available, record.cost, allowed), this.outcomeStep(record, available)]
    return { allowed, steps }
  }

  private refillSteps(stored: TokenBucketState | undefined, now: number, available: number): readonly ExplanationStep[] {
    const { limit, windowMs } = this.policy
    if (stored === undefined) {
      return [infoStep('Open a new bucket', 'tokens = limit', `Nothing is stored for this client yet, so the bucket starts full with ${limit} tokens.`)]
    }
    const elapsed = Math.max(0, now - stored.updatedAt)
    const added = (elapsed * limit) / windowMs
    return [
      infoStep('Measure the time since the last update', 'elapsed = now − updatedAt', `${s(now)} − ${s(stored.updatedAt)} = ${s(elapsed)}`),
      infoStep('Drip in new tokens', 'added = elapsed × limit ÷ window', `${s(elapsed)} × ${limit} ÷ ${s(windowMs)} = ${n(added)} tokens`),
      infoStep('Cap at the bucket size', 'tokens = min(limit, stored + added)', `min(${limit}, ${n(stored.tokens)} + ${n(added)}) = ${n(available)}`),
    ]
  }

  private checkStep(available: number, cost: number, allowed: boolean): ExplanationStep {
    return verdictStep('Check for enough tokens', 'tokens ≥ cost', `${n(available)} ${allowed ? '≥' : '<'} ${cost}`, allowed)
  }

  private outcomeStep(record: RequestRecord, available: number): ExplanationStep {
    const { decision } = record.evaluation
    if (decision.allowed) {
      return verdictStep('Take the tokens', 'tokens = tokens − cost', `${n(available)} − ${record.cost} = ${n(available - record.cost)} tokens left.`, true)
    }
    return verdictStep(
      'Reject with 429',
      'Retry-After = (cost − tokens) × window ÷ limit',
      `(${record.cost} − ${n(available)}) × ${s(this.policy.windowMs)} ÷ ${this.policy.limit} ≈ ${s(decision.retryAfterMs)} until there are enough tokens.`,
      false,
    )
  }

  private refill(stored: TokenBucketState | undefined, now: number): number {
    const { limit, windowMs } = this.policy
    if (stored === undefined) return limit
    const elapsed = Math.max(0, now - stored.updatedAt)
    return Math.min(limit, stored.tokens + (elapsed * limit) / windowMs)
  }

  private parse(state: unknown): TokenBucketState | undefined {
    const result = this.schema.safeParse(state)
    return result.success ? result.data : undefined
  }
}
