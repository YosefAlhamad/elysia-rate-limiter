import type { AlgorithmPolicy } from '../../../src/algorithms/algorithm'
import { FixedWindowInsight } from '../lab/insights/fixed-window-insight'
import { SlidingWindowInsight } from '../lab/insights/sliding-window-insight'
import { TokenBucketInsight } from '../lab/insights/token-bucket-insight'

export interface InsightSet {
  readonly fixedWindow: FixedWindowInsight
  readonly slidingWindow: SlidingWindowInsight
  readonly tokenBucket: TokenBucketInsight
}

export const createInsightSet = (policy: AlgorithmPolicy): InsightSet => ({
  fixedWindow: new FixedWindowInsight(policy),
  slidingWindow: new SlidingWindowInsight(policy),
  tokenBucket: new TokenBucketInsight(policy),
})
