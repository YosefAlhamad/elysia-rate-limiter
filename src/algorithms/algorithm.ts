import type { z } from 'zod'
import type { RateLimitDecision } from '../core/decision'

export type AlgorithmName = 'fixed-window' | 'sliding-window' | 'token-bucket'

export interface AlgorithmPolicy {
  readonly limit: number
  readonly windowMs: number
}

export interface Evaluation<TState> {
  readonly state: TState
  readonly ttlMs: number
  readonly decision: RateLimitDecision
}

export interface RateLimitAlgorithm<TState> {
  readonly name: AlgorithmName
  readonly stateSchema: z.ZodType<TState>
  evaluate(state: TState | undefined, now: number, cost: number): Evaluation<TState>
}

export type RateLimitAlgorithmConstructor = new (policy: AlgorithmPolicy) => RateLimitAlgorithm<unknown>
